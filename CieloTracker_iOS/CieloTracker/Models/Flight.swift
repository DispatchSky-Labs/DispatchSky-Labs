//
//  Flight.swift
//  CieloTracker
//

import Foundation
import SwiftData

@Model
final class Flight {
    var id: String
    var flightNumber: String
    var origin: String
    var dest: String
    var takeoffAlt: String
    var alt1: String
    var alt2: String
    var etd: String // HHMM format
    var taxiOut: String // minutes
    var burnoff: String // minutes
    var duration: String // minutes
    var eta: String // HHMM format
    var isPastEta: Bool
    var autoRemoveScheduled: Bool
    var lastUpdated: Date
    var displayOrder: Int // Preserve order from HTML export
    var minutesPastEta: Int? // Calculated minutes past ETA for auto-delete highlighting
    
    // Weather triggers (stored as comma-separated string, converted to Set in code)
    var triggersString: String
    
    init(
        id: String = UUID().uuidString,
        flightNumber: String = "",
        origin: String = "",
        dest: String = "",
        takeoffAlt: String = "",
        alt1: String = "",
        alt2: String = "",
        etd: String = "",
        taxiOut: String = "",
        burnoff: String = "",
        duration: String = "",
        eta: String = "",
        isPastEta: Bool = false,
        autoRemoveScheduled: Bool = false,
        triggers: Set<String> = [],
        lastUpdated: Date = Date(),
        displayOrder: Int = 0
    ) {
        self.id = id
        self.flightNumber = flightNumber
        self.origin = origin
        self.dest = dest
        self.takeoffAlt = takeoffAlt
        self.alt1 = alt1
        self.alt2 = alt2
        self.etd = etd
        self.taxiOut = taxiOut
        self.burnoff = burnoff
        self.duration = duration
        self.eta = eta
        self.isPastEta = isPastEta
        self.autoRemoveScheduled = autoRemoveScheduled
        self.triggersString = Array(triggers).joined(separator: ",")
        self.lastUpdated = lastUpdated
        self.displayOrder = displayOrder
    }
    
    var triggers: Set<String> {
        get {
            Set(triggersString.split(separator: ",").map { String($0) })
        }
        set {
            triggersString = Array(newValue).joined(separator: ",")
        }
    }
}

