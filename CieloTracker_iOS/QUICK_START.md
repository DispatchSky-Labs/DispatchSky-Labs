# CieloTracker Pro iOS - Quick Start Guide

## 🚀 Fastest Way to Get Started

### 1. Create Xcode Project (5 minutes)

1. Open Xcode
2. File → New → Project
3. iOS → App → Next
4. Configure:
   - Product Name: `CieloTracker Pro` (or `CieloTrackerPro` if spaces not allowed - display name will be "CieloTracker Pro")
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: **SwiftData** ⚠️
   - Minimum: **iOS 15.0**
5. Click Next → Create

### 2. Add Files (2 minutes)

1. Delete default `ContentView.swift` and `CieloTrackerApp.swift`
2. Drag all files from `CieloTracker_iOS/CieloTracker/` into Xcode
3. Organize into folders:
   - `Models/` → Flight.swift, WeatherData.swift
   - `Services/` → WeatherService.swift, FlightSyncService.swift
   - `Views/` → All view files
   - `ViewModels/` → FlightListViewModel.swift
4. Make sure "Copy items if needed" is checked
5. Select target: `CieloTracker`

### 3. Configure Info.plist (1 minute)

Add App Transport Security settings (already in provided Info.plist):
- Network permissions for weather API

### 4. Build and Run (1 minute)

1. Select iPhone Simulator
2. Press ⌘R
3. App should launch

### 5. Sync Flights (2 minutes)

**From Web App:**
1. Open `pro_beta.html` in browser
2. Open DevTools (F12)
3. Console tab
4. Run:
   ```javascript
   JSON.stringify(JSON.parse(localStorage.getItem('ct_pro_flights')))
   ```
5. Copy output

**To iOS App:**
1. Open app
2. Tap menu (⋯) → "Sync"
3. Paste JSON
4. Tap "Import Flights"
5. ✅ Flights appear!

## 📱 Features

- ✅ View flights from web app
- ✅ Real-time weather (METAR/TAF)
- ✅ Tap ICAO codes to view weather
- ✅ Sync via JSON import
- ✅ Add flights manually
- ✅ Auto-refresh weather

## 🔄 Sync Options

### Current: JSON Import
- Export from web app console
- Paste into iOS app
- Import flights

### Recommended: iCloud Sync
1. Enable CloudKit in Xcode
2. Add "iCloud" capability
3. Update ModelConfiguration:
   ```swift
   cloudKitDatabase: .automatic
   ```
4. Automatic sync across devices!

## 📋 Files Created

All files are in `CieloTracker_iOS/CieloTracker/`:

- **App:** `CieloTrackerApp.swift`
- **Models:** `Flight.swift`, `WeatherData.swift`
- **Services:** `WeatherService.swift`, `FlightSyncService.swift`
- **Views:** `ContentView.swift`, `FlightListView.swift`, `WeatherDetailView.swift`, `SyncOptionsView.swift`, `AddFlightView.swift`
- **ViewModels:** `FlightListViewModel.swift`
- **Config:** `Info.plist`

## 🎯 Next Steps

1. ✅ Test basic functionality
2. ✅ Test sync from web app
3. ✅ Test weather loading
4. ⬜ Enable iCloud sync (optional)
5. ⬜ Add push notifications
6. ⬜ Add widget support

## 🆘 Troubleshooting

**Build fails?**
- Check all files are in project
- Verify target membership
- Check iOS deployment target (15.0+)

**Weather not loading?**
- Check network permissions
- Verify API URL
- Check console for errors

**Sync not working?**
- Verify JSON format
- Check all required fields
- Ensure model context saves

## 📚 Documentation

- `README.md` - Full documentation
- `INSTALLATION.md` - Detailed setup
- `XCODE_SETUP.md` - Xcode-specific guide

## 🎉 You're Done!

Your iOS app is ready to sync with the web app!

