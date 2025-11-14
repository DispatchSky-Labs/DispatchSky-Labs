//
//  FlightSyncService.swift
//  CieloTracker
//

import Foundation
import SwiftData

class FlightSyncService {
    static let shared = FlightSyncService()
    
    private let flightsKey = "ct_pro_flights"
    
    private init() {}
    
    // MARK: - Export to JSON (for web app sync)
    func exportFlightsToJSON(_ flights: [Flight]) -> String? {
        let flightDicts = flights.map { flight in
            [
                "id": flight.id,
                "flight": flight.flightNumber,
                "origin": flight.origin,
                "dest": flight.dest,
                "takeoffAlt": flight.takeoffAlt,
                "alt1": flight.alt1,
                "alt2": flight.alt2,
                "etd": flight.etd,
                "taxiOut": flight.taxiOut,
                "burnoff": flight.burnoff,
                "duration": flight.duration,
                "eta": flight.eta,
                "triggers": Array(flight.triggers),
                "autoRemoveScheduled": flight.autoRemoveScheduled
            ]
        }
        
        guard let jsonData = try? JSONSerialization.data(withJSONObject: flightDicts, options: .prettyPrinted),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            return nil
        }
        
        return jsonString
    }
    
    // MARK: - Import from JSON (from web app)
    func importFlightsFromJSON(_ jsonString: String, context: ModelContext) throws -> [Flight] {
        guard let jsonData = jsonString.data(using: .utf8),
              let flightDicts = try? JSONSerialization.jsonObject(with: jsonData) as? [[String: Any]] else {
            throw SyncError.invalidJSON
        }
        
        var flights: [Flight] = []
        
        for dict in flightDicts {
            let flight = Flight(
                id: dict["id"] as? String ?? UUID().uuidString,
                flightNumber: dict["flight"] as? String ?? "",
                origin: dict["origin"] as? String ?? "",
                dest: dict["dest"] as? String ?? "",
                takeoffAlt: dict["takeoffAlt"] as? String ?? "",
                alt1: dict["alt1"] as? String ?? "",
                alt2: dict["alt2"] as? String ?? "",
                etd: dict["etd"] as? String ?? "",
                taxiOut: dict["taxiOut"] as? String ?? "",
                burnoff: dict["burnoff"] as? String ?? "",
                duration: dict["duration"] as? String ?? "",
                eta: dict["eta"] as? String ?? "",
                isPastEta: dict["isPastEta"] as? Bool ?? false,
                autoRemoveScheduled: dict["autoRemoveScheduled"] as? Bool ?? false,
                triggers: Set((dict["triggers"] as? [String]) ?? []),
                lastUpdated: Date()
            )
            context.insert(flight)
            flights.append(flight)
        }
        
        return flights
    }
    
    // MARK: - Sync with UserDefaults (matching web app localStorage key)
    func saveToUserDefaults(_ flights: [Flight]) {
        let flightDicts = flights.map { flight in
            [
                "id": flight.id,
                "flight": flight.flightNumber,
                "origin": flight.origin,
                "dest": flight.dest,
                "takeoffAlt": flight.takeoffAlt,
                "alt1": flight.alt1,
                "alt2": flight.alt2,
                "etd": flight.etd,
                "taxiOut": flight.taxiOut,
                "burnoff": flight.burnoff,
                "duration": flight.duration,
                "eta": flight.eta,
                "triggers": Array(flight.triggers),
                "autoRemoveScheduled": flight.autoRemoveScheduled
            ]
        }
        
        if let jsonData = try? JSONSerialization.data(withJSONObject: flightDicts) {
            UserDefaults.standard.set(jsonData, forKey: flightsKey)
        }
    }
    
    func loadFromUserDefaults(context: ModelContext) throws -> [Flight] {
        guard let jsonData = UserDefaults.standard.data(forKey: flightsKey) else {
            return []
        }
        
        guard let jsonString = String(data: jsonData, encoding: .utf8) else {
            throw SyncError.invalidData
        }
        
        return try importFlightsFromJSON(jsonString, context: context)
    }
}

enum SyncError: Error {
    case invalidJSON
    case invalidData
    case syncFailed
}

