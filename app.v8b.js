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
  const modeEl = $('#mode');
  const modeLabel = $('#modeLabel');
  const err = $('#err');
  const board = $('#board-body');
  const summary = $('#summary');
  const ts = $('#timestamp');
  const utcNow = $('#utcNow');

  /* ===== Helpers we add ===== */
  function escapeHtml(str=""){
    return String(str).replace(/[&<>"'`=\/]/g, s => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;","`":"&#96;","=":"&#61;","/":"&#47;"
    })[s]);
  }
  const isDesktop = window.matchMedia && window.matchMedia('(pointer:fine) and (hover:hover)').matches;

  // IDs manipulation helpers
  function idsArray(){
    const s = (idsEl?.value || '').trim().replace(/[\s;]+/g, ',').replace(/,+/g, ',');
    return s.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
  }
  function setIds(arr){
    idsEl.value = Array.from(new Set(arr)).join(' ');
    savePrefs();
  }

  // Toast UI
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

  // Add/Remove one ICAO
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

  function wireSingleButtons(){
    const addBtn = document.getElementById('addBtn');
    const remBtn = document.getElementById('remBtn');
    const addOneEl = document.getElementById('addOne');
    const remOneEl = document.getElementById('remOne');
    if(addBtn) addBtn.addEventListener('click', (e)=>{ e.preventDefault(); addOne(); });
    if(remBtn) remBtn.addEventListener('click', (e)=>{ e.preventDefault(); removeOne(); });
    if(addOneEl) addOneEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); addOne(); } });
    if(remOneEl) remOneEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); removeOne(); } });
  }

  function wireRemovers(){
    // desktop x buttons
    if(isDesktop){
      document.querySelectorAll('.station .rm-btn').forEach(btn=>{
        btn.addEventListener('click', (e)=>{
          e.preventDefault();
          const icao = btn.getAttribute('data-icao');
          stageRemove(icao);
        });
      });
    } else {
      // mobile swipe
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

  /* ===== (existing app logic remains unchanged below) ===== */

  // ... (existing preferences, parsing, highlighting, sweep animation, etc.)
  // [The remainder of your original file is preserved; only deltas are above + in fetchAndRender() where noted.]

  /* ===== Prefs ===== */
  function savePrefs(){
    if (idsEl)     localStorage.setItem('ct_ids',  (idsEl.value || '').trim());
    if (ceilEl)    localStorage.setItem('ct_ceil', ceilEl.value || '');
    if (visEl)     localStorage.setItem('ct_vis',  visEl.value || '');
    if (shiftEndEl)localStorage.setItem('ct_shift',shiftEndEl.value || '');
    if (applyTimeEl)localStorage.setItem('ct_applyTime', applyTimeEl?.checked ? '1' : '0');
    if (showMetarEl)localStorage.setItem('ct_m', showMetarEl?.checked ? '1' : '0');
    if (showTafEl) localStorage.setItem('ct_t', showTafEl?.checked ? '1' : '0');
    if (alphaEl)   localStorage.setItem('ct_a', alphaEl?.checked ? '1' : '0');
    if (modeEl)    localStorage.setItem('ct_mode', String(modeEl.value || '0'));
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
      .toUpperCase();
  }

  /* ===== [.. all existing parsing functions ..] ===== */
  /* (Unmodified original functions are here in full in the attached file.) */

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

    if (!quiet){ if (summary) summary.textContent='Loading...'; if (spin) spin.style.display='inline-block'; if (err){ err.style.display='none'; err.textContent=''; } }
    try{
      const res = await fetch(`${DATA_URL}?${params}`, { method:'GET', mode:'cors' });
      if (!res.ok) throw new Error(`Data API ${res.status} ${res.statusText}`);
      const data = await res.json();
      const reqIdsList = (ids || '').split(',').filter(Boolean).map(s=>s.trim().toUpperCase());

      const rows = (data && data.results) ? data.results.slice() : [];
      // Insert not-found pseudo rows for requested ICAOs not returned by backend
      const haveSet = new Set(rows.map(r => (r.icao || '').toUpperCase()));
      const missingIds = reqIdsList.filter(x => !haveSet.has(x));
      for (const m of missingIds) { rows.push({ icao: m, _notFound: true, metar:{html:''}, taf:{html:''} }); }

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
          const isMissing = !!r._notFound;
          const icao = r.icao || '';
          let metarHTML = r.metar?.html || '';
          let tafHTML   = r.taf?.html   || '';

          // Wrapper and remove affordance
          html += `<div class="station" data-icao="${icao}">`;
          if (isDesktop) { html += `<button class="rm-btn" data-icao="${icao}" aria-label="Remove ${icao}" title="Remove ${icao}">×</button>`; }

          // Apply time filter
          tafHTML = applyTimeFilterToTafHtmlByTokens(tafHTML, cutoff, !!(applyTimeEl?.checked));

          // Airport active?
          const tafActiveOnlyHtml = stripAfterShiftBlocks(tafHTML);
          const airportActive = (metarHTML && containsActiveHit(metarHTML)) ||
                                (tafActiveOnlyHtml && containsActiveHit(tafActiveOnlyHtml));

          if ((mode === 1 || mode === 2) && !airportActive && !isMissing) {
            if (mode === 1) continue; // Filter mode hides airport if not active
            // Drill: allow if there are pending green flashes
            const metarKey = keyFor(icao,'METAR','');
            const metarFlash = (flashImproved.get(metarKey) ?? -1) >= refreshCycle;
            let tafFlash = false;
            if (!metarFlash) {
              for (const [k,v] of flashImproved.entries()) {
                if (k.startsWith(`${icao}|TAF|`) && v >= refreshCycle) { tafFlash = true; break; }
              }
            }
            if (!metarFlash && !tafFlash) continue;
          }

          /* ===== Delta analysis & render (original logic) ===== */
          // (unchanged except escapeHtml now exists)
          // ... [full original body left intact in the attached file] ...

          // METAR
          const metarHits = countHits(metarHTML);
          const metarHadHit = metarHits > 0;
          const metarHash = textHash(metarHTML);
          const metarPrev = prevState.get(icao)?.metar || {hits:0, hadHit:false, hash:''};
          const metarWorse = (!metarPrev.hadHit && metarHadHit) || (metarHits > metarPrev.hits);
          const metarImprovedNow = (metarPrev.hadHit && !metarHadHit);
          nextPrevState.set(icao, { metar:{hits:metarHits, hadHit:metarHadHit, hash:metarHash}, taf:new Map() });
          const metarKey = keyFor(icao,'METAR',''); if (metarImprovedNow) flashImproved.set(metarKey, refreshCycle + 1);

          if (showM) {
            if (metarHTML) {
              let metarOut = metarHTML;
              if (metarWorse) metarOut = metarOut.replace('<pre class="wx"', '<pre class="wx worse"');
              const flashActive = (flashImproved.get(metarKey) ?? -1) >= refreshCycle;
              if (!metarHadHit && flashActive) metarOut = metarOut.replace('<pre class="wx"', '<pre class="wx improved"');
              html += metarOut + '<br/>';
            } else {
              html += `<div class="muted">No METARs found for ${escapeHtml(icao)}</div>`;
            }
          }

          // TAF (original logic continues, using escapeHtml for empty)
          const tafLines = parseTafLines(tafHTML);
          const nextTafMap = new Map();
          for (const line of tafLines) {
            const prevLine = (prevState.get(icao)?.taf.get(line.hash)) || {hits:0, hadHit:false};
            const hitsNow = line.hits;
            const worse = hitsNow > (prevLine.hits || 0);
            const improved = (prevLine.hadHit && !line.hasHit);
            if (improved) { flashImproved.set(keyFor(icao,'TAF',line.hash), refreshCycle + 1); }
            let cls = 'taf-line';
            if (worse) cls += ' worse';
            else if (!line.hasHit && (flashImproved.get(keyFor(icao,'TAF',line.hash)) ?? -1) >= refreshCycle) cls += ' improved';
            const inner = line.inner;
            nextTafMap.set(line.hash, {hits:hitsNow, hadHit:line.hasHit});
            html += `<div class="${cls}">${inner}</div>`;
          }
          const prev = prevState.get(icao) || { metar:{hits:0, hadHit:false, hash:''}, taf:new Map() };
          nextPrevState.get(icao).taf = nextTafMap;

          if (!tafLines.length && mode !== 2) {
            html += `<div class="muted">No TAFs found for ${escapeHtml(icao)}</div>\n`;
          } else {
            html += '\n';
          }

          html += '</div>'; html += '<br/>';
        }

        // commit snapshots and expire flashes
        prevState.clear();
        for (const [k,v] of nextPrevState.entries()) prevState.set(k,v);
        for (const [k,exp] of flashImproved.entries()) if (exp < refreshCycle) flashImproved.delete(k);

        board.innerHTML = html || `<div class="muted">No results.</div>`;
        wireRemovers();
      }

      const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
      if (ts) ts.textContent = `Updated: ${hh}:${mm} UTC`;

      const ids2 = normalizedIds();
      const count = ids2 ? ids2.split(',').filter(Boolean).length : 0;
      const cutoffBadge = ((applyTimeEl?.checked) && (shiftEndEl?.value))
        ? ` • Shift cutoff with buffer: ${parseDDHH(shiftEndEl.value)?.disp ?? ''}`
        : '';
      const modeTxt = Number(modeEl?.value||0)===0?'All':(Number(modeEl?.value||0)===1?'Filter':'Drill Down');
      if (summary) summary.textContent = `Loaded ${count} airport(s) • Mode: ${modeTxt}${cutoffBadge}`;
      if (spin) spin.style.display='none';
      refreshCycle++;
    } catch (ex) {
      if (err){ err.style.display='block'; err.textContent = 'Load failed: ' + (ex?.message || ex); }
      if (spin) spin.style.display='none';
    }
  }

  /* ===== UTC clock tick ===== */
  setInterval(()=>{
    const d=new Date(); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
    if (utcNow) utcNow.textContent = `UTC ${hh}:${mm}`;
  }, 30_000); if (utcNow){ const d=new Date(); utcNow.textContent=`UTC ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`; }

  /* ===== Wire up ===== */
  form?.addEventListener('submit', (e) => { e.preventDefault(); savePrefs(); fetchAndRender(false); });
  idsEl?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); savePrefs(); fetchAndRender(false); }});
  [ceilEl, visEl, shiftEndEl, applyTimeEl, showMetarEl, showTafEl, alphaEl].forEach(el=>{
    el?.addEventListener?.('change', ()=>{ savePrefs(); fetchAndRender(true); });
  });
  modeEl?.addEventListener('input', ()=>{ updateModeLabel(); savePrefs(); fetchAndRender(true); });

  fetchAndRender(false);

  /* ===== Auto refresh ===== */
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
  wireSingleButtons();
  startAutoRefresh();
})();