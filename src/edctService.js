import { config } from "./config.js";
import {
  compareEdct,
  EVENT_TYPES,
  flightSignature,
  formatHHMMZ,
  notificationFor,
  nowIso
} from "./edctCore.js";
import { fetchSourceForAirport } from "./sourceClient.js";

let backendSleeping = true;

export function isOperationalSnapshot(snapshot) {
  return Boolean(snapshot?.success && !snapshot?.stale);
}

export function activeFlights(store, workspaceId = null) {
  return store.data.flights.filter((f) => f.active && (!workspaceId || f.workspace_id === workspaceId));
}

export function airportsForWorkspace(store, workspaceId) {
  return [...new Set(activeFlights(store, workspaceId).map((f) => f.destination))];
}

export async function refreshWorkspace(store, workspaceId, manual = false, sessionId = null, reason = manual ? "manual_refresh" : "scheduled") {
  const workspace = store.data.workspaces.find((w) => w.id === workspaceId);
  if (!workspace || workspace.monitoring_enabled === false) return statusForWorkspace(store, workspaceId);
  if (reason === "wake_refresh" || reason === "manual_refresh") {
    noteWorkspaceState(store, workspace, "active", "workspace_woke", "Workspace polling resumed after page activity");
  }
  const flights = activeFlights(store, workspaceId);
  const airports = [...new Set(flights.map((f) => f.destination))];
  const summary = { fetched: 0, matched: 0, events: 0 };
  for (const airport of airports) {
    const reference = flights.find((f) => f.destination === airport)?.scheduled_departure_utc || nowIso();
    const snapshot = await fetchSourceForAirport(airport, reference, { force: manual, reason });
    const operational = isOperationalSnapshot(snapshot);
    store.insert("source_airport_snapshots", {
      airport,
      fetched_at: snapshot.fetched_at,
      success: operational,
      record_count: snapshot.record_count,
      normalized_records: operational ? snapshot.records : [],
      error_message: snapshot.error_message || ""
    });
    store.usage(operational ? "SOURCE_FETCH_SUCCESS" : "SOURCE_FETCH_FAILED", workspaceId, sessionId, { airport });
    if (operational) summary.fetched += snapshot.record_count;
    for (const flight of flights.filter((f) => f.destination === airport)) {
      const match = operational
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
      const eventType = compareEdct(previousEdct, newEdct, operational);
      const statePatch = {
        ...key,
        flight_id: flight.id,
        current_edct_utc: operational ? newEdct : previousEdct,
        previous_edct_utc: eventType ? previousEdct : previousState?.previous_edct_utc || null,
        last_change: eventType || previousState?.last_change || "UNCHANGED",
        last_seen_at: operational && match ? snapshot.fetched_at : previousState?.last_seen_at || null,
        last_source_fetch_at: snapshot.last_successful_fetch_at || snapshot.fetched_at,
        source_stale: !operational,
        source_record: operational && match ? match : previousState?.source_record || null
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
      const notification = notificationFor(event, flight, config.notificationSensitivity);
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
  const lifecycleEvents = evaluateEtdMet(store, workspaceId, sessionId);
  summary.events += lifecycleEvents;
  if (manual) store.usage("MANUAL_REFRESH", workspaceId, sessionId, { airports });
  return { ...statusForWorkspace(store, workspaceId), refresh_summary: summary };
}

export function evaluateEtdMet(store, workspaceId, sessionId = null, evaluatedAt = nowIso()) {
  const evaluatedMs = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluatedMs)) return 0;
  let insertedEvents = 0;
  for (const flight of activeFlights(store, workspaceId)) {
    const sourceState = store.data.edct_flight_states.find((state) => state.flight_id === flight.id);
    if (sourceState?.source_stale) continue;
    const usesEdctTarget = Boolean(sourceState?.current_edct_utc);
    const etd = sourceState?.current_edct_utc || (flight.etd_lifecycle_eligible === false ? null : flight.etd_utc) || null;
    const etdMs = Date.parse(etd || "");
    if (!Number.isFinite(etdMs)) continue;
    if (flight.etd_met_for_utc && flight.etd_met_for_utc !== etd) {
      store.update("flights", flight.id, {
        etd_met_for_utc: null,
        etd_met_at: null,
        etd_met_acknowledged_at: null
      });
    }
    if (evaluatedMs < etdMs || flight.etd_met_for_utc === etd) continue;
    const metAt = evaluatedAt;
    store.update("flights", flight.id, {
      etd_met_for_utc: etd,
      etd_met_at: metAt,
      etd_met_acknowledged_at: null
    });
    const targetLabel = usesEdctTarget ? "EDCT" : "ETD";
    const message = `${targetLabel} met for ${flight.display_flight_number} ${flight.origin}–${flight.destination}`;
    const event = store.insert("edct_events", {
      workspace_id: flight.workspace_id,
      flight_id: flight.id,
      flight_signature: flightSignature(flight),
      event_type: EVENT_TYPES.ETD_MET,
      previous_edct_utc: null,
      new_edct_utc: etd,
      delay_minutes: null,
      source_airport: flight.destination,
      source_fetch_at: metAt,
      message,
      acknowledged_at: null,
      created_at: metAt
    });
    insertedEvents += 1;
    store.usage("EDCT_EVENT_GENERATED", flight.workspace_id, sessionId, { event_type: EVENT_TYPES.ETD_MET, airport: flight.destination });
    store.insert("notification_events", {
      workspace_id: flight.workspace_id,
      edct_event_id: event.id,
      title: `${targetLabel} met`,
      body: message,
      created_at: metAt
    });
  }
  return insertedEvents;
}

function messageFor(type, flight, prev, next) {
  const route = `${flight.display_flight_number} ${flight.origin}-${flight.destination}`;
  if (type === "EDCT_ASSIGNED") return `${route} assigned ${formatHHMMZ(next)}`;
  if (type === "EDCT_WORSENED") return `${route} worsened ${formatHHMMZ(prev)} -> ${formatHHMMZ(next)}`;
  if (type === "EDCT_IMPROVED") return `${route} improved ${formatHHMMZ(prev)} -> ${formatHHMMZ(next)}`;
  return `${route} removed`;
}

export function statusForWorkspace(store, workspaceId) {
  const flights = activeFlights(store, workspaceId);
  const airports = [...new Set(flights.map((f) => f.destination))];
  const snapshots = store.data.source_airport_snapshots.filter((s) => airports.includes(s.airport));
  const lastSuccess = snapshots.filter((s) => s.success).sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))[0];
  const lastError = snapshots.filter((s) => !s.success).sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))[0];
  const warning = warningFor(lastSuccess, lastError);
  const sources = airports.map((airport) => {
    const successful = snapshots
      .filter((snapshot) => snapshot.airport === airport && snapshot.success)
      .sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))[0];
    return { airport, last_successful_update_utc: successful?.fetched_at || null };
  });
  return {
    warning,
    last_updated_utc: lastSuccess?.fetched_at || null,
    sources
  };
}

