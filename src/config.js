export const monitoredDestinations = new Set(
  (process.env.EDCT_MONITORED_DESTINATIONS || "LAX,SFO,DEN,DFW,IAH,ORD")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
);

export function clampPollMinutes(value = process.env.EDCT_POLL_INTERVAL_MINUTES || "5") {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(30, parsed));
}

export const config = {
  port: Number.parseInt(process.env.PORT || "3000", 10),
  dbFile: process.env.EDCT_DB_FILE || "./data/edct-db.json",
  pollMinutes: clampPollMinutes(),
  idleSleepMinutes: Math.max(1, Number.parseInt(process.env.EDCT_IDLE_SLEEP_MINUTES || "30", 10) || 30),
  activeSessionThresholdSeconds: Math.max(60, Number.parseInt(process.env.EDCT_ACTIVE_SESSION_THRESHOLD_SECONDS || "180", 10) || 180),
  adminToken: process.env.ADMIN_TOKEN || process.env.SADIOM_ADMIN_TOKEN || "",
  allowedOrigins: (process.env.EDCT_ALLOWED_ORIGINS || "https://sadiom.com,http://localhost:3000,http://localhost:3001,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  source: {
    url: process.env.EDCT_SOURCE_URL || "",
    method: (process.env.EDCT_SOURCE_METHOD || "GET").toUpperCase(),
    token: process.env.EDCT_SOURCE_TOKEN || "",
    timeoutMs: Number.parseInt(process.env.EDCT_SOURCE_TIMEOUT_MS || "10000", 10),
    cacheTtlSeconds: Math.max(15, Number.parseInt(process.env.EDCT_AIRPORT_CACHE_TTL_SECONDS || "60", 10) || 60)
  }
};
