# CieloTracker Pro iOS App

iOS app that syncs with the CieloTracker web app (pro_beta.html) to monitor flights and weather on your iPhone.

## Features

- ✅ View flights from web app
- ✅ Real-time weather data (METAR/TAF)
- ✅ Weather triggers and alerts
- ✅ Tap ICAO codes to view weather details
- ✅ Sync with web app via JSON import/export
- ✅ Automatic weather refresh

## Setup Instructions

### 1. Create Xcode Project

1. Open Xcode
2. Create a new project:
   - Choose "iOS" → "App"
   - Product Name: `CieloTracker Pro` (or `CieloTrackerPro` if spaces not allowed - display name will be "CieloTracker Pro")
   - Interface: `SwiftUI`
   - Language: `Swift`
   - Storage: `SwiftData` (or Core Data)
   - Minimum iOS: 15.0

### 2. Add Files to Project

Copy all files from this directory into your Xcode project:
- `CieloTrackerApp.swift` → App entry point
- `Models/` → Flight and WeatherData models
- `Services/` → WeatherService and FlightSyncService
- `Views/` → All SwiftUI views
- `ViewModels/` → FlightListViewModel

### 3. Configure Info.plist

Add network permissions in Info.plist:
- The provided Info.plist includes App Transport Security settings for the weather API

### 4. Build and Run

1. Select your iPhone or simulator
2. Build and run (⌘R)

## Sync Methods

### Method 1: JSON Import (Current Implementation)

**From Web App:**
1. Open pro_beta.html in browser
2. Open DevTools (F12 or Cmd+Option+I)
3. Go to Console tab
4. Run: `JSON.stringify(JSON.parse(localStorage.getItem('ct_pro_flights')))`
5. Copy the JSON output

**In iOS App:**
1. Tap the menu (⋯) in top right
2. Tap "Sync"
3. Paste JSON into text field
4. Tap "Import Flights"

### Method 2: iCloud Sync (Recommended for Production)

To enable iCloud sync:

1. **Enable CloudKit in Xcode:**
   - Select your project
   - Go to "Signing & Capabilities"
   - Add "iCloud" capability
   - Check "CloudKit"

2. **Update ModelConfiguration:**
   ```swift
   let modelConfiguration = ModelConfiguration(
       schema: schema,
       cloudKitDatabase: .automatic
   )
   ```

3. **Benefits:**
   - Automatic sync across devices
   - Real-time updates
   - No manual import/export needed

### Method 3: Shared Backend API (Future Enhancement)

Create a shared backend (Firebase, Supabase, or custom API) that both web and iOS apps can read/write to.

## Project Structure

```
CieloTracker/
├── CieloTrackerApp.swift       # App entry point
├── Models/
│   ├── Flight.swift            # Flight data model
│   └── WeatherData.swift       # Weather data model
├── Services/
│   ├── WeatherService.swift    # Weather API client
│   └── FlightSyncService.swift # Sync service
├── Views/
│   ├── ContentView.swift       # Main view
│   ├── FlightListView.swift    # Flight list
│   ├── WeatherDetailView.swift # Weather modal
│   └── SyncOptionsView.swift   # Sync options
└── ViewModels/
    └── FlightListViewModel.swift # View model
```

## API Integration

The app uses the same weather API as the web app:
- **URL:** `https://us-central1-handy-coil-469714-j2.cloudfunctions.net/process-weather-data-clean`
- **Method:** GET
- **Parameters:** `ids`, `ceil`, `vis`, `metar`, `taf`, `alpha`, `filter`

## Future Enhancements

- [ ] Push notifications for flight alerts
- [ ] Background refresh
- [ ] Widget support
- [ ] Watch app
- [ ] Real-time sync via WebSocket
- [ ] Offline mode with cached data
- [ ] Dark mode support
- [ ] Haptic feedback for alerts

## Troubleshooting

### Build Errors
- Ensure SwiftData is enabled in project settings
- Check that all files are added to the target
- Verify iOS deployment target is 15.0+

### Sync Issues
- Verify JSON format matches web app structure
- Check that all required fields are present
- Ensure network connectivity for weather API

### Weather Not Loading
- Check network permissions in Info.plist
- Verify API URL is accessible
- Check console for error messages

## License

Same as main project.

