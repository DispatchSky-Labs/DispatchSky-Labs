const STORAGE_KEY = "sadiom.flow.trackedFlights.v1";
const STORAGE_BACKUP_PREFIX = `${STORAGE_KEY}.backup`;
const state = { flights: [], events: [], session: null, status: null, pending: [], candidates: [], serverFlightKeys: [], deletedFlightKeys: new Set() };
const $ = (id) => document.getElementById(id);
const API_BASE_URL = String(window.EDCT_API_BASE_URL || "").replace(/\/+$/, "");
const pendingAdds = new Map();

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), method === "GET" ? 12_000 : 20_000);
  const headers = method === "GET" ? {} : { "content-type": "application/json" };
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers,
      signal: controller.signal,
      credentials: API_BASE_URL ? "include" : "same-origin",
      ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Unable to search. Try again.");
    throw error;
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

function storageAvailable() {
  try {
    const key = `${STORAGE_KEY}.probe`;
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function backupInvalidStorage(raw) {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(`${STORAGE_BACKUP_PREFIX}.${Date.now()}`, raw);
  } catch {
  }
}

function normalizeStoredFlight(flight) {
  const flightKey = String(flight?.flight_key || flight?.id || "").trim();
  const display = String(flight?.display_flight_number || flight?.flight_number || "").trim().toUpperCase();
  const origin = String(flight?.origin || "").trim().toUpperCase();
  const destination = String(flight?.destination || "").trim().toUpperCase();
  if (!flightKey || !display || !origin || !destination) return null;
  return {
    flight_key: flightKey,
    display_flight_number: display,
    origin,
    destination,
    etd_utc: flight?.etd_utc || null,
    state: flight?.state && typeof flight.state === "object" ? {
      current_edct_utc: flight.state.current_edct_utc || null,
      previous_edct_utc: flight.state.previous_edct_utc || null,
      last_change: flight.state.last_change || "UNCHANGED",
      last_checked_utc: flight.state.last_checked_utc || null
    } : null
  };
}

function migrateStoredState(payload) {
  if (Array.isArray(payload)) return { flights: payload.map(normalizeStoredFlight).filter(Boolean), deletedFlightKeys: [] };
  if (!payload || typeof payload !== "object") return { flights: [], deletedFlightKeys: [] };
  if (payload.version === 1 && Array.isArray(payload.flights)) {
    return {
      flights: payload.flights.map(normalizeStoredFlight).filter(Boolean),
      deletedFlightKeys: Array.isArray(payload.deleted_flight_keys) ? payload.deleted_flight_keys.map(String).slice(-100) : []
    };
  }
  if (Array.isArray(payload.trackedFlights)) {
    return { flights: payload.trackedFlights.map(normalizeStoredFlight).filter(Boolean), deletedFlightKeys: [] };
  }
  return { flights: [], deletedFlightKeys: [] };
}

function loadSavedState() {
  if (!storageAvailable()) return { flights: [], deletedFlightKeys: [] };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { flights: [], deletedFlightKeys: [] };
  try {
    return migrateStoredState(JSON.parse(raw));
  } catch {
    backupInvalidStorage(raw);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
    }
    return { flights: [], deletedFlightKeys: [] };
  }
}

function persistFlights() {
  if (!storageAvailable()) return;
  const flights = state.flights.map(normalizeStoredFlight).filter(Boolean);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      saved_at: new Date().toISOString(),
      flights,
      deleted_flight_keys: Array.from(state.deletedFlightKeys).slice(-100)
    }));
  } catch {
  }
}

