# TAF Parsing and iPad Input Fix

## ✅ Issue 1: Port Complete TAF Parsing Logic from pro.html

**Status:** Completed

**What was done:**
- Ported the complete TAF parsing logic from `pro.html` to `TriggerCalculationService.swift`
- Implemented all TAF parsing functions:
  - `parseTafHeader()` - Parses TAF header to extract start/end dates
  - `buildTafSegments()` - Builds TAF segments by splitting on FM markers
  - `getTafBaseTextAtEtaHour()` - Gets base TAF text at ETA hour
  - `getTafSegmentsForWindow()` - Gets TAF segments for arrival window (ETA ± 1 hour)
  - `etaToUtcDateWithinTaf()` - Converts ETA to UTC date within TAF validity period

**Key Features:**
- Properly handles FM (From) markers in TAF
- Removes TEMPO lines from base segments (they're handled separately)
- Correctly calculates conditional periods (TEMPO/PROB) with 1-minute-before-hour end times
- Handles day wrap-around for dates
- Handles hour 24 (midnight) correctly

**File Changed:**
- `CieloTracker_iOS/CieloTracker/Services/TriggerCalculationService.swift`

**How it works:**
1. `parseTafHeader()` extracts the validity period from TAF (DDHH/DDHH format)
2. `buildTafSegments()` splits the TAF by FM markers and creates segments
3. `getTafSegmentsForWindow()` filters segments for the arrival window and includes conditional periods
4. Conditional periods (TEMPO/PROB) are parsed separately and end times are adjusted (subtract 1 minute)
5. Only conditional periods that overlap with the arrival window are included

**Example:**
- TAF: `TAF KXXX 241200Z 2412/2512 ...`
- FM markers split the TAF into segments
- Each segment has a start/end time and text
- Conditional periods like `PROB30 0000/0300` are parsed separately
- PROB 0000-0300 ends at 0259 (not 0300)

---

## ✅ Issue 2: Fix Taxi and Burn Input Box Format on iPad

**Status:** Completed

**What was fixed:**
- Improved the layout of `EditTaxiBurnView` for better iPad compatibility
- Added proper spacing and labels for input fields
- Used `.roundedBorder` text field style for better visibility
- Added monospaced font for numeric inputs
- Added `.presentationDetents([.medium, .large])` for better iPad sheet sizing

**File Changed:**
- `CieloTracker_iOS/CieloTracker/Views/EditTaxiBurnView.swift`

**Changes Made:**
1. **Better Layout:**
   - Wrapped each TextField in a VStack with a label
   - Added proper spacing between fields
   - Used `.padding(.vertical, 4)` for better spacing

2. **Better Input Styling:**
   - Changed to `.textFieldStyle(.roundedBorder)` for clearer borders
   - Added `.font(.system(.body, design: .monospaced))` for numeric inputs
   - Labels are now above fields with `.caption` font

3. **Better iPad Support:**
   - Added `.presentationDetents([.medium, .large])` to allow resizing
   - Sheet can now be medium or large on iPad
   - Better handling of floating keyboard on iPad

**Before:**
- Input fields were directly in Form sections
- No clear labels
- Basic text field styling
- Fixed sheet size

**After:**
- Input fields have clear labels above them
- Rounded border styling for better visibility
- Monospaced font for numeric inputs
- Flexible sheet sizing for iPad

**To Test:**
1. Open the app on iPad
2. Long press on a flight
3. Tap "Edit Taxi & Burn"
4. The sheet should display properly with:
   - Clear labels above input fields
   - Rounded border text fields
   - Proper spacing
   - Ability to resize the sheet

---

## Summary

Both issues have been resolved:

1. ✅ **Complete TAF parsing logic** ported from `pro.html` to iOS
2. ✅ **iPad input formatting** fixed with better layout and styling

The TAF parsing now matches the web app's logic exactly, ensuring consistent alternate requirement calculations. The iPad input view now has a much better user experience with clear labels and proper formatting.

