import { config } from "./config.js";
import { normalizeSourceRecord, sanitizeText } from "./edctCore.js";

const airportCache = new Map();
const sourceMetrics = new Map();

export function resetSourceCachesForTests() {
  if (process.env.NODE_ENV !== "test") return;
  airportCache.clear();
  sourceMetrics.clear();
}

function noSecretError() {
  return new Error("EDCT source fetch failed.");
}

function recordsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.edct)) return payload.edct;
  if (Array.isArray(payload.flights)) return payload.flights;
  if (Array.isArray(payload.timeBuckets)) return payload.timeBuckets.flatMap((bucket) => Array.isArray(bucket.flights) ? bucket.flights : []);
  return [];
}

function sourceUrlForAirport(airport) {
  const configured = config.source.url;
  if (!configured) return "";
  const lowerAirport = airport.toLowerCase();
  if (configured.includes("{airport}")) return configured.replaceAll("{airport}", lowerAirport);
  if (configured.includes("{AIRPORT}")) return configured.replaceAll("{AIRPORT}", airport);
  const url = new URL(configured);
  const parts = url.pathname.split("/");
  const last = parts[parts.length - 1] || "";
  if (/^[a-z]{3}$/i.test(last)) {
    parts[parts.length - 1] = lowerAirport;
    url.pathname = parts.join("/");
    return url.toString();
  }
  url.searchParams.set("airport", airport);
  return url.toString();
}

function backoffMs(entry, status = 0, errorClass = "") {
  const failures = entry?.consecutive_failures || 1;
  const aggressive = status === 403 || status === 429 || errorClass === "timeout";
  if (aggressive) {
    if (failures === 1) return 5 * 60_000;
    return 15 * 60_000;
  }
  if (failures === 1) return 2 * 60_000;
  if (failures === 2) return 5 * 60_000;
  return 15 * 60_000;
}

function publicSnapshotFromEntry(airport, entry, stale = false) {
  return {
    success: Boolean(entry?.records),
    stale,
    degraded: stale || Boolean(entry?.last_error_message),
    airport,
    fetched_at: entry?.last_successful_fetch_at || entry?.last_attempted_fetch_at || new Date().toISOString(),
    records: entry?.records || [],
    record_count: entry?.records?.length || 0,
    last_successful_fetch_at: entry?.last_successful_fetch_at || null,
    last_attempted_fetch_at: entry?.last_attempted_fetch_at || null,
    consecutive_failures: entry?.consecutive_failures || 0,
    error_message: entry?.last_error_message || ""
  };
}

function cacheEntry(airport) {
  if (!airportCache.has(airport)) {
    airportCache.set(airport, {
      records: null,
      last_successful_fetch_at: null,
      last_attempted_fetch_at: null,
      last_error_message: "",
      consecutive_failures: 0,
      next_retry_at: 0,
      inflight: null
    });
  }
  return airportCache.get(airport);
}

function metricEntry(airport) {
  if (!sourceMetrics.has(airport)) {
    sourceMetrics.set(airport, {
      airport,
      fetchCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failures: 0,
      inFlightDedupeCount: 0,
      lastFetchAt: null,
      lastFetchReason: null,
      fetchEvents: []
    });
  }
  return sourceMetrics.get(airport);
}

function metricEvent(entry, reason, success) {
  const at = new Date().toISOString();
  entry.fetchEvents.push({ at, reason, success });
  if (entry.fetchEvents.length > 1000) entry.fetchEvents.splice(0, entry.fetchEvents.length - 1000);
}

