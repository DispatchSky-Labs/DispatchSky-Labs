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
                            Section {
                                Text("METAR")
                                    .font(.headline)
                                    .foregroundColor(.secondary)
                                Text(metar)
                                    .font(.system(.body, design: .monospaced))
                                    .textSelection(.enabled)
                            }
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
}

