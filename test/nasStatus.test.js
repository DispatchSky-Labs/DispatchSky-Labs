import assert from "node:assert/strict";
import test from "node:test";

import { buildNasShadow } from "../src/edctNasShadow.js";
import { parseNasStatusSummary } from "../src/nasStatusService.js";

test("NAS parser handles active GDP from OIS summary HTML", () => {
  const parsed = parseNasStatusSummary(`
    <html><body>
      <h2>NATIONAL PROGRAMS</h2>
      <table><tr><td>SFO</td><td>GDP</td></tr></table>
      <h2>GROUND STOPS</h2>
      <h2>DELAY INFO</h2>
    </body></html>
  `);

  assert.deepEqual(parsed.SFO, ["groundDelayProgram"]);
});

test("NAS parser handles active ground stop from OIS summary HTML", () => {
  const parsed = parseNasStatusSummary(`
    GROUND STOPS
    KDEN Ground stop due volume
    DELAY INFO
  `);

  assert.deepEqual(parsed.DEN, ["groundStop"]);
});

test("NAS parser returns no active GDP or ground stop when sections are empty", () => {
  const parsed = parseNasStatusSummary(`
    NATIONAL PROGRAMS
    ARPT PROGRAM NAME
    GROUND STOPS
    ARPT REASON
    DELAY INFO
  `);

  assert.deepEqual(parsed, {});
});

test("NAS parser handles XML delay type entries", () => {
  const parsed = parseNasStatusSummary(`
    <Delay_type>
      <Name>GROUND DELAY PROGRAMS</Name>
      <Ground_Delay><ARPT>KLGA</ARPT><Reason>WEATHER</Reason></Ground_Delay>
    </Delay_type>
    <Delay_type>
      <Name>GROUND STOPS</Name>
      <Ground_Stop><ARPT>SFO</ARPT><Reason>VOLUME</Reason></Ground_Stop>
    </Delay_type>
  `);

  assert.deepEqual(parsed.LGA, ["groundDelayProgram"]);
  assert.deepEqual(parsed.SFO, ["groundStop"]);
});

test("NAS shadow marks missing AADC row with active NAS program as no longer listed", () => {
  const shadow = buildNasShadow(fakeStore(), "ws_test", {
    ok: true,
    fetchedAt: "2026-06-05T15:05:00.000Z",
    source: "FAA_OIS",
    conditions: { SAN: ["groundDelayProgram"] },
    error: ""
  });

  assert.equal(shadow.flights[0].beta_interpretation.label, "No longer listed");
});

test("NAS shadow may mark missing AADC row with inactive NAS program as program ended", () => {
  const shadow = buildNasShadow(fakeStore(), "ws_test", {
    ok: true,
    fetchedAt: "2026-06-05T15:05:00.000Z",
    source: "FAA_OIS",
    conditions: {},
    error: ""
  });

  assert.equal(shadow.flights[0].beta_interpretation.label, "Program ended");
});

function fakeStore() {
  return {
    data: {
      flights: [{
        id: "flight_test",
        workspace_id: "ws_test",
        active: true,
        display_flight_number: "SKW5338",
        normalized_acid: "SKW5338",
        origin: "FAT",
        destination: "SAN",
        operational_day_key: "2026-06-05"
      }],
      edct_flight_states: [{
        flight_id: "flight_test",
        workspace_id: "ws_test",
        normalized_acid: "SKW5338",
        origin: "FAT",
        destination: "SAN",
        operational_day_key: "2026-06-05",
        current_edct_utc: null,
        previous_edct_utc: "2026-06-05T15:00:00.000Z",
        last_change: "EDCT_REMOVED",
        last_seen_at: "2026-06-05T14:50:00.000Z",
        last_source_fetch_at: "2026-06-05T15:02:00.000Z"
      }],
      source_airport_snapshots: [{
        airport: "SAN",
        fetched_at: "2026-06-05T15:02:00.000Z",
        success: true,
        record_count: 0
      }]
    }
  };
}