async function retrieveAirport(airport, referenceIso, entry) {
  const attemptedAt = new Date().toISOString();
  entry.last_attempted_fetch_at = attemptedAt;
  if (!config.source.url) {
    entry.records = [];
    entry.last_successful_fetch_at = attemptedAt;
    entry.last_error_message = "";
    entry.consecutive_failures = 0;
    entry.next_retry_at = 0;
    return publicSnapshotFromEntry(airport, entry, false);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.source.timeoutMs);
  try {
    const url = sourceUrlForAirport(airport);
    const headers = { accept: "application/json" };
    if (config.source.token) headers.authorization = `Bearer ${config.source.token}`;
    const response = await fetch(url, {
      method: config.source.method === "POST" ? "POST" : "GET",
      headers,
      body: config.source.method === "POST" ? JSON.stringify({ airport }) : undefined,
      signal: controller.signal
    });
    if (!response.ok) {
      const error = noSecretError();
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    const records = recordsFromPayload(payload)
      .map((record) => {
        try {
          return normalizeSourceRecord(record, referenceIso);
        } catch {
          return null;
        }
      })
      .filter((record) => record && record.destination === airport);
    const fetchedAt = new Date().toISOString();
    entry.records = records;
    entry.last_successful_fetch_at = fetchedAt;
    entry.last_error_message = "";
    entry.consecutive_failures = 0;
    entry.next_retry_at = 0;
    return publicSnapshotFromEntry(airport, entry, false);
  } catch (error) {
    const errorClass = error?.name === "AbortError" ? "timeout" : "fetch";
    entry.consecutive_failures = (entry.consecutive_failures || 0) + 1;
    entry.last_error_message = sanitizeText(noSecretError().message, 80);
    entry.next_retry_at = Date.now() + backoffMs(entry, error?.status || 0, errorClass);
    return entry.records
      ? publicSnapshotFromEntry(airport, entry, true)
      : {
          success: false,
          stale: false,
          degraded: true,
          airport,
          fetched_at: attemptedAt,
          records: [],
          record_count: 0,
          last_successful_fetch_at: null,
          last_attempted_fetch_at: attemptedAt,
          consecutive_failures: entry.consecutive_failures,
          error_message: entry.last_error_message
        };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSourceForAirport(airport, referenceIso, options = {}) {
  const entry = cacheEntry(airport);
  const metrics = metricEntry(airport);
  const reason = sanitizeText(options.reason || (options.force ? "manual_refresh" : "unknown"), 40);
  const now = Date.now();
  const ttlMs = config.source.cacheTtlSeconds * 1000;
  if (!options.force && entry.next_retry_at && now < entry.next_retry_at) {
    metrics.cacheMisses += 1;
    return entry.records ? publicSnapshotFromEntry(airport, entry, true) : {
      success: false,
      stale: false,
      degraded: true,
      airport,
      fetched_at: entry.last_attempted_fetch_at || new Date().toISOString(),
      records: [],
      record_count: 0,
      last_successful_fetch_at: null,
      last_attempted_fetch_at: entry.last_attempted_fetch_at || null,
      consecutive_failures: entry.consecutive_failures || 0,
      error_message: entry.last_error_message || sanitizeText(noSecretError().message, 80)
    };
  }
  if (!options.force && entry.records && entry.last_successful_fetch_at && now - new Date(entry.last_successful_fetch_at).getTime() <= ttlMs) {
    metrics.cacheHits += 1;
    return publicSnapshotFromEntry(airport, entry, false);
  }
  metrics.cacheMisses += 1;
  if (!entry.inflight) {
    metrics.fetchCount += 1;
    metrics.lastFetchAt = new Date().toISOString();
    metrics.lastFetchReason = reason;
    entry.inflight = retrieveAirport(airport, referenceIso, entry).then((snapshot) => {
      if (!snapshot.success || snapshot.stale) metrics.failures += 1;
      metricEvent(metrics, reason, snapshot.success && !snapshot.stale);
      return snapshot;
    }).finally(() => {
      entry.inflight = null;
    });
  } else {
    metrics.inFlightDedupeCount += 1;
  }
  return entry.inflight;
}

export function airportCacheHealth(airport) {
  const entry = airportCache.get(airport);
  return publicSnapshotFromEntry(airport, entry, Boolean(entry?.last_error_message));
}

export function sourceEfficiencySnapshot(airports = []) {
  const names = new Set([...airports, ...sourceMetrics.keys(), ...airportCache.keys()].filter(Boolean));
  const now = Date.now();
  const hourAgo = now - 60 * 60_000;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const byAirport = [...names].sort().map((airport) => {
    const metrics = metricEntry(airport);
    const cache = airportCache.get(airport);
    const lastSuccessMs = Date.parse(cache?.last_successful_fetch_at || "");
    const events = metrics.fetchEvents || [];
    return {
      airport,
      fetchCount: metrics.fetchCount,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses,
      failures: metrics.failures,
      inFlightDedupeCount: metrics.inFlightDedupeCount,
      lastFetchAt: metrics.lastFetchAt,
      lastFetchReason: metrics.lastFetchReason,
      cacheAgeSeconds: Number.isFinite(lastSuccessMs) ? Math.max(0, Math.round((now - lastSuccessMs) / 1000)) : null,
      fetchesLastHour: events.filter((event) => Date.parse(event.at) >= hourAgo).length,
      fetchesToday: events.filter((event) => Date.parse(event.at) >= todayMs).length
    };
  });
  return {
    byAirport,
    estimatedSourceRequestsLastHour: byAirport.reduce((sum, item) => sum + item.fetchesLastHour, 0),
    estimatedSourceRequestsToday: byAirport.reduce((sum, item) => sum + item.fetchesToday, 0)
  };
}
