const state = { flights: [], shadow: null, status: null };
const API_BASE_URL = String(window.EDCT_API_BASE_URL || "").replace(/\/+$/, "");
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      credentials: API_BASE_URL ? "include" : "same-origin",
      signal: controller.signal,
      ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function hhmmz(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

function timeText(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return `${hhmmz(iso)} ${d.toISOString().slice(0, 10)}`;
}

function conditionText(conditions = []) {
  if (!conditions.length) return "No active GDP/GS";
  return conditions.map((condition) => ({
    groundDelayProgram: "GDP",
    groundStop: "Ground stop",
    airportClosure: "Airport closure"
  }[condition] || condition)).join(", ");
}

function renderWarning(message = "") {
  $("warningBanner").textContent = message;
  $("warningBanner").hidden = !message;
}

function render() {
  const shadowFlights = state.shadow?.flights || [];
  const nas = state.shadow?.nas || {};
  $("sourceStatus").textContent = nas.ok
    ? `NAS/OIS OK. Fetched ${timeText(nas.fetched_at)}.`
    : `NAS/OIS unavailable. ${nas.error || "Checking..."}`;

  const airports = new Set(shadowFlights.map((flight) => flight.destination)).size;
  $("summaryStats").innerHTML = `
    <div><strong>${shadowFlights.length}</strong><span>tracked</span></div>
    <div><strong>${airports}</strong><span>airports</span></div>
    <div><strong>${nas.ok ? "OK" : "CHECK"}</strong><span>NAS/OIS</span></div>
  `;

  $("betaRows").innerHTML = shadowFlights.map((item) => {
    const beta = item.beta_interpretation || {};
    const aadc = item.aadc || {};
    const nasState = item.nas || {};
    return `<article class="beta-row">
      <div class="beta-head">
        <div>
          <strong>${escapeHtml(item.flight)} ${escapeHtml(item.origin)}-${escapeHtml(item.destination)}</strong>
          <div class="beta-note">Last checked ${escapeHtml(timeText(item.last_checked_utc))}</div>
        </div>
        <span class="beta-pill ${escapeHtml(beta.severity || "unknown")}">${escapeHtml(beta.label || "Checking...")}</span>
      </div>
      <div class="beta-meta">
        <div><span>AADC state</span><strong>${escapeHtml(aadc.status || "unknown")} ${escapeHtml(aadc.current_edct_display || "")}</strong></div>
        <div><span>NAS airport program</span><strong>${escapeHtml(conditionText(nasState.conditions))}</strong></div>
        <div><span>Old/live interpretation</span><strong>${escapeHtml(item.old_interpretation?.label || "Unknown")}</strong></div>
        <div><span>New/beta interpretation</span><strong>${escapeHtml(beta.label || "Checking...")}</strong></div>
        <div><span>AADC timestamp</span><strong>${escapeHtml(timeText(aadc.source_snapshot_at || aadc.last_source_fetch_at))}</strong></div>
        <div><span>NAS timestamp</span><strong>${escapeHtml(timeText(nasState.fetched_at))}</strong></div>
      </div>
      <p class="beta-note">${escapeHtml(beta.reason || "")}</p>
    </article>`;
  }).join("") || `<div class="empty">No tracked flights found for this session.</div>`;
}

async function loadAll() {
  $("refreshBtn").disabled = true;
  renderWarning("");
  try {
    const [flights, status, shadow] = await Promise.all([
      api("/api/flights"),
      api("/api/edct/status"),
      api("/api/edct/nas-shadow")
    ]);
    state.flights = flights.flights || [];
    state.status = status;
    state.shadow = shadow;
    render();
  } catch (error) {
    renderWarning(error.message || "Beta diagnostics unavailable.");
  } finally {
    $("refreshBtn").disabled = false;
  }
}

$("refreshBtn").addEventListener("click", loadAll);
loadAll();
setInterval(loadAll, 60_000);

