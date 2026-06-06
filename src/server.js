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

function ipEnrichment(req) {
  const country = sanitizeGeoValue(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || req.headers["x-railway-ip-country"], 2);
  const region = sanitizeGeoValue(req.headers["x-vercel-ip-country-region"] || req.headers["x-railway-ip-region"], 80);
  const city = sanitizeGeoValue(req.headers["x-vercel-ip-city"] || req.headers["x-railway-ip-city"], 80);
  const timezone = sanitizeGeoValue(req.headers["x-vercel-ip-timezone"] || req.headers["x-railway-ip-timezone"], 80);
  const asn = sanitizeAsn(req.headers["cf-asn"] || req.headers["x-vercel-ip-as-number"] || req.headers["x-railway-ip-asn"]);
  const organization = sanitizeText(req.headers["x-vercel-ip-as-organization"] || req.headers["x-railway-ip-organization"] || "", 120);
  return { country, region, city, timezone, asn, organization };
}

function sanitizeGeoValue(value, maxLength) {
  const cleaned = sanitizeText(String(value || ""), maxLength);
  return /^[A-Za-z0-9 ._/-]+$/.test(cleaned) ? cleaned : "";
}

function sanitizeAsn(value) {
  const cleaned = String(value || "").trim().toUpperCase().replace(/^AS/, "");
  return /^\d{1,10}$/.test(cleaned) ? `AS${cleaned}` : "";
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
  const result = store.ensureSession(sessionId, userAgentApprox(req), ipHash(req), ipEnrichment(req));
  const sameSite = isCrossOriginRequest(req) ? "None" : "Lax";
  res.setHeader("Set-Cookie", `device_session_id=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=31536000`);
  return result;
}

