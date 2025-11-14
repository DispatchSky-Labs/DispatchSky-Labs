//
//  WeatherService.swift
//  CieloTracker
//

import Foundation

class WeatherService {
    static let shared = WeatherService()
    
    private let apiURL = "https://us-central1-handy-coil-469714-j2.cloudfunctions.net/process-weather-data-clean"
    
    private init() {}
    
    func fetchWeather(for icaoList: [String]) async throws -> [String: WeatherResponse] {
        guard !icaoList.isEmpty else { return [:] }
        
        let ids = icaoList.joined(separator: ",")
        var components = URLComponents(string: apiURL)
        components?.queryItems = [
            URLQueryItem(name: "ids", value: ids),
            URLQueryItem(name: "ceil", value: "2000"),
            URLQueryItem(name: "vis", value: "3"),
            URLQueryItem(name: "metar", value: "1"),
            URLQueryItem(name: "taf", value: "1"),
            URLQueryItem(name: "alpha", value: "0"),
            URLQueryItem(name: "filter", value: "all")
        ]
        
        guard let url = components?.url else {
            throw WeatherError.invalidURL
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw WeatherError.httpError
        }
        
        let apiResponse = try JSONDecoder().decode(WeatherAPIResponse.self, from: data)
        
        var weatherMap: [String: WeatherResponse] = [:]
        for result in apiResponse.results ?? [] {
            weatherMap[result.icao] = result
        }
        
        return weatherMap
    }
}

struct WeatherAPIResponse: Codable {
    let results: [WeatherResponse]?
}

struct WeatherResponse: Codable {
    let icao: String
    let metar: WeatherReport?
    let taf: WeatherReport?
}

struct WeatherReport: Codable {
    let raw: String?
}

enum WeatherError: Error {
    case invalidURL
    case httpError
    case decodingError
}

