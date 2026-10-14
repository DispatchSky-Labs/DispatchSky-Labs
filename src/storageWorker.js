import { parentPort, workerData } from "node:worker_threads";
import { openDatabase, tableNames } from "./sqliteStorage.js";

const db = openDatabase(workerData.file);
const upsert = db.prepare(`INSERT INTO records (table_name, id, data) VALUES (?, ?, ?)
  ON CONFLICT(table_name, id) DO UPDATE SET data = excluded.data`);
const remove = db.prepare("DELETE FROM records WHERE table_name = ? AND id = ?");

parentPort.on("message", ({ revision, operations }) => {
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const operation of operations) {
      if (!tableNames.includes(operation.table)) throw new Error("Unknown storage table.");
      if (operation.type === "upsert") upsert.run(operation.table, operation.row.id, JSON.stringify(operation.row));
      else if (operation.type === "delete") remove.run(operation.table, operation.id);
      else throw new Error("Unknown storage operation.");
    }
    db.exec("COMMIT");
    parentPort.postMessage({ revision });
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    // A failed batch makes subsequent writes unsafe. Stop rather than allowing
    // a later batch to appear successful after an earlier one was lost.
    parentPort.postMessage({ error: error.message });
    db.close();
    parentPort.close();
  }
});
