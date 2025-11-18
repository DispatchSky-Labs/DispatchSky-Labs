//
//  FlightListView.swift
//  CieloTracker
//

import SwiftUI

struct FlightListView: View {
    let flights: [Flight]
    let weatherData: [String: WeatherResponse]
    let onICAOTap: (String) -> Void
    let searchText: String
    let onSearchTextChange: (String) -> Void
    @State private var showRedTriggersOnly = false
    
    var filteredFlights: [Flight] {
        var result = flights
        
        // Filter by red triggers if enabled
        if showRedTriggersOnly {
            result = result.filter { flight in
                flight.triggers.contains { trigger in
                    trigger.contains("red") || trigger.contains("critical") || trigger.contains("noalt")
                }
            }
        }
        
        // Filter by search text
        if !searchText.isEmpty {
            result = result.filter { flight in
                flight.flightNumber.localizedCaseInsensitiveContains(searchText) ||
                flight.origin.localizedCaseInsensitiveContains(searchText) ||
                flight.dest.localizedCaseInsensitiveContains(searchText) ||
                flight.takeoffAlt.localizedCaseInsensitiveContains(searchText) ||
                flight.alt1.localizedCaseInsensitiveContains(searchText) ||
                flight.alt2.localizedCaseInsensitiveContains(searchText)
            }
        }
        
        return result
    }
    
    var body: some View {
        List {
            ForEach(filteredFlights, id: \.id) { flight in
                FlightRowView(
                    flight: flight,
                    weatherData: weatherData,
                    onICAOTap: onICAOTap
                )
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
        }
        .listStyle(.plain)
        .searchable(text: Binding(
            get: { searchText },
            set: { onSearchTextChange($0) }
        ), prompt: "Search flights")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: {
                    showRedTriggersOnly.toggle()
                }) {
                    Image(systemName: showRedTriggersOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                        .foregroundColor(showRedTriggersOnly ? .red : .primary)
                }
            }
        }
    }
}

