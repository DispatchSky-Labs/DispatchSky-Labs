import { Worker } from "node:worker_threads";
import { id, nowIso } from "./edctCore.js";
import { loadDatabase } from "./sqliteStorage.js";

export class Store {
  constructor(file, options = {}) {
    this.file = file;
    this.sqliteFile = options.sqliteFile || `${file}.sqlite`;
    this.data = loadDatabase(file, this.sqliteFile, options);
    this.revision = 0;
    this.committedRevision = 0;
    this.pending = [];
    this.waiters = [];
    this.persistenceError = null;
    this.closed = false;
    this.worker = new Worker(new URL("./storageWorker.js", import.meta.url), { workerData: { file: this.sqliteFile } });
    this.worker.on("message", (message) => {
      if (message.error) return this.fail(new Error(message.error));
      this.committedRevision = message.revision;
      const complete = this.waiters.filter((waiter) => waiter.revision <= message.revision);
      this.waiters = this.waiters.filter((waiter) => waiter.revision > message.revision);
      for (const waiter of complete) waiter.resolve();
      if (this.committedRevision === this.revision) this.worker.unref();
    });
    this.worker.on("error", (error) => this.fail(error));
    this.worker.on("exit", () => {
      if (!this.closed) this.fail(new Error("Storage worker stopped unexpectedly."));
    });
    this.worker.unref();
  }

  fail(error) {
    if (this.persistenceError) return;
    this.persistenceError = error;
    console.error("Database persistence failed:", error.message);
    for (const waiter of this.waiters) waiter.reject(error);
    this.waiters = [];
    this.pending = [];
    this.worker.unref();
  }

  assertWritable() {
    if (this.persistenceError) throw this.persistenceError;
    if (this.closed) throw new Error("Store is closed.");
  }

  enqueue(operation) {
    this.assertWritable();
    // Clone only the changed row. Never serialize or copy the complete store.
    this.pending.push(structuredClone(operation));
    this.revision += 1;
    this.worker.ref();
    if (!this.scheduled) this.scheduled = setImmediate(() => this.dispatch());
  }

  dispatch() {
    if (this.scheduled) clearImmediate(this.scheduled);
    this.scheduled = null;
    if (!this.pending.length || this.persistenceError) return;
    const operations = this.pending;
    this.pending = [];
    this.worker.postMessage({ revision: this.revision, operations });
  }

  flush() {
    if (this.persistenceError) return Promise.reject(this.persistenceError);
    this.dispatch();
    if (this.committedRevision === this.revision) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ revision: this.revision, resolve, reject }));
  }

  async close() {
    try {
      await this.flush();
    } finally {
      this.closed = true;
      await this.worker.terminate();
    }
  }

  deleteWhere(table, predicate) {
    this.assertWritable();
    const removed = this.data[table].filter(predicate);
    const ids = new Set(removed.map((row) => row.id));
    this.data[table] = this.data[table].filter((row) => !ids.has(row.id));
    for (const row of removed) this.enqueue({ type: "delete", table, id: row.id });
    return removed.length;
  }

  insert(table, row) {
    this.assertWritable();
    if (table === "source_airport_snapshots") {
      const previous = this.data[table].find((item) => item.airport === row.airport && Boolean(item.success) === Boolean(row.success));
      if (previous && String(previous.fetched_at || "") > String(row.fetched_at || "")) return previous;
      this.deleteWhere(table, (item) => item.airport === row.airport && Boolean(item.success) === Boolean(row.success));
    }
    const next = { id: row.id || id(table.slice(0, -1)), ...row };
    if (this.data[table].some((item) => item.id === next.id)) throw new Error(`Duplicate row in ${table}.`);
    this.data[table].push(next);
    this.enqueue({ type: "upsert", table, row: next });
    return next;
  }

  update(table, rowId, patch) {
    this.assertWritable();
    const row = this.data[table].find((item) => item.id === rowId);
    if (!row) return null;
    Object.assign(row, patch);
    this.enqueue({ type: "upsert", table, row });
    return row;
  }

  ensureSession(sessionId, userAgent, ipHash, enrichment = {}) {
    this.assertWritable();
    const ts = nowIso();
    let session = this.data.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.last_seen_at = ts;
      if (!session.last_user_activity_at) {
        session.last_user_activity_at = session.last_activity_at || session.created_at || ts;
      }
      if (!Object.hasOwn(session, "last_operator_action_at")) {
        session.last_operator_action_at = session.last_user_activity_at || session.last_activity_at || session.created_at || ts;
      }
      session.user_agent_approx = userAgent || session.user_agent_approx || "";
      session.ip_hash = ipHash || session.ip_hash || "";
      Object.assign(session, safeEnrichment(enrichment, session));
      session.api_activity_count = (session.api_activity_count || 0) + 1;
      this.enqueue({ type: "upsert", table: "sessions", row: session });
      return { session, workspace: this.data.workspaces.find((w) => w.id === session.workspace_id), created: false };
    }
    const workspace = this.insert("workspaces", {
      created_at: ts,
      updated_at: ts,
      optional_label: "",
      monitoring_enabled: true,
      refresh_interval_minutes: 5
    });
    session = this.insert("sessions", {
      id: sessionId,
      workspace_id: workspace.id,
      created_at: ts,
      last_seen_at: ts,
      last_activity_at: ts,
      last_user_activity_at: ts,
      last_operator_action_at: null,
      last_heartbeat_at: null,
      user_agent_approx: userAgent,
      ip_hash: ipHash,
      ...safeEnrichment(enrichment),
      notification_permission: "default",
      api_activity_count: 1,
      page_load_count: 0
    });
    this.usage("SESSION_CREATED", workspace.id, session.id, {});
    return { session, workspace, created: true };
  }

  usage(event_type, workspace_id, session_id, metadata = {}) {
    return this.insert("usage_events", {
      workspace_id,
      session_id,
      event_type,
      metadata,
      created_at: nowIso()
    });
  }

  dedupedEdctEvent(row) {
    const exists = this.data.edct_events.find((e) =>
      e.workspace_id === row.workspace_id &&
      e.flight_signature === row.flight_signature &&
      e.event_type === row.event_type &&
      (e.previous_edct_utc || "") === (row.previous_edct_utc || "") &&
      (e.new_edct_utc || "") === (row.new_edct_utc || "")
    );
    if (exists) return { event: exists, inserted: false };
    return { event: this.insert("edct_events", row), inserted: true };
  }

  stateKey(row) {
    return [row.workspace_id, row.normalized_acid, row.origin, row.destination, row.operational_day_key].join("|");
  }

  upsertState(row) {
    const key = this.stateKey(row);
    const existing = this.data.edct_flight_states.find((s) => this.stateKey(s) === key);
    if (existing) {
      return this.update("edct_flight_states", existing.id, row);
    }
    return this.insert("edct_flight_states", row);
  }
}

function safeEnrichment(enrichment, existing = {}) {
  return {
    country: enrichment.country || existing.country || "",
    region: enrichment.region || existing.region || "",
    region_label: enrichment.region_label || existing.region_label || "",
    city: enrichment.city || existing.city || "",
    timezone: enrichment.timezone || existing.timezone || "",
    timezone_label: enrichment.timezone_label || existing.timezone_label || "",
    asn: enrichment.asn || existing.asn || "",
    organization: enrichment.organization || existing.organization || ""
  };
}
