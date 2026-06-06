import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compareEdct,
  EVENT_TYPES,
  flightSignature,
  normalizeAirport,
  normalizeFlightNumber,
  notificationFor,
  parseCompactEdct
} from "../src/edctCore.js";
import { Store } from "../src/store.js";

test("flight and airport normalization", () => {
  assert.deepEqual(normalizeFlightNumber("5338"), { display: "5338", normalizedAcid: "SKW5338" });
  assert.deepEqual(normalizeFlightNumber("skw1869"), { display: "SKW1869", normalizedAcid: "SKW1869" });
  assert.deepEqual(normalizeFlightNumber("ual1597"), { display: "UAL1597", normalizedAcid: "UAL1597" });
  assert.deepEqual(normalizeFlightNumber("aal123"), { display: "AAL123", normalizedAcid: "AAL123" });
  assert.equal(normalizeAirport("klax"), "LAX");
});

test("EDCT compact parsing resolves UTC date and month rollover", () => {
  assert.equal(parseCompactEdct("E051430", "2026-06-05T12:00:00.000Z"), "2026-06-05T14:30:00.000Z");
  assert.equal(parseCompactEdct("E05/1430", "2026-06-05T12:00:00.000Z"), "2026-06-05T14:30:00.000Z");
  assert.equal(parseCompactEdct("E301430", "2026-06-01T12:00:00.000Z"), "2026-05-30T14:30:00.000Z");
  assert.equal(parseCompactEdct("E011430", "2026-05-30T12:00:00.000Z"), "2026-06-01T14:30:00.000Z");
});

test("matching signature uses exact ACID origin destination operational day", () => {
  const flight = { normalized_acid: "SKW5338", origin: "FAT", destination: "LAX", operational_day_key: "2026-06-05" };
  assert.equal(flightSignature(flight), "SKW5338|FAT|LAX|2026-06-05");
});

test("EDCT comparison detects assignment worsening improvement and removal", () => {
  assert.equal(compareEdct(null, "2026-06-05T15:00:00.000Z", true), EVENT_TYPES.ASSIGNED);
  assert.equal(compareEdct("2026-06-05T15:00:00.000Z", "2026-06-05T15:20:00.000Z", true), EVENT_TYPES.WORSENED);
  assert.equal(compareEdct("2026-06-05T15:20:00.000Z", "2026-06-05T15:00:00.000Z", true), EVENT_TYPES.IMPROVED);
  assert.equal(compareEdct("2026-06-05T15:20:00.000Z", null, true), EVENT_TYPES.REMOVED);
  assert.equal(compareEdct("2026-06-05T15:20:00.000Z", null, false), null);
});

test("notification thresholds are enforced", () => {
  const flight = { display_flight_number: "5338", origin: "FAT", destination: "LAX", etd_utc: "2026-06-05T14:00:00.000Z" };
  assert.equal(notificationFor({ event_type: EVENT_TYPES.ASSIGNED, new_edct_utc: "2026-06-05T14:10:00.000Z" }, flight), null);
  assert.ok(notificationFor({ event_type: EVENT_TYPES.ASSIGNED, new_edct_utc: "2026-06-05T14:20:00.000Z" }, flight));
  assert.equal(notificationFor({ event_type: EVENT_TYPES.WORSENED, previous_edct_utc: "2026-06-05T14:20:00.000Z", new_edct_utc: "2026-06-05T14:30:00.000Z" }, flight), null);
  assert.ok(notificationFor({ event_type: EVENT_TYPES.WORSENED, previous_edct_utc: "2026-06-05T14:20:00.000Z", new_edct_utc: "2026-06-05T14:35:00.000Z" }, flight));
  assert.ok(notificationFor({ event_type: EVENT_TYPES.REMOVED, previous_edct_utc: "2026-06-05T14:20:00.000Z" }, flight));
});

test("database-level EDCT event dedupe key prevents repeated inserts", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edct-store-")), "db.json");
  const store = new Store(file);
  const row = {
    workspace_id: "w1",
    flight_id: "f1",
    flight_signature: "SKW1|LAX|SFO|2026-06-05",
    event_type: EVENT_TYPES.ASSIGNED,
    previous_edct_utc: null,
    new_edct_utc: "2026-06-05T15:00:00.000Z",
    source_airport: "SFO",
    source_fetch_at: "2026-06-05T14:00:00.000Z",
    message: "assigned",
    created_at: "2026-06-05T14:00:00.000Z"
  };
  assert.equal(store.dedupedEdctEvent(row).inserted, true);
  assert.equal(store.dedupedEdctEvent(row).inserted, false);
  assert.equal(store.data.edct_events.length, 1);
});
