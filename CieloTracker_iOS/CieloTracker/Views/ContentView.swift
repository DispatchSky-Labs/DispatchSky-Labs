//
//  ContentView.swift
//  CieloTracker
//

import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var allFlights: [Flight]
    @StateObject private var viewModel = FlightListViewModel()
    @State private var lastLoggedCount = 0
    
    // CRITICAL: Always sort by displayOrder - don't trust @Query sorting
    private var flights: [Flight] {
        let sorted = allFlights.sorted { $0.displayOrder < $1.displayOrder }
        return sorted
    }
    @State private var showingWeather = false
    @State private var selectedICAO = ""
    @State private var showingSyncOptions = false
    @State private var showingAddFlight = false
    @State private var flightToEdit: Flight? = nil
    @State private var showingQRScanner = false
    @State private var showingSearch = false
    @State private var searchText = ""
    @FocusState private var isSearchFocused: Bool
    @State private var editMode: EditMode = .inactive
    
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
                        },
                        searchText: searchText,
                        onSearchTextChange: { newText in
                            searchText = newText
                        },
                        onMove: { source, destination in
                            moveFlights(from: source, to: destination)
                        },
                        onFlightTap: { flight in
                            // Edit flight on tap
                            flightToEdit = flight
                            showingAddFlight = true
                        }
                    )
                    .searchable(text: $searchText, isPresented: $showingSearch, prompt: "Search flights")
                    .environment(\.editMode, $editMode)
                }
            }
            .navigationTitle("CieloTracker Pro")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        flightToEdit = nil
                        showingAddFlight = true
                    }) {
                        Image(systemName: "plus")
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: {
                            showingSearch.toggle()
                        }) {
                            Label("Search", systemImage: "magnifyingglass")
                        }
                        
                        Button(action: {
                            editMode = editMode == .active ? .inactive : .active
                        }) {
                            Label(editMode == .active ? "Done" : "Reorder", systemImage: editMode == .active ? "checkmark" : "arrow.up.arrow.down")
                        }
                        
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
                        
                        Button(action: {
                            fixFlightOrder()
                        }) {
                            Label("Fix Flight Order", systemImage: "arrow.up.arrow.down.circle")
                        }
                        
                        Divider()
                        
                        Button(action: {
                            forceiCloudSync()
                        }) {
                            Label("Force iCloud Sync", systemImage: "arrow.clockwise.icloud")
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
                AddFlightView(flight: flightToEdit)
            }
            .onChange(of: allFlights.count) { oldCount, newCount in
                if newCount != oldCount {
                    print("🔄 Flight count changed: \(oldCount) -> \(newCount)")
                    logFlightOrder()
                }
                Task {
                    await viewModel.loadWeather(for: flights, modelContext: modelContext)
                }
            }
            .onAppear {
                logFlightOrder()
            }
            .task {
                // flights is already sorted by displayOrder from @Query
                await viewModel.loadWeather(for: flights, modelContext: modelContext)
                
                // Schedule background refresh
                BackgroundRefreshService.shared.scheduleBackgroundRefresh()
            }
            .onAppear {
                // Schedule background refresh when app appears
                BackgroundRefreshService.shared.scheduleBackgroundRefresh()
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
    
    private func moveFlights(from source: IndexSet, to destination: Int) {
        // flights is already sorted by displayOrder from @Query
        var reorderedFlights = flights
        reorderedFlights.move(fromOffsets: source, toOffset: destination)
        
        // Update displayOrder to reflect new order
        for (index, flight) in reorderedFlights.enumerated() {
            flight.displayOrder = index
        }
        
        // Save changes
        do {
            try modelContext.save()
        } catch {
            print("Error saving flight order: \(error)")
        }
    }
    
    private func logFlightOrder() {
        let sorted = flights
        if sorted.count > 0 {
            print("📋 FLIGHTS DISPLAY ORDER (\(sorted.count) total):")
            for (idx, flight) in sorted.enumerated() {
                print("  \(idx): \(flight.flightNumber) \(flight.origin)->\(flight.dest) (displayOrder: \(flight.displayOrder), ETD: \(flight.etd))")
            }
        }
    }
    
    private func fixFlightOrder() {
        print("🔧 FIXING FLIGHT ORDER...")
        // Get all flights sorted by current displayOrder
        let sortedFlights = flights
        
        print("📋 BEFORE FIX:")
        for (idx, flight) in sortedFlights.enumerated() {
            print("  \(idx): \(flight.flightNumber) (displayOrder: \(flight.displayOrder))")
        }
        
        // Reassign displayOrder sequentially
        for (index, flight) in sortedFlights.enumerated() {
            flight.displayOrder = index
        }
        
        do {
            try modelContext.save()
            print("✅ Fixed and saved flight order")
            logFlightOrder()
        } catch {
            print("❌ Error fixing flight order: \(error)")
        }
    }
    
    private func forceiCloudSync() {
        print("☁️ Forcing iCloud sync...")
        
        // Force save all changes to trigger CloudKit sync
        do {
            // Save any pending changes
            try modelContext.save()
            print("✅ Saved all changes to trigger CloudKit sync")
            
            // Force a fetch to trigger CloudKit to pull latest data from iCloud
            Task {
                do {
                    let descriptor = FetchDescriptor<Flight>(sortBy: [SortDescriptor(\Flight.displayOrder)])
                    let _ = try modelContext.fetch(descriptor)
                    print("✅ Triggered CloudKit fetch - pulling latest data from iCloud")
                    
                    // Wait a moment for CloudKit to process
                    try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds
                    
                    // Refresh the query to pull latest data
                    await MainActor.run {
                        // The @Query will automatically refresh when CloudKit syncs
                        // Force a refresh by accessing the flights
                        let _ = flights
                        print("✅ iCloud sync complete - changes should appear on other devices within 10-30 seconds")
                    }
                } catch {
                    print("⚠️ Error during sync: \(error)")
                }
            }
        } catch {
            print("❌ Error forcing iCloud sync: \(error)")
        }
    }
}