function mergeServerFlights(serverFlights) {
  const savedOrder = new Map(state.flights.map((flight, index) => [flight.flight_key, index]));
  const savedByKey = new Map(state.flights.map((flight) => [flight.flight_key, flight]));
  const merged = (serverFlights || []).filter((flight) => !state.deletedFlightKeys.has(flight.flight_key)).map((flight) => {
    const saved = savedByKey.get(flight.flight_key);
    return saved ? { ...saved, ...flight, state: flight.state || saved.state || null } : flight;
  });
  merged.sort((a, b) => {
    const aOrder = savedOrder.has(a.flight_key) ? savedOrder.get(a.flight_key) : Number.MAX_SAFE_INTEGER;
    const bOrder = savedOrder.has(b.flight_key) ? savedOrder.get(b.flight_key) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
  return merged;
}

function localFlightFromCandidate(candidate) {
  return {
    flight_key: `local_${candidate.candidate_key}`,
    display_flight_number: candidate.flight_number,
    origin: candidate.origin,
    destination: candidate.destination,
    etd_utc: candidate.etd_utc || candidate.current_edct_utc || new Date().toISOString(),
    state: {
      current_edct_utc: candidate.current_edct_utc || null,
      previous_edct_utc: null,
      last_change: candidate.current_edct_utc ? "EDCT_ASSIGNED" : "UNCHANGED",
      last_checked_utc: null
    }
  };
}

function moveFlight(flightKey, direction) {
  const index = state.flights.findIndex((flight) => flight.flight_key === flightKey);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.flights.length) return;
  const [flight] = state.flights.splice(index, 1);
  state.flights.splice(target, 0, flight);
  persistFlights();
  renderFlights();
  renderStats();
}

function removeFlightLocally(flightKey) {
  const previousLength = state.flights.length;
  state.flights = state.flights.filter((flight) => flight.flight_key !== flightKey);
  if (state.flights.length === previousLength) return false;
  if (!flightKey.startsWith("local_")) state.deletedFlightKeys.add(flightKey);
  persistFlights();
  renderFlights();
  renderStats();
  return true;
}

function replaceLocalFlight(localKey, serverFlight) {
  const index = state.flights.findIndex((flight) => flight.flight_key === localKey);
  if (index < 0) return false;
  state.deletedFlightKeys.delete(serverFlight.flight_key);
  state.flights[index] = { ...state.flights[index], ...serverFlight, state: serverFlight.state || state.flights[index].state || null };
  persistFlights();
  renderFlights();
  renderStats();
  return true;
}

function toUtcFromLocal(value) {
  return value ? new Date(value).toISOString() : "";
}

function hhmmz(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

function minutesBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(a) - new Date(b)) / 60000);
}

function compactChange(flight) {
  const change = flight.state?.last_change || "UNCHANGED";
  const current = flight.state?.current_edct_utc;
  const previous = flight.state?.previous_edct_utc;
  if (state.status?.warning && !current) return { label: "STALE", className: "stale" };
  if (change === "EDCT_ASSIGNED") return { label: "NEW", className: "assigned" };
  if (change === "EDCT_REMOVED") return { label: "REMOVED", className: "removed" };
  if (change === "EDCT_WORSENED") {
    const delta = minutesBetween(current, previous);
    return { label: delta === null ? "LATER" : `+${Math.abs(delta)}m`, className: "worse" };
  }
  if (change === "EDCT_IMPROVED") {
    const delta = minutesBetween(previous, current);
    return { label: delta === null ? "IMPROVED" : `↑${Math.abs(delta)}m`, className: "better" };
  }
  return { label: "--", className: "same" };
}

function alertText(event) {
  return event.message || "Change detected.";
}

function render() {
  renderWarning();
  renderFlights();
  renderAlerts();
  renderStats();
  renderBadge();
}

function renderWarning() {
  const warning = state.status?.warning?.message || notificationWarning();
  $("warningBanner").textContent = warning || "";
  $("warningBanner").hidden = !warning;
}

function notificationWarning() {
  const status = notificationStatus();
  if (status.level === "warning") return status.message;
  return "";
}

