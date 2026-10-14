import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { Store } from "../src/store.js";

function databaseFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sadiom-storage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "db.json");
}

test("Railway startup refuses an empty container unless explicitly configured for a fresh installation", (t) => {
  const file = databaseFile(t);
  const result = spawnSync(process.execPath, ["src/server.js"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", EDCT_DB_FILE: file, RAILWAY_PROJECT_ID: "test-project", EDCT_REQUIRE_EXISTING_DB: "" }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Existing database required/);
  assert.equal(fs.existsSync(`${file}.sqlite`), false);
});

test("migration preserves operational tables and backup; restart uses committed SQLite", async (t) => {
  const file = databaseFile(t);
  const original = {
    workspaces: [{ id: "w1", optional_label: "Desk" }],
    sessions: [{ id: "s1", workspace_id: "w1", notification_permission: "granted" }],
    flights: [{ id: "f1", workspace_id: "w1", normalized_acid: "SKW5694", origin: "XNA", destination: "DEN", active: true }],
    edct_flight_states: [{ id: "state1", flight_id: "f1", current_edct_utc: "2026-10-14T23:10:00.000Z" }],
    edct_events: [{ id: "event1", flight_id: "f1", acknowledged_at: "2026-10-14T20:00:00Z" }],
    notification_events: [{ id: "n1", edct_event_id: "event1" }],
    notification_deliveries: [{ id: "d1", notification_event_id: "n1", session_id: "s1", delivery_state: "delivered" }],
    usage_events: [{ id: "u1", event_type: "LOOKUP_SUCCEEDED" }],
    admin_events: [{ id: "a1", event_type: "backend_woke" }],
    source_airport_snapshots: [
      { id: "old", airport: "DEN", success: true, fetched_at: "2026-10-14T18:00:00Z", normalized_records: [{ acid: "old" }] },
      { id: "new", airport: "DEN", success: true, fetched_at: "2026-10-14T20:00:00Z", normalized_records: [{ acid: "SKW5694" }] },
      { id: "error", airport: "DEN", success: false, fetched_at: "2026-10-14T19:00:00Z", normalized_records: [] }
    ]
  };
  const backup = JSON.stringify(original, null, 2);
  fs.writeFileSync(file, backup);
  let store = new Store(file, { requireExisting: true });
  for (const [table, rows] of Object.entries(original)) {
    if (table !== "source_airport_snapshots") assert.deepEqual(store.data[table], rows);
  }
  assert.deepEqual(store.data.source_airport_snapshots.map((row) => row.id), ["new", "error"]);
  store.update("flights", "f1", { active: false });
  store.deleteWhere("notification_deliveries", (row) => row.id === "d1");
  await store.close();
  assert.equal(fs.readFileSync(file, "utf8"), backup);
  store = new Store(file, { requireExisting: true });
  try {
    assert.equal(store.data.flights[0].active, false);
    assert.equal(store.data.notification_deliveries.length, 0);
    assert.equal(store.data.edct_events[0].acknowledged_at, original.edct_events[0].acknowledged_at);
  } finally { await store.close(); }
});

test("invalid migration rolls back and can be retried; missing required data fails closed", async (t) => {
  const file = databaseFile(t);
  assert.throws(() => new Store(file, { requireExisting: true }), /Existing database required/);
  assert.equal(fs.existsSync(`${file}.sqlite`), false);
  fs.writeFileSync(file, JSON.stringify({ flights: [{ origin: "XNA" }] }));
  assert.throws(() => new Store(file), /Invalid legacy row/);
  const db = new DatabaseSync(`${file}.sqlite`);
  assert.equal(db.prepare("SELECT count(*) AS count FROM records").get().count, 0);
  db.close();
  fs.writeFileSync(file, JSON.stringify({ flights: [{ id: "recovered", active: true }] }));
  const store = new Store(file);
  assert.equal(store.data.flights[0].id, "recovered");
  await store.close();
});

test("bounded snapshots retain latest successful records through failures and restart", async (t) => {
  const file = databaseFile(t);
  let store = new Store(file);
  const snapshot = (minute, success) => ({
    airport: "DEN", success, fetched_at: new Date(Date.UTC(2026, 9, 14, 20, minute)).toISOString(),
    normalized_records: success ? [{ acid: "SKW5694", etd: "E142310" }] : []
  });
  for (let minute = 0; minute < 30; minute++) store.insert("source_airport_snapshots", snapshot(minute, true));
  for (let minute = 30; minute < 60; minute++) store.insert("source_airport_snapshots", snapshot(minute, false));
  store.insert("source_airport_snapshots", snapshot(1, true));
  assert.equal(store.data.source_airport_snapshots.length, 2);
  await store.close();
  store = new Store(file);
  try {
    const rows = store.data.source_airport_snapshots;
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.success).fetched_at, snapshot(29, true).fetched_at);
    assert.equal(rows.find((row) => row.success).normalized_records[0].acid, "SKW5694");
    assert.equal(rows.find((row) => !row.success).fetched_at, snapshot(59, false).fetched_at);
  } finally { await store.close(); }
});

test("updating one row does not serialize unrelated data", async (t) => {
  const store = new Store(databaseFile(t));
  try {
    store.insert("flights", { id: "large", payload: "x".repeat(2_000_000) });
    store.insert("sessions", { id: "session", api_activity_count: 1 });
    await store.flush();
    Object.defineProperty(store.data.flights[0], "unexpectedSerialization", {
      enumerable: true, get() { throw new Error("Unrelated row was read"); }
    });
    store.update("sessions", "session", { api_activity_count: 2 });
    await store.flush();
    const db = new DatabaseSync(store.sqliteFile);
    const row = db.prepare("SELECT data FROM records WHERE table_name = 'sessions'").get();
    assert.equal(JSON.parse(row.data).api_activity_count, 2);
    db.close();
  } finally { await store.close(); }
});

test("failed worker transaction rejects flush with no partially committed rows", async (t) => {
  const store = new Store(databaseFile(t));
  store.insert("flights", { id: "f1", active: true });
  store.enqueue({ type: "invalid", table: "flights" });
  await assert.rejects(store.flush(), /Unknown storage operation/);
  assert.ok(store.persistenceError);
  assert.throws(() => store.update("flights", "f1", { active: false }), /Unknown storage operation/);
  const db = new DatabaseSync(store.sqliteFile);
  assert.equal(db.prepare("SELECT count(*) AS count FROM records").get().count, 0);
  db.close();
  await assert.rejects(store.close(), /Unknown storage operation/);
});
