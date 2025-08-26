// Show runtime errors in-page
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
  function applyTheme(mode){
    document.body.classList.toggle('theme-dark', mode === 'dark');
    localStorage.setItem('ct_theme', mode);
  }
  themeEl.addEventListener('change', e => applyTheme(e.target.value));
  (function initTheme(){
    const saved = localStorage.getItem('ct_theme') || 'light';
    themeEl.value = saved; applyTheme(saved);
  })();

  // UTC clock
  function updateUtcClock(){
    const d=new Date();
    const hh=String(d.getUTCHours()).padStart(2,'0');
    const mm=String(d.getUTCMinutes()).padStart(2,'0');
    utcNow.textContent = `UTC ${hh}:${mm}`;
  }
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
    idsEl.value        = sp.get('ids')   || localStorage.getItem('ct_ids')   || idsEl.value || "KDEN KSGU KACV";
    ceilEl.value       = sp.get('ceil')  || localStorage.getItem('ct_ceil')  || ceilEl.value || "700";
    visEl.value        = sp.get('vis')   || localStorage.getItem('ct_vis')   || visEl.value || "2";
    shiftEndEl.value   = sp.get('shift') || localStorage.getItem('ct_shift') || "";
    applyTimeEl.checked= (sp.get('applyTime') ?? localStorage.getItem('ct_applyTime')) === '1';
    showMetarEl.checked= (sp.get('m') ?? localStorage.getItem('ct_m')) !== '0';
    showTafEl.checked  = (sp.get('t') ?? localStorage.getItem('ct_t')) !== '0';
    alphaEl.checked    = (sp.get('a') ?? localStorage.getItem('ct_a')) === '1';
    filterEl.checked   = (sp.get('f') ?? localStorage.getItem('ct_f')) === '1';
  }
  loadPrefs();

  function normalizedIds(){
    return (idsEl.value || '')
      .trim()
      .replace(/[\s;]+/g, ',')
      .replace(/,+/g, ',')
      .replace(/^,|,$/g, '');
  }

  // Submit on Enter/click
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

  // ===== Time filter helpers =====
  const pad2 = (n) => String(n).padStart(2,'0');

  function parseDDHH(s){
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{2})(\d{2})$/);
    if (!m) return null;
    let day = parseInt(m[1],10), hour = parseInt(m[2],10);
    if (day < 1 || day > 31 || hour < 0 || hour > 23) return null;
    hour += 3; // +3h buffer
    if (hour >= 24) { hour -= 24; day += 1; }
    if (day > 31) day = 31;
    return { day, hour, disp: `${pad2(day)}${pad2(hour)}` };
  }
  function ddhhCompare(a, b){
    if (a.day !== b.day) return a.day > b.day ? 1 : -1;
    if (a.hour !== b.hour) return a.hour > b.hour ? 1 : (a.hour < b.hour ? -1 : 0);
    return 0;
  }
  // Extract start DDHH from a TAF line
  function extractStartDDHHFromLine(txt){
    let m = txt.match(/\bFM(\d{2})(\d{2})\d{2}\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    m = txt.match(/\b(?:TEMPO|BECMG|PROB(?:30|40))\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    return null;
  }

  function applyTimeFilterToTafHtmlByTokens(tafHtml, cutoffDDHH, enabled){
    if (!enabled || !tafHtml || !cutoffDDHH) return tafHtml;
    return tafHtml.replace(
      /<div class="taf-line([^"]*)">([\s\S]*?)<\/div>/g,
      (_, rest, inner) => {
        const plain = inner.replace(/<[^>]+>/g,'');
        const start = extractStartDDHHFromLine(plain);
        const isAfter = start ? (ddhhCompare(start, cutoffDDHH) === 1) : false;

        let cls = `taf-line${rest}`;
        let content = inner;
        if (isAfter) {
          cls += ' after-shift';
          content = content.replace(/<span class="hit">/g,'').replace(/<\/span>/g,''); // strip red hits
        }
        return `<div class="${cls}">${content}</div>`;
      }
    );
  }
  function stripAfterShiftBlocks(tafHtml){
    return tafHtml.replace(/<div class="taf-line[^"]*after-shift[^"]*">[\s\S]*?<\/div>/g, '');
  }
  const containsActiveHit = (html) => /class="hit"/.test(html);

  // Build content
  function clientSideFallbackRender(payload) {
    const rows = (payload && payload.results) ? payload.results : [];
    if (!rows.length) return `<div class="muted">No results.</div>`;

    let list = rows.slice();
    if (alphaEl.checked) list.sort((a,b)=>(a.icao||'').localeCompare(b.icao||''));

    const showM = showMetarEl.checked;
    const showT = showTafEl.checked;
    const cutoff = parseDDHH(shiftEndEl.value);

    let html = '';
    for (const r of list) {
      const icao = r.icao || '';
      let metarHTML = r.metar?.html || ''; // <pre class="wx">...</pre>
      let tafHTML   = r.taf?.html   || ''; // many <div class="taf-line">...</div>

      // Apply time filter
      tafHTML = applyTimeFilterToTafHtmlByTokens(tafHTML, cutoff, applyTimeEl.checked);

      // Active trigger = METAR hit or (TAF hit before cutoff)
      const tafActiveOnly = stripAfterShiftBlocks(tafHTML);
      const activeTrigger = (metarHTML && containsActiveHit(metarHTML)) ||
                            (tafActiveOnly && containsActiveHit(tafActiveOnly));

      if (filterEl.checked && !activeTrigger) continue;

      if (showM) { html += metarHTML ? metarHTML : `<div class="muted">No METARs found for ${escapeHtml(icao)}</div>`; html += '\n'; }
      if (showT) { html += tafHTML   ? tafHTML   : `<div class="muted">No TAFs found for ${escapeHtml(icao)}</div>`;   html += '\n'; }
      html += '<br/>'; // space between airports
    }

    return html || `<div class="muted">No results.</div>`;
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

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
      summary.textContent = `${count} airport(s) • Theme: ${document.body.classList.contains('theme-dark') ? 'dark' : 'light'} • Filter: ${filterEl.checked ? 'Trigger' : 'All'}${cutoffBadge}`;
    } catch(e){
      err.style.display='block';
      err.textContent = e && e.message ? e.message : String(e);
    } finally{
      spin.style.display='none';
    }
  }

  // Initial load + single auto-refresh system (declare ONCE)
  fetchAndRender();

  let refreshTimer = null; // <— single declaration
  function startAutoRefresh(){
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => fetchAndRender(true), 60_000);
  }
  function stopAutoRefresh(){
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }
  // Manage visibility/network changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoRefresh(); else { fetchAndRender(true); startAutoRefresh(); }
  });
  window.addEventListener('online',  () => { fetchAndRender(true); startAutoRefresh(); });
  window.addEventListener('offline', () => { stopAutoRefresh(); });

  startAutoRefresh();
})();
