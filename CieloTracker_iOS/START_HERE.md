# 🚀 CieloTracker Pro iOS - Start Here

## Quick Overview

Complete iOS SwiftUI app that syncs flight data from the web app (pro_beta.html) to your iPhone. Monitor flights and weather on the go!

## 📱 What You Get

- ✅ View flights from web app on iPhone
- ✅ Real-time weather data (METAR/TAF)
- ✅ Weather triggers and alerts
- ✅ Tap ICAO codes to view weather details
- ✅ Sync with web app via JSON import
- ✅ Add flights manually
- ✅ Automatic weather refresh

## 🎯 Quick Start (5 Minutes)

### 1. Create Xcode Project

1. Open Xcode
2. File → New → Project (⌘⇧N)
3. Choose **iOS** → **App**
4. Click **Next**

### 2. Configure Project

- **Product Name:** `CieloTracker Pro` (or `CieloTrackerPro` if spaces not allowed - display name will be "CieloTracker Pro")
- **Team:** Select your team (or "None" for simulator)
- **Organization Identifier:** `com.yourname`
- **Interface:** **SwiftUI** ⚠️
- **Language:** **Swift**
- **Storage:** **SwiftData** ⚠️ **IMPORTANT!**
- **Minimum:** **iOS 15.0**

### 3. Add Files

1. **Delete default files:**
   - `ContentView.swift`
   - `CieloTrackerApp.swift`

2. **Add project files:**
   - Drag all files from `CieloTracker_iOS/CieloTracker/` into Xcode
   - Organize into folders:
     - `Models/` → Flight.swift, WeatherData.swift
     - `Services/` → WeatherService.swift, FlightSyncService.swift
     - `Views/` → All view files
     - `ViewModels/` → FlightListViewModel.swift
   - Make sure "Copy items if needed" is checked
   - Select target: `CieloTracker`

### 4. Configure Info.plist

- Add App Transport Security settings (already in provided Info.plist)
- Or merge settings with existing Info.plist

### 5. Build and Run

1. Select iPhone Simulator
2. Press ⌘R
3. App launches! 🎉

### 6. Sync Flights

**From Web App:**
1. Open `pro_beta.html` in browser
2. Open DevTools (F12)
3. Console tab
4. Run:
   ```javascript
   JSON.stringify(JSON.parse(localStorage.getItem('ct_pro_flights')))
   ```
5. Copy JSON output

**To iOS App:**
1. Open iOS app
2. Tap menu (⋯) → "Sync"
3. Paste JSON
4. Tap "Import Flights"
5. ✅ Flights appear!

## 📁 Project Structure

```
CieloTracker/
├── CieloTrackerApp.swift          # App entry point
├── Info.plist                      # App configuration
├── Models/
│   ├── Flight.swift                # Flight data model
│   └── WeatherData.swift           # Weather data model
├── Services/
│   ├── WeatherService.swift        # Weather API client
│   └── FlightSyncService.swift     # Sync service
├── Views/
│   ├── ContentView.swift           # Main view
│   ├── FlightListView.swift        # Flight list
│   ├── WeatherDetailView.swift     # Weather modal
│   ├── SyncOptionsView.swift       # Sync screen
│   └── AddFlightView.swift         # Add flight form
└── ViewModels/
    └── FlightListViewModel.swift   # View model
```

## 🔄 Sync Methods

### Method 1: JSON Import (Current) ✅

**Pros:**
- Simple and fast
- Works immediately
- No backend required

**Cons:**
- Manual import/export
- Not real-time

**How to use:**
1. Export from web app console
2. Paste into iOS app
3. Import flights

### Method 2: iCloud Sync (Recommended) ⭐

**Pros:**
- Automatic sync
- Real-time updates
- Works across devices
- No manual import

**Cons:**
- Requires Apple Developer account
- Needs CloudKit setup

**How to enable:**
1. Enable CloudKit in Xcode
2. Add "iCloud" capability
3. Check "CloudKit"
4. Update ModelConfiguration:
   ```swift
   cloudKitDatabase: .automatic
   ```

### Method 3: Shared Backend API (Future)

**Pros:**
- Real-time sync
- Works across all devices
- Automatic updates
- No manual import

**Cons:**
- Requires backend setup
- More complex

**How to implement:**
1. Create Firebase/Supabase backend
2. Add API client to web app
3. Add API client to iOS app
4. Sync via API

## 📚 Documentation

- **README.md** - Full documentation
- **INSTALLATION.md** - Detailed setup instructions
- **QUICK_START.md** - Quick start guide
- **XCODE_SETUP.md** - Xcode-specific setup
- **SYNC_GUIDE.md** - Sync instructions
- **PROJECT_SUMMARY.md** - Project overview

## 🎯 Features

### ✅ Implemented
- View flights from web app
- Real-time weather data
- Weather triggers and alerts
- Tap ICAO codes to view weather
- Sync with web app
- Manual flight entry
- Automatic weather refresh

### 🔄 In Progress
- iCloud sync (optional)
- Background refresh

### 📋 Future
- Push notifications
- Widget support
- Watch app
- Real-time sync
- Offline mode

## 🐛 Troubleshooting

### Build Errors
- **Fix:** Check all files are in project
- **Fix:** Verify target membership
- **Fix:** Check iOS deployment target (15.0+)

### Sync Issues
- **Fix:** Verify JSON format
- **Fix:** Check all required fields
- **Fix:** Ensure model context saves

### Weather Not Loading
- **Fix:** Check network permissions
- **Fix:** Verify API URL
- **Fix:** Check console for errors

## 🎉 Success!

Your iOS app is ready to sync with the web app!

1. ✅ Create Xcode project
2. ✅ Add files
3. ✅ Build and run
4. ✅ Sync flights
5. ✅ Monitor on iPhone!

## 📱 Next Steps

1. Test basic functionality
2. Test sync from web app
3. Test weather loading
4. Enable iCloud sync (optional)
5. Add push notifications (future)
6. Add widget support (future)

## 🔗 Related Files

- **Web App:** `pro_beta.html`
- **Export Helper:** `export_flights_for_ios.js`
- **Documentation:** See above

## 📝 Notes

- **Minimum iOS:** 15.0+
- **Xcode Version:** 14.0+
- **Swift Version:** 5.9+
- **SwiftData:** Required
- **Network:** Required for weather

## 🆘 Need Help?

1. Check documentation files
2. Review README.md
3. Check INSTALLATION.md
4. Review XCODE_SETUP.md
5. Check SYNC_GUIDE.md

## 🎯 Best Solution

**For Production:** Use **iCloud Sync** (Method 2)
- Automatic sync
- Real-time updates
- Works across devices
- No manual import

**For Testing:** Use **JSON Import** (Method 1)
- Simple and fast
- Works immediately
- No backend required

## 🚀 Ready to Go!

Your iOS app is complete and ready to use!

1. Create Xcode project
2. Add files
3. Build and run
4. Sync flights
5. Monitor on iPhone!

---

**Created for:** CieloTracker iOS Sync
**Version:** 1.0
**Status:** Ready to Use! ✅

