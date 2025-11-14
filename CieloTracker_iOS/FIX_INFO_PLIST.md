# Fix: Multiple Commands Produce Info.plist

## Problem
Xcode is trying to generate `Info.plist` automatically AND include your manual `Info.plist` file, causing a conflict.

## Solution

### Option 1: Remove Info.plist from Copy Bundle Resources (Recommended)

1. **Select your project** in Project Navigator (blue icon at top)

2. **Select your target** (`CielotTrackerPro`) in the main editor

3. **Go to "Build Phases" tab**

4. **Expand "Copy Bundle Resources"**

5. **Look for `Info.plist` in the list**
   - If you see `Info.plist` here, **remove it**:
     - Select `Info.plist`
     - Press **Delete** key
     - Or click the **-** button at the bottom
   - **Info.plist should NOT be in Copy Bundle Resources**

6. **Clean Build Folder** (⌘⇧K)

7. **Rebuild** (⌘B)

### Option 2: Check Build Settings

1. **Select your target** (`CielotTrackerPro`)

2. **Go to "Build Settings" tab**

3. **Search for "Info.plist"** in the search bar

4. **Find "Info.plist File" setting**

5. **Verify the path** should be:
   - `CielotTrackerPro/Info.plist`
   - Or just `Info.plist` (if at root)

6. **Make sure "Generate Info.plist File" is set to NO**
   - Search for "Generate Info.plist"
   - Set it to **NO** (we're using our own Info.plist)

7. **Clean Build Folder** (⌘⇧K)

8. **Rebuild** (⌘B)

### Option 3: Remove Info.plist from Project (If Duplicated)

1. **Check Project Navigator** for multiple `Info.plist` files
   - You should only have ONE `Info.plist`
   - Delete any duplicates

2. **Verify Info.plist location:**
   - Should be in root level of project
   - Should be: `CielotTrackerPro/Info.plist`

3. **Check File Inspector:**
   - Select `Info.plist`
   - Open File Inspector (right sidebar)
   - Under "Target Membership", make sure only `CielotTrackerPro` is checked
   - Under "Location", verify it's not duplicated

## Step-by-Step (Most Common Fix)

1. **Open Xcode**

2. **Select project** (blue icon)

3. **Select target** (`CielotTrackerPro`)

4. **Build Phases tab**

5. **Expand "Copy Bundle Resources"**

6. **If `Info.plist` is listed:**
   - Select it
   - Press **Delete**
   - Click **Remove** if prompted

7. **Build Settings tab**

8. **Search: "Generate Info.plist"**

9. **Set to: NO**

10. **Clean Build Folder:** ⌘⇧K

11. **Rebuild:** ⌘B

## Verification

After fixing, you should:
- ✅ No "Multiple commands produce" error
- ✅ Project builds successfully
- ✅ App launches correctly

## Alternative: Use Automatic Info.plist (Not Recommended)

If you want Xcode to generate Info.plist automatically:

1. **Delete** your manual `Info.plist` file
2. **Build Settings** → Search "Generate Info.plist" → Set to **YES**
3. **Add settings** from your Info.plist to Build Settings:
   - Bundle Display Name → "CieloTracker Pro"
   - App Transport Security → Add exceptions
   - etc.

**But this is more work - Option 1 is easier!**


