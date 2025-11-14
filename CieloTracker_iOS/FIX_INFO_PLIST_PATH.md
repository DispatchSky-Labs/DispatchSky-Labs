# Fix: Cannot Code Sign - Info.plist Not Found

## Problem
Xcode can't find the Info.plist file, so it can't code sign the app.

## Solution: Set INFOPLIST_FILE Build Setting

### Step 1: Locate Your Info.plist File

1. **In Project Navigator**, find `Info.plist`
2. **Note the location**:
   - It should be at: `CielotTrackerPro/Info.plist`
   - Or: `Info.plist` (if at root level)

### Step 2: Set INFOPLIST_FILE Build Setting

1. **Select your project** (blue icon at top of Project Navigator)

2. **Select your target** (`CielotTrackerPro`) in the main editor

3. **Go to "Build Settings" tab**

4. **Search for "Info.plist"** in the search bar at the top

5. **Find "Info.plist File" setting** (INFOPLIST_FILE)

6. **Set the value**:
   - **Double-click** on the value field (should be empty or have a path)
   - Enter: `CielotTrackerPro/Info.plist`
   - Or if Info.plist is at root: `Info.plist`
   - Press **Enter**

### Step 3: Verify Generate Info.plist Setting

1. **Still in Build Settings**, search for "Generate Info.plist"

2. **Find "Generate Info.plist File" setting** (GENERATE_INFOPLIST_FILE)

3. **Set to: NO**
   - We're using our own Info.plist file, not generating one

### Step 4: Verify Info.plist Location

1. **Select `Info.plist`** in Project Navigator

2. **Open File Inspector** (right sidebar, or press ⌘⌥1)

3. **Check "Location":**
   - Should show the path to `Info.plist`
   - Should be relative to project root

4. **Check "Target Membership":**
   - Make sure `CielotTrackerPro` is **checked** ✅
   - Test targets should **NOT** be checked

### Step 5: Clean and Rebuild

1. **Clean Build Folder:** ⌘⇧K (Product → Clean Build Folder)

2. **Rebuild:** ⌘B (Product → Build)

## Alternative: If Info.plist is in a Different Location

If your Info.plist is in a different location:

1. **Check actual path** in File Inspector
2. **Set INFOPLIST_FILE** to match that path
3. **Example paths:**
   - `CielotTrackerPro/Info.plist` (most common)
   - `Info.plist` (if at root)
   - `CieloTracker_iOS/CieloTracker/Info.plist` (if still in source folder)

## Quick Checklist

- [ ] Found Info.plist in Project Navigator
- [ ] Set INFOPLIST_FILE build setting to correct path
- [ ] Set GENERATE_INFOPLIST_FILE to NO
- [ ] Verified Info.plist target membership (main app target only)
- [ ] Cleaned build folder (⌘⇧K)
- [ ] Rebuilt project (⌘B)

## Visual Guide

```
1. Select Project (blue icon)
   └── Select Target: "CielotTrackerPro"
       └── Build Settings tab
           └── Search: "Info.plist"
               └── Find: "Info.plist File" (INFOPLIST_FILE)
                   └── Set value: "CielotTrackerPro/Info.plist"
                       └── Search: "Generate Info.plist"
                           └── Set: "Generate Info.plist File" = NO
```

## Verification

After fixing:
- ✅ No "Cannot code sign" error
- ✅ No "Info.plist not found" error
- ✅ Project builds successfully
- ✅ App can be signed and run

## If Still Not Working

1. **Check Info.plist exists:**
   - Verify file is in project
   - Check File Inspector → Location

2. **Try full path:**
   - If relative path doesn't work, try full path
   - Example: `/Users/sam/Sadiom/CieloTracker_iOS/CieloTracker/Info.plist`
   - (But relative path is preferred)

3. **Re-add Info.plist:**
   - Remove Info.plist from project (don't delete file)
   - Re-add it to project
   - Make sure "Copy items if needed" is checked
   - Verify target membership


