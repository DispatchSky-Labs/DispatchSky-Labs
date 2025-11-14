# Xcode Project Setup Guide

## Step-by-Step Instructions

### 1. Create New Xcode Project

1. Open Xcode
2. File → New → Project (or ⌘⇧N)
3. Select **iOS** → **App**
4. Click **Next**

### 2. Configure Project Options

**Product Information:**
- Product Name: `CieloTracker Pro` (or `CieloTrackerPro` if spaces not allowed - display name will be "CieloTracker Pro" in Info.plist)
- Team: Select your Apple Developer Team (or "None" for simulator)
- Organization Identifier: `com.yourname` (e.g., `com.sam`)
- Bundle Identifier: Will auto-generate (e.g., `com.sam.CieloTrackerPro` or similar)

**Interface Options:**
- Interface: **SwiftUI**
- Language: **Swift**
- Storage: **SwiftData** ⚠️ **Important: Select SwiftData**
- Include Tests: ✅ (optional)

**Project Options:**
- Minimum Deployment: **iOS 15.0**
- Click **Next**
- Choose location and click **Create**

### 3. Remove Default Files

1. In Project Navigator, delete:
   - `ContentView.swift` (we'll add our own)
   - `CieloTrackerApp.swift` (we'll add our own)
   - `Assets.xcassets` (keep if you want)
   - `Preview Content` (optional)

### 4. Add Project Files

**Create Folder Structure:**

1. Right-click on `CieloTracker` folder in Navigator
2. Select **New Group** and create:
   - `Models`
   - `Services`
   - `Views`
   - `ViewModels`

**Add Files:**

Drag all files from `CieloTracker_iOS/CieloTracker/` into Xcode:

1. **Models:**
   - `Flight.swift` → `Models/`
   - `WeatherData.swift` → `Models/`

2. **Services:**
   - `WeatherService.swift` → `Services/`
   - `FlightSyncService.swift` → `Services/`

3. **Views:**
   - `ContentView.swift` → `Views/`
   - `FlightListView.swift` → `Views/`
   - `WeatherDetailView.swift` → `Views/`
   - `SyncOptionsView.swift` → `Views/`
   - `AddFlightView.swift` → `Views/`

4. **ViewModels:**
   - `FlightListViewModel.swift` → `ViewModels/`

5. **App:**
   - `CieloTrackerApp.swift` → Root level

6. **Configuration:**
   - `Info.plist` → Replace default (or merge settings)

**Important:** 
- Make sure "Copy items if needed" is checked
- Select your target (`CieloTracker`) in "Add to targets"
- Use "Create groups" (not "Create folder references")

### 5. Configure Info.plist

1. Select `Info.plist` in Navigator
2. Add or verify these keys:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <false/>
    <key>NSExceptionDomains</key>
    <dict>
        <key>us-central1-handy-coil-469714-j2.cloudfunctions.net</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <false/>
            <key>NSIncludesSubdomains</key>
            <true/>
        </dict>
    </dict>
</dict>
```

### 6. Configure Signing

1. Select project in Navigator
2. Select **CieloTracker** target
3. Go to **Signing & Capabilities** tab
4. Check **"Automatically manage signing"**
5. Select your **Team**
6. Verify **Bundle Identifier** is unique

### 7. (Optional) Enable iCloud Sync

1. In **Signing & Capabilities** tab
2. Click **"+ Capability"**
3. Add **"iCloud"**
4. Check **"CloudKit"**
5. (Optional) Check **"Key-value storage"**

### 8. Build and Run

1. Select target device:
   - iPhone Simulator (any iPhone)
   - Or your physical iPhone (requires Apple Developer account)

2. Build:
   - Press ⌘R (or Product → Run)
   - Wait for build to complete

3. Run:
   - App will launch in Simulator/device
   - If first run, grant any permissions

### 9. Test Sync

1. **Export from Web App:**
   - Open `pro_beta.html` in browser
   - Open DevTools (F12)
   - Console tab
   - Run: `JSON.stringify(JSON.parse(localStorage.getItem('ct_pro_flights')))`
   - Copy output

2. **Import to iOS App:**
   - Open app
   - Tap menu (⋯) → "Sync"
   - Paste JSON
   - Tap "Import Flights"
   - Verify flights appear

### 10. Verify Weather Loading

1. After importing flights
2. Tap menu (⋯) → "Refresh Weather"
3. Wait for weather to load
4. Tap an ICAO code (e.g., KORD)
5. Verify weather modal appears

## Project Structure (Final)

```
CieloTracker/
├── CieloTrackerApp.swift
├── Info.plist
├── Models/
│   ├── Flight.swift
│   └── WeatherData.swift
├── Services/
│   ├── WeatherService.swift
│   └── FlightSyncService.swift
├── Views/
│   ├── ContentView.swift
│   ├── FlightListView.swift
│   ├── WeatherDetailView.swift
│   ├── SyncOptionsView.swift
│   └── AddFlightView.swift
└── ViewModels/
    └── FlightListViewModel.swift
```

## Common Issues

### "Cannot find type 'Flight' in scope"
- **Fix:** Make sure all files are added to the target
- Check: Select file → File Inspector → Target Membership → Check "CieloTracker"

### "SwiftData not available"
- **Fix:** Check iOS deployment target is 15.0+
- Check: Project Settings → Deployment Info → iOS Deployment Target

### "Network request failed"
- **Fix:** Verify Info.plist has App Transport Security settings
- Check: API URL is accessible
- Test: Open URL in Safari

### Build errors
- **Fix:** Clean build folder (⌘⇧K)
- **Fix:** Delete derived data
- **Fix:** Restart Xcode

## Next Steps

1. ✅ Test basic functionality
2. ✅ Test sync from web app
3. ✅ Test weather loading
4. ⬜ Enable iCloud sync (optional)
5. ⬜ Add push notifications
6. ⬜ Add widget support
7. ⬜ Test on physical device

## Support

If you encounter issues:
1. Check Xcode console for errors
2. Verify all files are in project
3. Check target membership
4. Verify API connectivity
5. Review README.md for details

