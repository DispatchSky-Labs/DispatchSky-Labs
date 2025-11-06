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

// NEW: Helper function to escape special regex characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// NEW: Check for winds/gusts ≥40 kt and highlight in HTML
function checkWindThreshold(metarText, htmlOutput, reasons) {
  if (!metarText || !htmlOutput) return htmlOutput;

  // Regex to match wind groups: VRB or direction, speed, optional gust, KT
  // Examples: "30045KT", "VRB12G45KT", "18025G40KT"
  const windRegex = /\b(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/g;

  let match;
  let modifiedHtml = htmlOutput;
  const triggeredWinds = [];

  while ((match = windRegex.exec(metarText)) !== null) {
    const fullToken = match[0]; // e.g., "30045KT" or "VRB12G45KT"
    const direction = match[1]; // VRB or 3-digit direction
    const speed = parseInt(match[2], 10); // Wind speed
    const gust = match[4] ? parseInt(match[4], 10) : 0; // Gust speed (0 if none)

    // Check if speed or gust meets threshold
    if (speed >= 40 || gust >= 40) {
      // Build reason string
      const reasonText = gust > 0 
        ? `Wind/Gust ≥40kt: ${speed}ktG${gust}kt`
        : `Wind/Gust ≥40kt: ${speed}kt`;

      triggeredWinds.push(reasonText);

      // Escape the token for safe regex replacement
      const escapedToken = escapeRegExp(fullToken);
      const replaceRegex = new RegExp(`\\b${escapedToken}\\b`, 'g');

      // Wrap the token with <span class="hit">
      modifiedHtml = modifiedHtml.replace(replaceRegex, `<span class="hit">${fullToken}</span>`);
    }
  }

  // Add all triggered wind reasons to the reasons array
  if (reasons && triggeredWinds.length > 0) {
    triggeredWinds.forEach(reason => reasons.push(reason));
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

// Export functions for use in Cloud Functions (if using module.exports)
// Uncomment if your backend uses Node.js modules:
/*
module.exports = {
  checkMetarExpiredStatus,
  checkMissingMetarElements,
  checkWindThreshold,
  escapeRegExp,
  extractTafIssueTime
};
*/
