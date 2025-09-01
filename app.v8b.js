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
  const adverseEl  = $('#adverse');       // NEW
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
    localStorage.setItem('ct_adv', adverseEl?.checked ? '1' : '0'); // NEW
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

  // ===== Add / Remove one (fixed) =====
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
    savePrefs(); fetchAndRender();
  });
  remBtn?.addEventListener('click', (e)=>{
    e.preventDefault();
    const v = (remOneEl?.value || '').toUpperCase().trim();
    if (!v) { toast('Enter ICAO to remove'); return; }
    const arr = normalizedIds().split(',').filter(Boolean).filter(x=>x!==v);
    if (idsEl) idsEl.value = arr.join(' ');
    toast(`${v} removed`);
    savePrefs(); fetchAndRender();
  });

  // Submit on click/Enter
  form?.addEventListener('submit', (e) => { e.preventDefault(); savePrefs(); fetchAndRender(); });

  // React to control changes
  function controlsChanged(e){
    if (!e.target || !e.target.matches) return;
    if (e.target.matches('#theme,#ceil,#vis,#shiftEnd,#applyTime,#adverse,#showMetar,#showTaf,#alpha,#filter,#mode')){
      savePrefs(); fetchAndRender();
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
    hour += 3;
    if (hour >= 24) { hour -= 24; day += 1; }
    if (day > 31) day = 31;
    return { day, hour, disp: `${pad2(day)}${pad2(hour)}` };
  }
  function ddhhCompare(a, b){
    if (!a || !b) return 0;
    if (a.day !== b.day) return a.day > b.day ? 1 : -1;
    if (a.hour !== b.hour) return a.hour > b.hour ? 1 : (a.hour < b.hour ? -1 : 0);
    return 0;
  }
  function extractStartDDHHFromLine(txt){
    if (!txt) return null;
    let m = txt.match(/\bFM(\d{2})(\d{2})\d{2}\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    m = txt.match(/\b(?:TEMPO|BECMG|PROB(?:30|40))\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    if (m) return { day: parseInt(m[1],10), hour: parseInt(m[2],10) };
    return null;
  }
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
  function stripAfterShiftLines(tafHtml){
    return tafHtml.replace(/<div class="taf-line[^"]*\bafter-shift\b[^"]*">[\s\S]*?<\/div>/g, '');
  }

  // ===== Adverse Wx detection/marking =====
  // Ordered longest-first to avoid partial matches (e.g., TSRA before TS)
  const ADV_TOKENS = ['TSRA','VCTS','FZRA','FZDZ','+SN','PSN','FZFG','GR','UP','TS'];
  const ADV_RE = new RegExp(
    '(?<![A-Z0-9+])(' + ADV_TOKENS.map(t => t.replace(/[+]/g,'\\+')).join('|') + ')(?![A-Z0-9])',
    'g'
  );

  function markAdverse(html){
    if (!html) return { html, hasAdv:false };
    const out = html.replace(ADV_RE, '<span class="adv">$1</span>');
    const has = /class="adv"/.test(out);
    return { html: out, hasAdv: has };
  }
  const containsAdv = (html) => /class="adv"/.test(html || '');
  const containsHit = (html) => /class="hit"/.test(html || '');

  // Mode: 0=All, 1=Filter triggers, 2=Drill Down
  function currentMode(){
    if (modeEl) return parseInt(modeEl.value,10) || 0;
    if (filterEl && filterEl.checked) return 1;
    return 0;
  }

  // ===== Render =====
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

    let html = '';
    for (const r of list){
      const icao = r.icao || '';
      const metarAvailable = !!r.metar;
      const tafAvailable   = !!r.taf;

      let metarHTML = metarAvailable ? (r.metar.html || '') : '';
      let tafHTML   = tafAvailable   ? (r.taf.html   || '') : '';

      // Apply TAF shift filter (TAF only)
      tafHTML = applyShiftToTafHtml(tafHTML, cutoff, !!(applyTimeEl?.checked));

      // Mark adverse tokens (both METAR & TAF) — visual underline + blue
      let metarAdv = { html: metarHTML, hasAdv:false };
      let tafAdv   = { html: tafHTML,   hasAdv:false };
      if (adverseOn){
        metarAdv = markAdverse(metarHTML);
        tafAdv   = markAdverse(tafHTML);
        metarHTML = metarAdv.html;
        tafHTML   = tafAdv.html;
      }

      // For Drill Down keep only TAF lines with either server hits OR adverse tokens
      if (mode === 2 && tafAvailable && showT){
        tafHTML = tafHTML.replace(
          /<div class="taf-line[^"]*">([\s\S]*?)<\/div>/g,
          (full, inner) => {
            const keep = /class="hit"/.test(inner) || (adverseOn && /class="adv"/.test(inner));
            return keep ? full : '';
          }
        );
      }

      // Trigger determination:
      // - METAR: server hit OR adverse token (both always current)
      // - TAF: server hit OR adverse token, but **not** after-shift
      const tafBeforeCut = stripAfterShiftLines(tafHTML);
      const tafActive = containsHit(tafBeforeCut) || (adverseOn && containsAdv(tafBeforeCut));
      const metarActive = containsHit(metarHTML) || (adverseOn && containsAdv(metarHTML));
      const isTriggerNow = !!(tafActive || metarActive);

      // Filter / Drill Down: hide non-triggers completely
      if ((mode === 1 || mode === 2) && !isTriggerNow) continue;

      // Build output for this airport
      if (showM){
        if (metarAvailable && metarHTML) html += metarHTML + '\n';
        else html += `<div class="muted">No METARs found for ${escapeHtml(icao)}</div>\n`;
      }

      if (showT){
        if (tafAvailable){
          if (tafHTML.trim()) html += tafHTML + '\n'; // omit if empty after pruning
        } else {
          html += `<div class="muted">No TAFs found for ${escapeHtml(icao)}</div>\n`;
        }
      }

      html += '<br/>';
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
      filter: currentMode() === 1 ? 'trigger' : 'all',
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
        summary.textContent = `${count} airport(s) • Theme: ${document.body.classList.contains('theme-dark') ? 'dark' : 'light'} • Mode: ${modeNames[currentMode()] || 'All'}${cutoffDisp}${adverseEl?.checked ? ' • Adverse Wx: ON' : ''}`;
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
