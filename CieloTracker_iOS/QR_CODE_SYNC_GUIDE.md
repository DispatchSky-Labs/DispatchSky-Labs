# QR Code Sync Guide

## Overview

QR code sync allows you to quickly transfer flight data from the web app (PC) to your iPhone without traditional syncing. Just generate a QR code on your PC and scan it with your iPhone!

## How It Works

### Web App (PC) - Generate QR Code

1. **Open `pro_beta.html`** in your browser
2. **Load your flights** (or they should already be loaded)
3. **Right-click on "CieloTracker Pro"** header (or left-click)
4. **Click "Generate QR Code"** from the context menu
5. **QR code appears** in a modal window
6. **Keep the QR code visible** on your screen

### iOS App (iPhone) - Scan QR Code

1. **Open CieloTracker Pro** on your iPhone
2. **Tap the menu button** (⋯) in the top right
3. **Tap "Scan QR Code"**
4. **Allow camera access** if prompted (first time only)
5. **Point camera at QR code** on your PC screen
6. **Flights import automatically!**
7. **Success message appears** showing number of flights imported

## Step-by-Step Instructions

### Step 1: Generate QR Code on PC

1. Open `pro_beta.html` in your browser
2. Make sure you have flights loaded in the table
3. Click or right-click on "CieloTracker Pro" in the header
4. Select "Generate QR Code" from the menu
5. A modal window appears with a QR code
6. **Keep this window open** and visible on your screen

### Step 2: Scan QR Code on iPhone

1. Open the CieloTracker Pro app on your iPhone
2. Tap the menu button (⋯) in the top right corner
3. Tap "Scan QR Code" from the menu
4. The camera opens
5. Point your iPhone camera at the QR code on your PC screen
6. The app automatically detects and scans the QR code
7. Flights are imported automatically
8. A success message shows: "Successfully imported X flight(s)"
9. Tap "OK" to close the scanner
10. Your flights are now in the app!

## Tips for Best Results

### PC Screen
- **Full screen** the QR code modal for best visibility
- **Increase screen brightness** so the QR code is clear
- **Clean your screen** if there are smudges
- **Keep QR code centered** on screen

### iPhone Camera
- **Hold iPhone steady** while scanning
- **Good lighting** helps camera focus
- **Distance:** About 1-2 feet from PC screen
- **Angle:** Point camera directly at QR code
- **Wait for focus:** Camera may take a moment to focus

### Troubleshooting

**QR code not scanning?**
- Make sure QR code is fully visible on PC screen
- Increase PC screen brightness
- Clean iPhone camera lens
- Hold iPhone steady and wait for focus
- Try moving closer or farther from screen
- Make sure camera permission is granted

**Import failed?**
- Check that QR code was generated correctly
- Try generating a new QR code
- Make sure flights are loaded in web app
- Check console for error messages

**Camera not opening?**
- Check camera permission in iPhone Settings
- Go to Settings → CieloTracker Pro → Camera
- Make sure Camera is enabled
- Restart the app

## What Gets Synced

The QR code contains all flight data:
- Flight numbers
- Origin and destination airports
- Takeoff altitude, ALT1, ALT2
- ETD and ETA times
- Taxi out and burnoff times
- Duration
- Weather triggers
- All other flight data

## Data Flow

```
Web App (PC)
  ↓
Generate QR Code
  ↓
QR Code (JSON data encoded)
  ↓
iPhone Camera
  ↓
Scan QR Code
  ↓
Decode JSON
  ↓
Import Flights
  ↓
iOS App
```

## Advantages

✅ **Fast** - No manual copy/paste needed
✅ **Easy** - Just scan and go
✅ **No internet required** - Works offline
✅ **Secure** - Data only on your devices
✅ **No backend needed** - Direct transfer
✅ **Works anywhere** - No network required

## Limitations

⚠️ **QR code size** - Large flight lists may create large QR codes
⚠️ **Screen quality** - Needs clear screen for scanning
⚠️ **Camera quality** - Needs good camera focus
⚠️ **One-way sync** - Only PC → iPhone (not bidirectional)
⚠️ **Manual trigger** - Need to generate QR code each time

## Future Improvements

- **Auto-generate QR code** when flights change
- **Multiple QR codes** for large flight lists
- **Bidirectional sync** - iPhone → PC
- **Auto-scan** - Continuously scan for updates
- **URL scheme** - Click link to import (alternative method)

## Technical Details

### QR Code Format
- **Encoding:** JSON string of flight array
- **Library:** qrcodejs (web), AVFoundation (iOS)
- **Size:** 256x256 pixels
- **Error correction:** Medium level

### Data Format
```json
[
  {
    "id": "...",
    "flight": "...",
    "origin": "...",
    "dest": "...",
    ...
  }
]
```

### Camera Permissions
- **Info.plist:** `NSCameraUsageDescription` required
- **First launch:** User must grant camera permission
- **Settings:** Can be changed in iPhone Settings

## Success!

You now have a fast, easy way to sync flights from PC to iPhone using QR codes! 🎉

No more manual JSON copy/paste - just scan and go!


