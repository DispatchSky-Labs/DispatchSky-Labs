// Export Flights for iOS App
// Run this in the browser console on pro_beta.html
// Usage: Just paste this code into the console and press Enter

(function() {
    'use strict';
    
    const flightsKey = 'ct_pro_flights';
    const flightsData = localStorage.getItem(flightsKey);
    
    if (!flightsData) {
        console.error('❌ No flights found in localStorage');
        console.log('Make sure you have flights loaded in the web app');
        return;
    }
    
    try {
        const flights = JSON.parse(flightsData);
        
        // Format flights for iOS app
        const formattedFlights = flights.map(flight => {
            return {
                id: flight.id || Date.now() + Math.random(),
                flight: flight.flight || '',
                origin: flight.origin || '',
                dest: flight.dest || '',
                takeoffAlt: flight.takeoffAlt || '',
                alt1: flight.alt1 || '',
                alt2: flight.alt2 || '',
                etd: flight.etd || '',
                taxiOut: flight.taxiOut || '',
                burnoff: flight.burnoff || '',
                duration: flight.duration || '',
                eta: flight.eta || '',
                triggers: Array.isArray(flight.triggers) ? flight.triggers : [],
                autoRemoveScheduled: flight.autoRemoveScheduled || false
            };
        });
        
        // Convert to JSON string
        const jsonString = JSON.stringify(formattedFlights, null, 2);
        
        // Copy to clipboard
        navigator.clipboard.writeText(jsonString).then(() => {
            console.log('✅ SUCCESS!');
            console.log(`📊 Exported ${formattedFlights.length} flight(s)`);
            console.log('📋 JSON copied to clipboard!');
            console.log('📱 Now paste this into the iOS app sync screen');
            console.log('');
            console.log('📝 Quick instructions:');
            console.log('1. Open iOS app');
            console.log('2. Tap menu (⋯) → "Sync"');
            console.log('3. Paste JSON');
            console.log('4. Tap "Import Flights"');
        }).catch(err => {
            console.error('❌ Failed to copy to clipboard:', err);
            console.log('');
            console.log('--- COPY THIS JSON ---');
            console.log(jsonString);
            console.log('--- END JSON ---');
        });
        
        // Also show preview
        console.log('');
        console.log('📋 Preview of exported flights:');
        formattedFlights.forEach((flight, index) => {
            console.log(`${index + 1}. ${flight.flight} ${flight.origin} → ${flight.dest} (ETD: ${flight.etd}, ETA: ${flight.eta})`);
        });
        
    } catch (error) {
        console.error('❌ Error parsing flights:', error);
        console.log('Make sure the data in localStorage is valid JSON');
    }
})();

