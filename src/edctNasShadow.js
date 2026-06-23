import { formatHHMMZ } from "./edctCore.js";

export function buildNasShadow(store, workspaceId, nasStatus) {
  const flights = store.data.flights.filter((f) => f.active && f.workspace_id === workspaceId);
  return {
    generated_at: new Date().toISOString(),
    nas: {
      ok: Boolean(nasStatus?.ok),
      source: nasStatus?.source || "FAA_OIS",
      fetched_at: nasStatus?.fetchedAt || null,
      attempted_at: nasStatus?.attemptedAt || null,
      error: nasStatus?.error || ""
    },
    flights: flights.map((flight) => flightShadow(store, flight, nasStatus))
  };
}

function flightShadow(store, flight, nasStatus) {
  const state = store.data.edct_flight_states.find((s) => s.flight_id === flight.id) || null;
  const latestSnapshot = store.data.source_airport_snapshots
    .filter((snapshot) => snapshot.airport === flight.destination)
    .sort((a, b) => String(b.fetched_at || "").localeCompare(String(a.fetched_at || "")))[0] || null;
  const nasConditions = nasStatus?.conditions?.[flight.destination] || [];
  const aadc = aadcState(flight, state, latestSnapshot);
  const oldInterpretation = oldLiveInterpretation(state);
  const betaInterpretation = betaNasInterpretation(aadc, nasStatus, nasConditions, state);

  return {
    flight_key: flight.id,
    flight: flight.display_flight_number,
    origin: flight.origin,
    destination: flight.destination,
    aadc,
    nas: {
      airport: flight.destination,
      conditions: nasConditions,
      active_gdp: nasConditions.includes("groundDelayProgram"),
      active_ground_stop: nasConditions.includes("groundStop"),
      active_airport_closure: nasConditions.includes("airportClosure"),
      fetched_at: nasStatus?.fetchedAt || null,
      ok: Boolean(nasStatus?.ok),
      error: nasStatus?.error || ""
    },
    old_interpretation: oldInterpretation,
    beta_interpretation: betaInterpretation,
    last_checked_utc: state?.last_source_fetch_at || latestSnapshot?.fetched_at || null
  };
}

function aadcState(flight, state, latestSnapshot) {
  const sourceStale = state?.source_stale === true;
  const current = sourceStale ? null : state?.current_edct_utc || null;
  const previous = state?.previous_edct_utc || null;
  const lastSeen = state?.last_seen_at || null;
  const lastFetch = state?.last_source_fetch_at || latestSnapshot?.fetched_at || null;
  const successfulFetch = latestSnapshot?.success === true;
  const rowPresent = Boolean(current);
  const rowMissingAfterSuccess = Boolean(state && !sourceStale && !current && successfulFetch);

  return {
    status: rowPresent ? "present" : rowMissingAfterSuccess ? "missing" : state ? "unknown" : "not_tracked",
    source_stale: sourceStale,
    current_edct_utc: current,
    current_edct_display: formatHHMMZ(current) || "",
    previous_edct_utc: previous,
    previous_edct_display: formatHHMMZ(previous) || "",
    last_seen_at: lastSeen,
    last_source_fetch_at: lastFetch,
    source_snapshot_at: latestSnapshot?.fetched_at || null,
    source_snapshot_success: latestSnapshot?.success === true,
    source_record_count: latestSnapshot?.record_count ?? null
  };
}

function oldLiveInterpretation(state) {
  if (state?.source_stale) return { label: "Checking...", detail: "AADC source data is stale or unavailable." };
  const change = state?.last_change || "UNCHANGED";
  if (change === "EDCT_ASSIGNED") return { label: "Normal EDCT", detail: "Live logic shows assigned EDCT." };
  if (change === "EDCT_WORSENED") return { label: "EDCT worsened", detail: "Live logic shows a later EDCT." };
  if (change === "EDCT_IMPROVED") return { label: "EDCT improved", detail: "Live logic shows an earlier EDCT." };
  if (change === "EDCT_REMOVED") return { label: "EDCT removed", detail: "Live logic inferred removal from AADC omission." };
  return { label: "Unchanged", detail: "Live logic has no new EDCT change." };
}

function betaNasInterpretation(aadc, nasStatus, nasConditions, state) {
  if (aadc.status === "present") return { label: "Normal EDCT", severity: "normal", reason: "AADC row is present." };
  if (aadc.status !== "missing") return { label: "Checking...", severity: "unknown", reason: "Insufficient AADC state for shadow comparison." };
  if (!nasStatus?.ok) return { label: "Checking...", severity: "unknown", reason: "NAS/OIS unavailable; beta will not infer GDP ended." };

  const activeProgram = nasConditions.includes("groundDelayProgram") || nasConditions.includes("groundStop");
  if (activeProgram) {
    return { label: "No longer listed", severity: "caution", reason: "AADC row is missing but NAS/OIS still shows an active airport program." };
  }

  if (state?.previous_edct_utc || state?.last_change === "EDCT_REMOVED") {
    return { label: "Program ended", severity: "ended", reason: "AADC row is missing and NAS/OIS shows no active GDP/ground stop." };
  }

  return { label: "Checking...", severity: "unknown", reason: "NAS/OIS has no active program, but prior EDCT context is incomplete." };
}