function existingSessionFromCookie(req) {
  const cookies = parseCookies(req);
  const sessionId = /^sess_[a-f0-9]{32}$/.test(cookies.device_session_id || "") ? cookies.device_session_id : "";
  if (!sessionId) return null;
  return store.data.sessions.find((s) => s.id === sessionId) || null;
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
  const ok = limiter.check(`${name}:${sessionId}:${ipHash(req)}`, limit, windowMs);
  if (!ok) {
    const session = store.data.sessions.find((s) => s.id === sessionId);
    store.usage("RATE_LIMITED", session?.workspace_id || null, session?.id || null, { route: sanitizeText(name, 40) });
  }
  return ok;
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
  if (req.method === "POST" && pathname === "/api/session/heartbeat") {
    const session = existingSessionFromCookie(req);
    if (!session) return send(res, 401, { error: "Session required." });
    if (!rate(req, session.id, "heartbeat", 90, 60_000)) return send(res, 429, { error: "Too many heartbeats." });
    const ts = nowIso();
    store.update("sessions", session.id, {
      last_seen_at: ts,
      last_heartbeat_at: ts,
      last_activity_at: ts,
      ...ipEnrichment(req)
    });
    return send(res, 200, { ok: true, lastHeartbeatAt: ts });
  }
  if (req.method === "GET" && (pathname === "/api/admin/usage" || pathname === "/api/admin/summary")) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!config.adminToken || token !== config.adminToken) return send(res, 403, { error: "Forbidden." });
    return send(res, 200, pathname === "/api/admin/summary" ? adminSummary() : adminUsage());
  }
  const { session, workspace } = sessionFor(req, res);
  if (!rate(req, session.id, "api", 240, 60_000)) return send(res, 429, { error: "Too many requests." });
  try {
    if (req.method === "GET" && pathname === "/api/session") {
      store.update("sessions", session.id, { page_load_count: (session.page_load_count || 0) + 1 });
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
      store.usage("LOOKUP_ATTEMPTED", workspace.id, session.id, { destination });
      const snapshot = await fetchSourceForAirport(destination, nowIso());
      if (snapshot.success) {
        for (const record of snapshot.records) {
          if (record.acid !== flight.normalizedAcid) continue;
          if (record.destination !== destination) continue;
          matches.push(lookupCandidate(record, snapshot.fetched_at));
        }
      }
      store.usage(matches.length ? "LOOKUP_SUCCEEDED" : "LOOKUP_FAILED", workspace.id, session.id, { destination });
      return send(res, 200, {
        candidates: matches,
        message: matches.length ? (matches.some((candidate) => candidate.current_edct_utc) ? "" : `Flight found in ${destination} feed, no active time.`) : "No matching flight found in destination feed."
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
      let deliveredCount = 0;
      for (const notificationId of notificationIds) {
        if (store.data.notification_events.some((n) => n.id === notificationId && n.workspace_id === workspace.id)) {
          store.insert("notification_deliveries", {
            notification_event_id: notificationId,
            session_id: session.id,
            delivery_state: sanitizeText(body.delivery_state || "delivered", 20),
            attempted_at: nowIso(),
            delivered_at: body.delivery_state === "failed" ? null : nowIso()
          });
          deliveredCount += body.delivery_state === "failed" ? 0 : 1;
        }
      }
      if (deliveredCount) store.usage("NOTIFICATION_DELIVERED", workspace.id, session.id, { count: deliveredCount });
      return send(res, 200, { ok: true });
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

function adminSummary() {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const activeSince = now - config.activeSessionThresholdSeconds * 1000;
  const sleepCutoff = now - config.idleSleepMinutes * 60 * 1000;
  const activeFlights = store.data.flights.filter((f) => f.active);
  const activeSessionsNow = store.data.sessions.filter((s) => sessionActiveMs(s) >= activeSince).length;
  const hasRecentSession = store.data.sessions.some((s) => sessionActiveMs(s) >= sleepCutoff);
  const destinationCounts = countBy(activeFlights.map((f) => f.destination).filter(Boolean));
  const prefixCounts = countBy(activeFlights.map((f) => callsignPrefix(f.normalized_acid || f.display_flight_number)).filter(Boolean));
  const airports = Object.keys(destinationCounts).sort();
  const snapshotByAirport = latestSnapshotsByAirport(store.data.source_airport_snapshots);
  const sourceHealthByAirport = airports.map((airport) => adminAirportHealth(airport, snapshotByAirport.get(airport)));
  const staleAirports = sourceHealthByAirport
    .filter((item) => item.state !== "healthy")
    .map((item) => item.airport);
  const latestSessionSeenAt = latestDate(store.data.sessions.map((s) => s.last_seen_at));
  const latestUserEventAt = latestDate(store.data.usage_events.map((event) => event.created_at));
  const latestFetchAt = latestDate(store.data.source_airport_snapshots.map((snapshot) => snapshot.fetched_at));
  const sleeping = !hasRecentSession && activeFlights.length === 0;
  const degraded = sourceHealthByAirport.some((item) => item.state === "degraded" || item.state === "failed");
  const profiles = adminProfiles(activeSince);
  const lastActivityAt = latestDate([
    latestSessionSeenAt,
    latestUserEventAt,
    ...store.data.flights.map((f) => f.updated_at || f.created_at)
  ]);

  return {
    backendState: degraded ? "degraded" : sleeping ? "sleeping" : "awake",
    activeSessionsNow,
    sessionsToday: store.data.sessions.filter((s) => dateMs(s.created_at) >= todayMs || dateMs(s.last_seen_at) >= todayMs).length,
    uniqueProfilesToday: store.data.sessions.filter((s) => dateMs(s.created_at) >= todayMs || dateMs(s.last_seen_at) >= todayMs || dateMs(s.last_heartbeat_at) >= todayMs).length,
    flightsWatchedNow: activeFlights.length,
    flightsWatchedToday: store.data.flights.filter((f) => dateMs(f.created_at) >= todayMs || dateMs(f.updated_at) >= todayMs).length,
    airportsWatched: airports.length,
    topDestinations: Object.entries(destinationCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([airport, count]) => ({ airport, count })),
    topCallsignPrefixes: countedList(prefixCounts, "prefix", 10),
    likelyOperatorSignals: likelyOperatorSignals(prefixCounts, destinationCounts),
    alertsGeneratedToday: store.data.edct_events.filter((event) => dateMs(event.created_at) >= todayMs).length,
    notificationsDeliveredToday: store.data.notification_deliveries.filter((delivery) => delivery.delivery_state === "delivered" && dateMs(delivery.delivered_at || delivery.attempted_at) >= todayMs).length,
    lookupFailuresToday: store.data.usage_events.filter((event) =>
      dateMs(event.created_at) >= todayMs &&
      (event.event_type === "LOOKUP_FAILED" || event.event_type === "FLIGHT_LOOKUP_FAILED")
    ).length,
    sourceHealthByAirport,
    staleAirports,
    lastUserQueryAt: latestUserEventAt,
    lastHeartbeatAt: latestSessionSeenAt,
    lastFaaFetchAt: latestFetchAt,
    nextSleepAt: !sleeping && activeFlights.length === 0 && lastActivityAt ? new Date(dateMs(lastActivityAt) + config.idleSleepMinutes * 60 * 1000).toISOString() : null,
    lastSleepAt: sleeping && lastActivityAt ? new Date(dateMs(lastActivityAt) + config.idleSleepMinutes * 60 * 1000).toISOString() : null,
    lastWakeAt: sleeping ? null : lastActivityAt,
    recentAdminEvents: recentAdminEvents(),
    activeProfiles: profiles.filter((profile) => profile.activeNow).slice(0, 25),
    recentProfiles: profiles.slice(0, 50),
    securitySummary: securitySummary(todayMs)
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function dateMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestDate(values) {
  const latest = values
    .filter(Boolean)
    .map((value) => ({ value, ms: dateMs(value) }))
    .filter((item) => item.ms > 0)
    .sort((a, b) => b.ms - a.ms)[0];
  return latest?.value || null;
}

function sessionActiveMs(session) {
  return Math.max(dateMs(session.last_heartbeat_at), dateMs(session.last_activity_at), dateMs(session.last_seen_at));
}

function countedList(counts, key = "name", limit = 10) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ [key]: value, count }));
}

function callsignPrefix(value) {
  const prefix = String(value || "").toUpperCase().match(/^[A-Z]{2,4}/)?.[0] || "";
  return prefix;
}

function likelyOperatorSignals(prefixCounts, destinationCounts) {
  const signals = countedList(prefixCounts, "signal", 5).map((item) => ({ signal: `${item.signal}-heavy`, count: item.count }));
  if (!signals.length && Object.keys(destinationCounts).length) return [{ signal: "destination-pattern-only", count: Object.keys(destinationCounts).length }];
  return signals.length ? signals : [{ signal: "unknown", count: 0 }];
}

function latestSnapshotsByAirport(snapshots) {
  const latest = new Map();
  for (const snapshot of snapshots) {
    const airport = sanitizeAirportForAdmin(snapshot.airport);
    if (!airport) continue;
    const existing = latest.get(airport);
    if (!existing || dateMs(snapshot.fetched_at) > dateMs(existing.fetched_at)) latest.set(airport, snapshot);
  }
  return latest;
}

function adminAirportHealth(airport, snapshot) {
  if (!snapshot) {
    return { airport, state: "unknown", detail: "No recent fetch", lastFetchAt: null };
  }
  const ageMinutes = Math.round((Date.now() - dateMs(snapshot.fetched_at)) / 60000);
  if (!snapshot.success) {
    return {
      airport,
      state: "failed",
      detail: "Last fetch failed",
      lastFetchAt: snapshot.fetched_at || null
    };
  }
  if (ageMinutes > Math.max(10, config.pollMinutes * 3)) {
    return {
      airport,
      state: "stale",
      detail: "Cache is stale",
      lastFetchAt: snapshot.fetched_at || null
    };
  }
  return {
    airport,
    state: "healthy",
    detail: null,
    lastFetchAt: snapshot.fetched_at || null
  };
}

function sanitizeAirportForAdmin(value) {
  const airport = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3,4}$/.test(airport) ? airport : "";
}

function recentAdminEvents() {
  const usageEvents = store.data.usage_events.map((event) => ({
    createdAt: event.created_at,
    message: adminUsageMessage(event)
  }));
  const edctEvents = store.data.edct_events.map((event) => ({
    createdAt: event.created_at,
    message: sanitizeText(event.message || event.event_type || "EDCT event", 120)
  }));
  return [...usageEvents, ...edctEvents]
    .filter((event) => event.createdAt && event.message)
    .sort((a, b) => dateMs(b.createdAt) - dateMs(a.createdAt))
    .slice(0, 20);
}

function adminProfiles(activeSince) {
  return store.data.sessions
    .map((session) => adminProfile(session, activeSince))
    .sort((a, b) => dateMs(b.lastSeenAt) - dateMs(a.lastSeenAt));
}

function adminProfile(session, activeSince) {
  const workspaceFlights = store.data.flights.filter((f) => f.workspace_id === session.workspace_id && f.active);
  const usage = store.data.usage_events.filter((event) => event.session_id === session.id);
  const destinationCounts = countBy(workspaceFlights.map((f) => f.destination).filter(Boolean));
  const prefixCounts = countBy(workspaceFlights.map((f) => callsignPrefix(f.normalized_acid || f.display_flight_number)).filter(Boolean));
  const profileActiveMs = sessionActiveMs(session);
  const device = parseDevice(session.user_agent_approx);
  return {
    shortSessionId: shortOpaqueId(session.id),
    firstSeenAt: session.created_at || null,
    lastSeenAt: latestDate([session.last_seen_at, session.last_activity_at, session.last_heartbeat_at]),
    lastHeartbeatAt: session.last_heartbeat_at || null,
    activeNow: profileActiveMs >= activeSince,
    sessionAge: sessionAgeLabel(session.created_at),
    approximateDevice: device.device,
    browser: device.browser,
    platform: device.platform,
    timezone: session.timezone || "",
    country: session.country || "",
    region: session.region || "",
    city: session.city || "",
    asn: session.asn || "",
    organization: session.organization || "",
    totalPageLoads: session.page_load_count || usage.filter((event) => event.event_type === "PAGE_OR_SESSION_LOAD").length,
    totalLookups: usage.filter((event) => event.event_type === "LOOKUP_ATTEMPTED").length,
    failedLookups: usage.filter((event) => event.event_type === "LOOKUP_FAILED" || event.event_type === "FLIGHT_LOOKUP_FAILED").length,
    flightsAdded: usage.filter((event) => event.event_type === "FLIGHT_ADDED").length,
    flightsDeleted: usage.filter((event) => event.event_type === "FLIGHT_DELETED").length,
    currentWatchedFlightsCount: workspaceFlights.length,
    currentWatchedFlights: workspaceFlights.slice(0, 25).map(adminWatchedFlight),
    topDestinations: countedList(destinationCounts, "airport", 8),
    topCallsignPrefixes: countedList(prefixCounts, "prefix", 8),
    alertsGenerated: usage.filter((event) => event.event_type === "EDCT_EVENT_GENERATED").length,
    notificationsDelivered: notificationDeliveriesForSession(session.id),
    typicalActiveHoursLocal: typicalActiveHours(usage),
    inferredUserType: inferredUserType(workspaceFlights.length),
    likelyOperatorSignals: likelyOperatorSignals(prefixCounts, destinationCounts)
  };
}

function shortOpaqueId(sessionId) {
  return crypto.createHash("sha256").update(String(sessionId || "")).digest("hex").slice(0, 6).toUpperCase();
}

function parseDevice(userAgent) {
  const ua = String(userAgent || "");
  const platform = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/i.test(ua) ? "Android" : /Mac/i.test(ua) ? "macOS" : /Windows/i.test(ua) ? "Windows" : "unknown";
  const device = /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) ? "iPad" : /Android/i.test(ua) ? "Android" : /Mac/i.test(ua) ? "Mac" : /Windows/i.test(ua) ? "Windows" : "unknown";
  const browser = /Edg/i.test(ua) ? "Edge" : /Firefox/i.test(ua) ? "Firefox" : /CriOS|Chrome/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : "unknown";
  return { device, browser, platform };
}

