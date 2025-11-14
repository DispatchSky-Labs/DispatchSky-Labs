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
    @State private var showingImportAlert = false
    @State private var importMessage = ""
    @State private var isImportSuccess = false
    
    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Import from Web App")) {
                    Text("Paste JSON from web app's localStorage:")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    TextEditor(text: $jsonInput)
                        .frame(height: 200)
                        .font(.system(.body, design: .monospaced))
                    
                    Button("Import Flights") {
                        importFlights()
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
    
    private func importFlights() {
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
}

