//
//  EditTaxiBurnView.swift
//  CieloTracker
//

import SwiftUI
import SwiftData

struct EditTaxiBurnView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    let flight: Flight
    @State private var taxiOut: String = ""
    @State private var burnoff: String = ""
    
    @FocusState private var focusedField: Field?
    
    enum Field {
        case taxiOut, burnoff
    }
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Header
                VStack(spacing: 8) {
                    Text("Flight \(flight.flightNumber)")
                        .font(.headline)
                    Text("\(flight.origin) → \(flight.dest)")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity)
                .background(Color(.systemGroupedBackground))
                
                // Input fields
                VStack(spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Taxi Out (minutes)")
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                        TextField("Enter minutes", text: $taxiOut)
                            .keyboardType(.numberPad)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.title3, design: .monospaced))
                            .focused($focusedField, equals: .taxiOut)
                            .submitLabel(.next)
                            .onSubmit {
                                focusedField = .burnoff
                            }
                    }
                    
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Burn (minutes)")
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                        TextField("Enter minutes", text: $burnoff)
                            .keyboardType(.numberPad)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.title3, design: .monospaced))
                            .focused($focusedField, equals: .burnoff)
                            .submitLabel(.done)
                            .onSubmit {
                                save()
                            }
                    }
                }
                .padding(24)
                .frame(maxWidth: 500)
                .frame(maxWidth: .infinity)
                
                Spacer()
            }
            .navigationTitle("Edit Taxi & Burn")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                taxiOut = flight.taxiOut.isEmpty ? "" : flight.taxiOut
                burnoff = flight.burnoff.isEmpty ? "" : flight.burnoff
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                    }
                    .fontWeight(.semibold)
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        focusedField = nil
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(false)
    }
    
    private func save() {
        flight.taxiOut = taxiOut.trimmingCharacters(in: .whitespaces)
        flight.burnoff = burnoff.trimmingCharacters(in: .whitespaces)
        
        // Calculate duration and ETA if we have both taxi and burn
        if !flight.taxiOut.isEmpty && !flight.burnoff.isEmpty,
           let taxiMinutes = Int(flight.taxiOut),
           let burnMinutes = Int(flight.burnoff),
           !flight.etd.isEmpty {
            // Calculate ETA from ETD + taxi + burn
            let totalMinutes = taxiMinutes + burnMinutes
            flight.duration = String(totalMinutes)
            
            // Calculate ETA
            if let etdHours = Int(flight.etd.prefix(2)),
               let etdMins = Int(flight.etd.suffix(2)) {
                var totalEtdMinutes = etdHours * 60 + etdMins + totalMinutes
                
                // Handle day wrap-around
                while totalEtdMinutes >= 24 * 60 {
                    totalEtdMinutes -= 24 * 60
                }
                
                let etaHours = totalEtdMinutes / 60
                let etaMins = totalEtdMinutes % 60
                flight.eta = String(format: "%02d%02d", etaHours, etaMins)
            }
        }
        
        do {
            try modelContext.save()
            dismiss()
        } catch {
            print("Error saving taxi/burn: \(error)")
        }
    }
}

