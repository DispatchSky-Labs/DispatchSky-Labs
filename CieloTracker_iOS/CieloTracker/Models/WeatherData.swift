//
//  WeatherData.swift
//  CieloTracker
//

import Foundation
import SwiftData

@Model
final class WeatherData {
    var icao: String
    var metarRaw: String
    var tafRaw: String
    var lastUpdated: Date
    
    init(icao: String, metarRaw: String = "", tafRaw: String = "", lastUpdated: Date = Date()) {
        self.icao = icao
        self.metarRaw = metarRaw
        self.tafRaw = tafRaw
        self.lastUpdated = lastUpdated
    }
}