function notificationStatus() {
  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const hasNotification = typeof window.Notification === "function" && typeof Notification.permission === "string";
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPush = "PushManager" in window;
  if (isIos && !standalone) {
    return { cta: "Enable alerts", level: "warning", message: "On iPhone, add Sadiom Flow to your Home Screen, then reopen it to enable alerts." };
  }
  if (!hasNotification) {
    return { cta: "Alerts unavailable", level: "warning", message: "Browser notifications are not available here. Keep this page open or use a supported browser." };
  }
  if (Notification.permission === "denied") {
    return { cta: "Alerts blocked", level: "warning", message: "Browser notifications are blocked. Enable them in browser settings or keep this page open." };
  }
  if (Notification.permission !== "granted") {
    return { cta: "Enable alerts", level: "info", message: hasServiceWorker && hasPush ? "Enable alerts. Alerts work while this page is open." : "Enable alerts. Alerts work while this page is open." };
  }
  return { cta: "Alerts on", level: "info", message: hasServiceWorker && hasPush ? "Alerts are enabled. Keep this page open for polling alerts." : "Alerts are enabled while this page is open." };
}

function renderFlights() {
  const rows = state.flights.map((flight, index) => {
    const change = compactChange(flight);
    const route = `${flight.origin}-${flight.destination}`;
    return `<div class="flight-row" data-flight="${escapeHtml(flight.flight_key)}" role="button" tabindex="0">
      <div class="reorder-controls" aria-label="Reorder ${escapeHtml(flight.display_flight_number)}">
        <button class="move-btn" data-move="${escapeHtml(flight.flight_key)}" data-direction="-1" type="button" aria-label="Move ${escapeHtml(flight.display_flight_number)} up" ${index === 0 ? "disabled" : ""}>Up</button>
        <button class="move-btn" data-move="${escapeHtml(flight.flight_key)}" data-direction="1" type="button" aria-label="Move ${escapeHtml(flight.display_flight_number)} down" ${index === state.flights.length - 1 ? "disabled" : ""}>Down</button>
      </div>
      <strong>${escapeHtml(flight.display_flight_number)}</strong>
      <span>${escapeHtml(route)}</span>
      <span class="edct">${escapeHtml(hhmmz(flight.state?.current_edct_utc))}</span>
      <span class="change ${change.className}">${escapeHtml(change.label)}</span>
      <button class="delete-btn" data-delete="${escapeHtml(flight.flight_key)}" type="button" aria-label="Remove ${escapeHtml(flight.display_flight_number)}">Remove</button>
    </div>`;
  }).join("");
  $("flightRows").innerHTML = rows || `<div class="empty">No watched flights. Add one and leave the page open for alerts.</div>`;
}

function renderAlerts() {
  const latest = state.events.slice(0, 3);
  $("recentAlerts").hidden = latest.length === 0;
  $("historyList").innerHTML = latest.map((event) => `<div class="alert-line">${escapeHtml(alertText(event))}</div>`).join("");
  $("alertsModalList").innerHTML = state.events.map((event) => `<div class="alert-line">${escapeHtml(alertText(event))}</div>`).join("") || `<div class="empty">No alerts yet.</div>`;
}

function renderStats() {
  const airports = new Set(state.flights.map((flight) => flight.destination)).size;
  $("quickStats").innerHTML = `
    <div><strong>${state.flights.length}</strong><span>watched</span></div>
    <div><strong>${airports}</strong><span>airports</span></div>
    <div><strong>${state.events.length}</strong><span>alerts</span></div>
  `;
}

function renderBadge() {
  const count = state.pending.length;
  $("alertBadge").hidden = count === 0;
  $("alertBadge").textContent = String(Math.min(count, 99));
  $("notifyBtn").title = notificationStatus().cta;
  $("notificationHelp").textContent = notificationStatus().message;
}

async function loadAll() {
  const previousFlights = state.flights;
  const session = await api("/api/session");
  const [flights, status, events] = await Promise.all([
    api("/api/flights"),
    api("/api/edct/status"),
    api("/api/edct/events")
  ]);
  state.session = session.session;
  const serverFlights = flights.flights || [];
  state.serverFlightKeys = serverFlights.map((flight) => flight.flight_key);
  state.flights = serverFlights.length ? mergeServerFlights(serverFlights) : previousFlights;
  state.status = status;
  state.events = events.events;
  persistFlights();
  render();
  reconcileSavedFlightsInBackground();
}

