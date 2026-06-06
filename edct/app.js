const state = { flights: [], events: [], session: null, status: null, airport: "ALL" };
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

function toUtcFromLocal(value) {
  if (!value) return "";
  return new Date(value).toISOString();
}

function hhmmz(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

function timeText(iso) {
  return iso ? new Date(iso).toLocaleString([], { hour12: false }) : "-";
}

function delayText(flight) {
  const edct = flight.state?.current_edct_utc;
  if (!edct) return "-";
  const minutes = Math.round((new Date(edct) - new Date(flight.etd_utc)) / 60000);
  return `${minutes >= 0 ? "+" : ""}${minutes} min`;
}

function changeClass(change) {
  return change || "UNCHANGED";
}

function render() {
  $("monitoringToggle").checked = state.session?.monitoring_enabled !== false;
  $("intervalInput").value = state.session?.refresh_interval_minutes || 5;
  $("labelInput").value = state.session?.optional_label || "";
  renderFilters();
  renderStatus();
  renderFlights();
  renderHistory();
}

function renderFilters() {
  const airports = ["ALL", ...new Set(state.flights.map((f) => f.destination))];
  $("airportFilters").innerHTML = airports.map((airport) =>
    `<button type="button" class="pill ${state.airport === airport ? "active" : ""}" data-airport="${airport}">${airport}</button>`
  ).join("");
}

function renderStatus() {
  const s = state.status || {};
  $("statusAirports").textContent = (s.monitored_airports || []).join(", ") || "-";
  $("statusRecords").textContent = s.records_fetched ?? 0;
  $("statusMatches").textContent = s.matched_flights ?? 0;
  $("statusUpdated").textContent = timeText(s.last_successful_update);
  $("statusError").textContent = s.last_source_error ? `${s.last_source_error.airport} ${timeText(s.last_source_error.at)}` : "None";
}

function renderFlights() {
  const rows = state.flights
    .filter((f) => state.airport === "ALL" || f.destination === state.airport)
    .map((f) => {
      const change = changeClass(f.state?.last_change);
      return `<tr>
        <td>${f.display_flight_number}<br><small>${f.normalized_acid}</small></td>
        <td>${f.origin}-${f.destination}</td>
        <td>${hhmmz(f.state?.current_edct_utc)}</td>
        <td><span class="state ${change}">${change.replace("EDCT_", "")}</span></td>
        <td>${timeText(f.state?.last_source_fetch_at)}</td>
        <td><button class="secondary" data-detail="${f.id}" type="button">Detail</button> <button class="secondary" data-delete="${f.id}" type="button">Delete</button></td>
      </tr>`;
    }).join("");
  $("flightRows").innerHTML = rows || `<tr><td colspan="6">No active flights.</td></tr>`;
}

function renderHistory() {
  $("historyList").innerHTML = state.events.slice(0, 80).map((e) =>
    `<div class="event"><span>${timeText(e.created_at)}</span><span>${e.message}</span><span>${e.event_type.replace("EDCT_", "")}</span></div>`
  ).join("") || "No EDCT events yet.";
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
  await loadAll();
}

function setLookupMessage(message, isError = false) {
  $("lookupMessage").textContent = message || "";
  $("lookupMessage").className = `lookup-message${isError ? " error" : ""}`;
}

function renderCandidates(candidates) {
  $("candidateList").innerHTML = candidates.map((candidate) => `
    <div class="candidate">
      <b>${candidate.flight_number}</b>
      <span>${candidate.origin}</span>
      <span>${candidate.destination}</span>
      <span>${candidate.etd_utc ? hhmmz(candidate.etd_utc) : "ETD -"}</span>
      <span>${candidate.current_edct_utc ? hhmmz(candidate.current_edct_utc) : "EDCT -"}</span>
      <button type="button" data-candidate="${candidate.candidate_id}">Monitor</button>
    </div>
  `).join("");
}

async function monitorCandidate(candidateId) {
  setLookupMessage("Adding flight...");
  await api("/api/edct/lookup/add", { method: "POST", body: JSON.stringify({ candidate_id: candidateId }) });
  $("candidateList").innerHTML = "";
  setLookupMessage("Flight added. Verify EDCT information in the official operational source before use.");
  await loadAll();
}

async function pollNotifications() {
  try {
    const permission = "Notification" in window ? Notification.permission : "unsupported";
    if (permission !== state.session?.notification_permission) {
      await api("/api/session/label", {
        method: "POST",
        body: JSON.stringify({ notification_permission: permission, label: state.session?.optional_label || "", monitoring_enabled: state.session?.monitoring_enabled, refresh_interval_minutes: state.session?.refresh_interval_minutes })
      });
    }
    if (permission !== "granted") return;
    const data = await api("/api/notifications/pending");
    const delivered = [];
    for (const n of data.notifications) {
      new Notification(n.title, { body: n.body, tag: n.id });
      delivered.push(n.id);
    }
    if (delivered.length) {
      await api("/api/notifications/mark-delivered", { method: "POST", body: JSON.stringify({ notification_event_ids: delivered, delivery_state: "delivered" }) });
    }
  } catch {
  }
}

$("flightForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fd = new FormData(form);
  await addFlight({
    flight_number: fd.get("flight_number"),
    origin: fd.get("origin"),
    destination: fd.get("destination"),
    etd: toUtcFromLocal(fd.get("etd")),
    scheduled_departure_utc: toUtcFromLocal(fd.get("scheduled_departure_utc")),
    scheduled_arrival_utc: toUtcFromLocal(fd.get("scheduled_arrival_utc"))
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
    const params = new URLSearchParams({ flight, origin, destination });
    const data = await api(`/api/edct/lookup?${params.toString()}`);
    if (data.candidates.length === 1) {
      await monitorCandidate(data.candidates[0].candidate_id);
      form.reset();
      return;
    }
    if (data.candidates.length > 1) {
      renderCandidates(data.candidates);
      setLookupMessage("Multiple active matches found. Choose the flight to monitor.");
      return;
    }
    setLookupMessage(data.message || "No active EDCT record found for this flight and destination. Verify flight number, origin, and destination.", true);
  } catch (error) {
    setLookupMessage(error.message || "Lookup failed.", true);
  }
});

$("bulkAddBtn").addEventListener("click", async () => {
  const lines = $("bulkInput").value.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const [flight_number, origin, destination, etd] = line.split(/[,\s]+/);
    if (flight_number && origin && destination && etd) await addFlight({ flight_number, origin, destination, etd: new Date(etd).toISOString() });
  }
  $("bulkInput").value = "";
});

