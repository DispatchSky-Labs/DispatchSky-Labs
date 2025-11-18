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
        let flightDicts = flights.enumerated().map { index, flight in
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
                "autoRemoveScheduled": flight.autoRemoveScheduled,
                "displayOrder": index
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
        
        for (index, dict) in flightDicts.enumerated() {
            // Support both compact format (f, o, d, etc.) and full format
            let flightNumber = dict["f"] as? String ?? dict["flight"] as? String ?? ""
            let origin = dict["o"] as? String ?? dict["origin"] as? String ?? ""
            let dest = dict["d"] as? String ?? dict["dest"] as? String ?? ""
            let takeoffAlt = dict["ta"] as? String ?? dict["takeoffAlt"] as? String ?? ""
            let alt1 = dict["a1"] as? String ?? dict["alt1"] as? String ?? ""
            let alt2 = dict["a2"] as? String ?? dict["alt2"] as? String ?? ""
            let taxiOut = dict["to"] as? String ?? dict["taxiOut"] as? String ?? ""
            let burnoff = dict["bo"] as? String ?? dict["burnoff"] as? String ?? ""
            let duration = dict["dur"] as? String ?? dict["duration"] as? String ?? ""
            let triggers = dict["t"] as? [String] ?? dict["triggers"] as? [String] ?? []
            let displayOrder = dict["do"] as? Int ?? dict["displayOrder"] as? Int ?? index
            
            let flight = Flight(
                id: dict["id"] as? String ?? UUID().uuidString,
                flightNumber: flightNumber,
                origin: origin,
                dest: dest,
                takeoffAlt: takeoffAlt,
                alt1: alt1,
                alt2: alt2,
                etd: dict["etd"] as? String ?? "",
                taxiOut: taxiOut,
                burnoff: burnoff,
                duration: duration,
                eta: dict["eta"] as? String ?? "",
                isPastEta: dict["pe"] as? Bool ?? dict["isPastEta"] as? Bool ?? false,
                autoRemoveScheduled: dict["ar"] as? Bool ?? dict["autoRemoveScheduled"] as? Bool ?? false,
                triggers: Set(triggers),
                lastUpdated: Date(),
                displayOrder: displayOrder
            )
            context.insert(flight)
            flights.append(flight)
        }
        
        // Sort by displayOrder to preserve order from HTML
        flights.sort { $0.displayOrder < $1.displayOrder }
        
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

