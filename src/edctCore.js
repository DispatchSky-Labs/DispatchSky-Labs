import crypto from "node:crypto";

export const EVENT_TYPES = {
  ASSIGNED: "EDCT_ASSIGNED",
  WORSENED: "EDCT_WORSENED",
  IMPROVED: "EDCT_IMPROVED",
  REMOVED: "EDCT_REMOVED"
};

export function id(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function sanitizeText(value, max = 80) {
  return String(value ?? "")
    .replace(/[<>`"\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalizeAirport(value) {
  const code = sanitizeText(value, 8).toUpperCase().replace(/[^A-Z]/g, "");
  if (code.length < 3 || code.length > 4) throw new Error("Airport must be a 3 or 4 letter code.");
  return code.length === 4 && code.startsWith("K") ? code.slice(1) : code;
}

export function normalizeFlightNumber(value) {
  const display = sanitizeText(value, 16).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!display) throw new Error("Flight number is required.");
  const normalizedAcid = display.startsWith("SKW") ? display : `SKW${display.replace(/\D/g, "")}`;
  if (!/^SKW\d{1,5}$/.test(normalizedAcid)) throw new Error("Flight number must contain 1 to 5 digits.");
  return { display, normalizedAcid };
}

export function parseDateInput(value, fallbackError = "Date/time is required.") {
  const clean = sanitizeText(value, 40);
  const date = new Date(clean);
  if (!clean || Number.isNaN(date.getTime())) throw new Error(fallbackError);
  return date.toISOString();
}

export function operationalDayKey(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

export function flightSignature(flight) {
  return [
    flight.normalized_acid,
    flight.origin,
    flight.destination,
    flight.operational_day_key
  ].join("|");
}

export function parseCompactEdct(raw, referenceIso) {
  const value = sanitizeText(raw, 20).toUpperCase();
  const match = value.match(/^[A-Z](\d{2})\/?(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, dd, hh, mm] = match;
  const ref = new Date(referenceIso || Date.now());
  const candidate = new Date(Date.UTC(
    ref.getUTCFullYear(),
    ref.getUTCMonth(),
    Number(dd),
    Number(hh),
    Number(mm),
    0,
    0
  ));
  if (Number.isNaN(candidate.getTime())) return null;
  const fifteenDays = 15 * 24 * 60 * 60 * 1000;
  if (candidate.getTime() - ref.getTime() > fifteenDays) candidate.setUTCMonth(candidate.getUTCMonth() - 1);
  if (ref.getTime() - candidate.getTime() > fifteenDays) candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  return candidate.toISOString();
}

export function formatHHMMZ(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

export function normalizeSourceRecord(record, referenceIso) {
  const acid = sanitizeText(record.acid ?? record.ACID ?? record.flight ?? "", 16).toUpperCase();
  const origin = normalizeAirport(record.origin ?? record.ORIGIN ?? record.dep ?? "");
  const destination = normalizeAirport(record.destination ?? record.DESTINATION ?? record.dest ?? "");
  const rawEdct = record.edct ?? record.EDCT ?? record.etd ?? record.ETD ?? record.etdRaw ?? record["etd raw string"];
  return {
    acid,
    type: sanitizeText(record.type ?? record.TYPE ?? "", 20),
    origin,
    destination,
    etd_raw: sanitizeText(rawEdct ?? "", 20),
    edct_utc: parseCompactEdct(rawEdct, referenceIso),
    eta: sanitizeText(record.eta ?? record.ETA ?? "", 20),
    ete: sanitizeText(record.ete ?? record.ETE ?? "", 20),
    departure_center: sanitizeText(record.departure_center ?? record["departure center"] ?? record.center ?? "", 20),
    major_airline: sanitizeText(record.major_airline ?? record["major airline"] ?? record.airline ?? "", 40)
  };
}

export function compareEdct(previousIso, newIso, successfulFetch) {
  if (!previousIso && newIso) return EVENT_TYPES.ASSIGNED;
  if (previousIso && newIso && new Date(newIso) > new Date(previousIso)) return EVENT_TYPES.WORSENED;
  if (previousIso && newIso && new Date(newIso) < new Date(previousIso)) return EVENT_TYPES.IMPROVED;
  if (previousIso && !newIso && successfulFetch) return EVENT_TYPES.REMOVED;
  return null;
}

export function notificationFor(event, flight) {
  const prev = event.previous_edct_utc ? new Date(event.previous_edct_utc) : null;
  const next = event.new_edct_utc ? new Date(event.new_edct_utc) : null;
  const etd = new Date(flight.etd_utc);
  const flightText = `${flight.display_flight_number} ${flight.origin} to ${flight.destination}`;
  if (event.event_type === EVENT_TYPES.ASSIGNED && next) {
    const delay = Math.round((next - etd) / 60000);
    if (delay < 20) return null;
    return { title: "EDCT assigned", body: `${flightText} EDCT assigned ${formatHHMMZ(event.new_edct_utc)} (+${delay} min). Verify in the official source before use.` };
  }
  if (event.event_type === EVENT_TYPES.WORSENED && prev && next) {
    if (Math.round((next - prev) / 60000) < 15) return null;
    return { title: "EDCT worsened", body: `${flightText} EDCT worsened to ${formatHHMMZ(event.new_edct_utc)}. Verify in the official source before use.` };
  }
  if (event.event_type === EVENT_TYPES.IMPROVED && prev && next) {
    if (Math.round((prev - next) / 60000) < 15) return null;
    return { title: "EDCT improved", body: `${flightText} EDCT improved to ${formatHHMMZ(event.new_edct_utc)}. Verify in the official source before use.` };
  }
  if (event.event_type === EVENT_TYPES.REMOVED && event.previous_edct_utc) {
    return { title: "EDCT removed", body: `${flightText} EDCT removed. Verify in the official source before use.` };
  }
  return null;
}
