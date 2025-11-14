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
        
        guard !icaoCodes.isEmpty else { return }
        
        do {
            let weather = try await weatherService.fetchWeather(for: Array(icaoCodes))
            weatherData = weather
            
            // Update weather data in database
            let descriptor = FetchDescriptor<WeatherData>()
            let existingWeather = try modelContext.fetch(descriptor)
            let existingICOs = Set(existingWeather.map { $0.icao })
            
            for (icao, response) in weather {
                if let existing = existingWeather.first(where: { $0.icao == icao }) {
                    existing.metarRaw = response.metar?.raw ?? ""
                    existing.tafRaw = response.taf?.raw ?? ""
                    existing.lastUpdated = Date()
                } else {
                    let weatherData = WeatherData(
                        icao: icao,
                        metarRaw: response.metar?.raw ?? "",
                        tafRaw: response.taf?.raw ?? ""
                    )
                    modelContext.insert(weatherData)
                }
            }
            
            try modelContext.save()
            lastUpdate = Date()
        } catch {
            print("Error loading weather: \(error)")
        }
    }
}

