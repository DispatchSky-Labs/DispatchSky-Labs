# Fix: Multiple Commands Produce Info.plist - Remove from Copy Bundle Resources

## Problem
Info.plist is in "Copy Bundle Resources" build phase, causing Xcode to try to copy it AND process it separately.

**Error Message:**
```
The Copy Bundle Resources build phase contains this target's Info.plist file
```

## Solution: Remove Info.plist from Copy Bundle Resources

### Step 1: Open Build Phases

1. **Select your project** (blue icon at top of Project Navigator)

2. **Select your target** (`CielotTrackerPro`) in the main editor

3. **Click "Build Phases" tab** (at the top of the editor)

4. **Expand "Copy Bundle Resources"** section (click the disclosure triangle)

### Step 2: Remove Info.plist

1. **Look for `Info.plist` in the list**
   - It will show the full path: `/Users/sam/Library/Mobile Documents/com~apple~CloudDocs/CielotTrackerPro/CielotTrackerPro/Info.plist`

2. **Select `Info.plist`** in the list

3. **Click the minus (-) button** at the bottom of the list
   - Or press the **Delete** key on your keyboard

4. **Confirm removal** if prompted

**Important:** Info.plist must NOT be in Copy Bundle Resources. Xcode processes it automatically.

### Step 3: Verify Build Settings

1. **Go to "Build Settings" tab**

2. **Search for "Info.plist File"** (INFOPLIST_FILE)

3. **Verify the path** is set to:
   - `CielotTrackerPro/Info.plist`
   - Or the correct relative path to your Info.plist

4. **Search for "Generate Info.plist File"** (GENERATE_INFOPLIST_FILE)

5. **Verify it's set to: NO**
   - We're using our own Info.plist, not generating one

### Step 4: Clean and Rebuild

1. **Clean Build Folder:** Press **⌘⇧K** (Product → Clean Build Folder)

2. **Rebuild:** Press **⌘B** (Product → Build)

## Visual Guide

```
1. Select Project (blue icon)
   └── Select Target: "CielotTrackerPro"
       └── Build Phases tab
           └── Expand "Copy Bundle Resources"
               └── Find: "Info.plist"
                   └── SELECT IT
                       └── Click MINUS (-) button
                           └── Confirm removal
```

## What Should Be in Copy Bundle Resources

**Should be in Copy Bundle Resources:**
- ✅ Assets.xcassets (automatic)
- ✅ Images, fonts, data files
- ✅ Other resources your app needs

**Should NOT be in Copy Bundle Resources:**
- ❌ Info.plist (processed automatically)
- ❌ Source files (.swift)
- ❌ Storyboards (if using SwiftUI)

## Verification Checklist

After removing Info.plist from Copy Bundle Resources:

- [ ] Info.plist is NOT in Copy Bundle Resources
- [ ] INFOPLIST_FILE build setting points to correct path
- [ ] GENERATE_INFOPLIST_FILE is set to NO
- [ ] Cleaned build folder (⌘⇧K)
- [ ] Rebuilt project (⌘B)
- [ ] No "Multiple commands produce" error
- [ ] Project builds successfully

## Why This Happens

Xcode has two ways to handle Info.plist:
1. **Automatic processing** (via INFOPLIST_FILE setting) - This is what we want
2. **Manual copying** (via Copy Bundle Resources) - This conflicts with #1

When both happen, Xcode tries to create the same file twice, causing the conflict.

## Alternative: If You Can't Find It

If Info.plist is not visible in Copy Bundle Resources:

1. **Check if it's hidden:**
   - Look for any file with "Info" in the name
   - Check for files with full paths

2. **Use search in Build Phases:**
   - Type "Info" in the search box
   - This will filter the list

3. **Check all build phases:**
   - Look in "Compile Sources"
   - Look in "Link Binary With Libraries"
   - Info.plist should only be referenced in Build Settings, not in build phases

## Still Having Issues?

If the error persists after removing Info.plist:

1. **Close Xcode completely**

2. **Delete DerivedData:**
   - Go to: `~/Library/Developer/Xcode/DerivedData`
   - Delete the folder: `CielotTrackerPro-*`
   - (This forces Xcode to rebuild everything)

3. **Open Xcode**

4. **Clean Build Folder:** ⌘⇧K

5. **Rebuild:** ⌘B

## Success!

After fixing:
- ✅ No "Multiple commands produce" error
- ✅ No "Copy Bundle Resources contains Info.plist" warning
- ✅ Project builds successfully
- ✅ App can be signed and run


