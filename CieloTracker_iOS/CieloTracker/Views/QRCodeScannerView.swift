//
//  QRCodeScannerView.swift
//  CieloTracker
//

import SwiftUI
import AVFoundation

struct QRCodeScannerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @StateObject private var scanner = QRCodeScanner()
    @State private var showingImportAlert = false
    @State private var importMessage = ""
    @State private var isImportSuccess = false
    
    var body: some View {
        NavigationStack {
            ZStack {
                // Camera preview
                CameraPreview(scanner: scanner)
                    .ignoresSafeArea()
                
                // Overlay with scanning frame
                VStack {
                    HStack {
                        Spacer()
                        Button(action: {
                            scanner.stopScanning()
                            dismiss()
                        }) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.title)
                                .foregroundColor(.white)
                                .background(Color.black.opacity(0.7))
                                .clipShape(Circle())
                                .padding()
                        }
                    }
                    .padding()
                    
                    Spacer()
                    
                    VStack(spacing: 20) {
                        Text("Point camera at QR code")
                            .font(.headline)
                            .foregroundColor(.white)
                            .padding()
                            .background(Color.black.opacity(0.7))
                            .cornerRadius(10)
                        
                        // Scanning frame
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(Color.white, lineWidth: 2)
                            .frame(width: 250, height: 250)
                            .overlay(
                                RoundedRectangle(cornerRadius: 20)
                                    .stroke(Color.blue, lineWidth: 3)
                                    .frame(width: 250, height: 250)
                                    .opacity(scanner.isScanning ? 1 : 0.3)
                            )
                    }
                    
                    Spacer()
                }
            }
            .navigationTitle("Scan QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarHidden(true)
            .onAppear {
                // Start scanning after a small delay to ensure view is ready
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    scanner.startScanning()
                }
            }
            .onDisappear {
                scanner.stopScanning()
            }
            .onChange(of: scanner.scannedCode) { _, newValue in
                if let code = newValue, !code.isEmpty {
                    handleScannedCode(code)
                }
            }
            .alert(importMessage, isPresented: $showingImportAlert) {
                Button("OK") {
                    if isImportSuccess {
                        dismiss()
                    } else {
                        scanner.scannedCode = nil // Reset for retry
                        scanner.startScanning() // Resume scanning on error
                    }
                }
            }
        }
    }
    
    private func handleScannedCode(_ code: String) {
        scanner.stopScanning()
        
        do {
            // Clear existing flights
            let descriptor = FetchDescriptor<Flight>()
            let existingFlights = try modelContext.fetch(descriptor)
            for flight in existingFlights {
                modelContext.delete(flight)
            }
            
            // Import new flights from QR code
            let flights = try FlightSyncService.shared.importFlightsFromJSON(code, context: modelContext)
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

// QR Code Scanner using AVFoundation
class QRCodeScanner: NSObject, ObservableObject, AVCaptureMetadataOutputObjectsDelegate {
    @Published var scannedCode: String?
    @Published var isScanning = false
    
    private var captureSession: AVCaptureSession?
    var previewLayer: AVCaptureVideoPreviewLayer?
    
    func startScanning() {
        // Don't start if already scanning
        guard captureSession == nil else { return }
        
        guard let videoCaptureDevice = AVCaptureDevice.default(for: .video) else {
            print("Failed to get video capture device")
            return
        }
        
        let videoInput: AVCaptureDeviceInput
        do {
            videoInput = try AVCaptureDeviceInput(device: videoCaptureDevice)
        } catch {
            print("Failed to create video input: \(error)")
            return
        }
        
        let captureSession = AVCaptureSession()
        captureSession.sessionPreset = .high
        self.captureSession = captureSession
        
        if captureSession.canAddInput(videoInput) {
            captureSession.addInput(videoInput)
        } else {
            print("Cannot add video input")
            return
        }
        
        let metadataOutput = AVCaptureMetadataOutput()
        if captureSession.canAddOutput(metadataOutput) {
            captureSession.addOutput(metadataOutput)
            
            metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            metadataOutput.metadataObjectTypes = [.qr]
        } else {
            print("Cannot add metadata output")
            return
        }
        
        let previewLayer = AVCaptureVideoPreviewLayer(session: captureSession)
        previewLayer.videoGravity = .resizeAspectFill
        self.previewLayer = previewLayer
        
        DispatchQueue.global(qos: .userInitiated).async {
            captureSession.startRunning()
            DispatchQueue.main.async {
                self.isScanning = true
            }
        }
    }
    
    func stopScanning() {
        captureSession?.stopRunning()
        isScanning = false
        captureSession = nil
        previewLayer = nil
    }
    
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        // Only process if we haven't already scanned a code
        guard scannedCode == nil else { return }
        
        guard let metadataObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let stringValue = metadataObject.stringValue,
              !stringValue.isEmpty else {
            return
        }
        
        // Validate that it looks like JSON
        guard stringValue.trimmingCharacters(in: .whitespaces).hasPrefix("[") else {
            print("Scanned code doesn't look like JSON array")
            return
        }
        
        scannedCode = stringValue
    }
}

// SwiftUI wrapper for camera preview
struct CameraPreview: UIViewRepresentable {
    @ObservedObject var scanner: QRCodeScanner
    
    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.backgroundColor = .black
        return view
    }
    
    func updateUIView(_ uiView: UIView, context: Context) {
        // Add preview layer if it exists and hasn't been added yet
        if let previewLayer = scanner.previewLayer {
            if previewLayer.superlayer == nil {
                previewLayer.frame = uiView.bounds
                uiView.layer.addSublayer(previewLayer)
            } else {
                // Update frame when view bounds change
                DispatchQueue.main.async {
                    previewLayer.frame = uiView.bounds
                }
            }
        }
    }
}

