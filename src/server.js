import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clampPollMinutes, config } from "./config.js";
import {
  id,
  normalizeAirport,
  normalizeFlightNumber,
  nowIso,
  operationalDayKey,
  parseDateInput,
  sanitizeText
} from "./edctCore.js";
import { refreshDueAirports, refreshWorkspace, statusForWorkspace } from "./edctService.js";
import { RateLimiter } from "./rateLimit.js";
import { fetchSourceForAirport } from "./sourceClient.js";
import { Store } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const store = new Store(config.dbFile);
const limiter = new RateLimiter();
const lookupCache = new Map();

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://api.sadiom.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join("; ");

function ipHash(req) {
  const raw = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function userAgentApprox(req) {
  return sanitizeText(String(req.headers["user-agent"] || "").split(" ").slice(0, 4).join(" "), 120);
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => {
    const [k, ...v] = part.trim().split("=");
    return [k, decodeURIComponent(v.join("=") || "")];
  }).filter(([k]) => k));
}

function allowedOrigin(req) {
  const origin = String(req.headers.origin || "");
  return config.allowedOrigins.includes(origin) ? origin : "";
}

function isCrossOriginRequest(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return false;
  const host = String(req.headers.host || "");
  try {
    return new URL(origin).host !== host;
  } catch {
    return false;
  }
}

function setCorsHeaders(req, res) {
  const origin = allowedOrigin(req);
  if (!origin) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
  return true;
}

function setSecurityHeaders(res, contentType = "application/json") {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
}

