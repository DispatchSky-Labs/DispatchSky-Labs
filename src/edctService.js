import { config } from "./config.js";
import {
  compareEdct,
  flightSignature,
  formatHHMMZ,
  notificationFor,
  nowIso
} from "./edctCore.js";
import { fetchSourceForAirport } from "./sourceClient.js";

export function activeFlights(store, workspaceId = null) {
  return store.data.flights.filter((f) => f.active && (!workspaceId || f.workspace_id === workspaceId));
}

export function airportsForWorkspace(store, workspaceId) {
  return [...new Set(activeFlights(store, workspaceId).map((f) => f.destination))];
}

export async function refreshWorkspace(store, workspaceId, manual = false, sessionId = null) {
  const workspace = store.data.workspaces.find((w) => w.id === workspaceId);
  if (!workspace || workspace.monitoring_enabled === false) return statusForWorkspace(store, workspaceId);
  const flights = activeFlights(store, workspaceId);
  const airports = [...new Set(flights.map((f) => f.destination))];
  const summary = { fetched: 0, matched: 0, events: 0 };
  for (const airport of airports) {
    const reference = flights.find((f) => f.destination === airport)?.scheduled_departure_utc || nowIso();
    const snapshot = await fetchSourceForAirport(airport, reference, { force: manual });
    store.insert("source_airport_snapshots", {
      airport,
      fetched_at: snapshot.fetched_at,
      success: snapshot.success && !snapshot.stale,
      record_count: snapshot.record_count,
      normalized_records: snapshot.success ? snapshot.records : [],
      error_message: snapshot.error_message || ""
    });
    if (snapshot.success && !snapshot.stale) summary.fetched += snapshot.record_count;
    for (const flight of flights.filter((f) => f.destination === airport)) {
      const match = snapshot.success
        ? snapshot.records.find((r) => r.acid === flight.normalized_acid && r.origin === flight.origin && r.destination === flight.destination)
        : null;
      if (match) summary.matched += 1;
      const key = {
        workspace_id: flight.workspace_id,
        normalized_acid: flight.normalized_acid,
        origin: flight.origin,
        destination: flight.destination,
        operational_day_key: flight.operational_day_key
      };
      const previousState = store.data.edct_flight_states.find((s) =>
        s.workspace_id === key.workspace_id &&
        s.normalized_acid === key.normalized_acid &&
        s.origin === key.origin &&
        s.destination === key.destination &&
        s.operational_day_key === key.operational_day_key
      );
      const previousEdct = previousState?.current_edct_utc || null;
      const newEdct = match?.edct_utc || null;
      const eventType = compareEdct(previousEdct, newEdct, snapshot.success && !snapshot.stale);
      const statePatch = {
        ...key,
        flight_id: flight.id,
        current_edct_utc: snapshot.success ? newEdct : previousEdct,
        previous_edct_utc: eventType ? previousEdct : previousState?.previous_edct_utc || null,
        last_change: eventType || previousState?.last_change || "UNCHANGED",
        last_seen_at: match ? snapshot.fetched_at : previousState?.last_seen_at || null,
        last_source_fetch_at: snapshot.last_successful_fetch_at || snapshot.fetched_at,
        source_record: match || previousState?.source_record || null
      };
      store.upsertState(statePatch);
      if (!eventType) continue;
      const eventMessage = messageFor(eventType, flight, previousEdct, newEdct);
      const { event, inserted } = store.dedupedEdctEvent({
        workspace_id: flight.workspace_id,
        flight_id: flight.id,
        flight_signature: flightSignature(flight),
        event_type: eventType,
        previous_edct_utc: previousEdct,
        new_edct_utc: newEdct,
        delay_minutes: newEdct ? Math.round((new Date(newEdct) - new Date(flight.etd_utc)) / 60000) : null,
        source_airport: airport,
        source_fetch_at: snapshot.fetched_at,
        message: eventMessage,
        created_at: nowIso()
      });
      if (!inserted) continue;
      summary.events += 1;
      store.usage("EDCT_EVENT_GENERATED", flight.workspace_id, sessionId, { event_type: eventType, airport });
      const notification = notificationFor(event, flight);
      if (notification) {
        store.insert("notification_events", {
          workspace_id: flight.workspace_id,
          edct_event_id: event.id,
          title: notification.title,
          body: notification.body,
          created_at: nowIso()
        });
      }
    }
  }
  if (manual) store.usage("MANUAL_REFRESH", workspaceId, sessionId, { airports });
  return { ...statusForWorkspace(store, workspaceId), refresh_summary: summary };
}

function messageFor(type, flight, prev, next) {
  const route = `${flight.display_flight_number} ${flight.origin}-${flight.destination}`;
  if (type === "EDCT_ASSIGNED") return `${route} EDCT assigned ${formatHHMMZ(next)}`;
  if (type === "EDCT_WORSENED") return `${route} EDCT worsened ${formatHHMMZ(prev)} -> ${formatHHMMZ(next)}`;
  if (type === "EDCT_IMPROVED") return `${route} EDCT improved ${formatHHMMZ(prev)} -> ${formatHHMMZ(next)}`;
  return `${route} EDCT removed`;
}

export function statusForWorkspace(store, workspaceId) {
  const flights = activeFlights(store, workspaceId);
  const airports = [...new Set(flights.map((f) => f.destination))];
  const snapshots = store.data.source_airport_snapshots.filter((s) => airports.includes(s.airport));
  const lastSuccess = snapshots.filter((s) => s.success).sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))[0];
  const lastError = snapshots.filter((s) => !s.success).sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))[0];
  const warning = warningFor(lastSuccess, lastError);
  return {
    warning,
    last_updated_utc: lastSuccess?.fetched_at || null
  };
}

export async function refreshDueAirports(store) {
  const activeSince = Date.now() - config.idleSleepMinutes * 60_000;
  const hasRecentSession = store.data.sessions.some((s) => new Date(s.last_seen_at).getTime() >= activeSince);
  const hasActiveFlights = store.data.flights.some((f) => f.active);
  if (!hasRecentSession && !hasActiveFlights) return;
  const workspaces = store.data.workspaces.filter((w) => w.monitoring_enabled !== false);
  for (const workspace of workspaces) {
    if (!activeFlights(store, workspace.id).length) continue;
    await refreshWorkspace(store, workspace.id, false, null);
  }
}

function warningFor(lastSuccess, lastError) {
  if (!lastSuccess && lastError) return { message: "EDCT data may be stale. Verify official source." };
  if (!lastSuccess) return null;
  const ageMinutes = Math.round((Date.now() - new Date(lastSuccess.fetched_at).getTime()) / 60000);
  if (lastError && new Date(lastError.fetched_at) > new Date(lastSuccess.fetched_at)) {
    return { message: `EDCT data may be stale. Last successful update ${Math.max(ageMinutes, 1)} min ago. Verify official source.` };
  }
  if (ageMinutes > Math.max(10, config.pollMinutes * 3)) {
    return { message: `EDCT data may be stale. Last successful update ${ageMinutes} min ago. Verify official source.` };
  }
  return null;
}
