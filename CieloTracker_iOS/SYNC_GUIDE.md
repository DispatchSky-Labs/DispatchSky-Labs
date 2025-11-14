# CieloTracker Pro iOS - Sync Guide

## 🔄 How to Sync Flights from Web App to iOS

### Method 1: Console Export (Easiest)

1. **Open Web App:**
   - Open `pro_beta.html` in your browser
   - Make sure you have flights loaded

2. **Open Browser Console:**
   - **Chrome/Edge:** Press `F12` or `Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows)
   - **Safari:** Press `Cmd+Option+C` (Mac), then enable Develop menu in Preferences
   - **Firefox:** Press `F12` or `Cmd+Option+K` (Mac) / `Ctrl+Shift+K` (Windows)

3. **Export Flights:**
   - Go to **Console** tab
   - Paste this code and press Enter:
   ```javascript
   JSON.stringify(JSON.parse(localStorage.getItem('ct_pro_flights')))
   ```
   - Or use the helper script: `export_flights_for_ios.js`
   - Copy the JSON output

4. **Import to iOS App:**
   - Open iOS app
   - Tap menu (⋯) in top right
   - Tap "Sync"
   - Paste JSON into text field
   - Tap "Import Flights"
   - ✅ Done!

### Method 2: Using Export Helper Script

1. **Copy Helper Script:**
   - Open `export_flights_for_ios.js`
   - Copy the entire script

2. **Run in Browser Console:**
   - Open `pro_beta.html` in browser
   - Open DevTools (F12)
   - Go to Console tab
   - Paste script and press Enter
   - JSON is automatically copied to clipboard!

3. **Import to iOS:**
   - Open iOS app
   - Tap menu (⋯) → "Sync"
   - Paste JSON
   - Tap "Import Flights"

### Method 3: Manual JSON Export

1. **Get JSON from Web App:**
   - Open `pro_beta.html` in browser
   - Open DevTools (F12)
   - Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
   - Navigate to **Local Storage** → your domain
   - Find key: `ct_pro_flights`
   - Copy the value

2. **Format JSON:**
   - The value might be minified
   - Use a JSON formatter to make it readable
   - Or paste it directly (it should work)

3. **Import to iOS:**
   - Open iOS app
   - Tap menu (⋯) → "Sync"
   - Paste JSON
   - Tap "Import Flights"

## 📋 JSON Format

The JSON should be an array of flight objects:

```json
[
  {
    "id": "1234567890.123",
    "flight": "5302",
    "origin": "KSLC",
    "dest": "KDEN",
    "takeoffAlt": "",
    "alt1": "",
    "alt2": "",
    "etd": "1942",
    "taxiOut": "15",
    "burnoff": "240",
    "duration": "255",
    "eta": "2337",
    "triggers": [],
    "autoRemoveScheduled": false
  }
]
```

## 🔍 Verify Sync

After importing:

1. ✅ Check flights appear in list
2. ✅ Verify all fields are correct
3. ✅ Tap "Refresh Weather"
4. ✅ Tap an ICAO code to view weather
5. ✅ Verify weather data loads

## 🚨 Troubleshooting

### "No flights found"
- **Fix:** Make sure web app has flights loaded
- **Fix:** Check localStorage key is `ct_pro_flights`
- **Fix:** Verify JSON format is correct

### "Import failed"
- **Fix:** Check JSON format matches expected structure
- **Fix:** Verify all required fields are present
- **Fix:** Check for syntax errors in JSON

### "Invalid JSON"
- **Fix:** Verify JSON is valid (use JSON validator)
- **Fix:** Make sure JSON is not minified incorrectly
- **Fix:** Check for extra commas or missing quotes

### Flights import but weather doesn't load
- **Fix:** Tap "Refresh Weather" in menu
- **Fix:** Check network connection
- **Fix:** Verify API URL is accessible
- **Fix:** Check console for errors

## 🔄 Auto-Sync Options

### Option 1: iCloud Sync (Recommended)

Enable iCloud sync for automatic syncing:

1. **In Xcode:**
   - Select project
   - Go to "Signing & Capabilities"
   - Add "iCloud" capability
   - Check "CloudKit"

2. **Update Code:**
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
   - Works with web app if you add CloudKit backend

### Option 2: Shared Backend API

Create a shared backend (Firebase, Supabase, or custom API):

1. **Create Backend:**
   - Set up Firebase Firestore or Supabase
   - Create flights collection
   - Add authentication

2. **Update Web App:**
   - Add API calls to save/load flights
   - Replace localStorage with API calls

3. **Update iOS App:**
   - Add API client
   - Sync with backend instead of localStorage

4. **Benefits:**
   - Real-time sync
   - Automatic updates
   - Works across all devices
   - No manual import needed

### Option 3: WebSocket Sync

Create a WebSocket server for real-time sync:

1. **Create WebSocket Server:**
   - Node.js server with WebSocket
   - Handle flight updates
   - Broadcast to all clients

2. **Update Web App:**
   - Connect to WebSocket
   - Send flight updates
   - Receive updates from iOS

3. **Update iOS App:**
   - Connect to WebSocket
   - Send flight updates
   - Receive updates from web

4. **Benefits:**
   - Real-time sync
   - Instant updates
   - Works across all devices
   - No manual import needed

## 📱 Testing Sync

1. **Export from Web App:**
   - Load flights in web app
   - Export JSON
   - Verify JSON format

2. **Import to iOS App:**
   - Import JSON
   - Verify flights appear
   - Check all fields

3. **Test Weather:**
   - Refresh weather
   - Tap ICAO codes
   - Verify weather loads

4. **Test Updates:**
   - Update flight in web app
   - Export again
   - Import to iOS
   - Verify updates

## 🎯 Best Practices

1. **Regular Sync:**
   - Sync before important changes
   - Sync after major updates
   - Keep iOS app up to date

2. **Backup:**
   - Export JSON regularly
   - Save to notes or file
   - Keep backups of flight data

3. **Verify:**
   - Always verify import
   - Check all fields
   - Test weather loading

4. **Update:**
   - Keep both apps updated
   - Sync format may change
   - Check for updates

## 🆘 Need Help?

1. Check console logs
2. Verify JSON format
3. Check network connectivity
4. Review README.md
5. Check INSTALLATION.md

## 🎉 Success!

Your flights are now synced to iOS!

- ✅ View flights on iPhone
- ✅ Check weather on the go
- ✅ Monitor flights anywhere
- ✅ Stay updated in real-time

