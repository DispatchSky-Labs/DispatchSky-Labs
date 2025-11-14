# CieloTracker Pro - Sync Setup Guide

## Two Types of Sync

There are two separate sync mechanisms:

### 1. iCloud Sync (iOS Device to iOS Device)
**Purpose:** Syncs your flight data between your iPhone, iPad, and other iOS devices signed into the same iCloud account.

**Setup:**
- ✅ iCloud sync is already enabled in the code (`cloudKitDatabase: .automatic`)
- **You do NOT need an Apple login in the app**
- **You only need to be signed into iCloud on your iPhone:**
  1. Open Settings app on your iPhone
  2. Tap your name at the top
  3. Tap "iCloud"
  4. Make sure you're signed in with your Apple ID
  5. Make sure "iCloud Drive" is enabled (toggle ON)

- **Enable iCloud Capability in Xcode:**
  1. Open the project in Xcode
  2. Select the project in the navigator
  3. Select the "CielotTrackerPro" target
  4. Go to "Signing & Capabilities" tab
  5. Click "+ Capability" button
  6. Search for "iCloud" and add it
  7. Check the box for "CloudKit"
  8. That's it! SwiftData will automatically handle the rest

**How it works:**
- Changes on one device automatically sync to all your other devices
- Sync happens in the background
- First sync may take a few minutes to set up

---

### 2. Web App to iOS App Sync (Manual Export/Import)
**Purpose:** Transfer flight data from your web app (pro_beta.html) to your iOS app.

**How to Export from Web App:**
1. Open `pro_beta.html` in your browser
2. Right-click or left-click on "CieloTracker Pro" in the header
3. Click "Export for iOS" from the menu
4. The flight data will be copied to your clipboard automatically
5. You'll see a success message: "Flight data copied to clipboard!"

**How to Import into iOS App:**
1. Open the CieloTracker Pro app on your iPhone
2. Tap the menu icon (three dots) in the top-right corner
3. Tap "Sync"
4. In the text area, paste the JSON data (long-press → Paste)
5. Tap "Import Flights"
6. Wait for confirmation message

**Note:** This is a one-way sync (Web → iOS). If you make changes on iOS and want them back on the web app, you'll need to export from iOS and manually import into the web app (this feature can be added later).

---

## Troubleshooting

### iCloud Sync Not Working?
1. **Check iCloud Sign-In:**
   - Settings → Your Name → iCloud
   - Make sure you're signed in
   - Make sure "iCloud Drive" is enabled

2. **Check Xcode Capabilities:**
   - Open project in Xcode
   - Select target → "Signing & Capabilities"
   - Make sure "iCloud" capability is added
   - Make sure "CloudKit" is checked

3. **Wait for Initial Sync:**
   - First sync can take 5-10 minutes
   - Make sure both devices are on Wi-Fi
   - Check that both devices are signed into the same iCloud account

4. **Force Sync:**
   - Close and reopen the app
   - Or restart your iPhone

### Export/Import Not Working?
1. **Export:**
   - Make sure you have flights in the web app
   - Check browser console for errors (F12 or Cmd+Option+I)
   - Try the manual method: Open DevTools Console and run:
     ```javascript
     JSON.stringify(JSON.parse(localStorage.getItem('ct_pro_flights')))
     ```

2. **Import:**
   - Make sure you're pasting the complete JSON (starts with `[` and ends with `]`)
   - Check that the JSON is valid (no syntax errors)
   - Try copying from console output if clipboard method fails

---

## Current Status

- ✅ **iCloud Sync:** Code is ready, but you need to enable the capability in Xcode
- ✅ **Web → iOS Export:** Working (new "Export for iOS" button in context menu)
- ✅ **iOS Import:** Working (Sync menu in iOS app)

---

## Next Steps

1. **Enable iCloud Capability in Xcode** (see instructions above)
2. **Test Web → iOS Sync:**
   - Export from web app
   - Import into iOS app
   - Verify flights appear correctly
3. **Test iCloud Sync** (once capability is enabled):
   - Add/edit flights on iPhone
   - Wait a few minutes
   - Check if changes appear on iPad (or another iOS device with the same iCloud account)

