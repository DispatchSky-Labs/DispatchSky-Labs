export function relativeAge(iso, now = Date.now()) {
  const timestamp = Date.parse(iso || "");
  if (!Number.isFinite(timestamp)) return "unavailable";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 30) return "just now";
  if (seconds < 90) return "1m ago";
  if (seconds < 60 * 60) return `${Math.min(59, Math.round(seconds / 60))}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function freshnessView(status, now = Date.now()) {
  const sources = Array.isArray(status?.sources) ? status.sources : [];
  const datedSources = sources
    .map((source) => ({ ...source, timestamp: Date.parse(source.last_successful_update_utc || "") }))
    .filter((source) => Number.isFinite(source.timestamp));
  const firstMissing = sources.find((source) => !source.last_successful_update_utc) || null;
  const oldest = datedSources.sort((a, b) => a.timestamp - b.timestamp)[0] || null;
  const oldestAgeMinutes = oldest ? Math.max(0, (now - oldest.timestamp) / 60000) : Infinity;
  const level = firstMissing || oldestAgeMinutes >= 15 ? "hard-stale" : oldestAgeMinutes >= 5 ? "warning" : "healthy";
  if (!sources.length) {
    return {
      level: "healthy",
      text: status?.last_updated_utc ? `Updated ${relativeAge(status.last_updated_utc, now)}` : "Waiting for tracked hub data"
    };
  }
  const prefix = level === "hard-stale" ? "Data may be stale" : `Updated ${relativeAge(status?.last_updated_utc, now)}`;
  const oldestText = firstMissing
    ? `Oldest hub ${firstMissing.airport} unavailable`
    : oldest ? `Oldest hub ${oldest.airport} ${relativeAge(oldest.last_successful_update_utc, now)}` : "Oldest hub unavailable";
  return { level, text: `${prefix} · ${oldestText}` };
}
