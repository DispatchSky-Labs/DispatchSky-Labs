# Fix Watch App Extension Mach-O Header Error

The error indicates the Watch extension is missing the `__swift5_entry` section. This usually means the Swift entry point isn't being compiled correctly.

## The Problem

The Watch extension bundle (`CieloTrackerWatchWidgetExtensionExtension.appex`) is missing the Swift 5 entry point, which prevents it from running.

## Solution Steps

### Step 1: Verify Entry Point

The extension should have a `@main` attribute. I found:
- ✅ `CieloTrackerWatchWidgetExtensionBundle.swift` has `@main` - this is correct

### Step 2: Check Build Settings in Xcode

1. **Select the Watch Extension target** (`CieloTrackerWatchWidgetExtensionExtension`)
2. **Go to "Build Settings" tab**
3. **Search for these settings and verify:**

   **Swift Language Version:**
   - Should be: `Swift 5` or `Swift 5.0`
   - NOT `Swift 4` or empty

   **Swift Compiler - Code Generation:**
   - `Optimization Level`: Should be `Optimize for Speed [-O]` for Release, `None [-Onone]` for Debug
   
   **Deployment:**
   - `watchOS Deployment Target`: Should match your Watch app target (e.g., `watchOS 10.0`)

### Step 3: Check Build Phases

1. **Select the Watch Extension target**
2. **Go to "Build Phases" tab**
3. **Expand "Compile Sources"**
4. **Verify these files are included:**
   - ✅ `CieloTrackerWatchWidgetExtensionBundle.swift` (MUST be included)
   - ✅ `CieloTrackerWatchWidgetExtension.swift`
   - ✅ `CieloTrackerWatchWidget.swift`
   - ✅ `CieloTrackerWatchWidgetExtensionControl.swift`

5. **If `CieloTrackerWatchWidgetExtensionBundle.swift` is missing:**
   - Click "+" button
   - Add the file
   - Make sure it's checked

### Step 4: Verify Watch App Entry Point

1. **Select the Watch App target** (`CieloTrackerWatchApp Watch App`)
2. **Find the main Swift file** (usually `CieloTrackerWatchApp.swift` or `App.swift`)
3. **Make sure it has `@main` attribute:**
   ```swift
   @main
   struct CieloTrackerWatchApp: App {
       var body: some Scene {
           WindowGroup {
               ContentView()
           }
       }
   }
   ```

### Step 5: Clean and Rebuild

1. **Product → Clean Build Folder** (Shift+Cmd+K)
2. **Delete Derived Data:**
   - Xcode → Settings → Locations
   - Click arrow next to Derived Data
   - Delete your project's folder
3. **Quit Xcode**
4. **Reopen Xcode**
5. **Product → Archive**

### Step 6: Verify Swift Version

Run this in Terminal to check the compiled binary:
```bash
# After archiving, find the .appex file
# Then run:
otool -l /path/to/CieloTrackerWatchWidgetExtensionExtension.appex/CieloTrackerWatchWidgetExtensionExtension | grep __swift5_entry
```

If it shows nothing, the entry point isn't being compiled.

## Common Issues

1. **Swift version mismatch:** Extension using Swift 4 while app uses Swift 5
2. **Missing @main:** Entry point file doesn't have `@main` attribute
3. **File not in Compile Sources:** Entry point file isn't included in build
4. **Build settings wrong:** Swift compiler settings are incorrect

## Alternative: Check Info.plist

Sometimes the issue is in the Info.plist. Check:
1. **Watch Extension target → Info.plist**
2. **Look for `CFBundleExecutable`** - should match your main Swift file name
3. **Or check "Build Settings" → "Info.plist File" path**

## If Still Not Working

If the above doesn't work, try:

1. **Create a new simple Watch extension** to test
2. **Compare build settings** between working and non-working
3. **Check Xcode version** - make sure it's up to date
4. **Check watchOS SDK** - ensure it's properly installed

The most common fix is ensuring the `@main` file is in "Compile Sources" and Swift version is 5.

