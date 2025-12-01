//
//  CieloTrackerApp.swift
//  CieloTracker
//
//  Created for iOS Sync
//

import SwiftUI
import SwiftData

@main
struct CieloTrackerApp: App {
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            Flight.self,
            WeatherData.self
        ])
        
        // Enable CloudKit/iCloud sync
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false,
            cloudKitDatabase: .automatic // Enable iCloud sync
        )
        
        do {
            return try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()
    
    init() {
        // Register background tasks
        BackgroundRefreshService.shared.registerBackgroundTasks()
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(sharedModelContainer)
    }
}