function send(res, status, body) {
  setSecurityHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function sessionFor(req, res) {
  const cookies = parseCookies(req);
  const sessionId = /^sess_[a-f0-9]{32}$/.test(cookies.device_session_id || "") ? cookies.device_session_id : id("sess");
  const result = store.ensureSession(sessionId, userAgentApprox(req), ipHash(req));
  const sameSite = isCrossOriginRequest(req) ? "None" : "Lax";
  res.setHeader("Set-Cookie", `device_session_id=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=31536000`);
  return result;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 20000) reject(new Error("Payload too large."));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function rate(req, sessionId, name, limit, windowMs) {
  return limiter.check(`${name}:${sessionId}:${ipHash(req)}`, limit, windowMs);
}

function publicSession(workspace, session) {
  return {
    optional_label: workspace.optional_label || "",
    monitoring_enabled: workspace.monitoring_enabled !== false,
    refresh_interval_minutes: workspace.refresh_interval_minutes || clampPollMinutes(),
    notification_permission: session.notification_permission || "default"
  };
}

function flightPayload(body, workspaceId, existing = null) {
  const flightNumber = normalizeFlightNumber(body.flight_number ?? body.display_flight_number ?? existing?.display_flight_number);
  const etd = parseDateInput(body.etd ?? body.etd_utc ?? existing?.etd_utc, "ETD is required.");
  const scheduledDeparture = body.scheduled_departure_utc ? parseDateInput(body.scheduled_departure_utc) : existing?.scheduled_departure_utc || null;
  const scheduledArrival = body.scheduled_arrival_utc ? parseDateInput(body.scheduled_arrival_utc) : existing?.scheduled_arrival_utc || null;
  return {
    workspace_id: workspaceId,
    display_flight_number: flightNumber.display,
    normalized_acid: flightNumber.normalizedAcid,
    origin: normalizeAirport(body.origin ?? existing?.origin),
    destination: normalizeAirport(body.destination ?? existing?.destination),
    etd_utc: etd,
    scheduled_departure_utc: scheduledDeparture,
    scheduled_arrival_utc: scheduledArrival,
    operational_day_key: operationalDayKey(scheduledDeparture || etd),
    active: true,
    updated_at: nowIso()
  };
}

function flightsFor(workspaceId) {
  return store.data.flights
    .filter((f) => f.workspace_id === workspaceId && f.active)
    .map((f) => publicFlight(f, store.data.edct_flight_states.find((s) => s.flight_id === f.id) || null));
}

function publicFlight(flight, state = null) {
  return {
    flight_key: flight.id,
    display_flight_number: flight.display_flight_number,
    origin: flight.origin,
    destination: flight.destination,
    etd_utc: flight.etd_utc,
    state: state ? {
      current_edct_utc: state.current_edct_utc,
      previous_edct_utc: state.previous_edct_utc,
      last_change: state.last_change,
      last_checked_utc: state.last_source_fetch_at
    } : null
  };
}

function publicEvent(event) {
  return {
    event_type: event.event_type,
    previous_edct_utc: event.previous_edct_utc,
    new_edct_utc: event.new_edct_utc,
    message: event.message,
    created_at: event.created_at
  };
}

function publicNotification(notification) {
  return {
    notification_key: notification.id,
    title: notification.title,
    body: notification.body,
    created_at: notification.created_at
  };
}

function lookupCandidate(record, fetchedAt) {
  const candidateId = id("cand");
  const cached = {
    candidate_id: candidateId,
    flight_number: record.acid,
    normalized_acid: record.acid,
    origin: record.origin,
    destination: record.destination,
    etd_utc: record.etd_utc || null,
    current_edct_utc: record.edct_utc,
    source_freshness_at: fetchedAt
  };
  lookupCache.set(candidateId, { ...cached, expires_at: Date.now() + 10 * 60_000 });
  return {
    candidate_key: candidateId,
    flight_number: cached.flight_number,
    origin: cached.origin,
    destination: cached.destination,
    etd_utc: cached.etd_utc,
    current_edct_utc: cached.current_edct_utc,
    status: "matched"
  };
}

function purgeLookupCache() {
  const now = Date.now();
  for (const [key, value] of lookupCache.entries()) {
    if (value.expires_at <= now) lookupCache.delete(key);
  }
}

function pendingNotifications(workspaceId, sessionId) {
  return store.data.notification_events.filter((n) =>
    n.workspace_id === workspaceId &&
    !store.data.notification_deliveries.some((d) => d.notification_event_id === n.id && d.session_id === sessionId && d.delivery_state === "delivered")
  );
}

async function api(req, res, pathname) {
  if (req.method === "OPTIONS") {
    setSecurityHeaders(res);
    res.setHeader("Cache-Control", "no-store");
    if (!setCorsHeaders(req, res)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: "Forbidden." }));
    }
    res.writeHead(204);
    return res.end();
  }
  const origin = String(req.headers.origin || "");
  if (origin && !setCorsHeaders(req, res)) return send(res, 403, { error: "Forbidden." });
  if (req.method === "GET" && pathname === "/api/health") {
    return send(res, 200, {
      ok: true,
      service: "sadiom-edct-api",
      time: nowIso()
    });
  }
  const { session, workspace } = sessionFor(req, res);
  if (!rate(req, session.id, "api", 240, 60_000)) return send(res, 429, { error: "Too many requests." });
  try {
    if (req.method === "GET" && pathname === "/api/session") {
      store.usage("PAGE_OR_SESSION_LOAD", workspace.id, session.id, {});
      return send(res, 200, { session: publicSession(workspace, session) });
    }
    if (req.method === "POST" && pathname === "/api/session/label") {
      if (!rate(req, session.id, "session", 20, 60_000)) return send(res, 429, { error: "Too many session updates." });
      const body = await readBody(req);
      const patch = {
        optional_label: body.label === undefined ? workspace.optional_label || "" : sanitizeText(body.label, 60),
        monitoring_enabled: body.monitoring_enabled === undefined ? workspace.monitoring_enabled !== false : body.monitoring_enabled !== false,
        refresh_interval_minutes: body.refresh_interval_minutes === undefined ? workspace.refresh_interval_minutes || clampPollMinutes() : clampPollMinutes(String(body.refresh_interval_minutes)),
        updated_at: nowIso()
      };
      store.update("workspaces", workspace.id, patch);
      store.update("sessions", session.id, { notification_permission: sanitizeText(body.notification_permission || session.notification_permission || "default", 20) });
      store.usage("SESSION_LABEL_UPDATED", workspace.id, session.id, { has_label: Boolean(patch.optional_label) });
      return send(res, 200, { session: publicSession({ ...workspace, ...patch }, { ...session, notification_permission: body.notification_permission || session.notification_permission }) });
    }
    if (req.method === "GET" && pathname === "/api/flights") return send(res, 200, { flights: flightsFor(workspace.id) });
    if (req.method === "POST" && pathname === "/api/flights") {
      if (!rate(req, session.id, "flight-entry", 40, 60_000)) return send(res, 429, { error: "Too many flight changes." });
      const body = await readBody(req);
      const created = store.insert("flights", { ...flightPayload(body, workspace.id), created_at: nowIso() });
      store.usage("FLIGHT_ADDED", workspace.id, session.id, { destination: created.destination });
      await refreshWorkspace(store, workspace.id, false, session.id);
      return send(res, 201, { flight: flightsFor(workspace.id).find((f) => f.flight_key === created.id) });
    }
    const flightMatch = pathname.match(/^\/api\/flights\/([^/]+)$/);
    if (flightMatch && req.method === "PATCH") {
      if (!rate(req, session.id, "flight-entry", 40, 60_000)) return send(res, 429, { error: "Too many flight changes." });
      const existing = store.data.flights.find((f) => f.id === flightMatch[1] && f.workspace_id === workspace.id);
      if (!existing) return send(res, 404, { error: "Flight not found." });
      const body = await readBody(req);
      const updated = store.update("flights", existing.id, flightPayload(body, workspace.id, existing));
      store.usage("FLIGHT_EDITED", workspace.id, session.id, { destination: updated.destination });
      await refreshWorkspace(store, workspace.id, false, session.id);
      return send(res, 200, { flight: flightsFor(workspace.id).find((f) => f.flight_key === updated.id) });
    }
    if (flightMatch && req.method === "DELETE") {
      const existing = store.data.flights.find((f) => f.id === flightMatch[1] && f.workspace_id === workspace.id);
      if (!existing) return send(res, 404, { error: "Flight not found." });
      store.update("flights", existing.id, { active: false, updated_at: nowIso() });
      store.usage("FLIGHT_DELETED", workspace.id, session.id, { destination: existing.destination });
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && pathname === "/api/edct/status") return send(res, 200, statusForWorkspace(store, workspace.id));
    if (req.method === "GET" && pathname === "/api/edct/lookup") {
      if (!rate(req, session.id, "lookup", 30, 60_000)) return send(res, 429, { error: "Too many lookups." });
      purgeLookupCache();
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const flight = normalizeFlightNumber(url.searchParams.get("flight") || "");
      const destination = normalizeAirport(url.searchParams.get("destination") || "");
      const matches = [];
      const snapshot = await fetchSourceForAirport(destination, nowIso());
      if (snapshot.success) {
        for (const record of snapshot.records) {
          if (record.acid !== flight.normalizedAcid) continue;
          if (record.destination !== destination) continue;
          matches.push(lookupCandidate(record, snapshot.fetched_at));
        }
      }
      return send(res, 200, {
        candidates: matches,
        message: matches.length ? (matches.some((candidate) => candidate.current_edct_utc) ? "" : `Flight found in ${destination} feed, no active EDCT.`) : "No matching flight found in destination feed."
      });
    }
    if (req.method === "POST" && pathname === "/api/edct/lookup/add") {
      if (!rate(req, session.id, "flight-entry", 40, 60_000)) return send(res, 429, { error: "Too many flight changes." });
      purgeLookupCache();
      const body = await readBody(req);
      const candidate = lookupCache.get(sanitizeText(body.candidate_key || body.candidate_id, 80));
      if (!candidate) return send(res, 404, { error: "Flight candidate expired. Search again." });
      const existing = store.data.flights.find((f) =>
        f.workspace_id === workspace.id &&
        f.active &&
        f.normalized_acid === candidate.normalized_acid &&
        f.origin === candidate.origin &&
        f.destination === candidate.destination
      );
      if (existing) return send(res, 200, { flight: flightsFor(workspace.id).find((f) => f.flight_key === existing.id), duplicate: true });
      const etd = candidate.etd_utc || candidate.current_edct_utc || candidate.source_freshness_at || nowIso();
      const created = store.insert("flights", {
        workspace_id: workspace.id,
        display_flight_number: candidate.flight_number,
        normalized_acid: candidate.normalized_acid,
        origin: candidate.origin,
        destination: candidate.destination,
        etd_utc: parseDateInput(etd, "Candidate time is unavailable."),
        scheduled_departure_utc: null,
        scheduled_arrival_utc: null,
        operational_day_key: operationalDayKey(etd),
        active: true,
        created_at: nowIso(),
        updated_at: nowIso()
      });
      store.usage("FLIGHT_ADDED", workspace.id, session.id, { destination: created.destination, lookup: true });
      await refreshWorkspace(store, workspace.id, false, session.id);
      return send(res, 201, { flight: flightsFor(workspace.id).find((f) => f.flight_key === created.id) });
    }
    if (req.method === "POST" && pathname === "/api/edct/refresh") {
      if (!rate(req, session.id, "refresh", 12, 60_000)) return send(res, 429, { error: "Too many refreshes." });
      return send(res, 200, await refreshWorkspace(store, workspace.id, true, session.id));
    }
    if (req.method === "GET" && pathname === "/api/edct/events") {
      return send(res, 200, { events: store.data.edct_events.filter((e) => e.workspace_id === workspace.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10).map(publicEvent) });
    }
    const flightEvents = pathname.match(/^\/api\/edct\/flights\/([^/]+)\/events$/);
    if (flightEvents && req.method === "GET") {
      return send(res, 404, { error: "Not found." });
    }
    if (req.method === "GET" && pathname === "/api/notifications/pending") {
      if (!rate(req, session.id, "notifications", 60, 60_000)) return send(res, 429, { error: "Too many notification checks." });
      return send(res, 200, { notifications: pendingNotifications(workspace.id, session.id).map(publicNotification) });
    }
    if (req.method === "POST" && pathname === "/api/notifications/mark-delivered") {
      const body = await readBody(req);
      const notificationIds = Array.isArray(body.notification_keys) ? body.notification_keys : Array.isArray(body.notification_ids) ? body.notification_ids : Array.isArray(body.notification_event_ids) ? body.notification_event_ids : [];
      for (const notificationId of notificationIds) {
        if (store.data.notification_events.some((n) => n.id === notificationId && n.workspace_id === workspace.id)) {
          store.insert("notification_deliveries", {
            notification_event_id: notificationId,
            session_id: session.id,
            delivery_state: sanitizeText(body.delivery_state || "delivered", 20),
            attempted_at: nowIso(),
            delivered_at: body.delivery_state === "failed" ? null : nowIso()
          });
        }
      }
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && pathname === "/api/admin/usage") {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!config.adminToken || token !== config.adminToken) return send(res, 403, { error: "Forbidden." });
      return send(res, 200, adminUsage());
    }
    return send(res, 404, { error: "Not found." });
  } catch (error) {
    return send(res, 400, { error: sanitizeText(error.message || "Invalid request.", 120) });
  }
}

