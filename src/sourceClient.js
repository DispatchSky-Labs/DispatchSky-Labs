import { config } from "./config.js";
import { normalizeSourceRecord, sanitizeText } from "./edctCore.js";

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

export async function fetchSourceForAirport(airport, referenceIso) {
  if (!config.source.url) {
    return { success: true, airport, fetched_at: new Date().toISOString(), records: [], record_count: 0 };
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
    if (!response.ok) throw noSecretError();
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
    return { success: true, airport, fetched_at: new Date().toISOString(), records, record_count: records.length };
  } catch {
    return {
      success: false,
      airport,
      fetched_at: new Date().toISOString(),
      records: [],
      record_count: 0,
      error_message: sanitizeText(noSecretError().message, 80)
    };
  } finally {
    clearTimeout(timeout);
  }
}
