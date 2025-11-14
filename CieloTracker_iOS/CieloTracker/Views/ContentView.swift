//
//  ContentView.swift
//  CieloTracker
//

import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Flight.etd) private var flights: [Flight]
    @StateObject private var viewModel = FlightListViewModel()
    @State private var showingWeather = false
    @State private var selectedICAO = ""
    @State private var showingSyncOptions = false
    @State private var showingAddFlight = false
    @State private var showingQRScanner = false
    
    var body: some View {
        NavigationStack {
            ZStack {
                if flights.isEmpty {
                    VStack(spacing: 20) {
                        Image(systemName: "airplane")
                            .font(.system(size: 60))
                            .foregroundColor(.gray)
                        Text("No Flights")
                            .font(.title2)
                            .foregroundColor(.gray)
                        Text("Import flights from the web app or add manually")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                } else {
                    FlightListView(
                        flights: flights,
                        weatherData: viewModel.weatherData,
                        onICAOTap: { icao in
                            selectedICAO = icao
                            showingWeather = true
                        }
                    )
                }
            }
            .navigationTitle("CieloTracker Pro")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        showingAddFlight = true
                    }) {
                        Image(systemName: "plus")
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: {
                            showingQRScanner = true
                        }) {
                            Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                        }
                        
                        Button(action: {
                            showingSyncOptions = true
                        }) {
                            Label("Import JSON", systemImage: "arrow.clockwise")
                        }
                        
                        Button(action: {
                            exportFlights()
                        }) {
                            Label("Export JSON", systemImage: "square.and.arrow.up")
                        }
                        
                        Button(action: {
                            refreshWeather()
                        }) {
                            Label("Refresh Weather", systemImage: "cloud.sun")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showingQRScanner) {
                QRCodeScannerView()
            }
            .sheet(isPresented: $showingSyncOptions) {
                SyncOptionsView()
            }
            .sheet(isPresented: $showingWeather) {
                WeatherDetailView(icao: selectedICAO, weatherData: viewModel.weatherData[selectedICAO])
            }
            .sheet(isPresented: $showingAddFlight) {
                AddFlightView()
            }
            .onChange(of: flights.count) { _, _ in
                Task {
                    await viewModel.loadWeather(for: flights, modelContext: modelContext)
                }
            }
            .task {
                await viewModel.loadWeather(for: flights, modelContext: modelContext)
            }
        }
    }
    
    private func exportFlights() {
        let jsonString = FlightSyncService.shared.exportFlightsToJSON(flights)
        // Share or copy to clipboard
        if let json = jsonString {
            UIPasteboard.general.string = json
            // You could also show a share sheet here
        }
    }
    
    private func refreshWeather() {
        Task {
            await viewModel.loadWeather(for: flights, modelContext: modelContext)
        }
    }
}

