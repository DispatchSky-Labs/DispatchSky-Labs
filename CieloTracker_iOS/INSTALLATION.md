# CieloTracker Pro iOS - Installation Guide

## Quick Start

### Option 1: Create New Xcode Project (Recommended)

1. **Open Xcode** (version 14.0 or later)

2. **Create New Project:**
   - File → New → Project
   - Choose "iOS" → "App"
   - Click "Next"

3. **Configure Project:**
   - Product Name: `CieloTracker Pro` (or `CieloTrackerPro` if spaces not allowed - display name will be "CieloTracker Pro" in Info.plist)
   - Team: Select your development team
   - Organization Identifier: `com.yourname` (or your domain)
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: **SwiftData**
   - Minimum Deployment: **iOS 15.0**
   - Click "Next" and choose a location

4. **Add Files to Project:**
   - Delete the default `ContentView.swift` and `CieloTrackerApp.swift` that Xcode created
   - Drag all files from `CieloTracker_iOS/CieloTracker/` into your Xcode project
   - Make sure "Copy items if needed" is checked
   - Select your target in "Add to targets"

5. **Configure Project Settings:**
   - Select your project in Navigator
   - Go to "Signing & Capabilities"
   - Add your Apple Developer Team
   - (Optional) Add "iCloud" capability for sync

6. **Build and Run:**
   - Select your iPhone or Simulator
   - Press ⌘R to build and run

### Option 2: Use Provided Project Structure

If you prefer to use the exact structure provided:

1. **Create Xcode Project** as above
2. **Organize Files:**
   ```
   CieloTracker/
   ├── CieloTrackerApp.swift
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
   │   └── SyncOptionsView.swift
   └── ViewModels/
       └── FlightListViewModel.swift
   ```

## Sync Setup

### Method 1: JSON Import (Current)

1. **Export from Web App:**
   - Open `pro_beta.html` in browser
   - Open DevTools (F12 or Cmd+Option+I)
   - Go to Console tab
   - Run: `JSON.stringify(JSON.parse(localStorage.getItem('ct_pro_flights')))`
   - Copy the output

2. **Import to iOS App:**
   - Open iOS app
   - Tap menu (⋯) → "Sync"
   - Paste JSON
   - Tap "Import Flights"

### Method 2: iCloud Sync (Recommended)

1. **Enable CloudKit:**
   - In Xcode, select project
   - Go to "Signing & Capabilities"
   - Click "+ Capability"
   - Add "iCloud"
   - Check "CloudKit"

2. **Update Model Configuration:**
   - In `CieloTrackerApp.swift`, change:
   ```swift
   let modelConfiguration = ModelConfiguration(
       schema: schema,
       cloudKitDatabase: .automatic  // Add this
   )
   ```

3. **Benefits:**
   - Automatic sync across devices
   - Real-time updates
   - No manual import needed

## Troubleshooting

### Build Errors

**Error: "Cannot find type 'Flight' in scope"**
- Make sure all files are added to the target
- Check that `Flight.swift` is in the project

**Error: "SwiftData not available"**
- Ensure iOS deployment target is 15.0+
- Check Xcode version (14.0+)

**Error: "Network request failed"**
- Check Info.plist has App Transport Security settings
- Verify API URL is accessible
- Check device/simulator has network connection

### Runtime Issues

**Weather not loading:**
- Check network permissions
- Verify API URL in `WeatherService.swift`
- Check console for errors

**Sync not working:**
- Verify JSON format matches web app
- Check that all required fields are present
- Ensure model context is saved

## Testing

1. **Test on Simulator:**
   - Works well for UI testing
   - Network features work normally

2. **Test on Device:**
   - Requires Apple Developer account
   - Better for testing push notifications
   - Can test background refresh

3. **Test Sync:**
   - Export flights from web app
   - Import into iOS app
   - Verify all fields are correct
   - Check weather data loads

## Next Steps

- [ ] Enable iCloud sync for automatic syncing
- [ ] Add push notifications for alerts
- [ ] Implement background refresh
- [ ] Add widget support
- [ ] Create Watch app companion

## Support

For issues or questions:
1. Check console logs in Xcode
2. Verify API connectivity
3. Check JSON format matches web app
4. Review README.md for details

