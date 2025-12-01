//
//  FlightListViewModel.swift
//  CieloTracker
//

import Foundation
import SwiftData
import Combine

@MainActor
class FlightListViewModel: ObservableObject {
    @Published var weatherData: [String: WeatherResponse] = [:]
    @Published var isLoading = false
    @Published var lastUpdate: Date?
    
    private let weatherService = WeatherService.shared
    
    func loadWeather(for flights: [Flight], modelContext: ModelContext) async {
        isLoading = true
        defer { isLoading = false }
        
        // Collect all ICAO codes
        var icaoCodes = Set<String>()
        for flight in flights {
            if !flight.origin.isEmpty { icaoCodes.insert(flight.origin) }
            if !flight.dest.isEmpty { icaoCodes.insert(flight.dest) }
            if !flight.takeoffAlt.isEmpty { icaoCodes.insert(flight.takeoffAlt) }
            if !flight.alt1.isEmpty { icaoCodes.insert(flight.alt1) }
            if !flight.alt2.isEmpty { icaoCodes.insert(flight.alt2) }
        }
        
        guard !icaoCodes.isEmpty else {
            print("⚠️ No ICAO codes found in flights")
            return
        }
        
        let icaoArray = Array(icaoCodes)
        print("🌤️ Starting weather fetch for \(icaoCodes.count) unique ICAO codes")
        print("   ICAO codes: \(icaoArray.sorted().joined(separator: ", "))")
        
        do {
            let weather = try await weatherService.fetchWeather(for: icaoArray)
            print("✅ Weather fetch completed: \(weather.count) stations returned")
            weatherData = weather
            
            if weather.isEmpty {
                print("⚠️ WARNING: Weather fetch returned empty results")
            }
            
            // Update weather data in database
            let descriptor = FetchDescriptor<WeatherData>()
            let existingWeather = try modelContext.fetch(descriptor)
            let existingICOs = Set(existingWeather.map { $0.icao })
            print("💾 Updating database: \(existingWeather.count) existing weather records found")
            
            var updatedCount = 0
            var insertedCount = 0
            for (icao, response) in weather {
                if let existing = existingWeather.first(where: { $0.icao == icao }) {
                    existing.metarRaw = response.metar?.raw ?? ""
                    existing.tafRaw = response.taf?.raw ?? ""
                    existing.lastUpdated = Date()
                    updatedCount += 1
                } else {
                    let weatherData = WeatherData(
                        icao: icao,
                        metarRaw: response.metar?.raw ?? "",
                        tafRaw: response.taf?.raw ?? ""
                    )
                    modelContext.insert(weatherData)
                    insertedCount += 1
                }
            }
            
            try modelContext.save()
            lastUpdate = Date()
            print("✅ Weather data saved to database: \(updatedCount) updated, \(insertedCount) inserted")
        } catch {
            print("❌ Error loading weather: \(error)")
            print("   Error type: \(type(of: error))")
            if let weatherError = error as? WeatherError {
                print("   Weather error type: \(weatherError)")
            }
            print("   Error details: \(error.localizedDescription)")
            if let nsError = error as NSError? {
                print("   NSError domain: \(nsError.domain), code: \(nsError.code)")
                if !nsError.userInfo.isEmpty {
                    print("   User info: \(nsError.userInfo)")
                }
            }
        }
    }
}

