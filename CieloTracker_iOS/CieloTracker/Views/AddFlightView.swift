//
//  AddFlightView.swift
//  CieloTracker
//

import SwiftUI
import SwiftData

struct AddFlightView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    var flight: Flight? = nil // If provided, we're editing; otherwise adding
    @State private var flightNumber = ""
    @State private var origin = ""
    @State private var dest = ""
    @State private var etd = ""
    @State private var eta = ""
    @State private var duration = ""
    @State private var originalEtd: String = "" // Track original ETD to calculate ETA delta
    
    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Flight Information")) {
                    TextField("Flight Number", text: $flightNumber)
                        .textInputAutocapitalization(.never)
                    TextField("Origin", text: $origin)
                        .textInputAutocapitalization(.characters)
                    TextField("Destination", text: $dest)
                        .textInputAutocapitalization(.characters)
                    TextField("ETD (HHMM)", text: $etd)
                        .keyboardType(.numberPad)
                        .onChange(of: etd) { oldValue, newValue in
                            updateEtaFromEtdChange(oldEtd: oldValue, newEtd: newValue)
                        }
                    TextField("ETA (HHMM)", text: $eta)
                        .keyboardType(.numberPad)
                    TextField("Duration (minutes)", text: $duration)
                        .keyboardType(.numberPad)
                }
            }
            .navigationTitle(flight == nil ? "Add Flight" : "Edit Flight")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if let flight = flight {
                    // Populate fields for editing
                    flightNumber = flight.flightNumber
                    origin = flight.origin
                    dest = flight.dest
                    etd = flight.etd
                    eta = flight.eta
                    duration = flight.duration
                    originalEtd = flight.etd
                }
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        saveFlight()
                    }
                    .disabled(!isValid)
                }
            }
        }
    }
    
    private var isValid: Bool {
        !flightNumber.isEmpty &&
        !origin.isEmpty &&
        !dest.isEmpty &&
        !etd.isEmpty &&
        !eta.isEmpty &&
        etd.count == 4 &&
        eta.count == 4
    }
    
    private func saveFlight() {
        let normalizedEtd = normalizeTime(etd)
        let normalizedEta = normalizeTime(eta)
        let normalizedDuration = duration.isEmpty ? "" : duration
        
        if let existingFlight = flight {
            // Update existing flight
            existingFlight.flightNumber = flightNumber.uppercased()
            existingFlight.origin = normalizeICAO(origin)
            existingFlight.dest = normalizeICAO(dest)
            existingFlight.etd = normalizedEtd
            existingFlight.eta = normalizedEta
            existingFlight.duration = normalizedDuration
        } else {
            // Create new flight
            let newFlight = Flight(
                flightNumber: flightNumber.uppercased(),
                origin: normalizeICAO(origin),
                dest: normalizeICAO(dest),
                etd: normalizedEtd,
                eta: normalizedEta,
                duration: normalizedDuration
            )
            // Set displayOrder to be after all existing flights
            let descriptor = FetchDescriptor<Flight>(sortBy: [SortDescriptor(\Flight.displayOrder, order: .reverse)])
            if let lastFlight = try? modelContext.fetch(descriptor).first {
                newFlight.displayOrder = lastFlight.displayOrder + 1
            } else {
                newFlight.displayOrder = 0
            }
            modelContext.insert(newFlight)
        }
        
        do {
            try modelContext.save()
            dismiss()
        } catch {
            print("Error saving flight: \(error)")
        }
    }
    
    private func updateEtaFromEtdChange(oldEtd: String, newEtd: String) {
        // Only update if we have a valid duration and both ETD values are valid
        guard !duration.isEmpty,
              let durationMinutes = Int(duration),
              durationMinutes > 0,
              oldEtd.count == 4, newEtd.count == 4,
              let oldHours = Int(oldEtd.prefix(2)),
              let oldMinutes = Int(oldEtd.suffix(2)),
              let newHours = Int(newEtd.prefix(2)),
              let newMinutes = Int(newEtd.suffix(2)),
              oldHours >= 0, oldHours < 24, oldMinutes >= 0, oldMinutes < 60,
              newHours >= 0, newHours < 24, newMinutes >= 0, newMinutes < 60 else {
            return
        }
        
        // Calculate the change in ETD
        let oldEtdTotalMinutes = oldHours * 60 + oldMinutes
        let newEtdTotalMinutes = newHours * 60 + newMinutes
        let etdDeltaMinutes = newEtdTotalMinutes - oldEtdTotalMinutes
        
        // If we have an existing ETA, update it proportionally
        if !eta.isEmpty, eta.count == 4,
           let etaHours = Int(eta.prefix(2)),
           let etaMinutes = Int(eta.suffix(2)),
           etaHours >= 0, etaHours < 24, etaMinutes >= 0, etaMinutes < 60 {
            var newEtaTotalMinutes = (etaHours * 60 + etaMinutes) + etdDeltaMinutes
            
            // Handle day wrap-around
            while newEtaTotalMinutes < 0 {
                newEtaTotalMinutes += 24 * 60
            }
            while newEtaTotalMinutes >= 24 * 60 {
                newEtaTotalMinutes -= 24 * 60
            }
            
            let newEtaHours = newEtaTotalMinutes / 60
            let newEtaMins = newEtaTotalMinutes % 60
            eta = String(format: "%02d%02d", newEtaHours, newEtaMins)
        } else if !originalEtd.isEmpty, originalEtd.count == 4,
                  let origHours = Int(originalEtd.prefix(2)),
                  let origMinutes = Int(originalEtd.suffix(2)),
                  origHours >= 0, origHours < 24, origMinutes >= 0, origMinutes < 60 {
            // Calculate ETA from original ETD + duration
            let origEtdTotalMinutes = origHours * 60 + origMinutes
            var newEtaTotalMinutes = origEtdTotalMinutes + durationMinutes + etdDeltaMinutes
            
            // Handle day wrap-around
            while newEtaTotalMinutes < 0 {
                newEtaTotalMinutes += 24 * 60
            }
            while newEtaTotalMinutes >= 24 * 60 {
                newEtaTotalMinutes -= 24 * 60
            }
            
            let newEtaHours = newEtaTotalMinutes / 60
            let newEtaMins = newEtaTotalMinutes % 60
            eta = String(format: "%02d%02d", newEtaHours, newEtaMins)
        }
    }
    
    private func normalizeICAO(_ code: String) -> String {
        let clean = code.trimmingCharacters(in: .whitespaces).uppercased()
        if clean.count == 4 {
            return clean
        }
        if clean.count == 3 {
            if clean.first == "Y" {
                return "C" + clean
            }
            return "K" + clean
        }
        return clean
    }
    
    private func normalizeTime(_ time: String) -> String {
        let cleaned = time.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ":", with: "")
        guard !cleaned.isEmpty, let digits = Int(cleaned) else { return "" }
        
        var hours = 0
        var minutes = 0
        
        if cleaned.count == 1 {
            minutes = digits
        } else if cleaned.count == 2 {
            if digits <= 59 {
                minutes = digits
            } else {
                hours = digits / 100
                minutes = digits % 100
            }
        } else if cleaned.count == 3 {
            hours = digits / 100
            minutes = digits % 100
        } else if cleaned.count >= 4 {
            let hoursStr = String(cleaned.prefix(2))
            let minsStr = String(cleaned.suffix(2))
            hours = Int(hoursStr) ?? 0
            minutes = Int(minsStr) ?? 0
        }
        
        hours = hours % 24
        minutes = minutes % 60
        
        return String(format: "%02d%02d", hours, minutes)
    }
}

