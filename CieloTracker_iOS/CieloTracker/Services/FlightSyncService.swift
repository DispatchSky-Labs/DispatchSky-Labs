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
        print("🔄 Starting JSON import...")
        guard let jsonData = jsonString.data(using: .utf8),
              let flightDicts = try? JSONSerialization.jsonObject(with: jsonData) as? [[String: Any]] else {
            throw SyncError.invalidJSON
        }
        
        print("📦 Parsing \(flightDicts.count) flights from JSON...")
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
            // CRITICAL: Use index to preserve JSON array order
            let displayOrder = index
            
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
            
            if index < 5 {
                print("  ✅ Imported \(index): \(flight.flightNumber) - displayOrder: \(displayOrder)")
            }
        }
        
        print("✅ JSON import complete: \(flights.count) flights")
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
    
    // MARK: - Import from Pasted Text (Dispatch Worksheet Format)
    func importFlightsFromPaste(_ text: String, context: ModelContext) throws -> [Flight] {
        print("🔄 importFlightsFromPaste: Starting parse...")
        let lines = text.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: .newlines)
        print("📄 Total lines: \(lines.count)")
        var flights: [Flight] = []
        var flightIndex = 0 // Track order of valid flights only - CRITICAL: This preserves paste order
        
        // Header keywords to skip
        let headerKeywords = ["DD", "TIME", "SQ", "ALC", "FLT", "ORG", "ETD", "DST", "ETA", "A/C", "MAXTOW", "CFP", "MSGS", "DISPATCH", "WORKSHEET", "DESK", "page"]
        
        // SINGLE PASS: Parse and insert flights IMMEDIATELY in the exact order they appear
        // This is the ONLY way to guarantee order is preserved
        for (lineNum, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            
            // Skip header lines
            let upperLine = trimmed.uppercased()
            if headerKeywords.contains(where: { upperLine.contains($0) }) {
                print("⏭️ Line \(lineNum): Skipping header line")
                continue
            }
            
            // Split by whitespace (handles both spaces and tabs)
            let parts = trimmed.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
            
            var flight: Flight? = nil
            
            if parts.count >= 9 {
                // Dispatch worksheet format: DD TIME SQ ALC FLT ORG ETD DST ETA ...
                // Example: "80 1744 10 SKW 5728  ORD    1845  GRR    1951  910S         001"
                // Parts: [0]=DD, [1]=TIME, [2]=SQ, [3]=ALC, [4]=FLT, [5]=ORG, [6]=ETD, [7]=DST, [8]=ETA
                // Match web app: use only FLT (parts[4]), not ALC+FLT
                let flt = parts[4] // Just the flight number, e.g. "5728"
                let org = parts[5]
                let etd = parts[6]
                let dst = parts[7]
                let eta = parts[8]
                
                // Validate: flight number should be numeric and at least 3 digits (matching web app)
                let fltInt = Int(flt)
                if let _ = fltInt, flt.count >= 3, !org.isEmpty, !dst.isEmpty, !etd.isEmpty, !eta.isEmpty {
                    flight = Flight(
                        flightNumber: flt.uppercased(),
                        origin: normalizeICAO(org),
                        dest: normalizeICAO(dst),
                        etd: normalizeTime(etd),
                        eta: normalizeTime(eta),
                        displayOrder: flightIndex // Set to current index - this is the paste order
                    )
                    print("✅ Line \(lineNum): Created flight \(flightIndex) - \(flt) \(org)->\(dst) (displayOrder: \(flightIndex))")
                } else {
                    print("❌ Line \(lineNum): Invalid flight data - flt=\(flt), org=\(org), dst=\(dst), etd=\(etd), eta=\(eta)")
                }
            } else if parts.count >= 5 {
                // Simple format: FLT ORG ETD DST ETA
                // Example: "SKW5728 ORD 0700 GRR 0800"
                let flt = parts[0]
                let org = parts[1]
                let etd = parts[2]
                let dst = parts[3]
                let eta = parts[4]
                
                if !flt.isEmpty && !org.isEmpty && !dst.isEmpty && !etd.isEmpty && !eta.isEmpty {
                    flight = Flight(
                        flightNumber: flt.uppercased(),
                        origin: normalizeICAO(org),
                        dest: normalizeICAO(dst),
                        etd: normalizeTime(etd),
                        eta: normalizeTime(eta),
                        displayOrder: flightIndex // Set to current index - this is the paste order
                    )
                    print("✅ Line \(lineNum): Created flight \(flightIndex) - \(flt) \(org)->\(dst) (displayOrder: \(flightIndex))")
                }
            }
            
            // Insert immediately if valid - this preserves the exact paste order
            if let validFlight = flight {
                // displayOrder is already set to flightIndex when creating the Flight
                context.insert(validFlight)
                flights.append(validFlight)
                
                // Debug: Print to verify order
                print("💾 Inserted flight \(flightIndex): \(validFlight.flightNumber) - displayOrder: \(validFlight.displayOrder), ETD: \(validFlight.etd)")
                
                // Increment AFTER inserting to maintain order
                flightIndex += 1
            }
        }
        
        print("📊 Total flights parsed: \(flights.count)")
        
        if flights.isEmpty {
            throw SyncError.invalidData
        }
        
        // Final verification: ensure displayOrder matches array index exactly
        print("🔍 Verifying displayOrder matches array index...")
        for (index, flight) in flights.enumerated() {
            if flight.displayOrder != index {
                print("⚠️ FIXING: Flight \(flight.flightNumber) has displayOrder \(flight.displayOrder) but should be \(index)")
                flight.displayOrder = index
            }
        }
        
        // Print final order
        print("📋 FINAL IMPORT ORDER:")
        for (idx, flight) in flights.enumerated() {
            print("  \(idx): \(flight.flightNumber) (displayOrder: \(flight.displayOrder), ETD: \(flight.etd))")
        }
        
        return flights
    }
    
    private func normalizeICAO(_ code: String) -> String {
        let clean = code.trimmingCharacters(in: .whitespaces).uppercased()
        if clean.count == 4 {
            return clean
        }
        if clean.count == 3 {
            if clean.first == "Y" {
                return "C" + clean
            }
            return "K" + clean
        }
        return clean
    }
    
    private func normalizeTime(_ time: String) -> String {
        let cleaned = time.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ":", with: "")
        guard !cleaned.isEmpty, let digits = Int(cleaned) else { return "" }
        
        var hours = 0
        var minutes = 0
        
        if cleaned.count == 1 {
            minutes = digits
        } else if cleaned.count == 2 {
            if digits <= 59 {
                minutes = digits
            } else {
                hours = digits / 100
                minutes = digits % 100
            }
        } else if cleaned.count == 3 {
            hours = digits / 100
            minutes = digits % 100
        } else if cleaned.count >= 4 {
            let hoursStr = String(cleaned.prefix(2))
            let minsStr = String(cleaned.suffix(2))
            hours = Int(hoursStr) ?? 0
            minutes = Int(minsStr) ?? 0
        }
        
        hours = hours % 24
        minutes = minutes % 60
        
        return String(format: "%02d%02d", hours, minutes)
    }
}

enum SyncError: Error {
    case invalidJSON
    case invalidData
    case syncFailed
}

