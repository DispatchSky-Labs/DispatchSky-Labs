# Troubleshooting Guide

## Fixed: Combine Import Error ✅

**Problem:** `FlightListViewModel` had errors about missing Combine module.

**Solution:** Added `import Combine` to `FlightListViewModel.swift`

**Status:** ✅ Fixed

---

## Duplicate Output File Warning

If you see a "duplicate output file" warning, try these steps:

### Step 1: Remove Default Files

1. **Check for `Item.swift`**
   - In Xcode Project Navigator, look for `Item.swift`
   - If it exists, **delete it** (right-click → Delete → Move to Trash)
   - This is a default SwiftData template file we don't need

2. **Check for Duplicate `CieloTrackerApp.swift`**
   - Make sure you only have ONE `CieloTrackerApp.swift` file
   - Delete any default `CielotTrackerProApp.swift` (with different name)
   - Keep only the one from our project

### Step 2: Check Target Membership

1. **Select a file** (e.g., `FlightListViewModel.swift`)
2. Open **File Inspector** (right sidebar, or press ⌘⌥1)
3. Under **Target Membership**, check:
   - ✅ `CielotTrackerPro` (main app target)
   - ❌ `CielotTrackerProTests` (should NOT be checked)
   - ❌ `CielotTrackerProUITests` (should NOT be checked)

4. **Repeat for all source files:**
   - Models (Flight.swift, WeatherData.swift)
   - Services (WeatherService.swift, FlightSyncService.swift)
   - Views (all view files)
   - ViewModels (FlightListViewModel.swift)
   - CieloTrackerApp.swift

**Exception:** Test files should ONLY be in test targets, not the main app target.

### Step 3: Clean Build Folder

1. In Xcode, press **⌘⇧K** (Product → Clean Build Folder)
2. Or: **Product** → **Clean Build Folder**
3. This removes old build artifacts

### Step 4: Rebuild

1. Press **⌘B** to build
2. Check if warnings are gone

---

## Other Common Issues

### Issue: "Cannot find type 'Flight' in scope"

**Solution:**
1. Check that `Flight.swift` is in the project
2. Check target membership (should be in main app target)
3. Verify file is in `Models/` folder
4. Clean build folder (⌘⇧K) and rebuild

### Issue: "SwiftData not available"

**Solution:**
1. Check iOS Deployment Target is **15.0** or higher
2. Project Settings → General → Deployment Info → iOS
3. Verify SwiftData was selected during project creation

### Issue: "No such module 'SwiftData'"

**Solution:**
1. This shouldn't happen in Xcode 14+
2. Try: Clean build folder (⌘⇧K)
3. Restart Xcode
4. Verify Xcode version (14.0+ required)

### Issue: App crashes on launch

**Solution:**
1. Check console for error messages
2. Verify `CieloTrackerApp.swift` is the main entry point
3. Check that `@main` attribute is present
4. Verify Info.plist is correct
5. Check that all required files are in project

### Issue: Weather not loading

**Solution:**
1. Check network permissions in Info.plist
2. Verify API URL in `WeatherService.swift`
3. Check console for network errors
4. Test API URL in browser first

### Issue: Sync not working

**Solution:**
1. Verify JSON format matches expected structure
2. Check that all required fields are present
3. Ensure model context is saving
4. Check console for error messages

---

## Quick Fix Checklist

If you're having build issues:

- [ ] Added `import Combine` to `FlightListViewModel.swift` ✅
- [ ] Deleted `Item.swift` if it exists
- [ ] Deleted duplicate `CielotTrackerProApp.swift`
- [ ] Checked target membership for all files
- [ ] Removed test targets from source files
- [ ] Cleaned build folder (⌘⇧K)
- [ ] Rebuilt project (⌘B)
- [ ] Verified iOS Deployment Target is 15.0+
- [ ] Verified SwiftData is selected
- [ ] Verified all files are in project

---

## Still Having Issues?

1. **Check Xcode Console** for detailed error messages
2. **Check Build Log** (View → Navigators → Report Navigator)
3. **Verify File Locations** - all files should be in project
4. **Check Dependencies** - SwiftData, Combine should be available
5. **Restart Xcode** if issues persist

---

## Success Indicators

Your project is working correctly if:
- ✅ Project builds without errors (⌘B)
- ✅ No warnings in Issue Navigator
- ✅ App launches in simulator
- ✅ "CieloTracker Pro" appears in navigation bar
- ✅ "No Flights" message appears (or flights if synced)


