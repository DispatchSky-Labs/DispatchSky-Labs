//
//  SyncOptionsView.swift
//  CieloTracker
//

import SwiftUI
import SwiftData

struct SyncOptionsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var jsonInput = ""
    @State private var pasteInput = ""
    @State private var showingImportAlert = false
    @State private var importMessage = ""
    @State private var isImportSuccess = false
    @State private var importMode: ImportMode = .json
    
    enum ImportMode {
        case json
        case paste
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Picker("Import Mode", selection: $importMode) {
                    Text("JSON Import").tag(ImportMode.json)
                    Text("Paste Flights").tag(ImportMode.paste)
                }
                .pickerStyle(.segmented)
                
                if importMode == .json {
                    Section(header: Text("Import from Web App")) {
                        Text("Paste JSON from web app's localStorage:")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        TextEditor(text: $jsonInput)
                            .frame(height: 200)
                            .font(.system(.body, design: .monospaced))
                        
                        Button("Import Flights") {
                            importFlightsFromJSON()
                        }
                        .disabled(jsonInput.isEmpty)
                    }
                    
                    Section(header: Text("Instructions")) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("1. Open the web app (pro_beta.html) in your browser")
                            Text("2. Open browser DevTools (F12 or Cmd+Option+I)")
                            Text("3. Go to Console tab")
                            Text("4. Run: JSON.stringify(JSON.parse(localStorage.getItem('ct_pro_flights')))")
                            Text("5. Copy the output and paste it above")
                            Text("6. Tap 'Import Flights'")
                        }
                        .font(.caption)
                        .foregroundColor(.secondary)
                    }
                } else {
                    Section(header: Text("Paste Dispatch Worksheet")) {
                        Text("Paste dispatch worksheet data (preserves order):")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        TextEditor(text: $pasteInput)
                            .frame(height: 300)
                            .font(.system(.body, design: .monospaced))
                        
                        Button("Import Flights") {
                            importFlightsFromPaste()
                        }
                        .disabled(pasteInput.isEmpty)
                    }
                    
                    Section(header: Text("Fix Order")) {
                        Button(action: {
                            fixExistingFlightOrder()
                        }) {
                            HStack {
                                Image(systemName: "arrow.up.arrow.down.circle.fill")
                                Text("Fix Flight Order (if scrambled)")
                            }
                            .foregroundColor(.orange)
                            .frame(maxWidth: .infinity)
                        }
                    }
                    
                    Section(header: Text("Format")) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Supports dispatch worksheet format:")
                            Text("80 0700 10 SKW 5728  ORD    0700  GRR    0800")
                            Text("Or simple format:")
                            Text("SKW5728 ORD 0700 GRR 0800")
                        }
                        .font(.caption)
                        .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Sync Options")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .alert(importMessage, isPresented: $showingImportAlert) {
                Button("OK") {
                    if isImportSuccess {
                        dismiss()
                    }
                }
            }
        }
    }
    
    private func importFlightsFromJSON() {
        do {
            // Clear existing flights
            let descriptor = FetchDescriptor<Flight>()
            let existingFlights = try modelContext.fetch(descriptor)
            for flight in existingFlights {
                modelContext.delete(flight)
            }
            
            // Import new flights
            let flights = try FlightSyncService.shared.importFlightsFromJSON(jsonInput, context: modelContext)
            try modelContext.save()
            
            importMessage = "Successfully imported \(flights.count) flight(s)"
            isImportSuccess = true
            showingImportAlert = true
        } catch {
            importMessage = "Import failed: \(error.localizedDescription)"
            isImportSuccess = false
            showingImportAlert = true
        }
    }
    
    private func importFlightsFromPaste() {
        do {
            // Clear existing flights
            let descriptor = FetchDescriptor<Flight>()
            let existingFlights = try modelContext.fetch(descriptor)
            for flight in existingFlights {
                modelContext.delete(flight)
            }
            // Save deletion first
            try modelContext.save()
            
            // Parse and import flights from pasted text
            print("🔄 STARTING PASTE IMPORT...")
            let importedFlights = try FlightSyncService.shared.importFlightsFromPaste(pasteInput, context: modelContext)
            print("✅ Parsed \(importedFlights.count) flights from paste")
            
            // CRITICAL: The import function should have set displayOrder, but let's verify and fix
            // Get flights in the order they were imported (which should match paste order)
            let flightsArray = Array(importedFlights)
            
            print("🔧 Verifying and fixing displayOrder for all \(flightsArray.count) flights...")
            for (index, flight) in flightsArray.enumerated() {
                let oldOrder = flight.displayOrder
                flight.displayOrder = index
                if oldOrder != index {
                    print("  ⚠️ Fixed flight \(index): \(flight.flightNumber) - displayOrder \(oldOrder) -> \(index)")
                } else {
                    print("  ✅ Flight \(index): \(flight.flightNumber) - displayOrder already \(index)")
                }
            }
            
            // Save the context
            print("💾 Saving to database...")
            try modelContext.save()
            
            // Force another save to ensure persistence
            try modelContext.save()
            print("💾 Second save complete")
            
            // Verify by fetching back with explicit sort
            print("🔍 Verifying saved order...")
            let verifyDescriptor = FetchDescriptor<Flight>(sortBy: [SortDescriptor(\Flight.displayOrder, order: .forward)])
            let verifyFlights = try modelContext.fetch(verifyDescriptor)
            print("📊 Fetched \(verifyFlights.count) flights from database (sorted by displayOrder)")
            
            // Log the order
            print("📋 VERIFIED ORDER IN DATABASE:")
            for (idx, flight) in verifyFlights.enumerated() {
                print("  \(idx): \(flight.flightNumber) \(flight.origin)->\(flight.dest) (displayOrder: \(flight.displayOrder), ETD: \(flight.etd))")
            }
            
            // Final fix: ensure displayOrder is sequential
            var needsFix = false
            for (index, flight) in verifyFlights.enumerated() {
                if flight.displayOrder != index {
                    print("⚠️ FINAL FIX: Flight \(flight.flightNumber) has displayOrder \(flight.displayOrder), setting to \(index)")
                    flight.displayOrder = index
                    needsFix = true
                }
            }
            if needsFix {
                try modelContext.save()
                print("💾 Final fix saved")
            }
            print("✅ IMPORT COMPLETE - \(importedFlights.count) flights imported")
            
            importMessage = "Successfully imported \(importedFlights.count) flight(s)"
            isImportSuccess = true
            showingImportAlert = true
        } catch {
            importMessage = "Import failed: \(error.localizedDescription)"
            isImportSuccess = false
            showingImportAlert = true
        }
    }
    
    private func fixExistingFlightOrder() {
        do {
            print("🔧 FIXING EXISTING FLIGHT ORDER...")
            let descriptor = FetchDescriptor<Flight>(sortBy: [SortDescriptor(\Flight.displayOrder, order: .forward)])
            let allFlights = try modelContext.fetch(descriptor)
            
            if allFlights.isEmpty {
                importMessage = "No flights to fix"
                isImportSuccess = false
                showingImportAlert = true
                return
            }
            
            print("📋 BEFORE FIX (\(allFlights.count) flights):")
            for (idx, flight) in allFlights.enumerated() {
                print("  \(idx): \(flight.flightNumber) (displayOrder: \(flight.displayOrder))")
            }
            
            // Reassign displayOrder sequentially
            for (index, flight) in allFlights.enumerated() {
                flight.displayOrder = index
            }
            
            try modelContext.save()
            print("✅ Fixed and saved flight order")
            
            // Verify
            let verifyFlights = try modelContext.fetch(descriptor)
            print("📋 AFTER FIX:")
            for (idx, flight) in verifyFlights.enumerated() {
                print("  \(idx): \(flight.flightNumber) (displayOrder: \(flight.displayOrder))")
            }
            
            importMessage = "Fixed order for \(allFlights.count) flight(s)"
            isImportSuccess = true
            showingImportAlert = true
        } catch {
            importMessage = "Fix failed: \(error.localizedDescription)"
            isImportSuccess = false
            showingImportAlert = true
        }
    }
}

