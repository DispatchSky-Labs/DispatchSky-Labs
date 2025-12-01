//
//  WeatherService.swift
//  CieloTracker
//

import Foundation
import Compression

class WeatherService: NSObject, XMLParserDelegate {
    static let shared = WeatherService()
    
    private let metarBaseURL = "https://aviationweather.gov/api/data/metar"
    private let tafCacheURL = "https://aviationweather.gov/data/cache/tafs.cache.xml.gz"
    
    // XML parsing state for TAF
    private var currentElement = ""
    private var currentStationID = ""
    private var currentRawTAF = ""
    private var tafResults: [AviationWeatherTAF] = []
    private var requestedICAOs: Set<String> = []
    private var isInsideTAF = false
    
    private override init() {
        super.init()
    }
    
    func fetchWeather(for icaoList: [String]) async throws -> [String: WeatherResponse] {
        guard !icaoList.isEmpty else {
            print("⚠️ fetchWeather called with empty ICAO list")
            return [:]
        }
        
        let ids = icaoList.joined(separator: ",")
        print("🔍 Requesting weather for ICAO codes: \(ids)")
        
        // Fetch METAR and TAF data in parallel
        async let metarData = fetchMETAR(ids: ids)
        async let tafData = fetchTAF(ids: ids)
        
        let (metarResults, tafResults) = try await (metarData, tafData)
        
        // Combine results by ICAO
        var weatherMap: [String: WeatherResponse] = [:]
        
        // Process METAR results
        for metar in metarResults {
            let icao = metar.stationId
            let existing = weatherMap[icao]
            weatherMap[icao] = WeatherResponse(
                icao: icao,
                metar: WeatherReport(raw: metar.rawOb),
                taf: existing?.taf
            )
        }
        
        // Process TAF results
        for taf in tafResults {
            let icao = taf.stationId
            let existing = weatherMap[icao]
            let tafReport = WeatherReport(raw: taf.rawTAF)
            weatherMap[icao] = WeatherResponse(
                icao: icao,
                metar: existing?.metar,
                taf: tafReport
            )
            if weatherMap.count <= 5 {
                let rawLength = taf.rawTAF?.count ?? 0
                print("🔗 Combined TAF for \(icao): raw length=\(rawLength), report.raw length=\(tafReport.raw?.count ?? 0)")
                if rawLength > 0 {
                    print("   TAF content preview: \(taf.rawTAF?.prefix(100) ?? "nil")")
                } else {
                    print("   ⚠️ WARNING: TAF rawTAF is nil or empty for \(icao)")
                }
            }
        }
        
        print("📊 Combined weather results: \(weatherMap.count) stations (METAR: \(metarResults.count), TAF: \(tafResults.count))")
        if weatherMap.isEmpty {
            print("⚠️ WARNING: No weather data was successfully combined. Requested \(icaoList.count) stations.")
        } else {
            print("   Weather stations with data: \(Array(weatherMap.keys).sorted().prefix(10).joined(separator: ", "))")
            // Check TAF data in final map
            let stationsWithTAF = weatherMap.filter { $0.value.taf?.raw != nil && !$0.value.taf!.raw!.isEmpty }
            print("   Stations with TAF data: \(stationsWithTAF.count) out of \(weatherMap.count)")
            if stationsWithTAF.count > 0 {
                let sampleTAF = stationsWithTAF.prefix(3)
                for (icao, response) in sampleTAF {
                    print("   Sample TAF for \(icao): length=\(response.taf?.raw?.count ?? 0), preview=\(response.taf?.raw?.prefix(50) ?? "nil")")
                }
            } else {
                print("   ⚠️ WARNING: No stations have TAF data in final weather map!")
            }
        }
        return weatherMap
    }
    
    private func fetchMETAR(ids: String) async throws -> [AviationWeatherMETAR] {
        var components = URLComponents(string: metarBaseURL)
        components?.queryItems = [
            URLQueryItem(name: "ids", value: ids),
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "hours", value: "2")
        ]
        
        guard let url = components?.url else {
            throw WeatherError.invalidURL
        }
        