async function addFlight(values) {
  const localKey = `local_manual_${Date.now()}`;
  state.flights.push({
    flight_key: localKey,
    display_flight_number: String(values.flight_number || values.display_flight_number || "").toUpperCase(),
    origin: String(values.origin || "").toUpperCase(),
    destination: String(values.destination || "").toUpperCase(),
    etd_utc: values.etd || values.etd_utc || new Date().toISOString(),
    state: null
  });
  persistFlights();
  renderFlights();
  renderStats();
  closeAddPanel();
  try {
    const data = await api("/api/flights", { method: "POST", body: JSON.stringify(values) });
    if (data.flight) replaceLocalFlight(localKey, data.flight);
    scheduleLoadAll(1500);
  } catch (error) {
    removeFlightLocally(localKey);
    setLookupMessage(error.message || "Add failed.", true);
  }
}

function setLookupMessage(message, isError = false) {
  $("lookupMessage").textContent = message || "";
  $("lookupMessage").className = `lookup-message${isError ? " error" : ""}`;
}

function setLookupBusy(isBusy) {
  const form = $("lookupForm");
  for (const control of form.elements) control.disabled = isBusy;
}

function renderCandidates(candidates) {
  state.candidates = candidates || [];
  $("candidateList").innerHTML = state.candidates.map((candidate) => `
    <div class="candidate" data-candidate-row="${escapeHtml(candidate.candidate_key)}">
      <button class="candidate-main" type="button" data-candidate="${escapeHtml(candidate.candidate_key)}" ${candidate.already_watched ? "disabled" : ""}>
        <strong>${escapeHtml(candidate.flight_number)}</strong>
        <span>${escapeHtml(candidate.origin)}-${escapeHtml(candidate.destination)}</span>
        <span>${escapeHtml(candidate.etd_utc ? `ETD ${hhmmz(candidate.etd_utc)}` : "ETD --")}</span>
        <span>${escapeHtml(candidate.current_edct_utc ? hhmmz(candidate.current_edct_utc) : "No time")}</span>
        <span>${escapeHtml(candidate.already_watched ? "Watched" : "Add")}</span>
      </button>
      <button class="candidate-remove secondary" type="button" data-remove-candidate="${escapeHtml(candidate.candidate_key)}" aria-label="Remove candidate">x</button>
    </div>
  `).join("");
}

async function monitorCandidate(candidateId, options = {}) {
  const candidate = state.candidates.find((item) => item.candidate_key === candidateId);
  if (!candidate) return;
  const localFlight = localFlightFromCandidate(candidate);
  state.flights.push(localFlight);
  pendingAdds.set(localFlight.flight_key, candidateId);
  persistFlights();
  renderFlights();
  renderStats();
  setLookupMessage("Flight added.");
  state.candidates = state.candidates.filter((item) => item.candidate_key !== candidateId);
  renderCandidates(state.candidates);
  if (!options.keepOpen) closeAddPanel();
  if (options.keepOpen) {
    const form = $("lookupForm");
    form.elements.flight.value = "";
    form.elements.flight.focus();
  }
  addCandidateInBackground(candidateId, localFlight.flight_key);
}

async function addCandidateInBackground(candidateId, localKey) {
  try {
    const data = await api("/api/edct/lookup/add", { method: "POST", body: JSON.stringify({ candidate_key: candidateId }) });
    pendingAdds.delete(localKey);
    const serverFlight = data.flight;
    if (!serverFlight) return;
    if (!replaceLocalFlight(localKey, serverFlight)) {
      await api(`/api/flights/${serverFlight.flight_key}`, { method: "DELETE" });
      return;
    }
    scheduleLoadAll(1500);
  } catch (error) {
    pendingAdds.delete(localKey);
    removeFlightLocally(localKey);
    setLookupMessage(error.message || "Add failed.", true);
  }
}

