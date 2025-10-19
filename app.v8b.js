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
  const addOneEl   = $('#addOne');
  const remOneEl   = $('#remOne');
  const addBtn     = $('#addBtn');
  const remBtn     = $('#remBtn');
  const inlineMsg  = $('#inlineMsg');

  const ceilEl     = $('#ceil');
  const visEl      = $('#vis');
  const shiftEndEl = $('#shiftEnd');
  const applyTimeEl= $('#applyTime');
  const adverseEl  = $('#adverse');
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

  const modeEl     = $('#mode');     // 0..2 (All / Filter / Drill Down)
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

  // ===== UTC clock (aligned to minute) =====
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
    localStorage.setItem('ct_adv', adverseEl?.checked ? '1' : '0');
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
    if (adverseEl)   adverseEl.checked   = (sp.get('adv') ?? localStorage.getItem('ct_adv')) === '1';
    if (showMetarEl) showMetarEl.checked = (sp.get('m') ?? localStorage.getItem('ct_m')) !== '0';
    if (showTafEl)   showTafEl.checked   = (sp.get('t') ?? localStorage.getItem('ct_t')) !== '0';
    if (alphaEl)     alphaEl.checked     = (sp.get('a') ?? localStorage.getItem('ct_a')) === '1';
    if (filterEl)    filterEl.checked    = (sp.get('f') ?? localStorage.getItem('ct_f')) === '1';
    if (modeEl)      modeEl.value        = sp.get('mode') ?? localStorage.getItem('ct_mode') ?? '0';
    if (modeLabel && modeEl){
      modeLabel.textContent = ['All','Filter','Drill Down'][parseInt(modeEl.value,10) || 0];
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

  // ===== Mode handling (stable on auto-refresh, instant on slider) =====
  function readModeFromDOM(){
    if (modeEl) return parseInt(modeEl.value,10) || 0;
    if (filterEl && filterEl.checked) return 1;
    return 0;
  }
  let uiMode = readModeFromDOM(); // used by auto-refresh

  modeEl?.addEventListener('input', () => {
    uiMode = parseInt(modeEl.value,10) || 0;
    if (modeLabel) modeLabel.textContent = ['All','Filter','Drill Down'][uiMode];
    savePrefs();
    fetchAndRender(true); // instant re-render
  });

  // ===== Add / Remove one =====
  function toast(msg, ms=1800){
    if (!inlineMsg) return;
    inlineMsg.textContent = msg;
    inlineMsg.style.opacity = '1';
    setTimeout(()=>{ inlineMsg.style.opacity=''; }, ms);
  }
  addBtn?.addEventListener('click', (e)=>{
    e.preventDefault();
    const v = (addOneEl?.value || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{3,4}$/.test(v)) { toast('Enter a valid ICAO (3–4 chars)'); return; }
    const set = new Set(normalizedIds().split(',').filter(Boolean));
    set.add(v);
    if (idsEl) idsEl.value = Array.from(set).join(' ');
    toast(`${v} added`);
    savePrefs(); scheduleFetch();
  });
  remBtn?.addEventListener('click', (e)=>{
    e.preventDefault();
    const v = (remOneEl?.value || '').toUpperCase().trim();
    if (!v) { toast('Enter ICAO to remove'); return; }
    const arr = normalizedIds().split(',').filter(Boolean).filter(x=>x!==v);
    if (idsEl) idsEl.value = arr.join(' ');
    toast(`${v} removed`);
    savePrefs(); scheduleFetch();
  });

  // ===== Debounced control reactions =====
  let debounceT = null;
  function scheduleFetch(){ clearTimeout(debounceT); debounceT = setTimeout(()=>fetchAndRender(), 120); }
  form?.addEventListener('submit', (e) => { e.preventDefault(); savePrefs(); fetchAndRender(); });
  function controlsChanged(e){
    if (!e.target || !e.target.matches) return;
    if (e.target.matches('#theme,#ceil,#vis,#shiftEnd,#applyTime,#adverse,#showMetar,#showTaf,#alpha,#filter')){
      if (e.target.id === 'filter') uiMode = e.target.checked ? 1 : 0;
      savePrefs(); scheduleFetch();
    }
  }
  document.addEventListener('change', controlsChanged);
  document.addEventListener('input',  controlsChanged);

  // ===== Time filter helpers (TAF only; +3h buffer) =====
  const pad2 = (n) => String(n).padStart(2,'0');

  function parseDDHHWithBuffer(s){
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
    if (!a || !b) return 0;
    if (a.day !== b.day) return a.day > b.day ? 1 : -1;
    if (a.hour !== b.hour) return a.hour > b.hour ? 1 : (a.hour < b.hour ? -1 : 0);
    return 0;
  }

  // Prefer FM/TEMPO/BECMG/PROB; then TAF validity "…Z DDHH/DDHH"; fallback to any DDHH/DDHH
  function extractStartDDHHFromLine(txt){
    if (!txt) return null;

    // FM group: FMDDHHMM
    let m = txt.match(/\bFM(\d{2})(\d{2})\d{2}\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };

    // TEMPO/BECMG/PROBxx DDHH/DDHH
    m = txt.match(/\b(?:TEMPO|BECMG|PROB(?:30|40))\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };

    // TAF header validity right after issue time (…Z DDHH/DDHH)
    m = txt.match(/\bZ\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };

    // Fallback: any DDHH/DDHH token
    m = txt.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };

    return null;
  }

  // Classify TAF lines (adds 'after-shift' and mutes red hits in those lines)
  function applyShiftToTafHtml(tafHtml, cutoffDDHH, enabled){
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
          content = content.replace(/<span class="hit">/g,'').replace(/<\/span>/g,'');
        }
        return `<div class="${cls}">${content}</div>`;
      }
    );
  }

  // ===== NEW: METAR validation helpers =====
  function isMetarExpired(metarText) {
    if (!metarText) return false;

    // Extract DDHHMM from METAR (e.g., "KDEN 191953Z" -> "191953")
    const match = metarText.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
    if (!match) return false;

    const day = parseInt(match[1], 10);
    const hour = parseInt(match[2], 10);
    const minute = parseInt(match[3], 10);

    if (day < 1 || day > 31 || hour > 23 || minute > 59) return false;

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const currentDay = now.getUTCDate();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    // Construct METAR date (assume current month)
    let metarDate = new Date(Date.UTC(currentYear, currentMonth, day, hour, minute));

    // Handle month rollover
    if (day > currentDay + 15) {
      // METAR is likely from previous month
      metarDate = new Date(Date.UTC(currentYear, currentMonth - 1, day, hour, minute));
    } else if (day < currentDay - 15) {
      // METAR is likely from next month
      metarDate = new Date(Date.UTC(currentYear, currentMonth + 1, day, hour, minute));
    }

    const ageInMs = now - metarDate;
    const ageInHours = ageInMs / (1000 * 60 * 60);

    return ageInHours > 1;
  }

  function checkMissingMetarElements(metarText) {
    if (!metarText) return true; // If no text, consider it missing elements

    // Fixed regex patterns to properly match METAR elements
    const hasWinds = /\b(\d{3}|VRB)\d{2}(G\d{2})?KT\b|\bCALM\b/.test(metarText);
    const hasVisibility = /\b(P?\d+SM|\d+\/\d+SM)\b/.test(metarText);
    const hasSkyConditions = /\b(FEW|SCT|BKN|OVC|CLR|CLEAR|SKC|VV|CAVOK)\d*\b/.test(metarText);
    const hasTemperature = /\b(M?\d{2})\/(M?\d{2})?\b/.test(metarText);
    const hasAltimeter = /\bA\d{4}\b/.test(metarText);

    return !(hasWinds && hasVisibility && hasSkyConditions && hasTemperature && hasAltimeter);
  }

  function prependMetarLabel(metarHTML, label) {
    const labelHTML = `<span style="color:white;font-weight:bold;background-color:red;">${label}</span> `;

    // Find the <pre class="wx"> element and prepend inside it
    return metarHTML.replace(
      /(<pre[^>]*class="[^"]*wx[^"]*"[^>]*>)/,
      `$1${labelHTML}`
    );
  }

  // ===== Adverse Wx detection & underline (first-found per airport) =====
  const ADV_TOKENS = ['TSRA','VCTS','FZRA','FZDZ','+SN','PSN','FZFG','GR','UP','TS']; // longest-first behavior via scan
  function findFirstAdverseToken(text){
    if (!text) return null;
    for (let i=0;i<ADV_TOKENS.length;i++){
      const tok = ADV_TOKENS[i];
      const idx = text.indexOf(tok);
      if (idx === -1) continue;
      const left  = idx === 0 ? '' : text[idx-1];
      const right = text[idx + tok.length] || '';
      const leftOK  = !/[A-Z0-9+]/.test(left);
      const rightOK = !/[A-Z0-9]/.test(right);
      if (leftOK && rightOK) return tok;
    }
    return null;
  }
  function underlineOnce(innerHTML, token, state){
    if (!token || state.done) return innerHTML;
    const re = new RegExp(`(^|[^A-Z0-9+])(${token.replace(/[+]/g,'\\+')})(?![A-Z0-9])`);
    const out = innerHTML.replace(re, (m, g1, g2) => {
      state.done = true;
      return `${g1}<span class="adv">${g2}</span>`;
    });
    return out;
  }
  function underlineOnceInTafLine(lineEl, token, state){
    if (!token || state.done || lineEl.classList.contains('after-shift')) return false;
    const before = lineEl.innerHTML;
    lineEl.innerHTML = underlineOnce(before, token, state);
    return before !== lineEl.innerHTML;
  }

  const containsHit = (html) => /class="hit"/.test(html || '');

  // Build filtered TAF fragment fast (DOM-based)
  function buildTafFragmentWithUnderlineOnce(tafHTML, {mode, adverseOn, advMarkState}){
    const wrapper = document.createElement('div');
    wrapper.innerHTML = tafHTML;
    const lines = wrapper.querySelectorAll('.taf-line');

    let keptAny = false;
    let hadTrigger = false;

    lines.forEach(line => {
      const isAfter = line.classList.contains('after-shift');
      const text = line.textContent || '';
      const hasHit = line.querySelector('.hit') !== null;

      let hasAdv = false;
      if (adverseOn && !isAfter) {
        const tok = findFirstAdverseToken(text);
        if (tok) {
          // underline only if not already underlined anywhere in this airport
          hasAdv = underlineOnceInTafLine(line, tok, advMarkState);
          // Even if already underlined elsewhere, still treat as adverse (trigger)
          if (!hasAdv) hasAdv = true;
        }
      }

      const keep = (mode !== 2) || (!isAfter && (hasHit || hasAdv));
      if (!keep) { line.remove(); return; }

      if (!isAfter && (hasHit || hasAdv)) hadTrigger = true;
      keptAny = true;
    });

    const frag = document.createDocumentFragment();
    Array.from(wrapper.childNodes).forEach(n => frag.appendChild(n));
    return { frag, keptAny, hadTrigger };
  }

  function currentMode(){ return uiMode; }

  // ===== Render (optimized) =====
  function renderPayload(data){
    const rows = (data && Array.isArray(data.results)) ? data.results : [];
    if (!rows.length) { board.innerHTML = `<div class="muted">No results.</div>`; return; }

    let list = rows.slice();
    if (alphaEl?.checked) list.sort((a,b)=>(a.icao||'').localeCompare(b.icao||''));

    const showM = !!(showMetarEl?.checked);
    const showT = !!(showTafEl?.checked);
    const mode  = currentMode();
    const cutoff = parseDDHHWithBuffer(shiftEndEl?.value);
    const adverseOn = !!(adverseEl?.checked);
    const applyShift = !!(applyTimeEl?.checked);

    const pageFrag = document.createDocumentFragment();

    for (const r of list){
      const icao = r.icao || '';
      const metarAvailable = !!r.metar;
      const tafAvailable   = !!r.taf;

      let metarHTML = metarAvailable ? (r.metar.html || '') : '';
      let tafHTML   = tafAvailable   ? (r.taf.html   || '') : '';

      // 1) TAF shift classification first
      tafHTML = applyShiftToTafHtml(tafHTML, cutoff, applyShift);

      // 2) Airport-wide "first-found" underline state
      let advMarkState = { done:false };

      // METAR trigger & underline (METAR is always current)
      let metarTrigger = false;
      let hasExpired = false;
      let hasMissingElements = false;

      // NEW: Check for expired METAR and missing elements (ALWAYS, regardless of mode)
      if (metarAvailable) {
        const metarRaw = r.metar?.raw || r.metar?.html || '';
        const metarText = metarRaw.toString();

        // Check if METAR is expired
        if (isMetarExpired(metarText)) {
          metarHTML = prependMetarLabel(metarHTML, 'Expired');
          hasExpired = true;
          metarTrigger = true;
        }

        // Check for missing elements
        if (checkMissingMetarElements(metarText)) {
          // Only add "Missing Element" if not already marked as "Expired"
          if (!hasExpired) {
            metarHTML = prependMetarLabel(metarHTML, 'Missing Element');
          }
          hasMissingElements = true;
          metarTrigger = true;
        }

        // Original trigger checks
        if (!metarTrigger) {
          metarTrigger = containsHit(metarHTML);
        }

        if (adverseOn && !metarTrigger) {
          const tok = findFirstAdverseToken(metarText);
          if (tok) {
            metarHTML = underlineOnce(metarHTML, tok, advMarkState);
            metarTrigger = true;
          }
        }
      } else {
        // NEW: No METAR available is a trigger in Filter and Drill Down modes
        if (mode === 1 || mode === 2) {
          metarTrigger = true;
        }
      }

      // 3) Build TAF (DOM) and determine TAF trigger
      let tafFrag = null, tafKept = false, tafTrigger = false;
      if (tafAvailable) {
        const { frag, keptAny, hadTrigger } = buildTafFragmentWithUnderlineOnce(
          tafHTML, { mode, adverseOn, advMarkState }
        );
        tafFrag = frag; tafKept = keptAny; tafTrigger = hadTrigger;
      }

      const airportIsTrigger = !!(metarTrigger || tafTrigger);

      // Filter/Drill Down: hide non-triggers
      if ((mode === 1 || mode === 2) && !airportIsTrigger) continue;

      // ---- Render this airport ----
      const station = document.createElement('div');
      station.className = 'station';

      if (showM){
        if (metarAvailable && metarHTML) {
          const d = document.createElement('div');
          d.innerHTML = metarHTML;
          station.appendChild(d.firstElementChild || d);
        } else {
          // NEW: Highlight "No METARs found" in Filter and Drill Down modes
          const d = document.createElement('div');
          d.className = 'muted not-found';
          if (mode === 1 || mode === 2) {
            d.innerHTML = `<span style="color:white;font-weight:bold;background-color:red;">No METARs found for ${icao}</span>`;
          } else {
            d.textContent = `No METARs found for ${icao}`;
          }
          station.appendChild(d);
        }
      }

      if (showT){
        if (tafAvailable){
          if (mode === 2 && !tafKept) {
            // In drill-down, if nothing kept after pruning, omit TAF block
          } else if (tafFrag) {
            if (showM && metarAvailable) {
              const sep = document.createElement('div');
              sep.className = 'drill-sep';
              sep.style.marginTop='6px';
              station.appendChild(sep);
            }
            const block = document.createElement('div');
            block.appendChild(tafFrag);
            station.appendChild(block);
          }
        } else {
          const d = document.createElement('div');
          d.className = 'muted not-found';
          d.textContent = `No TAFs found for ${icao}`;
          station.appendChild(d);
        }
      }

      pageFrag.appendChild(station);
    }

    board.innerHTML = '';
    board.appendChild(pageFrag);
  }

  // ===== Fetch + render =====
  async function fetchAndRender(quiet=false){
    const ids = normalizedIds();
    const mode = currentMode();
    const params = new URLSearchParams({
      ids,
      ceil: ceilEl?.value || '700',
      vis:  visEl?.value  || '2',
      metar: showMetarEl?.checked ? '1' : '0',
      taf:   showTafEl?.checked   ? '1' : '0',
      alpha: alphaEl?.checked     ? '1' : '0',
      filter: mode === 1 ? 'trigger' : 'all',   // backend filter for Filter mode only
    });

    if (!quiet){ summary && (summary.textContent='Loading…'); spin && (spin.style.display='inline-block'); err && (err.style.display='none', err.textContent=''); }
    try{
      const res = await fetch(`${DATA_URL}?${params}`, { method:'GET', mode:'cors' });
      if (!res.ok) throw new Error(`Data API ${res.status} ${res.statusText}`);
      const data = await res.json();

      requestAnimationFrame(() => renderPayload(data));

      const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
      if (ts) ts.textContent = `Updated: ${hh}:${mm} UTC`;

      const count = ids ? ids.split(',').filter(Boolean).length : 0;
      const cutoff = parseDDHHWithBuffer(shiftEndEl?.value);
      const cutoffDisp = (applyTimeEl?.checked && shiftEndEl?.value)
        ? ` • Shift cutoff +3h: ${cutoff?.disp ?? ''}`
        : '';
      if (summary){
        const modeNames = ['All','Filter','Drill Down'];
        summary.textContent = `${count} airport(s) • Theme: ${document.body.classList.contains('theme-dark') ? 'dark' : 'light'} • Mode: ${modeNames[mode] || 'All'}${cutoffDisp}${adverseEl?.checked ? ' • Adverse Wx: ON' : ''}`;
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

  // ===== Auto-refresh every 60s =====
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
