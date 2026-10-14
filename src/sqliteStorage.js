import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const tableNames = [
  "workspaces", "sessions", "usage_events", "flights", "source_airport_snapshots",
  "admin_events", "edct_flight_states", "edct_events", "notification_events", "notification_deliveries"
];

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
  return db;
}

// Status and NAS shadow need the latest success and failure, not every copy of
// every airport's flight list. The original JSON remains an untouched backup.
export function latestAirportSnapshots(rows) {
  const latest = new Map();
  for (const row of rows) {
    const key = `${row.airport}|${Boolean(row.success)}`;
    const previous = latest.get(key);
    if (!previous || String(row.fetched_at || "") >= String(previous.fetched_at || "")) latest.set(key, row);
  }
  return [...latest.values()];
}

// Synchronous work is confined to startup, before the HTTP server listens.
// Runtime writes and JSON encoding happen in storageWorker.js.
export function loadDatabase(legacyFile, sqliteFile, { requireExisting = false } = {}) {
  if (requireExisting && !fs.existsSync(sqliteFile) && !fs.existsSync(legacyFile)) {
    throw new Error("Existing database required. Restore the backup before starting this service.");
  }
  fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
  const db = openDatabase(sqliteFile);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (
        table_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
        UNIQUE(table_name, id)
      );
    `);
    const version = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
    if (version && version.value !== "1") throw new Error("Unsupported database schema version.");
    if (!version) {
      if (requireExisting && !fs.existsSync(legacyFile)) throw new Error("Database is uninitialized and the legacy backup is missing.");
      const legacy = fs.existsSync(legacyFile) ? JSON.parse(fs.readFileSync(legacyFile, "utf8")) : {};
      const insert = db.prepare("INSERT INTO records (table_name, id, data) VALUES (?, ?, ?)");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const table of tableNames) {
          let rows = Array.isArray(legacy[table]) ? legacy[table] : [];
          if (table === "source_airport_snapshots") rows = latestAirportSnapshots(rows);
          for (const row of rows) {
            if (typeof row.id !== "string" || !row.id) throw new Error(`Invalid legacy row in ${table}.`);
            insert.run(table, row.id, JSON.stringify(row));
          }
        }
        db.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', '1')").run();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    const data = Object.fromEntries(tableNames.map((table) => [table, []]));
    for (const row of db.prepare("SELECT table_name, data FROM records ORDER BY rowid").iterate()) {
      if (!data[row.table_name]) throw new Error("Unknown database table.");
      data[row.table_name].push(JSON.parse(row.data));
    }
    return data;
  } finally {
    db.close();
  }
}
