// Surface any runtime errors in the UI so failures aren’t silent
window.addEventListener('error', (e) => {
  const el = document.getElementById('err');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = 'Script error: ' + (e.message || e.error || e.filename || 'unknown');
});

(function () {
  const DATA_URL = "https://us-central1-handy-coil-469714-j2.cloudfunctions.net/process-weather-data-clean";

  const $ = (s, r = document) => r.querySelector(s);
  const form = $('#controlsForm');
  const idsEl = $('#ids');
  const ceilEl = $('#ceil');
  const visEl = $('#vis');
  const shiftEndEl = $('#shiftEnd');
  const applyTimeEl = $('#applyTime');
  const showMetarEl = $('#showMetar');
  const showTafEl = $('#showTaf');
  const alphaEl = $('#alpha');
  const filterEl = $('#filter');
  const themeEl = $('#theme');
  const spin = $('#spin');
  const err = $('#err');
  const board = $('#board-body');
  const summary = $('#summary');
  const ts = $('#timestamp');
  const utcNow = $('#utcNow');

  // Theme
  function applyTheme(mode){ document.body.classList.toggle('theme-dark', mode === 'dark'); localStorage.setItem('ct_theme', mode); }
  themeEl.addEventListener('change', e => applyTheme(e.target.value));
  (function initTheme(){ const saved = localStorage.getItem('ct_theme') || 'light'; themeEl.value = saved; applyTheme(saved);} )();

  // UTC clock
  function updateUtcClock(){ const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0'); utcNow.textContent = `UTC ${hh}:${mm}`; }
  updateUtcClock(); setInterval(updateUtcClock, 30_000);

  // Prefs
  function savePrefs(){
    localStorage.setItem('ct_ids', idsEl.value.trim());
    localStorage.setItem('ct_ceil', ceilEl.value);
    localStorage.setItem('ct_vis', visEl.value);
    localStorage.setItem('ct_shift', shiftEndEl.value.trim());
    localStorage.setItem('ct_applyTime', applyTimeEl.checked ? '1' : '0');
    localStorage.setItem('ct_m', showMetarEl.checked ? '1' : '0');
    localStorage.setItem('ct_t', showTafEl.checked ? '1' : '0');
    localStorage.setItem('ct_a', alphaEl.checked ? '1' : '0');
    localStorage.setItem('ct_f', filterEl.checked ? '1' : '0');
  }
  function loadPrefs(){
    const sp = new URLSearchParams(location.search);
    idsEl.value   = sp.get('ids')   || localStorage.getItem('ct_ids')   || idsEl.value || "KDEN,KATL";
    ceilEl.value  = sp.get('ceil')  || localStorage.getItem('ct_ceil')  || ceilEl.value || "700";
    visEl.value   = sp.get('vis')   || localStorage.getItem('ct_vis')   || visEl.value || "2";
    shiftEndEl.value = sp.get('shift') || localStorage.getItem('ct_shift') || "";
    applyTimeEl.checked = (sp.get('applyTime') ?? localStorage.getItem('ct_applyTime')) === '1';
    showMetarEl.checked = (sp.get('m') ?? localStorage.getItem('ct_m')) !== '0';
    showTafEl.checked   = (sp.get('t') ?? localStorage.getItem('ct_t')) !== '0';
    alphaEl.checked     = (sp.get('a') ?? localStorage.getItem('ct_a')) === '1';
    filterEl.checked    = (sp.get('f') ?? localStorage.getItem('ct_f')) === '1';
  }
  loadPrefs();

  function normalizedIds(){ return (idsEl.value || '').trim().replace(/[\s;]+/g, ',').replace(/,+/g, ',').replace(/^,|,$/g, ''); }

  // ENTER submits form
  form.addEventListener('submit', (e) => { e.preventDefault(); savePrefs(); fetchAndRender(); });

  // React to control changes
  function controlsChanged(e){
    if (!e.target || !e.target.matches) return;
    if (e.target.matches('#theme,#ceil,#vis,#shiftEnd,#applyTime,#showMetar,#showTaf,#alpha,#filter')){
      savePrefs(); fetchAndRender();
    }
  }
  document.addEventListener('change', controlsChanged);
  document.addEventListener('input', controlsChanged);

  // ---------- Auto-refresh every minute while tab is visible ----------
  let refreshTimer = null;
  function startAutoRefresh(){
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => fetchAndRender(true), 60_000);
  }
  function stopAutoRefresh(){
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoRefresh(); else { fetchAndRender(true); startAutoRefresh(); }
  });
  window.addEventListener('online',  () => { fetchAndRender(true); startAutoRefresh(); });
  window.addEventListener('offline', () => { stopAutoRefresh(); });

  // ---------- Time filter helpers (DDHH with +3h buffer) ----------
  function pad2(n){ return String(n).padStart(2,'0'); }

  function parseDDHH(s){
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{2})(\d{2})$/);
    if (!m) return null;
    let day = parseInt(m[1],10), hour = parseInt(m[2],10);
    if (day < 1 || day > 31 || hour < 0 || hour > 23) return null;
    hour += 3;                 // add 3h buffer
    if (hour >= 24) { hour -= 24; day += 1; }  // rollover
    if (day > 31) day = 31;   // clamp (short horizon)
    return { day, hour, disp: `${pad2(day)}${pad2(hour)}` };
  }
  function ddhhCompare(a, b){
    if (a.day !== b.day) return a.day > b.day ? 1 : -1;
    if (a.hour !== b.hour) return a.hour > b.hour ? 1 : (a.hour < b.hour ? -1 : 0);
    return 0;
  }
  // Extract a starting DDHH from a TAF segment
  function lineStartDDHH(text){
    let m = text.match(/\bFM(\d{2})(\d{2})\d{2}\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    m = text.match(/\b(?:TEMPO|BECMG|PROB(?:30|40))\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    return null;
  }

  // Tag "after-shift" lines; also strip hit spans inside after-shift blocks
  function applyTimeFilterToTafHtml(tafHtml, tafRaw, cutoffDDHH, enabled){
    if (!enabled || !tafHtml || !tafRaw || !cutoffDDHH) return tafHtml;

    // Decide which raw segments start after cutoff
    const breaks = / (?=(FM\d{6}\b|TEMPO\b|BECMG\b|PROB(?:30|40)\b))/g;
    const rawLines = tafRaw.split(breaks).join('\n').split('\n').map(s => s.trim()).filter(Boolean);
    const afterFlags = rawLines.map(txt => {
      const start = lineStartDDHH(txt);
      if (!start) return false;           // context/no explicit start => keep as in-shift
      return ddhhCompare(start, cutoffDDHH) === 1;
    });

    // Apply flags to HTML lines and remove hits inside after-shift
    let idx = 0;
    return tafHtml.replace(/<div class="taf-line([^"]*)">([\s\S]*?)<\/div>/g, (_, rest, inner) => {
      const isAfter = afterFlags[idx++] || /\bafter-shift\b/.test(rest);
      const cls = isAfter ? `taf-line${rest} after-shift` : `taf-line${rest}`;
      if (isAfter) {
        // strip red-hit spans in after-shift content
        inner = inner.replace(/<span class="hit">/g,'').replace(/<\/span>/g,'');
      }
      return `<div class="${cls}">${inner}</div>`;
    });
  }

  // Remove entire after-shift blocks (for trigger evaluation only)
  function stripAfterShiftBlocks(tafHtml){
    return tafHtml.replace(/<div class="taf-line[^"]*after-shift[^"]*">[\s\S]*?<\/div>/g, '');
  }

  function containsActiveHit(html){
    return /class="hit"/.test(html);
  }

  // Build HTML
  function clientSideFallbackRender(payload) {
    const rows = (payload && payload.results) ? payload.results : [];
    if (!rows.length) return `<div class="muted" style="padding:12px">No results.</div>`;
    let list = rows.slice();
    if (alphaEl.checked) list.sort((a, b) => (a.icao || '').localeCompare(b.icao || ''));

    const showM = showMetarEl.checked;
    const showT = showTafEl.checked;

    const cutoff = parseDDHH(shiftEndEl.value); // {day, hour, disp}
    let html = '';
    for (const r of list) {
      const icao = r.icao || '';
      let metarHTML = r.metar?.html || '';
      let tafHTML   = r.taf?.html   || '';
      const tafRaw  = r.taf?.raw    || '';

      // Tag after-shift and strip hits inside those lines
      tafHTML = applyTimeFilterToTafHtml(tafHTML, tafRaw, cutoff, applyTimeEl.checked);

      // Compute "active trigger": hits in METAR, or hits in TAF that are NOT after-shift
      const tafActiveOnly = stripAfterShiftBlocks(tafHTML);
      const activeTrigger =
        (metarHTML && containsActiveHit(metarHTML)) ||
        (tafActiveOnly && containsActiveHit(tafActiveOnly));

      // If "Filter triggers" is enabled, skip non-trigger rows
      if (filterEl.checked && !activeTrigger) continue;

      html += `<div class="row">`;
      if (showM) {
        html += metarHTML ? metarHTML : `<div class="wx muted">No METARs found for ${escapeHtml(icao)}</div>`;
      }
      if (showT) {
        html += tafHTML ? tafHTML : `<div class="wx muted">No TAFs found for ${escapeHtml(icao)}</div>`;
      }
      html += `</div>`;
    }
    return html || `<div class="muted" style="padding:12px">No results.</div>`;
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  // Fetch + render
  async function fetchAndRender(quiet){
    const ids = normalizedIds();
    const params = new URLSearchParams({
      ids,
      ceil: ceilEl.value,
      vis: visEl.value,
      metar: showMetarEl.checked ? '1' : '0',
      taf:   showTafEl.checked   ? '1' : '0',
      alpha: alphaEl.checked     ? '1' : '0',
      filter: filterEl.checked   ? 'trigger' : 'all',
    });
    if (!quiet){ summary.textContent='Loading…'; spin.style.display='inline-block'; err.style.display='none'; err.textContent=''; }
    try{
      const res = await fetch(`${DATA_URL}?${params}`, { method:'GET', mode:'cors' });
      if (!res.ok) throw new Error(`Data API ${res.status} ${res.statusText}`);
      const data = await res.json();
      board.innerHTML = clientSideFallbackRender(data);

      const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
      ts.textContent = `Updated: ${hh}:${mm} UTC`;

      const count = ids ? ids.split(',').filter(Boolean).length : 0;
      const cutoffBadge = (applyTimeEl.checked && shiftEndEl.value)
        ? ` • Shift cutoff with buffer: ${parseDDHH(shiftEndEl.value)?.disp ?? ''}`
        : '';
      summary.textContent=`${count} airport(s) • Theme: ${themeEl.value} • Filter: ${filterEl.checked ? 'Trigger' : 'All'}${cutoffBadge}`;
    } catch(e){
      err.style.display='block';
      err.textContent = e && e.message ? e.message : String(e);
    } finally{
      spin.style.display='none';
    }
  }

  // Initial load + start auto-refresh
  fetchAndRender();
  startAutoRefresh();
})();