$("refreshBtn").addEventListener("click", async () => {
  state.status = await api("/api/edct/refresh", { method: "POST", body: "{}" });
  await loadAll();
});

$("saveSettingsBtn").addEventListener("click", async () => {
  const data = await api("/api/session/label", {
    method: "POST",
    body: JSON.stringify({
      label: $("labelInput").value,
      monitoring_enabled: $("monitoringToggle").checked,
      refresh_interval_minutes: $("intervalInput").value,
      notification_permission: "Notification" in window ? Notification.permission : "unsupported"
    })
  });
  state.session = data.session;
  render();
});

$("notifyBtn").addEventListener("click", async () => {
  if ("Notification" in window) await Notification.requestPermission();
  await pollNotifications();
});

document.addEventListener("click", async (event) => {
  const airport = event.target.dataset.airport;
  if (airport) {
    state.airport = airport;
    render();
  }
  const deleteId = event.target.dataset.delete;
  if (deleteId) {
    await api(`/api/flights/${deleteId}`, { method: "DELETE" });
    await loadAll();
  }
  const detailId = event.target.dataset.detail;
  const candidateId = event.target.dataset.candidate;
  if (candidateId) await monitorCandidate(candidateId);
  if (detailId) {
    const flight = state.flights.find((f) => f.id === detailId);
    const events = await api(`/api/edct/flights/${detailId}/events`);
    $("detailTitle").textContent = `${flight.display_flight_number} ${flight.origin}-${flight.destination}`;
    $("detailContent").textContent = JSON.stringify({ flight, event_history: events.events }, null, 2);
    $("detailModal").showModal();
  }
});

$("closeModalBtn").addEventListener("click", () => $("detailModal").close());

loadAll();
setInterval(loadAll, 60_000);
setInterval(pollNotifications, 30_000);
