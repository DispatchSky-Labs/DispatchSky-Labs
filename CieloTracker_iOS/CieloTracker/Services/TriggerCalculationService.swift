//
//  TriggerCalculationService.swift
//  CieloTracker
//
//  Service to calculate weather triggers for flights
//

import Foundation

class TriggerCalculationService {
    static let shared = TriggerCalculationService()
    
    private init() {}
    
    // Calculate if destination requires alternate
    func checkDestRequiresAlternate(weather: WeatherResponse?, flight: Flight) -> Bool {
        guard let wx = weather, !flight.eta.isEmpty else { return false }
        
        let etaHHMM = flight.eta.count == 4 ? flight.eta : nil
        guard let etaHHMM = etaHHMM else { return false }
        
        let durationMin = Int(flight.duration) ?? 0
        
        // Check TAF segments for arrival window (ETA ± 1 hour)
        if let tafRaw = wx.taf?.raw, !tafRaw.isEmpty {
            let tafSegs = getTafSegmentsForWindow(tafRaw: tafRaw, etaHHMM: etaHHMM)
            let windowText = tafSegs.map { $0.text }.joined(separator: " ")
            
            if !windowText.isEmpty {
                let worst = findWorstWeather(windowText)
                if let ceiling = worst.ceiling, ceiling * 100 < 2000 {
                    return true
                }
                if let visibility = worst.visibility, visibility < 3 {
                    return true
                }
            }
            
            // Check base TAF text at ETA hour
            let tafTextAtHour = getTafBaseTextAtEtaHour(tafRaw: tafRaw, etaHHMM: etaHHMM)
            let tafTerms = findTriggerTerms(tafTextAtHour)
            if !tafTerms.isEmpty {
                return true
            }
        }
        
        // Check METAR if duration < 60 minutes
        if let metarRaw = wx.metar?.raw, !metarRaw.isEmpty {
            let metarHH = getMetarHourHH(metarRaw)
            let etaHH = String(etaHHMM.prefix(2))
            
            if metarHH == etaHH {
                let worst = findWorstWeather(metarRaw)
                if durationMin < 60 {
                    if let ceiling = worst.ceiling, ceiling * 100 < 2000 {
                        return true
                    }
                    if let visibility = worst.visibility, visibility < 3 {
                        return true
                    }
                }
            }
        }
        
        return false
    }
    