async function persistServerDelete(flightKey) {
  if (flightKey.startsWith("local_")) {
    pendingAdds.delete(flightKey);
    return;
  }
  try {
    await api(`/api/flights/${flightKey}`, { method: "DELETE" });
  } catch (error) {
    setLookupMessage(error.message || "Delete failed on server.", true);
  }
}

let loadAllTimer = null;
function scheduleLoadAll(delay = 0) {
  clearTimeout(loadAllTimer);
  loadAllTimer = setTimeout(() => {
    loadAll().catch(() => {
      renderWarning();
    });
  }, delay);
}

async function pollNotifications() {
  try {
    const permission = typeof window.Notification === "function" && typeof Notification.permission === "string" ? Notification.permission : "unsupported";
    if (permission !== state.session?.notification_permission) {
      await api("/api/session/label", {
        method: "POST",
        body: JSON.stringify({ notification_permission: permission })
      });
    }
    const data = await api("/api/notifications/pending");
    state.pending = data.notifications || [];
    renderBadge();
    if (permission !== "granted") return;
    const delivered = [];
    for (const n of state.pending) {
      new Notification(n.title, { body: n.body, tag: n.notification_key });
      delivered.push(n.notification_key);
    }
    if (delivered.length) {
      await api("/api/notifications/mark-delivered", { method: "POST", body: JSON.stringify({ notification_keys: delivered, delivery_state: "delivered" }) });
      state.pending = [];
      renderBadge();
    }
  } catch {
  }
}

async function heartbeat() {
  try {
    await api("/api/session/heartbeat", { method: "POST", body: "{}" });
  } catch {
  }
}

function openAddPanel() {
  $("addPanel").hidden = false;
  $("showAddBtn").hidden = true;
  $("lookupForm").elements.flight.focus();
}

function closeAddPanel() {
  $("addPanel").hidden = true;
  $("showAddBtn").hidden = false;
  $("lookupForm").reset();
  state.candidates = [];
  $("candidateList").innerHTML = "";
  setLookupMessage("");
}

function serverPayloadFromFlight(flight) {
  return {
    flight_number: flight.display_flight_number,
    origin: flight.origin,
    destination: flight.destination,
    etd_utc: flight.etd_utc || flight.state?.current_edct_utc || new Date().toISOString()
  };
}

function shouldReconcileFlight(flight) {
  return flight && !String(flight.flight_key || "").startsWith("local_");
}

async function reconcileSavedFlightsInBackground() {
  const serverKeys = new Set((state.serverFlightKeys || []).filter(Boolean));
  const saved = state.flights.filter(shouldReconcileFlight);
  if (!saved.length) return;
  for (const flight of saved) {
    if (serverKeys.has(flight.flight_key)) continue;
    try {
      const data = await api("/api/flights", { method: "POST", body: JSON.stringify(serverPayloadFromFlight(flight)) });
      if (data.flight) replaceLocalFlight(flight.flight_key, data.flight);
    } catch {
    }
  }
}

function keepEntryOpenAfterAdd() {
  return window.matchMedia("(min-width: 521px)").matches;
}

function showSummary(flightKey) {
  const flight = state.flights.find((item) => item.flight_key === flightKey);
  if (!flight) return;
  const current = flight.state?.current_edct_utc;
  const previous = flight.state?.previous_edct_utc;
  const change = flight.state?.last_change || "UNCHANGED";
  const lines = [
    `Current time: ${hhmmz(current)}`,
    change === "EDCT_ASSIGNED" ? `Assigned ${hhmmz(current)}` : "",
    change === "EDCT_WORSENED" ? `Worsened from ${hhmmz(previous)}` : "",
    change === "EDCT_IMPROVED" ? `Improved from ${hhmmz(previous)}` : "",
    change === "EDCT_REMOVED" ? "Removed" : "",
    flight.state?.last_checked_utc ? `Last checked: ${hhmmz(flight.state.last_checked_utc)}` : "",
    "Verify in official operational source."
  ].filter(Boolean);
  $("summaryTitle").textContent = `${flight.display_flight_number} ${flight.origin}-${flight.destination}`;
  $("summaryContent").innerHTML = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  $("summaryModal").showModal();
}

