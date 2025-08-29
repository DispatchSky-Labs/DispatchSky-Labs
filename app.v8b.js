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
  const scanBar = $('#refreshScan');

  /* ===== Delta state across refreshes ===== */
  let refreshCycle = 0;
  // prevState: icao -> { metar: {hits, hadHit, hash}, taf: Map(hash -> {hits, hadHit}) }
  const prevState = new Map();
  // flashImproved: key -> expireCycle (one cycle visibility)
  const flashImproved = new Map();
  const keyFor = (icao, kind, hash) => `${icao}|${kind}|${hash||''}`;
  const countHits = (html) => (html && (html.match(/class="hit"/g) || []).length) || 0;
  const textHash = (s) => (s || '').replace(/<[^>]+>/g,'').trim();

  /* ===== Theme ===== */
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

  /* ===== UTC clock ===== */
  function updateUtcClock(){
    const d=new Date();
    const hh=String(d.getUTCHours()).padStart(2,'0');
    const mm=String(d.getUTCMinutes()).padStart(2,'0');
    if (utcNow) utcNow.textContent = `UTC ${hh}:${mm}`;
  }
  updateUtcClock(); setInterval(updateUtcClock, 30_000);

  /* ===== Prefs ===== */
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

  /* ===== Form & change handling ===== */
  if (form) {
    form.addEventListener('submit', (e) => { e.preventDefault(); savePrefs(); fetchAndRender(); });
  }
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

  /* ===== Time helpers ===== */
  const pad2 = (n) => String(n).padStart(2,'0');
  function parseDDHH(s){
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{2})(\d{2})$/);
    if (!m) return null;
    let day = parseInt(m[1],10), hour = parseInt(m[2],10);
    if (day < 1 || day > 31 || hour < 0 || hour > 23) return null;
    hour += 3; if (hour >= 24) { hour -= 24; day += 1; }
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

  /* Break TAF html into line objects for delta logic */
  function parseTafLines(tafHtml) {
    const out = [];
    (tafHtml || '').replace(/<div class="taf-line([^"]*)">([\s\S]*?)<\/div>/g, (m, rest, inner) => {
      const cls = `taf-line${rest}`;
      const after = /after-shift/.test(cls);
      const hasHit = /class="hit"/.test(inner);
      const hash = textHash(inner);
      out.push({ cls, inner, hash, after, hasHit, hits: countHits(inner) });
      return m;
    });
    return out;
  }

  function drillTafToHitLinesObj(lines) {
    return lines.filter(l => !l.after && l.hasHit);
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  /* ===== Refresh scan animation ===== */
  function runScan(){
    if (!scanBar) return;
    scanBar.classList.remove('run'); // restart animation
    // force reflow
    void scanBar.offsetWidth;
    scanBar.classList.add('run');
  }

  /* ===== Fetch + render ===== */
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
      filter: mode === 0 ? 'all' : 'trigger',
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
        const nextPrevState = new Map();

        for (const r of rows) {
          const icao = r.icao || '';
          let metarHTML = r.metar?.html || '';
          let tafHTML   = r.taf?.html   || '';

          // Apply time filter
          tafHTML = applyTimeFilterToTafHtmlByTokens(tafHTML, cutoff, !!(applyTimeEl?.checked));

          // Determine trigger at airport level (for filter/drill)
          const tafActiveOnlyHtml = stripAfterShiftBlocks(tafHTML);
          const airportActive = (metarHTML && containsActiveHit(metarHTML)) ||
                                (tafActiveOnlyHtml && containsActiveHit(tafActiveOnlyHtml));

          if ((mode === 1 || mode === 2) && !airportActive) {
            // BUT: we may still show improved flashes in Drill/Filter — handled later
            if (mode === 1) continue;
            // For Drill, continue only if we have flashes
            const metarKey = keyFor(icao,'METAR','');
            const hadMetarFlash = (flashImproved.get(metarKey) ?? -1) >= refreshCycle;
            let hasTafFlash = false;
            if (!hadMetarFlash) {
              for (const [k,v] of flashImproved.entries()) {
                if (k.startsWith(`${icao}|TAF|`) && v >= refreshCycle) { hasTafFlash = true; break; }
              }
            }
            if (!hadMetarFlash && !hasTafFlash) continue;
          }

          /* ===== Line-level analysis for deltas ===== */
          // Previous snapshots
          const prev = prevState.get(icao) || { metar:{hits:0, hadHit:false, hash:''}, taf:new Map() };

          // --- METAR
          const metarHits = countHits(metarHTML);
          const metarHadHit = metarHits > 0;
          const metarHash = textHash(metarHTML);
          const metarPrev = prev.metar || {hits:0, hadHit:false, hash:''};
          const metarWorse = (!metarPrev.hadHit && metarHadHit) || (metarHits > metarPrev.hits);
          const metarImprovedNow = (metarPrev.hadHit && !metarHadHit);

          // persist next prev
          nextPrevState.set(icao, { metar:{hits:metarHits, hadHit:metarHadHit, hash:metarHash}, taf: new Map() });

          // Flash handling for METAR
          const metarKey = keyFor(icao,'METAR','');
          if (metarImprovedNow) flashImproved.set(metarKey, refreshCycle + 1);

          // Decide whether to show METAR and with which classes
          if (showM) {
            if (metarHTML) {
              let metarOut = metarHTML;
              if (metarWorse) metarOut = metarOut.replace('<pre class="wx"', '<pre class="wx worse"');
              // If improved (no longer a trigger) and still within flash window, paint green
              const metarFlashActive = (flashImproved.get(metarKey) ?? -1) >= refreshCycle;
              if (!metarHadHit && metarFlashActive) {
                metarOut = metarOut.replace('<pre class="wx"', '<pre class="wx improved"');
              }
              // dashed separator only when drilling and we reduced TAF to hits (handled later)
              html += metarOut + '<br/>';
            } else {
              html += `<div class="muted">No METARs found for ${escapeHtml(icao)}</div>`;
            }
          }

          // --- TAF
          const tafLines = parseTafLines(tafHTML);
          const nextTafMap = new Map();

          // compare each line vs previous
          for (const line of tafLines) {
            const prevLine = prev.taf.get(line.hash) || {hits:0, hadHit:false};
            const worse = (!prevLine.hadHit && line.hasHit) || (line.hits > prevLine.hits);
            const improvedNow = (prevLine.hadHit && !line.hasHit);
            // record snapshot for next cycle
            nextTafMap.set(line.hash, {hits: line.hits, hadHit: line.hasHit});
            // schedule flash if improved
            if (improvedNow) {
              const k = keyFor(icao,'TAF', line.hash);
              flashImproved.set(k, refreshCycle + 1);
            }
            // annotate class for current render
            if (line.hasHit && worse) {
              line.cls = line.cls.replace('taf-line', 'taf-line worse');
            }
          }

          // save taf map into nextPrevState
          const holder = nextPrevState.get(icao);
          if (holder) holder.taf = nextTafMap;

          // Render per mode
          const modeIsDrill = (mode === 2);
          let outLines = [];
          if (showT) {
            if (modeIsDrill) {
              // keep only hit lines + flashed-improved lines
              const hitLines = drillTafToHitLinesObj(tafLines);
              outLines = hitLines.slice();

              // add one-cycle improved flashes (non-hit) for this ICAO
              for (const ln of tafLines) {
                if (!ln.after && !ln.hasHit) {
                  const k = keyFor(icao,'TAF', ln.hash);
                  if ((flashImproved.get(k) ?? -1) >= refreshCycle) {
                    // mark green
                    ln.cls = ln.cls.replace('taf-line', 'taf-line improved');
                    outLines.push(ln);
                  }
                }
              }
            } else if (mode === 1) {
              // Filter (keep all lines but airport already filtered above)
              outLines = tafLines.filter(l => !l.after);
            } else {
              // All
              outLines = tafLines;
            }

            // Build HTML
            if (outLines.length) {
              // If we’re in Drill and we pruned anything, insert dashed separator after METAR
              if (modeIsDrill && tafLines.length !== outLines.length) {
                html = html.replace(/<br\/>$/, '') + '<div class="drill-sep"></div>';
              }
              html += outLines.map(l => `<div class="${l.cls}">${l.inner}</div>`).join('\n');
            } else if (mode !== 2) {
              html += `<div class="muted">No TAFs found for ${escapeHtml(icao)}</div>`;
            }
            html += '\n';
          }

          html += '<br/>'; // space between airports
        } // end rows

        // commit next prev state
        prevState.clear();
        for (const [k,v] of nextPrevState.entries()) prevState.set(k,v);
        // expire flashes from older cycles
        for (const [k,exp] of flashImproved.entries()) {
          if (exp < refreshCycle) flashImproved.delete(k);
        }

        board.innerHTML = html || `<div class="muted">No results.</div>`;
      }

      const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
      if (ts) ts.textContent = `Updated: ${hh}:${mm} UTC`;

      const ids = normalizedIds();
      const count = ids ? ids.split(',').filter(Boolean).length : 0;
      const cutoffBadge = ((applyTimeEl?.checked) && (shiftEndEl?.value))
        ? ` • Shift cutoff with buffer: ${parseDDHH(shiftEndEl.value)?.disp ?? ''}`
        : '';
      const modeTxt = Number(modeEl?.value||0)===0?'All':(Number(modeEl?.value||0)===1?'Filter':'Drill Down');
      if (summary) summary.textContent = `${count} airport(s) • Theme: ${document.body.classList.contains('theme-dark') ? 'dark' : 'light'} • Mode: ${modeTxt}${cutoffBadge}`;

      // Successful refresh → bump cycle + run scan
      refreshCycle += 1;
      runScan();

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