export function noteBackendActivity(store, message = "Backend woke after page activity") {
  if (!backendSleeping) return false;
  backendSleeping = false;
  store.insert("admin_events", {
    event_type: "backend_woke",
    message,
    created_at: nowIso()
  });
  return true;
}

function noteWorkspaceState(store, workspace, nextState, eventType, message) {
  if (!workspace || workspace.polling_state === nextState) return false;
  workspace.polling_state = nextState;
  workspace.polling_state_updated_at = nowIso();
  store.insert("admin_events", {
    event_type: eventType,
    message,
    created_at: nowIso()
  });
  store.save();
  return true;
}

function noteBackendSleep(store) {
  if (backendSleeping) return;
  backendSleeping = true;
  store.insert("admin_events", {
    event_type: "backend_slept",
    message: "Backend slept after idle window",
    created_at: nowIso()
  });
}

export function backendRuntimeState(store) {
  const activeCutoff = Date.now() - config.activeSessionThresholdSeconds * 1000;
  const pollingCutoff = Date.now() - config.idleSleepMinutes * 60_000;
  const sessions = store.data.sessions || [];
  const flights = activeFlights(store);
  const activePollingWorkspaces = recentlyActiveWorkspacesWithFlights(store);
  const idleWorkspaces = idleWorkspacesWithFlights(store);
  const lastActivityMs = Math.max(
    0,
    ...sessions.map(sessionConnectionMs),
    ...flights.map((f) => Date.parse(f.updated_at || f.created_at || "") || 0)
  );
  const hasActiveSession = sessions.some((s) => sessionConnectionMs(s) >= activeCutoff);
  const hasActiveFlights = activePollingWorkspaces.length > 0;
  const idleForSleep = lastActivityMs > 0 && lastActivityMs < pollingCutoff;
  const shouldSleep = !hasActiveSession && !hasActiveFlights && (idleForSleep || idleWorkspaces.length > 0);
  return {
    shouldSleep,
    hasActiveSession,
    hasActiveFlights,
    activePollingWorkspaceIds: activePollingWorkspaces.map((workspace) => workspace.id),
    idleWorkspaceIds: idleWorkspaces.map((workspace) => workspace.id),
    backendSleeping,
    lastActivityAt: lastActivityMs ? new Date(lastActivityMs).toISOString() : null,
    nextSleepAt: !shouldSleep && !hasActiveFlights && lastActivityMs ? new Date(lastActivityMs + config.idleSleepMinutes * 60_000).toISOString() : null
  };
}

