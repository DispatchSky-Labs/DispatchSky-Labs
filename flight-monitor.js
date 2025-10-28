<script>
(function() {
  // ===== Config =====
  const BACKEND_URL = "https://process-flight-data-752k4ah3ra-uc.a.run.app";
  const REFRESH_INTERVAL = 60_000; // 1 minute

  // ===== DOM Elements =====
  const $ = (s) => document.querySelector(s);
  const loadBtn = $('#loadBtn');
  const flightInput = $('#flightInput');
  const flightTable = $('#flightTable');
  const flightBody = $('#flightBody');
  const summary = $('#summary');
  const err = $('#err');
  const utcNow = $('#utcNow');
  const lastUpdate = $('#lastUpdate');
  const themeEl = $('#theme');

  // ===== State =====
  let flights = [];
  let flightResults = {};
  let refreshTimer = null;

  // ===== Theme Support =====
  function applyTheme(mode) {
    document.body.classList.toggle('theme-dark', mode === 'dark');
    localStorage.setItem('fm_theme', mode);
  }
  themeEl?.addEventListener('change', (e) => applyTheme(e.target.value));
  (function initTheme() {
    const saved = localStorage.getItem('fm_theme') || 'light';
    if (themeEl) themeEl.value = saved;
    applyTheme(saved);
  })();

  // ===== UTC Clock (updates every minute) =====
  function tickClock() {
    const d = new Date();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    if (utcNow) utcNow.textContent = `UTC ${hh}:${mm}`;
  }
  function startMinuteClock() {
    tickClock();
    const now = new Date();
    const msToNextMinute = (60 - now.getUTCSeconds()) * 1000 - now.getUTCMilliseconds();
    setTimeout(() => {
      tickClock();
      setInterval(tickClock, 60_000);
    }, Math.max(0, msToNextMinute));
  }
  startMinuteClock();

  // ===== Parse Flights: Tabs OR Spaces, Auto OO prefix =====
  function parseFlights(text) {
    const lines = text.trim().split('\n').filter(line => line.trim());
    const parsed = [];
    const warnings = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Split on any whitespace (spaces, tabs) and filter empty
      const parts = line.split(/[\t\s]+/).map(p => p.trim().toUpperCase()).filter(p => p);

      if (parts.length < 3) {
        warnings.push(`Line ${i + 1}: Not enough fields (need 3: Flight, Origin, Dest)`);
        continue;
      }

      let flightNumber = parts[0];
      const origin = parts[1];
      const destination = parts[2];

      // Auto-add "OO" prefix if flight number is digits only
      if (/^\d+$/.test(flightNumber)) {
        flightNumber = `OO${flightNumber}`;
      }

      // Validate ICAO codes (basic: 3-4 letters)
      if (!/^[A-Z]{3,4}$/.test(origin) || !/^[A-Z]{3,4}$/.test(destination)) {
        warnings.push(`Line ${i + 1}: Invalid ICAO code(s): ${origin} → ${destination}`);
        continue;
      }

      parsed.push({ flightNumber, origin, destination });
    }

    // Show warnings if any
    if (warnings.length > 0 && err) {
      err.style.display = 'block';
      err.innerHTML = warnings.slice(0, 3).join('<br>') + (warnings.length > 3 ? `<br>...and ${warnings.length - 3} more` : '');
    }

    return parsed;
  }

  // ===== Load Flights Button =====
  loadBtn?.addEventListener('click', () => {
    const text = flightInput?.value || '';
    if (!text.trim()) {
      showError('Please enter flight data (Flight# Origin Dest per line)');
      return;
    }

    flights = parseFlights(text);

    if (!flights.length) {
      showError('No valid flights found. Check format and ICAO codes.');
      return;
    }

    hideError();
    summary.textContent = `Loaded ${flights.length} flight(s). Fetching data...`;

    localStorage.setItem('fm_flights', JSON.stringify(flights));
    fetchAndRender();

    // Restart auto-refresh
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(fetchAndRender, REFRESH_INTERVAL);
  });

  // ===== Auto-load saved flights on page load =====
  (function initFlights() {
    const saved = localStorage.getItem('fm_flights');
    if (saved && flightInput) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          flights = parsed;
          flightInput.value = flights.map(f => `${f.flightNumber}\t${f.origin}\t${f.destination}`).join('\n');
          fetchAndRender();
          if (refreshTimer) clearInterval(refreshTimer);
          refreshTimer = setInterval(fetchAndRender, REFRESH_INTERVAL);
        }
      } catch (e) {
        console.error('Failed to load saved flights:', e);
      }
    }
  })();

  // ===== Fetch Data from Backend =====
  async function fetchAndRender() {
    if (!flights.length) return;

    summary.textContent = 'Fetching...';

    try {
      const payload = { flights: flights.map(f => ({ flightNumber: f.flightNumber, origin: f.origin, destination: f.destination })) };

      const res = await fetch(BACKEND_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      flightResults = data.results || {};
      renderTable();

      const now = new Date();
      const hh = String(now.getUTCHours()).padStart(2, '0');
      const mm = String(now.getUTCMinutes()).padStart(2, '0');
      lastUpdate.textContent = `Updated: ${hh}:${mm} UTC`;
      summary.textContent = `${flights.length} flight(s) • Auto-refresh every minute`;

      hideError();

    } catch (e) {
      showError(e.message || 'Network error');
      summary.textContent = 'Failed to load data';
      console.error('Fetch error:', e);
    }
  }

  // ===== Render Flight Table =====
  function renderTable() {
    if (!flights.length) {
      flightBody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: var(--muted);">No flights loaded</td></tr>';
      return;
    }

    const rows = flights.map(flight => {
      const key = flight.flightNumber;
      const result = flightResults[key] || {};

      const isIn = result.inTime && result.inTime !== '-';
      const rowClass = isIn ? 'flight-in' : '';

      const originMetarStatus = buildStatus(result.originMetarCheck);
      const destMetarStatus = buildStatus(result.destMetarCheck);
      const etaWeatherStatus = buildStatus(result.etaWeatherCheck);
      const alternateStatus = buildStatus(result.alternateCheck);

      return `
        <tr class="${rowClass}">
          <td><strong>${escape(flight.flightNumber)}</strong></td>
          <td>${escape(flight.origin)}</td>
          <td>${escape(flight.destination)}</td>
          <td>${escape(result.alternate || '—')}</td>
          <td>${formatTime(result.estimatedDeparture)}</td>
          <td>${formatTime(result.outTime)}</td>
          <td>${formatTime(result.offTime)}</td>
          <td>${formatTime(result.inTime)}</td>
          <td>${formatTime(result.eta)}</td>
          <td>${originMetarStatus}</td>
          <td>${destMetarStatus}</td>
          <td>${etaWeatherStatus}</td>
          <td>${alternateStatus}</td>
        </tr>
      `;
    }).join('');

    flightBody.innerHTML = rows;
  }

  // ===== Format ISO Time to HH:MM =====
  function formatTime(timeStr) {
    if (!timeStr || timeStr === '-' || timeStr === '—') return '—';
    try {
      const d = new Date(timeStr);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '—';
    }
  }

  // ===== Build Weather Status Badge + Tooltip =====
  function buildStatus(check) {
    if (!check) return '<span class="status status-grey">–</span>';

    const { overallStatus = 'unknown', checks = [] } = check;
    let statusClass = 'status-ok', statusText = 'OK';

    if (overallStatus === 'alert') {
      statusClass = 'status-alert';
      statusText = 'Alert';
    } else if (overallStatus === 'warning') {
      statusClass = 'status-warn';
      statusText = 'Warn';
    }

    const checksHtml = checks.map(item => {
      const itemClass = item.pass ? 'check-ok' : (item.critical ? 'check-alert' : 'check-warn');
      const icon = item.pass ? 'Success' : (item.critical ? 'Failed' : 'Warning');
      return `<div class="check-item ${itemClass}"><div class="check-icon">${icon}</div>${escape(item.label)}</div>`;
    }).join('');

    return `
      <div class="status ${statusClass}" title="${statusText}">
        ${statusText}
      </div>
      <div class="checks">${checksHtml}</div>
    `;
  }

  // ===== HTML Escape =====
  function escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Error Helpers =====
  function showError(msg) {
    if (err) {
      err.style.display = 'block';
      err.innerHTML = msg;
    }
  }
  function hideError() {
    if (err) err.style.display = 'none';
  }

  // ===== Cleanup on unload =====
  window.addEventListener('beforeunload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

})();
</script>