function sessionAgeLabel(createdAt) {
  const ageMs = Date.now() - dateMs(createdAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return "";
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function adminWatchedFlight(flight) {
  const state = store.data.edct_flight_states.find((s) => s.flight_id === flight.id);
  return {
    flightNumber: flight.display_flight_number,
    route: `${flight.origin}-${flight.destination}`,
    currentEdctUtc: state?.current_edct_utc || null,
    change: state?.last_change || "UNCHANGED"
  };
}

function notificationDeliveriesForSession(sessionId) {
  return store.data.notification_deliveries.filter((delivery) => delivery.session_id === sessionId && delivery.delivery_state === "delivered").length;
}

function typicalActiveHours(usage) {
  const counts = countBy(usage.map((event) => {
    const date = new Date(event.created_at || "");
    return Number.isFinite(date.getTime()) ? `${String(date.getUTCHours()).padStart(2, "0")}Z` : "";
  }).filter(Boolean));
  return countedList(counts, "hour", 3);
}

function inferredUserType(flightCount) {
  if (flightCount >= 100) return "likely controller/router";
  if (flightCount >= 10 && flightCount <= 80) return "likely dispatcher";
  if (flightCount >= 1 && flightCount <= 2) return "likely pilot/casual";
  return "unknown";
}

function securitySummary(todayMs) {
  const regions = countBy(store.data.sessions.map((s) => [s.country, s.region].filter(Boolean).join("-")).filter(Boolean));
  const organizations = countBy(store.data.sessions.map((s) => s.organization).filter(Boolean));
  const asns = countBy(store.data.sessions.map((s) => s.asn).filter(Boolean));
  return {
    topRegions: countedList(regions, "region", 10),
    topOrganizations: countedList(organizations, "organization", 10),
    topASNs: countedList(asns, "asn", 10),
    suspiciousActivityCount: 0,
    rateLimitedCount: store.data.usage_events.filter((event) => event.event_type === "RATE_LIMITED" && dateMs(event.created_at) >= todayMs).length
  };
}

function adminUsageMessage(event) {
  const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const airport = sanitizeAirportForAdmin(metadata.destination || metadata.airport);
  const suffix = airport ? ` ${airport}` : "";
  switch (event.event_type) {
    case "SESSION_CREATED":
      return "Session created";
    case "PAGE_OR_SESSION_LOAD":
      return "Page loaded";
    case "FLIGHT_ADDED":
      return `Flight added${suffix}`;
    case "FLIGHT_EDITED":
      return `Flight edited${suffix}`;
    case "FLIGHT_DELETED":
      return `Flight deleted${suffix}`;
    case "MANUAL_REFRESH":
      return "Manual refresh";
    case "EDCT_EVENT_GENERATED":
      return `Alert generated${suffix}`;
    case "LOOKUP_FAILED":
    case "FLIGHT_LOOKUP_FAILED":
      return `Lookup failed${suffix}`;
    default:
      return sanitizeText(String(event.event_type || "Usage event").replaceAll("_", " ").toLowerCase(), 80);
  }
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
