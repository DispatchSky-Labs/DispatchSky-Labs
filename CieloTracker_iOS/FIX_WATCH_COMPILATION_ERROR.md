# Fix Watch Extension Compilation Errors

The bundle file can't find `CieloTrackerWatchWidget` and `CieloTrackerWatchWidgetExtensionControl`. This usually means the files aren't in the same target.

## Solution: Check Target Membership

1. **In Xcode, select `CieloTrackerWatchWidget.swift`**
2. **Open the File Inspector** (right sidebar, or View → Inspectors → File)
3. **Under "Target Membership", make sure:**
   - ✅ `CieloTrackerWatchWidgetExtensionExtension` is checked
   - ❌ Other targets (like Watch App) should NOT be checked for this file

4. **Do the same for `CieloTrackerWatchWidgetExtensionControl.swift`:**
   - ✅ `CieloTrackerWatchWidgetExtensionExtension` should be checked

5. **Verify `CieloTrackerWatchWidgetExtensionBundle.swift`:**
   - ✅ `CieloTrackerWatchWidgetExtensionExtension` should be checked

## Alternative: Check Build Phases

1. **Select the `CieloTrackerWatchWidgetExtensionExtension` target**
2. **Go to "Build Phases" tab**
3. **Expand "Compile Sources"**
4. **Make sure ALL these files are listed and checked:**
   - ✅ `CieloTrackerWatchWidgetExtensionBundle.swift`
   - ✅ `CieloTrackerWatchWidget.swift`
   - ✅ `CieloTrackerWatchWidgetExtensionControl.swift`
   - ✅ `CieloTrackerWatchWidgetExtension.swift`

5. **If any are missing:**
   - Click "+" button
   - Add the missing files
   - Make sure checkboxes are checked

## If Files Are in Wrong Target

If `CieloTrackerWatchWidget.swift` is currently in the Watch App target but needs to be in the Extension:

1. **Select the file in Project Navigator**
2. **File Inspector → Target Membership**
3. **Uncheck the Watch App target**
4. **Check the Extension target** (`CieloTrackerWatchWidgetExtensionExtension`)

## Quick Fix Checklist

- [ ] All three files are in the same target (`CieloTrackerWatchWidgetExtensionExtension`)
- [ ] All files are in "Compile Sources" for the extension target
- [ ] No duplicate files in different targets
- [ ] Clean build folder and rebuild

## Most Common Issue

The `CieloTrackerWatchWidget.swift` file is probably in the Watch App target instead of the Extension target. Move it to the Extension target's "Compile Sources".