function adminUsage() {
  const activeSince = Date.now() - 60 * 60 * 1000;
  const hubs = {};
  for (const f of store.data.flights.filter((f) => f.active)) hubs[f.destination] = (hubs[f.destination] || 0) + 1;
  return {
    totals: {
      workspaces: store.data.workspaces.length,
      sessions: store.data.sessions.length,
      active_sessions_1h: store.data.sessions.filter((s) => new Date(s.last_seen_at).getTime() >= activeSince).length,
      active_flights: store.data.flights.filter((f) => f.active).length,
      edct_events: store.data.edct_events.length,
      notifications: store.data.notification_events.length
    },
    hubs_monitored: hubs,
    recent_usage_events: store.data.usage_events.slice(-100).reverse(),
    sessions: store.data.sessions.map((s) => ({
      id: s.id,
      workspace_id: s.workspace_id,
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
      user_agent_approx: s.user_agent_approx,
      ip_hash: s.ip_hash,
      notification_permission: s.notification_permission,
      api_activity_count: s.api_activity_count,
      page_load_count: s.page_load_count,
      label: store.data.workspaces.find((w) => w.id === s.workspace_id)?.optional_label || ""
    }))
  };
}

function staticFile(req, res, pathname) {
  if (pathname !== "/edct" && pathname !== "/edct/" && !pathname.startsWith("/edct/")) return false;
  const relative = pathname === "/edct" || pathname === "/edct/" ? "index.html" : pathname.slice("/edct/".length);
  const root = path.resolve(__dirname, "../edct");
  const file = path.resolve(root, relative);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
  setSecurityHeaders(res, types[ext] || "application/octet-stream");
  res.writeHead(200);
  res.end(fs.readFileSync(file));
  return true;
}

export const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (pathname.startsWith("/api/")) return api(req, res, pathname);
  if (pathname === "/") {
    res.writeHead(302, { location: "/edct" });
    return res.end();
  }
  if (staticFile(req, res, pathname)) return;
  send(res, 404, { error: "Not found." });
});

if (process.env.NODE_ENV !== "test") {
  server.listen(config.port, () => {
    console.log(`Sadiom EDCT server listening on http://localhost:${config.port}/edct`);
  });
  setInterval(() => refreshDueAirports(store).catch(() => {}), clampPollMinutes() * 60_000);
}
