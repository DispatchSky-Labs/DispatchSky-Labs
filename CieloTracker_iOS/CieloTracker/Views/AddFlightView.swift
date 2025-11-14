//
//  AddFlightView.swift
//  CieloTracker
//

import SwiftUI
import SwiftData

struct AddFlightView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var flightNumber = ""
    @State private var origin = ""
    @State private var dest = ""
    @State private var etd = ""
    @State private var eta = ""
    
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
                    TextField("ETA (HHMM)", text: $eta)
                        .keyboardType(.numberPad)
                }
            }
            .navigationTitle("Add Flight")
            .navigationBarTitleDisplayMode(.inline)
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
        !eta.isEmpty
    }
    
    private func saveFlight() {
        let flight = Flight(
            flightNumber: flightNumber.uppercased(),
            origin: normalizeICAO(origin),
            dest: normalizeICAO(dest),
            etd: normalizeTime(etd),
            eta: normalizeTime(eta)
        )
        modelContext.insert(flight)
        do {
            try modelContext.save()
            dismiss()
        } catch {
            print("Error saving flight: \(error)")
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

