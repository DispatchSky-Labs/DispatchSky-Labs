# Fix Provisioning Profile iCloud Entitlement Error

The provisioning profile doesn't include the `com.apple.developer.icloud-container-environment` entitlement. You have two options:

## Option 1: Enable iCloud Capability in Xcode (Recommended)

This will regenerate your provisioning profile with the correct entitlements:

1. **In Xcode, select your project** (blue icon)
2. **Select your app target** (`CielotTrackerPro`)
3. **Go to "Signing & Capabilities" tab**
4. **Click "+ Capability"** (top left, next to "All")
5. **Search for and add "iCloud"**
6. **Check the "CloudKit" checkbox**
7. **Xcode will automatically:**
   - Add the iCloud container (or you can configure it)
   - Regenerate the provisioning profile
   - Update entitlements

8. **If you see a container identifier**, make sure it's configured:
   - It should be something like: `iCloud.com.samg.CielotTrackerPro`
   - If it's empty or wrong, click "Configure" and set it up

9. **Clean and rebuild:**
   - Product → Clean Build Folder
   - Product → Archive

## Option 2: Remove the Entitlement (If Not Using iCloud Containers)

If you're only using CloudKit with the default container and don't need a specific iCloud container:

1. **Remove the `com.apple.developer.icloud-container-environment` key** from entitlements
2. **Keep `com.apple.developer.icloud-services` with CloudKit** (this is fine)
3. **The empty `com.apple.developer.icloud-container-identifiers` array is OK**

However, **TestFlight validation might still complain** that the value should be "Production" if the key exists elsewhere. So Option 1 is better.

## Option 3: Update Provisioning Profile Manually

1. **Go to Apple Developer Portal:**
   - https://developer.apple.com/account
   - Certificates, Identifiers & Profiles
   - Identifiers → App IDs
   - Find `com.samg.CielotTrackerPro`

2. **Edit the App ID:**
   - Enable "iCloud" capability
   - Enable "CloudKit" service
   - Save

3. **Go to Profiles:**
   - Find your provisioning profile
   - Edit it or regenerate it
   - Download the new profile
   - Xcode should pick it up automatically

## Why This Happens

The provisioning profile was created before iCloud capability was added, or iCloud isn't properly configured in your App ID. When you add capabilities in Xcode, it should automatically update the provisioning profile, but sometimes you need to:

- Let Xcode automatically manage signing (recommended)
- Or manually update in Developer Portal

## Recommended Solution

**Use Option 1** - Add iCloud capability in Xcode's Signing & Capabilities. This is the easiest and most reliable way. Xcode will handle everything automatically.

If that doesn't work, try Option 3 to manually update in the Developer Portal.

