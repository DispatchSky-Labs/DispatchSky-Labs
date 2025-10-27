(function() {
  // ===== Config =====
  const BACKEND_URL = "https://us-central1-handy-coil-469714-j2.cloudfunctions.net/process-flight-data";
  const REFRESH_INTERVAL = 60_000; // 1 minute

  // ===== DOM =====
  const $ = (s) => document.querySelector(s);
  const BACKEND_URL = "https://process-flight-data-752k4ah3ra-uc.a.run.app";
  const loadBtn = $('#loadBtn');
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

  // ===== Theme =====
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

  // ===== UTC Clock =====
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

  // ===== Parse Flights from CSV =====
  function parseFlights(text) {
    const lines = text.trim().split('\n').filter(line => line.trim());
    const parsed = [];
    for (const line of lines) {
      if (parsed.length >= 46) break; // Limit to 46
      const parts = line.split(',').map(p => p.trim().toUpperCase());
      if (parts.length >= 3) {
        parsed.push({
          flightNumber: parts[0],
          origin: parts[1],
          destination: parts[2],
        });
      }
    }
    return parsed;
  }

  // ===== Load Flights =====
  loadBtn?.addEventListener('click', () => {
    const text = flightInput?.value || '';
    flights = parseFlights(text);

    if (!flights.length) {
      err.style.display = 'block';
      err.textContent = 'No valid flights found. Enter FlightNum,OriginICAO,DestICAO per line.';
      return;
    }

    err.style.display = 'none';
    err.textContent = '';
    summary.textContent = `Loaded ${flights.length} flight(s). Fetching data...`;

    localStorage.setItem('fm_flights', JSON.stringify(flights));
    fetchAndRender();

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(fetchAndRender, REFRESH_INTERVAL);
  });

  // ===== Load Saved Flights on Init =====
  (function initFlights() {
    const saved = localStorage.getItem('fm_flights');
    if (saved) {
      try {
        flights = JSON.parse(saved);
        if (flights.length) {
          flightInput.value = flights.map(f => `${f.flightNumber},${f.origin},${f.destination}`).join('\n');
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
      const payload = {
        flights: flights.map(f => ({
          flightNumber: f.flightNumber,
          origin: f.origin,
          destination: f.destination,
        }))
      };

      const res = await fetch(BACKEND_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`Backend ${res.status} ${res.statusText}`);

      const data = await res.json();

      if (data.error) {
        err.style.display = 'block';
        err.textContent = `Backend error: ${data.error}`;
        return;
      }

      flightResults = data.results || {};
      renderTable();

      const d = new Date();
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      lastUpdate.textContent = `Updated: ${hh}:${mm} UTC`;
      summary.textContent = `${flights.length} flight(s) • Auto-refresh every minute`;

      err.style.display = 'none';
      err.textContent = '';

    } catch (e) {
      err.style.display = 'block';
      err.textContent = e.message || 'Fetch error';
      summary.textContent = 'Error loading data';
    }
  }

  // ===== Render Table =====
  function renderTable() {
    if (!flights.length) {
      flightBody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: var(--muted);">No flights loaded</td></tr>';
      return;
    }

    const rows = flights.map(flight => {
      const key = `${flight.flightNumber}`;
      const result = flightResults[key] || {};

      // Check if "IN" (greyed out)
      const isIn = result.inTime && result.inTime !== '-';
      const rowClass = isIn ? 'flight-in' : '';

      // Build status indicators
      const originMetarStatus = buildStatus(result.originMetarCheck);
      const destMetarStatus = buildStatus(result.destMetarCheck);
      const etaWeatherStatus = buildStatus(result.etaWeatherCheck);
      const alternateStatus = buildStatus(result.alternateCheck);

      return `
        <tr class="${rowClass}">
          <td><strong>${escape(flight.flightNumber)}</strong></td>
          <td>${escape(flight.origin)}</td>
          <td>${escape(flight.destination)}</td>
          <td>${escape(result.alternate || '-')}</td>
          <td>${escape(result.estimatedDeparture || '-')}</td>
          <td>${escape(result.outTime || '-')}</td>
          <td>${escape(result.offTime || '-')}</td>
          <td>${escape(result.inTime || '-')}</td>
          <td>${escape(result.eta || '-')}</td>
          <td>${originMetarStatus}</td>
          <td>${destMetarStatus}</td>
          <td>${etaWeatherStatus}</td>
          <td>${alternateStatus}</td>
        </tr>
      `;
    }).join('');

    flightBody.innerHTML = rows;
  }

  // ===== Build Status Indicator HTML =====
  function buildStatus(check) {
    if (!check) return '<span class="status status-grey">–</span>';

    const { overallStatus, checks: checkItems } = check;
    let statusClass = 'status-ok';
    let statusText = 'OK';

    if (overallStatus === 'alert') {
      statusClass = 'status-alert';
      statusText = '⚠ Alert';
    } else if (overallStatus === 'warning') {
      statusClass = 'status-warn';
      statusText = '⚡ Warn';
    }

    const checksHtml = (checkItems || []).map(item => {
      const itemClass = item.pass ? 'check-ok' : (item.critical ? 'check-alert' : 'check-warn');
      const icon = item.pass ? '✓' : (item.critical ? '✕' : '!');
      return `<div class="check-item ${itemClass}"><div class="check-icon">${icon}</div>${escape(item.label)}</div>`;
    }).join('');

    return `<div class="status ${statusClass}">${statusText}</div><div class="checks">${checksHtml}</div>`;
  }

  // ===== Escape HTML =====
  function escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Cleanup =====
  window.addEventListener('beforeunload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
  });
})();
