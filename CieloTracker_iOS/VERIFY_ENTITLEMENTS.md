# Verify Entitlements Are Linked

The entitlements file looks correct, but Xcode might not be using it. Follow these steps:

## Step 1: Verify File is in Xcode Project

1. **In Xcode Project Navigator**, make sure `CielotTrackerPro.entitlements` is visible
2. **Click on it** - it should show the contents with `Production` set
3. **If you don't see it**, you need to add it:
   - Right-click in Project Navigator → Add Files to [Project]
   - Select the entitlements file
   - Make sure your target is checked

## Step 2: Link to Build Settings (CRITICAL)

1. **Select your project** (blue icon) in Project Navigator
2. **Select your app target** (`CielotTrackerPro`)
3. **Go to "Build Settings" tab**
4. **Search for:** `Code Signing Entitlements` (type "entitlements" in search box)
5. **Find the setting:** "Code Signing Entitlements"
6. **Set the value to:** `CieloTracker/CielotTrackerPro.entitlements`
   - Or just `CielotTrackerPro.entitlements` if it's at the root
   - The path should match where the file is in your project structure

## Step 3: Clean Everything

1. **Product → Clean Build Folder** (Shift+Cmd+K)
2. **Delete Derived Data:**
   - Xcode → Settings/Preferences → Locations
   - Click the arrow next to "Derived Data" path
   - Delete the folder for your project
3. **Quit and restart Xcode** (optional but recommended)

## Step 4: Rebuild and Archive

1. **Product → Archive** (this will create a fresh build)
2. **Wait for archive to complete**
3. **Click "Distribute App"**
4. **Choose "App Store Connect"**
5. **Click "Upload"**
6. **Validate** - the iCloud error should be gone

---

## If It Still Doesn't Work

If you still get the error after the above steps:

1. **Check if there are multiple entitlements files:**
   - Search in Xcode (Cmd+Shift+F) for: `icloud-container-environment`
   - Make sure ALL instances show `Production`

2. **Check the archive contents:**
   - After archiving, right-click the archive → "Show in Finder"
   - Right-click the `.xcarchive` → "Show Package Contents"
   - Navigate to: `Products/Applications/CielotTrackerPro.app/`
   - Look for `CielotTrackerPro` (the binary) or `.entitlements` file
   - You can check what entitlements are embedded with:
     ```bash
     codesign -d --entitlements - /path/to/CielotTrackerPro.app/CielotTrackerPro
     ```

3. **Verify in Xcode:**
   - Select your target → Signing & Capabilities
   - If you see iCloud capability, check what it shows
   - The entitlements file should be automatically linked when you add capabilities

---

## Also Fix the Watch App Issue

You still have the Watch app extension error. You need to either:

**Option A: Remove Watch App (if not needed)**
1. Select Watch app target → Delete
2. Select Watch extension target → Delete
3. Clean and rebuild

**Option B: Fix Watch App (if needed)**
- The Watch app needs a proper `@main` entry point
- This is a separate issue from entitlements

