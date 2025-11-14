// Export Helper Script for CieloTracker Web App
// Run this in the browser console on pro_beta.html to export flights

(function() {
    'use strict';
    
    // Get flights from localStorage
    const flightsKey = 'ct_pro_flights';
    const flightsData = localStorage.getItem(flightsKey);
    
    if (!flightsData) {
        console.error('No flights found in localStorage');
        return;
    }
    
    try {
        const flights = JSON.parse(flightsData);
        
        // Convert triggers from Array to Set format (if needed)
        const formattedFlights = flights.map(flight => {
            // Ensure triggers is an array
            if (flight.triggers && !Array.isArray(flight.triggers)) {
                flight.triggers = [];
            }
            return flight;
        });
        
        // Export as JSON string
        const jsonString = JSON.stringify(formattedFlights, null, 2);
        
        // Copy to clipboard
        navigator.clipboard.writeText(jsonString).then(() => {
            console.log('✅ Flights copied to clipboard!');
            console.log(`📊 Exported ${formattedFlights.length} flight(s)`);
            console.log('📱 Paste this JSON into the iOS app sync screen');
        }).catch(err => {
            console.error('Failed to copy to clipboard:', err);
            console.log('--- COPY THIS JSON ---');
            console.log(jsonString);
            console.log('--- END JSON ---');
        });
        
        // Also log to console
        console.log('Exported flights:');
        console.log(formattedFlights);
        
    } catch (error) {
        console.error('Error parsing flights:', error);
    }
})();

