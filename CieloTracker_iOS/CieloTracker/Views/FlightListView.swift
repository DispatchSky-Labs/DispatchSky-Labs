//
//  FlightListView.swift
//  CieloTracker
//

import SwiftUI

struct FlightListView: View {
    let flights: [Flight]
    let weatherData: [String: WeatherResponse]
    let onICAOTap: (String) -> Void
    
    var body: some View {
        List {
            ForEach(flights, id: \.id) { flight in
                FlightRowView(
                    flight: flight,
                    weatherData: weatherData,
                    onICAOTap: onICAOTap
                )
            }
        }
        .listStyle(.plain)
    }
}

struct FlightRowView: View {
    let flight: Flight
    let weatherData: [String: WeatherResponse]
    let onICAOTap: (String) -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(flight.flightNumber)
                    .font(.headline)
                    .fontWeight(.bold)
                
                Spacer()
                
                Text(formatTime(flight.etd))
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Text("→")
                    .foregroundColor(.secondary)
                
                Text(formatTime(flight.eta))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            HStack(spacing: 12) {
                ICAOCell(icao: flight.origin, label: "ORG", weatherData: weatherData, onTap: onICAOTap)
                ICAOCell(icao: flight.dest, label: "DEST", weatherData: weatherData, onTap: onICAOTap)
                if !flight.takeoffAlt.isEmpty {
                    ICAOCell(icao: flight.takeoffAlt, label: "T/ALT", weatherData: weatherData, onTap: onICAOTap)
                }
                if !flight.alt1.isEmpty {
                    ICAOCell(icao: flight.alt1, label: "ALT1", weatherData: weatherData, onTap: onICAOTap)
                }
                if !flight.alt2.isEmpty {
                    ICAOCell(icao: flight.alt2, label: "ALT2", weatherData: weatherData, onTap: onICAOTap)
                }
            }
            
            if !flight.taxiOut.isEmpty || !flight.burnoff.isEmpty {
                HStack(spacing: 16) {
                    if !flight.taxiOut.isEmpty {
                        Label("Taxi: \(flight.taxiOut)min", systemImage: "car")
                            .font(.caption)
                    }
                    if !flight.burnoff.isEmpty {
                        Label("Burn: \(flight.burnoff)min", systemImage: "flame")
                            .font(.caption)
                    }
                    if !flight.duration.isEmpty {
                        Label("Dur: \(flight.duration)min", systemImage: "clock")
                            .font(.caption)
                    }
                }
                .foregroundColor(.secondary)
            }
            
            // Show triggers if any
            if !flight.triggers.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(Array(flight.triggers), id: \.self) { trigger in
                            Text(trigger)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(triggerColor(for: trigger).opacity(0.2))
                                .foregroundColor(triggerColor(for: trigger))
                                .cornerRadius(4)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
    
    private func formatTime(_ time: String) -> String {
        guard time.count == 4 else { return time }
        let index = time.index(time.startIndex, offsetBy: 2)
        return "\(time[..<index]):\(time[index...])"
    }
    
    private func triggerColor(for trigger: String) -> Color {
        if trigger.contains("red") || trigger.contains("critical") || trigger.contains("noalt") {
            return .red
        } else if trigger.contains("bold") || trigger.contains("dest") {
            return .orange
        }
        return .blue
    }
}

struct ICAOCell: View {
    let icao: String
    let label: String
    let weatherData: [String: WeatherResponse]
    let onTap: (String) -> Void
    
    var body: some View {
        Button(action: {
            if !icao.isEmpty {
                onTap(icao)
            }
        }) {
            VStack(spacing: 2) {
                Text(label)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                Text(icao.isEmpty ? "—" : icao)
                    .font(.system(.body, design: .monospaced))
                    .fontWeight(.medium)
                    .foregroundColor(icao.isEmpty ? .secondary : .primary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(hasWeatherData ? Color.blue.opacity(0.1) : Color.clear)
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
    }
    
    private var hasWeatherData: Bool {
        weatherData[icao] != nil
    }
}

