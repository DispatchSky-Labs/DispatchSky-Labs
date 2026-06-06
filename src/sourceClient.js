import { config } from "./config.js";
import { normalizeSourceRecord, sanitizeText } from "./edctCore.js";

const airportCache = new Map();

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
  const now = Date.now();
  const ttlMs = config.source.cacheTtlSeconds * 1000;
  if (!options.force && entry.records && entry.last_successful_fetch_at && now - new Date(entry.last_successful_fetch_at).getTime() <= ttlMs) {
    return publicSnapshotFromEntry(airport, entry, false);
  }
  if (!options.force && entry.next_retry_at && now < entry.next_retry_at) {
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
  if (!entry.inflight) {
    entry.inflight = retrieveAirport(airport, referenceIso, entry).finally(() => {
      entry.inflight = null;
    });
  }
  return entry.inflight;
}

export function airportCacheHealth(airport) {
  const entry = airportCache.get(airport);
  return publicSnapshotFromEntry(airport, entry, Boolean(entry?.last_error_message));
}
