# iCloud Sync Setup Guide

## Step 1: Enable CloudKit in Xcode

1. **Select your project** (blue icon) in Xcode
2. **Select your target** (`CielotTrackerPro`)
3. **Go to "Signing & Capabilities" tab**
4. **Click "+ Capability"** (top left)
5. **Add "iCloud" capability**
6. **Check "CloudKit"** checkbox
7. **Xcode will automatically:**
   - Create CloudKit container
   - Add entitlements
   - Configure permissions

## Step 2: Verify ModelConfiguration

The code in `CieloTrackerApp.swift` now has:
```swift
cloudKitDatabase: .automatic
```

This enables CloudKit sync for SwiftData.

## Step 3: Test iCloud Sync

1. **Build and run** on device or simulator
2. **Add a flight** in the app
3. **Wait a few seconds** for sync
4. **Open on another device** (if available)
5. **Flights should sync automatically!**

## How It Works

- **iOS to iOS:** Automatic sync via iCloud/CloudKit
- **Web to iOS:** Still need manual JSON import (or URL scheme - see below)
- **Real-time:** Changes sync across devices automatically
- **No backend needed:** Uses Apple's CloudKit service

## Troubleshooting

### Sync Not Working?

1. **Check iCloud is enabled:**
   - Settings → [Your Name] → iCloud
   - Make sure iCloud Drive is ON

2. **Check CloudKit Container:**
   - Xcode → Signing & Capabilities
   - Verify CloudKit container exists
   - Should be: `iCloud.com.yourname.CielotTrackerPro`

3. **Check Entitlements:**
   - Verify `CieloTracker/CielotTrackerPro.entitlements` file exists
   - Should have CloudKit enabled

4. **Wait for Sync:**
   - CloudKit sync can take 10-30 seconds
   - Make sure devices are online
   - Check iCloud status in Settings

## Notes

- **Free:** CloudKit has generous free tier
- **Automatic:** No manual sync needed
- **Secure:** Uses Apple's encryption
- **Fast:** Syncs in real-time
- **iOS Only:** Web app can't access iCloud (needs backend for web-to-iOS sync)