        print("🌐 Fetching METAR from: \(url.absoluteString)")
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            print("❌ METAR: Invalid HTTP response")
            throw WeatherError.httpError
        }
        
        print("📡 METAR HTTP status: \(httpResponse.statusCode)")
        
        guard httpResponse.statusCode == 200 else {
            print("❌ METAR: HTTP error \(httpResponse.statusCode)")
            if let errorString = String(data: data, encoding: .utf8) {
                print("   Response body: \(errorString.prefix(500))")
            }
            throw WeatherError.httpError
        }
        
        do {
            let metarArray = try JSONDecoder().decode([AviationWeatherMETAR].self, from: data)
            print("✅ Successfully decoded \(metarArray.count) METAR entries")
            if metarArray.isEmpty {
                print("⚠️ METAR array is empty - no data returned for requested stations")
            } else {
                print("   Sample METAR stations: \(metarArray.prefix(3).map { "\($0.stationId): \($0.rawOb?.prefix(50) ?? "nil")" }.joined(separator: ", "))")
            }
            return metarArray
        } catch {
            // Log the actual response for debugging
            if let jsonString = String(data: data, encoding: .utf8) {
                print("❌ METAR API response (first 1000 chars): \(String(jsonString.prefix(1000)))")
            } else {
                print("❌ METAR API response: Could not convert to string (size: \(data.count) bytes)")
            }
            print("❌ METAR decoding error: \(error)")
            if let decodingError = error as? DecodingError {
                print("   Decoding error details: \(decodingError)")
            }
            throw WeatherError.decodingError
        }
    }
    
    private func fetchTAF(ids: String) async throws -> [AviationWeatherTAF] {
        // Parse requested ICAO codes (normalize to uppercase for matching)
        requestedICAOs = Set(ids.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces).uppercased() })
        
        guard let url = URL(string: tafCacheURL) else {
            throw WeatherError.invalidURL
        }
        
        print("🌐 Fetching TAF from XML cache: \(url.absoluteString)")
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            print("❌ TAF: Invalid HTTP response")
            throw WeatherError.httpError
        }
        
        print("📡 TAF HTTP status: \(httpResponse.statusCode)")
        
        guard httpResponse.statusCode == 200 else {
            print("❌ TAF: HTTP error \(httpResponse.statusCode)")
            if let errorString = String(data: data, encoding: .utf8) {
                print("   Response body: \(errorString.prefix(500))")
            }
            throw WeatherError.httpError
        }
        
        // Decompress gzipped data
        let xmlData: Data
        do {
            xmlData = try gunzip(data)
            print("✅ Successfully decompressed TAF XML (\(xmlData.count) bytes)")
        } catch {
            print("❌ TAF decompression failed: \(error)")
            throw WeatherError.decompressionFailed
        }
        
        // Debug: Print first 500 characters of XML to see structure
        if let xmlString = String(data: xmlData, encoding: .utf8) {
            print("📄 TAF XML preview (first 500 chars): \(String(xmlString.prefix(500)))")
        } else {
            print("⚠️ Could not convert TAF XML data to string")
        }
        
        // Parse XML
        tafResults = []
        let parser = XMLParser(data: xmlData)
        parser.delegate = self
        parser.shouldProcessNamespaces = false
        parser.shouldReportNamespacePrefixes = false
        parser.shouldResolveExternalEntities = false
        
        let parseSuccess = parser.parse()
        
        if !parseSuccess {
            if let parseError = parser.parserError {
                print("❌ TAF XML parsing error: \(parseError.localizedDescription)")
                if let nsError = parseError as NSError? {
                    print("   Error domain: \(nsError.domain), code: \(nsError.code)")
                }
            } else {
                print("❌ TAF XML parsing failed with unknown error")
            }
            throw WeatherError.parsingFailed
        }
        
        // Filter results to only requested ICAOs (case-insensitive matching)
        let filteredResults = tafResults.filter { requestedICAOs.contains($0.stationId.uppercased()) }
        
        print("✅ TAF XML parsing completed. Found \(tafResults.count) total TAF entries, \(filteredResults.count) match requested ICAOs")
        print("   Requested ICAOs: \(Array(requestedICAOs).sorted().joined(separator: ", "))")
        if filteredResults.isEmpty {
            print("⚠️ TAF array is empty for requested stations: \(ids)")
            if !tafResults.isEmpty {
                print("   Available TAF stations (first 20): \(tafResults.prefix(20).map { $0.stationId }.joined(separator: ", "))")
                // Check if any requested ICAOs are in the results (case-insensitive)
                let requestedLower = Set(requestedICAOs.map { $0.uppercased() })
                let availableLower = Set(tafResults.map { $0.stationId.uppercased() })
                let matches = requestedLower.intersection(availableLower)
                if !matches.isEmpty {
                    print("   ⚠️ Found case-insensitive matches: \(Array(matches).sorted().joined(separator: ", "))")
                }
            }
        } else {
            print("   Matched TAF stations: \(filteredResults.map { $0.stationId }.sorted().joined(separator: ", "))")
            print("   Sample TAF stations: \(filteredResults.prefix(3).map { "\($0.stationId): \($0.rawTAF?.prefix(50) ?? "nil")" }.joined(separator: ", "))")
        }
        
        return filteredResults
    }
    
    private func gunzip(_ data: Data) throws -> Data {
        // Use compression_stream for gzip decompression
        guard data.count > 10 else {
            print("❌ gunzip: Data too small (\(data.count) bytes)")
            throw WeatherError.decompressionFailed
        }
        
        // Verify gzip magic bytes (1F 8B)
        guard data[0] == 0x1F && data[1] == 0x8B else {
            print("❌ gunzip: Invalid gzip magic bytes (got \(String(format: "%02X %02X", data[0], data[1])))")
            throw WeatherError.decompressionFailed
        }
        
        // Parse gzip header to find deflate stream start
        var headerSize = 10 // Minimum header size
        let flags = data[3]
        
        // Skip optional fields if present
        if flags & 0x04 != 0 { // FEXTRA
            if data.count > headerSize + 2 {
                let xlen = Int(data[headerSize]) | (Int(data[headerSize + 1]) << 8)
                headerSize += 2 + xlen
            }
        }
        if flags & 0x08 != 0 { // FNAME (null-terminated)
            while headerSize < data.count && data[headerSize] != 0 {
                headerSize += 1
            }
            headerSize += 1 // Skip null terminator
        }
        if flags & 0x10 != 0 { // FCOMMENT (null-terminated)
            while headerSize < data.count && data[headerSize] != 0 {
                headerSize += 1
            }
            headerSize += 1 // Skip null terminator
        }
        if flags & 0x02 != 0 { // FHCRC
            headerSize += 2
        }
        
        // Extract deflate data (skip header and footer)
        guard data.count > headerSize + 8 else {
            print("❌ gunzip: Data too small after header parsing (headerSize=\(headerSize), total=\(data.count))")
            throw WeatherError.decompressionFailed
        }
        let rawDeflateData = data.subdata(in: headerSize..<(data.count - 8))
        
        // Prepend zlib header (0x78 0x9C = default compression, 32K window)
        // Gzip deflate streams are raw, but COMPRESSION_ZLIB expects zlib-wrapped streams
        var zlibData = Data([0x78, 0x9C])
        zlibData.append(rawDeflateData)
        
        // Use compression_stream with ZLIB to decompress the deflate stream
        var stream = compression_stream()
        var status = compression_stream_init(&stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB)
        guard status == COMPRESSION_STATUS_OK else {
            print("❌ gunzip: Failed to initialize compression stream (status: \(status))")
            throw WeatherError.decompressionFailed
        }
        defer { compression_stream_destroy(&stream) }
        
        // Allocate buffers
        let bufferSize = 4 * 1024 * 1024 // 4MB for large TAF files
        let dstBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { dstBuffer.deallocate() }
        
        var result = Data()
        
        return try zlibData.withUnsafeBytes { zlibPtr in
            guard let zlibBase = zlibPtr.bindMemory(to: UInt8.self).baseAddress else {
                print("❌ gunzip: Failed to get zlib base address")
                throw WeatherError.decompressionFailed
            }
            
            stream.src_ptr = zlibBase
            stream.src_size = zlibData.count
            stream.dst_ptr = dstBuffer
            stream.dst_size = bufferSize
            
            let flags = Int32(COMPRESSION_STREAM_FINALIZE.rawValue)
            
            while true {
                status = compression_stream_process(&stream, flags)
                
                if status == COMPRESSION_STATUS_OK || status == COMPRESSION_STATUS_END {
                    let bytesWritten = bufferSize - stream.dst_size
                    if bytesWritten > 0 {
                        result.append(dstBuffer, count: bytesWritten)
                    }
                    
                    if status == COMPRESSION_STATUS_END {
                        break
                    }
                    
                    // Reset destination buffer for next chunk
                    stream.dst_ptr = dstBuffer
                    stream.dst_size = bufferSize
                } else {
                    print("❌ gunzip: Decompression failed (status: \(status))")
                    throw WeatherError.decompressionFailed
                }
            }
            
            print("✅ gunzip: Successfully decompressed \(data.count) bytes -> \(result.count) bytes")
            return result
        }
    }
    
    // MARK: - XMLParserDelegate for TAF
    
    func parserDidStartDocument(_ parser: XMLParser) {
        tafResults = []
        currentElement = ""
        currentStationID = ""
        currentRawTAF = ""
        isInsideTAF = false
    }
    
    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        let elementLower = elementName.lowercased()
        
        // Track when we're inside a TAF element
        if elementLower == "taf" {
            isInsideTAF = true
            currentStationID = ""
            currentRawTAF = ""
            currentElement = ""
            if tafResults.count < 3 {
                print("🔍 Starting TAF element #\(tafResults.count + 1)")
            }
        } else if isInsideTAF {
            // Only track elements that are direct children of TAF
            if elementLower == "station_id" || elementLower == "raw_text" {
                currentElement = elementLower
                if tafResults.count < 3 {
                    print("   📝 Found \(elementLower) element")
                }
            }
            // Don't clear currentElement for nested elements - we want to keep accumulating
            // text/CDATA if we're inside raw_text, even if there are nested elements
        }
    }
    
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        // Handle text content based on current element (only if inside TAF)
        if isInsideTAF {
            if currentElement == "station_id" {
                // Accumulate station ID (trim only when we finish the element)
                currentStationID += string
            } else if currentElement == "raw_text" {
                // Accumulate all text content (CDATA is handled separately)
                // Note: Most TAF content is in CDATA, but we accumulate text here too
                currentRawTAF += string
                if tafResults.count < 3 {
                    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        print("   📝 Found text in raw_text: '\(string.prefix(50))', accumulated=\(currentRawTAF.count)")
                    }
                }
            }
        }
    }
    
    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        // Handle CDATA sections (raw_text contains CDATA)
        // Note: XMLParser should call this for CDATA sections, but sometimes it may call foundCharacters instead
        if isInsideTAF && currentElement == "raw_text" {
            if let cdataString = String(data: CDATABlock, encoding: .utf8) {
                currentRawTAF += cdataString
                if tafResults.count < 10 {
                    print("   📦 Found CDATA in raw_text: length=\(cdataString.count), accumulated=\(currentRawTAF.count)")
                    if tafResults.count < 3 {
                        print("   CDATA content preview: \(cdataString.prefix(80))")
                    }
                }
            } else {
                print("   ⚠️ Failed to decode CDATA block (size: \(CDATABlock.count) bytes)")
            }
        } else if isInsideTAF {
            // Log if CDATA is found but we're not in raw_text element
            if tafResults.count < 3 {
                print("   ⚠️ Found CDATA but currentElement='\(currentElement)', isInsideTAF=\(isInsideTAF)")
            }
        }
    }
    
    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        let elementLower = elementName.lowercased()
        
        // When a TAF element ends, save the entry
        if elementLower == "taf" {
            let stationID = currentStationID.trimmingCharacters(in: .whitespacesAndNewlines)
            let rawTAF = currentRawTAF.trimmingCharacters(in: .whitespacesAndNewlines)
            
            // Debug: Always log the state before saving
            if tafResults.count < 10 {
                print("🔚 Ending TAF element: stationID='\(stationID)', rawTAF length=\(rawTAF.count), beforeTrim length=\(currentRawTAF.count)")
            }
            
            // Only add if we have at least a station ID
            if !stationID.isEmpty {
                let entry = AviationWeatherTAF(stationId: stationID, rawTAF: rawTAF.isEmpty ? nil : rawTAF)
                tafResults.append(entry)
                
                // Debug: Print first few entries
                if tafResults.count <= 5 {
                    print("✅ Added TAF entry \(tafResults.count): station=\(stationID), taf length=\(rawTAF.count)")
                    if !rawTAF.isEmpty {
                        print("   TAF preview: \(rawTAF.prefix(80))")
                    } else {
                        print("   ⚠️ WARNING: TAF entry has empty raw_text! Before trim: length=\(currentRawTAF.count)")
                        print("   Before trim preview: '\(currentRawTAF.prefix(100))'")
                    }
                }
            } else {
                print("⚠️ Skipped TAF entry: missing station ID. raw_text length=\(currentRawTAF.count)")
                if !currentRawTAF.isEmpty {
                    print("   raw_text content (before trim): '\(currentRawTAF.prefix(100))'")
                }
            }
            
            // Reset for next TAF entry
            currentStationID = ""
            currentRawTAF = ""
            currentElement = ""
            isInsideTAF = false
        } else if isInsideTAF && (elementLower == "station_id" || elementLower == "raw_text") {
            // Clear current element only when we finish processing station_id or raw_text
            // This ensures we don't accidentally process nested elements
            if tafResults.count < 3 {
                print("   🔚 Ending \(elementLower) element. currentStationID length=\(currentStationID.count), currentRawTAF length=\(currentRawTAF.count)")
            }
            currentElement = ""
        }
    }
    
    func parserDidEndDocument(_ parser: XMLParser) {
        print("📋 TAF XML parsing finished. Total entries: \(tafResults.count)")
    }
}

