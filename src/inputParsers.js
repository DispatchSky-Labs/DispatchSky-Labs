import { normalizeAirport, normalizeFlightNumber, sanitizeText } from "./edctCore.js";

export function parseFlightEntries(input, parserName = "generic") {
  const parser = parsers[parserName] || parsers.generic;
  return parser(input);
}

const parsers = {
  generic(input) {
    return parsers.simple_table(input);
  },

  simple_table(input) {
    const lines = String(input || "")
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const entries = [];
    const errors = [];
    lines.forEach((line, index) => {
      const cleaned = line.replace(/,/g, " ");
      const parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        errors.push({ line: index + 1, message: "Expected callsign and destination." });
        return;
      }
      try {
        const flight = normalizeFlightNumber(parts[0]);
        const destination = normalizeAirport(parts[1]);
        entries.push({
          input_key: `row_${index + 1}`,
          raw: sanitizeText(line, 120),
          flight_number: flight.display,
          normalized_acid: flight.normalizedAcid,
          destination
        });
      } catch (error) {
        errors.push({ line: index + 1, message: sanitizeText(error.message || "Invalid row.", 80) });
      }
    });
    return { parser: "simple_table", entries, errors };
  },

  sabre_future() {
    return {
      parser: "sabre_future",
      entries: [],
      errors: [{ line: null, message: "Sabre dump parser is reserved for a future format-specific implementation." }]
    };
  }
};
