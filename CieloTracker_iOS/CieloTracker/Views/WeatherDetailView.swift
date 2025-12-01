//
//  WeatherDetailView.swift
//  CieloTracker
//

import SwiftUI

struct WeatherDetailView: View {
    let icao: String
    let weatherData: WeatherResponse?
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let weather = weatherData {
                        if let metar = weather.metar?.raw, !metar.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text("METAR")
                                        .font(.headline)
                                        .foregroundColor(.secondary)
                                    Spacer()
                                    if let age = metarAge(metar) {
                                        Text(ageText(age))
                                            .font(.caption)
                                            .foregroundColor(age >= 60 ? .red : .secondary)
                                    }
                                }
                                Text(metar)
                                    .font(.system(.body, design: .monospaced))
                                    .textSelection(.enabled)
                            }
                            .padding(.vertical, 8)
                        }
                        
                        if let taf = weather.taf?.raw, !taf.isEmpty {
                            Section {
                                Text("TAF")
                                    .font(.headline)
                                    .foregroundColor(.secondary)
                                Text(taf)
                                    .font(.system(.body, design: .monospaced))
                                    .textSelection(.enabled)
                            }
                        }
                    } else {
                        Text("No weather data available for \(icao)")
                            .foregroundColor(.secondary)
                    }
                }
                .padding()
            }
            .navigationTitle(icao)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
    
    // Calculate METAR age in minutes
    private func metarAge(_ metar: String) -> Int? {
        // METAR format: ... DDHHMMZ ... (day, hour, minute, Z)
        // Extract timestamp from METAR
        let pattern = #"(\d{2})(\d{2})(\d{2})Z"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: metar, range: NSRange(metar.startIndex..., in: metar)),
              match.numberOfRanges >= 4 else {
            return nil
        }
        
        let dayRange = Range(match.range(at: 1), in: metar)!
        let hourRange = Range(match.range(at: 2), in: metar)!
        let minuteRange = Range(match.range(at: 3), in: metar)!
        
        guard let day = Int(metar[dayRange]),
              let hour = Int(metar[hourRange]),
              let minute = Int(metar[minuteRange]) else {
            return nil
        }
        
        // Get current UTC time
        let calendar = Calendar(identifier: .gregorian)
        var utcCalendar = calendar
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        let now = Date()
        let nowComponents = utcCalendar.dateComponents([.year, .month, .day, .hour, .minute], from: now)
        
        guard let nowYear = nowComponents.year,
              let nowMonth = nowComponents.month,
              let nowDay = nowComponents.day,
              let nowHour = nowComponents.hour,
              let nowMinute = nowComponents.minute else {
            return nil
        }
        
        // Create METAR date (assume current month/year, handle day wrap-around)
        var metarDate = utcCalendar.date(from: DateComponents(year: nowYear, month: nowMonth, day: day, hour: hour, minute: minute))
        
        // Handle day wrap-around (METAR could be from previous day)
        if let metarDate = metarDate, metarDate > now {
            // METAR is in the future, assume it's from previous month
            if let prevMonth = utcCalendar.date(byAdding: .month, value: -1, to: now) {
                let prevComponents = utcCalendar.dateComponents([.year, .month], from: prevMonth)
                if let prevYear = prevComponents.year, let prevMonth = prevComponents.month {
                    metarDate = utcCalendar.date(from: DateComponents(year: prevYear, month: prevMonth, day: day, hour: hour, minute: minute))
                }
            }
        }
        
        guard let metarDate = metarDate else {
            return nil
        }
        
        // Calculate difference in minutes
        let components = utcCalendar.dateComponents([.minute], from: metarDate, to: now)
        return components.minute
    }
    
    private func ageText(_ minutes: Int) -> String {
        if minutes < 0 {
            return "Invalid"
        } else if minutes < 60 {
            return "\(minutes)m old"
        } else {
            let hours = minutes / 60
            let mins = minutes % 60
            return "\(hours)h \(mins)m old"
        }
    }
}