// MARK: - AviationWeather.gov API Response Models

struct AviationWeatherMETAR: Codable {
    let stationId: String
    let rawOb: String?
    
    // Custom decoder to handle API response variations
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        
        // Decode ICAO identifier - try multiple possible field names
        if let icao = try? container.decode(String.self, forKey: DynamicCodingKey(stringValue: "icaoId")!) {
            stationId = icao
        } else if let icao = try? container.decode(String.self, forKey: DynamicCodingKey(stringValue: "icao")!) {
            stationId = icao
        } else if let icao = try? container.decode(String.self, forKey: DynamicCodingKey(stringValue: "stationId")!) {
            stationId = icao
        } else {
            throw DecodingError.keyNotFound(DynamicCodingKey(stringValue: "icaoId")!, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Could not find ICAO identifier"))
        }
        
        // Decode raw observation - try multiple possible field names
        rawOb = try? container.decode(String.self, forKey: DynamicCodingKey(stringValue: "rawOb")!) ??
                (try? container.decode(String.self, forKey: DynamicCodingKey(stringValue: "raw")!)) ??
                (try? container.decode(String.self, forKey: DynamicCodingKey(stringValue: "rawMETAR")!))
    }
}

struct AviationWeatherTAF {
    let stationId: String
    let rawTAF: String?
    
    // Simple initializer for XML parsing
    init(stationId: String, rawTAF: String?) {
        self.stationId = stationId
        self.rawTAF = rawTAF
    }
}

// Helper for dynamic coding keys
struct DynamicCodingKey: CodingKey {
    var stringValue: String
    var intValue: Int?
    
    init?(stringValue: String) {
        self.stringValue = stringValue
    }
    
    init?(intValue: Int) {
        return nil
    }
}

// MARK: - App Response Models

struct WeatherResponse: Codable {
    var icao: String
    var metar: WeatherReport?
    var taf: WeatherReport?
}

struct WeatherReport: Codable {
    let raw: String?
}

enum WeatherError: Error {
    case invalidURL
    case httpError
    case decodingError
    case decompressionFailed
    case parsingFailed
}