struct FlightRowView: View {
    let flight: Flight
    let weatherData: [String: WeatherResponse]
    let onICAOTap: (String) -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header row: Flight number and times
            HStack {
                Text(flight.flightNumber)
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
                
                Spacer()
                
                // ETD/ETA with time formatting
                if !flight.etd.isEmpty {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("ETD")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        Text(formatTime(flight.etd))
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)
                    }
                }
                
                if !flight.etd.isEmpty && !flight.eta.isEmpty {
                    Text("→")
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 4)
                }
                
                if !flight.eta.isEmpty {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("ETA")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        Text(formatTime(flight.eta))
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(flight.isPastEta ? .red : .primary)
                    }
                }
            }
            
            // Airport codes row
            HStack(spacing: 8) {
                ICAOCell(icao: flight.origin, label: "ORG", weatherData: weatherData, hasTrigger: hasTrigger(for: flight.origin), onTap: onICAOTap)
                ICAOCell(icao: flight.dest, label: "DEST", weatherData: weatherData, hasTrigger: hasTrigger(for: flight.dest), onTap: onICAOTap)
                if !flight.takeoffAlt.isEmpty {
                    ICAOCell(icao: flight.takeoffAlt, label: "T/ALT", weatherData: weatherData, hasTrigger: hasTrigger(for: flight.takeoffAlt), onTap: onICAOTap)
                }
                if !flight.alt1.isEmpty {
                    ICAOCell(icao: flight.alt1, label: "ALT1", weatherData: weatherData, hasTrigger: hasTrigger(for: flight.alt1), onTap: onICAOTap)
                }
                if !flight.alt2.isEmpty {
                    ICAOCell(icao: flight.alt2, label: "ALT2", weatherData: weatherData, hasTrigger: hasTrigger(for: flight.alt2), onTap: onICAOTap)
                }
            }
            
            // Taxi, Burn, Duration row
            if !flight.taxiOut.isEmpty || !flight.burnoff.isEmpty || !flight.duration.isEmpty {
                HStack(spacing: 12) {
                    if !flight.taxiOut.isEmpty {
                        HStack(spacing: 4) {
                            Image(systemName: "car.fill")
                                .font(.caption)
                            Text("\(flight.taxiOut)m")
                                .font(.caption)
                        }
                        .foregroundColor(.secondary)
                    }
                    if !flight.burnoff.isEmpty {
                        HStack(spacing: 4) {
                            Image(systemName: "flame.fill")
                                .font(.caption)
                            Text("\(flight.burnoff)m")
                                .font(.caption)
                        }
                        .foregroundColor(.orange)
                    }
                    if !flight.duration.isEmpty {
                        HStack(spacing: 4) {
                            Image(systemName: "clock.fill")
                                .font(.caption)
                            Text("\(flight.duration)m")
                                .font(.caption)
                        }
                        .foregroundColor(.blue)
                    }
                }
                .padding(.top, 2)
            }
            
            // Triggers row
            if !flight.triggers.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(flight.triggers), id: \.self) { trigger in
                            Text(trigger.replacingOccurrences(of: ":", with: " "))
                                .font(.caption2)
                                .fontWeight(.medium)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(triggerColor(for: trigger))
                                .foregroundColor(.white)
                                .cornerRadius(6)
                        }
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(.vertical, 8)
        .background(backgroundColor.opacity(0.3))
        .cornerRadius(8)
    }
    
    private var backgroundColor: Color {
        if flight.isPastEta {
            return .red.opacity(0.1)
        } else if !flight.triggers.isEmpty {
            if flight.triggers.contains(where: { $0.contains("red") || $0.contains("critical") }) {
                return .red.opacity(0.1)
            } else {
                return .orange.opacity(0.1)
            }
        }
        return .clear
    }
    
    private func hasTrigger(for icao: String) -> Bool {
        flight.triggers.contains { $0.contains(icao) }
    }
    
    private func formatTime(_ time: String) -> String {
        guard time.count == 4 else { return time }
        let index = time.index(time.startIndex, offsetBy: 2)
        return "\(time[..<index]):\(time[index...])"
    }
    
    private func triggerColor(for trigger: String) -> Color {
        if trigger.contains("red") || trigger.contains("critical") || trigger.contains("noalt") {
            return .red
        } else if trigger.contains("bold") || trigger.contains("dest") || trigger.contains("approach-mins") {
            return .orange
        } else if trigger.contains("improved") {
            return .green
        }
        return .blue
    }
}

struct ICAOCell: View {
    let icao: String
    let label: String
    let weatherData: [String: WeatherResponse]
    let hasTrigger: Bool
    let onTap: (String) -> Void
    
    var body: some View {
        Button(action: {
            if !icao.isEmpty {
                onTap(icao)
            }
        }) {
            VStack(spacing: 3) {
                Text(label)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                Text(icao.isEmpty ? "—" : icao)
                    .font(.system(.body, design: .monospaced))
                    .fontWeight(hasTrigger ? .bold : .medium)
                    .foregroundColor(cellColor)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(backgroundColor)
            .cornerRadius(8)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(borderColor, lineWidth: hasTrigger ? 2 : 0)
            )
        }
        .buttonStyle(.plain)
    }
    
    private var cellColor: Color {
        if icao.isEmpty {
            return .secondary
        } else if hasTrigger {
            return .red
        } else if hasWeatherData {
            return .blue
        }
        return .primary
    }
    
    private var backgroundColor: Color {
        if hasTrigger {
            return .red.opacity(0.15)
        } else if hasWeatherData {
            return .blue.opacity(0.1)
        }
        return Color.gray.opacity(0.1)
    }
    
    private var borderColor: Color {
        if hasTrigger {
            return .red
        }
        return .clear
    }
    
    private var hasWeatherData: Bool {
        !icao.isEmpty && weatherData[icao] != nil
    }
}


