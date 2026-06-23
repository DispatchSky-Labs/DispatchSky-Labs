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
import { parseFlightEntries } from "../src/inputParsers.js";
import { Store } from "../src/store.js";
import { freshnessView, relativeAge } from "../edct/freshness.js";

test("flight and airport normalization", () => {
  assert.deepEqual(normalizeFlightNumber("5338"), { display: "5338", normalizedAcid: "SKW5338" });
  assert.deepEqual(normalizeFlightNumber("skw1869"), { display: "SKW1869", normalizedAcid: "SKW1869" });
  assert.deepEqual(normalizeFlightNumber("ual1597"), { display: "UAL1597", normalizedAcid: "UAL1597" });
  assert.deepEqual(normalizeFlightNumber("aal123"), { display: "AAL123", normalizedAcid: "AAL123" });
  assert.equal(normalizeAirport("klax"), "LAX");
});

test("freshness indicator formats relative age and thresholds", () => {
  const now = Date.parse("2026-06-22T12:00:00.000Z");
  assert.equal(relativeAge("2026-06-22T11:59:45.000Z", now), "just now");
  assert.equal(relativeAge("2026-06-22T11:59:00.000Z", now), "1m ago");
  assert.equal(relativeAge("2026-06-22T11:53:30.000Z", now), "7m ago");
  const status = (ageMinutes) => ({
    last_updated_utc: new Date(now - 60_000).toISOString(),
    sources: [{ airport: "SFO", last_successful_update_utc: new Date(now - ageMinutes * 60_000).toISOString() }]
  });
  assert.equal(freshnessView(status(4), now).level, "healthy");
  assert.equal(freshnessView(status(5), now).level, "warning");
  assert.equal(freshnessView(status(15), now).level, "hard-stale");
  assert.match(freshnessView(status(15), now).text, /Data may be stale/);
});

test("stale-source row styling takes priority over ETD-met styling", () => {
  const css = fs.readFileSync(new URL("../edct/styles.css", import.meta.url), "utf8");
  assert.ok(css.indexOf(".flight-row.source-stale") > css.indexOf(".flight-row.etd-met"));
  const app = fs.readFileSync(new URL("../edct/app.js", import.meta.url), "utf8");
  assert.match(app, /sourceStale \? "source-stale" : etdAge/);
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
  assert.equal(notificationFor({ event_type: EVENT_TYPES.WORSENED, previous_edct_utc: "2026-06-05T14:20:00.000Z", new_edct_utc: "2026-06-05T14:25:00.000Z" }, flight, "aggressive")?.title, "Change worsened");
  assert.equal(notificationFor({ event_type: EVENT_TYPES.WORSENED, previous_edct_utc: "2026-06-05T14:20:00.000Z", new_edct_utc: "2026-06-05T14:45:00.000Z" }, flight, "quiet"), null);
  assert.ok(notificationFor({ event_type: EVENT_TYPES.WORSENED, previous_edct_utc: "2026-06-05T14:20:00.000Z", new_edct_utc: "2026-06-05T14:50:00.000Z" }, flight, "quiet"));
});

test("bulk table parser accepts mixed delimiters and keeps Sabre parser as future hook", () => {
  const parsed = parseFlightEntries("SKW5592   SFO\nUAL1597,SFO\nAAL3288\tPHX", "generic");
  assert.equal(parsed.parser, "simple_table");
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.entries.map((entry) => [entry.normalized_acid, entry.destination]), [
    ["SKW5592", "SFO"],
    ["UAL1597", "SFO"],
    ["AAL3288", "PHX"]
  ]);
  const sabre = parseFlightEntries("SABRE DUMP", "sabre_future");
  assert.equal(sabre.entries.length, 0);
  assert.match(sabre.errors[0].message, /future/);
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
