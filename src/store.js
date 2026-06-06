import fs from "node:fs";
import path from "node:path";
import { id, nowIso } from "./edctCore.js";

const tableNames = [
  "workspaces",
  "sessions",
  "usage_events",
  "flights",
  "source_airport_snapshots",
  "edct_flight_states",
  "edct_events",
  "notification_events",
  "notification_deliveries"
];

export class Store {
  constructor(file) {
    this.file = file;
    this.data = Object.fromEntries(tableNames.map((name) => [name, []]));
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const name of tableNames) this.data[name] = Array.isArray(parsed[name]) ? parsed[name] : [];
    } else {
      this.save();
    }
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  insert(table, row) {
    const next = { id: row.id || id(table.slice(0, -1)), ...row };
    this.data[table].push(next);
    this.save();
    return next;
  }

  update(table, rowId, patch) {
    const row = this.data[table].find((item) => item.id === rowId);
    if (!row) return null;
    Object.assign(row, patch);
    this.save();
    return row;
  }

  ensureSession(sessionId, userAgent, ipHash) {
    const ts = nowIso();
    let session = this.data.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.last_seen_at = ts;
      session.api_activity_count = (session.api_activity_count || 0) + 1;
      this.save();
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
      user_agent_approx: userAgent,
      ip_hash: ipHash,
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
      Object.assign(existing, row);
      this.save();
      return existing;
    }
    return this.insert("edct_flight_states", row);
  }
}
