# Fix Watch Extension __swift5_entry Error - Step by Step

Your Watch extension has the `@main` attribute correctly, but it's not being compiled into the binary. Follow these steps:

## Step 1: Check Swift Language Version

1. **Open your Xcode project**
2. **Select the project** (blue icon)
3. **Select the target:** `CieloTrackerWatchWidgetExtensionExtension`
4. **Go to "Build Settings" tab**
5. **In the search box, type:** `swift language`
6. **Find "Swift Language Version"**
7. **Set it to:** `Swift 5` (or `Swift 5.0`)
   - If it says "Inherited", click it and change to "Swift 5"
   - Make sure it's NOT "Swift 4" or empty

## Step 2: Verify Entry Point File is Compiled

1. **Still on the `CieloTrackerWatchWidgetExtensionExtension` target**
2. **Go to "Build Phases" tab**
3. **Expand "Compile Sources"**
4. **Look for:** `CieloTrackerWatchWidgetExtensionBundle.swift`
5. **Make sure it's checked** ✅
6. **If it's missing:**
   - Click the "+" button
   - Navigate to: `CieloTrackerWatchWidgetExtension/CieloTrackerWatchWidgetExtensionBundle.swift`
   - Add it
   - Make sure the checkbox is checked

## Step 3: Check Build Configuration

1. **Still on "Build Settings" for the extension target**
2. **Search for:** `swift compiler`
3. **Check these settings:**
   - **Swift Compiler - General → Swift Language Version:** `Swift 5`
   - **Swift Compiler - Code Generation → Optimization Level:** 
     - Debug: `None [-Onone]`
     - Release: `Optimize for Speed [-O]`

## Step 4: Verify Deployment Target

1. **In "Build Settings" for the extension target**
2. **Search for:** `deployment target`
3. **Find "watchOS Deployment Target"**
4. **Make sure it matches your Watch app** (e.g., `watchOS 10.0`)
5. **Also check the main Watch app target** - they should match

## Step 5: Clean Everything

1. **Product → Clean Build Folder** (Shift+Cmd+K)
2. **Delete Derived Data:**
   - Xcode → Settings/Preferences → Locations
   - Click the arrow next to "Derived Data" path
   - In Finder, find your project folder and delete it
3. **Quit Xcode completely**
4. **Reopen Xcode**
5. **Open your project**

## Step 6: Rebuild

1. **Product → Archive**
2. **Wait for it to complete**
3. **Distribute App → App Store Connect → Upload**
4. **Validate** - the error should be gone

## Step 7: If Still Not Working - Verify in Terminal

After archiving, you can verify the binary:

1. **Right-click the archive** → "Show in Finder"
2. **Right-click the `.xcarchive`** → "Show Package Contents"
3. **Navigate to:**
   ```
   Products/Applications/CielotTrackerPro.app/Watch/CieloTrackerWatchApp Watch App.app/PlugIns/CieloTrackerWatchWidgetExtensionExtension.appex/
   ```
4. **In Terminal, run:**
   ```bash
   otool -l "CieloTrackerWatchWidgetExtensionExtension" | grep __swift5_entry
   ```
5. **If you see output**, the entry point is there ✅
6. **If no output**, the entry point is missing ❌

## Common Issues & Fixes

### Issue: "Swift Language Version" is "Inherited"
- **Fix:** Click it, change from "Inherited" to "Swift 5" explicitly

### Issue: Entry point file not in Compile Sources
- **Fix:** Add `CieloTrackerWatchWidgetExtensionBundle.swift` to Compile Sources

### Issue: Multiple @main attributes
- **Fix:** Make sure ONLY `CieloTrackerWatchWidgetExtensionBundle.swift` has `@main` in the extension

### Issue: Build settings mismatch
- **Fix:** Make sure extension target and Watch app target have matching Swift versions

## Quick Checklist

- [ ] Swift Language Version = Swift 5 (not inherited)
- [ ] `CieloTrackerWatchWidgetExtensionBundle.swift` is in Compile Sources
- [ ] Deployment targets match between Watch app and extension
- [ ] Cleaned build folder and derived data
- [ ] Quit and reopened Xcode
- [ ] Rebuilt and archived

## Most Likely Fix

The most common issue is **Step 1** - the Swift Language Version is set to "Inherited" or the wrong version. Set it explicitly to "Swift 5" for the extension target.

