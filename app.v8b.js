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
  const themeEl = $('#theme');
  const modeEl = $('#mode');       // 0=All, 1=Filter, 2=Drill
  const modeLabel = $('#modeLabel');
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
  if (themeEl) {
    themeEl.addEventListener('change', e => applyTheme(e.target.value));
    (function initTheme(){
      const saved = localStorage.getItem('ct_theme') || 'light';
      themeEl.value = saved; applyTheme(saved);
    })();
  } else {
    applyTheme(localStorage.getItem('ct_theme') || 'light');
  }

  // UTC clock
  function updateUtcClock(){
    const d=new Date();
    const hh=String(d.getUTCHours()).padStart(2,'0');
    const mm=String(d.getUTCMinutes()).padStart(2,'0');
    if (utcNow) utcNow.textContent = `UTC ${hh}:${mm}`;
  }
  updateUtcClock(); setInterval(updateUtcClock, 30_000);

  // Prefs
  function savePrefs(){
    localStorage.setItem('ct_ids', (idsEl?.value || '').trim());
    localStorage.setItem('ct_ceil', ceilEl?.value || '');
    localStorage.setItem('ct_vis', visEl?.value || '');
    localStorage.setItem('ct_shift', (shiftEndEl?.value || '').trim());
    localStorage.setItem('ct_applyTime', applyTimeEl?.checked ? '1' : '0');
    localStorage.setItem('ct_m', showMetarEl?.checked ? '1' : '0');
    localStorage.setItem('ct_t', showTafEl?.checked ? '1' : '0');
    localStorage.setItem('ct_a', alphaEl?.checked ? '1' : '0');
    localStorage.setItem('ct_mode', modeEl ? String(modeEl.value) : '0');
  }
  function loadPrefs(){
    const sp = new URLSearchParams(location.search);
    if (idsEl) idsEl.value  = sp.get('ids')   || localStorage.getItem('ct_ids')   || idsEl.value || "KDEN KSGU KACV";
    if (ceilEl) ceilEl.value= sp.get('ceil')  || localStorage.getItem('ct_ceil')  || ceilEl.value || "700";
    if (visEl) visEl.value  = sp.get('vis')   || localStorage.getItem('ct_vis')   || visEl.value || "2";
    if (shiftEndEl) shiftEndEl.value = sp.get('shift') || localStorage.getItem('ct_shift') || "";
    if (applyTimeEl) applyTimeEl.checked = (sp.get('applyTime') ?? localStorage.getItem('ct_applyTime')) === '1';
    if (showMetarEl) showMetarEl.checked = (sp.get('m') ?? localStorage.getItem('ct_m')) !== '0';
    if (showTafEl)   showTafEl.checked   = (sp.get('t') ?? localStorage.getItem('ct_t')) !== '0';
    if (alphaEl)     alphaEl.checked     = (sp.get('a') ?? localStorage.getItem('ct_a')) === '1';
    const modeSaved = sp.get('mode') ?? localStorage.getItem('ct_mode') ?? '0';
    if (modeEl) modeEl.value = modeSaved;
    updateModeLabel();
  }
  loadPrefs();

  function updateModeLabel(){
    if (!modeEl || !modeLabel) return;
    const v = Number(modeEl.value || 0);
    modeLabel.textContent = v === 0 ? 'All' : (v === 1 ? 'Filter' : 'Drill Down');
  }

  function normalizedIds(){
    return ((idsEl?.value) || '')
      .trim()
      .replace(/[\s;]+/g, ',')
      .replace(/,+/g, ',')
      .replace(/^,|,$/g, '');
  }

  // Submit
  if (form) {
    form.addEventListener('submit', (e) => { e.preventDefault(); savePrefs(); fetchAndRender(); });
  }

  // React to control changes (light debounce for text)
  let changeTimer = null;
  function controlsChanged(e){
    if (!e.target || !e.target.matches) return;
    if (e.target.matches('#theme,#ceil,#vis,#shiftEnd,#applyTime,#showMetar,#showTaf,#alpha,#mode')){
      savePrefs();
      if (e.target.matches('#ids,#ceil,#vis,#shiftEnd')) {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => fetchAndRender(), 250);
      } else {
        if (e.target.id === 'mode') updateModeLabel();
        fetchAndRender();
      }
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
  function extractStartDDHHFromLine(txt){
    let m = txt.match(/\bFM(\d{2})(\d{2})\d{2}\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    m = txt.match(/\b(?:TEMPO|BECMG|PROB(?:30|40))\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    return null;
  }

  function applyTimeFilterToTafHtmlByTokens(tafHtml, cutoffDDHH, enabled){
    if (!enabled || !tafHtml || !cutoffDDHH) return tafHtml || '';
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
    return (tafHtml || '').replace(/<div class="taf-line[^"]*after-shift[^"]*">[\s\S]*?<\/div>/g, '');
  }
  const containsActiveHit = (html) => /class="hit"/.test(html);

  // Drill-down: keep only taf lines that contain hits (and not after-shift)
  function drillTafToHitLines(tafHtml) {
    if (!tafHtml) return '';
    const blocks = [];
    tafHtml.replace(/<div class="taf-line([^"]*)">([\s\S]*?)<\/div>/g, (m, rest, inner) => {
      const cls = `taf-line${rest}`;
      const isAfter = /after-shift/.test(cls);
      const hasHit = /class="hit"/.test(inner);
      if (!isAfter && hasHit) blocks.push(`<div class="${cls}">${inner}</div>`);
      return m;
    });
    return blocks.join('\n');
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // Fetch + render
  async function fetchAndRender(quiet){
    const ids = normalizedIds();
    const mode = Number(modeEl?.value || 0); // 0=All,1=Filter,2=Drill
    const params = new URLSearchParams({
      ids,
      ceil: ceilEl?.value ?? '',
      vis: visEl?.value ?? '',
      metar: showMetarEl?.checked ? '1' : '0',
      taf:   showTafEl?.checked   ? '1' : '0',
      alpha: alphaEl?.checked     ? '1' : '0',
      filter: mode === 0 ? 'all' : 'trigger', // Filter/Drill request trigger set
    });

    if (!quiet){ if (summary) summary.textContent='Loading…'; if (spin) spin.style.display='inline-block'; if (err){ err.style.display='none'; err.textContent=''; } }
    try{
      const res = await fetch(`${DATA_URL}?${params}`, { method:'GET', mode:'cors' });
      if (!res.ok) throw new Error(`Data API ${res.status} ${res.statusText}`);
      const data = await res.json();

      const rows = (data && data.results) ? data.results.slice() : [];
      if (!rows.length) {
        board.innerHTML = `<div class="muted">No results.</div>`;
      } else {
        if (alphaEl?.checked) rows.sort((a,b)=>(a.icao||'').localeCompare(b.icao||''));
        const showM = !!(showMetarEl?.checked);
        const showT = !!(showTafEl?.checked);
        const cutoff = parseDDHH(shiftEndEl?.value);

        let html = '';
        for (const r of rows) {
          const icao = r.icao || '';
          let metarHTML = r.metar?.html || '';
          let tafHTML   = r.taf?.html   || '';

          // Time filter tags (after-shift)
          tafHTML = applyTimeFilterToTafHtmlByTokens(tafHTML, cutoff, !!(applyTimeEl?.checked));
          const tafActiveOnly = stripAfterShiftBlocks(tafHTML);
          const activeTrigger = (metarHTML && containsActiveHit(metarHTML)) ||
                                (tafActiveOnly && containsActiveHit(tafActiveOnly));

          // Mode logic
          if (mode === 1 && !activeTrigger) continue;     // Filter
          if (mode === 2 && !activeTrigger) continue;     // Drill requires trigger airport

          // Drill reductions
          let drilled = false;
          if (mode === 2) {
            const original = tafHTML;
            const pruned = drillTafToHitLines(tafHTML);
            drilled = !!(original && pruned && original.trim() !== pruned.trim());
            tafHTML = pruned; // show only hit lines
          }

          // Build output
          if (showM) {
            if (metarHTML) {
              html += metarHTML + '<br/>'; // visible gap after METAR
              if (mode === 2 && drilled) html += '<div class="drill-sep"></div>';
            } else {
              html += `<div class="muted">No METARs found for ${escapeHtml(icao)}</div>`;
            }
          }
          if (showT) {
            html += tafHTML ? tafHTML : `<div class="muted">No TAFs found for ${escapeHtml(icao)}</div>`;
            html += '\n';
          }
          html += '<br/>'; // space between airports
        }
        board.innerHTML = html || `<div class="muted">No results.</div>`;
      }

      const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
      if (ts) ts.textContent = `Updated: ${hh}:${mm} UTC`;

      const count = ids ? ids.split(',').filter(Boolean).length : 0;
      const cutoffBadge = ((applyTimeEl?.checked) && (shiftEndEl?.value))
        ? ` • Shift cutoff with buffer: ${parseDDHH(shiftEndEl.value)?.disp ?? ''}`
        : '';
      const modeTxt = Number(modeEl?.value||0)===0?'All':(Number(modeEl?.value||0)===1?'Filter':'Drill Down');
      if (summary) summary.textContent = `${count} airport(s) • Theme: ${document.body.classList.contains('theme-dark') ? 'dark' : 'light'} • Mode: ${modeTxt}${cutoffBadge}`;
    } catch(e){
      if (err){
        err.style.display='block';
        err.textContent = e && e.message ? e.message : String(e);
      }
    } finally{
      if (spin) spin.style.display='none';
    }
  }

  // Initial load + auto-refresh
  fetchAndRender();
  let refreshTimer = null;
  function startAutoRefresh(){
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => fetchAndRender(true), 60_000);
  }
  function stopAutoRefresh(){
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoRefresh(); else { fetchAndRender(true); startAutoRefresh(); }
  });
  window.addEventListener('online',  () => { fetchAndRender(true); startAutoRefresh(); });
  window.addEventListener('offline', () => { stopAutoRefresh(); });
  startAutoRefresh();
})();