$("showAddBtn").addEventListener("click", openAddPanel);
$("cancelAddBtn").addEventListener("click", closeAddPanel);
$("closeSummaryBtn").addEventListener("click", () => $("summaryModal").close());
$("closeAlertsBtn").addEventListener("click", () => $("alertsModal").close());
$("alertsToggle").addEventListener("click", () => $("alertsModal").showModal());

$("lookupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fd = new FormData(form);
  const flight = String(fd.get("flight") || "").trim();
  const destination = String(fd.get("destination") || "").trim();
  $("candidateList").innerHTML = "";
  setLookupMessage("Searching...");
  setLookupBusy(true);
  try {
    const params = new URLSearchParams({ flight, destination });
    const data = await api(`/api/edct/lookup?${params.toString()}`);
    const candidates = data.candidates || [];
    state.candidates = candidates;
    if (candidates.length === 1 && !candidates[0].already_watched) {
      await monitorCandidate(candidates[0].candidate_key, { keepOpen: keepEntryOpenAfterAdd() });
      return;
    }
    if (candidates.length > 0) {
      renderCandidates(candidates);
      setLookupMessage(data.message || "Choose the flight to monitor.");
      return;
    }
    setLookupMessage("Flight Not Found", true);
  } catch (error) {
    setLookupMessage(error.message || "Lookup failed.", true);
  } finally {
    setLookupBusy(false);
  }
});

$("notifyBtn").addEventListener("click", async () => {
  const status = notificationStatus();
  if (typeof window.Notification === "function" && Notification.permission === "default" && status.level !== "warning") await Notification.requestPermission();
  await pollNotifications();
  $("alertsModal").showModal();
  renderWarning();
  renderBadge();
});

document.addEventListener("click", async (event) => {
  const deleteId = event.target.dataset.delete;
  if (deleteId) {
    event.stopPropagation();
    const startedAt = performance.now();
    removeFlightLocally(deleteId);
    console.info(`Sadiom Flow delete UI update: ${Math.round(performance.now() - startedAt)}ms`);
    persistServerDelete(deleteId).then(() => scheduleLoadAll(1500));
    return;
  }
  const moveId = event.target.dataset.move;
  if (moveId) {
    event.stopPropagation();
    moveFlight(moveId, Number(event.target.dataset.direction || 0));
    return;
  }
  const candidateButton = event.target.closest("[data-candidate]");
  if (candidateButton) {
    await monitorCandidate(candidateButton.dataset.candidate, { keepOpen: keepEntryOpenAfterAdd() });
    return;
  }
  const removeCandidateId = event.target.dataset.removeCandidate;
  if (removeCandidateId) {
    state.candidates = state.candidates.filter((candidate) => candidate.candidate_key !== removeCandidateId);
    renderCandidates(state.candidates);
    return;
  }
  const row = event.target.closest("[data-flight]");
  if (row) showSummary(row.dataset.flight);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest("[data-flight]");
  if (!row) return;
  event.preventDefault();
  showSummary(row.dataset.flight);
});

function initialize() {
  const savedState = loadSavedState();
  state.deletedFlightKeys = new Set(savedState.deletedFlightKeys);
  if (savedState.flights.length) state.flights = savedState.flights;
  render();
  loadAll().then(() => {
    heartbeat();
    pollNotifications();
  }).catch(() => {
    $("warningBanner").textContent = "Backend unavailable. Verify official source.";
    $("warningBanner").hidden = false;
  });
}

initialize();
setInterval(() => scheduleLoadAll(), 60_000);
setInterval(heartbeat, 45_000);
setInterval(pollNotifications, 30_000);
