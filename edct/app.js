const state = { flights: [], events: [], session: null, status: null, pending: [], candidates: [] };
const $ = (id) => document.getElementById(id);
const API_BASE_URL = String(window.EDCT_API_BASE_URL || "").replace(/\/+$/, "");

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "content-type": "application/json" },
    credentials: API_BASE_URL ? "include" : "same-origin",
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
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
  const rows = state.flights.map((flight) => {
    const change = compactChange(flight);
    const route = `${flight.origin}-${flight.destination}`;
    return `<div class="flight-row" data-flight="${escapeHtml(flight.flight_key)}" role="button" tabindex="0">
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
  const session = await api("/api/session");
  const [flights, status, events] = await Promise.all([
    api("/api/flights"),
    api("/api/edct/status"),
    api("/api/edct/events")
  ]);
  state.session = session.session;
  state.flights = flights.flights;
  state.status = status;
  state.events = events.events;
  render();
}

async function addFlight(values) {
  await api("/api/flights", { method: "POST", body: JSON.stringify(values) });
  closeAddPanel();
  await loadAll();
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
  $("bulkAddSelectedBtn").hidden = !state.candidates.some((candidate) => !candidate.already_watched);
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
  setLookupMessage("Adding flight...");
  await api("/api/edct/lookup/add", { method: "POST", body: JSON.stringify({ candidate_key: candidateId }) });
  state.candidates = state.candidates.filter((candidate) => candidate.candidate_key !== candidateId);
  renderCandidates(state.candidates);
  setLookupMessage("");
  if (!options.keepOpen) closeAddPanel();
  await loadAll();
  if (options.keepOpen) {
    const form = $("lookupForm");
    form.elements.flight.value = "";
    form.elements.flight.focus();
  }
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
  $("bulkAddSelectedBtn").hidden = true;
  state.candidates = [];
  $("candidateList").innerHTML = "";
  setLookupMessage("");
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

$("bulkFindBtn").addEventListener("click", async () => {
  const text = $("bulkInput").value;
  if (!text.trim()) return;
  setLookupMessage("Searching rows...");
  $("candidateList").innerHTML = "";
  try {
    const data = await api("/api/edct/lookup/bulk", { method: "POST", body: JSON.stringify({ text, parser: "generic" }) });
    renderCandidates(data.candidates || []);
    const parseErrors = (data.errors || []).map((item) => `Line ${item.line || "-"}: ${item.message}`).join(" ");
    setLookupMessage([data.message, parseErrors].filter(Boolean).join(" "));
  } catch (error) {
    setLookupMessage(error.message || "Bulk lookup failed.", true);
  }
});

$("bulkAddSelectedBtn").addEventListener("click", async () => {
  const selected = state.candidates.filter((candidate) => !candidate.already_watched);
  for (const candidate of selected) {
    await monitorCandidate(candidate.candidate_key, { keepOpen: true });
  }
  $("bulkInput").value = "";
  setLookupMessage("Selected flights added.");
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
    await api(`/api/flights/${deleteId}`, { method: "DELETE" });
    await loadAll();
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

loadAll().then(() => {
  heartbeat();
  pollNotifications();
}).catch((error) => {
  $("warningBanner").textContent = "Backend unavailable. Verify official source.";
  $("warningBanner").hidden = false;
});
setInterval(loadAll, 60_000);
setInterval(heartbeat, 45_000);
setInterval(pollNotifications, 30_000);
