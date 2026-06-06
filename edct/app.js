const state = { flights: [], events: [], session: null, status: null, pending: [] };
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
  return event.message ? `${event.message}. Verify official source.` : "EDCT changed. Verify official source.";
}

function render() {
  renderWarning();
  renderFlights();
  renderAlerts();
  renderBadge();
}

function renderWarning() {
  const warning = state.status?.warning?.message || notificationWarning();
  $("warningBanner").textContent = warning || "";
  $("warningBanner").hidden = !warning;
}

function notificationWarning() {
  if (!("Notification" in window)) return "Browser notifications are unavailable. Keep this page open and verify official source.";
  if (Notification.permission === "denied") return "Browser notifications are blocked. Enable them to receive EDCT change alerts.";
  return "";
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
  $("alertsModalList").innerHTML = state.events.map((event) => `<div class="alert-line">${escapeHtml(alertText(event))}</div>`).join("") || `<div class="empty">No EDCT alerts yet.</div>`;
}

function renderBadge() {
  const count = state.pending.length;
  $("alertBadge").hidden = count === 0;
  $("alertBadge").textContent = String(Math.min(count, 99));
}

async function loadAll() {
  const [session, flights, status, events] = await Promise.all([
    api("/api/session"),
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

function renderCandidates(candidates) {
  $("candidateList").innerHTML = candidates.map((candidate) => `
      <button class="candidate" type="button" data-candidate="${escapeHtml(candidate.candidate_key)}">
      <strong>${escapeHtml(candidate.flight_number)}</strong>
      <span>${escapeHtml(candidate.origin)}-${escapeHtml(candidate.destination)}</span>
      <span>${escapeHtml(candidate.current_edct_utc ? hhmmz(candidate.current_edct_utc) : "--")}</span>
    </button>
  `).join("");
}

async function monitorCandidate(candidateId) {
  setLookupMessage("Adding flight...");
  await api("/api/edct/lookup/add", { method: "POST", body: JSON.stringify({ candidate_key: candidateId }) });
  $("candidateList").innerHTML = "";
  setLookupMessage("");
  closeAddPanel();
  await loadAll();
}

async function pollNotifications() {
  try {
    const permission = "Notification" in window ? Notification.permission : "unsupported";
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

function openAddPanel() {
  $("addPanel").hidden = false;
  $("showAddBtn").hidden = true;
  $("lookupForm").elements.flight.focus();
}

function closeAddPanel() {
  $("addPanel").hidden = true;
  $("showAddBtn").hidden = false;
  $("lookupForm").reset();
  $("candidateList").innerHTML = "";
  setLookupMessage("");
}

function showSummary(flightKey) {
  const flight = state.flights.find((item) => item.flight_key === flightKey);
  if (!flight) return;
  const current = flight.state?.current_edct_utc;
  const previous = flight.state?.previous_edct_utc;
  const change = flight.state?.last_change || "UNCHANGED";
  const lines = [
    `Current EDCT: ${hhmmz(current)}`,
    change === "EDCT_ASSIGNED" ? `Assigned ${hhmmz(current)}` : "",
    change === "EDCT_WORSENED" ? `Worsened from ${hhmmz(previous)}` : "",
    change === "EDCT_IMPROVED" ? `Improved from ${hhmmz(previous)}` : "",
    change === "EDCT_REMOVED" ? "EDCT removed" : "",
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

$("flightForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fd = new FormData(form);
  await addFlight({
    flight_number: fd.get("flight_number"),
    origin: fd.get("origin"),
    destination: fd.get("destination"),
    etd: toUtcFromLocal(fd.get("etd"))
  });
  form.reset();
});

$("lookupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fd = new FormData(form);
  const flight = String(fd.get("flight") || "").trim();
  const origin = String(fd.get("origin") || "").trim();
  const destination = String(fd.get("destination") || "").trim();
  $("candidateList").innerHTML = "";
  setLookupMessage("Searching...");
  try {
    const params = new URLSearchParams({ flight, destination });
    if (origin) params.set("origin", origin);
    const data = await api(`/api/edct/lookup?${params.toString()}`);
    if (data.candidates.length === 1) {
      await monitorCandidate(data.candidates[0].candidate_key);
      return;
    }
    if (data.candidates.length > 1) {
      renderCandidates(data.candidates);
      setLookupMessage("Multiple matches found. Choose the flight to monitor.");
      return;
    }
    setLookupMessage(data.message || "No active EDCT record found for this flight and destination. Verify flight number, origin, and destination.", true);
  } catch (error) {
    setLookupMessage(error.message || "Lookup failed.", true);
  }
});

$("bulkAddBtn").addEventListener("click", async () => {
  const lines = $("bulkInput").value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const [flight_number, origin, destination, etd] = line.split(/[,\s]+/);
    if (flight_number && origin && destination && etd) await addFlight({ flight_number, origin, destination, etd: new Date(etd).toISOString() });
  }
  $("bulkInput").value = "";
});

$("notifyBtn").addEventListener("click", async () => {
  if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  await pollNotifications();
  $("alertsModal").showModal();
  renderWarning();
});

document.addEventListener("click", async (event) => {
  const deleteId = event.target.dataset.delete;
  if (deleteId) {
    event.stopPropagation();
    await api(`/api/flights/${deleteId}`, { method: "DELETE" });
    await loadAll();
    return;
  }
  const candidateId = event.target.dataset.candidate;
  if (candidateId) {
    await monitorCandidate(candidateId);
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

loadAll().then(pollNotifications).catch((error) => {
  $("warningBanner").textContent = "EDCT backend unavailable. Verify official source.";
  $("warningBanner").hidden = false;
});
setInterval(loadAll, 60_000);
setInterval(pollNotifications, 30_000);
