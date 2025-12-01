//
//  BackgroundRefreshService.swift
//  CieloTracker
//

import Foundation
import SwiftData
import BackgroundTasks
import UserNotifications

class BackgroundRefreshService {
    static let shared = BackgroundRefreshService()
    
    private let backgroundTaskIdentifier = "com.cielotracker.background-refresh"
    
    private init() {}
    
    func registerBackgroundTasks() {
        // Register background fetch task
        BGTaskScheduler.shared.register(forTaskWithIdentifier: backgroundTaskIdentifier, using: nil) { task in
            self.handleBackgroundRefresh(task: task as! BGAppRefreshTask)
        }
    }
    
    func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: backgroundTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 5 * 60) // 5 minutes from now
        
        do {
            try BGTaskScheduler.shared.submit(request)
            print("✅ Background refresh scheduled")
        } catch {
            print("❌ Could not schedule background refresh: \(error)")
        }
    }
    
    func handleBackgroundRefresh(task: BGAppRefreshTask) {
        print("🔄 Background refresh started")
        
        // Schedule the next background refresh
        scheduleBackgroundRefresh()
        
        // Set expiration handler
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }
        
        // Perform background refresh
        Task {
            do {
                // Get model context from shared container
                let container = try ModelContainer(for: Flight.self, WeatherData.self)
                let context = container.mainContext
                
                // Fetch all flights
                let descriptor = FetchDescriptor<Flight>(sortBy: [SortDescriptor(\Flight.displayOrder)])
                let flights = try context.fetch(descriptor)
                
                // Collect ICAO codes
                var icaoCodes = Set<String>()
                for flight in flights {
                    if !flight.origin.isEmpty { icaoCodes.insert(flight.origin) }
                    if !flight.dest.isEmpty { icaoCodes.insert(flight.dest) }
                    if !flight.takeoffAlt.isEmpty { icaoCodes.insert(flight.takeoffAlt) }
                    if !flight.alt1.isEmpty { icaoCodes.insert(flight.alt1) }
                    if !flight.alt2.isEmpty { icaoCodes.insert(flight.alt2) }
                }
                
                // Fetch weather
                if !icaoCodes.isEmpty {
                    let weather = try await WeatherService.shared.fetchWeather(for: Array(icaoCodes))
                    
                    // Check for new triggers and send notifications
                    await checkForNewTriggers(flights: flights, weather: weather, context: context)
                }
                
                task.setTaskCompleted(success: true)
                print("✅ Background refresh completed")
            } catch {
                print("❌ Background refresh error: \(error)")
                task.setTaskCompleted(success: false)
            }
        }
    }
    
    @MainActor
    private func checkForNewTriggers(flights: [Flight], weather: [String: WeatherResponse], context: ModelContext) async {
        // Request notification permission if not already granted
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        
        guard settings.authorizationStatus == .authorized else {
            // Request permission
            do {
                try await center.requestAuthorization(options: [.alert, .sound, .badge])
            } catch {
                print("❌ Failed to request notification permission: \(error)")
                return
            }
        }
        
        let triggerService = TriggerCalculationService.shared
        
        // Check each flight for new triggers
        for flight in flights {
            let destWx = weather[flight.dest]
            let originWx = weather[flight.origin]
            
            // Calculate current triggers
            var newTriggers = Set<String>()
            
            // Check if destination requires alternate
            if triggerService.checkDestRequiresAlternate(weather: destWx, flight: flight) {
                if flight.alt1.isEmpty && flight.alt2.isEmpty {
                    newTriggers.insert("\(flight.dest):dest-noalt")
                } else {
                    newTriggers.insert("\(flight.dest):dest")
                }
            }
            
            // Check for other triggers (wind, adverse weather, etc.)
            // This is a simplified version - you'd want to implement full trigger logic
            if let destWx = destWx, !flight.eta.isEmpty {
                let etaHH = String(flight.eta.prefix(2))
                
                // Check METAR for triggers at ETA hour
                if let metarRaw = destWx.metar?.raw,
                   let metarHH = triggerService.getMetarHourHH(metarRaw),
                   metarHH == etaHH {
                    // Check for trigger terms in METAR
                    let triggerTerms = triggerService.findTriggerTerms(metarRaw)
                    for term in triggerTerms {
                        newTriggers.insert("\(flight.dest):\(term)")
                    }
                }
            }
            
            // Compare with existing triggers to find new ones
            let existingTriggers = flight.triggers
            let newTriggerSet = newTriggers.subtracting(existingTriggers)
            
            if !newTriggerSet.isEmpty {
                // Update flight triggers
                flight.triggers = newTriggers
                
                // Save changes
                do {
                    try context.save()
                    
                    // Send notification for new triggers
                    let triggerList = Array(newTriggerSet).joined(separator: ", ")
                    let content = UNMutableNotificationContent()
                    content.title = "New Trigger: \(flight.flightNumber)"
                    content.body = "Flight \(flight.flightNumber) (\(flight.origin) → \(flight.dest)) has new weather triggers: \(triggerList)"
                    content.sound = .default
                    content.badge = 1
                    
                    let request = UNNotificationRequest(
                        identifier: "trigger-\(flight.id)-\(Date().timeIntervalSince1970)",
                        content: content,
                        trigger: nil // Send immediately
                    )
                    
                    do {
                        try await center.add(request)
                        print("📬 Notification sent for flight \(flight.flightNumber): \(triggerList)")
                    } catch {
                        print("❌ Failed to send notification: \(error)")
                    }
                } catch {
                    print("❌ Failed to save trigger updates: \(error)")
                }
            }
        }
    }
}

