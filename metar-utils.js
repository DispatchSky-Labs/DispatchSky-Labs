// metar-utils.js - Shared METAR validation utilities
// Extracted from app.v8b.js for reuse across CieloTracker apps

/**
 * Check if METAR is expired with buffer periods
 * @param {string} metarText - Raw METAR text
 * @returns {{expired: boolean, critical: boolean}}
 */
function checkMetarExpiredStatus(metarText) {
  if (!metarText) return { expired: false, critical: false };

  // Extract DDHHMM from METAR (e.g., "KDEN 191953Z" -> "191953")
  const match = metarText.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (!match) return { expired: false, critical: false };

  const day = parseInt(match[1], 10);
  const hour = parseInt(match[2], 10);
  const minute = parseInt(match[3], 10);

  if (day < 1 || day > 31 || hour > 23 || minute > 59) return { expired: false, critical: false };

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const currentDay = now.getUTCDate();

  // Construct METAR date (assume current month)
  let metarDate = new Date(Date.UTC(currentYear, currentMonth, day, hour, minute));

  // Handle month rollover
  if (day > currentDay + 15) {
    // METAR is likely from previous month
    metarDate = new Date(Date.UTC(currentYear, currentMonth - 1, day, hour, minute));
  } else if (day < currentDay - 15) {
    // METAR is likely from next month
    metarDate = new Date(Date.UTC(currentYear, currentMonth + 1, day, hour, minute));
  }

  const ageInMs = now - metarDate;
  const ageInMinutes = ageInMs / (1000 * 60);

  // Check if expire
