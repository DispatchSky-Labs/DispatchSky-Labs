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
        let modelConfiguration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        
        do {
            return try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(sharedModelContainer)
    }
}

