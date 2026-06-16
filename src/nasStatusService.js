import { sanitizeText } from "./edctCore.js";

const DEFAULT_NAS_STATUS_URL = "https://www.fly.faa.gov/ois/oisedit/summary_pub";
const CONDITION_TYPES = {
  GDP: "groundDelayProgram",
  GROUND_STOP: "groundStop",
  AIRPORT_CLOSURE: "airportClosure"
};

let cache = {
  fetchedAt: null,
  expiresAt: 0,
  result: null,
  inflight: null
};

export function resetNasStatusCacheForTests() {
  if (process.env.NODE_ENV !== "test") return;
  cache = {
    fetchedAt: null,
    expiresAt: 0,
    result: null,
    inflight: null
  };
}

function nasConfig() {
  return {
    enabled: String(process.env.NAS_SHADOW_ENABLED || "true").toLowerCase() !== "false",
    url: process.env.NAS_STATUS_URL || DEFAULT_NAS_STATUS_URL,
    timeoutMs: Math.max(1000, Number.parseInt(process.env.NAS_STATUS_TIMEOUT_MS || "10000", 10) || 10000),
    cacheTtlMs: Math.max(15, Number.parseInt(process.env.NAS_STATUS_CACHE_TTL_SECONDS || "60", 10) || 60) * 1000
  };
}

export async function fetchNasStatus(options = {}) {
  const cfg = nasConfig();
  if (!cfg.enabled) {
    return safeFailure("NAS shadow mode disabled.", "disabled");
  }

  const now = Date.now();
  if (!options.force && cache.result && cache.expiresAt > now) return cache.result;
  if (cache.inflight) return cache.inflight;

  cache.inflight = retrieveNasStatus(cfg)
    .then((result) => {
      cache.result = result;
      cache.fetchedAt = result.fetchedAt;
      cache.expiresAt = Date.now() + cfg.cacheTtlMs;
      return result;
    })
    .finally(() => {
      cache.inflight = null;
    });

  return cache.inflight;
}

async function retrieveNasStatus(cfg) {
  const attemptedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(cfg.url, {
      headers: { accept: "text/html,application/xml,text/xml;q=0.9,*/*;q=0.8" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`FAA NAS status fetch failed (${response.status}).`);
    const text = await response.text();
    const conditions = parseNasStatusSummary(text);
    const fetchedAt = new Date().toISOString();
    return {
      ok: true,
      fetchedAt,
      attemptedAt,
      source: "FAA_OIS",
      conditions,
      error: ""
    };
  } catch (error) {
    return safeFailure(error?.name === "AbortError" ? "FAA NAS status fetch timed out." : error?.message, "fetch", attemptedAt);
  } finally {
    clearTimeout(timeout);
  }
}

function safeFailure(message = "FAA NAS status unavailable.", errorClass = "fetch", attemptedAt = new Date().toISOString()) {
  return {
    ok: false,
    fetchedAt: cache.result?.fetchedAt || null,
    attemptedAt,
    source: "FAA_OIS",
    conditions: cache.result?.conditions || {},
    error: sanitizeText(message || "FAA NAS status unavailable.", 120),
    errorClass
  };
}

export function parseNasStatusSummary(raw) {
  const text = String(raw || "");
  const htmlSnapshot = parseSummaryHtml(text);
  if (Object.keys(htmlSnapshot).length) return htmlSnapshot;
  return parseSummaryXml(text);
}

function parseSummaryHtml(html) {
  const normalized = html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&");

  let section = "";
  const snapshot = {};
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "NATIONAL PROGRAMS") {
      section = CONDITION_TYPES.GDP;
      continue;
    }
    if (upper === "GROUND STOPS") {
      section = CONDITION_TYPES.GROUND_STOP;
      continue;
    }
    if (upper === "AIRPORT CLOSURES") {
      section = CONDITION_TYPES.AIRPORT_CLOSURE;
      continue;
    }
    if (["DELAY INFO", "DEICING", "RUNWAY/EQUIPMENT INFO", "RUNWAY/EQUIPMENT INFO IMAGE: HELP", "MISCELLANEOUS"].includes(upper)) {
      section = "";
      continue;
    }
    if (!section) continue;
    const airport = airportCodeFromSummaryLine(upper);
    if (!airport) continue;
    if (section === CONDITION_TYPES.AIRPORT_CLOSURE && !isRelevantClosureReason(line)) continue;
    addCondition(snapshot, airport, section);
  }

  return finalizeSnapshot(snapshot);
}

function parseSummaryXml(xml) {
  const snapshot = {};
  const delayBlocks = xml.match(/<Delay_type\b[\s\S]*?<\/Delay_type>/gi) || [];
  for (const block of delayBlocks) {
    const name = textForTag(block, "Name").toUpperCase();
    const condition = conditionFromDelayType(name);
    if (!condition) continue;
    const itemTag = condition === CONDITION_TYPES.GROUND_STOP ? "Ground_Stop" : condition === CONDITION_TYPES.GDP ? "Ground_Delay" : "Airport";
    const itemBlocks = block.match(new RegExp(`<${itemTag}\\b[\\s\\S]*?<\\/${itemTag}>`, "gi")) || [];
    for (const item of itemBlocks) {
      const airport = normalizeAirportCode(textForTag(item, "ARPT"));
      if (!airport) continue;
      if (condition === CONDITION_TYPES.AIRPORT_CLOSURE && !isRelevantClosureReason(textForTag(item, "Reason"))) continue;
      addCondition(snapshot, airport, condition);
    }
  }
  return finalizeSnapshot(snapshot);
}

function textForTag(block, tag) {
  const match = String(block || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeEntities(match?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"");
}

function conditionFromDelayType(name) {
  if (name.includes("AIRPORT CLOSURES")) return CONDITION_TYPES.AIRPORT_CLOSURE;
  if (name.includes("GROUND STOPS") || name.includes("GROUND STOP")) return CONDITION_TYPES.GROUND_STOP;
  if (name.includes("GROUND DELAY PROGRAMS") || name.includes("GROUND DELAY PROGRAM")) return CONDITION_TYPES.GDP;
  return "";
}

function airportCodeFromSummaryLine(line) {
  const first = String(line || "").split(" ")[0] || "";
  const ignored = new Set(["ARPT", "TIME", "DATE", "PROGRAM", "NAME", "START", "END", "SCOPE", "REASON", "UPDATE", "POE", "AVG", "AAR", "ADVZY", "FACILITY", "DESCRIPTION"]);
  if (ignored.has(first)) return "";
  return normalizeAirportCode(first);
}

function normalizeAirportCode(value) {
  const code = String(value || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!/^[A-Z]{3,4}$/.test(code)) return "";
  return code.length === 4 && code.startsWith("K") ? code.slice(1) : code;
}

function isRelevantClosureReason(reason) {
  const upper = String(reason || "").toUpperCase();
  if (!upper) return true;
  return ![
    "NON SKED TRANSIENT",
    "NON-SKED TRANSIENT",
    "NON SCHEDULED TRANSIENT",
    "NON-SCHEDULED TRANSIENT",
    "NON SKED TRANSIENT GA ACFT",
    "NON SCHEDULED TRANSIENT GA ACFT"
  ].some((phrase) => upper.includes(phrase));
}

function addCondition(snapshot, airport, condition) {
  if (!snapshot[airport]) snapshot[airport] = new Set();
  snapshot[airport].add(condition);
}

function finalizeSnapshot(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([airport, conditions]) => [airport, [...conditions].sort()])
  );
}
