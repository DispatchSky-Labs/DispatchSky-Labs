// metar-utils.js - Shared METAR/TAF validation utilities
// Extracted from app.v8b.js for reuse across CieloTracker apps

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
  const currentYear = onow.getUTCFullYear();
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

  // Check if expired (> 60 minutes)
  const expired = ageInMinutes > 60;

  // Check if critically expired (> 75 minutes)
  const critical = ageInMinutes > 75;

  return { expired, critical };
}

function checkMissingMetarElements(metarText) {
  if (!metarText) return true; // If no text, consider it missing elements

  // Fixed regex patterns to properly match METAR elements
  const hasWinds = /\b(\d{3}|VRB)\d{2}(G\d{2})?KT\b|\bCALM\b/.test(metarText);
  const hasVisibility = /\b(P?\d+SM|\d+\/\d+SM)\b/.test(metarText);
  const hasSkyConditions = /\b(FEW|SCT|BKN|OVC|CLR|CLEAR|SKC|VV|CAVOK)\d*\b/.test(metarText);
  const hasTemperature = /\b(M?\d{2})\/(M?\d{2})?\b/.test(metarText);
  const hasAltimeter = /\bA\d{4}\b/.test(metarText);

  return !(hasWinds && hasVisibility && hasSkyConditions && hasTemperature && hasAltimeter);
}

// NEW: Check for winds/gusts ≥40 kt and highlight in HTML
function checkWindThreshold(rawMetar, metarHtml) {
  if (!rawMetar || !metarHtml) return metarHtml;

  // Regex to match wind groups: VRB or 3-digit direction, speed (2-3 digits), optional gust, KT
  const windRegex = /\b(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/g;

  let match;
  let modifiedHtml = metarHtml;

  while ((match = windRegex.exec(rawMetar)) !== null) {
    const fullToken = match[0]; // e.g., "30045KT" or "VRB12G45KT"
    const speed = parseInt(match[2], 10);
    const gust = match[4] ? parseInt(match[4], 10) : 0;

    // Check if speed or gust meets threshold (≥40kt)
    if (speed >= 40 || gust >= 40) {
      // Escape special regex characters in the token for safe replacement
      const escapedToken = fullToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const replaceRegex = new RegExp(`\\b${escapedToken}\\b`, 'g');

      // Wrap the token with <span class="hit">
      modifiedHtml = modifiedHtml.replace(replaceRegex, `<span class="hit">${fullToken}</span>`);
    }
  }

  return modifiedHtml;
}

function extractTafIssueTime(tafText) {
  if (!tafText) return null;

  // Extract issue time from TAF header (e.g., "TAF KDEN 191720Z")
  const match = tafText.match(/TAF\s+[A-Z]{4}\s+(\d{6})Z/);
  if (match) return match[1]; // Returns DDHHMM

  return null;
}
