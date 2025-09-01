// Show runtime errors in-page (robust)
window.addEventListener('error', (e) => {
  const el = document.getElementById('err');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = 'Script error: ' + (e.message || e.error || e.filename || 'unknown');
});

(function () {
  // ===== Config =====
  const DATA_URL = "https://us-central1-handy-coil-469714-j2.cloudfunctions.net/process-weather-data-clean";

  // ===== DOM =====
  const $ = (s, r = document) => r.querySelector(s);
  const form       = $('#controlsForm');
  const idsEl      = $('#ids');
  const ceilEl     = $('#ceil');
  const visEl      = $('#vis');
  const shiftEndEl = $('#shiftEnd');
  const applyTimeEl= $('#applyTime');
  const showMetarEl= $('#showMetar');
  const showTafEl  = $('#showTaf');
  const alphaEl    = $('#alpha');
  const themeEl    = $('#theme');
  const spin       = $('#spin');
  const err        = $('#err');
  const board      = $('#board-body');
  const summary    = $('#summary');
  const ts         = $('#timestamp');
  const utcNow     = $('#utcNow');

  // Slider (beta) or legacy checkbox (prod)
  const modeEl     = $('#mode');     // range 0..2 (All / Filter / Drill Down)
  const modeLabel  = $('#modeLabel');
  const filterEl   = $('#filter');   // optional legacy checkbox

  // ===== Theme =====
  function applyTheme(mode){
    document.body.classList.toggle('theme-dark', mode === 'dark');
    localStorage.setItem('ct_theme', mode);
  }
  themeEl?.addEventListener('change', e => applyTheme(e.target.value));
  (function initTheme(){
    const saved = localStorage.getItem('ct_theme') || 'light';
    if (themeEl) themeEl.value = saved;
    applyTheme(saved);
  })();

  // ===== UTC clock (update every minute, aligned) =====
  function tickClock(){
    const d=new Date();
    const hh=String(d.getUTCHours()).padStart(2,'0');
    const mm=String(d.getUTCMinutes()).padStart(2,'0');
    if (utcNow) utcNow.textContent = `UTC ${hh}:${mm}`;
  }
  function startMinuteClock(){
    tickClock();
    const now = new Date();
    const msToNextMinute = (60 - now.getUTCSeconds())*1000 - now.getUTCMilliseconds();
    setTimeout(() => {
      tickClock();
      setInterval(tickClock, 60_000);
    }, Math.max(0, msToNextMinute));
  }
  startMinuteClock();

  // ===== Prefs =====
  function savePrefs(){
    localStorage.setItem('ct_ids', idsEl?.value.trim() || '');
    localStorage.setItem('ct_ceil', ceilEl?.value || '');
    localStorage.setItem('ct_vis',  visEl?.value || '');
    localStorage.setItem('ct_shift', shiftEndEl?.value.trim() || '');
    localStorage.setItem('ct_applyTime', applyTimeEl?.checked ? '1' : '0');
    localStorage.setItem('ct_m', showMetarEl?.checked ? '1' : '0');
    localStorage.setItem('ct_t', showTafEl?.checked   ? '1' : '0');
    localStorage.setItem('ct_a', alphaEl?.checked     ? '1' : '0');
    if (filterEl) localStorage.setItem('ct_f', filterEl.checked ? '1' : '0');
    if (modeEl)   localStorage.setItem('ct_mode', String(modeEl.value || '0'));
  }
  function loadPrefs(){
    const sp = new URLSearchParams(location.search);
    if (idsEl)      idsEl.value      = sp.get('ids')   || localStorage.getItem('ct_ids')   || idsEl.value || "KDEN KSGU KACV";
    if (ceilEl)     ceilEl.value     = sp.get('ceil')  || localStorage.getItem('ct_ceil')  || ceilEl.value || "700";
    if (visEl)      visEl.value      = sp.get('vis')   || localStorage.getItem('ct_vis')   || visEl.value || "2";
    if (shiftEndEl) shiftEndEl.value = sp.get('shift') || localStorage.getItem('ct_shift') || "";
    if (applyTimeEl) applyTimeEl.checked = (sp.get('applyTime') ?? localStorage.getItem('ct_applyTime')) === '1';
    if (showMetarEl) showMetarEl.checked = (sp.get('m') ?? localStorage.getItem('ct_m')) !== '0';
    if (showTafEl)   showTafEl.checked   = (sp.get('t') ?? localStorage.getItem('ct_t')) !== '0';
    if (alphaEl)     alphaEl.checked     = (sp.get('a') ?? localStorage.getItem('ct_a')) === '1';
    if (filterEl)    filterEl.checked    = (sp.get('f') ?? localStorage.getItem('ct_f')) === '1';
    if (modeEl)      modeEl.value        = sp.get('mode') ?? localStorage.getItem('ct_mode') ?? '0';
    if (modeLabel && modeEl){
      modeLabel.textContent = ['All','Filter','Drill Down'][parseInt(modeEl.value,10) || 0];
      modeEl.addEventListener('input', () => {
        modeLabel.textContent = ['All','Filter','Drill Down'][parseInt(modeEl.value,10) || 0];
      });
    }
  }
  loadPrefs();

  function normalizedIds(){
    return (idsEl?.value || '')
      .trim().toUpperCase()
      .replace(/[\s;]+/g, ',')
      .replace(/,+/g, ',')
      .replace(/^,|,$/g, '');
  }

  // Submit on click/Enter
  form?.addEventListener('submit', (e) => { e.preventDefault(); savePrefs(); fetchAndRender(); });

  // React to control changes
  function controlsChanged(e){
    if (!e.target || !e.target.matches) return;
    if (e.target.matches('#theme,#ceil,#vis,#shiftEnd,#applyTime,#showMetar,#showTaf,#alpha,#filter,#mode')){
      savePrefs(); fetchAndRender();
    }
  }
  document.addEventListener('change', controlsChanged);
  document.addEventListener('input',  controlsChanged);

  // ===== Time filter helpers (TAF only) =====
  const pad2 = (n) => String(n).padStart(2,'0');

  // Parse DDHH with +3h buffer (regex-based)
  function parseDDHHWithBuffer(s){
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{2})(\d{2})$/);
    if (!m) return null;
    let day = parseInt(m[1],10), hour = parseInt(m[2],10);
    if (day < 1 || day > 31 || hour < 0 || hour > 23) return null;
    hour += 3;                // +3h buffer
    if (hour >= 24) { hour -= 24; day += 1; }
    if (day > 31) day = 31;   // clamp
    return { day, hour, disp: `${pad2(day)}${pad2(hour)}` };
  }
  function ddhhCompare(a, b){
    if (!a || !b) return 0;
    if (a.day !== b.day) return a.day > b.day ? 1 : -1;
    if (a.hour !== b.hour) return a.hour > b.hour ? 1 : (a.hour < b.hour ? -1 : 0);
    return 0;
  }
  // Extract start DDHH from a single TAF line by regex tokens
  function extractStartDDHHFromLine(txt){
    if (!txt) return null;
    // FMddhhmm
    let m = txt.match(/\bFM(\d{2})(\d{2})\d{2}\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    // TEMPO ddhh/ddhh | BECMG ddhh/ddhh | PROB30/40 ddhh/ddhh
    m = txt.match(/\b(?:TEMPO|BECMG|PROB(?:30|40))\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    return null;
    // (We intentionally ignore lines without explicit time tokens.)
  }

  // Apply Shift End (TAF only): add 'after-shift' on lines that start after cutoff; do not alter METAR
  function applyShiftToTafHtml(tafHtml, cutoffDDHH, enabled){
    if (!enabled || !tafHtml || !cutoffDDHH) return tafHtml;
    return tafHtml.replace(
      /<div class="taf-line([^"]*)">([\s\S]*?)<\/div>/g,
      (_, rest, inner) => {
        const plain = inner.replace(/<[^>]+>/g,''); // strip tags for token parse
        const start = extractStartDDHHFromLine(plain);
        const isAfter = start ? (ddhhCompare(start, cutoffDDHH) === 1) : false;

        let cls = `taf-line${rest}`;
        let content = inner;
        if (isAfter) {
          cls += ' after-shift';
          // Make hits visually muted by removing hit spans in after-shift lines
          content = content.replace(/<span class="hit">/g,'').replace(/<\/span>/g,'');
        }
        return `<div class="${cls}">${content}</div>`;
      }
    );
  }

  // Remove after-shift lines (used when assessing current triggers only)
  function stripAfterShiftLines(tafHtml){
    return tafHtml.replace(/<div class="taf-line[^"]*\bafter-shift\b[^"]*">[\s\S]*?<\/div>/g, '');
  }

  const containsHit = (html) => /class="hit"/.test(html || '');

  // Determine current UI mode: 0=All, 1=Filter triggers, 2=Drill Down
  function currentMode(){
    if (modeEl) return parseInt(modeEl.value,10) || 0;
    if (filterEl && filterEl.checked) return 1;
    return 0;
  }

  // ===== Render (robust; no false “not found”) =====
  function renderPayload(data){
    const rows = (data && Array.isArray(data.results)) ? data.results : [];
    if (!rows.length) { board.innerHTML = `<div class="muted">No results.</div>`; return; }

    let list = rows.slice();
    if (alphaEl?.checked) list.sort((a,b)=>(a.icao||'').localeCompare(b.icao||''));

    const showM = !!(showMetarEl?.checked);
    const showT = !!(showTafEl?.checked);
    const mode  = currentMode();
    const cutoff = parseDDHHWithBuffer(shiftEndEl?.value);

    let html = '';
    for (const r of list){
      const icao = r.icao || '';

      // Track availability from backend (do not rely on filtered HTML emptiness)
      const metarAvailable = !!r.metar;
      const tafAvailable   = !!r.taf;

      // Use server-provided HTML (already escaped/highlighted)
      let metarHTML = metarAvailable ? (r.metar.html || '') : '';
      let tafHTML   = tafAvailable   ? (r.taf.html   || '') : '';

      // Apply TAF time filter (adds 'after-shift' on future lines; METAR untouched)
      tafHTML = applyShiftToTafHtml(tafHTML, cutoff, !!(applyTimeEl?.checked));

      // Drill Down: keep only TAF lines that contain hits; if none, show nothing (but not “not found”)
      if (mode === 2 && tafAvailable && showT){
        // remove non-hit lines
        tafHTML = tafHTML.replace(
          /<div class="taf-line[^"]*">([\s\S]*?)<\/div>/g,
          (full, inner) => /class="hit"/.test(inner) ? full : ''
        );
      }

      // Compute “active trigger” only from METAR hits or TAF hits that are NOT after-shift
      const tafActive = containsHit(stripAfterShiftLines(tafHTML));
      const metarActive = containsHit(metarHTML);
      const isTriggerNow = !!(tafActive || metarActive);

      // Filter mode (1): remove non-triggers entirely
      if (mode === 1 && !isTriggerNow) continue;

      // Build rows per airport (keep your existing simple flow)
      if (showM){
        if (metarAvailable && metarHTML) {
          html += metarHTML + '\n';
        } else {
          html += `<div class="muted">No METARs found for ${escapeHtml(icao)}</div>\n`;
        }
      }

      if (showT){
        if (tafAvailable) {
          // If TAF becomes empty due to drill-down or all lines after-shift, we just omit it (no “not found”)
          if (tafHTML.trim()) html += tafHTML + '\n';
        } else {
          html += `<div class="muted">No TAFs found for ${escapeHtml(icao)}</div>\n`;
        }
      }

      html += '<br/>'; // spacer between airports
    }

    board.innerHTML = html || `<div class="muted">No results.</div>`;
  }

  const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // ===== Fetch + render =====
  async function fetchAndRender(quiet){
    const ids = normalizedIds();
    const params = new URLSearchParams({
      ids,
      ceil: ceilEl?.value || '700',
      vis:  visEl?.value  || '2',
      metar: showMetarEl?.checked ? '1' : '0',
      taf:   showTafEl?.checked   ? '1' : '0',
      alpha: alphaEl?.checked     ? '1' : '0',
      filter: currentMode() === 1 ? 'trigger' : 'all',  // backend filter only in Filter mode
    });

    if (!quiet){ summary && (summary.textContent='Loading…'); spin && (spin.style.display='inline-block'); err && (err.style.display='none', err.textContent=''); }
    try{
      const res = await fetch(`${DATA_URL}?${params}`, { method:'GET', mode:'cors' });
      if (!res.ok) throw new Error(`Data API ${res.status} ${res.statusText}`);
      const data = await res.json();

      renderPayload(data);

      const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
      if (ts) ts.textContent = `Updated: ${hh}:${mm} UTC`;

      const count = ids ? ids.split(',').filter(Boolean).length : 0;
      const cutoffDisp = (applyTimeEl?.checked && shiftEndEl?.value)
        ? ` • Shift cutoff +3h: ${parseDDHHWithBuffer(shiftEndEl.value)?.disp ?? ''}`
        : '';
      if (summary){
        const modeNames = ['All','Filter','Drill Down'];
        summary.textContent = `${count} airport(s) • Theme: ${document.body.classList.contains('theme-dark') ? 'dark' : 'light'} • Mode: ${modeNames[currentMode()] || 'All'}${cutoffDisp}`;
      }
    } catch(e){
      if (err){
        err.style.display='block';
        err.textContent = e && e.message ? e.message : String(e);
      }
    } finally{
      if (spin) spin.style.display='none';
    }
  }

  // ===== Auto-refresh every 60s (no regressions) =====
  let refreshTimer = null;
  function startAutoRefresh(){
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => fetchAndRender(true), 60_000);
  }
  function stopAutoRefresh(){
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoRefresh();
    else { fetchAndRender(true); startAutoRefresh(); }
  });
  window.addEventListener('online',  () => { fetchAndRender(true); startAutoRefresh(); });
  window.addEventListener('offline', () => { stopAutoRefresh(); });

  // ===== Init =====
  fetchAndRender();
  startAutoRefresh();
})();