    // Get TAF segments for arrival window (ETA ± 1 hour)
    func getTafSegmentsForWindow(tafRaw: String, etaHHMM: String) -> [TafSegment] {
        guard let header = parseTafHeader(tafRaw) else { return [] }
        
        let (start, end, year, month) = header
        guard let etaDate = etaToUtcDateWithinTaf(etaHHMM: etaHHMM, tafStart: start, tafEnd: end) else {
            return []
        }
        
        let windowStart = etaDate.addingTimeInterval(-60 * 60) // 1 hour before
        let windowEnd = etaDate.addingTimeInterval(60 * 60) // 1 hour after
        
        let (segments, _, _) = buildTafSegments(tafRaw: tafRaw)
        let filteredSegments = segments.filter { seg in
            seg.end > windowStart && seg.start < windowEnd
        }
        
        // Match TEMPO and PROB conditional periods
        // Format: TEMPO/PROB30/PROB40 DDHH/DDHH ... (end time is 1 minute before the hour)
        let tempoRegex = try! NSRegularExpression(pattern: #"\b(TEMPO|PROB30|PROB40)\s+(\d{2})(\d{2})/(\d{2})(\d{2})\s+([^\n]+?)(?=\s*(?:FM\d{6}|TEMPO|BECMG|PROB\d+|$|\n\s*[A-Z]|\n\s*$))"#, options: [])
        let matches = tempoRegex.matches(in: tafRaw, range: NSRange(tafRaw.startIndex..., in: tafRaw))
        
        var validTempos: [TafSegment] = []
        for match in matches {
            guard match.numberOfRanges >= 7 else { continue }
            
            let dRange = Range(match.range(at: 2), in: tafRaw)!
            let h1Range = Range(match.range(at: 3), in: tafRaw)!
            let d2Range = Range(match.range(at: 4), in: tafRaw)!
            let h2Range = Range(match.range(at: 5), in: tafRaw)!
            let textRange = Range(match.range(at: 6), in: tafRaw)!
            
            guard let d = Int(tafRaw[dRange]),
                  let h1 = Int(tafRaw[h1Range]),
                  let d2 = Int(tafRaw[d2Range]),
                  let h2 = Int(tafRaw[h2Range]) else {
                continue
            }
            
            let tempoText = String(tafRaw[textRange]).trimmingCharacters(in: .whitespaces)
            guard !tempoText.isEmpty else { continue }
            
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC")!
            
            guard let tempoStart = calendar.date(from: DateComponents(year: year, month: month, day: d, hour: h1, minute: 0)) else {
                continue
            }
            
            var tempoEnd = calendar.date(from: DateComponents(year: year, month: month, day: d2, hour: h2 == 24 ? 0 : h2, minute: 0))
            if h2 == 24 {
                tempoEnd = calendar.date(byAdding: .day, value: 1, to: tempoEnd ?? Date())
            }
            
            // CRITICAL: End time is 1 minute before the hour (e.g., PROB 0000-0300 ends at 0259, not 0300)
            if let tempoEnd = tempoEnd {
                let adjustedEnd = tempoEnd.addingTimeInterval(-60) // Subtract 1 minute
                
                // Only include if the conditional period overlaps with our arrival window
                // The period must start before windowEnd and end after windowStart
                if adjustedEnd > windowStart && tempoStart < windowEnd {
                    validTempos.append(TafSegment(start: tempoStart, end: adjustedEnd, text: tempoText))
                }
            }
        }
        
        return filteredSegments + validTempos
    }
    
    // Helper structures and functions
    struct TafSegment {
        let start: Date
        let end: Date
        let text: String
    }
    
    private func parseTafHeader(_ tafRaw: String) -> (start: Date, end: Date, year: Int, month: Int)? {
        // TAF format: ... DDHH/DDHH ... (matches the pattern from pro.html)
        let pattern = #"\b(\d{2})(\d{2})/(\d{2})(\d{2})\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []),
              let match = regex.firstMatch(in: tafRaw, range: NSRange(tafRaw.startIndex..., in: tafRaw)),
              match.numberOfRanges >= 5 else {
            return nil
        }
        
        let now = Date()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let components = calendar.dateComponents([.year, .month], from: now)
        
        guard let year = components.year,
              let month = components.month else {
            return nil
        }
        
        let d1Range = Range(match.range(at: 1), in: tafRaw)!
        let h1Range = Range(match.range(at: 2), in: tafRaw)!
        let d2Range = Range(match.range(at: 3), in: tafRaw)!
        let h2Range = Range(match.range(at: 4), in: tafRaw)!
        
        guard let startDay = Int(tafRaw[d1Range]),
              let startHour = Int(tafRaw[h1Range]),
              let endDay = Int(tafRaw[d2Range]),
              let endHour = Int(tafRaw[h2Range]) else {
            return nil
        }
        
        guard let start = calendar.date(from: DateComponents(year: year, month: month, day: startDay, hour: startHour, minute: 0)) else {
            return nil
        }
        
        var end = calendar.date(from: DateComponents(year: year, month: month, day: endDay, hour: endHour == 24 ? 0 : endHour, minute: 0))
        if endHour == 24 {
            end = calendar.date(byAdding: .day, value: 1, to: end ?? Date())
        }
        
        guard let end = end else {
            return nil
        }
        
        return (start, end, year, month)
    }
    
    private func etaToUtcDateWithinTaf(etaHHMM: String, tafStart: Date, tafEnd: Date) -> Date? {
        guard etaHHMM.count == 4,
              let h = Int(etaHHMM.prefix(2)),
              let m = Int(etaHHMM.suffix(2)) else {
            return nil
        }
        
        let now = Date()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let components = calendar.dateComponents([.year, .month, .day], from: now)
        
        guard let year = components.year,
              let month = components.month,
              let day = components.day else {
            return nil
        }
        
        // Try current day first
        var candidate = calendar.date(from: DateComponents(year: year, month: month, day: day, hour: h, minute: m))
        
        // If candidate is before TAF start, try next day
        if let candidate = candidate, candidate < tafStart {
            candidate = calendar.date(byAdding: .day, value: 1, to: candidate)
        }
        
        // If candidate is after TAF end, try previous day
        if let candidate = candidate, candidate >= tafEnd {
            candidate = calendar.date(byAdding: .day, value: -1, to: candidate)
        }
        
        // Final check: ensure candidate is within TAF validity period
        if let candidate = candidate, candidate >= tafStart && candidate < tafEnd {
            return candidate
        }
        
        return nil
    }
    
    func buildTafSegments(tafRaw: String) -> (segments: [TafSegment], start: Date?, end: Date?) {
        guard let header = parseTafHeader(tafRaw) else {
            return ([], nil, nil)
        }
        
        let (start, end, year, month) = header
        
        // Split TAF by FM markers
        let fmSplitPattern = #"\bFM\d{6}\b"#
        let fmFindPattern = #"FM(\d{6})"#
        
        let parts = tafRaw.components(separatedBy: fmSplitPattern)
        
        // Find all FM matches
        let fmRegex = try! NSRegularExpression(pattern: fmFindPattern, options: [])
        let fmMatches = fmRegex.matches(in: tafRaw, range: NSRange(tafRaw.startIndex..., in: tafRaw))
        
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        
        func fmTimeAt(_ index: Int) -> Date? {
            guard index < fmMatches.count else { return nil }
            let match = fmMatches[index]
            guard match.numberOfRanges >= 2,
                  let fmRange = Range(match.range(at: 1), in: tafRaw) else {
                return nil
            }
            
            let fmString = String(tafRaw[fmRange])
            guard fmString.count == 6,
                  let d = Int(fmString.prefix(2)),
                  let h = Int(fmString.dropFirst(2).prefix(2)),
                  let m = Int(fmString.suffix(2)) else {
                return nil
            }
            
            return calendar.date(from: DateComponents(year: year, month: month, day: d, hour: h, minute: m))
        }
        
        var segments: [TafSegment] = []
        
        // First segment (before first FM)
        if let firstPart = parts.first, !firstPart.isEmpty {
            let firstEnd = fmMatches.isEmpty ? end : fmTimeAt(0)
            guard let firstEnd = firstEnd else {
                return ([], start, end)
            }
            
            var baseText = firstPart
            // Remove TEMPO lines from base text
            let tempoPattern = #"\bTEMPO\s+\d{2}\d{2}/\d{2}\d{2}\s+[^\s]+(?:\s+[^\s]+)*"#
            baseText = baseText.replacingOccurrences(of: tempoPattern, with: "", options: .regularExpression)
            
            segments.append(TafSegment(start: start, end: firstEnd, text: baseText.trimmingCharacters(in: .whitespaces)))
        }
        
        // Process FM segments
        for i in 0..<fmMatches.count {
            guard let segStart = fmTimeAt(i) else { continue }
            let segEnd = (i + 1 < fmMatches.count) ? fmTimeAt(i + 1) : end
            guard let segEnd = segEnd else { continue }
            
            let text = (i + 1 < parts.count) ? parts[i + 1] : ""
            var cleanText = text
            // Remove TEMPO lines from segment text
            let tempoPattern = #"\bTEMPO\s+\d{2}\d{2}/\d{2}\d{2}\s+[^\s]+(?:\s+[^\s]+)*"#
            cleanText = cleanText.replacingOccurrences(of: tempoPattern, with: "", options: .regularExpression)
            
            segments.append(TafSegment(start: segStart, end: segEnd, text: cleanText.trimmingCharacters(in: .whitespaces)))
        }
        
        return (segments, start, end)
    }
    
    func getTafBaseTextAtEtaHour(tafRaw: String, etaHHMM: String) -> String {
        let (segments, start, end) = buildTafSegments(tafRaw: tafRaw)
        guard !segments.isEmpty,
              let start = start,
              let end = end,
              let etaDate = etaToUtcDateWithinTaf(etaHHMM: etaHHMM, tafStart: start, tafEnd: end) else {
            return ""
        }
        
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        var hourMark = etaDate
        hourMark = calendar.date(bySettingHour: calendar.component(.hour, from: hourMark), minute: 0, second: 0, of: hourMark) ?? hourMark
        
        if let baseSeg = segments.first(where: { seg in
            seg.start <= hourMark && hourMark < seg.end
        }) {
            return baseSeg.text
        }
        
        return ""
    }
    
    func getMetarHourHH(_ metarRaw: String) -> String? {
        let pattern = #"\b(\d{2})(\d{2})(\d{2})Z\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []),
              let match = regex.firstMatch(in: metarRaw, range: NSRange(metarRaw.startIndex..., in: metarRaw)),
              match.numberOfRanges >= 3 else {
            return nil
        }
        
        let hourRange = Range(match.range(at: 2), in: metarRaw)!
        return String(metarRaw[hourRange])
    }
    
    private func findWorstWeather(_ text: String) -> (ceiling: Int?, visibility: Double?) {
        var worstCeiling: Int? = nil
        var worstVis: Double? = nil
        
        // Find ceilings (BKN, OVC, VV)
        let ceilingPattern = #"\b(BKN|OVC|VV)(\d{3})\b"#
        if let regex = try? NSRegularExpression(pattern: ceilingPattern, options: []) {
            let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
            for match in matches {
                if match.numberOfRanges >= 3,
                   let heightRange = Range(match.range(at: 2), in: text),
                   let height = Int(text[heightRange]) {
                    if worstCeiling == nil || height < worstCeiling! {
                        worstCeiling = height
                    }
                }
            }
        }
        
        // Find visibility (simplified - would need full parsing)
        let visPattern = #"\b(\d+(?:\.\d+)?)SM\b"#
        if let regex = try? NSRegularExpression(pattern: visPattern, options: []) {
            let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
            for match in matches {
                if match.numberOfRanges >= 2,
                   let visRange = Range(match.range(at: 1), in: text),
                   let vis = Double(text[visRange]) {
                    if worstVis == nil || vis < worstVis! {
                        worstVis = vis
                    }
                }
            }
        }
        
        return (worstCeiling, worstVis)
    }
    
    func findTriggerTerms(_ text: String) -> [String] {
        let triggerTerms = ["SN", "+SN", "TS", "+TS", "RA", "+RA", "FG", "BR", "HZ", "DU", "SA", "VA", "FU", "SQ", "FC", "DS", "SS", "PO", "BLSN", "BLSA", "BLDU", "IC", "GR", "GS", "UP", "FZRA", "FZDZ", "FZFG"]
        let upperText = text.uppercased()
        return triggerTerms.filter { upperText.contains($0) }
    }
}