export function sessionConnectionMs(session) {
  const lastConnection = Math.max(
    Date.parse(session.last_seen_at || "") || 0,
    Date.parse(session.last_heartbeat_at || "") || 0
  );
  return lastConnection || Date.parse(session.created_at || "") || 0;
}

export function resetBackendRuntimeForTests() {
  if (process.env.NODE_ENV !== "test") return;
  backendSleeping = true;
}

export function sessionUserActivityMs(session) {
  const value = Object.hasOwn(session, "last_operator_action_at")
    ? session.last_operator_action_at
    : session.last_user_activity_at || session.last_activity_at || session.created_at;
  return Date.parse(value || "") || 0;
}

export function workspaceActivityMs(store, workspaceId) {
  return Math.max(
    ...store.data.sessions
      .filter((session) => session.workspace_id === workspaceId)
      .map(sessionConnectionMs)
  );
}

export function isWorkspaceRecentlyActive(store, workspaceId) {
  const cutoff = Date.now() - config.idleSleepMinutes * 60_000;
  return workspaceActivityMs(store, workspaceId) >= cutoff;
}

export function recentlyActiveWorkspacesWithFlights(store) {
  return store.data.workspaces.filter((workspace) =>
    workspace.monitoring_enabled !== false &&
    activeFlights(store, workspace.id).length > 0 &&
    isWorkspaceRecentlyActive(store, workspace.id)
  );
}

export function idleWorkspacesWithFlights(store) {
  return store.data.workspaces.filter((workspace) =>
    workspace.monitoring_enabled !== false &&
    activeFlights(store, workspace.id).length > 0 &&
    !isWorkspaceRecentlyActive(store, workspace.id)
  );
}

export async function refreshDueAirports(store) {
  const runtime = backendRuntimeState(store);
  for (const workspace of idleWorkspacesWithFlights(store)) {
    noteWorkspaceState(store, workspace, "idle", "workspace_idle", "Workspace polling paused after idle window");
  }
  if (runtime.shouldSleep) {
    noteBackendSleep(store);
    return { sleeping: true, airports: [] };
  }
  if (runtime.hasActiveSession || runtime.hasActiveFlights) noteBackendActivity(store, "Backend woke for active monitoring");
  if (!runtime.hasActiveFlights) return { sleeping: backendSleeping, airports: [] };
  const workspaces = recentlyActiveWorkspacesWithFlights(store);
  const airports = new Set();
  for (const workspace of workspaces) {
    noteWorkspaceState(store, workspace, "active", "workspace_woke", "Workspace polling resumed after page activity");
    for (const airport of airportsForWorkspace(store, workspace.id)) airports.add(airport);
    await refreshWorkspace(store, workspace.id, false, null, "scheduled");
  }
  return { sleeping: false, airports: [...airports] };
}

function warningFor(lastSuccess, lastError) {
  if (!lastSuccess && lastError) return { message: "Data may be stale. Verify official source." };
  if (!lastSuccess) return null;
  const ageMinutes = Math.round((Date.now() - new Date(lastSuccess.fetched_at).getTime()) / 60000);
  if (lastError && new Date(lastError.fetched_at) > new Date(lastSuccess.fetched_at)) {
    return { message: staleWarningMessage(ageMinutes) };
  }
  if (ageMinutes > Math.max(10, config.pollMinutes * 3)) {
    return { message: staleWarningMessage(ageMinutes) };
  }
  return null;
}

function staleWarningMessage(ageMinutes) {
  const age = Math.max(ageMinutes, 1);
  if (age > 24 * 60) return "Stale source data. Last successful update was over 24 hours ago. Verify official source.";
  if (age >= 60) {
    const hours = Math.max(1, Math.round(age / 60));
    return `Data may be stale. Last update ${hours} ${hours === 1 ? "hour" : "hours"} ago. Verify official source.`;
  }
  return `Data may be stale. Last update ${age} min ago. Verify official source.`;
}
