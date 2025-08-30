// Show runtime errors in-page
window.addEventListener('error', (e) => {
  const el = document.getElementById('err');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = 'Script error: ' + (e.message || e.error || e.filename || 'unknown');
});

(function () {
  // ======= CONFIG =======
  const DATA_URL = "https://us-central1-handy-coil-469714-j2.cloudfunctions.net/process-weather-data-clean";

  // ======= DOM =======
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
  const modeEl = $('#mode');
  const modeLabel = $('#modeLabel');
  const err = $('#err');
  const board = $('#board-body');
  const summary = $('#summary');
  const ts = $('#timestamp');
  const utcNow = $('#utcNow');
  const spin = $('#spin');

  // ======= THEME (dark mode restored) =======
  const themeSel = document.getElementById('theme');
  function applyTheme(v){
    const b = document.body;
    b.classList.toggle('theme-dark', v === 'dark');
    b.classList.toggle('theme-light', v !== 'dark');
    localStorage.setItem('ct_theme', v);
  }
  (function initTheme(){
    const v = localStorage.getItem('ct_theme') || 'light';
    if (themeSel) themeSel.value = v;
    applyTheme(v);
    themeSel?.addEventListener('change', ()=> applyTheme(themeSel.value));
  })();

  // ======= UTIL =======
  function escapeHtml(str=""){
    return String(str).replace(/[&<>"'`=\/]/g, s => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;","`":"&#96;","=":"&#61;","/":"&#47;"
    })[s]);
  }
  const isDesktop = window.matchMedia && window.matchMedia('(pointer:fine) and (hover:hover)').matches;

  // Parse "DDHH" (Zulu) into Date + display text
  function parseDDHH(v){
    v = String(v || '').trim();
    if (!/^\d{4}$/.test(v)) return null;
    const dd = parseInt(v.slice(0,2), 10);
    const hh = parseInt(v.slice(2), 10);
    if (dd < 1 || dd > 31 || hh < 0 || hh > 23) return null;
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const day = Math.min(dd, daysInMonth);
    const dt = new Date(Date.UTC(y, m, day, hh, 0, 0));
    return { dt, ts: dt.getTime(), disp: `${String(day).padStart(2,'0')}${String(hh).padStart(2,'0')}Z` };
  }

  function normalizedIds(){
    return ((idsEl?.value) || '')
      .trim()
      .replace(/[\s;]+/g, ',')
      .replace(/,+/g, ',')
      .toUpperCase();
  }
  function idsArray(){
    const s = normalizedIds();
    return s ? s.split(',').map(x=>x.trim()).filter(Boolean) : [];
  }
  function setIds(arr){
    idsEl.value = Array.from(new Set(arr)).join(' ');
    savePrefs();
  }

  function getLimits(){
    const ceil = parseInt((ceilEl?.value || '700').replace(/\D+/g,''), 10) || 700;
    const vis  = parseFloat(String(visEl?.value || '2')) || 2;
    return { ceil, vis };
  }

  // ======= PREFS =======
  function savePrefs(){
    if (idsEl)      localStorage.setItem('ct_ids',  (idsEl.value || '').trim());
    if (ceilEl)     localStorage.setItem('ct_ceil', ceilEl.value || '');
    if (visEl)      localStorage.setItem('ct_vis',  visEl.value || '');
    if (shiftEndEl) localStorage.setItem('ct_shift',shiftEndEl.value || '');
    if (applyTimeEl)localStorage.setItem('ct_applyTime', applyTimeEl?.checked ? '1' : '0');
    if (showMetarEl)localStorage.setItem('ct_m', showMetarEl?.checked ? '1' : '0');
    if (showTafEl)  localStorage.setItem('ct_t', showTafEl?.checked ? '1' : '0');
    if (alphaEl)    localStorage.setItem('ct_a', alphaEl?.checked ? '1' : '0');
    if (modeEl)     localStorage.setItem('ct_mode', String(modeEl.value || '0'));
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
  function updateModeLabel(){
    if (!modeEl || !modeLabel) return;
    const v = Number(modeEl.value || 0);
    modeLabel.textContent = v === 0 ? 'All' : (v === 1 ? 'Filter' : 'Drill Down');
  }
  loadPrefs();

  // ======= DELTA TRACKING =======
  const prevState = new Map(); // icao -> { metar:{hits,hadHit,hash}, taf: Map(hash -> {hits,hadHit}) }
  const flashImproved = new Map(); // key->expiry cycle
  let refreshCycle = 0;

  function textHash(s){
    let h=0, i=0, len=(s||'').length;
    while(i<len){ h = ((h<<5)-h) + s.charCodeAt(i++); h|=0; }
    return h.toString(36);
  }
  function countHits(html){
    if(!html) return 0;
    const m = html.match(/class\s*=\s*["']hit["']/g);
    return m ? m.length : 0;
  }
  function keyFor(icao, kind, id){ return `${icao}|${kind}|${id}`; }
  function containsActiveHit(html){ return /class\s*=\s*["']hit["']/.test(html||''); }

  // ======= Payload normalization =======
  function wrapMetarPre(txt){
    return `<pre class="wx">${escapeHtml(String(txt || '').trim())}</pre>`;
  }
  function normalizeMetar(metar){
    if (!metar) return '';
    if (typeof metar === 'string') return wrapMetarPre(metar);
    if (Array.isArray(metar))      return metar.length ? wrapMetarPre(metar.join('\n')) : '';
    if (typeof metar === 'object'){
      if (typeof metar.html === 'string' && metar.html.trim()) return metar.html;
      if (typeof metar.data === 'string' && metar.data.trim()) return wrapMetarPre(metar.data);
      if (typeof metar.text === 'string' && metar.text.trim()) return wrapMetarPre(metar.text);
    }
    return '';
  }
  function normalizeTaf(taf){
    if (!taf) return '';
    if (typeof taf === 'string') return taf;
    if (Array.isArray(taf))      return taf.join('\n');
    if (typeof taf === 'object'){
      if (typeof taf.html === 'string') return taf.html;
      if (typeof taf.data === 'string') return taf.data;
      if (typeof taf.text === 'string') return taf.text;
    }
    return '';
  }

  // ======= TAF helpers =======
  function parseTafLines(tafHTML){
    if(!tafHTML){ return []; }
    const lines = [];
    if (tafHTML.includes('class="taf-line"')) {
      const re = /<div class="taf-line">(.*?)<\/div>/gis;
      let m; 
      while ((m = re.exec(tafHTML)) !== null) {
        const inner = m[1];
        lines.push({
          hash: textHash(inner),
          inner,
          hits: countHits(inner),
          hasHit: /class\s*=\s*["']hit["']/.test(inner)
        });
      }
      if (lines.length) return lines;
    }
    const parts = String(tafHTML).split(/\r?\n/);
    for (const p of parts) {
      const inner = p.trim();
      if (!inner) continue;
      lines.push({
        hash: textHash(inner),
        inner,
        hits: countHits(inner),
        hasHit: /class\s*=\s*["']hit["']/.test(inner)
      });
    }
    return lines;
  }

  // Shift cutoff helpers (placeholder; backend may apply)
  function applyTimeFilterToTafHtmlByTokens(tafHTML, cutoff, enabled){
    if(!enabled || !cutoff || !tafHTML) return tafHTML;
    return tafHTML;
  }
  function stripAfterShiftBlocks(tafHTML){
    if(!tafHTML) return '';
    return tafHTML.replace(/<[^>]*class=["']after-shift["'][^>]*>.*?<\/[^>]+>/gis, '');
  }

  // ======= UI: Toast + Undo =======
  let toastTimer=null, pendingRemoval=null;
  function ensureToast(){
    let t = document.getElementById('toast');
    if(!t){
      t = document.createElement('div');
      t.id='toast';
      t.className='toast';
      t.style.display='none';
      t.innerHTML = '<span id="toastMsg"></span><button id="undoBtn" type="button">Undo</button>';
      document.body.appendChild(t);
    }
    return t;
  }
  function showToast(message, onTimeout){
    const t = ensureToast();
    const msg = t.querySelector('#toastMsg');
    msg.textContent = message;
    t.style.display='flex';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ hideToast(); onTimeout && onTimeout(); }, 3000);
  }
  function hideToast(){
    const t = document.getElementById('toast');
    if(t){ t.style.display='none'; }
    clearTimeout(toastTimer);
    toastTimer=null;
  }
  document.addEventListener('click', (e)=>{
    if(e.target && e.target.id==='undoBtn'){ 
      e.preventDefault(); undoRemoval(); 
    }
  });

  function stageRemove(icao){
    const prev = idsArray();
    const next = prev.filter(x=>x!==icao);
    const card = document.querySelector(`.station[data-icao="${icao}"]`);
    if(card) card.classList.add('pending-remove');
    pendingRemoval = { prev, next, icao };
    showToast(`Removed ${icao} — Undo`, ()=> finalizeRemoval());
  }
  function undoRemoval(){
    if(!pendingRemoval) return;
    setIds(pendingRemoval.prev);
    pendingRemoval=null;
    hideToast();
    fetchAndRender(true);
  }
  function finalizeRemoval(){
    if(!pendingRemoval) return;
    setIds(pendingRemoval.next);
    pendingRemoval=null;
    fetchAndRender(true);
  }

  // ======= Add/Remove one ICAO controls =======
  function addOne(){
    const el = document.getElementById('addOne');
    const msg = document.getElementById('inlineMsg');
    if(!el) return;
    const raw = (el.value||'').trim().toUpperCase();
    if(!raw){ return; }
    if(!/^[A-Z]{4}$/.test(raw)){ msg && (msg.textContent = raw + ' not found'); return; }
    const arr = idsArray();
    if(arr.includes(raw)){ msg && (msg.textContent = 'already added'); return; }
    arr.push(raw); setIds(arr); el.value=''; msg && (msg.textContent='');
    fetchAndRender(true);
  }
  function removeOne(){
    const el = document.getElementById('remOne');
    const msg = document.getElementById('inlineMsg');
    if(!el) return;
    const raw = (el.value||'').trim().toUpperCase();
    if(!raw){ return; }
    const arr = idsArray();
    if(!arr.includes(raw)){ msg && (msg.textContent = 'Not in list'); return; }
    msg && (msg.textContent='');
    stageRemove(raw);
    el.value='';
  }
  (function wireSingleButtons(){
    const addBtn = document.getElementById('addBtn');
    const remBtn = document.getElementById('remBtn');
    const addOneEl = document.getElementById('addOne');
    const remOneEl = document.getElementById('remOne');
    if(addBtn) addBtn.addEventListener('click', (e)=>{ e.preventDefault(); addOne(); });
    if(remBtn) remBtn.addEventListener('click', (e)=>{ e.preventDefault(); removeOne(); });
    if(addOneEl) addOneEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); addOne(); } });
    if(remOneEl) remOneEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); removeOne(); } });
  })();

  // ======= Refresh Sweep =======
  function runRefreshSweep(){
    const host = board;
    if(!host) return;
    const sweep = document.createElement('div');
    sweep.className = 'refresh-sweep';
    host.appendChild(sweep);
    requestAnimationFrame(()=>{
      sweep.style.transition = 'opacity 320ms ease, transform 320ms ease';
      sweep.style.opacity = '1';
      sweep.style.transform = 'translateY(0)';
      setTimeout(()=>{
        sweep.style.opacity='0';
        sweep.style.transform='translateY(10%)';
        setTimeout(()=>{ sweep.remove(); }, 260);
      }, 220);
    });
  }

  // ======= FETCH + RENDER =======
  async function fetchAndRender(quiet){
    const ids = normalizedIds();
    const mode = Number(modeEl?.value || 0); // 0=All,1=Filter,2=Drill
    const wantTrigger = mode !== 0;

    const params = new URLSearchParams({
      ids,
      ceil:  ceilEl?.value ?? '',
      vis:   visEl?.value ?? '',
      metar: showMetarEl?.checked ? '1' : '0',
      taf:   showTafEl?.checked   ? '1' : '0',
      alpha: alphaEl?.checked     ? '1' : '0',
      filter: wantTrigger ? 'trigger' : 'all' // align with control
    });

    if (!quiet){
      if (summary) summary.textContent='Loading...';
      if (spin) spin.style.display='inline-block';
      if (err){ err.style.display='none'; err.textContent=''; }
    }
    try{
      const res = await fetch(`${DATA_URL}?${params}`, { method:'GET', mode:'cors' });
      if (!res.ok) throw new Error(`Data API ${res.status} ${res.statusText}`);
      const data = await res.json();

      const reqIdsList = (ids || '').split(',').filter(Boolean).map(s=>s.trim().toUpperCase());
      const rows = (data && data.results) ? data.results.slice() : [];

      // Insert not-found pseudo rows for requested ICAOs missing from backend
      const haveSet = new Set(rows.map(r => (r.icao || '').toUpperCase()));
      const missingIds = reqIdsList.filter(x => !haveSet.has(x));
      for (const m of missingIds) { rows.push({ icao: m, _notFound: true, metar:null, taf:null, active:false }); }

      if (alphaEl?.checked) rows.sort((a,b)=>(a.icao||'').localeCompare(b.icao||''));

      const showM = !!(showMetarEl?.checked);
      const showT = !!(showTafEl?.checked);
      const cutoff = parseDDHH(shiftEndEl?.value);
      let html = '';
      const nextPrev = new Map();

      for (const r of rows) {
        const isMissing = !!r._notFound;
        const icao = (r.icao || '').toUpperCase();

        let metarHTML = normalizeMetar(r.metar);
        let tafHTML   = normalizeTaf(r.taf);

        // Prefer backend active; strict fallback if absent
        const backendActive = (typeof r.active === 'boolean')
          ? r.active
          : (Array.isArray(r.triggers) ? r.triggers.length > 0 : undefined);

        function strictClientActive(mHtml, tHtml){
          const { ceil, vis } = getLimits();
          const c = /<(?:span)[^>]*class=["']hit["'][^>]*>(BKN|OVC|VV)(\d{3})<\/span>/i.exec(mHtml||'');
          const v = /<(?:span)[^>]*class=["']hit["'][^>]*>(P6SM|(\d+(?:\.\d+)?)\s*SM)<\/span>/i.exec(mHtml||'');
          const ceilOk = c ? (parseInt(c[2],10) <= Math.floor(ceil/100)) : false;
          const visOk  = v ? (!!v[2] && parseFloat(v[2]) < vis) : false;
          return ceilOk || visOk || /class=["']hit["']/.test(stripAfterShiftBlocks(tHtml||''));
        }
        const airportActive = (backendActive !== undefined) ? backendActive : strictClientActive(metarHTML, tafHTML);

        // Client-side mode hiding (Filter/Drill)
        if ((mode === 1 || mode === 2) && !airportActive && !isMissing) {
          if (mode === 1) continue; // Filter hides inactive
          // Drill allows green-flash improvements
          const metarKey0 = keyFor(icao,'METAR','');
          let flash = (flashImproved.get(metarKey0) ?? -1) >= refreshCycle;
          if (!flash) {
            for (const [k,v] of flashImproved.entries()) {
              if (k.startsWith(`${icao}|TAF|`) && v >= refreshCycle) { flash = true; break; }
            }
          }
          if (!flash) continue;
        }

        // Apply (optional) time filter on TAF
        tafHTML = applyTimeFilterToTafHtmlByTokens(tafHTML, cutoff, !!(applyTimeEl?.checked));

        html += `<div class="station" data-icao="${escapeHtml(icao)}">`;
        if (isDesktop) { html += `<button class="rm-btn" data-icao="${escapeHtml(icao)}" aria-label="Remove ${escapeHtml(icao)}" title="Remove ${escapeHtml(icao)}">×</button>`; }

        // METAR delta
        const metarHits = countHits(metarHTML);
        const metarHadHit = metarHits > 0;
        const metarHash = textHash(metarHTML);
        const prev = prevState.get(icao) || { metar:{hits:0, hadHit:false, hash:''}, taf:new Map() };
        const prevMetar = prev.metar || {hits:0, hadHit:false, hash:''};
        const metarWorse = (!prevMetar.hadHit && metarHadHit) || (metarHits > prevMetar.hits);
        const metarImprovedNow = (prevMetar.hadHit && !metarHadHit);
        const metarKey = keyFor(icao,'METAR','');
        if (metarImprovedNow) flashImproved.set(metarKey, refreshCycle + 1);

        const nextTafMap = new Map();
        nextPrev.set(icao, { metar:{hits:metarHits, hadHit:metarHadHit, hash:metarHash}, taf: nextTafMap });

        // Render METAR
        if (showM) {
          if (isMissing) {
            html += `<div class="muted">${escapeHtml(icao)} not found</div><br/>`;
          } else if (metarHTML) {
            let out = metarHTML;
            if (metarWorse) out = out.replace('<pre class="wx"', '<pre class="wx worse"');
            const flashOn = (flashImproved.get(metarKey) ?? -1) >= refreshCycle;
            if (!metarHadHit && flashOn) out = out.replace('<pre class="wx"', '<pre class="wx improved"');
            html += out + '<br/>';
          } else {
            html += `<div class="muted">No METARs found for ${escapeHtml(icao)}</div><br/>`;
          }
        }

        // TAF
        if (showT) {
          const lines = parseTafLines(tafHTML);
          for (const line of lines) {
            const prevLine = (prev.taf.get(line.hash)) || {hits:0, hadHit:false};
            const worse = line.hits > (prevLine.hits || 0);
            const improved = (prevLine.hadHit && !line.hasHit);
            if (improved) { flashImproved.set(keyFor(icao,'TAF',line.hash), refreshCycle + 1); }
            const flashOn = (!line.hasHit) && ((flashImproved.get(keyFor(icao,'TAF',line.hash)) ?? -1) >= refreshCycle);
            let cls = 'taf-line';
            if (worse) cls += ' worse';
            else if (flashOn) cls += ' improved';
            html += `<div class="${cls}">${line.inner}</div>`;
            nextTafMap.set(line.hash, {hits: line.hits, hadHit: line.hasHit});
          }
          if (!lines.length && !isMissing) {
            html += `<div class="muted">No TAFs found for ${escapeHtml(icao)}</div>\n`;
          } else {
            html += '\n';
          }
        }

        html += `</div>\n<br/>`;
      }

      // Commit state & expire flashes
      prevState.clear();
      for (const [k,v] of nextPrev.entries()) prevState.set(k,v);
      for (const [k,exp] of flashImproved.entries()) if (exp < refreshCycle) flashImproved.delete(k);

      // Inject HTML
      board.innerHTML = rows.length ? (html || `<div class="muted">No results.</div>`) : `<div class="muted">No results.</div>`;
      wireRemovers();
      runRefreshSweep();

      // Badges/summary
      const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
      if (ts) ts.textContent = `Updated: ${hh}:${mm} UTC`;
      const ids2 = normalizedIds();
      const count = ids2 ? ids2.split(',').filter(Boolean).length : 0;
      const cutoffBadge = ((applyTimeEl?.checked) && (shiftEndEl?.value))
        ? ` • Shift cutoff with buffer: ${parseDDHH(shiftEndEl.value)?.disp ?? ''}`
        : '';
      const modeTxt = mode===0?'All':(mode===1?'Filter':'Drill Down');
      if (summary) summary.textContent = `Loaded ${count} airport(s) • Mode: ${modeTxt}${cutoffBadge}`;
      if (spin) spin.style.display='none';
      refreshCycle++;
    } catch (ex) {
      if (err){ err.style.display='block'; err.textContent = 'Load failed: ' + (ex?.message || ex); }
      if (spin) spin.style.display='none';
    }
  }

  // ======= UTC Clock =======
  function tickUTC(){
    const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
    if (utcNow) utcNow.textContent = `UTC ${hh}:${mm}`;
  }
  tickUTC();
  setInterval(tickUTC, 30_000);

  // ======= EVENTS =======
  form?.addEventListener('submit', (e) => { e.preventDefault(); savePrefs(); fetchAndRender(false); });
  idsEl?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); savePrefs(); fetchAndRender(false); }});
  [ceilEl, visEl, shiftEndEl, applyTimeEl, showMetarEl, showTafEl, alphaEl].forEach(el=>{
    el?.addEventListener?.('change', ()=>{ savePrefs(); fetchAndRender(true); });
  });
  modeEl?.addEventListener('input', ()=>{ updateModeLabel(); savePrefs(); fetchAndRender(true); });

  // ======= REMOVE affordances =======
  function wireRemovers(){
    if(isDesktop){
      document.querySelectorAll('.station .rm-btn').forEach(btn=>{
        btn.addEventListener('click', (e)=>{
          e.preventDefault();
          const icao = btn.getAttribute('data-icao');
          stageRemove(icao);
        });
      });
    } else {
      document.querySelectorAll('.station').forEach(card=>{
        let startX=0, dx=0, active=false;
        card.addEventListener('touchstart', (ev)=>{
          startX = ev.touches[0].clientX; active=true;
          card.classList.add('swiping');
        }, {passive:true});
        card.addEventListener('touchmove', (ev)=>{
          if(!active) return;
          dx = ev.touches[0].clientX - startX;
          if(dx<0) card.style.transform = `translateX(${dx}px)`;
        }, {passive:true});
        card.addEventListener('touchend', ()=>{
          card.classList.remove('swiping');
          if(dx < -60){
            const icao = card.getAttribute('data-icao'); 
            card.classList.add('swiped');
            stageRemove(icao);
          } else {
            card.style.transform='';
          }
          active=false; dx=0;
        });
      });
    }
  }

  // ======= BOOT =======
  fetchAndRender(false);

  // ======= AUTO REFRESH =======
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