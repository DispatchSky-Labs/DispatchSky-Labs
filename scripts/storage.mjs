import fs from "node:fs";
import path from "node:path";
import { loadDatabase } from "../src/sqliteStorage.js";

const [operation, input, output] = process.argv.slice(2);
if (!["migrate", "export"].includes(operation) || !input || (operation === "export" && !output)) {
  console.error("Usage: node scripts/storage.mjs migrate <legacy-json-path>\n       node scripts/storage.mjs export <legacy-json-path> <new-output-json-path>");
  process.exit(1);
}
const sqliteFile = `${input}.sqlite`;
if (operation === "export" && !fs.existsSync(sqliteFile)) throw new Error("SQLite database missing. Export aborted.");
const data = loadDatabase(input, sqliteFile, { requireExisting: true });
if (operation === "export") {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // Run with the service stopped. Refuse to overwrite either backup or live data.
  fs.writeFileSync(output, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
}
console.log(JSON.stringify({ operation, counts: Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])) }, null, 2));
