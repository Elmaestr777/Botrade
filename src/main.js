
// --- Lab: Entrainer (AI surrogate) ---


// --- Lab: lecture et palmarès (localStorage) ---
const labTBody = document.getElementById('labTBody'); const labSummaryEl=document.getElementById('labSummary'); const labTFSelect=document.getElementById('labTFSelect');
// TF d'exécution du Lab: restitue la dernière valeur utilisée
const labSymbolSelect=document.getElementById('labSymbolSelect');
try{ const savedLabTf=localStorage.getItem('lab:tf'); if(savedLabTf && labTFSelect){ labTFSelect.value=savedLabTf; } }catch(_){ }
try{ const savedLabSym=localStorage.getItem('lab:sym'); if(savedLabSym && labSymbolSelect){ labSymbolSelect.value=savedLabSym; } }catch(_){ }
// Populate lab symbol list from chart symbol select
try{ if(labSymbolSelect && symbolSelect){ labSymbolSelect.innerHTML = symbolSelect.innerHTML; const savedLabSym=localStorage.getItem('lab:sym'); if(savedLabSym){ labSymbolSelect.value=savedLabSym; } else { labSymbolSelect.value = symbolSelect.value; } } }catch(_){ }
function labKey(sym, tf){ return `lab:results:${sym}:${tf}`; }
function readLabStorage(sym, tf){ try{ const s=localStorage.getItem(labKey(sym,tf)); return s? JSON.parse(s): []; }catch(_){ return []; } }
function writeLabStorage(sym, tf, arr){ try{ localStorage.setItem(labKey(sym,tf), JSON.stringify(arr)); }catch(_){} }
function palmaresKey(sym, tf){ return `lab:palmares:${sym}:${tf}`; }
function readPalmares(sym, tf){ try{ const s=localStorage.getItem(palmaresKey(sym,tf)); return s? JSON.parse(s): []; }catch(_){ return []; } }
function writePalmares(sym, tf, arr){ try{ localStorage.setItem(palmaresKey(sym,tf), JSON.stringify(arr)); localStorage.setItem(`lab:palmares:ts:${sym}:${tf}`, String(Date.now())); }catch(_){} }
function paramsKey(p){ if(!p) return ''; const o={ nol:p.nol, prd:p.prd, slInitPct:p.slInitPct, beAfterBars:p.beAfterBars, beLockPct:p.beLockPct, emaLen:p.emaLen, entryMode:p.entryMode, useFibRet:!!p.useFibRet, confirmMode:p.confirmMode, ent382:!!p.ent382, ent500:!!p.ent500, ent618:!!p.ent618, ent786:!!p.ent786, tp: Array.isArray(p.tp)? p.tp.slice(0,10): [] }; return JSON.stringify(o); }
// Dictionnaires (échantillons)
const DICT_FR=["étoile","forêt","rivière","montagne","océan","tempête","harmonie","nuage","pluie","lueur","zèbre","quartz","vallée","soleil","déluge","orage","saphir","primevère","cendre","ivoire"];
const DICT_EN=["river","stone","oak","ember","nova","zenith","aurora","lunar","solar","atlas","odyssey","phoenix","falcon","drake","comet","orbit","vertex","harbor","willow","meadow"];
const DICT_ES=["río","piedra","roble","brasa","nube","estrella","luna","sol","mar","tierra","tormenta","sierra","valle","bosque","isla","puerto","águila","toro","lince","cometa"];
const DICT_PL=["rzeka","kamień","dąb","iskra","gwiazda","księżyc","słońce","morze","ziemia","wiatr","burza","las","pustynia","wyspa","orzeł","żubr","ryś","kometa","polana","dolina"];
function randomName(){ const dicts=[DICT_FR,DICT_EN,DICT_ES,DICT_PL]; const d=dicts[Math.floor(Math.random()*dicts.length)]; return d[Math.floor(Math.random()*d.length)]; }
function uniqueNameFor(sym, tf, base){ const pal=readPalmares(sym, tf); const names=new Set(pal.map(x=>x.name)); let n=base; let k=2; while(names.has(n)){ n=base+"-"+k; k++; } return n; }
async function renderLabFromStorage(){
  const tf = labTFSelect? labTFSelect.value: (intervalSelect? intervalSelect.value:''), sym=(labSymbolSelect&&labSymbolSelect.value)||currentSymbol;
  const profSel = (document.getElementById('labProfile') && document.getElementById('labProfile').value) || (localStorage.getItem('labWeightsProfile')||'balancee');
  let arr=[]; let source='local';
  // Si Supabase est configuré, on lit UNIQUEMENT Supabase pour le palmarès
  if(window.SUPA && typeof SUPA.isConfigured==='function' && SUPA.isConfigured() && typeof SUPA.fetchPalmares==='function'){
    try{
      const supaArr = await SUPA.fetchPalmares(sym, tf, 25, profSel);
      if(Array.isArray(supaArr)) { arr = supaArr; source='Supabase'; }
    }catch(_){ /* en cas d'erreur Supabase, on laisse arr = [] */ }
  } else {
    // Fallback local uniquement si Supabase n'est pas configuré
    arr = readPalmares(sym, tf) || []; source='local';
  }
  window.labPalmaresCache = Array.isArray(arr)? arr.slice() : [];
  if(labSummaryEl) labSummaryEl.textContent = arr.length? `Palmarès: ${arr.length} stratégies (symbole ${symbolToDisplay(sym)} • TF ${tf}) — ${source}` : 'Aucun palmarès';
  if(!labTBody){ return; }
  if(!arr.length){ labTBody.innerHTML = '<tr><td colspan=\"16\">Aucune donnée</td></tr>'; return; }
  const rows=[]; let idx=1; const weights=getWeights(localStorage.getItem('labWeightsProfile')||'balancee');
  const sorted=arr.slice().sort((a,b)=> (b.score||scoreResult(b.res||{},weights)) - (a.score||scoreResult(a.res||{},weights)));
  try{ window.labPalmaresSorted = sorted.slice(); }catch(_){ }
  for(const r of sorted){
    const st=r.res||{}; const p=r.params||{};
    const pf=Number(st.profitFactor||0), pnl=Number(st.totalPnl||0), eq1=Number(st.equityFinal||0), cnt=Number(st.tradesCount||0), wr=Number(st.winrate||0), rr=Number(st.avgRR||0), mdd=Number(st.maxDDAbs||0);
    const paramsStr = `nol=${p.nol}, prd=${p.prd}, sl=${p.slInitPct}%, be=${p.beAfterBars}/${p.beLockPct}%, ema=${p.emaLen}`;
    const robust = Number.isFinite(r.score)? r.score : scoreResult(st, weights);
    const raw = scoreResult(st, weights);
    const penalty = Math.max(0, raw - robust);
    const pairDisp = symbolToDisplay(sym);
    const tfDisp = tf;
rows.push(`
<tr>
  <td>${idx}</td>
  <td>${pairDisp}</td>
  <td>${tfDisp}</td>
  <td style="text-align:left">${(r.name||'—')}</td>
  <td>${(r.gen||1)}</td>
  <td style="text-align:left">${paramsStr}</td>
  <td>${raw.toFixed(2)}</td>
  <td title="brut: ${raw.toFixed(2)} • pénalité: ${penalty.toFixed(2)}">${robust.toFixed(2)}</td>
  <td>${pf.toFixed(2)}</td>
  <td>${pnl.toFixed(0)}</td>
  <td>${eq1.toFixed(0)}</td>
  <td>${cnt}</td>
  <td>${wr.toFixed(1)}</td>
  <td>${Number.isFinite(rr)? rr.toFixed(2): '—'}</td>
  <td>${mdd.toFixed(0)}</td>
  <td style=\"white-space:nowrap;\"><button class=\"btn\" data-action=\"detail\" data-idx=\"${idx-1}\">Détail</button> <button class=\"btn\" data-action=\"apply\" data-idx=\"${idx-1}\" title=\"Appliquer cette stratégie à Heaven\">Appliquer</button></td>
</tr>`);
    idx++;
  }
  labTBody.innerHTML = rows.join('');
  // Wire actions on palmarès rows (Détail / Appliquer)
  if(!labTBody.dataset || labTBody.dataset.wiredDetail!=="1"){
    labTBody.addEventListener('click', (ev)=>{ try{ const t=ev && ev.target; const btn = t && t.closest && t.closest('button[data-action]'); if(!btn) return; const act=(btn.getAttribute('data-action')||'').toLowerCase(); if(act==='detail'){ handleLabDetailClick(ev); } else if(act==='apply'){ handleLabApplyClick(ev); } }catch(e){ __labDetailLog('tbody handler error: '+(e&&e.message?e.message:e)); } });
    labTBody.dataset.wiredDetail='1';
    __labDetailLog('tbody wired');
  }
}
// Global capture fallback (ensures it works even if tbody handler misses)
// Debug logger for Lab Detail
function __labDetailLog(msg){
  try{ console.debug('[lab:detail]', msg); }catch(_){ }
  try{ addLabLog && addLabLog(`[detail] ${msg}`); }catch(_){ }
}
// Ensure simple modal exists (create on the fly if missing)
function ensureLabSimpleModal(){
  let el=document.getElementById('labSimpleDetailModal');
  if(el) return el;
  try{
    el=document.createElement('div'); el.id='labSimpleDetailModal'; el.className='modal hidden'; el.setAttribute('aria-hidden','true');
    const backdrop=document.createElement('div'); backdrop.className='modal-backdrop'; backdrop.dataset.close='1'; el.appendChild(backdrop);
    const content=document.createElement('div'); content.className='modal-content small'; content.style.maxWidth='600px'; el.appendChild(content);
    const header=document.createElement('div'); header.className='modal-header'; content.appendChild(header);
    const h2=document.createElement('h2'); h2.textContent='Détail stratégie'; header.appendChild(h2);
    const close=document.createElement('button'); close.id='labSimpleDetailClose'; close.className='icon-btn'; close.setAttribute('aria-label','Fermer'); close.textContent='×'; header.appendChild(close);
    const bodyWrap=document.createElement('div'); bodyWrap.className='modal-body'; content.appendChild(bodyWrap);
    const body=document.createElement('div'); body.id='labSimpleDetailBody'; body.style.color='var(--muted)'; body.textContent='—'; bodyWrap.appendChild(body);
    document.body.appendChild(el);
    // wire close
    close.addEventListener('click', ()=> closeModalEl(el));
    el.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close){ closeModalEl(el); } });
  }catch(_){ }
  return el;
}
// Unified handler
function handleLabDetailClick(ev){
  let t = ev && ev.target;
  __labDetailLog('click start; target='+(t&&t.tagName)+' id='+(t&&t.id)+' class='+(t&&t.className));
  if(t && t.nodeType === 3 && t.parentElement) t = t.parentElement;
  let btn = null;
  if(t && typeof t.closest === 'function') btn = t.closest('button[data-action=\"detail\"]');
  if(!btn){ return; }
  const idxStr = (btn && btn.getAttribute && btn.getAttribute('data-idx')) || (btn && btn.dataset && btn.dataset.idx);
  const idx = Math.max(0, parseInt(idxStr||'0',10));
  __labDetailLog('detail button found; idx='+idx);
  try{
    const tfNow = labTFSelect? labTFSelect.value : (intervalSelect? intervalSelect.value:'');
    const symSel=(labSymbolSelect&&labSymbolSelect.value)||currentSymbol;
    let item=null;
    try{
      const arr = (window.labPalmaresSorted && Array.isArray(window.labPalmaresSorted))? window.labPalmaresSorted : (Array.isArray(window.labPalmaresCache)? (function(){ const w=getWeights(localStorage.getItem('labWeightsProfile')||'balancee'); return window.labPalmaresCache.slice().sort((a,b)=> (b.score||scoreResult(b.res||{},w)) - (a.score||scoreResult(a.res||{},w))); })() : []);
      item = arr[idx] || null;
    }catch(_){ item=null; }
    if(!item){ __labDetailLog('no item for idx'); return; }
    __labDetailLog('running backtest (full period) for '+(item.name||'strat'));
    // Lance l'analyse détaillée (période complète)
    openLabStrategyDetail(item, { symbol: symSel, tf: tfNow, full: true });
    if(ev){ try{ ev.stopPropagation(); ev.preventDefault(); }catch(_){ } }
  }catch(e){ __labDetailLog('error: '+(e&&e.message?e.message:e)); }
}
function handleLabApplyClick(ev){
  let t = ev && ev.target;
  if(t && t.nodeType === 3 && t.parentElement) t = t.parentElement;
  let btn = null;
  if(t && typeof t.closest === 'function') btn = t.closest('button[data-action=\"apply\"]');
  if(!btn){ return; }
  const idxStr = (btn && btn.getAttribute && btn.getAttribute('data-idx')) || (btn && btn.dataset && btn.dataset.idx);
  const idx = Math.max(0, parseInt(idxStr||'0',10));
  try{
    let item=null;
    try{
      const arr = (window.labPalmaresSorted && Array.isArray(window.labPalmaresSorted))? window.labPalmaresSorted : (Array.isArray(window.labPalmaresCache)? (function(){ const w=getWeights(localStorage.getItem('labWeightsProfile')||'balancee'); return window.labPalmaresCache.slice().sort((a,b)=> (b.score||scoreResult(b.res||{},w)) - (a.score||scoreResult(a.res||{},w))); })() : []);
      item = arr[idx] || null;
    }catch(_){ item=null; }
    if(!item || !item.params){ setStatus('Aucune stratégie'); return; }
    applyHeavenParams(item.params);
    setStatus('Paramètres appliqués à Heaven');
    try{ computeLabBenchmarkAndUpdate(); }catch(_){ }
    if(ev){ try{ ev.stopPropagation(); ev.preventDefault(); }catch(_){ } }
  }catch(e){ setStatus('Erreur application'); }
}


/* Chart BTC/USDC avec Lightweight Charts + données Binance + UI Heaven/Lab/Backtest/EMA (restauré) */

// --- Elements de base ---
let container = document.getElementById('chart');
if(!container){ try{ const el=document.createElement('div'); el.id='chart'; el.style.width='100%'; el.style.height='calc(100vh - 100px)'; document.body.appendChild(el); container = el; }catch(_){ /* fallback */ } }
const intervalSelect = document.getElementById('interval');
const symbolSelect = document.getElementById('symbol');
// Ensure Lab pair list mirrors chart symbol list (options only, selection stays independent)
function syncLabSymbolListFromChart(){
  try{
    if(!labSymbolSelect || !symbolSelect) return;
    let saved=null; try{ saved = localStorage.getItem('lab:sym'); }catch(_){ saved=null; }
    const prefer = saved || labSymbolSelect.value || (symbolSelect && symbolSelect.value) || '';
    labSymbolSelect.innerHTML = symbolSelect.innerHTML;
    // Restore preferred selection if it exists in the refreshed list; else fallback to chart current
    try{
      if(prefer){ labSymbolSelect.value = prefer; }
      if(!labSymbolSelect.value){ labSymbolSelect.value = (symbolSelect && symbolSelect.value) || ''; }
    }catch(_){ }
  }catch(_){ }
}
// Initial sync at startup (after symbolSelect is available)
syncLabSymbolListFromChart();
const titleEl = document.getElementById('pairTitle');
const statusEl = document.getElementById('status');
const gotoEndBtn = document.getElementById('gotoEndBtn');
// Status: main + background indicator
let __statusMain = '';
let __statusBg = '';
function setStatus(msg){ __statusMain = msg || ''; if(statusEl){ statusEl.textContent = __statusMain + (__statusBg ? (' • '+__statusBg) : ''); } }
function setBgStatus(msg){ __statusBg = msg || ''; if(statusEl){ statusEl.textContent = __statusMain + (__statusBg ? (' • '+__statusBg) : ''); } }
// Supabase config UI
const supaCfgBtn = document.getElementById('supaCfgBtn');
const supaModalEl = document.getElementById('supaModal');
const supaCloseBtn = document.getElementById('supaClose');
const supaSaveBtn = document.getElementById('supaSave');
const supaUrlInp = document.getElementById('supaUrl');
const supaAnonInp = document.getElementById('supaAnon');
const supaMsgEl = document.getElementById('supaMsg');

function setStatus(msg){ __statusMain = msg || ''; if(statusEl){ statusEl.textContent = __statusMain + (__statusBg ? (' • '+__statusBg) : ''); } }
function setBtTitle(text){ try{ const h=btProgressEl && btProgressEl.querySelector('.modal-header h2'); if(h) h.textContent = text||'Simulation'; }catch(_){ } }

let __lastLabTested = [];
function formatParamsBrief(p){ try{ return JSON.stringify(p||{}, (k,v)=> (typeof v==='number' && !isFinite(v)? null : v)); }catch(_){ return ''; } }
function formatParamsPretty(p){ try{ const core = `nol=${p.nol} • prd=${p.prd} • SL init=${p.slInitPct}% • BE=${p.beAfterBars}/${p.beLockPct}% • EMA=${p.emaLen}`; const entFlags = [p.ent382?'382':null,p.ent500?'500':null,p.ent618?'618':null,p.ent786?'786':null].filter(Boolean).join('/'); const entry = `Entrée: mode=${p.entryMode||'Both'} • FibRet=${p.useFibRet? 'Oui':'Non'} • Confirm=${p.confirmMode||'Bounce'}${entFlags? ' • Ent='+entFlags:''}`; const tpStr = (Array.isArray(p.tp)&&p.tp.length)? p.tp.slice(0,10).map(t=>{ const typ=t.type||'Fib'; if(typ==='Fib') return `F:${t.fib}`; if(typ==='Percent') return `P:${t.pct}%`; if(typ==='EMA') return `E:${t.emaLen}`; return typ; }).join(' ; ') : '—'; const slStr = (Array.isArray(p.sl)&&p.sl.length)? p.sl.slice(0,10).map(t=>{ const typ=t.type||'Percent'; if(typ==='Fib') return `F:${t.fib}`; if(typ==='Percent') return `P:${t.pct}%`; if(typ==='EMA') return `E:${t.emaLen}`; return typ; }).join(' ; ') : '—'; const tpLine = `TP ladder: ${tpStr}`; const slLine = `SL ladder: ${slStr}`; return `<div>${core}</div><div>${entry}</div><div>${tpLine}</div><div>${slLine}</div>`; }catch(_){ return ''; } }
function openEvalsModal(sym, tf){ try{ const tb=document.getElementById('evalsTBody'); const ctxEl=document.getElementById('evalsCtx'); if(!tb) return; const arr = Array.isArray(__lastLabTested)? __lastLabTested.slice(): []; const rows=[]; let idx=1; const sorted=arr.slice().sort((a,b)=> (b.score||0)-(a.score||0)); for(const it of sorted){ const st=it.metrics||it.res||{}; rows.push(`<tr><td>${idx}</td><td>${(it.score!=null? it.score.toFixed(2): '—')}</td><td>${(st.profitFactor===Infinity?'∞':(st.profitFactor||0).toFixed(2))}</td><td>${(st.totalPnl||0).toFixed(0)}</td><td>${st.tradesCount||0}</td><td>${(st.winrate||0).toFixed(1)}</td><td>${(Number.isFinite(st.avgRR)? st.avgRR.toFixed(2):'—')}</td><td style=\"text-align:left; white-space:normal; line-height:1.2;\">${formatParamsPretty(it.params||{})}</td></tr>`); idx++; }
  tb.innerHTML = rows.length? rows.join('') : '<tr><td colspan="8">—</td></tr>'; if(ctxEl) ctxEl.textContent = `${symbolToDisplay(sym)} • ${tf} — ${arr.length} évaluations`; openModalEl(document.getElementById('evalsModal')); }catch(_){ }
}
function exportEvalsCSV(){
  try{
    const arr=Array.isArray(__lastLabTested)? __lastLabTested: [];
    if(!arr.length){ setStatus('Aucune évaluation'); return; }
    const DL = ';';
    function esc(v){ let s = (v==null? '': String(v)); if(s.includes('"')) s=s.replace(/"/g,'""'); if(s.includes(DL) || s.includes('\n')) s='"'+s+'"'; return s; }
    function tpColsHdr(){ const cols=[]; for(let i=1;i<=10;i++){ cols.push(`TP${i}_type`,`TP${i}_val`,`TP${i}_qty`,`TP${i}_beOn`,`TP${i}_trail_mode`,`TP${i}_trail_emaLen`,`TP${i}_trail_pct`,`TP${i}_SL_type`,`TP${i}_SL_val`,`TP${i}_SL_trail_mode`,`TP${i}_SL_trail_emaLen`,`TP${i}_SL_trail_pct`); } return cols; }
    function slColsHdr(){ const cols=[]; for(let i=1;i<=10;i++){ cols.push(`SL${i}_type`,`SL${i}_val`,`SL${i}_trail_mode`,`SL${i}_trail_emaLen`,`SL${i}_trail_pct`); } return cols; }
    const baseHdr = [
      'score','pf','totalPnl','trades','winrate','avgRR','maxDDAbs',
      'nol','prd','slInitPct','beAfterBars','beLockPct','emaLen',
      'entryMode','useFibRet','confirmMode','ent382','ent500','ent618','ent786',
      'tpCompound','tpCloseAllLast','tp1R'
    ];
    const header = baseHdr.concat(tpColsHdr()).concat(['slEnable']).concat(slColsHdr());
    let lines = ['\uFEFF'+header.join(DL)];
    for(const it of arr){
      const st=it.metrics||it.res||{}; const p=it.params||{};
      const row=[];
      row.push(Number.isFinite(it.score)? it.score.toFixed(2):'');
      row.push(st.profitFactor===Infinity? 'Infinity': (st.profitFactor??''));
      row.push(st.totalPnl??''); row.push(st.tradesCount??''); row.push(st.winrate??''); row.push(st.avgRR??''); row.push(st.maxDDAbs??'');
      row.push(p.nol??''); row.push(p.prd??''); row.push(p.slInitPct??''); row.push(p.beAfterBars??''); row.push(p.beLockPct??''); row.push(p.emaLen??'');
      row.push(p.entryMode??''); row.push(p.useFibRet??''); row.push(p.confirmMode??''); row.push(p.ent382??''); row.push(p.ent500??''); row.push(p.ent618??''); row.push(p.ent786??'');
      row.push(p.tpCompound??''); row.push(p.tpCloseAllLast??''); row.push(p.tp1R??'');
      const tp = Array.isArray(p.tp)? p.tp.slice(0,10):[];
      for(let i=0;i<10;i++){
        const t = tp[i]||{}; const typ=t.type||'';
        const val = (typ==='Fib')? (t.fib??t.value??'') : (typ==='Percent'? (t.pct??t.value??'') : (typ==='EMA'? (t.emaLen??'') : ''));
        const qty = (t.qty!=null)? t.qty : '';
        const beOn = t.beOn? 1:'';
        const tr = t.trail||{}; const trMode = tr.mode||''; const trEL = tr.emaLen??''; const trPct = tr.pct??'';
        const sl = t.sl||{}; const slTyp=sl.type||''; const slVal = (slTyp==='Fib')? (sl.fib??sl.value??'') : (slTyp==='Percent'? (sl.pct??sl.value??'') : (slTyp==='EMA'? (sl.emaLen??'') : ''));
        const slTr = (sl.trail||{}); const slTrMode=slTr.mode||''; const slTrEL=slTr.emaLen??''; const slTrPct=slTr.pct??'';
        row.push(typ,val,qty,beOn,trMode,trEL,trPct,slTyp,slVal,slTrMode,slTrEL,slTrPct);
      }
      row.push(p.slEnable??'');
      const sl = Array.isArray(p.sl)? p.sl.slice(0,10):[];
      for(let i=0;i<10;i++){
        const s = sl[i]||{}; const slTyp=s.type||''; const slVal=(slTyp==='Fib')? (s.fib??s.value??'') : (slTyp==='Percent'? (s.pct??s.value??'') : (slTyp==='EMA'? (s.emaLen??'') : ''));
        const slTr=(s.trail||{}); const slTrMode=slTr.mode||''; const slTrEL=slTr.emaLen??''; const slTrPct=slTr.pct??'';
        row.push(slTyp, slVal, slTrMode, slTrEL, slTrPct);
      }
      lines.push(row.map(esc).join(DL));
    }
    const csv = lines.join('\r\n');
    const blob=new Blob([csv], {type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`evals_${currentSymbol}_${(labTFSelect&&labTFSelect.value)||currentInterval}.csv`; a.click();
  }catch(_){ }
}
function symbolToDisplay(sym){ if(!sym) return '—'; return sym.endsWith('USDC')? sym.slice(0,-4)+'/USDC' : sym; }
function updateTitle(sym){ if(titleEl){ titleEl.textContent = symbolToDisplay(sym); } }
function updateWatermark(){ try{ chart.applyOptions({ watermark: { visible:true, color: isDark()? 'rgba(229,231,235,0.20)' : 'rgba(17,24,39,0.12)', text: symbolToDisplay(currentSymbol), fontSize:34, horzAlign:'left', vertAlign:'top' } }); }catch(_){ } }

let currentSymbol = (symbolSelect && symbolSelect.value) || 'BTCUSDC';
let currentInterval = (localStorage.getItem('chart:tf')) || ((intervalSelect && intervalSelect.value) || '1h');
try{ if(intervalSelect){ intervalSelect.value = currentInterval; } }catch(_){}

function isDark(){ return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }

// --- Chart ---
const chart = LightweightCharts.createChart(container, {
  width: container.clientWidth,
  height: container.clientHeight,
  layout: {
    background: { color: isDark() ? '#0b0f1a' : '#ffffff' },
    textColor: isDark() ? '#e5e7eb' : '#111827',
    fontSize: 12,
    fontFamily: 'Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  },
  grid: {
    vertLines: { color: isDark() ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)' },
    horzLines: { color: isDark() ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)' },
  },
  watermark: {
    visible: true,
    color: isDark() ? 'rgba(229,231,235,0.20)' : 'rgba(17,24,39,0.12)',
    text: symbolToDisplay(currentSymbol),
    fontSize: 34,
    horzAlign: 'left',
    vertAlign: 'top'
  },
  rightPriceScale: { borderVisible: true, borderColor: isDark() ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)' },
  timeScale: { borderColor: isDark() ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)', timeVisible: true, rightOffset: 10, shiftVisibleRangeOnNewBar: false, rightBarStaysOnScroll: false, lockVisibleTimeRangeOnResize: true },
});
const candleSeries = chart.addCandlestickSeries({ upColor:'#26a69a', downColor:'#ef5350', borderUpColor:'#26a69a', borderDownColor:'#ef5350', wickUpColor:'#26a69a', wickDownColor:'#ef5350' });
// Flexible right space control
try{
  const RIGHT_OFF_KEY='chart:rightOffset';
  let __rightOff = Math.max(0, parseInt(localStorage.getItem(RIGHT_OFF_KEY)||'10',10));
  function setRightOffset(v){
    __rightOff = Math.max(0, v|0);
    try{ chart.timeScale().applyOptions({ rightOffset: __rightOff }); localStorage.setItem(RIGHT_OFF_KEY, String(__rightOff)); }catch(_){ }
  }
  // Apply stored value at startup (overrides default option if needed)
  setRightOffset(__rightOff);
  // Ctrl+Molette (wheel) pour ajuster l'espace à droite dynamiquement
  if(container){ container.addEventListener('wheel', (e)=>{ try{ if(e && e.ctrlKey){ e.preventDefault(); setRightOffset(__rightOff + (e.deltaY<0? 1:-1)); } }catch(_){ } }, { passive:false }); }
  // Raccourcis: Alt+Flèche → / ←
  window.addEventListener('keydown', (e)=>{ try{ if(!e || !e.altKey) return; if(e.key==='ArrowRight'){ e.preventDefault(); setRightOffset(__rightOff+1); } else if(e.key==='ArrowLeft'){ e.preventDefault(); setRightOffset(__rightOff-1); } }catch(_){ } });
}catch(_){ }
const zzUpSeries = chart.addLineSeries({ color: '#00ff00', lineWidth: 2, priceScaleId: 'right' });
const zzDnSeries = chart.addLineSeries({ color: '#ff0000', lineWidth: 2, priceScaleId: 'right' });
let heavenCloseLine=null, heavenTrendLine=null; let heavenTPPriceLines=[];
// TP hit markers (circles)
let tpHitMarkers=[];
function clearTPHitMarkers(){ tpHitMarkers=[]; }
// Routing for multi-wallet live markers
let __mkRoutingSession=null;
function __pushMarkerToSession(sess, m){ try{ if(!sess) return; if(!sess.markers) sess.markers={ entries:[], tps:[], sls:[], bes:[] }; const arr = (m.shape==='circle')? sess.markers.tps : (m.shape==='cross')? sess.markers.sls : (m.shape==='square')? sess.markers.bes : sess.markers.entries; arr.push(m); }catch(_){ } }
function addTPHitMarker(time, dir){ try{ const col = dir==='long'? '#10b981' : '#ef4444'; const m={ time, position: dir==='long'?'aboveBar':'belowBar', color: col, shape:'circle' }; if(__mkRoutingSession){ __pushMarkerToSession(__mkRoutingSession, m); } else { tpHitMarkers.push(m); } }catch(_){ } }
// SL hit markers (crosses)
let slHitMarkers=[];
function clearSLHitMarkers(){ slHitMarkers=[]; }
function addSLHitMarker(time, dir){ try{ const col = dir==='long'? '#10b981' : '#ef4444'; const m={ time, position: dir==='long'?'belowBar':'aboveBar', color: col, shape:'cross' }; if(__mkRoutingSession){ __pushMarkerToSession(__mkRoutingSession, m); } else { slHitMarkers.push(m); } }catch(_){ } }
// BE hit markers (squares)
let beHitMarkers=[];
function clearBEHitMarkers(){ beHitMarkers=[]; }
function addBEHitMarker(time, dir){ try{ const col = dir==='long'? '#10b981' : '#ef4444'; const m={ time, position: dir==='long'?'belowBar':'aboveBar', color: col, shape:'square' }; if(__mkRoutingSession){ __pushMarkerToSession(__mkRoutingSession, m); } else { beHitMarkers.push(m); } }catch(_){ } }
// Live entry markers (arrows only for live mode)
let liveEntryMarkers=[];
function clearLiveEntryMarkers(){ liveEntryMarkers=[]; }
function addLiveEntryMarker(time, dir){ try{ const col = dir==='long'? '#10b981' : '#ef4444'; const m={ time, position: dir==='long'?'belowBar':'aboveBar', color: col, shape: (dir==='long'?'arrowUp':'arrowDown') }; if(__mkRoutingSession){ __pushMarkerToSession(__mkRoutingSession, m); } else { liveEntryMarkers.push(m); } }catch(_){ } }

// EMA/MA series
const ema21Series = chart.addLineSeries({ color:'#facc15', lineWidth: 1, priceScaleId: 'right' });
const ema34Series = chart.addLineSeries({ color:'#ffa500', lineWidth: 1, priceScaleId: 'right' });
const ema55Series = chart.addLineSeries({ color:'#ef4444', lineWidth: 1, priceScaleId: 'right' });
const ema200Series = chart.addLineSeries({ color: isDark() ? '#9ca3af' : '#111827', lineWidth: 1, priceScaleId: 'right' });
const ma5Series = chart.addLineSeries({ color:'#3b82f6', lineWidth: 1, priceScaleId: 'right' });
const ma8Series = chart.addLineSeries({ color:'#00ffff', lineWidth: 1, priceScaleId: 'right' });
const ma13Series = chart.addLineSeries({ color:'#22c55e', lineWidth: 1, priceScaleId: 'right' });

const ro = new ResizeObserver(entries=>{ for(const e of entries){ chart.resize(Math.floor(e.contentRect.width), Math.floor(e.contentRect.height)); try{ updateMkPositions(); }catch(_){ } } });
ro.observe(container);
try{ chart.timeScale().subscribeVisibleTimeRangeChange(()=>{ try{ updateMkPositions(); }catch(_){ } try{ const modeEl=document.getElementById('labRangeMode'); const labMode=modeEl&&modeEl.value; const open = !!(labModalEl && labModalEl.getAttribute && labModalEl.getAttribute('aria-hidden')==='false' && !labModalEl.classList.contains('hidden')); if(labMode==='visible' && open){ if(window.__labKpiRangeTimer){ try{ clearTimeout(window.__labKpiRangeTimer); }catch(_){ } } window.__labKpiRangeTimer = setTimeout(()=>{ try{ computeLabBenchmarkAndUpdate(); }catch(_){ } }, 300); } }catch(_){ } }); }catch(_){ }

// --- Data loading (REST + WS) ---
const BATCH_LIMIT = 1000; let candles=[]; let ws=null;
// Progressive history loading: fast first paint, then deep background fetch
const PRELOAD_BARS = 1000;        // bars for instant display
const BG_MAX_BARS = Infinity;     // upper bound for background history (max depth)
const CACHE_SAVE_BARS = 5000;     // persist last N bars per symbol/TF for instant next load
const LIVE_MAX_BARS = 200000;     // cap for in-memory candles during live updates; increase if needed
let __bgLoadToken = 0;            // cancels previous background loaders

function klinesCacheKey(symbol, interval){ return `klines:${symbol}:${interval}`; }
function loadKlinesFromCache(symbol, interval){ try{ const s=localStorage.getItem(klinesCacheKey(symbol, interval)); if(!s) return []; const arr=JSON.parse(s); if(Array.isArray(arr) && arr.length && arr[0].time){ return arr; } }catch(_){ } return []; }
function saveKlinesToCache(symbol, interval, arr){ try{ if(!Array.isArray(arr)||!arr.length) return; const slim = arr.slice(-CACHE_SAVE_BARS); localStorage.setItem(klinesCacheKey(symbol, interval), JSON.stringify(slim)); }catch(_){ } }

// --- FX: USDC -> EUR via Binance (EURUSDC)
let __usdcEurRate = null; let __usdcEurRateTs = 0;
function getUsdcEurRate(){ if(__usdcEurRate && (Date.now()-__usdcEurRateTs)<5*60*1000) return __usdcEurRate; const v=Number(localStorage.getItem('usdc:eurRate')); if(Number.isFinite(v)&&v>0) return v; return (__usdcEurRate!=null? __usdcEurRate : 0.93); }
async function refreshUsdcEurRate(force=false){ const now=Date.now(); if(!force && __usdcEurRate && (now-__usdcEurRateTs)<5*60*1000) return __usdcEurRate; try{ const res=await fetch('https://api.binance.com/api/v3/ticker/price?symbol=EURUSDC'); if(res.ok){ const d=await res.json(); const p=Number(d&&d.price); if(Number.isFinite(p)&&p>0){ __usdcEurRate = 1/p; __usdcEurRateTs = now; try{ localStorage.setItem('usdc:eurRate', String(__usdcEurRate)); localStorage.setItem('usdc:eurRateTs', String(__usdcEurRateTs)); }catch(_){ } return __usdcEurRate; } } }catch(_){ }
  try{ const res2=await fetch('https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT'); if(res2.ok){ const d2=await res2.json(); const p2=Number(d2&&d2.price); if(Number.isFinite(p2)&&p2>0){ __usdcEurRate = 1/p2; __usdcEurRateTs = now; try{ localStorage.setItem('usdc:eurRate', String(__usdcEurRate)); localStorage.setItem('usdc:eurRateTs', String(__usdcEurRateTs)); }catch(_){ } return __usdcEurRate; } } }catch(_){ }
  const saved=Number(localStorage.getItem('usdc:eurRate')); if(Number.isFinite(saved)&&saved>0){ __usdcEurRate=saved; __usdcEurRateTs=Number(localStorage.getItem('usdc:eurRateTs'))||0; return __usdcEurRate; }
  __usdcEurRate=0.93; __usdcEurRateTs=now; return __usdcEurRate; }
setTimeout(()=>{ refreshUsdcEurRate(false).catch(()=>{}); }, 0);
setInterval(()=>{ refreshUsdcEurRate(false).catch(()=>{}); }, 5*60*1000);

async function fetchKlinesBatch(symbol, interval, limit=BATCH_LIMIT, endTimeMs){
  const u = new URL('https://api.binance.com/api/v3/klines');
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('interval', interval);
  u.searchParams.set('limit', String(limit));
  if(endTimeMs) u.searchParams.set('endTime', String(endTimeMs));
  const res = await fetch(u.toString()); if(!res.ok) throw new Error('HTTP '+res.status);
  const raw = await res.json();
  const mapped = raw.map(k=>({ time: Math.floor(k[0]/1000), open:+k[1], high:+k[2], low:+k[3], close:+k[4] }));
  mapped.sort((a,b)=> a.time-b.time); return mapped;
}
async function fetchAllKlines(symbol, interval, max=5000){ let all=[]; let cursor=Date.now(); while(all.length<max){ setStatus(`Chargement... (${all.length}+)`); const need=Math.min(BATCH_LIMIT, max-all.length); const batch=await fetchKlinesBatch(symbol, interval, need, cursor); if(!batch.length) break; all=batch.concat(all); if(batch.length<need) break; cursor=batch[0].time*1000 - 1; } return all.slice(-max); }

async function backgroundExtendKlines(symbol, interval, token){
  try{
    if(!Array.isArray(candles) || !candles.length) return;
    let earliest = candles[0]?.time;
    let cursor = (earliest? earliest*1000 - 1 : Date.now());
    let total = candles.length;
    let lastUiUpdate = 0;
    while(token === __bgLoadToken && total < BG_MAX_BARS){
      const need = Math.min(BATCH_LIMIT, BG_MAX_BARS - total);
      const batch = await fetchKlinesBatch(symbol, interval, need, cursor);
      if(!batch || !batch.length) break;
      const filtered = batch.filter(b=> b.time < (earliest||Infinity));
      if(!filtered.length){
        // Nothing older than current earliest
        break;
      }
      candles = filtered.concat(candles);
      total = candles.length;
      earliest = candles[0].time;
      cursor = earliest*1000 - 1;
      // Throttled status + progressive series rehydrate to expose older bars
      const now = Date.now();
      if(now - lastUiUpdate > 600){
        setBgStatus(`hist: ${Math.round(total/1000)}k`);
        try{ candleSeries.setData(candles); updateEMAs(); renderLBC(); }catch(_){ }
        lastUiUpdate = now;
      }
      if(batch.length < need) break; // hit API boundary for now
      // Yield to UI
      await new Promise(r=> setTimeout(r, 0));
    }
    // Final push if still active: save cache, rehydrate series, preserve view, clear status
    if(token === __bgLoadToken){
      try{ candleSeries.setData(candles); updateEMAs(); renderLBC(); }catch(_){ }
      try{ saveKlinesToCache(symbol, interval, candles); }catch(_){ }
      setBgStatus('');
    }
  }catch(_){ /* silent */ }
}

function closeWs(){ try{ if(ws){ ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null; ws.close(); } }catch(_){} ws=null; }
function wsUrl(symbol, interval){ return `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`; }
function openWs(symbol, interval){ closeWs(); try{ ws=new WebSocket(wsUrl(symbol, interval)); }catch(e){ setStatus('WS erreur'); return; } ws.onopen=()=> setStatus('Temps réel'); ws.onmessage=(ev)=>{ try{ const msg=JSON.parse(ev.data); const k=(msg&&msg.k)||(msg&&msg.data&&msg.data.k); if(!k) return; const bar={ time:Math.floor(k.t/1000), open:+k.o, high:+k.h, low:+k.l, close:+k.c }; const last=candles[candles.length-1]; if(last && bar.time===last.time){ candles[candles.length-1]=bar; candleSeries.update(bar); } else if(!last || bar.time>last.time){ candles.push(bar); candleSeries.update(bar); if(candles.length>LIVE_MAX_BARS) candles=candles.slice(-LIVE_MAX_BARS); }
updateEMAs(); renderLBC(); if(typeof anyLiveActive==='function' && anyLiveActive()){ try{ multiLiveOnBar(bar); }catch(_){ } } else if(liveSession && liveSession.active){ try{ liveOnBar(bar); }catch(_){ } }
    }catch(_){ } }; ws.onerror=()=> setStatus('WS erreur'); ws.onclose=()=> {/* keep silent */}; }
async function load(symbol, interval){
  try{
    __bgLoadToken++;
    const token = __bgLoadToken;
    // Try cache for instant paint
    const cached = loadKlinesFromCache(symbol, interval);
    if(cached && cached.length){
      candles = cached;
      candleSeries.setData(candles);
      updateEMAs(); renderLBC();
    } else {
      setStatus('Chargement...');
    }
    // Ensure preload fetch (fresh)
    candles = await fetchAllKlines(symbol, interval, PRELOAD_BARS);
    candleSeries.setData(candles);
    setStatus('');
    updateEMAs(); renderLBC();
    try{ saveKlinesToCache(symbol, interval, candles); }catch(_){ }
    // Deep background extend to maximize history depth for Lab/Backtest
    backgroundExtendKlines(symbol, interval, token);
  }catch(e){ setStatus('Erreur chargement'); }
}

if(intervalSelect){ intervalSelect.addEventListener('change', ()=>{ currentInterval=intervalSelect.value; try{ localStorage.setItem('chart:tf', currentInterval); }catch(_){} updateWatermark(); closeWs(); load(currentSymbol, currentInterval).then(()=> openWs(currentSymbol, currentInterval)); }); }
if(symbolSelect){ symbolSelect.addEventListener('change', ()=>{ currentSymbol=symbolSelect.value; updateTitle(currentSymbol); updateWatermark(); closeWs(); load(currentSymbol, currentInterval).then(()=> openWs(currentSymbol, currentInterval)); }); }
if(gotoEndBtn){ gotoEndBtn.addEventListener('click', ()=>{ try{ const v=(window.__rightOff|0)||10; chart.timeScale().scrollToPosition(v, false); }catch(_){ } }); }
updateTitle(currentSymbol); updateWatermark(); load(currentSymbol, currentInterval).then(()=> openWs(currentSymbol, currentInterval));

// Wire Supabase config button/modal
(function(){ try{
  function hideSupaBtn(){ if(supaCfgBtn) supaCfgBtn.style.display='none'; }
  function showSupaBtn(){ if(supaCfgBtn) supaCfgBtn.style.display=''; }
  async function refreshSupaBtn(){ try{
    if(!supaCfgBtn) return;
    const source = (window.SUPA && typeof SUPA.configSource==='function')? SUPA.configSource() : 'localStorage';
    const isCfg = (window.SUPA && typeof SUPA.isConfigured==='function')? SUPA.isConfigured() : false;
    const locked = localStorage.getItem('supabase:locked')==='1';
    if((source==='static' && isCfg) || (locked && isCfg)) hideSupaBtn(); else showSupaBtn();
  }catch(_){ } }
  if(supaCfgBtn){ supaCfgBtn.addEventListener('click', ()=>{ try{
      if(supaUrlInp){ supaUrlInp.value = (window.SUPABASE_URL||'') || localStorage.getItem('supabase:url') || ''; }
      if(supaAnonInp){ supaAnonInp.value = (window.SUPABASE_ANON_KEY||'') || localStorage.getItem('supabase:anon') || ''; }
      if(supaMsgEl){ supaMsgEl.textContent=''; }
      openModalEl(supaModalEl);
    }catch(_){ } }); }
  if(supaCloseBtn){ supaCloseBtn.addEventListener('click', ()=> closeModalEl(supaModalEl)); }
  if(supaModalEl){ supaModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close) closeModalEl(supaModalEl); }); }
  if(supaSaveBtn){ supaSaveBtn.addEventListener('click', async ()=>{ try{
      const url=(supaUrlInp&&supaUrlInp.value||'').trim(); const anon=(supaAnonInp&&supaAnonInp.value||'').trim();
      if(!url||!anon){ if(supaMsgEl) supaMsgEl.textContent='URL et ANON requis'; return; }
      try{ localStorage.setItem('supabase:url', url); localStorage.setItem('supabase:anon', anon); }catch(_){ }
      if(supaMsgEl) supaMsgEl.textContent='Test de connexion...';
      let ok=false;
      try{ ok = !!(window.SUPA && typeof SUPA.testConnection==='function' ? (await SUPA.testConnection()) : false); }catch(_){ ok=false; }
      if(ok){ try{ localStorage.setItem('supabase:locked','1'); }catch(_){ }
        if(supaMsgEl) supaMsgEl.textContent='Connexion OK. Configuration enregistrée.';
        setTimeout(()=>{ closeModalEl(supaModalEl); refreshSupaBtn(); }, 600);
      } else {
        if(supaMsgEl) supaMsgEl.textContent='Échec de connexion. Vérifiez URL/clé.';
      }
    }catch(_){ } }); }
  refreshSupaBtn();
} catch(_){ } })();

// --- Modales Live / Lab / Backtest / Heaven ---
const liveOpenBtn = document.getElementById('liveOpen'); const liveModalEl = document.getElementById('liveModal'); const liveCloseBtn=document.getElementById('liveClose');
const labOpenBtn = document.getElementById('labOpen'); const labModalEl = document.getElementById('labModal'); const labCloseBtn=document.getElementById('labClose');
const btOpenBtn = document.getElementById('btRunVisible'); const btModalEl = document.getElementById('btModal'); const btCloseBtn=document.getElementById('btCloseModal');
const heavenCfgBtn = document.getElementById('heavenCfg'); const lbcModalEl = document.getElementById('lbcModal'); const lbcCloseBtn=document.getElementById('lbcClose');

// Lab inline panels (in Lab modal)
const labRunStatusEl = document.getElementById('labRunStatus');
const kpiScoreEl = document.getElementById('kpiScore');
const kpiPFEl = document.getElementById('kpiPF');
const kpiWinEl = document.getElementById('kpiWin');
const kpiDDEl = document.getElementById('kpiDD');
const labLogEl = document.getElementById('labLog');

function addLabLog(msg){ try{ if(!labLogEl) return; const t=new Date(); const hh=String(t.getHours()).padStart(2,'0'); const mm=String(t.getMinutes()).padStart(2,'0'); const ss=String(t.getSeconds()).padStart(2,'0'); const line=`[${hh}:${mm}:${ss}] ${msg}`; if(labLogEl.textContent==='—') labLogEl.textContent=line; else labLogEl.textContent += ("\n"+line); labLogEl.scrollTop = labLogEl.scrollHeight; }catch(_){ } }
function updateLabKpis(best){ try{ if(!best||!best.length){ if(kpiScoreEl) kpiScoreEl.textContent='—'; if(kpiPFEl) kpiPFEl.textContent='—'; if(kpiWinEl) kpiWinEl.textContent='—'; if(kpiDDEl) kpiDDEl.textContent='—'; return; } const top=best[0]; const st=top.res||{}; if(kpiScoreEl) kpiScoreEl.textContent = Number(top.score||0).toFixed(2); if(kpiPFEl) kpiPFEl.textContent = (st.profitFactor===Infinity? '∞' : Number(st.profitFactor||0).toFixed(2)); if(kpiWinEl) kpiWinEl.textContent = Number(st.winrate||0).toFixed(1)+'%'; if(kpiDDEl) kpiDDEl.textContent = Number(st.maxDDAbs||0).toFixed(0); }catch(_){ } }
function updateLabKpiFrom(score, res){ try{ if(kpiScoreEl) kpiScoreEl.textContent = Number(score||0).toFixed(2); if(kpiPFEl) kpiPFEl.textContent = (res.profitFactor===Infinity? '∞' : Number(res.profitFactor||0).toFixed(2)); if(kpiWinEl) kpiWinEl.textContent = Number(res.winrate||0).toFixed(1)+'%'; if(kpiDDEl) kpiDDEl.textContent = Number(res.maxDDAbs||0).toFixed(0); }catch(_){ } }

// Compute KPI benchmark: Heaven (current config) vs top Palmarès over Lab-selected period
async function computeLabBenchmarkAndUpdate(){
  try{
    const tfSel = (labTFSelect&&labTFSelect.value) || currentInterval;
    const symSel = (labSymbolSelect&&labSymbolSelect.value) || currentSymbol;
    let bars = candles;
    if(tfSel !== currentInterval || symSel !== currentSymbol){
      try{ bars = await fetchAllKlines(symSel, tfSel, 5000); }catch(_){ bars=candles; }
    }
    if(!bars || !bars.length){ if(kpiScoreEl) kpiScoreEl.textContent='—'; if(kpiPFEl) kpiPFEl.textContent='—'; if(kpiWinEl) kpiWinEl.textContent='—'; if(kpiDDEl) kpiDDEl.textContent='—'; return; }

    let from=null, to=null;
    const rangeMode=(document.getElementById('labRangeMode')&&document.getElementById('labRangeMode').value)||'visible';
    if(rangeMode==='dates'){
      const f=(document.getElementById('labFrom')&&document.getElementById('labFrom').value)||'';
      const t=(document.getElementById('labTo')&&document.getElementById('labTo').value)||'';
      from = f? Math.floor(new Date(f).getTime()/1000) : null;
      to = t? Math.floor(new Date(t).getTime()/1000) : null;
    } else if(rangeMode==='visible'){
      const r=getVisibleRange(); if(r){ from=r.from; to=r.to; }
    } else { from=null; to=null; }

    const idxFromTimeLocal=(bars,from,to)=>{ let s=0,e=bars.length-1; if(from!=null){ for(let i=0;i<bars.length;i++){ if(bars[i].time>=from){ s=i; break; } } } if(to!=null){ for(let j=bars.length-1;j>=0;j--){ if(bars[j].time<=to){ e=j; break; } } } return [s,e]; };
    const [sIdx,eIdx]=idxFromTimeLocal(bars, from, to);

    const conf={ startCap: Math.max(0, parseFloat((document.getElementById('labStartCap')&&document.getElementById('labStartCap').value)||'10000')), fee: Math.max(0, parseFloat((document.getElementById('labFee')&&document.getElementById('labFee').value)||'0.1')), lev: Math.max(1, parseFloat((document.getElementById('labLev')&&document.getElementById('labLev').value)||'1')), maxPct:100, base:'initial' };

    const p={ nol:lbcOpts.nol, prd:lbcOpts.prd, slInitPct:lbcOpts.slInitPct, beAfterBars:lbcOpts.beAfterBars, beLockPct:lbcOpts.beLockPct, emaLen:lbcOpts.emaLen, entryMode:lbcOpts.entryMode||'Both', useFibRet:!!lbcOpts.useFibRet, confirmMode:lbcOpts.confirmMode||'Bounce', ent382:!!lbcOpts.ent382, ent500:!!lbcOpts.ent500, ent618:!!lbcOpts.ent618, ent786:!!lbcOpts.ent786, tpEnable:!!lbcOpts.tpEnable, tp:Array.isArray(lbcOpts.tp)? lbcOpts.tp.slice(0,10):[], slEnable:!!lbcOpts.slEnable, sl:Array.isArray(lbcOpts.sl)? lbcOpts.sl.slice(0,10):[], tp1R:lbcOpts.tp1R };

    const resH = runBacktestSliceFor(bars, sIdx, eIdx, conf, p);
    const weights=getWeights(localStorage.getItem('labWeightsProfile')||'balancee');
    const scoreH = scoreResult(resH, weights);

    // Top palmarès (robust score if present; otherwise recompute)
    let palArr = Array.isArray(window.labPalmaresCache)? window.labPalmaresCache.slice() : [];
    if(!palArr.length && window.SUPA && typeof SUPA.fetchPalmares==='function'){
      try{ palArr = await SUPA.fetchPalmares(symSel, tfSel, 1); }catch(_){ palArr=[]; }
    }
    let palTop=null; if(Array.isArray(palArr) && palArr.length){ palTop = palArr.slice().sort((a,b)=> ((b.score!=null?b.score:scoreResult(b.res||{},weights)) - (a.score!=null?a.score:scoreResult(a.res||{},weights))) )[0]; }
    const palRes = palTop&&palTop.res? palTop.res : null;
    const palScore = palTop? (Number.isFinite(palTop.score)? palTop.score : (palRes? scoreResult(palRes, weights): NaN)) : NaN;

    const fmtPF=(v)=> v===Infinity? '∞' : (Number.isFinite(v)? Number(v).toFixed(2) : '—');
    const scStr = `Heaven: ${scoreH.toFixed(2)} • Palmarès: ${Number.isFinite(palScore)? palScore.toFixed(2): '—'}`;
    const pfStr = `Heaven: ${fmtPF(resH.profitFactor)} • Palmarès: ${fmtPF(palRes && palRes.profitFactor)}`;
    const winStr= `Heaven: ${Number(resH.winrate||0).toFixed(1)}% • Palmarès: ${((palRes && Number.isFinite(palRes.winrate))? Number(palRes.winrate).toFixed(1)+'%':'—')}`;
    const ddStr = `Heaven: ${Number(resH.maxDDAbs||0).toFixed(0)} • Palmarès: ${((palRes && Number.isFinite(palRes.maxDDAbs))? Number(palRes.maxDDAbs).toFixed(0):'—')}`;

    if(kpiScoreEl) kpiScoreEl.textContent = scStr;
    if(kpiPFEl) kpiPFEl.textContent = pfStr;
    if(kpiWinEl) kpiWinEl.textContent = winStr;
    if(kpiDDEl) kpiDDEl.textContent = ddStr;
  }catch(_){ }
}

function openModalEl(el){ if(!el) return; el.classList.remove('hidden'); el.setAttribute('aria-hidden','false'); try{ const z=String(bumpModalZ()); el.style.zIndex = z; const c=el.querySelector && el.querySelector('.modal-content'); if(c){ c.style.zIndex = String(bumpModalZ()); } }catch(_){ } }
function closeModalEl(el){ if(!el) return; el.classList.add('hidden'); el.setAttribute('aria-hidden','true'); }
if(liveOpenBtn&&liveModalEl) liveOpenBtn.addEventListener('click', ()=>{ try{ populateLiveWalletsUI(); }catch(_){ } openModalEl(liveModalEl); }); if(liveCloseBtn&&liveModalEl) liveCloseBtn.addEventListener('click', ()=> closeModalEl(liveModalEl)); if(liveModalEl) liveModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close) closeModalEl(liveModalEl); });
if(labOpenBtn&&labModalEl) labOpenBtn.addEventListener('click', async ()=>{ try{ openModalEl(labModalEl); try{ setupLabAdvUI(); }catch(_){ } await renderLabFromStorage(); await computeLabBenchmarkAndUpdate(); }catch(_){ } }); if(labCloseBtn&&labModalEl) labCloseBtn.addEventListener('click', ()=> closeModalEl(labModalEl)); if(labModalEl) labModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close) closeModalEl(labModalEl); });

if(btOpenBtn&&btModalEl) btOpenBtn.addEventListener('click', ()=> openModalEl(btModalEl)); if(btCloseBtn&&btModalEl) btCloseBtn.addEventListener('click', ()=> closeModalEl(btModalEl)); if(btModalEl) btModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close) closeModalEl(btModalEl); });
if(heavenCfgBtn&&lbcModalEl) heavenCfgBtn.addEventListener('click', ()=>{ try{ populateHeavenModal(); try{ populateHeavenSupaList(); }catch(__){} }catch(_){ } openModalEl(lbcModalEl); }); if(lbcCloseBtn&&lbcModalEl) lbcCloseBtn.addEventListener('click', ()=> closeModalEl(lbcModalEl)); if(lbcModalEl) lbcModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close) closeModalEl(lbcModalEl); });

// --- Heaven overlay (Line Break + ZigZag + options) ---
const emaToggleEl = document.getElementById('emaToggle'); const nolEl=document.getElementById('nolInput'); const toggleLBCEl=document.getElementById('toggleLBC');
const defaultLBC={ enabled:true, nol:3, prd:15, showTrend:true, trendUpColor:'#00ff00', trendDnColor:'#ff0000', showClose:true, showArrows:true, arrowOffsetPx:8, arrowSizePx:12, useZZDraw:true, zzUp:'#00ff00', zzDn:'#ff0000', useFibDraw:true, useFibRet:false, entryMode:'Both', confirmMode:'Bounce', ent382:true, ent500:true, ent618:true, ent786:false, slInitPct:2.0, slEnable:false, sl:[], tp1R:1.0, tpCompound:true, tpCloseAllLast:true, beEnable:false, beAfterBars:5, beLockPct:5.0, emaLen:55, tpEnable:true, tp:[] };
let lbcOpts = (()=>{ try{ const s=localStorage.getItem('lbcOptions'); return s? { ...defaultLBC, ...JSON.parse(s) } : { ...defaultLBC }; }catch(_){ return { ...defaultLBC }; } })();
// Migration guard: remove legacy tpAfterHit and ensure sane defaults
try{
  if(lbcOpts && Object.prototype.hasOwnProperty.call(lbcOpts, 'tpAfterHit')){ try{ delete lbcOpts.tpAfterHit; }catch(_){ lbcOpts.tpAfterHit=undefined; } }
  if(typeof lbcOpts.tpEnable==='undefined') lbcOpts.tpEnable=true;
  if(!Array.isArray(lbcOpts.tp)) lbcOpts.tp=[];
}catch(_){}
function saveLBCOpts(){ try{ localStorage.setItem('lbcOptions', JSON.stringify(lbcOpts)); }catch(_){ } }
function populateHeavenModal(){ try{
  if(typeof optEnabled!=='undefined' && optEnabled) optEnabled.checked=!!lbcOpts.enabled;
  if(typeof optNol!=='undefined' && optNol) optNol.value=String(lbcOpts.nol);
  if(typeof optShowTrend!=='undefined' && optShowTrend) optShowTrend.checked=!!lbcOpts.showTrend;
  if(typeof optTrendUp!=='undefined' && optTrendUp) optTrendUp.value=lbcOpts.trendUpColor||'#00ff00';
  if(typeof optTrendDn!=='undefined' && optTrendDn) optTrendDn.value=lbcOpts.trendDnColor||'#ff0000';
  if(typeof optUseZZDraw!=='undefined' && optUseZZDraw) optUseZZDraw.checked=!!lbcOpts.useZZDraw;
  if(typeof optPrd!=='undefined' && optPrd) optPrd.value=String(lbcOpts.prd);
  if(typeof optSLInitPct!=='undefined' && optSLInitPct) optSLInitPct.value=String(lbcOpts.slInitPct);
  const __optSLEnable=document.getElementById('optSLEnable'); if(__optSLEnable) __optSLEnable.checked=!!lbcOpts.slEnable;
  if(typeof optBEEnable!=='undefined' && optBEEnable) optBEEnable.checked=!!lbcOpts.beEnable;
  if(typeof optBEBars!=='undefined' && optBEBars) optBEBars.value=String(lbcOpts.beAfterBars);
  if(typeof optBELockPct!=='undefined' && optBELockPct) optBELockPct.value=String(lbcOpts.beLockPct);
  if(typeof optEMALen!=='undefined' && optEMALen) optEMALen.value=String(lbcOpts.emaLen);
  if(typeof optShowClose!=='undefined' && optShowClose) optShowClose.checked=!!lbcOpts.showClose;
  const optShowArrows=document.getElementById('optShowArrows'); if(optShowArrows) optShowArrows.checked=!!lbcOpts.showArrows;
  const optUseFibDraw=document.getElementById('optUseFibDraw'); if(optUseFibDraw) optUseFibDraw.checked=!!lbcOpts.useFibDraw;
  const optUseFibRet=document.getElementById('optUseFibRet'); if(optUseFibRet) optUseFibRet.checked=!!lbcOpts.useFibRet;
  const optConfirmMode=document.getElementById('optConfirmMode'); if(optConfirmMode) optConfirmMode.value=lbcOpts.confirmMode||'Bounce';
  const optEntryModeEl=document.getElementById('optEntryMode'); if(optEntryModeEl) optEntryModeEl.value=lbcOpts.entryMode||'Both';
  const optZZUp=document.getElementById('optZZUp'); if(optZZUp) optZZUp.value=lbcOpts.zzUp||'#00ff00';
  const optZZDn=document.getElementById('optZZDn'); if(optZZDn) optZZDn.value=lbcOpts.zzDn||'#ff0000';
  const optTPEnable=document.getElementById('optTPEnable'); if(optTPEnable) optTPEnable.checked=!!lbcOpts.tpEnable;
  const optTPCompound=document.getElementById('optTPCompound'); if(optTPCompound) optTPCompound.checked=!!lbcOpts.tpCompound;
  const optTPAllLast=document.getElementById('optTPAllLast'); if(optTPAllLast) optTPAllLast.checked=!!lbcOpts.tpCloseAllLast;
  const optArrowOffsetPx=document.getElementById('optArrowOffsetPx'); if(optArrowOffsetPx) optArrowOffsetPx.value=String((lbcOpts.arrowOffsetPx|0)||0);

  // Context for dynamic dropdown labels
  const pivAll=computePivots(candles, Math.max(2, lbcOpts.prd|0));
  const seg=getLastPivotSeg(pivAll); const A=seg?seg.a.price:null, B=seg?seg.b.price:null; const up=seg? (seg.dir==='up'):null; const move=(seg&&A!=null&&B!=null)? Math.abs(B-A):null;
  const fibRatios=[0,0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.382,1.414,1.618,2.0,2.236,2.618,3.0,3.618,4.236,5.0];
  function rebuildFibSelect(sel, current){ if(!sel) return; sel.innerHTML=''; for(const r of fibRatios){ const opt=document.createElement('option'); opt.value=String(r); let label=r.toFixed(3); if(seg && move!=null){ const px = up? (B + move*r) : (B - move*r); if(isFinite(px)) label += ` — ${px.toFixed(2)}`; }
      opt.textContent=label; sel.appendChild(opt); }
    if(current!=null){ sel.value=String(current); } }
  function emaCandidates(){ const out=[]; const add=(en,len)=>{ if(en && Number.isFinite(len)&&len>0) out.push(len|0); }; add(emaOpts.e21&&emaOpts.e21.en, emaOpts.e21&&emaOpts.e21.len); add(emaOpts.e34&&emaOpts.e34.en, emaOpts.e34&&emaOpts.e34.len); add(emaOpts.e55&&emaOpts.e55.en, emaOpts.e55&&emaOpts.e55.len); add(emaOpts.e200&&emaOpts.e200.en, emaOpts.e200&&emaOpts.e200.len); if(!out.length && Number.isFinite(lbcOpts.emaLen)) out.push(lbcOpts.emaLen|0); return Array.from(new Set(out)); }
  function rebuildEmaSelect(sel, current){ if(!sel) return; sel.innerHTML=''; const lens=emaCandidates(); for(const len of lens){ const opt=document.createElement('option'); opt.value=String(len); let label=`EMA ${len}`; try{ const ema=emaCalc(candles, Math.max(1, len|0)); const v=ema[ema.length-1]; if(isFinite(v)) label += ` — ${v.toFixed(2)}`; }catch(_){ }
      opt.textContent=label; sel.appendChild(opt); }
    if(current!=null){ sel.value=String(current); } }
function updateTPRow(i, t){
  const tSel=document.getElementById(`optTP${i}Type`);
  const vNum=document.getElementById(`optTP${i}R`);
  const vFib=document.getElementById(`optTP${i}Fib`);
  const vEma=document.getElementById(`optTP${i}Ema`);
  if(tSel){ const typ=tSel.value||'Fib'; // show/hide
    if(vNum) vNum.style.display = (typ==='Percent')? '' : 'none';
    if(vFib) vFib.style.display = (typ==='Fib')? '' : 'none';
    if(vEma) vEma.style.display = (typ==='EMA')? '' : 'none';
    if(typ==='Fib'){ rebuildFibSelect(vFib, (t&&t.fib!=null)? t.fib : (vFib&&vFib.value)); }
    else if(typ==='EMA'){ rebuildEmaSelect(vEma, (t&&t.emaLen!=null)? t.emaLen : (vEma&&vEma.value)); }
  }
  // Attached SL per TP
  const sSel=document.getElementById(`optTP${i}SLType`);
  const sNum=document.getElementById(`optTP${i}SLR`);
  const sFib=document.getElementById(`optTP${i}SLFib`);
  const sEma=document.getElementById(`optTP${i}SLEma`);
  const st=(t&&t.sl)||{};
  if(sSel){ const styp=sSel.value||'Percent';
    if(sNum) sNum.style.display = (styp==='Percent')? '' : 'none';
    if(sFib) sFib.style.display = (styp==='Fib')? '' : 'none';
    if(sEma) sEma.style.display = (styp==='EMA')? '' : 'none';
    if(styp==='Fib'){ rebuildFibSelect(sFib, (st&&st.fib!=null)? st.fib : (sFib&&sFib.value)); }
    else if(styp==='EMA'){ rebuildEmaSelect(sEma, (st&&st.emaLen!=null)? st.emaLen : (sEma&&sEma.value)); }
  }
  // Per-TP trailing UI (TP and attached SL)
  const trSel=document.getElementById(`optTP${i}TrailType`);
  const trEma=document.getElementById(`optTP${i}TrailEma`);
  const trPct=document.getElementById(`optTP${i}TrailPct`);
  if(trSel){
    if(trEma) trEma.style.display = (trSel.value==='ema')? '' : 'none';
    if(trPct) trPct.style.display = (trSel.value==='percent')? '' : 'none';
    if(trSel.value==='ema'){ rebuildEmaSelect(trEma, (t&&t.trail&&t.trail.emaLen!=null)? t.trail.emaLen : (trEma&&trEma.value)); }
  }
  const slTrSel=document.getElementById(`optTP${i}SLTrailType`);
  const slTrEma=document.getElementById(`optTP${i}SLTrailEma`);
  const slTrPct=document.getElementById(`optTP${i}SLTrailPct`);
  if(slTrSel){
    if(slTrEma) slTrEma.style.display = (slTrSel.value==='ema')? '' : 'none';
    if(slTrPct) slTrPct.style.display = (slTrSel.value==='percent')? '' : 'none';
    if(slTrSel.value==='ema'){ rebuildEmaSelect(slTrEma, (st&&st.trail&&st.trail.emaLen!=null)? st.trail.emaLen : (slTrEma&&slTrEma.value)); }
  }
}
  function updateSLRow(i, t){ const tSel=document.getElementById(`optSL${i}Type`); const vNum=document.getElementById(`optSL${i}R`); const vFib=document.getElementById(`optSL${i}Fib`); const vEma=document.getElementById(`optSL${i}Ema`); if(!tSel) return; const typ=tSel.value||'Percent';
    if(vNum) vNum.style.display = (typ==='Percent')? '' : 'none'; if(vFib) vFib.style.display = (typ==='Fib')? '' : 'none'; if(vEma) vEma.style.display = (typ==='EMA')? '' : 'none'; if(typ==='Fib'){ rebuildFibSelect(vFib, (t&&t.fib!=null)? t.fib : (vFib&&vFib.value)); }
    else if(typ==='EMA'){ rebuildEmaSelect(vEma, (t&&t.emaLen!=null)? t.emaLen : (vEma&&vEma.value)); } }

  const arr=lbcOpts.tp||[];
  for(let i=1;i<=10;i++){
    const t=arr[i-1]||{}; const tSel=document.getElementById(`optTP${i}Type`); const vNum=document.getElementById(`optTP${i}R`); const vFib=document.getElementById(`optTP${i}Fib`); const vEma=document.getElementById(`optTP${i}Ema`); const pPct=document.getElementById(`optTP${i}P`); const qPct=document.getElementById(`optTP${i}Qty`);
    if(tSel){ tSel.value=t.type||'Fib'; }
    if(vFib && (t.fib!=null)) vFib.value=String(t.fib);
    if(vNum && (t.pct!=null)) vNum.value=String(t.pct);
    if(vEma && (t.emaLen!=null)) vEma.value=String(t.emaLen);
    if(pPct && (t.value!=null)) pPct.value=String(t.value);
    if(qPct && (t.qty!=null)) qPct.value=String(t.qty);
    // attached SL & BE per TP
    const st=(t&&t.sl)||{}; const sSel=document.getElementById(`optTP${i}SLType`); const sNum=document.getElementById(`optTP${i}SLR`); const sFib=document.getElementById(`optTP${i}SLFib`); const sEma=document.getElementById(`optTP${i}SLEma`); const beOn=document.getElementById(`optTP${i}BEOn`);
    if(sSel){ sSel.value=st.type||'Percent'; }
    if(sFib && (st.fib!=null)) sFib.value=String(st.fib);
    if(sNum && (st.pct!=null)) sNum.value=String(st.pct);
    if(sEma && (st.emaLen!=null)) sEma.value=String(st.emaLen);
    if(beOn) beOn.checked = !!(t && t.beOn);
    // per-TP trailing defaults
    const trSel=document.getElementById(`optTP${i}TrailType`);
    const trEma=document.getElementById(`optTP${i}TrailEma`);
    const trPct=document.getElementById(`optTP${i}TrailPct`);
    if(trSel){ trSel.value = (t && t.trail && t.trail.mode) || 'none'; }
    if(trEma && t && t.trail && (t.trail.emaLen!=null)) trEma.value = String(t.trail.emaLen);
    if(trPct && t && t.trail && (t.trail.pct!=null)) trPct.value = String(t.trail.pct);
    // per-TP SL trailing defaults
    const slTrSel=document.getElementById(`optTP${i}SLTrailType`);
    const slTrEma=document.getElementById(`optTP${i}SLTrailEma`);
    const slTrPct=document.getElementById(`optTP${i}SLTrailPct`);
    if(slTrSel){ slTrSel.value = (st && st.trail && st.trail.mode) || 'none'; }
    if(slTrEma && st && st.trail && (st.trail.emaLen!=null)) slTrEma.value = String(st.trail.emaLen);
    if(slTrPct && st && st.trail && (st.trail.pct!=null)) slTrPct.value = String(st.trail.pct);
    updateTPRow(i, t);
    if(tSel && (!tSel.dataset || tSel.dataset.wired!=='1')){ tSel.addEventListener('change', ()=> updateTPRow(i, arr[i-1]||{})); if(!tSel.dataset) tSel.dataset={}; tSel.dataset.wired='1'; }
    if(sSel && (!sSel.dataset || sSel.dataset.wired!=='1')){ sSel.addEventListener('change', ()=> updateTPRow(i, arr[i-1]||{})); if(!sSel.dataset) sSel.dataset={}; sSel.dataset.wired='1'; }
    if(trSel && (!trSel.dataset || trSel.dataset.wired!=='1')){ trSel.addEventListener('change', ()=> updateTPRow(i, arr[i-1]||{})); if(!trSel.dataset) trSel.dataset={}; trSel.dataset.wired='1'; }
    if(slTrSel && (!slTrSel.dataset || slTrSel.dataset.wired!=='1')){ slTrSel.addEventListener('change', ()=> updateTPRow(i, arr[i-1]||{})); if(!slTrSel.dataset) slTrSel.dataset={}; slTrSel.dataset.wired='1'; }
  }
  const arrSL=lbcOpts.sl||[];
  for(let i=1;i<=10;i++){
    const t=arrSL[i-1]||{}; const tSel=document.getElementById(`optSL${i}Type`); const vNum=document.getElementById(`optSL${i}R`); const vFib=document.getElementById(`optSL${i}Fib`); const vEma=document.getElementById(`optSL${i}Ema`);
    if(tSel){ tSel.value=t.type||'Percent'; }
    if(vFib && (t.fib!=null)) vFib.value=String(t.fib);
    if(vNum && (t.pct!=null)) vNum.value=String(t.pct);
    if(vEma && (t.emaLen!=null)) vEma.value=String(t.emaLen);
    updateSLRow(i, t);
    if(tSel && (!tSel.dataset || tSel.dataset.wired!=='1')){ tSel.addEventListener('change', ()=> updateSLRow(i, arrSL[i-1]||{})); if(!tSel.dataset) tSel.dataset={}; tSel.dataset.wired='1'; }
  }
}catch(_){ } }
if(toggleLBCEl) toggleLBCEl.checked = !!lbcOpts.enabled; if(nolEl) nolEl.value=String(lbcOpts.nol);
if(toggleLBCEl) toggleLBCEl.addEventListener('change', ()=>{ lbcOpts.enabled=!!toggleLBCEl.checked; saveLBCOpts(); renderLBC(); try{ computeLabBenchmarkAndUpdate(); }catch(_){ } });
if(nolEl) nolEl.addEventListener('change', ()=>{ lbcOpts.nol=Math.max(1, parseInt(nolEl.value||'3')); saveLBCOpts(); renderLBC(); try{ computeLabBenchmarkAndUpdate(); }catch(_){ } });
const optArrowOffsetPx=document.getElementById('optArrowOffsetPx'); if(optArrowOffsetPx){ optArrowOffsetPx.addEventListener('change', ()=>{ lbcOpts.arrowOffsetPx=Math.max(0, parseInt(optArrowOffsetPx.value||'0')); saveLBCOpts(); renderLBC(); }); }

function computeLineBreakState(bars, nol){ const n=bars.length; if(!n) return {trend:[], level:[], flips:[]}; const trend=new Array(n).fill(0); const level=new Array(n).fill(null); const flips=[]; let t=bars[0].close>=bars[0].open?1:-1; let opens=[bars[0].open]; let closes=[bars[0].close]; for(let i=0;i<n;i++){ const c=bars[i].close; if(t===1){ const cnt=Math.min(nol, opens.length); const minUp=Math.min(...opens.slice(0,cnt), ...closes.slice(0,cnt)); if(c<minUp) t=-1; if(c>closes[0]||t===-1){ const o=(t===-1? opens[0]:closes[0]); opens.unshift(o); closes.unshift(c); } } else { const cnt=Math.min(nol, opens.length); const maxDn=Math.max(...opens.slice(0,cnt), ...closes.slice(0,cnt)); if(c>maxDn) t=1; if(c<closes[0]||t===1){ const o=(t===1? opens[0]:closes[0]); opens.unshift(o); closes.unshift(c); } } trend[i]=t; const cnt2=Math.min(nol, opens.length); const minUp2=Math.min(...opens.slice(0,cnt2), ...closes.slice(0,cnt2)); const maxDn2=Math.max(...opens.slice(0,cnt2), ...closes.slice(0,cnt2)); level[i]=(t===1? minUp2: maxDn2); if(i>0 && trend[i]!==trend[i-1]) flips.push(i); } return {trend, level, flips}; }
function computePivots(bars, prd){ const piv=[]; for(let i=prd;i<bars.length-prd;i++){ let isH=true, isL=true; for(let j=1;j<=prd;j++){ if(!(bars[i].high>bars[i-j].high && bars[i].high>bars[i+j].high)) isH=false; if(!(bars[i].low<bars[i-j].low && bars[i].low<bars[i+j].low)) isL=false; if(!isH&&!isL) break; } if(isH||isL) piv.push({ idx:i, time:bars[i].time, price: isH? bars[i].high : bars[i].low }); } return piv; }
function buildHeavenMarkers(bars, lb, pivAll){ const markers=[]; if(!bars||!bars.length) return markers; const longCol='#10b981', shortCol='#ef4444'; let pivIdx=-1; function advancePivotIdxTo(i){ while(pivIdx+1<pivAll.length && pivAll[pivIdx+1].idx<=i){ pivIdx++; } } function segAtIdx(){ if(pivIdx>=1){ const a=pivAll[pivIdx-1], b=pivAll[pivIdx]; return { a, b, dir: b.price>a.price?'up':'down' }; } return null; } let pendingFib=null; const useOrig = (lbcOpts.entryMode!=='Fib Retracement'); const useFib = (lbcOpts.useFibRet && lbcOpts.entryMode!=='Original'); for(let i=1;i<bars.length;i++){ advancePivotIdxTo(i); if(useOrig && lb.trend[i]!==lb.trend[i-1]){ const up = lb.trend[i]===1; markers.push({ time: bars[i].time, position: up? 'belowBar':'aboveBar', color: up? longCol:shortCol, shape: up? 'arrowUp':'arrowDown' }); if(useFib){ const seg=segAtIdx(); if(seg){ const A=seg.a.price, B=seg.b.price; const upSeg=seg.dir==='up'; const move=Math.abs(B-A); const levels=[]; if(lbcOpts.ent382) levels.push(upSeg? (B - move*0.382):(B + move*0.382)); if(lbcOpts.ent500) levels.push(upSeg? (B - move*0.5):(B + move*0.5)); if(lbcOpts.ent618) levels.push(upSeg? (B - move*0.618):(B + move*0.618)); if(lbcOpts.ent786) levels.push(upSeg? (B - move*0.786):(B + move*0.786)); pendingFib={ dir:(up?'long':'short'), levels, mode: lbcOpts.confirmMode||'Bounce' }; } }
    }
    if(useFib && pendingFib && pendingFib.levels && pendingFib.levels.length){ const bar=bars[i]; for(const lv of pendingFib.levels){ let ok=false; if(pendingFib.dir==='long'){ ok=(pendingFib.mode==='Touch')? (bar.low<=lv) : (bar.low<=lv && bar.close>lv); } else { ok=(pendingFib.mode==='Touch')? (bar.high>=lv) : (bar.high>=lv && bar.close<lv); } if(ok){ const up=pendingFib.dir==='long'; markers.push({ time: bars[i].time, position: up? 'belowBar':'aboveBar', color: up? longCol:shortCol, shape: up? 'arrowUp':'arrowDown' }); pendingFib=null; break; } } }
  }
  return markers; }
// Weights (Lab scoring)
const defaultWeights = { pf:25, wr:20, rr:15, pnl:15, eq:10, trades:5, dd:10 };
function weightsKey(profile){ return `lab:weights:${profile||'balancee'}`; }
function getWeights(profile){ try{ const s=localStorage.getItem(weightsKey(profile)); return s? { ...defaultWeights, ...JSON.parse(s) } : { ...defaultWeights }; }catch(_){ return { ...defaultWeights }; } }
function saveWeights(profile, w){ try{ localStorage.setItem(weightsKey(profile), JSON.stringify(w)); }catch(_){ } }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function scoreResult(st, w){ const pf=Number(st.profitFactor||0); const wr=Number(st.winrate||0); const rr=Number(st.avgRR||0); const pnl=Number(st.totalPnl||0); const eq=Number(st.equityFinal||0); const dd=Math.abs(Number(st.maxDDAbs||0)); const tr=Number(st.tradesCount||0);
  const pfS = pf===Infinity? 1 : clamp01(pf/3);
  const wrS = clamp01(wr/70);
  const rrS = clamp01(rr/2);
  const pnlS = pnl>0? (1 - 1/(1 + pnl/5000)) : 0;
  const eqS = eq>0? (1 - 1/(1 + eq/20000)) : 0;
  const trS = clamp01(tr/150);
  const ddS = 1 - clamp01(dd/5000);
  const totalW = w.pf+w.wr+w.rr+w.pnl+w.eq+w.trades+w.dd || 1;
  const s = (pfS*w.pf + wrS*w.wr + rrS*w.rr + pnlS*w.pnl + eqS*w.eq + trS*w.trades + ddS*w.dd) / totalW;
  return s*100; }
function buildZigZagData(piv){ const up=[], dn=[]; for(let k=1;k<piv.length;k++){ const a=piv[k-1], b=piv[k]; const upSeg=b.price>a.price; if(upSeg){ up.push({ time:a.time, value:a.price }); up.push({ time:b.time, value:b.price }); } else { dn.push({ time:a.time, value:a.price }); dn.push({ time:b.time, value:b.price }); } } return { up, dn }; }
function getLastPivotSeg(piv){ if(!piv || piv.length<2) return null; const a=piv[piv.length-2], b=piv[piv.length-1]; return { a, b, dir: b.price>a.price? 'up':'down' }; }
function clearTPPriceLines(){ for(const pl of heavenTPPriceLines){ try{ candleSeries.removePriceLine(pl);}catch(_){ } } heavenTPPriceLines=[]; }
function createTPLine(price, title, color){ try{ const pl=candleSeries.createPriceLine({ price, color: color||'#7c3aed', lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth:1, title }); heavenTPPriceLines.push(pl); }catch(_){ } }
function updateFibAndTPLines(piv){ clearTPPriceLines(); if(!candles.length){ return; } const seg=getLastPivotSeg(piv); if(!seg){ return; }
  const A=seg.a.price, B=seg.b.price; const up = seg.dir==='up'; const move = Math.abs(B - A); const C = candles[candles.length-1].close;
  // Basic Fib drawing
  if(lbcOpts.useFibDraw){ const fibs=[0.382,0.5,0.618]; for(const r of fibs){ const target = up? (B + move*r) : (B - move*r); createTPLine(target, `Fib ${r}`, '#6b7280'); } }
  // TP Ladder
  if(lbcOpts.tpEnable && Array.isArray(lbcOpts.tp) && lbcOpts.tp.length){ let n=1; for(const t of lbcOpts.tp){ if(n>10) break; const typ=(t.type||'Fib'); let price=null; if(typ==='Fib'){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)){ price = up? (B + move*r) : (B - move*r); } }
      else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)){ price = up? (C * (1 + p/100)) : (C * (1 - p/100)); } }
      else if(typ==='EMA'){ const len = Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v = ema[ema.length-1]; if(isFinite(v)){ price=v; } }
      if(price!=null){ createTPLine(price, `TP${n}`, '#7c3aed'); }
      n++; }
  }
}

function renderLBC(){ if(!lbcOpts.enabled){ zzUpSeries.setData([]); zzDnSeries.setData([]); if(heavenCloseLine){ candleSeries.removePriceLine(heavenCloseLine); heavenCloseLine=null; } if(heavenTrendLine){ candleSeries.removePriceLine(heavenTrendLine); heavenTrendLine=null; } clearTPPriceLines(); try{ candleSeries.setMarkers([]); }catch(_){ } return; }
  const lb = computeLineBreakState(candles, Math.max(1, lbcOpts.nol|0)); const piv = computePivots(candles, Math.max(2, lbcOpts.prd|0)); const {up, dn}=buildZigZagData(piv);
  zzUpSeries.applyOptions({ color: lbcOpts.zzUp || '#00ff00' }); zzDnSeries.applyOptions({ color: lbcOpts.zzDn || '#ff0000' });
  if(lbcOpts.useZZDraw){ zzUpSeries.setData(up); zzDnSeries.setData(dn); } else { zzUpSeries.setData([]); zzDnSeries.setData([]); }
  if(heavenCloseLine){ candleSeries.removePriceLine(heavenCloseLine); heavenCloseLine=null; }
  if(lbcOpts.showClose && candles.length){ const last=candles[candles.length-1]; heavenCloseLine = candleSeries.createPriceLine({ price:last.close, color: isDark() ? '#9ca3af' : '#000000', lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth:1, title:'Close' }); }
  if(heavenTrendLine){ candleSeries.removePriceLine(heavenTrendLine); heavenTrendLine=null; }
  if(candles.length && lbcOpts.showTrend){ const lvl=lb.level[lb.level.length-1]; const col=lb.trend[lb.trend.length-1]===1? (lbcOpts.trendUpColor||'#00ff00') : (lbcOpts.trendDnColor||'#ff0000'); heavenTrendLine = candleSeries.createPriceLine({ price:lvl, color: col, lineStyle: LightweightCharts.LineStyle.Solid, lineWidth:2, title:'Reversal' }); }
updateFibAndTPLines(piv);
try{ const liveActive = !!(liveSession && liveSession.active); const showAr = (!!lbcOpts.showArrows) && !liveActive; const markers= showAr? buildHeavenMarkers(candles, lb, piv): []; const entries=liveEntryMarkers||[]; const tps=tpHitMarkers||[]; const sls=slHitMarkers||[]; const bes=beHitMarkers||[]; if((lbcOpts.arrowOffsetPx|0)>0){ renderMkHTML((showAr?markers:[]).concat(entries, tps, sls, bes)); candleSeries.setMarkers(tps.concat(sls, bes, entries)); } else { clearMkLayer(); candleSeries.setMarkers(tps.concat(sls, bes, entries, (showAr?markers:[]))); } }catch(_){ }
  try{ renderLBCOverlay(lb, piv); ensureDraggableLBCProb(); }catch(_){ }
}

function renderLBCOverlay(lb, piv){ try{ const probEl=document.getElementById('lbc-prob'); const tableEl=document.getElementById('lbc-table'); if(!probEl){ return; } const n=lb.trend.length; const dir= n? (lb.trend[n-1]===1?'Haussier':'Baissier') : '—'; const lvl=n? lb.level[n-1]: null; probEl.classList.remove('hidden'); probEl.innerHTML = `<div style=\"font-weight:600;margin-bottom:4px;\">Heaven</div>
  <div>Trend: <span style=\"color:${(lb.trend[n-1]===1?'#10b981':'#ef4444')}\">${dir}</span></div>
  <div>Reversal: ${lvl!=null? lvl.toFixed(2): '—'}</div>`;
  if(tableEl){ tableEl.classList.add('hidden'); tableEl.innerHTML=''; } }catch(_){ } }

// Draggable + persistent position for Heaven popup (lbc-prob)
function __cardLoadPos(key, def){ try{ const s=localStorage.getItem(key); if(!s) return def; const o=JSON.parse(s); return { left: Number(o.left)||def.left, top: Number(o.top)||def.top }; }catch(_){ return def; } }
function __cardSavePos(key, pos){ try{ localStorage.setItem(key, JSON.stringify({ left: Math.round(pos.left||0), top: Math.round(pos.top||0) })); }catch(_){ } }
function ensureDraggableLBCProb(){ try{ const el=document.getElementById('lbc-prob'); if(!el) return; // apply saved position once or always override default
  const key='card:lbc-prob'; const def={ left:12, top: (window.innerHeight- (el.offsetHeight||100) - 12) };
  const pos=__cardLoadPos(key, def); el.style.left = (pos.left|0)+'px'; el.style.top = (pos.top|0)+'px'; el.style.right='auto'; el.style.bottom='auto';
  if(el.dataset.dragwired==='1') return; el.dataset.dragwired='1';
  el.addEventListener('mousedown', (ev)=>{ try{ const rect=el.getBoundingClientRect(); const offX=ev.clientX-rect.left; const offY=ev.clientY-rect.top; const onMove=(e)=>{ let nx=e.clientX-offX; let ny=e.clientY-offY; const maxX=window.innerWidth - (el.offsetWidth||rect.width) - 4; const maxY=window.innerHeight - (el.offsetHeight||rect.height) - 4; if(nx<4) nx=4; if(ny<4) ny=4; if(nx>maxX) nx=maxX; if(ny>maxY) ny=maxY; el.style.left=nx+'px'; el.style.top=ny+'px'; el.style.right='auto'; el.style.bottom='auto'; };
    const onUp=()=>{ window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); const rect2=el.getBoundingClientRect(); __cardSavePos(key, { left: rect2.left, top: rect2.top }); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); }catch(_){ } });
}catch(_){ } }

// HTML overlay for arrow markers with pixel offset
let lbcMkLayer=null; let lbcLastMarkers=[];
function ensureMkLayer(){ if(!container) return; const cs = window.getComputedStyle(container); if(cs && cs.position==='static'){ container.style.position='relative'; } let el=document.getElementById('lbc-markers'); if(!el){ el=document.createElement('div'); el.id='lbc-markers'; el.style.position='absolute'; el.style.left='0'; el.style.top='0'; el.style.width='100%'; el.style.height='100%'; el.style.pointerEvents='none'; el.style.zIndex='100'; container.appendChild(el); } lbcMkLayer=el; }
function clearMkLayer(){ const el=document.getElementById('lbc-markers'); if(el){ el.innerHTML=''; } }
function renderMkHTML(markers){ ensureMkLayer(); clearMkLayer(); lbcLastMarkers = Array.isArray(markers)? markers: []; if(!lbcLastMarkers.length) return; const ts=chart.timeScale(); const series=candleSeries; const sz=Math.max(8, Math.min(40, (lbcOpts.arrowSizePx|0)||12)); const off=Math.max(0, (lbcOpts.arrowOffsetPx|0)||0); const idxByTime=new Map(); for(let i=0;i<candles.length;i++){ idxByTime.set(candles[i].time, i); } for(const m of lbcLastMarkers){ let x=null; try{ x=ts.timeToCoordinate(m.time); }catch(_){ x=null; } if(x==null) continue; const bi=idxByTime.get(m.time); if(bi==null) continue; let baseY=null; try{ if(m.position==='belowBar'){ baseY=series.priceToCoordinate(candles[bi].low); } else if(m.position==='aboveBar'){ baseY=series.priceToCoordinate(candles[bi].high); } else { baseY=series.priceToCoordinate(candles[bi].close); } }catch(_){ baseY=null; }
  if(baseY==null) continue; const y = baseY + (m.position==='belowBar'? off : (m.position==='aboveBar'? -off : 0)); const d=document.createElement('div'); d.className='lbc-arrow'; d.style.position='absolute'; d.style.left=x+'px'; d.style.top=y+'px'; d.style.transform = 'translate(-50%, '+(m.position==='aboveBar'? '-100%':'0')+')'; d.style.color=m.color||'#10b981'; let fz=sz; if(m.shape==='cross'){ fz=Math.max(6, Math.round(sz*0.75)); } d.style.fontSize=fz+'px'; d.style.lineHeight='1'; d.style.userSelect='none'; d.style.pointerEvents='none'; let glyph='▼'; if(m.shape==='arrowUp') glyph='▲'; else if(m.shape==='arrowDown') glyph='▼'; else if(m.shape==='circle') glyph='●'; else if(m.shape==='cross') glyph='✖'; else if(m.shape==='square') glyph='■'; d.textContent = glyph; lbcMkLayer.appendChild(d); } }
function updateMkPositions(){ try{ if(!((lbcOpts.arrowOffsetPx|0)>0)){ clearMkLayer(); return; } renderMkHTML(lbcLastMarkers||[]); }catch(_){ } }

// EMA/MA options + rendering
const emaCfgBtn = document.getElementById('emaCfg'); const emaModalEl=document.getElementById('emaModal'); const emaCloseBtn=document.getElementById('emaClose'); const emaSaveBtn=document.getElementById('emaSave');
const ema21En=document.getElementById('ema21En'); const ema21Len=document.getElementById('ema21Len'); const ema21Col=document.getElementById('ema21Col');
const ema34En=document.getElementById('ema34En'); const ema34Len=document.getElementById('ema34Len'); const ema34Col=document.getElementById('ema34Col');
const ema55En=document.getElementById('ema55En'); const ema55Len=document.getElementById('ema55Len'); const ema55Col=document.getElementById('ema55Col');
const ema200En=document.getElementById('ema200En'); const ema200Len=document.getElementById('ema200Len'); const ema200Col=document.getElementById('ema200Col');
const ma5En=document.getElementById('ma5En'); const ma5Len=document.getElementById('ma5Len'); const ma5Col=document.getElementById('ma5Col');
const ma8En=document.getElementById('ma8En'); const ma8Len=document.getElementById('ma8Len'); const ma8Col=document.getElementById('ma8Col');
const ma13En=document.getElementById('ma13En'); const ma13Len=document.getElementById('ma13Len'); const ma13Col=document.getElementById('ma13Col');

const defaultEMA = { enabled:true,
  e21:{en:true,len:21,col:'#facc15'}, e34:{en:true,len:34,col:'#ffa500'}, e55:{en:true,len:55,col:'#ef4444'}, e200:{en:true,len:200,col:'#6b7280'},
  m5:{en:true,len:5,col:'#3b82f6'}, m8:{en:true,len:8,col:'#00ffff'}, m13:{en:true,len:13,col:'#22c55e'} };
let emaOpts = (()=>{ try{ const s=localStorage.getItem('emaOptions'); return s? { ...defaultEMA, ...JSON.parse(s) } : { ...defaultEMA }; }catch(_){ return { ...defaultEMA }; } })();
function saveEMAOpts(){ try{ localStorage.setItem('emaOptions', JSON.stringify(emaOpts)); }catch(_){} }
if(emaToggleEl){ emaToggleEl.checked = !!emaOpts.enabled; emaToggleEl.addEventListener('change', ()=>{ emaOpts.enabled=!!emaToggleEl.checked; saveEMAOpts(); updateEMAs(); }); }
if(emaCfgBtn&&emaModalEl){ emaCfgBtn.addEventListener('click', ()=> openModalEl(emaModalEl)); }
if(emaCloseBtn&&emaModalEl){ emaCloseBtn.addEventListener('click', ()=> closeModalEl(emaModalEl)); }
if(emaSaveBtn){ emaSaveBtn.addEventListener('click', ()=>{ emaOpts.e21.en=!!(ema21En&&ema21En.checked); emaOpts.e21.len=parseInt((ema21Len&&ema21Len.value)||'21',10); emaOpts.e21.col=(ema21Col&&ema21Col.value)||emaOpts.e21.col;
  emaOpts.e34.en=!!(ema34En&&ema34En.checked); emaOpts.e34.len=parseInt((ema34Len&&ema34Len.value)||'34',10); emaOpts.e34.col=(ema34Col&&ema34Col.value)||emaOpts.e34.col;
  emaOpts.e55.en=!!(ema55En&&ema55En.checked); emaOpts.e55.len=parseInt((ema55Len&&ema55Len.value)||'55',10); emaOpts.e55.col=(ema55Col&&ema55Col.value)||emaOpts.e55.col;
  emaOpts.e200.en=!!(ema200En&&ema200En.checked); emaOpts.e200.len=parseInt((ema200Len&&ema200Len.value)||'200',10); emaOpts.e200.col=(ema200Col&&ema200Col.value)||emaOpts.e200.col;
  emaOpts.m5.en=!!(ma5En&&ma5En.checked); emaOpts.m5.len=parseInt((ma5Len&&ma5Len.value)||'5',10); emaOpts.m5.col=(ma5Col&&ma5Col.value)||emaOpts.m5.col;
  emaOpts.m8.en=!!(ma8En&&ma8En.checked); emaOpts.m8.len=parseInt((ma8Len&&ma8Len.value)||'8',10); emaOpts.m8.col=(ma8Col&&ma8Col.value)||emaOpts.m8.col;
  emaOpts.m13.en=!!(ma13En&&ma13En.checked); emaOpts.m13.len=parseInt((ma13Len&&ma13Len.value)||'13',10); emaOpts.m13.col=(ma13Col&&ma13Col.value)||emaOpts.m13.col;
  saveEMAOpts(); applyEMAStyles(); updateEMAs(); closeModalEl(emaModalEl); }); }
function applyEMAStyles(){ try{ ema21Series.applyOptions({ color: emaOpts.e21.col }); ema34Series.applyOptions({ color: emaOpts.e34.col }); ema55Series.applyOptions({ color: emaOpts.e55.col }); ema200Series.applyOptions({ color: emaOpts.e200.col }); ma5Series.applyOptions({ color: emaOpts.m5.col }); ma8Series.applyOptions({ color: emaOpts.m8.col }); ma13Series.applyOptions({ color: emaOpts.m13.col }); }catch(_){}}
function emaCalc(data, len){ const out=new Array(data.length); let k=2/(len+1); let prev=null; for(let i=0;i<data.length;i++){ const v=data[i].close; if(prev==null){ prev=v; } else { prev = v*k + prev*(1-k); } out[i]=prev; } return out; }
function smaCalc(data, len){ const out=new Array(data.length).fill(null); let sum=0; for(let i=0;i<data.length;i++){ sum += data[i].close; if(i>=len){ sum -= data[i-len].close; } if(i>=len-1){ out[i]=sum/len; } }
  return out; }
function toSeriesData(vals){ const arr=[]; for(let i=0;i<candles.length;i++){ const v=vals[i]; if(v!=null && isFinite(v)){ arr.push({ time:candles[i].time, value:v }); } } return arr; }
function updateEMAs(){ if(!emaOpts.enabled||!candles.length){ try{ ema21Series.setData([]); ema34Series.setData([]); ema55Series.setData([]); ema200Series.setData([]); ma5Series.setData([]); ma8Series.setData([]); ma13Series.setData([]); }catch(_){ } return; }
  applyEMAStyles(); if(emaOpts.e21.en){ ema21Series.setData(toSeriesData(emaCalc(candles, Math.max(1, emaOpts.e21.len|0)))); } else { ema21Series.setData([]); }
  if(emaOpts.e34.en){ ema34Series.setData(toSeriesData(emaCalc(candles, Math.max(1, emaOpts.e34.len|0)))); } else { ema34Series.setData([]); }
  if(emaOpts.e55.en){ ema55Series.setData(toSeriesData(emaCalc(candles, Math.max(1, emaOpts.e55.len|0)))); } else { ema55Series.setData([]); }
  if(emaOpts.e200.en){ ema200Series.setData(toSeriesData(emaCalc(candles, Math.max(1, emaOpts.e200.len|0)))); } else { ema200Series.setData([]); }
  if(emaOpts.m5.en){ ma5Series.setData(toSeriesData(smaCalc(candles, Math.max(1, emaOpts.m5.len|0)))); } else { ma5Series.setData([]); }
  if(emaOpts.m8.en){ ma8Series.setData(toSeriesData(smaCalc(candles, Math.max(1, emaOpts.m8.len|0)))); } else { ma8Series.setData([]); }
  if(emaOpts.m13.en){ ma13Series.setData(toSeriesData(smaCalc(candles, Math.max(1, emaOpts.m13.len|0)))); } else { ma13Series.setData([]); }
}
applyEMAStyles();

// Sauvegarde LBC depuis la modale (si présente)
const lbcSaveBtn = document.getElementById('lbcSave');
const optEnabled=document.getElementById('optEnabled'); const optNol=document.getElementById('optNol'); const optShowTrend=document.getElementById('optShowTrend'); const optTrendUp=document.getElementById('optTrendUp'); const optTrendDn=document.getElementById('optTrendDn'); const optUseZZDraw=document.getElementById('optUseZZDraw'); const optPrd=document.getElementById('optPrd');
const optSLInitPct=document.getElementById('optSLInitPct'); const optSLEnable=document.getElementById('optSLEnable'); const optBEEnable=document.getElementById('optBEEnable'); const optBEBars=document.getElementById('optBEBars'); const optBELockPct=document.getElementById('optBELockPct'); const optEMALen=document.getElementById('optEMALen'); const optShowClose=document.getElementById('optShowClose');
const optEntryMode=document.getElementById('optEntryMode'); const optEnt382=document.getElementById('optEnt382'); const optEnt500=document.getElementById('optEnt500'); const optEnt618=document.getElementById('optEnt618'); const optEnt786=document.getElementById('optEnt786');
if(lbcSaveBtn){ lbcSaveBtn.addEventListener('click', ()=>{ if(optEnabled) lbcOpts.enabled=!!optEnabled.checked; if(optNol) lbcOpts.nol = Math.max(1, parseInt(optNol.value||String(lbcOpts.nol))); if(optShowTrend) lbcOpts.showTrend = !!optShowTrend.checked; if(optTrendUp) lbcOpts.trendUpColor = optTrendUp.value||lbcOpts.trendUpColor; if(optTrendDn) lbcOpts.trendDnColor = optTrendDn.value||lbcOpts.trendDnColor; if(optUseZZDraw) lbcOpts.useZZDraw = !!optUseZZDraw.checked; if(optPrd) lbcOpts.prd = Math.max(2, parseInt(optPrd.value||String(lbcOpts.prd))); if(optSLInitPct) lbcOpts.slInitPct = Math.max(0, parseFloat(optSLInitPct.value||String(lbcOpts.slInitPct))); if(optSLEnable) lbcOpts.slEnable=!!optSLEnable.checked; if(optBEEnable) lbcOpts.beEnable=!!optBEEnable.checked; if(optBEBars) lbcOpts.beAfterBars=Math.max(1, parseInt(optBEBars.value||String(lbcOpts.beAfterBars))); if(optBELockPct) lbcOpts.beLockPct=Math.max(0, parseFloat(optBELockPct.value||String(lbcOpts.beLockPct))); if(optEMALen) lbcOpts.emaLen=Math.max(1, parseInt(optEMALen.value||String(lbcOpts.emaLen))); if(optShowClose) lbcOpts.showClose=!!optShowClose.checked; const optShowArrows=document.getElementById('optShowArrows'); if(optShowArrows) lbcOpts.showArrows=!!optShowArrows.checked; const optUseFibDraw=document.getElementById('optUseFibDraw'); const optUseFibRet=document.getElementById('optUseFibRet'); const optConfirmMode=document.getElementById('optConfirmMode'); const optZZUp=document.getElementById('optZZUp'); const optZZDn=document.getElementById('optZZDn'); const optTPEnable=document.getElementById('optTPEnable'); const optTPCompound=document.getElementById('optTPCompound'); const optTPAllLast=document.getElementById('optTPAllLast'); if(optUseFibDraw) lbcOpts.useFibDraw=!!optUseFibDraw.checked; if(optUseFibRet) lbcOpts.useFibRet=!!optUseFibRet.checked; if(optEntryMode) lbcOpts.entryMode=optEntryMode.value||lbcOpts.entryMode; if(optConfirmMode) lbcOpts.confirmMode=optConfirmMode.value||lbcOpts.confirmMode; if(optEnt382) lbcOpts.ent382=!!optEnt382.checked; if(optEnt500) lbcOpts.ent500=!!optEnt500.checked; if(optEnt618) lbcOpts.ent618=!!optEnt618.checked; if(optEnt786) lbcOpts.ent786=!!optEnt786.checked; if(optZZUp) lbcOpts.zzUp=optZZUp.value||lbcOpts.zzUp; if(optZZDn) lbcOpts.zzDn=optZZDn.value||lbcOpts.zzDn; if(optTPEnable) lbcOpts.tpEnable=!!optTPEnable.checked; if(optTPCompound) lbcOpts.tpCompound=!!optTPCompound.checked; if(optTPAllLast) lbcOpts.tpCloseAllLast=!!optTPAllLast.checked; const tpArr=[]; for(let i=1;i<=10;i++){ const tSel=document.getElementById(`optTP${i}Type`); if(!tSel) continue; const typ=tSel.value||'Fib'; const vNum=document.getElementById(`optTP${i}R`); const vFib=document.getElementById(`optTP${i}Fib`); const vEma=document.getElementById(`optTP${i}Ema`); const pPct=document.getElementById(`optTP${i}P`); const qPct=document.getElementById(`optTP${i}Qty`); const sSel=document.getElementById(`optTP${i}SLType`); const sNum=document.getElementById(`optTP${i}SLR`); const sFib=document.getElementById(`optTP${i}SLFib`); const sEma=document.getElementById(`optTP${i}SLEma`); const beOn=document.getElementById(`optTP${i}BEOn`); const trSel=document.getElementById(`optTP${i}TrailType`); const trEma=document.getElementById(`optTP${i}TrailEma`); const trPct=document.getElementById(`optTP${i}TrailPct`); const sTrSel=document.getElementById(`optTP${i}SLTrailType`); const sTrEma=document.getElementById(`optTP${i}SLTrailEma`); const sTrPct=document.getElementById(`optTP${i}SLTrailPct`); const entry={ type:typ }; if(typ==='Fib'){ const r=parseFloat(((vFib && vFib.value) || (vNum && vNum.value) || '')); if(isFinite(r)) { entry.fib=r; } else { continue; } } else if(typ==='Percent'){ const p=parseFloat(((vNum && vNum.value) || (vFib && vFib.value) || '')); if(isFinite(p)) { entry.pct=p; } else { continue; } } else if(typ==='EMA'){ const len=parseInt(((vEma && vEma.value) || (optEMALen && optEMALen.value) || ''),10); if(isFinite(len) && len>0){ entry.emaLen=len; } } if(qPct && qPct.value!==''){ const qv=parseFloat(qPct.value); if(isFinite(qv)) entry.qty=qv; } // attached SL per TP
    if(sSel){ const styp=sSel.value||'Percent'; const slEntry={ type:styp }; if(styp==='Fib'){ const r2=parseFloat(((sFib && sFib.value) || (sNum && sNum.value) || '')); if(isFinite(r2)) slEntry.fib=r2; } else if(styp==='Percent'){ const p2=parseFloat(((sNum && sNum.value) || (sFib && sFib.value) || '')); if(isFinite(p2)) slEntry.pct=p2; } else if(styp==='EMA'){ const len2=parseInt(((sEma && sEma.value) || (optEMALen && optEMALen.value) || ''),10); if(isFinite(len2) && len2>0) slEntry.emaLen=len2; } entry.sl = slEntry; // SL trailing attached to TP
      if(sTrSel){ const m2=sTrSel.value||'none'; if(m2 && m2!=='none'){ entry.sl.trail={ mode:m2 }; if(m2==='ema'){ const len4=parseInt((sTrEma&&sTrEma.value)||'',10); if(isFinite(len4)&&len4>0) entry.sl.trail.emaLen=len4; } else if(m2==='percent'){ const p4=parseFloat((sTrPct&&sTrPct.value)||''); if(isFinite(p4)) entry.sl.trail.pct=p4; } } }
    }
    if(beOn) entry.beOn = !!beOn.checked; if(trSel){ const mode=trSel.value||'none'; if(mode && mode!=='none'){ entry.trail={ mode }; if(mode==='ema'){ const len3=parseInt((trEma&&trEma.value)||'',10); if(isFinite(len3)&&len3>0) entry.trail.emaLen=len3; } else if(mode==='percent'){ const p3=parseFloat((trPct&&trPct.value)||''); if(isFinite(p3)) entry.trail.pct=p3; } } } tpArr.push(entry); } lbcOpts.tp = tpArr; const slArr=[]; for(let i=1;i<=10;i++){ const tSel=document.getElementById(`optSL${i}Type`); if(!tSel) continue; const typ=tSel.value||'Percent'; const vNum=document.getElementById(`optSL${i}R`); const vFib=document.getElementById(`optSL${i}Fib`); const vEma=document.getElementById(`optSL${i}Ema`); const slEntry={ type:typ }; if(typ==='Fib'){ const r=parseFloat(((vFib && vFib.value) || (vNum && vNum.value) || '')); if(isFinite(r)) { slEntry.fib=r; } else { continue; } } else if(typ==='Percent'){ const p=parseFloat(((vNum && vNum.value) || (vFib && vFib.value) || '')); if(isFinite(p)) { slEntry.pct=p; } else { continue; } } else if(typ==='EMA'){ const len=parseInt(((vEma && vEma.value) || (optEMALen && optEMALen.value) || ''),10); if(isFinite(len) && len>0){ slEntry.emaLen=len; } } slArr.push(slEntry); } lbcOpts.sl = slArr; saveLBCOpts(); renderLBC(); closeModalEl(lbcModalEl); try{ computeLabBenchmarkAndUpdate(); }catch(_){ } }); }

// --- Backtest (période visible / all / dates) ---
const btRunBtn=document.getElementById('btRun'); const btCancelBtn=document.getElementById('btCancel'); const btOptimizeBtn=document.getElementById('btOptimize');
const btProgressEl=document.getElementById('btProgress'); const btProgText=document.getElementById('btProgText'); const btProgBar=document.getElementById('btProgBar'); const btProgNote=document.getElementById('btProgNote'); const btProgTime=document.getElementById('btProgTime'); const btProgLog=document.getElementById('btProgLog'); const btAbortBtn=document.getElementById('btAbort');
const btProgGlobalText=document.getElementById('btProgGlobalText'); const btProgGlobalBar=document.getElementById('btProgGlobalBar');
const btStartCap=document.getElementById('btStartCap'); const btFee=document.getElementById('btFee'); const btLev=document.getElementById('btLev'); const btMaxPct=document.getElementById('btMaxPct'); const btMaxBase=document.getElementById('btMaxBase');
const btRangeVisible=document.getElementById('btRangeVisible'); const btRangeAll=document.getElementById('btRangeAll'); const btRangeDates=document.getElementById('btRangeDates'); const btFrom=document.getElementById('btFrom'); const btTo=document.getElementById('btTo');
let btAbort=false; let btPaused=false; let __btTimerId=null; let __btStartTs=0;
function __fmtElapsed(ms){ const s=Math.floor(ms/1000); const m=Math.floor(s/60); const ss=String(s%60).padStart(2,'0'); const mm=String(m%60).padStart(2,'0'); const hh=Math.floor(m/60); return (hh>0? (String(hh).padStart(2,'0')+':'):'')+mm+':'+ss; }
function __setBtTime(){ if(btProgTime){ const ms=Date.now()-__btStartTs; btProgTime.textContent = `⏱ ${__fmtElapsed(ms)}`; } }
function addBtLog(msg){ try{ const t=new Date(); const hh=String(t.getHours()).padStart(2,'0'); const mm=String(t.getMinutes()).padStart(2,'0'); const ss=String(t.getSeconds()).padStart(2,'0'); const line=`[${hh}:${mm}:${ss}] ${msg}`; if(btProgLog){ if(btProgLog.textContent==='—') btProgLog.textContent=line; else btProgLog.textContent += ("\n"+line); btProgLog.scrollTop = btProgLog.scrollHeight; } if(typeof addLabLog==='function'){ addLabLog(msg); } }catch(_){ } }
function openBtProgress(msg){ if(btProgText) btProgText.textContent = msg||''; if(btProgBar) btProgBar.style.width='0%'; if(btProgNote) btProgNote.textContent=''; if(btProgGlobalBar) btProgGlobalBar.style.width='0%'; if(btProgGlobalText) btProgGlobalText.textContent='Global: 0% (0/0) — ETA —'; if(btProgLog) btProgLog.textContent='—'; const pBtn=document.getElementById('btPause'); if(pBtn) pBtn.textContent='Pause'; __btStartTs=Date.now(); if(__btTimerId) { try{ clearInterval(__btTimerId);}catch(_){}} __setBtTime(); __btTimerId=setInterval(__setBtTime, 500); openModalEl(btProgressEl); }
function closeBtProgress(){ if(__btTimerId){ try{ clearInterval(__btTimerId);}catch(_){ } __btTimerId=null; } closeModalEl(btProgressEl); }
function getVisibleRange(){ try{ const r=chart.timeScale().getVisibleRange(); if(!r) return null; return { from: r.from, to: r.to }; }catch(_){ return null; } }
function idxFromTime(from, to){ let s=0, e=candles.length-1; if(from!=null){ for(let i=0;i<candles.length;i++){ if(candles[i].time>=from){ s=i; break; } } } if(to!=null){ for(let j=candles.length-1;j>=0;j--){ if(candles[j].time<=to){ e=j; break; } } } return [s,e]; }
function runBacktestSlice(sIdx, eIdx, conf){
  const lb=computeLineBreakState(candles, Math.max(1, lbcOpts.nol|0));
  const prd=Math.max(2, lbcOpts.prd|0);
  const pivAll=computePivots(candles, prd);
  const slEmaCache=new Map();
  clearTPHitMarkers(); clearSLHitMarkers();
  const trades=[];
  let pivIdx=-1;
  function advancePivotIdxTo(i){ while(pivIdx+1<pivAll.length && pivAll[pivIdx+1].idx<=i){ pivIdx++; } }
  function segAtIdx(){ if(pivIdx>=1){ const a=pivAll[pivIdx-1], b=pivAll[pivIdx]; return { a, b, dir: b.price>a.price?'up':'down' }; } return null; }
  function computeSLFromLadder(dir, entry, i){ try{ if(!(lbcOpts.slEnable && Array.isArray(lbcOpts.sl) && lbcOpts.sl.length)) return null; const seg=segAtIdx(); const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null; const cands=[]; for(const t of lbcOpts.sl){ const typ=(t&&t.type)||'Percent'; let price=null; if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B - move*r) : (B + move*r); } else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1 - p/100)) : (entry*(1 + p/100)); } else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (lbcOpts.emaLen||55)),10)); let ema=slEmaCache.get(len); if(!ema){ ema=emaCalc(candles, len); slEmaCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; } if(price!=null){ if(dir==='long'){ if(price<=entry) cands.push(price); } else { if(price>=entry) cands.push(price); } } } if(!cands.length) return null; return dir==='long'? Math.max(...cands) : Math.min(...cands); }catch(_){ return null; } }
  function buildTargets(dir, entry, riskAbs, i){
    let list=[];
    if(lbcOpts.tpEnable && Array.isArray(lbcOpts.tp) && lbcOpts.tp.length){
      const seg=segAtIdx();
      const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null;
      for(let idx=0; idx<lbcOpts.tp.length; idx++){
        const t=lbcOpts.tp[idx]; let price=null; const typ=(t.type||'Fib');
        if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B + move*r) : (B - move*r); }
        else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1+p/100)) : (entry*(1-p/100)); }
        else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v = ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; }
        if(price!=null){ if((dir==='long' && price>entry) || (dir==='short' && price<entry)){
            let w=null; const q=t.qty; if(q!=null && isFinite(q)){ w = (q>1? q/100 : q); }
            list.push({price, w, srcIdx: idx});
        } }
      }
      if(dir==='long') list.sort((a,b)=>a.price-b.price); else list.sort((a,b)=>b.price-a.price);
      let sumW=0, hasW=false; for(const it of list){ if(it.w!=null && it.w>0){ sumW+=it.w; hasW=true; } }
      if(!hasW){ if(list.length){ const even=1/list.length; list=list.map(it=>({ price:it.price, w:even, srcIdx: it.srcIdx })); } else { list=[{price: (dir==='long'? entry + riskAbs*(lbcOpts.tp1R||1) : entry - riskAbs*(lbcOpts.tp1R||1)), w:1, srcIdx: 0}]; } }
      else { if(sumW>1){ const k=1/sumW; for(const it of list){ if(it.w!=null) it.w*=k; } } else if(lbcOpts.tpCloseAllLast && sumW<1 && list.length){ list[list.length-1].w = (list[list.length-1].w||0) + (1-sumW); } }
      return list;
    } else {
      return [{ price: dir==='long'? (entry + riskAbs*(lbcOpts.tp1R||1)) : (entry - riskAbs*(lbcOpts.tp1R||1)), w:1, srcIdx: 0 }];
    }
  }
  let equity=conf.startCap; let peak=equity; let maxDDAbs=0; let grossProfit=0, grossLoss=0; let wins=0, losses=0; let rrSum=0; let tradesCount=0;
  let pos=null; let pendingFib=null;
  const feePct=conf.fee/100; const maxPct=conf.maxPct/100; const lev=conf.lev; const baseMode=conf.base;
  function __computeQty(entry, sl){ if(!(isFinite(entry)&&isFinite(sl))) return 0; if(equity<=0) return 0; const capBase=(baseMode==='equity')?equity:conf.startCap; const budget=Math.max(0, Math.min(capBase*maxPct, equity)); const notional=budget*lev; const qty0=notional/Math.max(1e-12, entry); const riskAbs=Math.abs(entry-sl); const perUnitWorstLoss = riskAbs + ((Math.abs(entry)+Math.abs(sl)) * feePct); const qtyRisk = perUnitWorstLoss>0? (equity / perUnitWorstLoss) : 0; const q=Math.max(0, Math.min(qty0, qtyRisk)); return q; }
  for(let i=Math.max(1,sIdx); i<=eIdx; i++){
    if(btAbort) break; if(equity<=0) break;
    const bar=candles[i]; const trendNow=lb.trend[i]; const trendPrev=lb.trend[i-1];
    advancePivotIdxTo(i);
    if(!pos){
      if(trendNow!==trendPrev){
        const seg=segAtIdx();
        if(seg){ const A=seg.a.price, B=seg.b.price; const up=seg.dir==='up'; const move=Math.abs(B-A); const levels=[]; if(lbcOpts.ent382) levels.push(up? (B - move*0.382) : (B + move*0.382)); if(lbcOpts.ent500) levels.push(up? (B - move*0.5) : (B + move*0.5)); if(lbcOpts.ent618) levels.push(up? (B - move*0.618) : (B + move*0.618)); if(lbcOpts.ent786) levels.push(up? (B - move*0.786) : (B + move*0.786)); pendingFib={ dir:(trendNow===1?'long':'short'), levels, mode: lbcOpts.confirmMode||'Bounce' }; }
        if(lbcOpts.entryMode!=='Fib Retracement'){
          const dir=(trendNow===1)?'long':'short'; const entry=bar.close; let sl=computeSLFromLadder(dir, entry, i); if(sl==null){ const riskPx=entry*(lbcOpts.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; }
          const initQty=__computeQty(entry, sl);
          if(initQty>1e-12 && isFinite(initQty)){
            const targets=buildTargets(dir, entry, Math.abs(entry-sl), i);
pos={ dir, entry, sl, initSL:sl, qty:initQty, initQty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets, risk: Math.abs(entry-sl)*initQty, hiSince: bar.high, loSince: bar.low, lastTpIdx: 0, tpTrailCfg: null, slTrailCfg: null };
          }
        }
      }
      if(!pos && lbcOpts.useFibRet && (lbcOpts.entryMode!=='Original') && pendingFib && pendingFib.levels && pendingFib.levels.length){
        for(const lv of pendingFib.levels){
          let ok=false;
          if(pendingFib.dir==='long') ok=(pendingFib.mode==='Touch')? (bar.low<=lv) : (bar.low<=lv && bar.close>lv);
          else ok=(pendingFib.mode==='Touch')? (bar.high>=lv) : (bar.high>=lv && bar.close<lv);
if(ok){ const dir=pendingFib.dir; const entry=bar.close; let sl=computeSLFromLadder(dir, entry, i); if(sl==null){ const riskPx=entry*(lbcOpts.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; } const initQty=__computeQty(entry, sl); if(initQty>1e-12 && isFinite(initQty)){ const targets=buildTargets(dir, entry, Math.abs(entry-sl), i); pos={ dir, entry, sl, initSL:sl, qty:initQty, initQty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets, risk: Math.abs(entry-sl)*initQty, hiSince: bar.high, loSince: bar.low, lastTpIdx: 0, tpTrailCfg: null, slTrailCfg: null }; pendingFib=null; break; } }
        }
      }
    } else {
      pos.hiSince = Math.max(pos.hiSince||bar.high, bar.high); pos.loSince = Math.min(pos.loSince||bar.low, bar.low);
      if(lbcOpts.beEnable && !pos.beActive && (i - pos.entryIdx) >= lbcOpts.beAfterBars){ const movePct = pos.dir==='long'? ((bar.high - pos.entry)/pos.entry*100) : ((pos.entry - bar.low)/pos.entry*100); if(movePct >= lbcOpts.beLockPct){ pos.beActive=true; pos.sl = pos.entry; } }
      // Continuous per-TP trailing (ema/percent)
      if(pos.tpTrailCfg){ try{ let cand=null; if(pos.tpTrailCfg.mode==='ema'){ const len=Math.max(1, parseInt((pos.tpTrailCfg.emaLen!=null? pos.tpTrailCfg.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(pos.tpTrailCfg.mode==='percent'){ const pct=Number(pos.tpTrailCfg.pct)||0; if(pos.dir==='long'){ cand=(pos.hiSince||bar.high)*(1 - pct/100); } else { cand=(pos.loSince||bar.low)*(1 + pct/100); } } if(cand!=null){ let b=cand; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(cand, pos.entry) : Math.max(cand, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }catch(_){ } }
      // Continuous SL-attached trailing (ema/percent)
      if(pos.slTrailCfg){ try{ let cand=null; if(pos.slTrailCfg.mode==='ema'){ const len=Math.max(1, parseInt((pos.slTrailCfg.emaLen!=null? pos.slTrailCfg.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(pos.slTrailCfg.mode==='percent'){ const pct=Number(pos.slTrailCfg.pct)||0; if(pos.dir==='long'){ cand=(pos.hiSince||bar.high)*(1 - pct/100); } else { cand=(pos.loSince||bar.low)*(1 + pct/100); } } if(cand!=null){ let b=cand; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(cand, pos.entry) : Math.max(cand, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }catch(_){ } }
      { const sl2=computeSLFromLadder(pos.dir, pos.entry, i); if(sl2!=null){ let b=sl2; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(sl2, pos.entry) : Math.max(sl2, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }
      let closed=false;
      if(pos.dir==='long'){
        if(bar.low <= pos.sl){ const portionQty = pos.qty; const pnl = (pos.sl - pos.entry) * portionQty; const fees = (pos.entry*portionQty + pos.sl*portionQty) * feePct; const net=pnl-fees; equity+=net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0) rrSum+=(net/pos.risk); if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; } if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd; trades.push({ dir:pos.dir, entryTime:candles[pos.entryIdx].time, entry:pos.entry, initSL:pos.initSL, exitTime:candles[i].time, exit:pos.sl, reason:'SL', qty:portionQty, pnl, fees, net, rr: (Math.abs(pos.entry-pos.initSL)*portionQty>0? net/(Math.abs(pos.entry-pos.initSL)*portionQty) : null) }); try{ addSLHitMarker(candles[i].time, pos.dir); }catch(_){ } pos=null; closed=true; }
      } else {
        if(bar.high >= pos.sl){ const portionQty = pos.qty; const pnl = (pos.entry - pos.sl) * portionQty; const fees = (pos.entry*portionQty + pos.sl*portionQty) * feePct; const net=pnl-fees; equity+=net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0) rrSum+=(net/pos.risk); if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; } if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd; trades.push({ dir:pos.dir, entryTime:candles[pos.entryIdx].time, entry:pos.entry, initSL:pos.initSL, exitTime:candles[i].time, exit:pos.sl, reason:'SL', qty:portionQty, pnl, fees, net, rr: (Math.abs(pos.entry-pos.initSL)*portionQty>0? net/(Math.abs(pos.entry-pos.initSL)*portionQty) : null) }); try{ addSLHitMarker(candles[i].time, pos.dir); }catch(_){ } pos=null; closed=true; }
      }
      if(closed) { if(btProgBar && btProgText){ const p = Math.round((i - sIdx) / Math.max(1, (eIdx - sIdx)) * 100); if(p%5===0){ btProgBar.style.width = p+'%'; btProgText.textContent = `Simulation ${p}%`; } } continue; }
      if(pos.targets && pos.tpIdx < pos.targets.length){
        while(pos && pos.tpIdx < pos.targets.length){
          const tp=pos.targets[pos.tpIdx]; const hit = pos.dir==='long'? (bar.high >= tp.price) : (bar.low <= tp.price); if(!hit) break;
          const portionFrac = lbcOpts.tpCompound? (tp.w||1) : 1; const portionQty = pos.initQty * portionFrac; const usedQty = Math.min(portionQty, pos.qty);
const exitPx = tp.price; const pnl = (pos.dir==='long'? (exitPx - pos.entry) : (pos.entry - exitPx)) * usedQty; const fees = (pos.entry*usedQty + exitPx*usedQty) * feePct; const net = pnl - fees; const eqBeforeLocal=equity;
          equity += net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0) rrSum += (net/pos.risk);
          if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; }
          if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd;
trades.push({ dir:pos.dir, entryTime:candles[pos.entryIdx].time, entry:pos.entry, initSL:pos.initSL, exitTime:candles[i].time, exit:exitPx, reason:`TP${pos.tpIdx+1}`, qty:usedQty, net, fees, rr: (Math.abs(pos.entry-pos.initSL)*usedQty>0? net/(Math.abs(pos.entry-pos.initSL)*usedQty) : null), eqBefore: eqBeforeLocal });
          try{ addTPHitMarker(candles[i].time, pos.dir); }catch(_){ }
          pos.qty -= usedQty; pos.anyTP=true;
          // Apply per-TP rules (BE/SL); fallback to DOM if not persisted
          let applied=false; let tCfg = (Array.isArray(lbcOpts.tp)&&tp.srcIdx!=null)? lbcOpts.tp[tp.srcIdx] : null;
          if(!tCfg){ tCfg = {}; }
          if(!tCfg.sl && typeof tCfg.beOn==='undefined'){
            try{
              const idx = (tp.srcIdx!=null? (tp.srcIdx+1) : (pos.tpIdx+1));
              const sSel=document.getElementById(`optTP${idx}SLType`);
              const sNum=document.getElementById(`optTP${idx}SLR`);
              const sFib=document.getElementById(`optTP${idx}SLFib`);
              const sEma=document.getElementById(`optTP${idx}SLEma`);
              const beOn=document.getElementById(`optTP${idx}BEOn`);
              if(sSel){ const styp=sSel.value||'Percent'; const slEntry={ type:styp };
                if(styp==='Fib'){ const r2=parseFloat(((sFib && sFib.value) || (sNum && sNum.value) || '')); if(isFinite(r2)) slEntry.fib=r2; }
                else if(styp==='Percent'){ const p2=parseFloat(((sNum && sNum.value) || (sFib && sFib.value) || '')); if(isFinite(p2)) slEntry.pct=p2; }
                else if(styp==='EMA'){ const len2=parseInt(((sEma && sEma.value) || (lbcOpts.emaLen||55)),10); if(isFinite(len2) && len2>0) slEntry.emaLen=len2; }
                tCfg.sl = slEntry;
              }
              // read per-TP trailing (TP + SL) from DOM if not persisted
              const trSel=document.getElementById(`optTP${idx}TrailType`);
              const trEma=document.getElementById(`optTP${idx}TrailEma`);
              const trPct=document.getElementById(`optTP${idx}TrailPct`);
              if(trSel){ const mode=trSel.value||'none'; if(mode && mode!=='none'){ tCfg.trail={ mode }; if(mode==='ema'){ const len3=parseInt((trEma&&trEma.value)||'',10); if(isFinite(len3)&&len3>0) tCfg.trail.emaLen=len3; } else if(mode==='percent'){ const p3=parseFloat((trPct&&trPct.value)||''); if(isFinite(p3)) tCfg.trail.pct=p3; } } }
              const sTrSel=document.getElementById(`optTP${idx}SLTrailType`);
              const sTrEma=document.getElementById(`optTP${idx}SLTrailEma`);
              const sTrPct=document.getElementById(`optTP${idx}SLTrailPct`);
              if(sTrSel){ const m2=sTrSel.value||'none'; if(m2 && m2!=='none'){ if(!tCfg.sl) tCfg.sl={type:'Percent'}; tCfg.sl.trail={ mode:m2 }; if(m2==='ema'){ const len4=parseInt((sTrEma&&sTrEma.value)||'',10); if(isFinite(len4)&&len4>0) tCfg.sl.trail.emaLen=len4; } else if(m2==='percent'){ const p4=parseFloat((sTrPct&&sTrPct.value)||''); if(isFinite(p4)) tCfg.sl.trail.pct=p4; } } }
              tCfg.beOn = !!(beOn && beOn.checked);
            }catch(_){ }
          }
          if(tCfg){ if(tCfg.beOn){ pos.sl = pos.entry; applied=true; }
            const slNew = (function(){ try{
              const seg=segAtIdx(); if(!(tCfg&&tCfg.sl)) return null; const s=tCfg.sl; let price=null; if(s.type==='Fib' && seg){ const A=seg.a.price, B=seg.b.price; const move=Math.abs(B-A); const r=parseFloat(s.fib!=null? s.fib : s.value); if(isFinite(r)) price = (seg.dir==='up')? (B - move*r) : (B + move*r); }
              else if(s.type==='Percent'){ const p=parseFloat(s.pct!=null? s.pct : s.value); if(isFinite(p)) price = pos.dir==='long'? (pos.entry*(1 - p/100)) : (pos.entry*(1 + p/100)); }
              else if(s.type==='EMA'){ const len=Math.max(1, parseInt(((s&&s.emaLen)!=null? s.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; }
              return price;
            }catch(_){ return null; } })();
            if(slNew!=null){ let b=slNew; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(slNew, pos.entry) : Math.max(slNew, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); applied=true; }
            // Per-TP trailing at hit (be/prev/ema/percent)
            if(tCfg.trail && tCfg.trail.mode){ let cand=null; const m=tCfg.trail.mode; if(m==='be'){ cand=pos.entry; }
              else if(m==='prev'){ cand=exitPx; }
              else if(m==='ema'){ const len=Math.max(1, parseInt(((tCfg.trail.emaLen!=null? tCfg.trail.emaLen : (lbcOpts.emaLen||55))),10)); const ema=emaCalc(candles, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; }
              else if(m==='percent'){ const pct=Number(tCfg.trail.pct)||0; if(pos.dir==='long'){ cand=(pos.hiSince||bar.high)*(1 - pct/100); } else { cand=(pos.loSince||bar.low)*(1 + pct/100); } }
              if(cand!=null){ let b=cand; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(cand, pos.entry) : Math.max(cand, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); applied=true; }
              if(m==='ema' || m==='percent'){ pos.tpTrailCfg = { mode:m, emaLen: tCfg.trail.emaLen, pct: tCfg.trail.pct }; }
            }
            if(tCfg.sl && tCfg.sl.trail && tCfg.sl.trail.mode){ const m2=tCfg.sl.trail.mode; if(m2==='ema' || m2==='percent'){ pos.slTrailCfg = { mode:m2, emaLen: tCfg.sl.trail.emaLen, pct: tCfg.sl.trail.pct }; } }
          }
          pos.tpIdx++;
          if(!lbcOpts.tpCompound || pos.qty<=1e-12){ pos=null; break; }
        }
      }
      if(pos){
        if((pos.dir==='long' && trendNow!==trendPrev && trendNow!==1) || (pos.dir==='short' && trendNow!==trendPrev && trendNow!==-1)){
          const exit=bar.close; const portionQty=pos.qty; const pnl=(pos.dir==='long'? (exit - pos.entry):(pos.entry - exit))*portionQty; const fees=(pos.entry*portionQty + exit*portionQty)*feePct; const net=pnl-fees; equity+=net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0) rrSum+=(net/pos.risk); if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; } if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd; trades.push({ dir:pos.dir, entryTime:candles[pos.entryIdx].time, entry:pos.entry, initSL:pos.initSL, exitTime:candles[i].time, exit:exit, reason:'Flip', qty:portionQty, pnl, fees, net, rr: (Math.abs(pos.entry-pos.initSL)*portionQty>0? net/(Math.abs(pos.entry-pos.initSL)*portionQty) : null) }); pos=null;
        }
      }
    }
    if(btProgBar && btProgText){ const p = Math.round((i - sIdx) / Math.max(1, (eIdx - sIdx)) * 100); if(p%5===0){ btProgBar.style.width = p+'%'; btProgText.textContent = `Simulation ${p}%`; } }
  }
  const res = { equityFinal: equity, totalPnl: equity - conf.startCap, tradesCount: tradesCount, winrate: tradesCount? (wins/tradesCount*100):0, avgRR: tradesCount? (rrSum/tradesCount):0, profitFactor: (grossLoss<0? (grossProfit/Math.abs(grossLoss)) : (tradesCount? Infinity:0)), maxDDAbs, trades };
  return res;
}
function runBacktestSliceFor(bars, sIdx, eIdx, conf, params, collect=false){
  const lb=computeLineBreakState(bars, Math.max(1, params.nol|0));
  const prd=Math.max(2, params.prd|0);
  const pivAll=computePivots(bars, prd);
  const emaTargetCache=new Map();
  const slEmaCache=new Map();
  let pivIdx=-1;
  function advancePivotIdxTo(i){ while(pivIdx+1<pivAll.length && pivAll[pivIdx+1].idx<=i){ pivIdx++; } }
  function segAtIdx(){ if(pivIdx>=1){ const a=pivAll[pivIdx-1], b=pivAll[pivIdx]; return { a, b, dir: b.price>a.price?'up':'down' }; } return null; }
  function computeSLFromLadder(dir, entry, i){ try{ if(!(params.slEnable && Array.isArray(params.sl) && params.sl.length)) return null; const seg=segAtIdx(); const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null; const cands=[]; for(const t of params.sl){ const typ=(t&&t.type)||'Percent'; let price=null; if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B - move*r) : (B + move*r); } else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1 - p/100)) : (entry*(1 + p/100)); } else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (params.emaLen||55)),10)); let ema=slEmaCache.get(len); if(!ema){ ema=emaCalc(bars, len); slEmaCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; } if(price!=null){ if(dir==='long'){ if(price<=entry) cands.push(price); } else { if(price>=entry) cands.push(price); } } } if(!cands.length) return null; return dir==='long'? Math.max(...cands) : Math.min(...cands); }catch(_){ return null; } }
  const tpCompound = (typeof params.tpCompound==='boolean')? params.tpCompound : !!lbcOpts.tpCompound;
  const tpCloseAllLast = (typeof params.tpCloseAllLast==='boolean')? params.tpCloseAllLast : !!lbcOpts.tpCloseAllLast;
  function buildTargets(dir, entry, riskAbs, i){
    let list=[];
    if(params.tpEnable && Array.isArray(params.tp) && params.tp.length){
      const seg=segAtIdx(); const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null;
      for(let idx=0; idx<params.tp.length; idx++){
        const t=params.tp[idx]; let price=null; const typ=(t.type||'Fib');
        if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B + move*r) : (B - move*r); }
        else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1+p/100)) : (entry*(1-p/100)); }
        else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (params.emaLen||55)),10)); let ema=emaTargetCache.get(len); if(!ema){ ema=emaCalc(bars, len); emaTargetCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; }
        if(price!=null){ if((dir==='long' && price>entry) || (dir==='short' && price<entry)){
          let w=null; const q=t.qty; if(q!=null && isFinite(q)){ w = (q>1? q/100 : q); }
          list.push({price, w, srcIdx: idx});
        } }
      }
      if(dir==='long') list.sort((a,b)=>a.price-b.price); else list.sort((a,b)=>b.price-a.price);
      let sumW=0, hasW=false; for(const it of list){ if(it.w!=null && it.w>0){ sumW+=it.w; hasW=true; } }
      if(!hasW){ if(list.length){ const even=1/list.length; list=list.map(it=>({ price:it.price, w:even, srcIdx: it.srcIdx })); } else { list=[{price: (dir==='long'? entry + riskAbs*(params.tp1R||1) : entry - riskAbs*(params.tp1R||1)), w:1, srcIdx: 0}]; } }
      else { if(sumW>1){ const k=1/sumW; for(const it of list){ if(it.w!=null) it.w*=k; } } }
      if(tpCloseAllLast && list.length){ let s=0; for(const it of list){ s+=(it.w||0); } if(s<1){ list[list.length-1].w = (list[list.length-1].w||0) + (1-s); } }
      return list;
    } else {
      return [{ price: dir==='long'? (entry + riskAbs*(params.tp1R||1)) : (entry - riskAbs*(params.tp1R||1)), w:1, srcIdx: 0 }];
    }
  }
  let equity=conf.startCap; let peak=equity; let maxDDAbs=0; let grossProfit=0, grossLoss=0; let wins=0, losses=0; let rrSum=0; let tradesCount=0;
  let positions=[]; let pendingFib=null; const trades = collect? []: null; const eqPts = collect? []: null;
  const feePct=conf.fee/100; const maxPct=conf.maxPct/100; const lev=conf.lev; const baseMode=conf.base;
  function __computeQty(entry, sl){ if(!(isFinite(entry)&&isFinite(sl))) return 0; if(equity<=0) return 0; const capBase=(baseMode==='equity')?equity:conf.startCap; const budget=Math.max(0, Math.min(capBase*maxPct, equity)); const notional=budget*lev; const qty0=notional/Math.max(1e-12, entry); const riskAbs=Math.abs(entry-sl); const perUnitWorstLoss = riskAbs + ((Math.abs(entry)+Math.abs(sl)) * feePct); const qtyRisk = perUnitWorstLoss>0? (equity / perUnitWorstLoss) : 0; const q=Math.max(0, Math.min(qty0, qtyRisk)); return q; }
  function tryOpen(dir, entry, i){ let sl=computeSLFromLadder(dir, entry, i); if(sl==null){ const riskPx=entry*(params.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; } const initQty=__computeQty(entry, sl); if(initQty>1e-12 && isFinite(initQty)){ const targets=buildTargets(dir, entry, Math.abs(entry-sl), i); positions.push({ dir, entry, sl, initSL:sl, qty:initQty, initQty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets, risk: Math.abs(entry-sl)*initQty, hiSince: bars[i].high, loSince: bars[i].low, lastTpIdx: 0, tpTrailCfg: null, slTrailCfg: null }); } }
  for(let i=Math.max(1,sIdx); i<=eIdx; i++){
    if(btAbort) break; if(equity<=0) break;
    const bar=bars[i]; const trendNow=lb.trend[i]; const trendPrev=lb.trend[i-1];
    if(eqPts){ eqPts.push({ time: bar.time, equity }); }
    advancePivotIdxTo(i);
    if(trendNow!==trendPrev){
      const seg=segAtIdx(); if(seg){ const A=seg.a.price, B=seg.b.price; const up=seg.dir==='up'; const move=Math.abs(B-A); const levels=[]; if(params.ent382) levels.push(up? (B - move*0.382) : (B + move*0.382)); if(params.ent500) levels.push(up? (B - move*0.5) : (B + move*0.5)); if(params.ent618) levels.push(up? (B - move*0.618) : (B + move*0.618)); if(params.ent786) levels.push(up? (B - move*0.786) : (B + move*0.786)); pendingFib={ dir:(trendNow===1?'long':'short'), levels, mode: params.confirmMode||'Bounce' }; }
      if(params.entryMode!=='Fib Retracement'){ const dir=(trendNow===1)?'long':'short'; tryOpen(dir, bar.close, i); }
    }
    if(params.useFibRet && (params.entryMode!=='Original') && pendingFib && pendingFib.levels && pendingFib.levels.length){
      for(const lv of pendingFib.levels){ let ok=false; if(pendingFib.dir==='long'){ ok=(pendingFib.mode==='Touch')? (bar.low<=lv) : (bar.low<=lv && bar.close>lv); } else { ok=(pendingFib.mode==='Touch')? (bar.high>=lv) : (bar.high>=lv && bar.close<lv); } if(ok){ tryOpen(pendingFib.dir, bar.close, i); pendingFib=null; break; } }
    }
    for(let k=positions.length-1; k>=0; k--){
      let pos=positions[k];
      pos.hiSince = Math.max(pos.hiSince||bar.high, bar.high);
      pos.loSince = Math.min(pos.loSince||bar.low, bar.low);
      if(params.beEnable && !pos.beActive && (i - pos.entryIdx) >= params.beAfterBars){ const movePct = pos.dir==='long'? ((bar.high - pos.entry)/pos.entry*100) : ((pos.entry - bar.low)/pos.entry*100); if(movePct >= params.beLockPct){ pos.beActive=true; pos.sl = pos.entry; } }
      if(pos.tpTrailCfg){ try{ let cand=null; if(pos.tpTrailCfg.mode==='ema'){ const len=Math.max(1, parseInt((pos.tpTrailCfg.emaLen!=null? pos.tpTrailCfg.emaLen : (params.emaLen||55)),10)); const ema=emaCalc(bars, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(pos.tpTrailCfg.mode==='percent'){ const pct=Number(pos.tpTrailCfg.pct)||0; cand = (pos.dir==='long')? ( (pos.hiSince||bar.high)*(1 - pct/100) ) : ( (pos.loSince||bar.low)*(1 + pct/100) ); } if(cand!=null){ let b=cand; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(cand, pos.entry) : Math.max(cand, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }catch(_){ } }
      if(pos.slTrailCfg){ try{ let cand=null; if(pos.slTrailCfg.mode==='ema'){ const len=Math.max(1, parseInt((pos.slTrailCfg.emaLen!=null? pos.slTrailCfg.emaLen : (params.emaLen||55)),10)); const ema=emaCalc(bars, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(pos.slTrailCfg.mode==='percent'){ const pct=Number(pos.slTrailCfg.pct)||0; cand = (pos.dir==='long')? ( (pos.hiSince||bar.high)*(1 - pct/100) ) : ( (pos.loSince||bar.low)*(1 + pct/100) ); } if(cand!=null){ let b=cand; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(cand, pos.entry) : Math.max(cand, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }catch(_){ } }
      { const sl2=computeSLFromLadder(pos.dir, pos.entry, i); if(sl2!=null){ let b=sl2; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(sl2, pos.entry) : Math.max(sl2, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }
      // SL check
      let closedBySL=false;
      if(pos.dir==='long'){
        if(bar.low <= pos.sl){ const portionQty = pos.qty; const pnl = (pos.sl - pos.entry) * portionQty; const fees = (pos.entry*portionQty + pos.sl*portionQty) * feePct; const net=pnl-fees; const eqBeforeLocal=equity; equity+=net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0) rrSum+=(net/pos.risk); if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; } if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd; if(trades){ trades.push({ dir:pos.dir, entryTime:bars[pos.entryIdx].time, entry:pos.entry, initSL:pos.initSL, exitTime:bars[i].time, exit:pos.sl, reason:'SL', qty:portionQty, net, fees, rr: (Math.abs(pos.entry-pos.initSL)*portionQty>0? net/(Math.abs(pos.entry-pos.initSL)*portionQty) : null), eqBefore: eqBeforeLocal }); } closedBySL=true; }
      } else {
        if(bar.high >= pos.sl){ const portionQty = pos.qty; const pnl = (pos.entry - pos.sl) * portionQty; const fees = (pos.entry*portionQty + pos.sl*portionQty) * feePct; const net=pnl-fees; const eqBeforeLocal=equity; equity+=net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0) rrSum+=(net/pos.risk); if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; } if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd; if(trades){ trades.push({ dir:pos.dir, entryTime:bars[pos.entryIdx].time, entry:pos.entry, initSL:pos.initSL, exitTime:bars[i].time, exit:pos.sl, reason:'SL', qty:portionQty, net, fees, rr: (Math.abs(pos.entry-pos.initSL)*portionQty>0? net/(Math.abs(pos.entry-pos.initSL)*portionQty) : null), eqBefore: eqBeforeLocal }); } closedBySL=true; }
      }
      if(closedBySL){ positions.splice(k,1); continue; }
      // TP sequential for this position
      if(pos.targets && pos.tpIdx < pos.targets.length){
        while(pos && pos.tpIdx < pos.targets.length){
          const tp=pos.targets[pos.tpIdx];
          const hit = pos.dir==='long'? (bar.high >= tp.price) : (bar.low <= tp.price);
          if(!hit) break;
          const portionFrac = tpCompound? (tp.w||1) : 1;
          const portionQty = pos.initQty * portionFrac;
          const usedQty = Math.min(portionQty, pos.qty);
          const exitPx = tp.price;
          const pnl = (pos.dir==='long'? (exitPx - pos.entry) : (pos.entry - exitPx)) * usedQty;
          const fees = (pos.entry*usedQty + exitPx*usedQty) * feePct;
          const net = pnl - fees; equity += net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0) rrSum += (net/pos.risk); if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; } if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd; if(trades){ trades.push({ dir:pos.dir, entryTime:bars[pos.entryIdx].time, entry:pos.entry, initSL:pos.initSL, exitTime:bars[i].time, exit:exitPx, reason:`TP${pos.tpIdx+1}`, qty:usedQty, net, fees, rr: (Math.abs(pos.entry-pos.initSL)*usedQty>0? net/(Math.abs(pos.entry-pos.initSL)*usedQty) : null) }); }
          pos.qty -= usedQty; pos.anyTP=true;
          let tCfg = (Array.isArray(params.tp) && tp.srcIdx!=null)? params.tp[tp.srcIdx] : null; if(!tCfg){ tCfg={}; }
          if(tCfg.beOn){ pos.sl = pos.entry; }
          const slNew=(function(){ try{ const seg=segAtIdx(); const s=tCfg.sl; if(!(seg && s)) return null; let price=null; if(s.type==='Fib'){ const A=seg.a.price, B=seg.b.price; const move=Math.abs(B-A); const r=parseFloat(s.fib!=null? s.fib : s.value); if(isFinite(r)) price = (seg.dir==='up')? (B - move*r) : (B + move*r); } else if(s.type==='Percent'){ const p=parseFloat(s.pct!=null? s.pct : s.value); if(isFinite(p)) price = pos.dir==='long'? (pos.entry*(1 - p/100)) : (pos.entry*(1 + p/100)); } else if(s.type==='EMA'){ const len=Math.max(1, parseInt(((s&&s.emaLen)!=null? s.emaLen : (params.emaLen||55)),10)); const ema=emaCalc(bars, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; } return price; }catch(_){ return null; } })();
          if(slNew!=null){ let b=slNew; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(slNew, pos.entry) : Math.max(slNew, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); }
          if(tCfg.trail && tCfg.trail.mode){ let cand=null; const m=tCfg.trail.mode; if(m==='be'){ cand=pos.entry; } else if(m==='prev'){ cand=exitPx; } else if(m==='ema'){ const len=Math.max(1, parseInt(((tCfg.trail.emaLen!=null? tCfg.trail.emaLen : (params.emaLen||55))),10)); const ema=emaCalc(bars, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(m==='percent'){ const pct=Number(tCfg.trail.pct)||0; cand = (pos.dir==='long')? ( (pos.hiSince||bar.high)*(1 - pct/100) ) : ( (pos.loSince||bar.low)*(1 + pct/100) ); } if(cand!=null){ let b=cand; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(cand, pos.entry) : Math.max(cand, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } if(m==='ema' || m==='percent'){ pos.tpTrailCfg = { mode:m, emaLen: tCfg.trail.emaLen, pct: tCfg.trail.pct }; } }
          if(tCfg.sl && tCfg.sl.trail && tCfg.sl.trail.mode){ const m2=tCfg.sl.trail.mode; if(m2==='ema' || m2==='percent'){ pos.slTrailCfg = { mode:m2, emaLen: tCfg.sl.trail.emaLen, pct: tCfg.sl.trail.pct }; } }
          if(!tpCompound){ pos.qty = 0; }
          pos.tpIdx++;
          if(pos.qty<=1e-12){ break; }
        }
      }
      if(pos.qty<=1e-12){ positions.splice(k,1); }
    }
    if(btProgBar && btProgText){ const p = Math.round((i - sIdx) / Math.max(1, (eIdx - sIdx)) * 100); if(p%5===0){ btProgBar.style.width = p+'%'; btProgText.textContent = `Optimisation ${p}%`; } }
  }
  if(eqPts){ eqPts.push({ time: bars[Math.min(eIdx, bars.length-1)].time, equity }); }
  const res = { equityFinal: equity, totalPnl: equity - conf.startCap, tradesCount: tradesCount, winrate: tradesCount? (wins/tradesCount*100):0, avgRR: tradesCount? (rrSum/tradesCount):0, profitFactor: (grossLoss<0? (grossProfit/Math.abs(grossLoss)) : (tradesCount? Infinity:0)), maxDDAbs };
  if(trades) res.trades = trades;
  if(eqPts) res.eqSeries = eqPts;
  return res;
}
  try{ const btExportDetails=document.getElementById('btExportDetails');
  const btShowDetails=document.getElementById('btShowDetails');
  const btPauseBtn=document.getElementById('btPause');
  const btStopBtn=document.getElementById('btStop');
  const btAbortBtn=document.getElementById('btAbort');
  if(btPauseBtn){ btPauseBtn.addEventListener('click', ()=>{ btPaused=!btPaused; addBtLog(btPaused?'Pause':'Reprise'); if(labRunStatusEl) labRunStatusEl.textContent = btPaused? 'Pause' : 'En cours'; btPauseBtn.textContent = btPaused? 'Reprendre' : 'Pause'; }); }
  if(btStopBtn){ btStopBtn.addEventListener('click', ()=>{ btAbort=true; addBtLog('Arrêt demandé'); if(labRunStatusEl) labRunStatusEl.textContent='Arrêt'; }); }
  if(btAbortBtn){ btAbortBtn.addEventListener('click', ()=>{ btAbort=true; addBtLog('Annulation'); if(labRunStatusEl) labRunStatusEl.textContent='Arrêt'; try{ closeBtProgress(); }catch(_){ } }); }
  if(btShowDetails){ btShowDetails.addEventListener('click', ()=> openEvalsModal((labSymbolSelect&&labSymbolSelect.value)||currentSymbol, (labTFSelect&&labTFSelect.value)||currentInterval)); }
  if(btExportDetails){ btExportDetails.addEventListener('click', ()=> exportEvalsCSV()); }
}catch(_){ }
  if(btOptimizeBtn){ btOptimizeBtn.addEventListener('click', async ()=>{ try{
  const conf={ startCap: Math.max(0, parseFloat(btStartCap&&btStartCap.value||'10000')), fee: Math.max(0, parseFloat(btFee&&btFee.value||'0.1')), lev: Math.max(1, parseFloat(btLev&&btLev.value||'1')), maxPct: Math.max(0, Math.min(100, parseFloat(btMaxPct&&btMaxPct.value||'100'))), base: (btMaxBase&&btMaxBase.value)||'initial' };
  const tfSel = (document.getElementById('btOptInterval')&&document.getElementById('btOptInterval').value)||currentInterval;
  const topN = Math.max(1, parseInt((document.getElementById('btOptTopN')&&document.getElementById('btOptTopN').value)||'20',10));
  const maxComb = Math.max(1, parseInt((document.getElementById('btOptMax')&&document.getElementById('btOptMax').value)||'100',10));
  function rng(enId,minId,maxId,stepId,defMin,defMax,defStep){ const en=document.getElementById(enId); if(en && !en.checked){ return null; } const vmin=parseFloat((document.getElementById(minId)&&document.getElementById(minId).value)||String(defMin)); const vmax=parseFloat((document.getElementById(maxId)&&document.getElementById(maxId).value)||String(defMax)); const vstep=parseFloat((document.getElementById(stepId)&&document.getElementById(stepId).value)||String(defStep)); const arr=[]; for(let v=vmin; v<=vmax+1e-9; v+=vstep){ arr.push(+v.toFixed(6)); } return arr; }
  const rNol = rng('btOptNolEn','btOptNolMin','btOptNolMax','btOptNolStep',2,5,1)||[lbcOpts.nol];
  const rPrd = rng('btOptPrdEn','btOptPrdMin','btOptPrdMax','btOptPrdStep',8,34,2)||[lbcOpts.prd];
  const rSL  = rng('btOptSLEn','btOptSLMin','btOptSLMax','btOptSLStep',0.5,3.0,0.5)||[lbcOpts.slInitPct];
  const rBEb = rng('btOptBEBarsEn','btOptBEBarsMin','btOptBEBarsMax','btOptBEBarsStep',3,8,1)||[lbcOpts.beAfterBars];
  const rBEL = rng('btOptBELockEn','btOptBELockMin','btOptBELockMax','btOptBELockStep',3,10,1)||[lbcOpts.beLockPct];
  const rEMA = rng('btOptEMALenEn','btOptEMALenMin','btOptEMALenMax','btOptEMALenStep',21,89,4)||[lbcOpts.emaLen];
  let combos=[]; for(const nol of rNol){ for(const prd of rPrd){ for(const sl of rSL){ for(const be of rBEb){ for(const bel of rBEL){ for(const em of rEMA){ combos.push({ nol, prd, slInitPct:sl, beAfterBars:be, beLockPct:bel, emaLen:em }); } } } } } }
  const usePrior = !!(document.getElementById('btUseTFPrior')&&document.getElementById('btUseTFPrior').checked);
  if(usePrior){ try{ let priorArr = Array.isArray(window.labPalmaresCache)? window.labPalmaresCache.slice(0, topN) : []; if((!priorArr.length) && window.SUPA && typeof SUPA.fetchPalmares==='function'){ priorArr = await SUPA.fetchPalmares(currentSymbol, tfSel, topN); } for(const it of priorArr){ if(it&&it.params){ combos.unshift({ ...it.params }); } } }catch(_){ } }
  if(combos.length>maxComb){ const sample=[]; while(sample.length<maxComb){ const i=Math.floor(Math.random()*combos.length); sample.push(combos[i]); combos.splice(i,1); } combos=sample; }
  let bars=candles; if(tfSel!==currentInterval){ try{ bars = await fetchAllKlines(currentSymbol, tfSel, 5000); }catch(_){ bars=candles; } }
  let from=null,to=null;
  if(btRangeDates&&btRangeDates.checked){ const f=(btFrom&&btFrom.value)||''; const t=(btTo&&btTo.value)||''; from = f? Math.floor(new Date(f).getTime()/1000): null; to = t? Math.floor(new Date(t).getTime()/1000): null; }
  else if(btRangeAll&&btRangeAll.checked){ from=null; to=null; }
  else { const r=getVisibleRange(); if(r){ from=r.from; to=r.to; } }
  const idxFromTimeLocal=(bars,from,to)=>{ let s=0,e=bars.length-1; if(from!=null){ for(let i=0;i<bars.length;i++){ if(bars[i].time>=from){ s=i; break; } } } if(to!=null){ for(let j=bars.length-1;j>=0;j--){ if(bars[j].time<=to){ e=j; break; } } } return [s,e]; };
  const [sIdx,eIdx]=idxFromTimeLocal(bars,from,to);
  openBtProgress('Optimisation...'); btAbort=false; const best=[]; const weights=getWeights(localStorage.getItem('labWeightsProfile')||'balancee');
  let done=0; const total=combos.length; async function step(k){ const end=Math.min(k+5, total); for(let i=k;i<end;i++){ if(btAbort) break; const p=combos[i]; const res=runBacktestSliceFor(bars, sIdx, eIdx, conf, p); const score=scoreResult(res, weights); best.push({ score, params:p, res }); best.sort((a,b)=> b.score-a.score); if(best.length>topN){ best.length=topN; } done++; if(btProgBar&&btProgText){ const pct=Math.round(done/total*100); btProgBar.style.width=pct+'%'; btProgText.textContent=`Optimisation ${pct}% (${done}/${total})`; } }
    if(done<total && !btAbort){ setTimeout(()=> step(end), 0); } else { closeBtProgress(); closeModalEl(btModalEl); try{ await renderLabFromStorage(); await computeLabBenchmarkAndUpdate(); }catch(_){ } setStatus('Optimisation terminée'); }
  }
  step(0);
 }catch(e){ setStatus('Erreur optimisation'); }
}); }
if(btRunBtn){ btRunBtn.addEventListener('click', ()=>{ if(!candles.length){ setStatus('Aucune donnée'); return; } const conf={ startCap: Math.max(0, parseFloat(btStartCap&&btStartCap.value||'10000')), fee: Math.max(0, parseFloat(btFee&&btFee.value||'0.1')), lev: Math.max(1, parseFloat(btLev&&btLev.value||'1')), maxPct: Math.max(0, Math.min(100, parseFloat(btMaxPct&&btMaxPct.value||'100'))), base: (btMaxBase&&btMaxBase.value)||'initial' };
  let from=null, to=null; if(btRangeDates&&btRangeDates.checked){ const f=(btFrom&&btFrom.value)||''; const t=(btTo&&btTo.value)||''; from = f? Math.floor(new Date(f).getTime()/1000): null; to = t? Math.floor(new Date(t).getTime()/1000): null; } else if(btRangeAll&&btRangeAll.checked){ from=null; to=null; } else { const r=getVisibleRange(); if(r){ from=r.from; to=r.to; } }
const [sIdx,eIdx]=idxFromTime(from,to); btAbort=false; try{ clearTPHitMarkers(); clearSLHitMarkers(); clearBEHitMarkers(); }catch(_){ } openBtProgress('Préparation...'); setTimeout(()=>{ const res=runBacktestSlice(sIdx,eIdx,conf); try{ clearTPHitMarkers(); clearSLHitMarkers(); clearBEHitMarkers(); const tr = Array.isArray(res.trades)? res.trades: []; for(const ev of tr){ if(ev && ev.reason){ if(ev.reason==='SL'){ const be = Math.abs(ev.exit - ev.entry) <= 1e-8; if(be){ addBEHitMarker(ev.exitTime, ev.dir); } else { addSLHitMarker(ev.exitTime, ev.dir); } } else if(typeof ev.reason==='string' && ev.reason.startsWith('TP')){ addTPHitMarker(ev.exitTime, ev.dir); } } } }catch(_){ } renderLBC(); closeBtProgress(); closeModalEl(btModalEl); showStrategyResult(res, {symbol: currentSymbol, tf: (intervalSelect&&intervalSelect.value)||'', startCap: conf.startCap}); try{ renderLabFromStorage(); }catch(_){ } }, 20); }); }

// Strategy result modal
const stratModalEl=document.getElementById('stratModal'); const stratClose=document.getElementById('stratClose'); const stratClose2=document.getElementById('stratClose2'); const stratTitle=document.getElementById('stratTitle'); const stratTBody=document.getElementById('stratTBody'); const tradesModalEl=document.getElementById('tradesModal'); const tradesClose=document.getElementById('tradesClose'); const tradesClose2=document.getElementById('tradesClose2'); const tradesTBody=document.getElementById('tradesTBody'); const tradesCtx=document.getElementById('tradesCtx'); const tradesHdrCtx=document.getElementById('tradesHdrCtx'); let lastTradesCtx=null;
// Floating windows helpers (persist position/size)
let __winZCtr = +(localStorage.getItem('win:zCtr')||'2000');
function bumpZ(){ __winZCtr++; try{ localStorage.setItem('win:zCtr', String(__winZCtr)); }catch(_){ } return __winZCtr; }
// Modal root stacking (ensure newly opened modals are on top)
let __modalZCtr = +(localStorage.getItem('modal:zCtr')||'9000');
function bumpModalZ(){ __modalZCtr++; try{ localStorage.setItem('modal:zCtr', String(__modalZCtr)); }catch(_){ } return __modalZCtr; }
function loadWinState(key, def){ try{ const s=localStorage.getItem('win:'+key); if(s){ const o=JSON.parse(s); return { ...def, ...o }; } }catch(_){ } return { ...def }; }
function saveWinState(key, st){ try{ localStorage.setItem('win:'+key, JSON.stringify(st)); }catch(_){ } }
function ensureFloatingModal(modalEl, key, def){ try{ if(!modalEl) return; const content=modalEl.querySelector('.modal-content'); if(!content) return; if(content.dataset.floating==='1'){ return; } const backdrop=modalEl.querySelector('.modal-backdrop'); if(backdrop){ backdrop.style.display='none'; }
  modalEl.style.pointerEvents='none'; content.style.pointerEvents='auto'; content.style.position='fixed'; content.style.transform='none'; content.style.resize='both'; content.style.overflow='auto'; content.classList.add('floating-compact');
  const st=loadWinState(key, def||{left:40,top:40,width:560,height:360,zIndex:bumpZ()}); if(st.width) content.style.width=st.width+'px'; if(st.height) content.style.height=st.height+'px'; if(st.left!=null) content.style.left=st.left+'px'; if(st.top!=null) content.style.top=st.top+'px'; content.style.zIndex=String(st.zIndex||bumpZ());
  const header=content.querySelector('.modal-header'); if(header){ header.style.cursor='move'; header.addEventListener('mousedown', (ev)=>{ ev.preventDefault(); const startX=ev.clientX, startY=ev.clientY; const startLeft=parseInt(content.style.left||'0',10)||0; const startTop=parseInt(content.style.top||'0',10)||0; content.style.zIndex=String(bumpZ()); const onMove=(e)=>{ const dx=e.clientX-startX, dy=e.clientY-startY; content.style.left=(startLeft+dx)+'px'; content.style.top=(startTop+dy)+'px'; };
    const onUp=()=>{ window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); const ns={ left: parseInt(content.style.left)||0, top: parseInt(content.style.top)||0, width: parseInt(content.style.width)||content.offsetWidth, height: parseInt(content.style.height)||content.offsetHeight, zIndex: parseInt(content.style.zIndex)||bumpZ(), collapsed: (content.dataset.collapsed==='1') }; saveWinState(key, ns); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); }); header.addEventListener('dblclick', ()=>{ const col = content.dataset.collapsed==='1' ? '0' : '1'; content.dataset.collapsed = col; const stNow=loadWinState(key, def); saveWinState(key, { ...stNow, collapsed: (content.dataset.collapsed==='1') }); }); }
  try{ const ro=new ResizeObserver(()=>{ const rect=content.getBoundingClientRect(); const ns={ left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), zIndex: parseInt(content.style.zIndex)||bumpZ(), collapsed: (content.dataset.collapsed==='1') }; saveWinState(key, ns); }); ro.observe(content); }catch(_){ }
  content.addEventListener('mousedown', ()=>{ content.style.zIndex=String(bumpZ()); const stNow=loadWinState(key, def); saveWinState(key, { ...stNow, zIndex: parseInt(content.style.zIndex)||bumpZ(), collapsed: (content.dataset.collapsed==='1') }); });
  if(st && st.collapsed){ content.dataset.collapsed='1'; try{ const header=content.querySelector('.modal-header'); const prevW = (parseInt(content.style.width)||content.offsetWidth||0); const prevH = (parseInt(content.style.height)||content.offsetHeight||0); content.dataset.prevW = String(prevW); content.dataset.prevH = String(prevH); const h = header? (header.offsetHeight||40) : 40; content.style.height = h+'px'; content.style.overflow='hidden'; }catch(_){ } }
  content.dataset.floating='1'; }catch(_){ } }
function showStrategyResult(res, ctx){ if(stratTitle){ stratTitle.textContent = `${symbolToDisplay(ctx.symbol)} • ${ctx.tf} — Résultats`; } if(stratTBody){ const rows=[]; const prof=(localStorage.getItem('labWeightsProfile')||'balancee'); const w=getWeights(prof); const score=scoreResult(res, w); rows.push(`<tr><td style=\"text-align:left\">Score (profil: ${prof})</td><td>${score.toFixed(2)}</td><td style=\"text-align:right\">—</td></tr>`);
  rows.push(`<tr><td style=\"text-align:left\">Profit factor</td><td>—</td><td style=\"text-align:right\">${(res.profitFactor===Infinity?'∞':res.profitFactor.toFixed(2))}</td></tr>`);
  rows.push(`<tr><td style=\"text-align:left\">Trades</td><td>—</td><td style=\"text-align:right\">${res.tradesCount}</td></tr>`);
  rows.push(`<tr><td style=\"text-align:left\">Win %</td><td>—</td><td style=\"text-align:right\">${res.winrate.toFixed(1)}%</td></tr>`);
  rows.push(`<tr><td style=\"text-align:left\">Avg RR</td><td>—</td><td style=\"text-align:right\">${Number.isFinite(res.avgRR)? res.avgRR.toFixed(2): '—'}</td></tr>`);
  rows.push(`<tr><td style=\"text-align:left\">P&L net</td><td>—</td><td style=\"text-align:right\">${res.totalPnl.toFixed(2)}</td></tr>`);
  rows.push(`<tr><td style=\"text-align:left\">Cap. final</td><td>—</td><td style=\"text-align:right\">${res.equityFinal.toFixed(2)}</td></tr>`);
  rows.push(`<tr><td style=\"text-align:left\">Max DD (abs)</td><td>—</td><td style=\"text-align:right\">${res.maxDDAbs.toFixed(2)}</td></tr>`);
  stratTBody.innerHTML = rows.join(''); }
try{ let startCap = ctx && ctx.startCap != null ? ctx.startCap : undefined; if(startCap==null && Number.isFinite(res?.equityFinal) && Number.isFinite(res?.totalPnl)){ startCap = res.equityFinal - res.totalPnl; }
    lastTradesCtx = { trades: Array.isArray(res.trades)? res.trades: [], symbol: ctx.symbol, tf: ctx.tf, startCap, equityFinal: res.equityFinal, totalPnl: res.totalPnl };
    refreshUsdcEurRate(false).then(()=> populateTradesModal(lastTradesCtx)).catch(()=> populateTradesModal(lastTradesCtx)); }catch(_){ }
  openModalEl(stratModalEl); openModalEl(tradesModalEl);
  try{ ensureFloatingModal(stratModalEl, 'strat', { left: 40, top: 40, width: 480, height: 300, zIndex: 2100 }); ensureFloatingModal(tradesModalEl, 'trades', { left: 540, top: 40, width: 720, height: 360, zIndex: 2101 }); }catch(_){ }
}
if(stratClose){ stratClose.addEventListener('click', ()=> closeModalEl(stratModalEl)); }
if(stratClose2){ stratClose2.addEventListener('click', ()=> closeModalEl(stratModalEl)); }
// Collapse buttons (next to close cross)
function toggleCollapse(modalEl, key, def){ if(!modalEl) return; const content=modalEl.querySelector('.modal-content'); if(!content) return; const header=content.querySelector('.modal-header'); const isCollapsed=content.dataset.collapsed==='1'; if(!isCollapsed){ // collapse
    content.dataset.prevW = String(parseInt(content.style.width)||content.offsetWidth||0);
    content.dataset.prevH = String(parseInt(content.style.height)||content.offsetHeight||0);
    content.dataset.collapsed='1';
    const h = header? (header.offsetHeight||40) : 40;
    content.style.height = h+'px';
    content.style.overflow = 'hidden';
    const stNow=loadWinState(key, def);
    saveWinState(key, { ...stNow, collapsed:true });
  } else { // expand
    content.dataset.collapsed='0';
    const pw = content.dataset.prevW, ph = content.dataset.prevH;
    if(pw && +pw>0){ content.style.width = pw+'px'; }
    if(ph && +ph>0){ content.style.height = ph+'px'; }
    content.style.overflow = 'auto';
    const stNow=loadWinState(key, def);
    saveWinState(key, { ...stNow, collapsed:false });
  } }
try{
  const stratCollapseBtn=document.getElementById('stratCollapse');
  if(stratCollapseBtn && stratModalEl){ stratCollapseBtn.addEventListener('click', ()=> toggleCollapse(stratModalEl, 'strat', { left: 40, top: 40, width: 480, height: 300, zIndex: bumpZ() })); }
  const tradesCollapseBtn=document.getElementById('tradesCollapse');
  if(tradesCollapseBtn && tradesModalEl){ tradesCollapseBtn.addEventListener('click', ()=> toggleCollapse(tradesModalEl, 'trades', { left: 540, top: 40, width: 720, height: 360, zIndex: bumpZ() })); }
}catch(_){ }
function populateTradesModal(state){ try{ const t=(state&&state.trades)||[]; if(tradesCtx){ tradesCtx.textContent = ''; tradesCtx.style.display='none'; } if(!tradesTBody){ return; } if(!t.length){ tradesTBody.innerHTML = '<tr><td colspan=\"10\">Aucun trade</td></tr>'; if(tradesHdrCtx){ tradesHdrCtx.textContent = `${symbolToDisplay(state?.symbol||currentSymbol)} • ${(state?.tf||'')}`; } return; }
  // Helpers
  const fmt=(ts)=>{ try{ return new Date(ts*1000).toLocaleString(); }catch(_){ return String(ts); } };
  const fmtDurHMS=(secs)=>{ secs=Math.max(0, Math.floor(secs)); const h=Math.floor(secs/3600); const m=Math.floor((secs%3600)/60); const s=secs%60; const parts=[]; if(h) parts.push(`${h}h`); if(m||h) parts.push(`${m}m`); parts.push(`${s}s`); return parts.join(' '); };
const getEurRate=()=> getUsdcEurRate();
  const usdEur = (x)=> (Number.isFinite(x)? x*getEurRate(): NaN);
  const fmtUsdEur=(x)=>{ if(!Number.isFinite(x)) return ''; const eur=usdEur(x); const usdStr = `$${Math.abs(x).toFixed(2)}`; const eurStr = `${Number.isFinite(eur)? Math.abs(eur).toFixed(2):'—'} €`; const sign = x<0? '-' : ''; return `${sign}${usdStr} ${sign}${eurStr}`; };
  const eventLabel=(ev,g)=>{ const r=(ev?.reason||''); if(r.startsWith('TP')) return r; if(r==='SL') return 'SL'; if(r==='Flip') return 'Close'; if(!r && g) return (g.dir==='long'?'Long':'Short'); return r; };
  // Compute equity after each event (timeline)
  let startCap = (state && state.startCap!=null)? Number(state.startCap): undefined; if(!(Number.isFinite(startCap))){ const ef=Number(state?.equityFinal), tp=Number(state?.totalPnl); if(Number.isFinite(ef) && Number.isFinite(tp)){ startCap = ef - tp; } }
  if(!Number.isFinite(startCap)) startCap = 0;
  const sorted = t.slice().sort((a,b)=> (a.exitTime||0)-(b.exitTime||0)); let eq = startCap; for(const ev of sorted){ const net=Number(ev.net)||0; eq += net; ev.__equityAfter = eq; }
  const idxMap = new Map(); for(let i=0;i<sorted.length;i++){ idxMap.set(sorted[i], i); }
  // Group events by position (parent row), then render sub-rows per event
  function groupTradesByPosition(events){ const map=new Map(); let gid=1; function keyOf(e){ return `${e.dir}|${e.entryTime}|${e.entry}|${e.initSL}`; }
    for(const ev of events){ const k=keyOf(ev); let g=map.get(k); if(!g){ g={ id:'g'+(gid++), dir:ev.dir, entryTime:ev.entryTime, entry:ev.entry, initSL:ev.initSL, events:[] }; map.set(k,g); }
      g.events.push(ev); }
    const arr=[...map.values()]; for(const g of arr){ g.events.sort((a,b)=> (a.exitTime||0)-(b.exitTime||0)); g.firstEv = g.events[0]||null; const idx = g.firstEv? (idxMap.get(g.firstEv) ?? sorted.indexOf(g.firstEv)) : -1; g.capEntry = (idx>0? Number(sorted[idx-1].__equityAfter) : startCap) || startCap; g.exitTime = g.events.length? g.events[g.events.length-1].exitTime : null; g.exit = g.events.length? g.events[g.events.length-1].exit : null; g.net = g.events.reduce((s,e)=> s + (Number(e.net)||0), 0); g.qty = g.events.reduce((s,e)=> s + (Number(e.qty)||0), 0); g.feesSum = g.events.reduce((s,e)=> s + (Number(e.fees)||0), 0); }
    return arr; }
const groups = groupTradesByPosition(t);
  // Header context: trades count, events count, period, total P&L
  try{
    const totalTrades = groups.length;
    const totalEvents = t.filter(ev=> ev && (ev.reason==='SL' || (typeof ev.reason==='string' && ev.reason.startsWith('TP')))).length;
    let minTs = Infinity, maxTs = -Infinity;
    for(const ev of t){ if(Number.isFinite(ev.entryTime) && ev.entryTime<minTs) minTs=ev.entryTime; if(Number.isFinite(ev.exitTime) && ev.exitTime>maxTs) maxTs=ev.exitTime; }
    const totalNet = groups.reduce((s,g)=> s + (Number(g.net)||0), 0);
if(tradesHdrCtx){ const periodStr = (minTs<Infinity && maxTs>-Infinity)? `${fmt(minTs)} → ${fmt(maxTs)}` : '—'; tradesHdrCtx.textContent = `${symbolToDisplay(state?.symbol||currentSymbol)} • ${(state?.tf||'')} — ${periodStr} • P&L total: ${fmtUsdEur(totalNet)}`; }
  }catch(_){ }
  // Sort groups chronologically to assign numbers (oldest = #1), then display most recent first
  const groupsAsc = groups.slice().sort((a,b)=> (a.entryTime||0)-(b.entryTime||0));
  for(let i=0;i<groupsAsc.length;i++){ groupsAsc[i]._num = i+1; }
  const groupsDesc = groupsAsc.slice().reverse();
  const rows=[];
  for(const g of groupsDesc){
    // Parent row (position summary)
    const durParent = (g.exitTime && g.entryTime)? fmtDurHMS((g.exitTime - g.entryTime)) : '—';
    const pnlPctParent = (g.capEntry>0 && Number.isFinite(g.net))? ((g.net/g.capEntry)*100) : NaN;
    const qtyValPar = (Number.isFinite(g.qty) && Number.isFinite(g.entry))? g.qty*g.entry : NaN;
    const qtyCellPar = Number.isFinite(g.qty)? `${g.qty.toFixed(6)}${Number.isFinite(qtyValPar)? ' ('+fmtUsdEur(qtyValPar)+')':''}` : '';
    rows.push(`<tr class=\"trade-parent\" data-type=\"parent\" data-id=\"${g.id}\" data-expanded=\"0\">`+
      `<td style=\"text-align:left;\">${g._num||''}</td>`+
      `<td>${fmt(g.entryTime||0)}</td>`+
      `<td>${fmtUsdEur(g.capEntry)}</td>`+
      `<td class=\"${(g.dir==='long'?'dir-long':'dir-short')}\">${(g.dir==='long'?'Long':'Short')}</td>`+
      `<td>${qtyCellPar}</td>`+
      `<td>${fmtUsdEur(g.entry)}</td>`+
      `<td>${fmtUsdEur(g.exit)}</td>`+
      `<td>${fmtUsdEur(g.feesSum)}</td>`+
      `<td>${fmtUsdEur(g.net)}${Number.isFinite(pnlPctParent)? ` (<span class=\"${(pnlPctParent>0?'pnl-pos':(pnlPctParent<0?'pnl-neg':'pnl-zero'))}\">${pnlPctParent.toFixed(2)}%</span>)` : ''}</td>`+
      `<td>${durParent}</td>`+
    `</tr>`);
    // Children event rows
    let eidx=1; for(const ev of g.events){ const dur = (ev.exitTime && ev.entryTime)? fmtDurHMS((ev.exitTime - ev.entryTime)) : '—'; const pnlPct = (g.capEntry>0 && Number.isFinite(ev.net))? ((ev.net/g.capEntry)*100) : NaN; const isClose = (ev === g.events[g.events.length-1]); const capClose = (Number.isFinite(g.capEntry)&&Number.isFinite(g.net))? (g.capEntry + g.net) : NaN; const capCell = isClose? fmtUsdEur(capClose) : fmtUsdEur(g.capEntry); const qtyValCh = (Number.isFinite(ev.qty) && Number.isFinite(ev.entry))? ev.qty*ev.entry : NaN; const qtyCellCh = Number.isFinite(ev.qty)? `${ev.qty.toFixed(6)}${Number.isFinite(qtyValCh)? ' ('+fmtUsdEur(qtyValCh)+')':''}` : '';
      rows.push(`<tr class=\"trade-event subrow\" data-type=\"child\" data-parent=\"${g.id}\" style=\"display:none;\">`+
        `<td style=\"text-align:left; padding-left:18px; color:var(--muted);\">↳</td>`+
        `<td>${fmt(ev.exitTime||0)}</td>`+
        `<td>${capCell}</td>`+
        `<td class=\"${(g.dir==='long'?'dir-long':'dir-short')}\">${eventLabel(ev)}</td>`+
        `<td>${qtyCellCh}</td>`+
        `<td>${fmtUsdEur(ev.entry)}</td>`+
        `<td>${fmtUsdEur(ev.exit)}</td>`+
        `<td>${fmtUsdEur(ev.fees)}</td>`+
        `<td>${fmtUsdEur(ev.net)}${Number.isFinite(pnlPct)? ` (<span class=\"${(pnlPct>0?'pnl-pos':(pnlPct<0?'pnl-neg':'pnl-zero'))}\">${pnlPct.toFixed(2)}%</span>)` : ''}</td>`+
        `<td>${dur}</td>`+
      `</tr>`); }
  }
  tradesTBody.innerHTML = rows.join('');
  if(!tradesTBody.dataset || tradesTBody.dataset.expandWired!=='1'){
    tradesTBody.addEventListener('click', (e)=>{ const tr=e.target&&e.target.closest? e.target.closest('tr[data-type=\"parent\"]'):null; if(!tr) return; const id=tr.getAttribute('data-id'); const exp = tr.getAttribute('data-expanded')==='1'; tr.setAttribute('data-expanded', exp?'0':'1'); const children = tradesTBody.querySelectorAll('tr[data-parent=\"'+id+'\"]'); children.forEach(r=>{ r.style.display = exp? 'none':'table-row'; }); const caret = tr.querySelector('.caret'); if(caret){ caret.style.transform = exp? 'rotate(0deg)':'rotate(90deg)'; }
    });
    tradesTBody.dataset.expandWired='1';
  }
 }catch(_){ } }
if(tradesClose){ tradesClose.addEventListener('click', ()=> closeModalEl(tradesModalEl)); }
if(tradesClose2){ tradesClose2.addEventListener('click', ()=> closeModalEl(tradesModalEl)); }
if(tradesModalEl){ tradesModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close){ closeModalEl(tradesModalEl); } }); }
// Evals modal close
try{ const evalsClose=document.getElementById('evalsClose'); if(evalsClose){ evalsClose.addEventListener('click', ()=> closeModalEl(document.getElementById('evalsModal'))); } }catch(_){ }

// Strategy detail modal
const detailModalEl=document.getElementById('detailModal'); const detailClose=document.getElementById('detailClose'); const detailCtxEl=document.getElementById('detailCtx');
const canRadar=document.getElementById('detailRadar'); const canEquity=document.getElementById('detailEquity'); const canDD=document.getElementById('detailDD'); const canHist=document.getElementById('detailHist'); const canEff=document.getElementById('detailEff'); const canRob=document.getElementById('detailRobust');
const canRollPF=document.getElementById('detailRollPF'); const canRollWin=document.getElementById('detailRollWin'); const canRollRR=document.getElementById('detailRollRR'); const canRollExp=document.getElementById('detailRollExp');
const canDur=document.getElementById('detailDurHist'); const canStreaks=document.getElementById('detailStreaks'); const canLS=document.getElementById('detailLSHist');
const canMAEMFE=document.getElementById('detailMAEMFE'); const canWeekly=document.getElementById('detailWeekly'); const canDOW=document.getElementById('detailDOW'); const canDOWHour=document.getElementById('detailDOWHour'); const canDOWHourLong=document.getElementById('detailDOWHourLong'); const canDOWHourShort=document.getElementById('detailDOWHourShort'); const canRegime=document.getElementById('detailRegime'); const canWF=document.getElementById('detailWF'); const canCIs=document.getElementById('detailCIs');
const canPareto=document.getElementById('detailPareto'); const canMC=document.getElementById('detailMC'); const canQQ=document.getElementById('detailQQ'); const canACF=document.getElementById('detailACF');
const detailSummaryEl = document.getElementById('detailSummaryBody');
if(detailClose){ detailClose.addEventListener('click', ()=> closeModalEl(detailModalEl)); }
if(detailModalEl){ detailModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close){ closeModalEl(detailModalEl); } }); }
// Simple Lab detail modal (empty)
try{
  const labSimpleDetailModal=document.getElementById('labSimpleDetailModal');
  const labSimpleDetailClose=document.getElementById('labSimpleDetailClose');
  if(labSimpleDetailClose){ labSimpleDetailClose.addEventListener('click', ()=> closeModalEl(labSimpleDetailModal)); }
  if(labSimpleDetailModal){ labSimpleDetailModal.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close){ closeModalEl(labSimpleDetailModal); } }); }
}catch(_){ }

function __drawText(ctx, x, y, txt, align='left'){ ctx.save(); ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg')||'#111827'; ctx.font='12px Segoe UI, Arial'; ctx.textAlign=align; ctx.textBaseline='middle'; ctx.fillText(txt, x, y); ctx.restore(); }
function __clr(){ const cs=getComputedStyle(document.documentElement); return { fg: cs.getPropertyValue('--fg')||'#111827', muted: cs.getPropertyValue('--muted')||'#6b7280', border: cs.getPropertyValue('--header-border')||'#e5e7eb' }; }
// Tooltip helper
function ensureTooltip(){ let el=document.getElementById('detailTooltip'); if(el) return el; el=document.createElement('div'); el.id='detailTooltip'; el.style.position='fixed'; el.style.pointerEvents='none'; el.style.background='rgba(0,0,0,0.75)'; el.style.color='#fff'; el.style.fontSize='12px'; el.style.padding='4px 6px'; el.style.borderRadius='4px'; el.style.zIndex='2000'; el.style.display='none'; document.body.appendChild(el); return el; }
function showTip(x,y,html){ const el=ensureTooltip(); el.innerHTML=html; el.style.left=(x+12)+'px'; el.style.top=(y+12)+'px'; el.style.display='block'; }
function hideTip(){ const el=ensureTooltip(); el.style.display='none'; }
function drawRadar(canvas, labels, vals){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 14, 'Radar critères (0–100)', 'center'); const cx=w/2, cy=h/2+10, R=Math.min(w,h)/2-30; const n=labels.length; ctx.strokeStyle=__clr().border; ctx.lineWidth=1; for(let r=0;r<=4;r++){ const rr=R*(r/4); ctx.beginPath(); for(let k=0;k<n;k++){ const ang = -Math.PI/2 + 2*Math.PI*k/n; const x=cx+rr*Math.cos(ang), y=cy+rr*Math.sin(ang); if(k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); } ctx.closePath(); ctx.stroke(); __drawText(ctx, cx+rr+2, cy, String(r*25), 'left'); }
  for(let k=0;k<n;k++){ const ang=-Math.PI/2 + 2*Math.PI*k/n; const x=cx+(R+10)*Math.cos(ang), y=cy+(R+10)*Math.sin(ang); __drawText(ctx, x, y, labels[k], (Math.cos(ang)>0?'left':(Math.cos(ang)<0?'right':'center'))); }
  ctx.beginPath(); for(let k=0;k<n;k++){ const v=Math.max(0,Math.min(100, vals[k]||0))/100; const ang=-Math.PI/2 + 2*Math.PI*k/n; const x=cx+R*v*Math.cos(ang), y=cy+R*v*Math.sin(ang); if(k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); } ctx.closePath(); ctx.fillStyle='rgba(37,99,235,0.25)'; ctx.strokeStyle='#2563eb'; ctx.lineWidth=2; ctx.fill(); ctx.stroke(); }
function drawEquity(canvas, eq){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); if(!eq||!eq.length) return; __drawText(ctx, w/2, 12, 'Équity (USD) — ligne bleue; zones rouges = drawdown', 'center'); const padL=46, padR=18, padT=20, padB=22; const min=Math.min(...eq.map(p=>p.equity)); const max=Math.max(...eq.map(p=>p.equity)); const x=(i)=> i/(eq.length-1)*(w-padL-padR)+padL; const y=(v)=> h-padB - (v-min)/(max-min+1e-9)*(h-padT-padB); // axes
  ctx.strokeStyle=__clr().border; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); // y ticks
  const ticks=4; for(let t=0;t<=ticks;t++){ const val=min + (max-min)*t/ticks; const yy=y(val); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL-3, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, padL-6, yy, val.toFixed(0), 'right'); }
  // dd shading and equity
  let peak=-Infinity; ctx.fillStyle='rgba(239,68,68,0.18)'; for(let i=0;i<eq.length;i++){ peak=Math.max(peak, eq[i].equity); const dd=peak-eq[i].equity; if(dd>0){ const xx=x(i); ctx.fillRect(xx-1, y(peak), 2, Math.max(0, y(eq[i].equity)-y(peak))); } }
  ctx.strokeStyle='#2563eb'; ctx.lineWidth=2; ctx.beginPath(); for(let i=0;i<eq.length;i++){ const xx=x(i), yy=y(eq[i].equity); if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); } ctx.stroke(); __drawText(ctx, padL, h-6, 'Temps →', 'left'); }
function drawEquityCompare(canvas, eq1, eq2){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); if(!eq1||!eq1.length) return; const all=eq2&&eq2.length? eq1.concat(eq2) : eq1; __drawText(ctx, w/2, 12, 'Équity (comparaison: bleu = sélection, orange = Heaven)', 'center'); const padL=46, padR=18, padT=20, padB=22; const min=Math.min(...all.map(p=>p.equity)); const max=Math.max(...all.map(p=>p.equity)); const n1=eq1.length, n2=(eq2&&eq2.length)||0; const x1=(i)=> i/(n1-1)*(w-padL-padR)+padL; const x2=(i)=> i/(n2-1)*(w-padL-padR)+padL; const y=(v)=> h-padB - (v-min)/(max-min+1e-9)*(h-padT-padB);
  ctx.strokeStyle=__clr().border; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke();
  const ticks=4; for(let t=0;t<=ticks;t++){ const val=min + (max-min)*t/ticks; const yy=y(val); ctx.beginPath(); ctx.moveTo(padL-3, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, padL-6, yy, val.toFixed(0), 'right'); }
  // shade for eq1
  let peak=-Infinity; ctx.fillStyle='rgba(239,68,68,0.18)'; for(let i=0;i<eq1.length;i++){ peak=Math.max(peak, eq1[i].equity); const dd=peak-eq1[i].equity; if(dd>0){ const xx=x1(i); ctx.fillRect(xx-1, y(peak), 2, Math.max(0, y(eq1[i].equity)-y(peak))); } }
  // line 1
  ctx.strokeStyle='#2563eb'; ctx.lineWidth=2; ctx.beginPath(); for(let i=0;i<n1;i++){ const xx=x1(i), yy=y(eq1[i].equity); if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); } ctx.stroke();
  // line 2
  if(eq2&&n2>1){ ctx.strokeStyle='#f59e0b'; ctx.lineWidth=2; ctx.beginPath(); for(let i=0;i<n2;i++){ const xx=x2(i), yy=y(eq2[i].equity); if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); } ctx.stroke(); }
  __drawText(ctx, padL, h-6, 'Temps →', 'left'); }
function drawDD(canvas, eq){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); if(!eq||!eq.length) return; __drawText(ctx, w/2, 12, 'Drawdown absolu', 'center'); let peak=-Infinity; const maxDD=Math.max(1e-9, ...eq.map(p=>{ peak=Math.max(peak, p.equity); return peak-p.equity; })); peak=-Infinity; const padL=30, padR=10, padT=18, padB=14; for(let i=0;i<eq.length;i++){ peak=Math.max(peak, eq[i].equity); const dd=peak-eq[i].equity; const xx=i/(eq.length-1)*(w-padL-padR)+padL; const hh=(dd/maxDD)*(h-padT-padB); ctx.fillStyle='rgba(239,68,68,0.65)'; ctx.fillRect(xx-1, h-padB-hh, 2, hh); } __drawText(ctx, padL, h-4, 'Temps →', 'left'); __drawText(ctx, w-6, 16, `Max: ${maxDD.toFixed(0)}`, 'right'); }
function drawUnderwater(canvas, eq){ if(!canvas||!eq||!eq.length) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Underwater (drawdown %)', 'center'); const padL=46, padR=12, padT=20, padB=22; let peak=eq[0].equity||0; const uw=eq.map(p=>{ peak=Math.max(peak, p.equity||0); const dd=peak>0? ((p.equity-peak)/peak*100) : 0; return dd; }); const min=Math.min(0, ...uw), max=0; const x=(i)=> i/(uw.length-1)*(w-padL-padR)+padL; const y=(v)=> h-padB - (v-min)/(max-min+1e-9)*(h-padT-padB); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); ctx.fillStyle='rgba(239,68,68,0.5)'; for(let i=0;i<uw.length;i++){ const xx=x(i); const yy=y(Math.min(0, uw[i])); ctx.fillRect(xx-1, yy, 2, Math.max(0, y(min)-yy)); } __drawText(ctx, padL, h-6, 'Temps →', 'left'); }
function drawHist(canvas, data){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); if(!data||!data.length) return; const min=Math.min(...data), max=Math.max(...data); const bins=20; const step=(max-min)/(bins||1)||1; const hist=new Array(bins).fill(0); for(const v of data){ let b=Math.floor((v-min)/step); if(b<0) b=0; if(b>=bins) b=bins-1; hist[b]++; } const mcount=Math.max(...hist); __drawText(ctx, w/2, 12, 'Distribution des rendements (%)', 'center'); // axes
  const padL=36, padR=10, padT=18, padB=22; ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); // draw bars
  for(let i=0;i<bins;i++){ const xx=i/bins*(w-padL-padR)+padL; const hh= (hist[i]/(mcount||1))*(h-padT-padB); ctx.fillStyle='#2563eb'; ctx.fillRect(xx, h-padB-hh, (w-padL-padR)/bins-2, hh); }
  // x labels min/0/max
  __drawText(ctx, padL, h-6, `${min.toFixed(2)}%`, 'left'); __drawText(ctx, w/2, h-6, '0%', 'center'); __drawText(ctx, w-8, h-6, `${max.toFixed(2)}%`, 'right'); }
function drawBars(canvas, labels, vals){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Efficacité de la stratégie (0–100)', 'center'); const n=labels.length; // grid
  ctx.strokeStyle=__clr().border; for(let g=0; g<=5; g++){ const x=120 + (w-140)*(g/5); ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, h-10); ctx.stroke(); __drawText(ctx, x, h-4, String(g*20)+'%', 'center'); }
  for(let i=0;i<n;i++){ const y=24+i*((h-36)/n); const val=Math.max(0,Math.min(100, vals[i]||0)); ctx.fillStyle='#e5e7eb'; ctx.fillRect(120, y, w-140, 12); ctx.fillStyle='#2563eb'; ctx.fillRect(120, y, (w-140)*val/100, 12); __drawText(ctx, 110, y+6, String(val.toFixed(0))+'%', 'right'); __drawText(ctx, 10, y+6, labels[i], 'left'); } }

function drawLineChart(canvas, data, opts){ if(!canvas||!Array.isArray(data)||data.length<2) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); const title=opts&&opts.title||'Rolling'; const padL=40, padR=10, padT=18, padB=20; const min=Math.min(...data), max=Math.max(...data); const yMin=(opts&&opts.yMin!=null)?opts.yMin:min; const yMax=(opts&&opts.yMax!=null)?opts.yMax:max; const x=(i)=> i/(data.length-1)*(w-padL-padR)+padL; const y=(v)=> h-padB - (v-yMin)/(yMax-yMin+1e-9)*(h-padT-padB); __drawText(ctx, w/2, 12, title, 'center'); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); const ticks=4; for(let t=0;t<=ticks;t++){ const val=yMin + (yMax-yMin)*t/ticks; const yy=y(val); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL-3, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, padL-6, yy, (opts&&opts.fmt?opts.fmt(val):val.toFixed(2)), 'right'); } ctx.strokeStyle='#2563eb'; ctx.lineWidth=2; ctx.beginPath(); for(let i=0;i<data.length;i++){ const xx=x(i), yy=y(data[i]); if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); } ctx.stroke(); __drawText(ctx, padL, h-4, 'Trades →', 'left'); }

function drawDurations(canvas, arrMin){ if(!canvas||!Array.isArray(arrMin)||!arrMin.length) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Durée des trades (minutes)', 'center'); const padL=46, padR=12, padT=18, padB=24; const sorted=arrMin.slice().sort((a,b)=>a-b); const p95=sorted[Math.floor(sorted.length*0.95)]||sorted[sorted.length-1]; const maxVal=Math.max(1, p95); const bins=20; const hist=new Array(bins).fill(0); for(const v of arrMin){ const c=Math.min(v, maxVal); let b=Math.floor(c/maxVal*(bins)); if(b>=bins) b=bins-1; hist[b]++; }
  ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); const mcount=Math.max(...hist,1); const ticks=4; for(let t=0;t<=ticks;t++){ const yy=h-padB - (h-padT-padB)*t/ticks; const val=Math.round(mcount*t/ticks); ctx.beginPath(); ctx.moveTo(padL-3, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, padL-8, yy, String(val), 'right'); }
  for(let i=0;i<bins;i++){ const xx=i/bins*(w-padL-padR)+padL; const hh=(hist[i]/mcount)*(h-padT-padB); ctx.fillStyle='#2563eb'; ctx.fillRect(xx, h-padB-hh, (w-padL-padR)/bins-2, hh); } __drawText(ctx, padL, h-8, '0', 'left'); __drawText(ctx, w-8, h-8, `${maxVal.toFixed(0)}+`, 'right'); }

function drawStreaks(canvas, winCounts, loseCounts){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Séquences victoires/défaites', 'center'); const padL=46, padR=12, padT=18, padB=24; const maxLen=Math.max(winCounts.length, loseCounts.length); const maxVal=Math.max(1, ...winCounts, ...loseCounts); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); const ticks=4; for(let t=0;t<=ticks;t++){ const yy=h-padB - (h-padT-padB)*t/ticks; const val=Math.round(maxVal*t/ticks); ctx.beginPath(); ctx.moveTo(padL-3, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, padL-8, yy, String(val), 'right'); }
  const barW=(w-padL-padR)/Math.max(1,maxLen); for(let i=0;i<maxLen;i++){ const x0=padL+i*barW; const wHalf=barW/2-2; const wv=winCounts[i]||0, lv=loseCounts[i]||0; const hhW = (wv/maxVal)*(h-padT-padB); const hhL = (lv/maxVal)*(h-padT-padB); ctx.fillStyle='#10b981'; ctx.fillRect(x0+2, h-padB-hhW, wHalf, hhW); ctx.fillStyle='#ef4444'; ctx.fillRect(x0+2+wHalf, h-padB-hhL, wHalf, hhL); __drawText(ctx, x0+barW/2, h-8, String(i), 'center'); } __drawText(ctx, w-8, padT+2, 'Vert: Win  Rouge: Loss', 'right'); }

function drawHistLongShort(canvas, longs, shorts){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Distribution retours (%) — Long vs Short', 'center'); const padL=46, padR=12, padT=18, padB=24; const all=longs.concat(shorts); if(!all.length) return; const min=Math.min(...all), max=Math.max(...all); const bins=20; const step=(max-min)/(bins||1)||1; const histL=new Array(bins).fill(0), histS=new Array(bins).fill(0); for(const v of longs){ let b=Math.floor((v-min)/step); if(b<0) b=0; if(b>=bins) b=bins-1; histL[b]++; } for(const v of shorts){ let b=Math.floor((v-min)/step); if(b<0) b=0; if(b>=bins) b=bins-1; histS[b]++; } const mcount=Math.max(1, ...histL, ...histS); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); const ticks=4; for(let t=0;t<=ticks;t++){ const yy=h-padB - (h-padT-padB)*t/ticks; const val=Math.round(mcount*t/ticks); ctx.beginPath(); ctx.moveTo(padL-3, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, padL-8, yy, String(val), 'right'); }
  for(let i=0;i<bins;i++){ const xx=i/bins*(w-padL-padR)+padL; const hhL=(histL[i]/mcount)*(h-padT-padB); const hhS=(histS[i]/mcount)*(h-padT-padB); const bw=(w-padL-padR)/bins-3; ctx.fillStyle='rgba(16,185,129,0.6)'; ctx.fillRect(xx, h-padB-hhL, bw, hhL); ctx.fillStyle='rgba(239,68,68,0.6)'; ctx.fillRect(xx, h-padB-hhS, bw, hhS); }
  __drawText(ctx, padL, h-8, `${min.toFixed(2)}%`, 'left'); __drawText(ctx, w-8, h-8, `${max.toFixed(2)}%`, 'right'); __drawText(ctx, w-8, padT+2, 'Vert: Long  Rouge: Short', 'right'); }

function drawMAEMFEScatter(canvas, points){ if(!canvas||!points||!points.length) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'MAE/MFE Scatter (R units)', 'center'); const padL=46, padR=12, padT=20, padB=28; const maxX=Math.max(1, ...points.map(p=>p.maeR)); const maxY=Math.max(1, ...points.map(p=>p.mfeR)); const x=(v)=> padL + (v/Math.max(1e-9,maxX))*(w-padL-padR); const y=(v)=> h-padB - (v/Math.max(1e-9,maxY))*(h-padT-padB); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); const ticks=4; for(let t=0;t<=ticks;t++){ const xx=padL + (w-padL-padR)*t/ticks; const yy=h-padB - (h-padT-padB)*t/ticks; ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, h-padB); ctx.stroke(); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, xx, h-8, (maxX*t/ticks).toFixed(1), 'center'); __drawText(ctx, padL-8, yy, (maxY*t/ticks).toFixed(1), 'right'); }
  __drawText(ctx, w-8, h-8, 'MAE (R) →', 'right'); __drawText(ctx, padL+2, padT, 'MFE (R) ↑', 'left'); __drawText(ctx, w-8, padT+2, 'Vert = Gain  Rouge = Perte', 'right');
  for(const p of points){ const col = p.win? 'rgba(16,185,129,0.85)' : 'rgba(239,68,68,0.85)'; ctx.fillStyle=col; const xx=x(p.maeR), yy=y(p.mfeR); ctx.beginPath(); ctx.arc(xx, yy, 3, 0, Math.PI*2); ctx.fill(); }
}

function drawMonthlyHeatmap(canvas, cells){ if(!canvas||!cells||!cells.length) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Monthly returns (%)', 'center'); const padL=60, padR=10, padT=22, padB=12; const years=Array.from(new Set(cells.map(c=>c.y))).sort((a,b)=>a-b); const months=['J','F','M','A','M','J','J','A','S','O','N','D']; const rows=years.length, cols=12; const cw=(w-padL-padR)/cols, ch=(h-padT-padB)/Math.max(1,rows); const vals=cells.map(c=>c.r); const vMin=Math.min(...vals, -10), vMax=Math.max(...vals, 10); function color(v){ const x=(v - vMin)/(vMax-vMin+1e-9); const r=Math.round(239*(1-x)); const g=Math.round(68 + (185-68)*x); const b=Math.round(68*(1-x)); return `rgb(${r},${g},${b})`; }
  // axes labels
  for(let m=0;m<12;m++){ __drawText(ctx, padL + m*cw + cw/2, padT-8, months[m], 'center'); }
  for(let i=0;i<years.length;i++){ __drawText(ctx, padL-6, padT + i*ch + ch/2, String(years[i]), 'right'); }
  const map=new Map(); for(const c of cells){ map.set(`${c.y}-${c.m}`, c.r); }
  for(let i=0;i<years.length;i++){
    for(let m=0;m<12;m++){
      const key=`${years[i]}-${m+1}`; const v=map.has(key)? map.get(key): null; const x=padL + m*cw, y=padT + i*ch; ctx.fillStyle = v==null? '#e5e7eb' : color(v); ctx.fillRect(x+1,y+1,cw-2,ch-2); if(v!=null){ __drawText(ctx, x+cw/2, y+ch/2, String((v).toFixed(1)), 'center'); }
    }
  }
}

function drawWeeklyHeatmap(canvas, cells){ if(!canvas||!cells||!cells.length) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Weekly returns (%)', 'center'); const padL=58, padR=10, padT=22, padB=18; const years=Array.from(new Set(cells.map(c=>c.y))).sort((a,b)=>a-b); const cols=53; const cw=(w-padL-padR)/cols, ch=(h-padT-padB)/Math.max(1,years.length); const vals=cells.map(c=>c.r); const vMin=Math.min(...vals, -10), vMax=Math.max(...vals, 10); function color(v){ const x=(v - vMin)/(vMax-vMin+1e-9); const r=Math.round(239*(1-x)); const g=Math.round(68 + (185-68)*x); const b=Math.round(68*(1-x)); return `rgb(${r},${g},${b})`; }
  // x ticks every 4 weeks
  for(let k=1;k<=cols;k+=4){ __drawText(ctx, padL + (k-0.5)*cw, padT-8, String(k), 'center'); }
  for(let i=0;i<years.length;i++){ __drawText(ctx, padL-6, padT + i*ch + ch/2, String(years[i]), 'right'); }
  const map=new Map(); for(const c of cells){ map.set(`${c.y}-${c.w}`, c.r); }
  for(let i=0;i<years.length;i++){
    for(let wIdx=1; wIdx<=cols; wIdx++){
      const key=`${years[i]}-${wIdx}`; const v=map.has(key)? map.get(key): null; const x=padL + (wIdx-1)*cw, y=padT + i*ch; ctx.fillStyle = v==null? '#e5e7eb' : color(v); ctx.fillRect(x+1,y+1,cw-2,ch-2); if(v!=null){ __drawText(ctx, x+cw/2, y+ch/2, String(v.toFixed(1)), 'center'); }
    }
  }
__drawText(ctx, w-8, h-6, 'Semaines (1–53) →', 'right');
}

function drawDOWBars(canvas, vals){ if(!canvas||!vals||vals.length!==7) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); const padL=46, padR=12, padT=20, padB=28; __drawText(ctx, w/2, 12, 'Retours moyens par jour de semaine (%)', 'center'); const min=Math.min(0, ...vals.map(v=>v.v)), max=Math.max(0, ...vals.map(v=>v.v)); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); const ticks=4; const y=(v)=> h-padB - (v-min)/(max-min+1e-9)*(h-padT-padB); for(let t=0;t<=ticks;t++){ const val=min + (max-min)*t/ticks; const yy=y(val); ctx.beginPath(); ctx.moveTo(padL-3, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, padL-8, yy, val.toFixed(2)+'%', 'right'); } const bw=(w-padL-padR)/7 - 6; for(let i=0;i<7;i++){ const x0=padL + i*((w-padL-padR)/7) + 3; const v=vals[i].v; const y0=y(0), yv=y(v); ctx.fillStyle = v>=0? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)'; ctx.fillRect(x0, Math.min(y0,yv), bw, Math.abs(y0-yv)); __drawText(ctx, x0+bw/2, h-10, vals[i].k, 'center'); }
}

function drawDOWHourHeatmap(canvas, cells){ if(!canvas||!cells||!cells.length) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Jour × Heure — retours (%)', 'center'); const padL=60, padR=10, padT=22, padB=18; const rows=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']; const cols=24; const cw=(w-padL-padR)/cols, ch=(h-padT-padB)/rows.length; const vals=cells.map(c=>c.r); const vMin=Math.min(...vals, -5), vMax=Math.max(...vals, 5); function color(v){ const x=(v - vMin)/(vMax-vMin+1e-9); const r=Math.round(239*(1-x)); const g=Math.round(68 + (185-68)*x); const b=Math.round(68*(1-x)); return `rgb(${r},${g},${b})`; }
  for(let hcol=0; hcol<cols; hcol+=6){ __drawText(ctx, padL + hcol*cw + cw/2, padT-8, String(hcol), 'center'); }
  for(let r=0;r<rows.length;r++){ __drawText(ctx, padL-6, padT + r*ch + ch/2, rows[r], 'right'); for(let c=0;c<cols;c++){ const cell=cells[r*cols + c]; const x=padL + c*cw, y=padT + r*ch; const v=(cell && Number.isFinite(cell.r))? cell.r : null; ctx.fillStyle = v==null? '#e5e7eb' : color(v); ctx.fillRect(x+1,y+1,cw-2,ch-2); if(v!=null){ __drawText(ctx, x+cw/2, y+ch/2, String((v).toFixed(1)), 'center'); } } }
  // store hover config on canvas for tooltip/click
  try{ canvas.__heatCfg = { padL, padT, padR, padB, rows, cols, cells, cw, ch }; }catch(_){ }
}

function drawCIBars(canvas, ci){ if(!canvas||!ci) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'IC 95% — Win%, PF, Exp', 'center'); const padL=70, padR=12, padT=22, padB=12; const rows=[{k:'Win%', lo:(ci.win&&ci.win[0])||0, hi:(ci.win&&ci.win[1])||0, min:0, max:100, fmt:(v)=>v.toFixed(1)+'%'},{k:'PF', lo:(ci.pf&&ci.pf[0])||0, hi:(ci.pf&&ci.pf[1])||0, min:0, max:Math.max(3, (ci.pf&&ci.pf[1])||0), fmt:(v)=> (v===Infinity?'∞':v.toFixed(2))},{k:'Exp', lo:(ci.exp&&ci.exp[0])||0, hi:(ci.exp&&ci.exp[1])||0, min:Math.min((ci.exp&&ci.exp[0])||0,0), max:Math.max((ci.exp&&ci.exp[1])||0,0), fmt:(v)=> v.toFixed(2)}]; const rh=(h-padT-padB)/rows.length; ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); for(let r=0;r<rows.length;r++){ const row=rows[r]; const y=padT + r*rh + rh/2; const min=row.min, max=row.max; const x=(v)=> padL + (v-min)/(max-min+1e-9)*(w-padL-padR); // grid
  const ticks=4; for(let t=0;t<=ticks;t++){ const xx=padL + (w-padL-padR)*t/ticks; ctx.beginPath(); ctx.moveTo(xx, y-rh/2+4); ctx.lineTo(xx, y+rh/2-4); ctx.stroke(); }
  // CI segment
  const xl=x(row.lo), xh=x(row.hi); ctx.strokeStyle='#2563eb'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(xl, y); ctx.lineTo(xh, y); ctx.stroke(); ctx.strokeStyle=__clr().border; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(xl, y-6); ctx.lineTo(xl, y+6); ctx.moveTo(xh, y-6); ctx.lineTo(xh, y+6); ctx.stroke(); __drawText(ctx, padL-8, y, row.k, 'right'); __drawText(ctx, xl-4, y-10, row.fmt(row.lo), 'right'); __drawText(ctx, xh+4, y-10, row.fmt(row.hi), 'left'); }
}

function drawWFTable(canvas, splits){ if(!canvas||!Array.isArray(splits)||!splits.length) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Walk-forward — métriques par split', 'center'); const padL=60, padR=10, padT=22, padB=12; const cols=splits.length, rows=['PF','Win%','Exp','P&L']; const cw=(w-padL-padR)/cols, rh=(h-padT-padB)/rows.length; ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); for(let c=0;c<cols;c++){ __drawText(ctx, padL + c*cw + cw/2, padT-8, 'S'+(c+1), 'center'); for(let r=0;r<rows.length;r++){ const x=padL + c*cw, y=padT + r*rh; ctx.strokeStyle=__clr().border; ctx.strokeRect(x+0.5, y+0.5, cw-1, rh-1); let val='—'; if(r===0) val = (splits[c].pf===Infinity? '∞': splits[c].pf.toFixed(2)); else if(r===1) val = splits[c].win.toFixed(1)+'%'; else if(r===2) val = splits[c].exp.toFixed(2); else if(r===3) val = splits[c].pnl.toFixed(0); __drawText(ctx, x+cw/2, y+rh/2, val, 'center'); if(c===0){ __drawText(ctx, padL-8, y+rh/2, rows[r], 'right'); } } }
}

function drawRegimeHeatmap(canvas, mat){ if(!canvas||!mat) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'PF par régime (Trend × Vol)', 'center'); const padL=80, padR=10, padT=22, padB=12; const rows=['Up','Down'], cols=['Low','Med','High']; const cw=(w-padL-padR)/cols.length, ch=(h-padT-padB)/rows.length; for(let r=0;r<rows.length;r++){ __drawText(ctx, padL-6, padT + r*ch + ch/2, rows[r], 'right'); for(let c=0;c<cols.length;c++){ const cell=mat[rows[r]][cols[c]]||{pf:0,count:0}; const pf=(cell.pf===Infinity? 5 : Math.max(0, Math.min(5, cell.pf||0))); const x=padL + c*cw, y=padT + r*ch; // green scale by PF
      const g=Math.round(255*Math.min(1, pf/3)); const col=`rgb(${255-g},${g},120)`; ctx.fillStyle=col; ctx.fillRect(x+1,y+1,cw-2,ch-2); __drawText(ctx, x+cw/2, y+ch/2, `${(cell.pf===Infinity?'∞':pf.toFixed(2))} (${cell.count})`, 'center'); __drawText(ctx, x+cw/2, padT-8, cols[c], 'center'); }
  }
}

function drawPareto(canvas, pts){ if(!canvas||!pts||!pts.length) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Pareto — P&L vs Max DD', 'center'); const padL=56, padR=12, padT=22, padB=28; const minX=0, maxX=Math.max(1, ...pts.map(p=>p.dd)); const minY=Math.min(0, ...pts.map(p=>p.pnl)), maxY=Math.max(1, ...pts.map(p=>p.pnl)); const x=(v)=> padL + (v-minX)/(maxX-minX+1e-9)*(w-padL-padR); const y=(v)=> h-padB - (v-minY)/(maxY-minY+1e-9)*(h-padT-padB); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); const ticks=4; for(let t=0;t<=ticks;t++){ const tx=padL + (w-padL-padR)*t/ticks; const ty=h-padB - (h-padT-padB)*t/ticks; ctx.beginPath(); ctx.moveTo(tx, padT); ctx.lineTo(tx, h-padB); ctx.stroke(); ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(w-padR, ty); ctx.stroke(); __drawText(ctx, tx, h-8, String(((maxX-minX)*t/ticks+minX).toFixed(0)), 'center'); __drawText(ctx, padL-8, ty, String(((maxY-minY)*t/ticks+minY).toFixed(0)), 'right'); }
  __drawText(ctx, w-8, h-8, 'Max DD →', 'right'); __drawText(ctx, padL+2, padT, 'P&L ↑', 'left');
  function colFromScore(s){ if(!Number.isFinite(s)) return 'rgba(37,99,235,0.85)'; const x=Math.max(0, Math.min(1, s/100)); const g=Math.round(180*x+40); const r=Math.round(220*(1-x)); return `rgba(${r},${g},120,0.9)`; }
  for(const p of pts){ ctx.fillStyle=colFromScore(p.score); ctx.beginPath(); ctx.arc(x(p.dd), y(p.pnl), 3, 0, Math.PI*2); ctx.fill(); }
}

function drawQQ(canvas, arr){ if(!canvas||!arr||arr.length<3) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'QQ-Plot (retours normalisés)', 'center'); const padL=40, padR=10, padT=18, padB=22; const xs=arr.slice().filter(Number.isFinite).sort((a,b)=>a-b); const n=xs.length; const mean=xs.reduce((s,x)=>s+x,0)/n; const sd=Math.sqrt(xs.reduce((s,x)=> s+(x-mean)*(x-mean),0)/Math.max(1,n-1)); const zs=xs.map(x=> (x-mean)/(sd||1)); function qnorm(p){ // inverse CDF normal approx (Beasley-Springer/Moro) simple poly
  const a=[-39.696830,220.946098,-275.928510,138.357751,-30.664798,2.506628]; const b=[-54.476098,161.585836,-155.698979,66.801311,-13.280681]; const c=[-0.007784894, -0.322396, -2.400758, -2.549732, 4.374664, 2.938163]; const d=[0.007784695, 0.322467, 2.445134, 3.754408]; const plow=0.02425, phigh=1-plow; let q,r; if(p<plow){ q=Math.sqrt(-2*Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); } if(p>phigh){ q=Math.sqrt(-2*Math.log(1-p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); } q=p-0.5; r=q*q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*1; }
  const theo=[]; for(let i=1;i<=n;i++){ const p=(i-0.5)/n; theo.push(qnorm(p)); }
  const minV=Math.min(...zs, ...theo), maxV=Math.max(...zs, ...theo); const x=(v)=> padL + (v-minV)/(maxV-minV+1e-9)*(w-padL-padR); const y=(v)=> h-padB - (v-minV)/(maxV-minV+1e-9)*(h-padT-padB); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); // diagonal
  ctx.strokeStyle='#10b981'; ctx.beginPath(); ctx.moveTo(x(minV), y(minV)); ctx.lineTo(x(maxV), y(maxV)); ctx.stroke(); ctx.fillStyle='rgba(37,99,235,0.85)'; for(let i=0;i<n;i++){ ctx.beginPath(); ctx.arc(x(theo[i]), y(zs[i]), 2.5, 0, Math.PI*2); ctx.fill(); } }

function drawACF(canvas, arr, maxLag){ if(!canvas||!arr||arr.length<3) return; maxLag=Math.max(1, maxLag||10); const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, 'Autocorrélation (lags)', 'center'); const padL=30, padR=10, padT=18, padB=22; const xs=arr.slice().filter(Number.isFinite); const n=xs.length; const mean=xs.reduce((s,x)=>s+x,0)/n; const varr=xs.reduce((s,x)=> s+(x-mean)*(x-mean),0); const acf=[]; for(let k=1;k<=maxLag;k++){ let num=0; for(let i=0;i<n-k;i++){ num += (xs[i]-mean)*(xs[i+k]-mean); } acf.push(num/(varr||1)); } const yMin=Math.min(0, ...acf), yMax=Math.max(0, ...acf); const x=(i)=> padL + (i-1)/(maxLag-1)*(w-padL-padR); const y=(v)=> h-padB - (v-yMin)/(yMax-yMin+1e-9)*(h-padT-padB); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); const z=1.96/Math.sqrt(Math.max(1,n)); ctx.strokeStyle='#ef4444'; ctx.beginPath(); ctx.moveTo(padL, y(z)); ctx.lineTo(w-padR, y(z)); ctx.moveTo(padL, y(-z)); ctx.lineTo(w-padR, y(-z)); ctx.stroke(); for(let k=1;k<=maxLag;k++){ const xx=x(k); const hh=(acf[k-1]-0)/(yMax-yMin+1e-9)*(h-padT-padB); ctx.fillStyle='#2563eb'; const y0=y(0), yk=y(acf[k-1]); ctx.fillRect(xx-6, Math.min(y0,yk), 12, Math.abs(y0-yk)); __drawText(ctx, xx, h-6, String(k), 'center'); } }
function drawRobust(canvas, complexity, robustness){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 14, 'Complexité & Robustesse (0–100)', 'center'); // grid
  ctx.strokeStyle=__clr().border; for(let g=0; g<=5; g++){ const x=220 + (w-240)*(g/5); ctx.beginPath(); ctx.moveTo(x, 24); ctx.lineTo(x, h-14); ctx.stroke(); __drawText(ctx, x, h-6, String(g*20)+'%', 'center'); }
  const labels=['Complexité (params actifs)','Robustesse (stabilité)']; const vals=[complexity, robustness]; for(let i=0;i<2;i++){ const y=40+i*40; ctx.fillStyle='#e5e7eb'; ctx.fillRect(220, y, w-240, 14); ctx.fillStyle=i===0?'#f59e0b':'#10b981'; ctx.fillRect(220, y, (w-240)*Math.max(0,Math.min(100, vals[i]))/100, 14); __drawText(ctx, 210, y+7, String(Math.round(vals[i]))+'%', 'right'); __drawText(ctx, 10, y+7, labels[i], 'left'); } }

// Aide: synthèse et suggestions automatiques
function generateStrategySummary(res, ctx, d){ try{
  const pf = (res.profitFactor===Infinity? Infinity : (+res.profitFactor||0));
  const wr = +res.winrate||0; const rr = +res.avgRR||0; const dd = +res.maxDDAbs||0;
  const cap0 = +((ctx && ctx.conf && ctx.conf.startCap) || 0);
  const ddPct = cap0>0? ((dd/cap0)*100) : NaN;
  const tim = Math.max(0, Math.min(100, d && d.timeInMkt || 0));
  const freq = Math.max(0, d && d.freq || 0);
  const gen = Math.max(1, ctx && ctx.gen || 1);
  const lines = [];
  // Synthèse courte
  lines.push(`• Profit Factor: ${pf===Infinity?'∞':pf.toFixed(2)}  • Win%: ${wr.toFixed(1)}%  • Avg R:R: ${Number.isFinite(rr)? rr.toFixed(2):'—'}`);
  if(Number.isFinite(ddPct)) lines.push(`• Max DD: ${dd.toFixed(0)} (${ddPct.toFixed(1)}% du capital initial)`);
lines.push(`• Exposition: ${tim.toFixed(1)}%  • Trades/jour: ${freq.toFixed(2)}`);
  if(d && typeof d.expectancy==='number') lines.push(`• Expectancy/trade: ${d.expectancy.toFixed(2)} (USD)`);
  if(d && typeof d.avgDurMin==='number') lines.push(`• Durée moyenne/trade: ${d.avgDurMin.toFixed(1)} min`);
  if(d && typeof d.bestNet==='number' && typeof d.worstNet==='number') lines.push(`• Meilleur trade: ${d.bestNet.toFixed(2)}  • Pire trade: ${d.worstNet.toFixed(2)}`);
  if(d && Number.isFinite(d.r2)) lines.push(`• Linéarité equity (R²): ${(d.r2*100).toFixed(0)}%`);
  // Interprétation
  const insights = [];
  if(pf<1.2 && pf!==Infinity) insights.push("rentabilité fragile (PF < 1.2)");
  if(wr<45) insights.push("taux de réussite bas (<45%)");
  if(Number.isFinite(rr) && rr<1.0) insights.push("R:R moyen < 1 (cibles trop proches vs SL)");
  if(Number.isFinite(ddPct) && ddPct>20) insights.push("drawdown élevé (>20% du capital)");
  if(tim>60) insights.push("exposition importante au marché (>60%)");
  if(insights.length){ lines.push(`• Lecture: ${insights.join(' • ')}`); }
  if(d && d.ci){ try{ const winCI = d.ci.win||[]; const pfCI=d.ci.pf||[]; const expCI=d.ci.exp||[]; lines.push(`• IC95: Win% [${(winCI[0]||0).toFixed(1)}–${(winCI[1]||0).toFixed(1)}]  PF [${(pfCI[0]||0).toFixed(2)}–${(pfCI[1]||0).toFixed(2)}]  Exp [${(expCI[0]||0).toFixed(2)}–${(expCI[1]||0).toFixed(2)}]`); }catch(_){ } }
  // Points d'amélioration pour gen ≥ 2
  if(gen>=2){
    const imp = [];
    if(wr<45) imp.push("Renforcer la confirmation d'entrée (mode: Bounce/Touch), ou augmenter prd/NOL pour filtrer le bruit");
    if(pf<1.3) imp.push("Rééquilibrer l'échelle de TP (plus de distance/poids sur TP ultérieurs) et réduire le nombre de trades");
    if(Number.isFinite(rr) && rr<1.0) imp.push("Augmenter tp1R / ratios Fib, ou rapprocher le SL initial pour améliorer le R:R");
    if(Number.isFinite(ddPct) && ddPct>20) imp.push("Activer/renforcer BE (beAfterBars, beLockPct) et envisager SL ladder plus strict");
    if(tim>60) imp.push("Réduire l'exposition (prd↑, NOL↑) pour limiter le temps en position");
    if(!imp.length) imp.push("Affiner légèrement TP/SL et confirmer sur 2–3 splits temporels");
    lines.push("\nPoints d'amélioration (génération ≥ 2):\n- " + imp.join("\n- "));
  }
  return lines.join("\n");
}catch(_){ return '—'; }}

// Nouveau flux: pop‑up simple via showStrategyResult (métriques & trades)
async function openLabStrategyDetail(item, ctx){ try{
  const sym=ctx.symbol, tf=ctx.tf; const p=item.params||item.p||{};
  const conf={ startCap: Math.max(0, +((document.getElementById('labStartCap')||{}).value||10000)), fee: Math.max(0, +((document.getElementById('labFee')||{}).value||0.1)), lev: Math.max(1, +((document.getElementById('labLev')||{}).value||1)), maxPct:100, base:'initial' };
  // Progress UI
  try{ openBtProgress('Analyse stratégie...'); }catch(_){ }
  // Charger les données (toujours pleine période pour le détail)
  let bars=candles;
  try{ bars = await fetchAllKlines(sym, tf, 5000); }catch(_){ /* keep current candles if same TF */ }
  // Période complète
  let from=null, to=null;
  const [sIdx,eIdx]=(()=>{ let s=0,e=bars.length-1; return [s,e]; })();
  const res=runBacktestSliceFor(bars, sIdx, eIdx, conf, p, true);
  try{ closeBtProgress(); }catch(_){ }
  // Ouvre la nouvelle fenêtre de Détail et rend l'analyse complète; fallback sur l'ancienne modale si besoin
  try{
    if(detailCtxEl){ detailCtxEl.textContent = `${symbolToDisplay(sym)} • ${tf} — Analyse en cours...`; }
    openModalEl(detailModalEl);
    try{ ensureFloatingModal(detailModalEl, 'detail', { left: 60, top: 60, width: 1000, height: 660, zIndex: bumpZ() }); }catch(_){ }
const ctxFull = { symbol: sym, tf, name: (item && item.name) || 'Stratégie', conf, bars, sIdx, eIdx, params: p, gen: (item && item.gen) ? item.gen : 1 };
    renderStrategyDetailIntoModal(res, ctxFull);
  }catch(__err){
    // Fallback: modales Résultats+Trades existantes
    try{ showStrategyResult(res, { symbol: sym, tf, startCap: conf.startCap }); }catch(__){ }
  }
}catch(e){ try{ closeBtProgress(); }catch(_){ } setStatus('Erreur détail'); try{ addLabLog && addLabLog('Erreur détail: '+(e&&e.message?e.message:e)); }catch(__){} }}

function renderStrategyDetailIntoModal(res, ctx){ try{
  const sym = ctx.symbol, tf = ctx.tf; const name = ctx.name||'Stratégie'; const conf = ctx.conf; const bars = ctx.bars; const sIdx = ctx.sIdx, eIdx=ctx.eIdx;
  const eq = (res.eqSeries||[]).map(x=>({ time:x.time, equity:x.equity }));
  const setNote = (id, txt)=>{ try{ const el=document.getElementById(id); if(el) el.textContent = String(txt||''); }catch(_){ } };
  const chartReg = {}; function registerChart(id, spec){ chartReg[id]=spec; }
  function ensureHeavenClone(id){ try{ const can=document.getElementById(id); if(!can) return null; const heavenId=id+'Heaven'; let ch=document.getElementById(heavenId); if(ch) return ch; const note=document.getElementById(id+'Note'); const parent=(note&&note.parentElement)||can.parentElement; const lab=document.createElement('div'); lab.style.color='var(--muted)'; lab.style.fontSize='12px'; lab.style.marginTop='6px'; lab.textContent='Heaven'; parent.appendChild(lab); ch=document.createElement('canvas'); ch.id=heavenId; ch.width=can.width; ch.height=can.height; ch.style.cssText=can.style.cssText; parent.appendChild(ch); const note2=document.createElement('div'); note2.id=heavenId+'Note'; note2.style.color='var(--muted)'; note2.style.fontSize='12px'; note2.style.marginTop='4px'; note2.textContent='—'; parent.appendChild(note2); return ch; }catch(_){ return null; } }
  // shared helpers
  function groupPositions(tr){ const t=(tr||[]).slice().sort((a,b)=> (a.exitTime||0)-(b.exitTime||0)); const map=new Map(); function keyOf(e){ return `${e.dir}|${e.entryTime}|${e.entry}|${e.initSL}`; } for(const ev of t){ const k=keyOf(ev); let g=map.get(k); if(!g){ g={ entryTime:ev.entryTime, exitTime:ev.exitTime, entry: (Number.isFinite(ev.entry)? ev.entry : null), initSL: (Number.isFinite(ev.initSL)? ev.initSL : null), net:0, dur:0, dir:ev.dir||'long', eq0: (Number(ev.eqBefore)||null) }; map.set(k,g); } g.net += Number(ev.net)||0; if(Number.isFinite(ev.exitTime)&&Number.isFinite(ev.entryTime)) g.dur = Math.max(g.dur, ev.exitTime-ev.entryTime); if(Number.isFinite(ev.exitTime)) g.exitTime = ev.exitTime; if(g.entry==null && Number.isFinite(ev.entry)) g.entry = ev.entry; if(g.initSL==null && Number.isFinite(ev.initSL)) g.initSL = ev.initSL; if(g.eq0==null && Number.isFinite(ev.eqBefore)) g.eq0 = Number(ev.eqBefore); }
    return Array.from(map.values()).sort((a,b)=> (a.exitTime||0)-(b.exitTime||0)); }
  function deriveFor(resX){ const out={}; try{
      out.eq = (resX.eqSeries||[]).map(x=>({ time:x.time, equity:x.equity }));
      // tArr + eqBefore fallback
      const tArr = Array.isArray(resX.trades)? resX.trades.slice() : [];
      if(tArr.length && !tArr.some(t=> t && t.eqBefore!=null)){
        const sorted = tArr.slice().sort((a,b)=> (a.exitTime||0)-(b.exitTime||0));
        let eqBefore = Number(conf.startCap)||0; for(const ev of sorted){ ev.eqBefore = eqBefore; eqBefore += Number(ev.net)||0; }
      }
      // rets, duration span
      out.rets=[]; out.totalDur=0; out.minTs=Infinity; out.maxTs=-Infinity;
      for(const t of tArr){ const cap=Math.max(1, t.eqBefore||conf.startCap); out.rets.push((t.net/cap)*100); out.totalDur += Math.max(0, (t.exitTime||0)-(t.entryTime||0)); if(Number.isFinite(t.entryTime)&&t.entryTime<out.minTs) out.minTs=t.entryTime; if(Number.isFinite(t.exitTime)&&t.exitTime>out.maxTs) out.maxTs=t.exitTime; }
      // groups
      out.groups = groupPositions(resX.trades||[]);
      // durations
      out.durationsMin = out.groups.map(g=> Math.max(0, (Number(g.dur)||0)/60));
      // long/short returns by position
      out.retLong=[]; out.retShort=[]; for(const g of out.groups){ const eq0=Number.isFinite(g.eq0)&&g.eq0>0? g.eq0 : (Number(conf.startCap)||1); const rpct = (Number(g.net)||0)/eq0*100; if(g.dir==='long') out.retLong.push(rpct); else out.retShort.push(rpct); }
      // rolling (window 30)
      const ROLL_N=30; const rrByPos=(function(){ const map=new Map(); const t=(resX.trades||[]); function keyOf(e){ return `${e.dir}|${e.entryTime}|${e.entry}|${e.initSL}`; } for(const ev of t){ const k=keyOf(ev); let arr=map.get(k); if(!arr){ arr=[]; map.set(k,arr); } if(Number.isFinite(ev.rr)) arr.push(Number(ev.rr)); } const rrArr=[]; for(const g of (out.groups||[])){ const k=`${g.dir}|${g.entryTime}|${g.entry}|${g.initSL}`; const arr=map.get(k)||[]; const m=arr.length? (arr.reduce((x,y)=>x+y,0)/arr.length) : null; rrArr.push(m); } return rrArr; })();
      out.rollPF=[]; out.rollWin=[]; out.rollRR=[]; out.rollExp=[]; for(let i=0;i<out.groups.length;i++){ const winSlice=out.groups.slice(Math.max(0,i-ROLL_N+1), i+1); const profits=winSlice.map(g=> g.net).filter(x=> x>0).reduce((s,x)=>s+x,0); const losses=winSlice.map(g=> g.net).filter(x=> x<0).reduce((s,x)=>s+x,0); const pf = (losses<0? profits/Math.abs(losses) : Infinity); out.rollPF.push(Math.min(5,pf)); const w = winSlice.filter(g=> g.net>=0).length; out.rollWin.push(100*w/winSlice.length); const rrVals = rrByPos.slice(Math.max(0,i-ROLL_N+1), i+1).filter(x=> Number.isFinite(x)); out.rollRR.push(rrVals.length? (rrVals.reduce((s,x)=>s+x,0)/rrVals.length) : 0); out.rollExp.push(winSlice.reduce((s,g)=> s+(Number(g.net)||0),0)/winSlice.length); }
      // MAE/MFE
      out.maePts=[]; const timeToIdx=(ts)=>{ let lo=0, hi=bars.length-1, ans=0; while(lo<=hi){ const mid=(lo+hi)>>1; if(bars[mid].time<=ts){ ans=mid; lo=mid+1; } else hi=mid-1; } return ans; };
      for(const g of out.groups){ if(!Number.isFinite(g.entryTime) || !Number.isFinite(g.exitTime) || !Number.isFinite(g.entry) || !Number.isFinite(g.initSL)) continue; const i0=timeToIdx(g.entryTime), i1=timeToIdx(g.exitTime); if(i1<=i0) continue; let hi=-Infinity, lo=Infinity; for(let i=i0;i<=i1;i++){ hi=Math.max(hi, bars[i].high); lo=Math.min(lo, bars[i].low); } const entry=g.entry; const risk=Math.max(1e-9, Math.abs(entry - g.initSL)); let maeR=0, mfeR=0; if(g.dir==='long'){ maeR = Math.max(0, (entry - lo)/risk); mfeR = Math.max(0, (hi - entry)/risk); } else { maeR = Math.max(0, (hi - entry)/risk); mfeR = Math.max(0, (entry - lo)/risk); } out.maePts.push({ maeR, mfeR, win: (g.net||0)>=0 }); }
      // Weekly/DOW/DOWHour
      function isoYearWeek(ts){ const d=new Date(ts*1000); const dt=new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dayNum = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - dayNum); const isoYear = dt.getUTCFullYear(); const yearStart = new Date(Date.UTC(isoYear,0,1)); const week = Math.ceil((((dt - yearStart)/86400000) + 1) / 7); return { y: isoYear, w: Math.max(1, Math.min(53, week)) }; }
      const endByYW=new Map(); if(out.eq && out.eq.length){ for(const p of out.eq){ const yw=isoYearWeek(p.time); const key=`${yw.y}-${yw.w}`; endByYW.set(key, p.equity); } } const keys=Array.from(endByYW.keys()).sort((a,b)=>{ const [ay,aw]=a.split('-').map(Number), [by,bw]=b.split('-').map(Number); return ay!==by? ay-by : aw-bw; }); out.weekly=[]; let prev=null; for(const k of keys){ const v=endByYW.get(k); if(prev!=null){ const [y,w]=k.split('-').map(Number); const r=((v-prev)/prev)*100; out.weekly.push({ y, w, r }); } prev=v; }
      function toYMD(ts){ const d=new Date(ts*1000); return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`; }
      const eod=new Map(); if(out.eq && out.eq.length){ for(const p of out.eq){ const key=toYMD(p.time); eod.set(key, p.equity); } } const days=Array.from(eod.keys()).sort(); const dowVals=[0,0,0,0,0,0,0], dowCnt=[0,0,0,0,0,0,0]; prev=null; for(const d of days){ const v=eod.get(d); if(prev!=null){ const ret=((v-prev)/prev)*100; const [y,m,dd]=d.split('-').map(Number); const dt=new Date(Date.UTC(y,m-1,dd)); const dow=(dt.getUTCDay()+6)%7; dowVals[dow]+=ret; dowCnt[dow]++; } prev=v; } const labels=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']; out.dow = labels.map((k,i)=>({k, v: (dowCnt[i]>0? dowVals[i]/dowCnt[i] : 0)}));
      function toYMDH(ts){ const d=new Date(ts*1000); return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}-${d.getUTCHours()}`; }
      const eoh=new Map(); if(out.eq && out.eq.length){ for(const p of out.eq){ const key=toYMDH(p.time); eoh.set(key, p.equity); } } const k2=Array.from(eoh.keys()).map(k=>{ const [y,m,d,h]=k.split('-').map(Number); return { ts: Date.UTC(y,m-1,d,h)/1000, k }; }).sort((a,b)=> a.ts-b.ts);
      const sum=Array.from({length:7},()=> new Array(24).fill(0)), cnt=Array.from({length:7},()=> new Array(24).fill(0)); let prev2=null; for(const it of k2){ const v=eoh.get(it.k); if(prev2!=null){ const ret=((v-prev2)/prev2)*100; const dt=new Date(it.ts*1000); const dow=(dt.getUTCDay()+6)%7; const hr=dt.getUTCHours(); sum[dow][hr]+=ret; cnt[dow][hr]++; } prev2=v; } out.dowHour=[]; for(let r=0;r<7;r++){ for(let c=0;c<24;c++){ const v=cnt[r][c]>0? (sum[r][c]/cnt[r][c]) : 0; out.dowHour.push({ r, c, d:r, h:c, r:v }); } }
      // long/short heatmaps by entry hour
      const mkCells=(dir)=>{ const s=Array.from({length:7},()=> new Array(24).fill(0)); const c=Array.from({length:7},()=> new Array(24).fill(0)); for(const g of out.groups){ if(g && g.dir===dir && Number.isFinite(g.entryTime)){ const eq0=Number.isFinite(g.eq0)&&g.eq0>0? g.eq0 : (Number(conf.startCap)||1); const rpct=(Number(g.net)||0)/eq0*100; const dt=new Date((g.entryTime||0)*1000); const dow=(dt.getUTCDay()+6)%7; const hr=dt.getUTCHours(); s[dow][hr]+=rpct; c[dow][hr]++; } } const cells=[]; for(let r=0;r<7;r++){ for(let h=0;h<24;h++){ const v=c[r][h]>0? (s[r][h]/c[r][h]) : 0; cells.push({ r, c:h, d:r, h, r:v }); } } return cells; };
      out.dowHourLong = mkCells('long'); out.dowHourShort = mkCells('short');
      // regime matrix
      try{ const prd=Math.max(2, lbcOpts.prd|0); const lb=computeLineBreakState(bars, Math.max(1, lbcOpts.nol|0)); function atrPct(data, len){ const tr=new Array(data.length).fill(0); for(let i=1;i<data.length;i++){ const h=data[i].high, l=data[i].low, cPrev=data[i-1].close; tr[i]=Math.max(h-l, Math.abs(h-cPrev), Math.abs(l-cPrev)); } const atr=new Array(data.length).fill(0); let s=0; for(let i=0;i<data.length;i++){ if(i<len){ s+=tr[i]; atr[i]=s/Math.max(1,i+1); } else { atr[i]=(atr[i-1]*(len-1)+tr[i])/len; } } return atr.map((a,i)=> (a/Math.max(1e-9, data[i].close))*100); } const atrP = atrPct(bars, 14); const vals=atrP.filter(x=> Number.isFinite(x)); const sorted=vals.slice().sort((a,b)=>a-b); const q1=sorted[Math.floor(sorted.length*0.33)]||0, q2=sorted[Math.floor(sorted.length*0.66)]||0; const bucketVol=(x)=> x<=q1? 'Low' : (x>=q2? 'High' : 'Med'); const bucketTrend=(i)=> lb.trend[i]===1? 'Up':'Down'; const mat={ Up:{Low:{pf:0,gp:0,gl:0,count:0}, Med:{pf:0,gp:0,gl:0,count:0}, High:{pf:0,gp:0,gl:0,count:0}}, Down:{Low:{pf:0,gp:0,gl:0,count:0}, Med:{pf:0,gp:0,gl:0,count:0}, High:{pf:0,gp:0,gl:0,count:0}} };
        const idxOfTime=(ts)=>{ let lo=0, hi=bars.length-1, ans=0; while(lo<=hi){ const mid=(lo+hi)>>1; if(bars[mid].time<=ts){ ans=mid; lo=mid+1; } else hi=mid-1; } return ans; };
        for(const g of out.groups){ const i=idxOfTime(g.entryTime); const tr=bucketTrend(Math.min(i, lb.trend.length-1)); const vol=bucketVol(atrP[Math.min(i, atrP.length-1)]||0); const cell=mat[tr][vol]; cell.count++; if((g.net||0)>=0) cell.gp += (g.net||0); else cell.gl += (g.net||0); } for(const r of ['Up','Down']){ for(const c of ['Low','Med','High']){ const cell=mat[r][c]; cell.pf = (cell.gl<0? cell.gp/Math.abs(cell.gl) : (cell.count>0? Infinity:0)); } } out.regime=mat; }catch(_){ out.regime=null; }
      // WF
      out.wf=[]; try{ const N=4; if(out.eq && out.eq.length>10){ const t0=out.eq[0].time, t1=out.eq[out.eq.length-1].time; const bounds=[]; for(let k=0;k<=N;k++){ bounds.push(t0 + Math.round((t1-t0)*k/N)); } for(let k=0;k<N;k++){ const a=bounds[k], b=bounds[k+1]; const gg=out.groups.filter(g=> Number.isFinite(g.exitTime) && g.exitTime>=a && g.exitTime<b); const L=gg.length; let gp=0, gl=0, wins=0; let exp=0, pnl=0; for(const g of gg){ const net=Number(g.net)||0; pnl+=net; if(net>=0){ gp+=net; wins++; } else { gl+=net; } } if(L>0){ exp = pnl/L; } const pf = gl<0? (gp/Math.abs(gl)) : (L>0? Infinity:0); const win = L>0? (wins/L*100):0; out.wf.push({ pf: Number.isFinite(pf)? pf: Infinity, win, exp, pnl }); } } }catch(_){ out.wf=[]; }
      // CIs
      out.ci=null; try{ const nets=out.groups.map(g=> Number(g.net)||0); const L=nets.length; if(L>=8){ const B=200; const pfArr=[], wrArr=[], expArr=[]; function q(a,p){ const s=a.slice().sort((x,y)=>x-y); const idx=Math.max(0, Math.min(s.length-1, Math.floor((s.length-1)*p))); return s[idx]; } for(let b=0;b<B;b++){ let gp=0, gl=0, wins=0, sum=0; for(let i=0;i<L;i++){ const v=nets[Math.floor(Math.random()*L)]; sum+=v; if(v>=0){ gp+=v; wins++; } else { gl+=v; } } const pfv = gl<0? (gp/Math.abs(gl)) : 10; pfArr.push(pfv); wrArr.push(100*wins/L); expArr.push(sum/L); } out.ci={ win:[q(wrArr,0.025), q(wrArr,0.975)], pf:[q(pfArr,0.025), q(pfArr,0.975)], exp:[q(expArr,0.025), q(expArr,0.975)] }; } }catch(_){ out.ci=null; }
      return out;
    }catch(_){ return out; } }
  // placeholders for per-chart summaries
  let weeklyCells=null, dowArr=null, dowHourCells=null, dhLongCells=null, dhShortCells=null, wfSegs=null, regimeMat=null, maePtsVar=null, mcBands=null;
  // returns per trade
  const tArr = Array.isArray(res.trades)? res.trades.slice() : [];
  // Fallback: compute eqBefore sequentially if missing
  if(tArr.length && !tArr.some(t=> t && t.eqBefore!=null)){
    const sorted = tArr.slice().sort((a,b)=> (a.exitTime||0)-(b.exitTime||0));
    let eqBefore = Number(conf.startCap)||0;
    for(const ev of sorted){ ev.eqBefore = eqBefore; eqBefore += Number(ev.net)||0; }
  }
  const rets=[]; let totalDur=0; let minTs=Infinity, maxTs=-Infinity; for(const t of tArr){ const cap=Math.max(1, t.eqBefore||conf.startCap); rets.push((t.net/cap)*100); totalDur += Math.max(0, (t.exitTime||0)-(t.entryTime||0)); if(Number.isFinite(t.entryTime)&&t.entryTime<minTs) minTs=t.entryTime; if(Number.isFinite(t.exitTime)&&t.exitTime>maxTs) maxTs=t.exitTime; }
  const mean=(arr)=> arr.length? arr.reduce((a,b)=>a+b,0)/arr.length : 0; const m=mean(rets); const sd=Math.sqrt(mean(rets.map(x=> (x-m)*(x-m)))); const sharpe = (sd>0? (m/sd*Math.sqrt(Math.max(1, rets.length))) : 0);
  const pf = (res.profitFactor===Infinity? 3 : Math.max(0, Math.min(3, +res.profitFactor||0))); const pfN = (pf/3)*100; const sharpeN = Math.max(0, Math.min(100, (sharpe/3)*100)); const recov = (res.maxDDAbs>0? (res.totalPnl/Math.max(1e-9, res.maxDDAbs)) : 0); const recovN = Math.max(0, Math.min(100, (recov/3)*100)); const consN = Math.max(0, Math.min(100, 100*(1 - Math.min(1, sd/3)))); const cpiN = Math.max(0, Math.min(100, 100*(1 - Math.min(1, (res.maxDDAbs/Math.max(1, conf.startCap)) / 0.5))));
  const r2 = (()=>{ const n=eq.length; if(n<3) return 0; const xs=eq.map((_,i)=>i); const ys=eq.map(p=>p.equity); const xm=mean(xs), ym=mean(ys); let num=0, den=0; for(let i=0;i<n;i++){ const xv=xs[i]-xm, yv=ys[i]-ym; num += xv*yv; den += xv*xv; } const a=num/(den||1); const b=ym - a*xm; let ssTot=0, ssRes=0; for(let i=0;i<n;i++){ const y=ys[i]; const yhat=a*xs[i]+b; ssTot += (y-ym)*(y-ym); ssRes += (y-yhat)*(y-yhat); } return 1 - (ssRes/(ssTot||1)); })();
  const r2N = Math.max(0, Math.min(100, r2*100)); const winrate = +res.winrate||0; const avgRR = +res.avgRR||0; const teN = Math.max(0, Math.min(100, (winrate/100) * (pf/(pf+1))*100)); const edgeN = Math.max(0, Math.min(100, (pf/(pf+1)) * (1 - Math.min(1, sd/5))*100));
  // CI bootstrap moved after groups are computed
  drawRadar(canRadar, ['Profit Factor','Sharpe','Recovery','Consistency','Cap. Protection','R² equity','Trade Efficiency','Edge Robustness'], [pfN, sharpeN, recovN, consN, cpiN, r2N, teN, edgeN]);
  try{ const labs=['PF','Sharpe','Recovery','Consistency','CapProt','R²','TradeEff','Edge']; const vals=[pfN,sharpeN,recovN,consN,cpiN,r2N,teN,edgeN]; const idxs=vals.map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]); const top=idxs.slice(0,2).map(([v,i])=>`${labs[i]} ${v.toFixed(0)}%`).join(', '); const bot=idxs.slice(-2).map(([v,i])=>`${labs[i]} ${v.toFixed(0)}%`).join(', '); setNote('detailRadarNote', `Forces: ${top} • Faiblesses: ${bot}`); }catch(_){ }
  // Compare with current Heaven config on the same period
  let resCmp=null, eqCmp=null, H=null; try{ const pHeaven={ ...(window.lbcOpts||{}) }; resCmp = runBacktestSliceFor(bars, sIdx, eIdx, conf, pHeaven, true); eqCmp = (resCmp.eqSeries||[]).map(x=>({ time:x.time, equity:x.equity })); try{ H = deriveFor(resCmp); }catch(__){ H=null; } }catch(_){ resCmp=null; eqCmp=null; H=null; }
  // Heaven radar
  try{ if(resCmp && eqCmp && H){ const meanH=(a)=> a.length? a.reduce((x,y)=>x+y,0)/a.length : 0; const mH = meanH(H.rets||[]); const sdH = Math.sqrt(meanH((H.rets||[]).map(x=> (x-mH)*(x-mH)))); const sharpeH = (sdH>0? (mH/sdH*Math.sqrt(Math.max(1, (H.rets?H.rets.length:1)))) : 0); const pfHraw = (resCmp.profitFactor===Infinity? 3 : Math.max(0, Math.min(3, +resCmp.profitFactor||0))); const pfNH=(pfHraw/3)*100; const recovH = (resCmp.maxDDAbs>0? (resCmp.totalPnl/Math.max(1e-9, resCmp.maxDDAbs)) : 0); const recovNH = Math.max(0, Math.min(100, (recovH/3)*100)); const consNH = Math.max(0, Math.min(100, 100*(1 - Math.min(1, (sdH/3)||0)))); const cpiNH = Math.max(0, Math.min(100, 100*(1 - Math.min(1, ((+resCmp.maxDDAbs||0)/Math.max(1, conf.startCap)) / 0.5)))); const r2H=(function(){ const n=eqCmp.length; if(n<3) return 0; const xs=eqCmp.map((_,i)=>i); const ys=eqCmp.map(p=>p.equity); const xm=meanH(xs), ym=meanH(ys); let num=0, den=0; for(let i=0;i<n;i++){ const xv=xs[i]-xm, yv=ys[i]-ym; num += xv*yv; den += xv*xv; } const a=num/(den||1); const b=ym - a*xm; let ssTot=0, ssRes=0; for(let i=0;i<n;i++){ const y=ys[i]; const yhat=a*xs[i]+b; ssTot += (y-ym)*(y-ym); ssRes += (y-yhat)*(y-yhat); } return 1 - (ssRes/(ssTot||1)); })()*100; const teNH = Math.max(0, Math.min(100, ((+resCmp.winrate||0)/100) * (pfHraw/(pfHraw+1))*100)); const edgeNH = Math.max(0, Math.min(100, (pfHraw/(pfHraw+1)) * (1 - Math.min(1, (sdH/5)||0))*100)); const c=ensureHeavenClone('detailRadar'); if(c){ drawRadar(c, ['Profit Factor','Sharpe','Recovery','Consistency','Cap. Protection','R² equity','Trade Efficiency','Edge Robustness'], [pfNH, Math.max(0, Math.min(100, (sharpeH/3)*100)), recovNH, consNH, cpiNH, Math.max(0, Math.min(100, r2H)), teNH, edgeNH]); } } }catch(_){ }
  // primary equity
  try{ drawEquity(canEquity, eq); registerChart('detailEquity', { type:'equity', eq1:eq }); }catch(_){ }
  // heaven equity
  try{ const canEqH = ensureHeavenClone('detailEquity'); if(canEqH && eqCmp){ drawEquity(canEqH, eqCmp); registerChart('detailEquityHeaven', { type:'equity', eq1:eqCmp }); } }catch(_){ }
  // primary dd
  drawDD(canDD, eq);
  // heaven dd
  try{ const canDDH = ensureHeavenClone('detailDD'); if(canDDH && eqCmp){ drawDD(canDDH, eqCmp); } }catch(_){ }
  // primary hist
  drawHist(canHist, rets); registerChart('detailHist', { type:'rets', values: rets.slice() });
  try{ if(eq && eq.length>1){ const ret=((eq[eq.length-1].equity-eq[0].equity)/Math.max(1e-9,eq[0].equity))*100; const ddAbs=+res.maxDDAbs||0; const ddPct=(conf.startCap>0? (ddAbs/conf.startCap*100):NaN); setNote('detailEquityNote', `Perf cumulée: ${ret.toFixed(1)}% • Max DD: ${ddAbs.toFixed(0)}${Number.isFinite(ddPct)? ' ('+ddPct.toFixed(1)+'%)':''}`); setNote('detailDDNote', `Taille et fréquence des creux: max ${ddAbs.toFixed(0)} • Surveiller la phase de stress.`); if(resCmp){ const pf1=(res.profitFactor===Infinity? Infinity : (+res.profitFactor||0)); const pf2=(resCmp.profitFactor===Infinity? Infinity : (+resCmp.profitFactor||0)); const wr1=+res.winrate||0, wr2=+resCmp.winrate||0; const pnl1=+res.totalPnl||0, pnl2=+resCmp.totalPnl||0; const dd2=+resCmp.maxDDAbs||0; const d=(a,b)=> (Number.isFinite(a)&&Number.isFinite(b))? (a-b):NaN; setNote('detailCompareNote', `Heaven — PF ${pf2===Infinity?'∞':pf2.toFixed(2)} (Δ ${(pf2===Infinity||pf1===Infinity)?'∞':d(pf2,pf1).toFixed(2)}) • Win ${wr2.toFixed(1)}% (Δ ${(wr2-wr1).toFixed(1)}%) • P&L ${pnl2.toFixed(0)} (Δ ${(pnl2-pnl1).toFixed(0)}) • Max DD ${dd2.toFixed(0)} (Δ ${(dd2-ddAbs).toFixed(0)})`); } } const neg=rets.filter(x=>x<0).length, N=rets.length; setNote('detailHistNote', `Moyenne: ${m.toFixed(2)}% • Écart-type: ${sd.toFixed(2)} • Pertes: ${(N? (neg/N*100):0).toFixed(0)}% des trades`); }catch(_){ }
const totalSecs=Math.max(1, (maxTs>minTs? (maxTs-minTs) : (bars[eIdx].time-bars[sIdx].time))); const days=totalSecs/86400; const freq = (res.tradesCount||0)/(days||1); const timeInMkt = Math.max(0, Math.min(100, 100*(totalDur/Math.max(1, totalSecs)))); const effLabels=['Win Rate','Avg R:R','Trade Efficiency','Time in Market','Trades / jour']; const effVals=[winrate, Math.max(0, Math.min(100, (avgRR/2)*100)), teN, timeInMkt, Math.max(0, Math.min(100, (freq/20)*100))];
  // Expectancy & trade stats (par position)
const groups=(function(){ const t=(res.trades||[]).slice().sort((a,b)=> (a.exitTime||0)-(b.exitTime||0)); const map=new Map(); function keyOf(e){ return `${e.dir}|${e.entryTime}|${e.entry}|${e.initSL}`; } for(const ev of t){ const k=keyOf(ev); let g=map.get(k); if(!g){ g={ entryTime:ev.entryTime, exitTime:ev.exitTime, entry: (Number.isFinite(ev.entry)? ev.entry : null), initSL: (Number.isFinite(ev.initSL)? ev.initSL : null), net:0, dur:0, dir:ev.dir||'long', eq0: (Number(ev.eqBefore)||null) }; map.set(k,g); }
    g.net += Number(ev.net)||0; if(Number.isFinite(ev.exitTime)&&Number.isFinite(ev.entryTime)) g.dur = Math.max(g.dur, ev.exitTime-ev.entryTime); if(Number.isFinite(ev.exitTime)) g.exitTime = ev.exitTime; if(g.entry==null && Number.isFinite(ev.entry)) g.entry = ev.entry; if(g.initSL==null && Number.isFinite(ev.initSL)) g.initSL = ev.initSL; if(g.eq0==null && Number.isFinite(ev.eqBefore)) g.eq0 = Number(ev.eqBefore); }
    return Array.from(map.values()).sort((a,b)=> (a.exitTime||0)-(b.exitTime||0)); })();
const positions = groups.length||0; const expNet = positions? groups.reduce((s,g)=> s+(Number(g.net)||0),0)/positions : 0; const avgDurMin = positions? (groups.reduce((s,g)=> s+(Number(g.dur)||0),0)/positions/60) : 0; const bestNet = positions? Math.max(...groups.map(g=> Number(g.net)||0)) : 0; const worstNet = positions? Math.min(...groups.map(g=> Number(g.net)||0)) : 0;
  // Rolling metrics (window 30 positions)
  const ROLL_N=30; const rollPF=[], rollWin=[], rollRR=[], rollExp=[];
  // Per-position RR approximée: moyenne des rr d'événements de la position, sinon fallback par signe/net
const rrByPos=(function(){ const map=new Map(); const t=(res.trades||[]); function keyOf(e){ return `${e.dir}|${e.entryTime}|${e.entry}|${e.initSL}`; } for(const ev of t){ const k=keyOf(ev); let arr=map.get(k); if(!arr){ arr=[]; map.set(k,arr); } if(Number.isFinite(ev.rr)) arr.push(Number(ev.rr)); }
    const out=[]; for(const g of groups){ const k=`${g.dir}|${g.entryTime}|${g.entry}|${g.initSL}`; const arr=map.get(k)||[]; const m=arr.length? (arr.reduce((x,y)=>x+y,0)/arr.length) : null; out.push(m); } return out; })();
  for(let i=0;i<groups.length;i++){
    const winSlice=groups.slice(Math.max(0,i-ROLL_N+1), i+1);
    const profits=winSlice.map(g=> g.net).filter(x=> x>0).reduce((s,x)=>s+x,0);
    const losses=winSlice.map(g=> g.net).filter(x=> x<0).reduce((s,x)=>s+x,0);
    const pf = (losses<0? profits/Math.abs(losses) : Infinity); rollPF.push(Math.min(5, pf));
    const w = winSlice.filter(g=> g.net>=0).length; rollWin.push(100*w/winSlice.length);
    const rrVals = rrByPos.slice(Math.max(0,i-ROLL_N+1), i+1).filter(x=> Number.isFinite(x)); rollRR.push(rrVals.length? (rrVals.reduce((s,x)=>s+x,0)/rrVals.length) : 0);
    rollExp.push(winSlice.reduce((s,g)=> s+(Number(g.net)||0),0)/winSlice.length);
  }
  // Durations & streaks
  const durationsMin = groups.map(g=> Math.max(0, (Number(g.dur)||0)/60));
  const retLong=[], retShort=[]; for(const g of groups){ const eq0=Number.isFinite(g.eq0)&&g.eq0>0? g.eq0 : (Number(conf.startCap)||1); const rpct = (Number(g.net)||0)/eq0*100; if(g.dir==='long') retLong.push(rpct); else retShort.push(rpct); }
  // Bootstrap CIs (95%) for Win%, PF, Expectancy (par position)
  let ciBoot=null; try{ const nets=groups.map(g=> Number(g.net)||0); const L=nets.length; if(L>=8){ const B=200; const pfArr=[], wrArr=[], expArr=[]; function q(a,p){ const s=a.slice().sort((x,y)=>x-y); const idx=Math.max(0, Math.min(s.length-1, Math.floor((s.length-1)*p))); return s[idx]; }
    for(let b=0;b<B;b++){ let gp=0, gl=0, wins=0, sum=0; for(let i=0;i<L;i++){ const v=nets[Math.floor(Math.random()*L)]; sum+=v; if(v>=0){ gp+=v; wins++; } else { gl+=v; } } const pfv = gl<0? (gp/Math.abs(gl)) : 10; pfArr.push(pfv); wrArr.push(100*wins/L); expArr.push(sum/L); }
    ciBoot={ win:[q(wrArr,0.025), q(wrArr,0.975)], pf:[q(pfArr,0.025), q(pfArr,0.975)], exp:[q(expArr,0.025), q(expArr,0.975)] };
  } }catch(_){ ciBoot=null; }
  // Streaks
  const sortedPos = groups.slice().sort((a,b)=> (a.exitTime||0)-(b.exitTime||0)); let curType=null, curLen=0; const winLen=[], loseLen=[]; function pushStreak(){ if(curLen>0){ if(curType==='win') winLen.push(curLen); else loseLen.push(curLen); } }
  for(const g of sortedPos){ const typ=(g.net>=0?'win':'lose'); if(typ===curType){ curLen++; } else { pushStreak(); curType=typ; curLen=1; } } pushStreak(); const maxStreak=Math.max(1,...winLen, ...loseLen); const winCounts=new Array(Math.max(1,maxStreak+1)).fill(0); const loseCounts=new Array(Math.max(1,maxStreak+1)).fill(0); for(const k of winLen) winCounts[k]=(winCounts[k]||0)+1; for(const k of loseLen) loseCounts[k]=(loseCounts[k]||0)+1;
  drawBars(canEff, effLabels, effVals);
  try{ const idxs=effVals.map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]); const best=effLabels[idxs[0][1]]; const worst=effLabels[idxs[idxs.length-1][1]]; setNote('detailEffNote', `Point fort: ${best} • À améliorer: ${worst}`); }catch(_){ }
  // Heaven efficiency bars
  try{ if(typeof H!=='undefined' && H){ const totalSecsH=Math.max(1, (H.maxTs>H.minTs? (H.maxTs-H.minTs) : (bars[eIdx].time-bars[sIdx].time))); const daysH=totalSecsH/86400; const freqH = (resCmp.tradesCount||0)/(daysH||1); const timeInMktH = Math.max(0, Math.min(100, 100*(H.totalDur/Math.max(1, totalSecsH)))); const pfH = (resCmp.profitFactor===Infinity? 3 : Math.max(0, Math.min(3, +resCmp.profitFactor||0))); const teNH = Math.max(0, Math.min(100, ((+resCmp.winrate||0)/100) * (pfH/(pfH+1))*100)); const effValsH=[(+resCmp.winrate||0), Math.max(0, Math.min(100, ((+resCmp.avgRR||0)/2)*100)), teNH, timeInMktH, Math.max(0, Math.min(100, (freqH/20)*100))]; const canEH=ensureHeavenClone('detailEff'); if(canEH){ drawBars(canEH, effLabels, effValsH); } } }catch(_){ }
  const complexity = (6 + (+!!(ctx.params&&ctx.params.useFibRet)) + (ctx.params&&ctx.params.confirmMode?1:0) + (Array.isArray((ctx.params&&ctx.params.tp))? ctx.params.tp.length:0)); const compN = Math.max(0, Math.min(100, (complexity/20)*100));
  drawRobust(canRob, compN, edgeN);
  try{ setNote('detailRobustNote', `Complexité ${compN.toFixed(0)}% • Robustesse ${edgeN.toFixed(0)}%`); }catch(_){ }
  // Rolling charts
  try{ drawLineChart(canRollPF, rollPF, { title:'Rolling PF (fenêtre 30)', yMin:0, yMax: Math.max(3, Math.min(5, Math.max(...rollPF,3))), fmt:(v)=> (v===Infinity?'∞':v.toFixed(2)) }); registerChart('detailRollPF', { type:'rolling', name:'PF', values: rollPF.slice() }); }catch(_){ }
  try{ drawLineChart(canRollWin, rollWin, { title:'Rolling Win% (fenêtre 30)', yMin:0, yMax:100, fmt:(v)=> v.toFixed(0)+'%' }); registerChart('detailRollWin', { type:'rolling', name:'Win%', values: rollWin.slice() }); }catch(_){ }
  try{ drawLineChart(canRollRR, rollRR, { title:'Rolling Avg R:R (fenêtre 30)', yMin:0, yMax: Math.max(2, Math.max(...rollRR,1.5)), fmt:(v)=> v.toFixed(2) }); registerChart('detailRollRR', { type:'rolling', name:'Avg R:R', values: rollRR.slice() }); }catch(_){ }
  try{ drawLineChart(canRollExp, rollExp, { title:'Rolling Expectancy (USD, fen.30)', yMin: Math.min(0, Math.min(...rollExp,0)), yMax: Math.max(0, Math.max(...rollExp,0)), fmt:(v)=> v.toFixed(2) }); registerChart('detailRollExp', { type:'rolling', name:'Expectancy', values: rollExp.slice() }); }catch(_){ }
  // Heaven rollings
  try{ if(typeof H!=='undefined' && H){ const c1=ensureHeavenClone('detailRollPF'); if(c1){ drawLineChart(c1, H.rollPF, { title:'Rolling PF (fenêtre 30)', yMin:0, yMax: Math.max(3, Math.min(5, Math.max(...H.rollPF,3))), fmt:(v)=> (v===Infinity?'∞':v.toFixed(2)) }); registerChart('detailRollPFHeaven', { type:'rolling', name:'PF', values: H.rollPF.slice() }); }
    const c2=ensureHeavenClone('detailRollWin'); if(c2){ drawLineChart(c2, H.rollWin, { title:'Rolling Win% (fenêtre 30)', yMin:0, yMax:100, fmt:(v)=> v.toFixed(0)+'%' }); registerChart('detailRollWinHeaven', { type:'rolling', name:'Win%', values: H.rollWin.slice() }); }
    const c3=ensureHeavenClone('detailRollRR'); if(c3){ drawLineChart(c3, H.rollRR, { title:'Rolling Avg R:R (fenêtre 30)', yMin:0, yMax: Math.max(2, Math.max(...H.rollRR,1.5)), fmt:(v)=> v.toFixed(2) }); registerChart('detailRollRRHeaven', { type:'rolling', name:'Avg R:R', values: H.rollRR.slice() }); }
    const c4=ensureHeavenClone('detailRollExp'); if(c4){ drawLineChart(c4, H.rollExp, { title:'Rolling Expectancy (USD, fen.30)', yMin: Math.min(0, Math.min(...H.rollExp,0)), yMax: Math.max(0, Math.max(...H.rollExp,0)), fmt:(v)=> v.toFixed(2) }); registerChart('detailRollExpHeaven', { type:'rolling', name:'Expectancy', values: H.rollExp.slice() }); } } }catch(_){ }
  try{ const med=(a)=>{ const s=a.slice().sort((x,y)=>x-y); return s.length? s[Math.floor(s.length/2)] : 0; }; setNote('detailRollPFNote', `Dernier ${rollPF.length? (rollPF[rollPF.length-1]).toFixed(2):'—'} • Médiane ${med(rollPF).toFixed(2)}`); setNote('detailRollWinNote', `Dernier ${rollWin.length? (rollWin[rollWin.length-1]).toFixed(0)+'%':'—'} • Médiane ${med(rollWin).toFixed(0)}%`); setNote('detailRollRRNote', `Dernier ${rollRR.length? (rollRR[rollRR.length-1]).toFixed(2):'—'} • Médiane ${med(rollRR).toFixed(2)}`); setNote('detailRollExpNote', `Dernier ${rollExp.length? (rollExp[rollExp.length-1]).toFixed(2):'—'} • Médiane ${med(rollExp).toFixed(2)}`); }catch(_){ }
  // Diagnostics charts
  try{ drawDurations(canDur, durationsMin); registerChart('detailDurHist', { type:'rolling', name:'Duration(min)', values: durationsMin.slice() }); }catch(_){ }
  try{ const srt=durationsMin.slice().sort((a,b)=>a-b); const p50=srt.length? srt[Math.floor(0.5*(srt.length-1))]:0; const p95=srt.length? srt[Math.floor(0.95*(srt.length-1))]:0; setNote('detailDurHistNote', `Durée médiane ${p50.toFixed(1)} min • 95% < ${p95.toFixed(1)} min`); }catch(_){ }
  // Heaven durations
  try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailDurHist'); if(c){ drawDurations(c, H.durationsMin||[]); try{ registerChart('detailDurHistHeaven', { type:'rolling', name:'Duration(min)', values: (H.durationsMin||[]).slice() }); }catch(__){} } } }catch(_){ }
  try{ drawUnderwater(document.getElementById('detailUnder'), eq); const days = Math.max(1,( (maxTs>minTs? (maxTs-minTs) : (bars[eIdx].time-bars[sIdx].time)) / 86400 )); const years=days/365; const startE=eq[0]?.equity||conf.startCap||0; const endE=eq[eq.length-1]?.equity||startE; const cagr = (startE>0 && years>0)? (Math.pow(endE/startE, 1/years)-1) : 0; // risk metrics
    let peak=eq[0]?.equity||0; const uw=eq.map(p=>{ peak=Math.max(peak, p.equity||0); return peak>0? ((p.equity-peak)/peak*100) : 0; }); const ulcer = Math.sqrt(uw.reduce((s,v)=> s + Math.pow(Math.min(0,v),2),0)/Math.max(1,uw.length)); const ddMaxPct = Math.min(0, Math.min(...uw)); const mar = (ddMaxPct<0)? (cagr/Math.abs(ddMaxPct/100)) : 0; const negR = rets.filter(x=>x<0); const ddn = Math.sqrt((negR.length? negR.reduce((s,x)=>s+x*x,0)/negR.length : 0)); const sortino = (ddn>0)? (m/ddn) : 0; const posR=rets.filter(x=>x>0).reduce((s,x)=>s+x,0), negAbs=rets.filter(x=>x<0).reduce((s,x)=>s+Math.abs(x),0); const omega = (negAbs>0)? (posR/negAbs) : Infinity; // VaR/ES (95%)
    const sr=rets.slice().sort((a,b)=>a-b); const qIdx=Math.floor(0.05*Math.max(0,sr.length-1)); const var95 = sr.length? sr[qIdx] : 0; const es95 = sr.length? (sr.slice(0,qIdx+1).reduce((s,x)=>s+x,0)/Math.max(1,qIdx+1)) : 0; setNote('detailUnderNote', `CAGR ${(cagr*100).toFixed(1)}% • Ulcer ${ulcer.toFixed(2)} • MAR ${mar.toFixed(2)} • Sortino ${sortino.toFixed(2)} • Omega ${omega===Infinity?'∞':omega.toFixed(2)} • VaR95 ${var95.toFixed(2)}% • ES95 ${es95.toFixed(2)}%`); }catch(_){ }
  try{ drawStreaks(canStreaks, winCounts, loseCounts); try{ registerChart('detailStreaks', { type:'streaks', win: winCounts.slice(), lose: loseCounts.slice() }); }catch(__){} }catch(_){ }
  // Heaven durations + underwater + streaks/LS will follow after H derivation
  try{ const lw = winLen.length? Math.max(...winLen) : 0; const ll = loseLen.length? Math.max(...loseLen) : 0; setNote('detailStreaksNote', `Plus longue série: ${lw} gains, ${ll} pertes`); }catch(_){ }
try{ drawHistLongShort(canLS, retLong, retShort); try{ registerChart('detailLSHist', { type:'lsdist', long: retLong.slice(), short: retShort.slice() }); }catch(__){} }catch(_){ }
  try{ const mean=(a)=> a.length? a.reduce((x,y)=>x+y,0)/a.length:0; setNote('detailLSHistNote', `Moyenne Long ${mean(retLong).toFixed(2)}% • Short ${mean(retShort).toFixed(2)}%`); }catch(_){ }
  // Heaven Long/Short distributions
  try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailLSHist'); if(c){ drawHistLongShort(c, H.retLong||[], H.retShort||[]); try{ registerChart('detailLSHistHeaven', { type:'lsdist', long:(H.retLong||[]).slice(), short:(H.retShort||[]).slice() }); }catch(__){} } } }catch(_){ }
  // Heaven streaks
  try{ if(typeof H!=='undefined' && H){ const sortedPosH = (H.groups||[]).slice().sort((a,b)=> (a.exitTime||0)-(b.exitTime||0)); let curTypeH=null, curLenH=0; const winLenH=[], loseLenH=[]; function pushStreakH(){ if(curLenH>0){ if(curTypeH==='win') winLenH.push(curLenH); else loseLenH.push(curLenH); } }
    for(const g of sortedPosH){ const typ=(g.net>=0?'win':'lose'); if(typ===curTypeH){ curLenH++; } else { pushStreakH(); curTypeH=typ; curLenH=1; } } pushStreakH(); const maxStreakH=Math.max(1,...winLenH, ...loseLenH); const winCountsH=new Array(Math.max(1,maxStreakH+1)).fill(0); const loseCountsH=new Array(Math.max(1,maxStreakH+1)).fill(0); for(const k of winLenH) winCountsH[k]=(winCountsH[k]||0)+1; for(const k of loseLenH) loseCountsH[k]=(loseCountsH[k]||0)+1; const cH=ensureHeavenClone('detailStreaks'); if(cH){ drawStreaks(cH, winCountsH, loseCountsH); try{ registerChart('detailStreaksHeaven', { type:'streaks', win: winCountsH.slice(), lose: loseCountsH.slice() }); }catch(__){} } } }catch(_){ }
  // MAE/MFE points
  try{
    const timeToIdx=(ts)=>{ let lo=0, hi=bars.length-1, ans=0; while(lo<=hi){ const mid=(lo+hi)>>1; if(bars[mid].time<=ts){ ans=mid; lo=mid+1; } else hi=mid-1; } return ans; };
    const maePts=[];
    for(const g of groups){ if(!Number.isFinite(g.entryTime) || !Number.isFinite(g.exitTime) || !Number.isFinite(g.entry) || !Number.isFinite(g.initSL)) continue; const i0=timeToIdx(g.entryTime), i1=timeToIdx(g.exitTime); if(i1<=i0) continue; let hi=-Infinity, lo=Infinity; for(let i=i0;i<=i1;i++){ hi=Math.max(hi, bars[i].high); lo=Math.min(lo, bars[i].low); } const entry=g.entry; const risk=Math.max(1e-9, Math.abs(entry - g.initSL)); let maeR=0, mfeR=0; if(g.dir==='long'){ maeR = Math.max(0, (entry - lo)/risk); mfeR = Math.max(0, (hi - entry)/risk); } else { maeR = Math.max(0, (hi - entry)/risk); mfeR = Math.max(0, (entry - lo)/risk); } maePts.push({ maeR, mfeR, win: (g.net||0)>=0 }); }
    drawMAEMFEScatter(canMAEMFE, maePts);
    try{ registerChart('detailMAEMFE', { type:'maemfe', points: maePts.slice() }); }catch(__){}
    try{ maePtsVar = maePts.slice(); const mean=(a)=> a.length? a.reduce((x,y)=>x+y,0)/a.length:0; const aMFE=mean(maePts.map(p=>p.mfeR)); const aMAE=mean(maePts.map(p=>p.maeR)); setNote('detailMAEMFENote', `MFE moyen ${aMFE.toFixed(2)}R • MAE moyen ${aMAE.toFixed(2)}R`); }catch(__){}
  }catch(_){ }
  // Heaven Underwater
  try{ if(typeof H!=='undefined' && H && eqCmp){ const canUH=ensureHeavenClone('detailUnder'); if(canUH){ drawUnderwater(canUH, eqCmp); const daysH = Math.max(1,( (H.maxTs>H.minTs? (H.maxTs-H.minTs) : (bars[eIdx].time-bars[sIdx].time)) / 86400 )); const yearsH=daysH/365; const startEH=H.eq[0]?.equity||conf.startCap||0; const endEH=H.eq[H.eq.length-1]?.equity||startEH; const cagrH = (startEH>0 && yearsH>0)? (Math.pow(endEH/startEH, 1/yearsH)-1) : 0; let peakH=H.eq[0]?.equity||0; const uwH=H.eq.map(p=>{ peakH=Math.max(peakH, p.equity||0); return peakH>0? ((p.equity-peakH)/peakH*100) : 0; }); const ulcerH = Math.sqrt(uwH.reduce((s,v)=> s + Math.pow(Math.min(0,v),2),0)/Math.max(1,uwH.length)); const ddMaxPctH = Math.min(0, Math.min(...uwH)); const marH = (ddMaxPctH<0)? (cagrH/Math.abs(ddMaxPctH/100)) : 0; const negRH = H.rets.filter(x=>x<0); const ddnH = Math.sqrt((negRH.length? negRH.reduce((s,x)=>s+x*x,0)/negRH.length : 0)); const mH=(H.rets.length? H.rets.reduce((a,b)=>a+b,0)/H.rets.length:0); const sortinoH = (ddnH>0)? (mH/ddnH) : 0; const posRH=H.rets.filter(x=>x>0).reduce((s,x)=>s+x,0), negAbsH=H.rets.filter(x=>x<0).reduce((s,x)=>s+Math.abs(x),0); const omegaH = (negAbsH>0)? (posRH/negAbsH) : Infinity; const srH=H.rets.slice().sort((a,b)=>a-b); const qIdxH=Math.floor(0.05*Math.max(0,srH.length-1)); const var95H = srH.length? srH[qIdxH] : 0; const es95H = srH.length? (srH.slice(0,qIdxH+1).reduce((s,x)=>s+x,0)/Math.max(1,qIdxH+1)) : 0; setNote('detailUnderHeavenNote', `CAGR ${(cagrH*100).toFixed(1)}% • Ulcer ${ulcerH.toFixed(2)} • MAR ${marH.toFixed(2)} • Sortino ${sortinoH.toFixed(2)} • Omega ${omegaH===Infinity?'∞':omegaH.toFixed(2)} • VaR95 ${var95H.toFixed(2)}% • ES95 ${es95H.toFixed(2)}%`); } } }catch(_){ }
// Seasonality — weekly heatmap
  try{
    function isoYearWeek(ts){ const d=new Date(ts*1000); // copy UTC date
      const dt=new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dayNum = dt.getUTCDay() || 7; // 1..7 (Mon..Sun)
      dt.setUTCDate(dt.getUTCDate() + 4 - dayNum); // nearest Thu for ISO year
      const isoYear = dt.getUTCFullYear();
      const yearStart = new Date(Date.UTC(isoYear,0,1));
      const week = Math.ceil((((dt - yearStart)/86400000) + 1) / 7);
      return { y: isoYear, w: Math.max(1, Math.min(53, week)) };
    }
    const endByYW=new Map(); if(eq && eq.length){ for(const p of eq){ const yw=isoYearWeek(p.time); const key=`${yw.y}-${yw.w}`; endByYW.set(key, p.equity); } }
    const keys=Array.from(endByYW.keys()).sort((a,b)=>{ const [ay,aw]=a.split('-').map(Number), [by,bw]=b.split('-').map(Number); return ay!==by? ay-by : aw-bw; });
    const cells=[]; let prev=null; for(const k of keys){ const v=endByYW.get(k); if(prev!=null){ const [y,w]=k.split('-').map(Number); const r=((v-prev)/prev)*100; cells.push({ y, w, r }); } prev=v; }
drawWeeklyHeatmap(canWeekly, cells);
    try{ registerChart('detailWeekly', { type:'weekly', cells: cells.slice() }); weeklyCells = cells.slice(); if(weeklyCells.length){ const r=weeklyCells.map(c=>c.r); const mn=Math.min(...r), mx=Math.max(...r); const avg=r.reduce((a,b)=>a+b,0)/r.length; setNote('detailWeeklyNote', `Moy. hebdo ${avg.toFixed(2)}% • Meilleure ${mx.toFixed(1)}% • Pire ${mn.toFixed(1)}%`); } }catch(__){}
  }catch(_){ }
  // Heaven weekly
  try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailWeekly'); if(c){ drawWeeklyHeatmap(c, H.weekly); registerChart('detailWeeklyHeaven', { type:'weekly', cells: H.weekly.slice() }); } } }catch(_){ }
  // Seasonality — day-of-week bars
  try{
    function toYMD(ts){ const d=new Date(ts*1000); return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`; }
    const eod=new Map(); if(eq && eq.length){ for(const p of eq){ const key=toYMD(p.time); eod.set(key, p.equity); } }
    const days=Array.from(eod.keys()).sort(); const dowVals=[0,0,0,0,0,0,0], dowCnt=[0,0,0,0,0,0,0]; let prev=null; for(const d of days){ const v=eod.get(d); if(prev!=null){ const ret=((v-prev)/prev)*100; const [y,m,dd]=d.split('-').map(Number); const dt=new Date(Date.UTC(y,m-1,dd)); const dow=(dt.getUTCDay()+6)%7; dowVals[dow]+=ret; dowCnt[dow]++; } prev=v; }
    const labels=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']; const arr=labels.map((k,i)=>({k, v: (dowCnt[i]>0? dowVals[i]/dowCnt[i] : 0)}));
    drawDOWBars(canDOW, arr);
    try{ registerChart('detailDOW', { type:'bars', labels: arr.map(x=>x.k), values: arr.map(x=>x.v) }); }catch(__){}
    try{ dowArr = arr.slice(); if(dowArr.length){ let best=dowArr[0], worst=dowArr[0]; for(const x of dowArr){ if(x.v>best.v) best=x; if(x.v<worst.v) worst=x; } setNote('detailDOWNote', `Jour le plus favorable: ${best.k} (${best.v.toFixed(2)}%) • Le moins: ${worst.k} (${worst.v.toFixed(2)}%)`); } }catch(__){}
  }catch(_){ }
  // Heaven DOW bars
  try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailDOW'); if(c){ drawDOWBars(c, H.dow||[]); try{ registerChart('detailDOWHeaven', { type:'bars', labels: (H.dow||[]).map(x=>x.k), values: (H.dow||[]).map(x=>x.v) }); }catch(__){} } } }catch(_){ }
  // Heaven MAE/MFE
  try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailMAEMFE'); if(c){ drawMAEMFEScatter(c, H.maePts||[]); try{ registerChart('detailMAEMFEHeaven', { type:'maemfe', points: (H.maePts||[]).slice() }); }catch(__){} } } }catch(_){ }
// Seasonality — weekly heatmap
  try{
    function toYMDH(ts){ const d=new Date(ts*1000); return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}-${d.getUTCHours()}`; }
    const eoh=new Map(); if(eq && eq.length){ for(const p of eq){ const key=toYMDH(p.time); eoh.set(key, p.equity); } }
    const keys=Array.from(eoh.keys()).map(k=>{ const [y,m,d,h]=k.split('-').map(Number); return { ts: Date.UTC(y,m-1,d,h)/1000, k }; }).sort((a,b)=> a.ts-b.ts);
    const sum=Array.from({length:7},()=> new Array(24).fill(0)), cnt=Array.from({length:7},()=> new Array(24).fill(0)); let prev2=null; for(const it of keys){ const v=eoh.get(it.k); if(prev2!=null){ const ret=((v-prev2)/prev2)*100; const dt=new Date(it.ts*1000); const dow=(dt.getUTCDay()+6)%7; const hr=dt.getUTCHours(); sum[dow][hr]+=ret; cnt[dow][hr]++; } prev2=v; }
    const cells2=[]; for(let r=0;r<7;r++){ for(let c=0;c<24;c++){ const v=cnt[r][c]>0? (sum[r][c]/cnt[r][c]) : 0; cells2.push({ r, c, d:r, h:c, r:v }); } }
    drawDOWHourHeatmap(canDOWHour, cells2);
    try{ /* also register for CSV if needed */ }catch(__){}
    try{ registerChart('detailDOWHour', { type:'heatmap', cells: cells2.slice(), rows:7, cols:24 }); dowHourCells=cells2.slice(); if(dowHourCells.length){ let best=dowHourCells[0], worst=dowHourCells[0]; for(const x of dowHourCells){ if(x.r>best.r) best=x; if(x.r<worst.r) worst=x; } const lab=(x)=> ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][x.d]+' '+String(x.h).padStart(2,'0')+'h'; setNote('detailDOWHourNote', `Meilleur créneau: ${lab(best)} (${best.r.toFixed(2)}%) • Pire: ${lab(worst)} (${worst.r.toFixed(2)}%)`); } }catch(__){}
  }catch(_){ }
  // Heaven DOW×Heure (global)
  try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailDOWHour'); if(c){ drawDOWHourHeatmap(c, H.dowHour||[]); registerChart('detailDOWHourHeaven', { type:'heatmap', cells: (H.dowHour||[]).slice(), rows:7, cols:24 }); } } }catch(_){ }
  // Day×Hour — Long-only and Short-only (by entry hour, mean % return per position)
  try{
    const mkCells=(dir)=>{ const sum=Array.from({length:7},()=> new Array(24).fill(0)); const cnt=Array.from({length:7},()=> new Array(24).fill(0)); for(const g of groups){ if(g && g.dir===dir && Number.isFinite(g.entryTime)){ const eq0=Number.isFinite(g.eq0)&&g.eq0>0? g.eq0 : (Number(conf.startCap)||1); const rpct=(Number(g.net)||0)/eq0*100; const dt=new Date((g.entryTime||0)*1000); const dow=(dt.getUTCDay()+6)%7; const hr=dt.getUTCHours(); sum[dow][hr]+=rpct; cnt[dow][hr]++; } } const cells=[]; for(let r=0;r<7;r++){ for(let c=0;c<24;c++){ const v=cnt[r][c]>0? (sum[r][c]/cnt[r][c]) : 0; cells.push({ r, c, d:r, h:c, r:v }); } } return cells; };
    try{ if(canDOWHourLong){ const cL=mkCells('long'); dhLongCells=cL.slice(); drawDOWHourHeatmap(canDOWHourLong, cL); registerChart('detailDOWHourLong', { type:'heatmap', cells:cL.slice(), rows:7, cols:24 }); if(cL.length){ let best=cL[0], worst=cL[0]; for(const x of cL){ if(x.r>best.r) best=x; if(x.r<worst.r) worst=x; } const lab=(x)=> ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][x.d]+' '+String(x.h).padStart(2,'0')+'h'; setNote('detailDOWHourLongNote', `Best: ${lab(best)} (${best.r.toFixed(2)}%) • Worst: ${lab(worst)} (${worst.r.toFixed(2)}%)`); } } }catch(__){}
    try{ if(canDOWHourShort){ const cS=mkCells('short'); dhShortCells=cS.slice(); drawDOWHourHeatmap(canDOWHourShort, cS); registerChart('detailDOWHourShort', { type:'heatmap', cells:cS.slice(), rows:7, cols:24 }); if(cS.length){ let best=cS[0], worst=cS[0]; for(const x of cS){ if(x.r>best.r) best=x; if(x.r<worst.r) worst=x; } const lab=(x)=> ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][x.d]+' '+String(x.h).padStart(2,'0')+'h'; setNote('detailDOWHourShortNote', `Best: ${lab(best)} (${best.r.toFixed(2)}%) • Worst: ${lab(worst)} (${worst.r.toFixed(2)}%)`); } } }catch(__){}
  }catch(_){ }
  // Heaven DOW×Heure — Long/Short
  try{ if(typeof H!=='undefined' && H){ const cl=ensureHeavenClone('detailDOWHourLong'); if(cl){ drawDOWHourHeatmap(cl, H.dowHourLong||[]); registerChart('detailDOWHourLongHeaven', { type:'heatmap', cells:(H.dowHourLong||[]).slice(), rows:7, cols:24 }); } const cs=ensureHeavenClone('detailDOWHourShort'); if(cs){ drawDOWHourHeatmap(cs, H.dowHourShort||[]); registerChart('detailDOWHourShortHeaven', { type:'heatmap', cells:(H.dowHourShort||[]).slice(), rows:7, cols:24 }); } } }catch(_){ }
  // Regime heatmap (Trend × Vol)
  try{
    const prd=Math.max(2, lbcOpts.prd|0); const lb=computeLineBreakState(bars, Math.max(1, lbcOpts.nol|0));
    // ATR% (Wilder 14)
    function atrPct(data, len){ const tr=new Array(data.length).fill(0); for(let i=1;i<data.length;i++){ const h=data[i].high, l=data[i].low, cPrev=data[i-1].close; tr[i]=Math.max(h-l, Math.abs(h-cPrev), Math.abs(l-cPrev)); } const atr=new Array(data.length).fill(0); let s=0; for(let i=0;i<data.length;i++){ if(i<len){ s+=tr[i]; atr[i]=s/Math.max(1,i+1); } else { atr[i]=(atr[i-1]*(len-1)+tr[i])/len; } } return atr.map((a,i)=> (a/Math.max(1e-9, data[i].close))*100); }
    const atrP = atrPct(bars, 14); const vals=atrP.filter(x=> Number.isFinite(x)); const sorted=vals.slice().sort((a,b)=>a-b); const q1=sorted[Math.floor(sorted.length*0.33)]||0, q2=sorted[Math.floor(sorted.length*0.66)]||0;
    const bucketVol=(x)=> x<=q1? 'Low' : (x>=q2? 'High' : 'Med'); const bucketTrend=(i)=> lb.trend[i]===1? 'Up':'Down';
    const mat={ Up:{Low:{pf:0,gp:0,gl:0,count:0}, Med:{pf:0,gp:0,gl:0,count:0}, High:{pf:0,gp:0,gl:0,count:0}}, Down:{Low:{pf:0,gp:0,gl:0,count:0}, Med:{pf:0,gp:0,gl:0,count:0}, High:{pf:0,gp:0,gl:0,count:0}} };
    const idxOfTime=(ts)=>{ let lo=0, hi=bars.length-1, ans=0; while(lo<=hi){ const mid=(lo+hi)>>1; if(bars[mid].time<=ts){ ans=mid; lo=mid+1; } else hi=mid-1; } return ans; };
    for(const g of groups){ const i=idxOfTime(g.entryTime); const tr=bucketTrend(Math.min(i, lb.trend.length-1)); const vol=bucketVol(atrP[Math.min(i, atrP.length-1)]||0); const cell=mat[tr][vol]; cell.count++; if((g.net||0)>=0) cell.gp += (g.net||0); else cell.gl += (g.net||0); }
    for(const r of ['Up','Down']){ for(const c of ['Low','Med','High']){ const cell=mat[r][c]; cell.pf = (cell.gl<0? cell.gp/Math.abs(cell.gl) : (cell.count>0? Infinity:0)); } }
drawRegimeHeatmap(canRegime, mat);
    try{ regimeMat = mat; let best={r:'',c:'',pf:-Infinity,count:0}, worst={r:'',c:'',pf:Infinity,count:0}; for(const rr of ['Up','Down']){ for(const cc of ['Low','Med','High']){ const cell=mat[rr][cc]; const pf=(cell.pf===Infinity? 5: cell.pf||0); if(pf>best.pf){ best={r:rr,c:cc,pf, count:cell.count}; } if(pf<worst.pf){ worst={r:rr,c:cc,pf, count:cell.count}; } } } setNote('detailRegimeNote', `Meilleur régime: ${best.r}/${best.c} (PF ${best.pf.toFixed(2)}, n=${best.count}) • Pire: ${worst.r}/${worst.c}`); }catch(__){}
  }catch(_){ }
  // Heaven regime
  try{ if(typeof H!=='undefined' && H && H.regime){ const c=ensureHeavenClone('detailRegime'); if(c){ drawRegimeHeatmap(c, H.regime); } } }catch(_){ }
  // Pareto (Palmarès)
  try{
    let pal = (Array.isArray(window.labPalmaresCache) && window.labPalmaresCache.length)? window.labPalmaresCache.slice() : [];
    const drawFrom = (arr)=>{
      const pts=[]; if(Array.isArray(arr)){
        for(const it of arr){ const st=it.res||{}; const score=(typeof it.score==='number')? it.score : 0; if(Number.isFinite(st.maxDDAbs)&&Number.isFinite(st.totalPnl)){ pts.push({ dd:+st.maxDDAbs, pnl:+st.totalPnl, score }); } }
      }
      if(!pts.length){ pts.push({ dd: Math.max(0, +res.maxDDAbs||0), pnl: +res.totalPnl||0, score: (Number.isFinite(res.score)? res.score:0) }); }
      drawPareto(canPareto, pts);
      try{ registerChart('detailPareto', { type:'pareto', points: pts.slice() }); }catch(__){}
      try{ const dd=+res.maxDDAbs||0, pnl=+res.totalPnl||0; const ratio = dd>0? (pnl/Math.abs(dd)) : Infinity; setNote('detailParetoNote', `Point courant: P&L ${pnl.toFixed(0)} • Max DD ${dd.toFixed(0)} • Ratio P&L/DD ${ratio===Infinity?'∞':ratio.toFixed(2)}`); }catch(__){}
    };
    if(pal.length){ drawFrom(pal); }
    else if(window.SUPA && typeof SUPA.fetchPalmares==='function'){
      try{ SUPA.fetchPalmares(sym, tf, 50).then(arr=>{ drawFrom(arr||[]); }).catch(()=> drawFrom([])); }catch(__){ drawFrom([]); }
    } else { drawFrom([]); }
  }catch(_){ }
  // Heaven Pareto
  try{ if(typeof resCmp!=='undefined' && resCmp){ let pal = (Array.isArray(window.labPalmaresCache) && window.labPalmaresCache.length)? window.labPalmaresCache.slice() : []; const pts=[]; if(Array.isArray(pal)){ for(const it of pal){ const st=it.res||{}; const score=(typeof it.score==='number')? it.score : 0; if(Number.isFinite(st.maxDDAbs)&&Number.isFinite(st.totalPnl)){ pts.push({ dd:+st.maxDDAbs, pnl:+st.totalPnl, score }); } } } if(!pts.length){ pts.push({ dd: Math.max(0, +resCmp.maxDDAbs||0), pnl: +resCmp.totalPnl||0, score: (Number.isFinite(resCmp.score)? resCmp.score:0) }); } const c=ensureHeavenClone('detailPareto'); if(c){ drawPareto(c, pts); try{ registerChart('detailParetoHeaven', { type:'pareto', points: pts.slice() }); }catch(__){} } } }catch(_){ }
  // CI bars
  try{ if(canCIs && ciBoot){ drawCIBars(canCIs, ciBoot); try{ const w=ciBoot.win||[0,0], p=ciBoot.pf||[0,0], e=ciBoot.exp||[0,0]; setNote('detailCIsNote', `Win% [${w[0].toFixed(1)} ; ${w[1].toFixed(1)}] • PF [${p[0].toFixed(2)} ; ${p[1].toFixed(2)}] • Exp [${e[0].toFixed(2)} ; ${e[1].toFixed(2)}]`); }catch(__){} } }catch(_){ }
  // Heaven CI bars
  try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailCIs'); if(c){ drawCIBars(c, H.ci||{ win:[0,0], pf:[0,0], exp:[0,0] }); } } }catch(_){ }
// Monte Carlo fan (bootstrap trades)
  try{
    const startCap = Number(conf.startCap)||10000; const rp = (retLong.concat(retShort)).filter(Number.isFinite);
    const L = Math.min(300, rp.length||0); const N = Math.min(50, 5 + Math.floor((rp.length||0)/2)); if(L>5 && N>1){
      const paths=[]; for(let s=0;s<N;s++){ let eq=startCap; const path=[eq]; for(let i=0;i<L;i++){ const r = rp[Math.floor(Math.random()*rp.length)]/100; eq = eq*(1+r); path.push(eq); } paths.push(path); }
      // compute percentiles per step
      const steps=paths[0].length; const p10=[], p50=[], p90=[]; for(let i=0;i<steps;i++){ const col=paths.map(p=> p[i]); col.sort((a,b)=>a-b); const q=(q)=> col[Math.max(0, Math.min(col.length-1, Math.floor((col.length-1)*q)))]; p10.push(q(0.10)); p50.push(q(0.50)); p90.push(q(0.90)); }
      // draw
      const ctx=canMC.getContext('2d'); const w=canMC.width, h=canMC.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, "Monte Carlo — éventail d'équity", 'center'); const padL=56, padR=12, padT=22, padB=28; const min=Math.min(...p10), max=Math.max(...p90); const x=(i)=> i/(steps-1)*(w-padL-padR)+padL; const y=(v)=> h-padB - (v-min)/(max-min+1e-9)*(h-padT-padB); // axes
      ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke();
      // grid + ticks
      const ticks=4; for(let t=0;t<=ticks;t++){ const yy=h-padB - (h-padT-padB)*t/ticks; const val=(min + (max-min)*t/ticks); ctx.beginPath(); ctx.moveTo(padL-3, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, padL-8, yy, val.toFixed(0), 'right'); }
      for(let t=0;t<=ticks;t++){ const xx=padL + (w-padL-padR)*t/ticks; ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, h-padB); ctx.stroke(); __drawText(ctx, xx, h-8, String(Math.round((steps-1)*t/ticks)), 'center'); }
      // band 10-90
      ctx.fillStyle='rgba(37,99,235,0.15)'; ctx.beginPath(); ctx.moveTo(x(0), y(p10[0])); for(let i=1;i<steps;i++) ctx.lineTo(x(i), y(p10[i])); for(let i=steps-1;i>=0;i--) ctx.lineTo(x(i), y(p90[i])); ctx.closePath(); ctx.fill();
      // median
      ctx.strokeStyle='#2563eb'; ctx.lineWidth=2; ctx.beginPath(); for(let i=0;i<steps;i++){ const xx=x(i), yy=y(p50[i]); if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); } ctx.stroke(); __drawText(ctx, padL, h-8, 'Trades (bootstrap) →', 'left');
      try{ mcBands = { p10, p50, p90, startCap }; const medEnd=p50[p50.length-1], p10e=p10[p10.length-1], p90e=p90[p90.length-1]; const g=((medEnd-startCap)/Math.max(1e-9,startCap))*100; setNote('detailMCNote', `Median fin: ${medEnd.toFixed(0)} (${g.toFixed(1)}%) • Bande [${p10e.toFixed(0)} ; ${p90e.toFixed(0)}]`); }catch(__){}
    }
  }catch(_){ }
  // Heaven Monte Carlo
  try{ if(typeof H!=='undefined' && H){ const startCap = Number(conf.startCap)||10000; const rp = (H.retLong.concat(H.retShort)).filter(Number.isFinite); const L = Math.min(300, rp.length||0); const N = Math.min(50, 5 + Math.floor((rp.length||0)/2)); if(L>5 && N>1){ const paths=[]; for(let s=0;s<N;s++){ let eq=startCap; const path=[eq]; for(let i=0;i<L;i++){ const r = rp[Math.floor(Math.random()*rp.length)]/100; eq = eq*(1+r); path.push(eq); } paths.push(path); } const steps=paths[0].length; const p10=[], p50=[], p90=[]; for(let i=0;i<steps;i++){ const col=paths.map(p=> p[i]); col.sort((a,b)=>a-b); const q=(q)=> col[Math.max(0, Math.min(col.length-1, Math.floor((col.length-1)*q)))]; p10.push(q(0.10)); p50.push(q(0.50)); p90.push(q(0.90)); } const c=ensureHeavenClone('detailMC'); if(c){ const ctx=c.getContext('2d'); const w=c.width, h=c.height; ctx.clearRect(0,0,w,h); __drawText(ctx, w/2, 12, "Monte Carlo — éventail d'équity", 'center'); const padL=56, padR=12, padT=22, padB=28; const min=Math.min(...p10), max=Math.max(...p90); const x=(i)=> i/(steps-1)*(w-padL-padR)+padL; const y=(v)=> h-padB - (v-min)/(max-min+1e-9)*(h-padT-padB); ctx.strokeStyle=__clr().border; ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h-padB); ctx.lineTo(w-padR, h-padB); ctx.stroke(); const ticks=4; for(let t=0;t<=ticks;t++){ const yy=h-padB - (h-padT-padB)*t/ticks; const val=(min + (max-min)*t/ticks); ctx.beginPath(); ctx.moveTo(padL-3, yy); ctx.lineTo(w-padR, yy); ctx.stroke(); __drawText(ctx, padL-8, yy, val.toFixed(0), 'right'); } for(let t=0;t<=ticks;t++){ const xx=padL + (w-padL-padR)*t/ticks; ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, h-padB); ctx.stroke(); __drawText(ctx, xx, h-8, String(Math.round((steps-1)*t/ticks)), 'center'); } ctx.fillStyle='rgba(37,99,235,0.15)'; ctx.beginPath(); ctx.moveTo(x(0), y(p10[0])); for(let i=1;i<steps;i++) ctx.lineTo(x(i), y(p10[i])); for(let i=steps-1;i>=0;i--) ctx.lineTo(x(i), y(p90[i])); ctx.closePath(); ctx.fill(); ctx.strokeStyle='#2563eb'; ctx.lineWidth=2; ctx.beginPath(); for(let i=0;i<steps;i++){ const xx=x(i), yy=y(p50[i]); if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); } ctx.stroke(); } } } }catch(_){ }
  // QQ & ACF
  try{ const retsAll = (retLong.concat(retShort)).slice(); drawQQ(canQQ, retsAll); try{ const n=retsAll.length; const mean=(a)=> a.length? a.reduce((x,y)=>x+y,0)/a.length:0; const m=mean(retsAll); const sd=Math.sqrt(mean(retsAll.map(x=>(x-m)*(x-m)))); const skew = (sd>0? mean(retsAll.map(x=>Math.pow((x-m)/sd,3))) : 0); const kurt = (sd>0? mean(retsAll.map(x=>Math.pow((x-m)/sd,4))) : 0); setNote('detailQQNote', `Skew ${skew.toFixed(2)} • Kurtosis ${kurt.toFixed(2)} (3≈normal)`); }catch(__){} try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailQQ'); if(c){ const retsAllH=(H.retLong.concat(H.retShort)).slice(); drawQQ(c, retsAllH); } } }catch(__){} }catch(_){ }
  try{ const retsAll = (retLong.concat(retShort)).slice(); drawACF(canACF, retsAll, 10); try{ const n=retsAll.length; const z=1.96/Math.sqrt(Math.max(1,n)); let sig=0; const m=retsAll.reduce((a,b)=>a+b,0)/Math.max(1,n); const varr=retsAll.reduce((s,x)=>s+(x-m)*(x-m),0); for(let k=1;k<=10;k++){ let num=0; for(let i=0;i<n-k;i++){ num += (retsAll[i]-m)*(retsAll[i+k]-m); } const r = num/(varr||1); if(Math.abs(r)>z) sig++; } setNote('detailACFNote', `${sig} lags significatifs (>±${z.toFixed(2)})`); }catch(__){} try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailACF'); if(c){ const retsAllH=(H.retLong.concat(H.retShort)).slice(); drawACF(c, retsAllH, 10); } } }catch(__){} }catch(_){ }
  // Walk-forward splits (4 segments)
  try{
    const N=4; if(eq && eq.length>10){ const t0=eq[0].time, t1=eq[eq.length-1].time; const bounds=[]; for(let k=0;k<=N;k++){ bounds.push(t0 + Math.round((t1-t0)*k/N)); }
      const segs=[]; for(let k=0;k<N;k++){ const a=bounds[k], b=bounds[k+1]; const gg=groups.filter(g=> Number.isFinite(g.exitTime) && g.exitTime>=a && g.exitTime<b); const L=gg.length; let gp=0, gl=0, wins=0; let exp=0, pnl=0; for(const g of gg){ const net=Number(g.net)||0; pnl+=net; if(net>=0){ gp+=net; wins++; } else { gl+=net; } } if(L>0){ exp = pnl/L; }
        const pf = gl<0? (gp/Math.abs(gl)) : (L>0? Infinity:0); const win = L>0? (wins/L*100):0; segs.push({ pf: Number.isFinite(pf)? pf: Infinity, win, exp, pnl }); }
      drawWFTable(canWF, segs); try{ wfSegs = segs.slice(); const ok=segs.filter(s=> (s.pf===Infinity || s.pf>=1.0)).length; const best=Math.max(...segs.map(s=> (s.pf===Infinity? 9 : s.pf))); const worst=Math.min(...segs.map(s=> (s.pf===Infinity? 9 : s.pf))); setNote('detailWFNote', `${ok}/${segs.length} splits PF≥1 • PF min ${worst.toFixed(2)} / max ${best.toFixed(2)}`); registerChart('detailWF', { type:'wf', splits: segs.slice() }); }catch(__){} }
  }catch(_){ }
  // Heaven WF
  try{ if(typeof H!=='undefined' && H){ const c=ensureHeavenClone('detailWF'); if(c){ drawWFTable(c, H.wf||[]); try{ registerChart('detailWFHeaven', { type:'wf', splits: (H.wf||[]).slice() }); }catch(__){} } } }catch(_){ }
if(detailCtxEl){ const gtxt = (ctx && ctx.gen && ctx.gen>1)? ` • Gen ${ctx.gen}` : ''; detailCtxEl.textContent = `${symbolToDisplay(sym)} • ${tf} — ${name}${gtxt} — PF ${(res.profitFactor===Infinity?'∞':(+res.profitFactor||0).toFixed(2))} • Trades ${res.tradesCount}`; }
  // Summary/commentary (pass advanced metrics)
  try{ const sum = generateStrategySummary(res, ctx, { timeInMkt, freq, expectancy: expNet, avgDurMin, bestNet, worstNet, r2, pf: (res.profitFactor===Infinity? Infinity : (+res.profitFactor||0)), winrate, avgRR, maxDDAbs: +res.maxDDAbs||0, ci: ciBoot }); if(detailSummaryEl) detailSummaryEl.innerHTML = sum; }catch(_){ }
  // Slippage what‑if (bps)
  try{
    const slipInp=document.getElementById('detailSlipBps'); const slipBtn=document.getElementById('detailSlipApply'); const slipNote=document.getElementById('detailSlipNote');
    if(slipBtn && slipInp){ slipBtn.addEventListener('click', ()=>{ try{ const bps=Math.max(0, parseFloat(slipInp.value||'0')); if(!(bps>=0)) return; const evs=Array.isArray(res.trades)? res.trades.slice():[]; // compute adjusted nets per position
      const map=new Map(); function keyOf(e){ return `${e.dir}|${e.entryTime}|${e.entry}|${e.initSL}`; }
      for(const ev of evs){ const k=keyOf(ev); let g=map.get(k); if(!g){ g={ net:0 }; map.set(k,g); } const qty=Math.abs(Number(ev.qty)||0); const pe=Math.abs(Number(ev.entry)||0); const px=Math.abs(Number(ev.exit)||0); const extra=(pe*qty + px*qty)*(bps/10000); const newNet=(Number(ev.net)||0) - extra; g.net += newNet; }
      const gs=Array.from(map.values()); const L=gs.length; let gp=0, gl=0, wins=0, sum=0; for(const g of gs){ const v=Number(g.net)||0; sum+=v; if(v>=0){ gp+=v; wins++; } else { gl+=v; } }
      const pf = gl<0? (gp/Math.abs(gl)) : (L>0? Infinity:0); const win = L>0? (wins/L*100):0; const exp = L>0? (sum/L):0; if(slipNote){ slipNote.textContent = `→ PF ${(pf===Infinity?'∞':pf.toFixed(2))}, Win% ${win.toFixed(1)}%, Exp ${exp.toFixed(2)} USD`; }
    }catch(__){} }); }
  }catch(_){ }
  // Exports + tooltips wiring
  try{
    // PNG/CSV buttons on notes
    function addExportBtns(canvasId){ const note=document.getElementById(canvasId+'Note'); const can=document.getElementById(canvasId); if(!note||!can) return; if(note.dataset&&note.dataset.exp==='1') return; const span=document.createElement('span'); span.style.float='right'; span.style.display='inline-flex'; span.style.gap='6px'; span.innerHTML = `<button class="btn" data-exp="png" data-target="${canvasId}">PNG</button><button class="btn" data-exp="csv" data-target="${canvasId}">CSV</button>`; note.appendChild(span); note.dataset.exp='1'; }
    const __baseExp=['detailEquity','detailHist','detailRollPF','detailRollWin','detailRollRR','detailRollExp','detailWeekly','detailDOWHour','detailDOWHourLong','detailDOWHourShort','detailCIs','detailMC','detailQQ','detailACF','detailWF','detailPareto','detailDurHist','detailStreaks','detailLSHist','detailMAEMFE','detailDOW'];
    __baseExp.concat(__baseExp.map(x=> x+'Heaven')).forEach(addExportBtns);
    if(detailModalEl && !detailModalEl.__expWired){ detailModalEl.addEventListener('click', (e)=>{ const t=e.target; if(!t||!t.getAttribute) return; const exp=t.getAttribute('data-exp'); const id=t.getAttribute('data-target'); if(!exp||!id) return; const can=document.getElementById(id); if(!can) return; if(exp==='png'){ try{ const a=document.createElement('a'); a.href=can.toDataURL('image/png'); a.download=id+'.png'; a.click(); }catch(_){ } return; } if(exp==='csv'){ try{ const spec=chartReg[id]||{}; let csv=''; if(spec.type==='equity'){ const t1=spec.eq1||[]; const t2=spec.eq2||[]; csv='idx,time,eq1'+(t2.length?',eq2':'')+'\n'; for(let i=0;i<Math.max(t1.length,t2.length);i++){ const e1=t1[i]||{}; const e2=t2[i]||{}; csv+=`${i},${e1.time||''},${e1.equity||''}`+(t2.length?`,`+(e2.equity||''):'')+'\n'; } }
          else if(spec.type==='rets'){ csv='idx,ret%\n'; (spec.values||[]).forEach((v,i)=>{ csv+=`${i},${v}\n`; }); }
          else if(spec.type==='rolling'){ csv='idx,'+(spec.name||'value')+'\n'; (spec.values||[]).forEach((v,i)=>{ csv+=`${i},${v}\n`; }); }
          else if(spec.type==='weekly'){ csv='year,week,ret%\n'; (spec.cells||[]).forEach(c=>{ csv+=`${c.y},${c.w},${c.r}\n`; }); }
          else if(spec.type==='heatmap'){ csv='day,hour,value\n'; (spec.cells||[]).forEach(c=>{ csv+=`${c.d},${c.h},${c.r}\n`; }); }
          else if(spec.type==='bars'){ csv='label,value\n'; const labs=(spec.labels||[]), vals=(spec.values||[]); for(let i=0;i<Math.max(labs.length, vals.length);i++){ csv+=`${labs[i]||''},${vals[i]||''}\n`; } }
          else if(spec.type==='streaks'){ csv='length,winCount,loseCount\n'; const w=spec.win||[], l=spec.lose||[]; for(let i=0;i<Math.max(w.length,l.length);i++){ csv+=`${i},${w[i]||0},${l[i]||0}\n`; } }
          else if(spec.type==='lsdist'){ csv='idx,long%,short%\n'; const a=spec.long||[], b=spec.short||[]; for(let i=0;i<Math.max(a.length,b.length);i++){ csv+=`${i},${a[i]||''},${b[i]||''}\n`; } }
          else if(spec.type==='maemfe'){ csv='idx,maeR,mfeR,win\n'; (spec.points||[]).forEach((p,i)=>{ csv+=`${i},${p.maeR||0},${p.mfeR||0},${p.win?1:0}\n`; }); }
          else if(spec.type==='pareto'){ csv='idx,maxDD,pnl,score\n'; (spec.points||[]).forEach((p,i)=>{ csv+=`${i},${p.dd||0},${p.pnl||0},${Number.isFinite(p.score)?p.score:''}\n`; }); }
          else if(spec.type==='wf'){ csv='split,pf,win,exp,pnl\n'; (spec.splits||[]).forEach((s,i)=>{ csv+=`S${i+1},${(s.pf===Infinity?'inf':s.pf)},${s.win||0},${s.exp||0},${s.pnl||0}\n`; }); }
          const blob=new Blob([csv], {type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=id+'.csv'; a.click(); }catch(_){ } }
    }); detailModalEl.__expWired=true; }
    // Equity tooltip
    try{
      if(canEquity){ const handler=(ev)=>{ try{ const rect=canEquity.getBoundingClientRect(); const x=ev.clientX-rect.left; const w=canEquity.width; const padL=46, padR=18; const n=(eq||[]).length; if(n<=1) return; const i=Math.max(0, Math.min(n-1, Math.round((x-padL)/Math.max(1,(w-padL-padR))*(n-1)))); const p=eq[i]; const t=new Date((p.time||0)*1000).toLocaleString(); let html=`${t}<br/>Sel: ${p.equity.toFixed(0)}`; if(eqCmp&&eqCmp.length){ const j=Math.max(0, Math.min(eqCmp.length-1, i)); html+=` • Heaven: ${eqCmp[j].equity.toFixed(0)}`; } showTip(ev.clientX, ev.clientY, html); }catch(_){ } };
        canEquity.addEventListener('mousemove', handler); canEquity.addEventListener('mouseleave', ()=> hideTip()); }
    }catch(_){ }
    // Equity tooltip (Heaven)
    try{
      const canEquityH=document.getElementById('detailEquityHeaven');
      if(canEquityH && eqCmp){ const handlerH=(ev)=>{ try{ const rect=canEquityH.getBoundingClientRect(); const x=ev.clientX-rect.left; const w=canEquityH.width; const padL=46, padR=18; const n=eqCmp.length||0; if(n<=1) return; const i=Math.max(0, Math.min(n-1, Math.round((x-padL)/Math.max(1,(w-padL-padR))*(n-1)))); const p=eqCmp[i]; const t=new Date((p.time||0)*1000).toLocaleString(); const html=`${t}<br/>Heaven: ${p.equity.toFixed(0)}`; showTip(ev.clientX, ev.clientY, html); }catch(_){ } };
        canEquityH.addEventListener('mousemove', handlerH); canEquityH.addEventListener('mouseleave', ()=> hideTip()); }
    }catch(_){ }
    // Heatmap tooltips + click filter on long/short
    function heatHover(can, lab){ if(!can) return; can.addEventListener('mousemove', (ev)=>{ try{ const cfg=can.__heatCfg; if(!cfg) return; const rect=can.getBoundingClientRect(); const x=ev.clientX-rect.left, y=ev.clientY-rect.top; const c=Math.floor((x-cfg.padL)/cfg.cw), r=Math.floor((y-cfg.padT)/cfg.ch); if(c<0||c>=cfg.cols||r<0||r>=cfg.rows) return hideTip(); const cell=cfg.cells[r*cfg.cols+c]; if(!cell) return hideTip(); const dnames=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']; const html=`${lab}: ${dnames[r]} ${String(c).padStart(2,'0')}h — ${Number(cell.r).toFixed(2)}%`; showTip(ev.clientX, ev.clientY, html); }catch(_){ } }); can.addEventListener('mouseleave', ()=> hideTip()); }
    heatHover(canDOWHour, 'Jour×Heure'); heatHover(canDOWHourLong, 'Long'); heatHover(canDOWHourShort, 'Short');
    heatHover(document.getElementById('detailDOWHourHeaven'), 'Jour×Heure (H)');
    heatHover(document.getElementById('detailDOWHourLongHeaven'), 'Long (H)');
    heatHover(document.getElementById('detailDOWHourShortHeaven'), 'Short (H)');
    function filterTradesByDOWHour(dir, r,c){ try{ const dnames=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']; const selGroups = groups.filter(g=>{ if(dir && g.dir!==dir) return false; const dt=new Date((g.entryTime||0)*1000); const dow=(dt.getUTCDay()+6)%7; const hr=dt.getUTCHours(); return dow===r && hr===c; }); const evs=[]; const keyOf=(e)=> `${e.dir}|${e.entryTime}|${e.entry}|${e.initSL}`; const map=new Map(); for(const ev of (res.trades||[])){ const k=keyOf(ev); map.set(k, (map.get(k)||[]).concat([ev])); }
      for(const g of selGroups){ const k=keyOf({dir:g.dir, entryTime:g.entryTime, entry:g.entry, initSL:g.initSL}); const arr=map.get(k)||[]; for(const ev of arr){ evs.push(ev); } }
      if(!evs.length){ setStatus && setStatus(`Aucun trade pour ${dnames[r]} ${String(c).padStart(2,'0')}h ${dir||''}`); return; }
      const state={ trades: evs, symbol: sym, tf, startCap: conf.startCap, equityFinal: conf.startCap + evs.reduce((s,e)=> s+(Number(e.net)||0),0), totalPnl: evs.reduce((s,e)=> s+(Number(e.net)||0),0) };
      populateTradesModal(state); openModalEl(tradesModalEl); try{ ensureFloatingModal(tradesModalEl, 'trades', { left: 540, top: 40, width: 720, height: 360, zIndex: bumpZ() }); }catch(_){ }
    }catch(_){ }
    }
    function heatClick(can, dir){ if(!can) return; can.addEventListener('click', (ev)=>{ try{ const cfg=can.__heatCfg; if(!cfg) return; const rect=can.getBoundingClientRect(); const x=ev.clientX-rect.left, y=ev.clientY-rect.top; const c=Math.floor((x-cfg.padL)/cfg.cw), r=Math.floor((y-cfg.padT)/cfg.ch); if(c<0||c>=cfg.cols||r<0||r>=cfg.rows) return; filterTradesByDOWHour(dir, r, c); }catch(_){ } }); }
    heatClick(canDOWHourLong, 'long'); heatClick(canDOWHourShort, 'short');
  }catch(_){ }
 }catch(_){ if(detailCtxEl){ detailCtxEl.textContent = 'Erreur analyse'; } } }

// Lab actions: refresh/export/weights
const labExportBtn=document.getElementById('labExport'); const labWeightsBtn=document.getElementById('labWeights'); const labRunNewBtn=document.getElementById('labRunNew');
const weightsModalEl=document.getElementById('weightsModal'); const weightsClose=document.getElementById('weightsClose'); const weightsSave=document.getElementById('weightsSave'); const weightsProfile=document.getElementById('weightsProfile'); const weightsBody=document.getElementById('weightsBody');
if(labTFSelect){ labTFSelect.addEventListener('change', async ()=>{ try{ localStorage.setItem('lab:tf', labTFSelect.value); await renderLabFromStorage(); await computeLabBenchmarkAndUpdate(); }catch(_){ } }); }
if(labSymbolSelect){ labSymbolSelect.addEventListener('change', async ()=>{ try{ localStorage.setItem('lab:sym', labSymbolSelect.value); await renderLabFromStorage(); await computeLabBenchmarkAndUpdate(); }catch(_){ } }); }
// Lab range controls: mode + date inputs trigger KPI recompute
try{
  const labRangeModeEl=document.getElementById('labRangeMode');
  const labFromEl=document.getElementById('labFrom');
  const labToEl=document.getElementById('labTo');
  if(labRangeModeEl){ labRangeModeEl.addEventListener('change', ()=>{ try{ computeLabBenchmarkAndUpdate(); }catch(_){ } }); }
  function wireDate(el){ if(!el) return; const h=()=>{ try{ computeLabBenchmarkAndUpdate(); }catch(_){ } }; el.addEventListener('change', h); el.addEventListener('input', h); }
  wireDate(labFromEl); wireDate(labToEl);
}catch(_){ }
if(labRunNewBtn){ labRunNewBtn.addEventListener('click', ()=>{ try{ window.__labGoalOverride='new'; if(labRunBtn){ labRunBtn.click(); } }catch(_){ } }); }
if(labExportBtn){ labExportBtn.addEventListener('click', ()=>{ try{ const tf=(labTFSelect&&labTFSelect.value)||(intervalSelect&&intervalSelect.value)||''; const sym=(labSymbolSelect&&labSymbolSelect.value)||currentSymbol; const arr=Array.isArray(window.labPalmaresCache)? window.labPalmaresCache : []; if(!arr.length){ setStatus('Rien à exporter'); return; }
  const DL=';';
  function esc(v){ let s=(v==null?'':String(v)); if(s.includes('"')) s=s.replace(/"/g,'""'); if(s.includes(DL)||s.includes('\n')) s='"'+s+'"'; return s; }
  function tpColsHdr(){ const cols=[]; for(let i=1;i<=10;i++){ cols.push(`TP${i}_type`,`TP${i}_val`,`TP${i}_qty`,`TP${i}_beOn`,`TP${i}_trail_mode`,`TP${i}_trail_emaLen`,`TP${i}_trail_pct`,`TP${i}_SL_type`,`TP${i}_SL_val`,`TP${i}_SL_trail_mode`,`TP${i}_SL_trail_emaLen`,`TP${i}_SL_trail_pct`); } return cols; }
  function slColsHdr(){ const cols=[]; for(let i=1;i<=10;i++){ cols.push(`SL${i}_type`,`SL${i}_val`,`SL${i}_trail_mode`,`SL${i}_trail_emaLen`,`SL${i}_trail_pct`); } return cols; }
  const baseHdr=['idx','name','gen','score','pf','totalPnl','eqFinal','trades','winrate','avgRR','maxDDAbs','nol','prd','slInitPct','beAfterBars','beLockPct','emaLen','entryMode','useFibRet','confirmMode','ent382','ent500','ent618','ent786','tpCompound','tpCloseAllLast','tp1R'];
  const header=baseHdr.concat(tpColsHdr()).concat(['slEnable']).concat(slColsHdr());
  let lines=['\uFEFF'+header.join(DL)];
  let idx=1; const weights=getWeights(localStorage.getItem('labWeightsProfile')||'balancee');
  for(const r of arr){ const p=r.params||{}; const st=r.res||{}; const score = Number.isFinite(r.score)? r.score : scoreResult(st, weights); const row=[idx, r.name||'', r.gen||1, (Number.isFinite(score)? score.toFixed(2):''), (st.profitFactor===Infinity?'Infinity':(st.profitFactor??'')), (st.totalPnl??''), (st.equityFinal??''), (st.tradesCount??''), (st.winrate??''), (st.avgRR??''), (st.maxDDAbs??''), (p.nol??''),(p.prd??''),(p.slInitPct??''),(p.beAfterBars??''),(p.beLockPct??''),(p.emaLen??''),(p.entryMode??''),(p.useFibRet??''),(p.confirmMode??''),(p.ent382??''),(p.ent500??''),(p.ent618??''),(p.ent786??''),(p.tpCompound??''),(p.tpCloseAllLast??''),(p.tp1R??'')]; const tp=Array.isArray(p.tp)? p.tp.slice(0,10):[]; for(let i=0;i<10;i++){ const t=tp[i]||{}; const typ=t.type||''; const val=(typ==='Fib')? (t.fib??t.value??'') : (typ==='Percent'? (t.pct??t.value??'') : (typ==='EMA'? (t.emaLen??'') : '')); const qty=(t.qty!=null)? t.qty:''; const beOn=t.beOn?1:''; const tr=t.trail||{}; const trMode=tr.mode||''; const trEL=tr.emaLen??''; const trPct=tr.pct??''; const sl=t.sl||{}; const slTyp=sl.type||''; const slVal=(slTyp==='Fib')? (sl.fib??sl.value??'') : (slTyp==='Percent'? (sl.pct??sl.value??'') : (slTyp==='EMA'? (sl.emaLen??'') : '')); const slTr=sl.trail||{}; const slTrMode=slTr.mode||''; const slTrEL=slTr.emaLen??''; const slTrPct=slTr.pct??''; row.push(typ,val,qty,beOn,trMode,trEL,trPct,slTyp,slVal,slTrMode,slTrEL,slTrPct); }
  row.push(p.slEnable??''); const sl=Array.isArray(p.sl)? p.sl.slice(0,10):[]; for(let i=0;i<10;i++){ const s=sl[i]||{}; const slTyp=s.type||''; const slVal=(slTyp==='Fib')? (s.fib??s.value??'') : (slTyp==='Percent'? (s.pct??s.value??'') : (slTyp==='EMA'? (s.emaLen??'') : '')); const slTr=s.trail||{}; const slTrMode=slTr.mode||''; const slTrEL=slTr.emaLen??''; const slTrPct=slTr.pct??''; row.push(slTyp, slVal, slTrMode, slTrEL, slTrPct); }
  lines.push(row.map(esc).join(DL)); idx++; }
  const csv=lines.join('\r\n'); const blob=new Blob([csv], {type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`palmares_${sym}_${tf}.csv`; a.click(); }catch(_){ } }); }
function buildWeightsUI(){ if(!weightsBody) return; const prof=(weightsProfile&&weightsProfile.value)||(localStorage.getItem('labWeightsProfile')||'balancee'); const w=getWeights(prof); weightsBody.innerHTML = `
  <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
    <label>Profit Factor <input id="w_pf" type="number" min="0" max="100" step="1" value="${w.pf}" /></label>
    <label>Win % <input id="w_wr" type="number" min="0" max="100" step="1" value="${w.wr}" /></label>
    <label>Avg RR <input id="w_rr" type="number" min="0" max="100" step="1" value="${w.rr}" /></label>
    <label>P&L <input id="w_pnl" type="number" min="0" max="100" step="1" value="${w.pnl}" /></label>
    <label>Cap. final <input id="w_eq" type="number" min="0" max="100" step="1" value="${w.eq}" /></label>
    <label>Trades <input id="w_trades" type="number" min="0" max="100" step="1" value="${w.trades}" /></label>
    <label>Max DD (inverse) <input id="w_dd" type="number" min="0" max="100" step="1" value="${w.dd}" /></label>
  </div>`; }
function readWeightsFromUI(){ const w={ pf:+(document.getElementById('w_pf')?.value||defaultWeights.pf), wr:+(document.getElementById('w_wr')?.value||defaultWeights.wr), rr:+(document.getElementById('w_rr')?.value||defaultWeights.rr), pnl:+(document.getElementById('w_pnl')?.value||defaultWeights.pnl), eq:+(document.getElementById('w_eq')?.value||defaultWeights.eq), trades:+(document.getElementById('w_trades')?.value||defaultWeights.trades), dd:+(document.getElementById('w_dd')?.value||defaultWeights.dd)}; return w; }
if(labWeightsBtn){ labWeightsBtn.addEventListener('click', ()=>{ try{ const prof = localStorage.getItem('labWeightsProfile')||'balancee'; if(weightsProfile){ weightsProfile.value=prof; } buildWeightsUI(); openModalEl(weightsModalEl); }catch(_){ } }); }
if(weightsProfile){ weightsProfile.addEventListener('change', ()=>{ try{ buildWeightsUI(); }catch(_){ } }); }
if(weightsClose){ weightsClose.addEventListener('click', ()=> closeModalEl(weightsModalEl)); }
if(weightsSave){ weightsSave.addEventListener('click', ()=>{ try{ const prof = (weightsProfile&&weightsProfile.value)||'balancee'; const w = readWeightsFromUI(); saveWeights(prof, w); localStorage.setItem('labWeightsProfile', prof); closeModalEl(weightsModalEl); setStatus('Pondérations enregistrées'); try{ renderLabFromStorage(); computeLabBenchmarkAndUpdate(); }catch(_){ } }catch(_){ } }); }

// Lab — Entraîner
const labRunBtn=document.getElementById('labRun');
if(labRunBtn){ labRunBtn.addEventListener('click', async ()=>{ try{
  const profSel = (document.getElementById('labProfile') && document.getElementById('labProfile').value) || (localStorage.getItem('labWeightsProfile')||'balancee');
  try{ localStorage.setItem('labWeightsProfile', profSel); }catch(_){ }
  const sym=(labSymbolSelect&&labSymbolSelect.value)||currentSymbol;
  const tfSel=(labTFSelect&&labTFSelect.value)||currentInterval;
  const goal = (window.__labGoalOverride || ((document.getElementById('labGoal')&&document.getElementById('labGoal').value) || 'improve'));
  try{ window.__labGoalOverride = null; }catch(_){ }
  const strategy=(document.getElementById('labStrategy')&&document.getElementById('labStrategy').value)||'hybrid';
const conf={ startCap: Math.max(0, parseFloat((document.getElementById('labStartCap')&&document.getElementById('labStartCap').value)||'10000')), fee: Math.max(0, parseFloat((document.getElementById('labFee')&&document.getElementById('labFee').value)||'0.1')), lev: Math.max(1, parseFloat((document.getElementById('labLev')&&document.getElementById('labLev').value)||'1')), maxPct:100, base:'initial' };
// Show progress popup on top immediately (robust)
  try{
    if(typeof openBtProgress==='function'){ openBtProgress('Préparation...'); }
    if(btProgressEl){ openModalEl(btProgressEl); }
    if(btProgText) btProgText.textContent='Préparation...';
    if(btProgBar) btProgBar.style.width='0%';
    const pe=document.getElementById('btProgress'); if(pe){ pe.style.zIndex=String(bumpModalZ()); const pc=pe.querySelector('.modal-content'); if(pc){ pc.style.zIndex=String(bumpModalZ()); } }
  }catch(_){ }
  try{ if(btProgText) btProgText.textContent='Entraînement...'; if(btProgNote) btProgNote.textContent=''; }catch(_){ }
  try{ const tl=(timeLimitSec>0? `${timeLimitSec}s`:'∞'); const mq=(maxEvals>0? `${maxEvals}`:'∞'); addBtLog(`Limites: temps ${tl}, max évals ${mq}`); }catch(_){ }
  let bars=candles; if(tfSel!==currentInterval){ try{ bars=await fetchAllKlines(sym, tfSel, 5000); try{ addBtLog(`Chargement des données: ${sym} @ ${tfSel} — ${bars.length} bougies`); }catch(_){ } }catch(_){ bars=candles; try{ addBtLog('Échec du chargement — utilisation des bougies visibles'); }catch(__){} } } else { try{ addBtLog(`Données visibles: ${bars.length} bougies`); }catch(_){ } }
  let from=null,to=null; const rangeMode=(document.getElementById('labRangeMode')&&document.getElementById('labRangeMode').value)||'visible';
  if(rangeMode==='dates'){ const f=(document.getElementById('labFrom')&&document.getElementById('labFrom').value)||''; const t=(document.getElementById('labTo')&&document.getElementById('labTo').value)||''; from = f? Math.floor(new Date(f).getTime()/1000): null; to = t? Math.floor(new Date(t).getTime()/1000): null; }
  else if(rangeMode==='visible'){ const r=getVisibleRange(); if(r){ from=r.from; to=r.to; } }
  else { from=null; to=null; }
  const idxFromTimeLocal=(bars,from,to)=>{ let s=0,e=bars.length-1; if(from!=null){ for(let i=0;i<bars.length;i++){ if(bars[i].time>=from){ s=i; break; } } } if(to!=null){ for(let j=bars.length-1;j>=0;j--){ if(bars[j].time<=to){ e=j; break; } } } return [s,e]; };
  const [sIdx,eIdx]=idxFromTimeLocal(bars,from,to);
  try{ const span = (from!=null||to!=null)? `${new Date((from||bars[sIdx]?.time||0)*1000).toLocaleString()} → ${new Date((to||bars[eIdx]?.time||0)*1000).toLocaleString()}` : `${new Date((bars[sIdx]?.time||0)*1000).toLocaleString()} → ${new Date((bars[eIdx]?.time||0)*1000).toLocaleString()}`; addBtLog(`Période: idx ${sIdx}-${eIdx} (${Math.max(0,eIdx-sIdx+1)} barres) • ${span}`); }catch(_){ }
const weights=getWeights(profSel);
  const allTested=[]; // accumulate every evaluated strategy for Supabase persistence
  // Global simulation progress (for ETA)
  let __labSimTotal=0, __labSimDone=0, __labSimDtSum=0, __labSimDtCnt=0, __labConc=1;
  function __fmtETA(ms){ if(!(ms>0)) return '—'; const s=Math.round(ms/1000); const m=Math.floor(s/60); const ss=String(s%60).padStart(2,'0'); const mm=String(m%60).padStart(2,'0'); const hh=Math.floor(m/60); return (hh>0? (String(hh).padStart(2,'0')+':'):'')+mm+':'+ss; }
function updateGlobalProgressUI(){ try{ let tot=Math.max(0,__labSimTotal), dn=Math.max(0,__labSimDone); if(maxEvals>0){ tot = Math.min(tot, maxEvals); dn = Math.min(dn, maxEvals); } const pct=tot? Math.round(dn/tot*100) : 0; if(btProgGlobalBar) btProgGlobalBar.style.width=pct+'%'; let eta='—'; if(tot>0){ let avg=null; try{ const fallback=Number(localStorage.getItem('lab:avgEvalMs')); avg = (Number.isFinite(fallback)&&fallback>0)? fallback : null; }catch(_){ avg=null; } if(__labSimDtCnt>0){ avg = __labSimDtSum/Math.max(1,__labSimDtCnt); } if(!(avg>0)) avg = 1000; const effConc=Math.max(1,__labConc|0); const remain=Math.max(0, tot-dn); eta=__fmtETA((remain*avg)/effConc); } const quotaStr = (maxEvals>0? ` • Quota: ${dn}/${maxEvals}` : ''); if(btProgGlobalText) btProgGlobalText.textContent = `Global: ${pct}% (${dn}/${tot}) — ETA ${eta}${quotaStr}`; }catch(_){ } }
  __lastLabTested = allTested;
  // Preload known keys from Supabase to avoid retest across sessions
  let seenCanon = new Set();
  try{ if(window.SUPA && typeof SUPA.fetchKnownKeys==='function'){ const profSel=(document.getElementById('labProfile') && document.getElementById('labProfile').value) || (localStorage.getItem('labWeightsProfile')||'balancee'); seenCanon = await SUPA.fetchKnownKeys(sym, tfSel, profSel) || new Set(); addBtLog && addBtLog(`Déduplication (${profSel}): ${seenCanon.size} stratégies déjà en base`); } }catch(_){ }
  // Stopping conditions
  const timeLimitSec = Math.max(0, parseInt((document.getElementById('labTimeLimitSec')&&document.getElementById('labTimeLimitSec').value)||'0',10));
  const maxEvals = Math.max(0, parseInt((document.getElementById('labMaxEvals')&&document.getElementById('labMaxEvals').value)||'0',10));
  const minScoreGoal = Math.max(0, parseFloat((document.getElementById('labMinScore')&&document.getElementById('labMinScore').value)||'0'));
  const deadline = timeLimitSec>0 ? (Date.now() + timeLimitSec*1000) : null;
  function timeUp(){ return deadline!=null && Date.now()>=deadline; }
  let bestGlobal = -Infinity;
  function goalReached(){ return minScoreGoal>0 && bestGlobal>=minScoreGoal; }
  function quotaReached(){ return maxEvals>0 && __labSimDone>=maxEvals; }
  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  let rNol=[2,3,4,5]; let rPrd=[]; for(let v=8; v<=34; v+=2){ rPrd.push(v); }
  let rSL=[0.5,1,1.5,2,2.5,3]; let rBEb=[3,4,5,6,7,8]; let rBEL=[3,4,5,6,7,8,9,10];
  let rEMALen=[]; for(let v=21; v<=89; v+=4){ rEMALen.push(v); }
  if(isLabAdvMode()){
    const get=(id,def)=>{ const el=document.getElementById(id); const x=parseFloat(el?.value||''); return Number.isFinite(x)? x : def; };
    const makeRange=(min,max,step,prec=6)=>{ const out=[]; const s=Math.max(+(step||1),1e-9); for(let v=+min; v<=+max+1e-9; v+=s){ out.push(+v.toFixed(prec)); } return out; };
    const vars = readLabVarToggles();
    if(vars.varNol) rNol = makeRange(get('labNolMin',2),get('labNolMax',5),get('labNolStep',1),0).map(x=>x|0);
    if(vars.varPrd) rPrd = makeRange(get('labPrdMin',8),get('labPrdMax',34),get('labPrdStep',2),0).map(x=>x|0);
    if(vars.varSLInit) rSL = makeRange(get('labSLInitMin',0.5),get('labSLInitMax',3.0),get('labSLInitStep',0.5),3);
    if(vars.varBEBars) rBEb = makeRange(get('labBEBarsMin',3),get('labBEBarsMax',8),get('labBEBarsStep',1),0).map(x=>x|0);
    if(vars.varBELock) rBEL = makeRange(get('labBELockMin',3),get('labBELockMax',10),get('labBELockStep',1),3);
    if(vars.varEMALen) rEMALen = makeRange(get('labEMALenMin',21),get('labEMALenMax',89),get('labEMALenStep',4),0).map(x=>x|0);
  }
  const keyOf=(p)=> JSON.stringify([p.nol,p.prd,p.slInitPct,p.beAfterBars,p.beLockPct,p.emaLen,p.entryMode,p.useFibRet,p.confirmMode,p.ent382,p.ent500,p.ent618,p.ent786,Array.isArray(p.tp)? p.tp.slice(0,10):[], Array.isArray(p.sl)? p.sl.slice(0,10):[]]);
const canonKey=(p)=>{ try{
      const tp = Array.isArray(p.tp) ? p.tp.slice(0,10) : [];
      const tp_types = new Array(10).fill('Fib');
      const tp_r = new Array(10).fill(0.0);
      const tp_p = new Array(10).fill(0.0);
      const tp_be = new Array(10).fill(0);
      const tp_trail_m = new Array(10).fill(0); // 0 none,1 be,2 prev,3 ema,4 percent
      const tp_trail_v = new Array(10).fill(0); // emaLen or pct
      const tp_sl_type = new Array(10).fill(0); // 0 Fib,1 Percent,2 EMA
      const tp_sl_r = new Array(10).fill(0);
      const tp_sl_trail_m = new Array(10).fill(0); // 0 none,1 ema,2 percent
      const tp_sl_trail_v = new Array(10).fill(0);
      let sumW = 0;
      for(let i=0;i<tp.length && i<10;i++){
        const t = tp[i] || {};
        const typ = String(t.type || 'Fib');
        if(typ === 'Percent'){
          tp_types[i] = 'Percent';
          tp_r[i] = Number(t.pct != null ? t.pct : t.value) || 0;
        } else if(typ === 'EMA'){
          tp_types[i] = 'EMA';
          tp_r[i] = 0;
        } else {
          tp_types[i] = 'Fib';
          tp_r[i] = Number(t.fib != null ? t.fib : t.value) || 0;
        }
        let w = t.qty; if(w != null) w = (w > 1 ? Number(w) : Number(w) * 100); tp_p[i] = Number.isFinite(w) ? Math.max(0, w) : 0; sumW += tp_p[i];
        // be
        tp_be[i] = t.beOn? 1:0;
        // trail per TP
        const tr = t.trail || null; if(tr){ tp_trail_m[i] = (tr.mode==='be')?1 : (tr.mode==='prev')?2 : (tr.mode==='ema')?3 : (tr.mode==='percent')?4 : 0; tp_trail_v[i] = (tr.mode==='ema')? (parseInt(tr.emaLen)||0) : (tr.mode==='percent'? (+tr.pct||0): 0); }
        // attached SL + trail
        const s = t.sl || null; if(s){ const st = String(s.type||'Percent'); tp_sl_type[i] = (st==='Fib')?0 : (st==='Percent')?1 : 2; tp_sl_r[i] = (st==='Fib')? (+s.fib||0) : (st==='Percent'? (+s.pct||0): 0); const str = s.trail||null; if(str){ tp_sl_trail_m[i] = (str.mode==='ema')?1 : (str.mode==='percent')?2 : 0; tp_sl_trail_v[i] = (str.mode==='ema')? (parseInt(str.emaLen)||0) : (str.mode==='percent'? (+str.pct||0): 0); } }
      }
      if(sumW > 0){ for(let i=0;i<10;i++) tp_p[i] = +(tp_p[i] / sumW * 100).toFixed(6); }
      const obj = {
        nol: p.nol|0,
        prd: p.prd|0,
        sl_init_pct: +p.slInitPct,
        be_after_bars: p.beAfterBars|0,
        be_lock_pct: +p.beLockPct,
        ema_len: p.emaLen|0,
        entry_mode: String(p.entryMode||'Both').replace('Fib Retracement','Fib'),
        use_fib_ret: !!p.useFibRet,
        confirm_mode: String(p.confirmMode||'Bounce'),
        tp_compound: !!p.tpCompound,
        tp_close_all_last: !!p.tpCloseAllLast,
        tp_types, tp_r, tp_p, tp_be, tp_trail_m, tp_trail_v, tp_sl_type, tp_sl_r, tp_sl_trail_m, tp_sl_trail_v,
      };
      return JSON.stringify(obj, Object.keys(obj).sort());
    }catch(_){ return ''; } };

  function readTPOpt(){
    try{
      const en = !!document.getElementById('labTPOptEn')?.checked;
      const count = Math.max(1, Math.min(10, parseInt(document.getElementById('labTPCount')?.value||'10',10)));
      const allowFib = !!document.getElementById('labTPAllowFib')?.checked;
      const allowPct = !!document.getElementById('labTPAllowPct')?.checked;
      const allowEMA = !!document.getElementById('labTPAllowEMA')?.checked;
      const pctMin = parseFloat(document.getElementById('labTPPctMin')?.value||'0.5');
      const pctMax = parseFloat(document.getElementById('labTPPctMax')?.value||'5');
      const fibs = (function(){ try{ const w=document.getElementById('labTPFibWrap'); if(!w) return null; const cs=w.querySelectorAll('input[type="checkbox"][data-r]'); const arr=[]; cs.forEach(cb=>{ if(cb.checked){ const v=parseFloat(cb.getAttribute('data-r')||''); if(isFinite(v)) arr.push(v); } }); return arr.length? arr : null; }catch(_){ return null; } })() || [0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.382,1.414,1.618,2.0,2.236,2.618,3.0];
      return { en, count, allowFib, allowPct, allowEMA, pctMin, pctMax, fibs };
    }catch(_){
      return { en:true, count:10, allowFib:true, allowPct:true, allowEMA:true, pctMin:0.5, pctMax:5, fibs:[0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.382,1.414,1.618,2.0,2.236,2.618,3.0] };
    }
  }
  function randWeights(n){ const arr=new Array(n).fill(0).map(()=> Math.random()+0.05); const s=arr.reduce((a,b)=>a+b,0); return arr.map(x=> x/s); }
// Lab advanced toggles helpers
function isLabAdvMode(){ try{ return (document.getElementById('labConfigMode')?.value||'simple') === 'avancee'; }catch(_){ return false; } }
function readLabVarToggles(){
  // Default: core + ladders vary in Simple; entries remain fixed unless Avancée + enabled
  try{
    if(!isLabAdvMode()){
      return { varNol:true, varPrd:true, varSLInit:true, varBEBars:true, varBELock:true, varEMALen:true, varTP:true, varSL:true, varEntries:false };
    }
    const g=(id)=> !!document.getElementById(id)?.checked;
    return {
      varNol: g('labVarNol'),
      varPrd: g('labVarPrd'),
      varSLInit: g('labVarSLInit'),
      varBEBars: g('labVarBEBars'),
      varBELock: g('labVarBELock'),
      varEMALen: g('labVarEMALen'),
      varTP: g('labVarTP'),
      varSL: g('labVarSL'),
      varEntries: g('labVarEntries'),
    };
  }catch(_){
    return { varNol:true, varPrd:true, varSLInit:true, varBEBars:true, varBELock:true, varEMALen:true, varTP:true, varSL:true, varEntries:false };
  }
}
function updateLabAdvVisibility(){
  try{
    const showAdv = isLabAdvMode();
    const advPanel = document.getElementById('labAdvPanel'); if(advPanel) advPanel.style.display = showAdv? 'flex':'none';
    const varTP = !!document.getElementById('labVarTP')?.checked;
    const varSL = !!document.getElementById('labVarSL')?.checked;
    const tpBlock = document.getElementById('labTPOptBlock'); if(tpBlock) tpBlock.style.display = (showAdv && varTP)? 'flex':'none';
    const slBlock = document.getElementById('labSLOptBlock'); if(slBlock) slBlock.style.display = (showAdv && varSL)? 'flex':'none';
    const tpAllowFib = !!document.getElementById('labTPAllowFib')?.checked;
    const slAllowFib = !!document.getElementById('labSLAllowFib')?.checked;
    const tpFibWrap = document.getElementById('labTPFibWrap'); if(tpFibWrap) tpFibWrap.style.display = (showAdv && varTP && tpAllowFib)? 'flex':'none';
    const slFibWrap = document.getElementById('labSLFibWrap'); if(slFibWrap) slFibWrap.style.display = (showAdv && varSL && slAllowFib)? 'flex':'none';
    const coreAny = ['labVarNol','labVarPrd','labVarSLInit','labVarBEBars','labVarBELock','labVarEMALen'].some(id=> !!document.getElementById(id)?.checked);
    const coreRanges = document.getElementById('labCoreRanges'); if(coreRanges) coreRanges.style.display = (showAdv && coreAny)? 'flex':'none';
    // Show the optional 'Entrées' toggle in advanced mode
    const varEntInput = document.getElementById('labVarEntries');
    const varEntLabel = varEntInput && varEntInput.closest ? varEntInput.closest('label') : null;
    if(varEntLabel){ varEntLabel.style.display = showAdv? '': 'none'; }
  }catch(_){ }
}
function setupLabAdvUI(){
  try{ updateLabAdvVisibility(); }catch(_){ }
  const ids=['labConfigMode','labVarNol','labVarPrd','labVarSLInit','labVarBEBars','labVarBELock','labVarEMALen','labVarTP','labVarSL','labTPAllowFib','labSLAllowFib'];
  for(const id of ids){ const el=document.getElementById(id); if(el && (!el.dataset || el.dataset.wiredAdv!=='1')){ try{ el.addEventListener('change', ()=>{ try{ updateLabAdvVisibility(); }catch(_){ } }); }catch(_){ } if(!el.dataset) el.dataset={}; el.dataset.wiredAdv='1'; } }
}
function sampleTPList(tpCfg){
  const { allowFib, allowPct, allowEMA, pctMin, pctMax, fibs } = tpCfg || {};
  const n = Math.max(1, Math.min(10, Number(tpCfg && tpCfg.count) || 10));
  const types=[]; if(allowFib) types.push('Fib'); if(allowPct) types.push('Percent'); if(allowEMA) types.push('EMA'); if(!types.length) types.push('Fib');
  const ws=randWeights(n);
  const list=[];
  // ranges for trailing percent (fallback if no UI): 0.1% .. 100%
  const trailPctMin = 0.1, trailPctMax = 100.0;
  const slCfgLocal = readSLOpt();
  function sampleAttachedSL(){
    const tps=[]; const ty=[]; const allowSTypes=[]; if(slCfgLocal.allowFib) allowSTypes.push('Fib'); if(slCfgLocal.allowPct) allowSTypes.push('Percent'); if(slCfgLocal.allowEMA) allowSTypes.push('EMA'); if(!allowSTypes.length) allowSTypes.push('Percent');
    const st=allowSTypes[(Math.random()*allowSTypes.length)|0];
    if(st==='Fib'){
      const r=slCfgLocal.fibs[(Math.random()*slCfgLocal.fibs.length)|0];
      return { type:'Fib', fib:r, value:r };
    } else if(st==='Percent'){
      const p = slCfgLocal.pctMin + Math.random()*(Math.max(0,slCfgLocal.pctMax-slCfgLocal.pctMin));
      return { type:'Percent', pct:+p.toFixed(3), value:+p.toFixed(3) };
    } else {
      const len = rEMALen[(Math.random()*rEMALen.length)|0];
      return { type:'EMA', emaLen: len };
    }
  }
  function sampleTrailTP(){
    const modes=['none','be','prev','ema','percent'];
    const m = modes[(Math.random()*modes.length)|0];
    if(m==='none') return null;
    if(m==='ema') return { mode:'ema', emaLen: rEMALen[(Math.random()*rEMALen.length)|0] };
    if(m==='percent'){ const p = trailPctMin + Math.random()*(trailPctMax-trailPctMin); return { mode:'percent', pct:+p.toFixed(3) }; }
    return { mode:m };
  }
  function sampleTrailSL(){
    const modes=['none','ema','percent'];
    const m = modes[(Math.random()*modes.length)|0];
    if(m==='none') return null;
    if(m==='ema') return { mode:'ema', emaLen: rEMALen[(Math.random()*rEMALen.length)|0] };
    if(m==='percent'){ const p = 0.1 + Math.random()*(100.0-0.1); return { mode:'percent', pct:+p.toFixed(3) }; }
    return null;
  }
  for(let i=0;i<n;i++){
    const t=types[(Math.random()*types.length)|0];
    let entry=null;
    if(t==='Fib'){
      const r=fibs[(Math.random()*fibs.length)|0];
      entry={ type:'Fib', fib:r, value:r, qty: ws[i] };
    } else if(t==='Percent'){
      const p = pctMin + Math.random()*(Math.max(0,pctMax-pctMin));
      entry={ type:'Percent', pct:+p.toFixed(3), value:+p.toFixed(3), qty: ws[i] };
    } else {
      const len = rEMALen[(Math.random()*rEMALen.length)|0];
      entry={ type:'EMA', emaLen: len, qty: ws[i] };
    }
    // beOn
    entry.beOn = Math.random() < 0.4;
    // per‑TP trail
    const tr = sampleTrailTP(); if(tr) entry.trail = tr;
    // attached SL + its trail
    const atSL = sampleAttachedSL(); if(atSL){ entry.sl = atSL; const st=sampleTrailSL(); if(st){ entry.sl.trail = st; } }
    list.push(entry);
  }
  return list;
}
function mutateTP(list,tpCfg){ if(!Array.isArray(list)||!list.length) return list; const out=list.map(x=> ({...x})); const i=(Math.random()*out.length)|0; const t=out[i]; const r=Math.random(); if(t.type==='Fib' && (r<0.5)){ const fibs=tpCfg.fibs; out[i].fib = fibs[(Math.random()*fibs.length)|0]; out[i].value=out[i].fib; } else if(t.type==='Percent' && (r<0.5)){ const p = tpCfg.pctMin + Math.random()*(Math.max(0,tpCfg.pctMax-tpCfg.pctMin)); out[i].pct=+p.toFixed(3); out[i].value=out[i].pct; } else if(t.type==='EMA' && (r<0.5)){ out[i].emaLen = rEMALen[(Math.random()*rEMALen.length)|0]; } else { // change type
    const types=[]; if(tpCfg.allowFib) types.push('Fib'); if(tpCfg.allowPct) types.push('Percent'); if(tpCfg.allowEMA) types.push('EMA'); if(types.length){ const nt=types[(Math.random()*types.length)|0]; const baseQty = t.qty||null; if(nt==='Fib'){ const fibs=tpCfg.fibs; out[i]={ type:'Fib', fib:fibs[(Math.random()*fibs.length)|0], qty: baseQty }; } else if(nt==='Percent'){ const p=tpCfg.pctMin + Math.random()*(Math.max(0,tpCfg.pctMax-tpCfg.pctMin)); out[i]={ type:'Percent', pct:+p.toFixed(3), qty: baseQty }; } else { out[i]={ type:'EMA', emaLen: rEMALen[(Math.random()*rEMALen.length)|0], qty: baseQty }; } }
  }
  // mutate beOn
  if(Math.random()<0.2){ out[i].beOn = !out[i].beOn; }
  // mutate per‑TP trail
  if(Math.random()<0.3){ const modes=['none','be','prev','ema','percent']; const m=modes[(Math.random()*modes.length)|0]; if(m==='none'){ delete out[i].trail; } else if(m==='ema'){ out[i].trail={ mode:'ema', emaLen: rEMALen[(Math.random()*rEMALen.length)|0] }; } else if(m==='percent'){ const p = 0.1 + Math.random()*(100.0-0.1); out[i].trail={ mode:'percent', pct:+p.toFixed(3) }; } else { out[i].trail={ mode:m }; } }
  // mutate attached SL basic
  function mutAttachedSL(s){ const slCfg=readSLOpt(); const u={ ...(s||{}) }; const rr=Math.random(); if((u.type||'Percent')==='Fib' && rr<0.5){ const fibs=slCfg.fibs; u.fib = fibs[(Math.random()*fibs.length)|0]; u.value=u.fib; } else if((u.type||'Percent')==='Percent' && rr<0.5){ const p=slCfg.pctMin + Math.random()*(Math.max(0,slCfg.pctMax-slCfg.pctMin)); u.pct=+p.toFixed(3); u.value=u.pct; } else if((u.type||'Percent')==='EMA' && rr<0.5){ u.emaLen = rEMALen[(Math.random()*rEMALen.length)|0]; } else { const types=[]; if(slCfg.allowFib) types.push('Fib'); if(slCfg.allowPct) types.push('Percent'); if(slCfg.allowEMA) types.push('EMA'); if(types.length){ const nt=types[(Math.random()*types.length)|0]; if(nt==='Fib'){ const fibs=slCfg.fibs; return { type:'Fib', fib:fibs[(Math.random()*fibs.length)|0] }; } else if(nt==='Percent'){ const p=slCfg.pctMin + Math.random()*(Math.max(0,slCfg.pctMax-slCfg.pctMin)); return { type:'Percent', pct:+p.toFixed(3) }; } else { return { type:'EMA', emaLen: rEMALen[(Math.random()*rEMALen.length)|0] }; } } }
    return u; }
  if(Math.random()<0.3){ out[i].sl = mutAttachedSL(out[i].sl); }
  // mutate SL trail
  if(Math.random()<0.3){ const modes=['none','ema','percent']; const m=modes[(Math.random()*modes.length)|0]; if(!out[i].sl) out[i].sl={ type:'Percent', pct:1.0 }; if(m==='none'){ if(out[i].sl) delete out[i].sl.trail; } else if(m==='ema'){ out[i].sl.trail={ mode:'ema', emaLen: rEMALen[(Math.random()*rEMALen.length)|0] }; } else { const p=0.1 + Math.random()*(100.0-0.1); out[i].sl.trail={ mode:'percent', pct:+p.toFixed(3) }; } }
  // mutate weights slightly
  const ws=out.map(x=> x.qty||0); const j=(Math.random()*ws.length)|0; ws[j] = Math.max(0.01, ws[j] + (Math.random()*0.2-0.1)); const s=ws.reduce((a,b)=>a+b,0); for(let k=0;k<out.length;k++){ out[k].qty = ws[k]/s; }
  return out; }

  function readSLOpt(){
    try{
      const en = !!document.getElementById('labSLOptEn')?.checked;
      const allowFib = !!document.getElementById('labSLAllowFib')?.checked;
      const allowPct = !!document.getElementById('labSLAllowPct')?.checked;
      const allowEMA = !!document.getElementById('labSLAllowEMA')?.checked;
      const pctMin = parseFloat(document.getElementById('labSLPctMin')?.value||'0.5');
      const pctMax = parseFloat(document.getElementById('labSLPctMax')?.value||'5');
      const fibs = (function(){ try{ const w=document.getElementById('labSLFibWrap'); if(!w) return null; const cs=w.querySelectorAll('input[type="checkbox"][data-r]'); const arr=[]; cs.forEach(cb=>{ if(cb.checked){ const v=parseFloat(cb.getAttribute('data-r')||''); if(isFinite(v)) arr.push(v); } }); return arr.length? arr : null; }catch(_){ return null; } })() || [0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.382,1.414,1.618,2.0,2.236,2.618,3.0];
      const count = Math.max(1, Math.min(10, parseInt(document.getElementById('labSLCount')?.value||'1',10)));
      return { en, allowFib, allowPct, allowEMA, pctMin, pctMax, fibs, count };
    }catch(_){
      return { en:true, allowFib:true, allowPct:true, allowEMA:true, pctMin:0.5, pctMax:5.0, fibs:[0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.382,1.414,1.618,2.0,2.236,2.618,3.0], count:1 };
    }
  }
  function sampleSLList(slCfg){
    const { allowFib, allowPct, allowEMA, pctMin, pctMax, fibs } = slCfg || {};
    const n = Math.max(1, Math.min(10, Number(slCfg && slCfg.count) || 1));
    const types=[]; if(allowFib) types.push('Fib'); if(allowPct) types.push('Percent'); if(allowEMA) types.push('EMA'); if(!types.length) types.push('Percent');
    const list=[];
    for(let i=0;i<n;i++){
      const t=types[(Math.random()*types.length)|0];
      if(t==='Fib'){
        const r=fibs[(Math.random()*fibs.length)|0];
        list.push({ type:'Fib', fib:r, value:r });
      } else if(t==='Percent'){
        const p = pctMin + Math.random()*(Math.max(0,pctMax-pctMin));
        list.push({ type:'Percent', pct:+p.toFixed(3), value:+p.toFixed(3) });
      } else {
        const len = rEMALen[(Math.random()*rEMALen.length)|0];
        list.push({ type:'EMA', emaLen: len });
      }
    }
    return list;
  }
  function mutateSL(list, slCfg){
    const out = Array.isArray(list)? list.map(x=> ({...x})) : [];
    if(!out.length){ return sampleSLList(slCfg); }
    const i=(Math.random()*out.length)|0; const t=out[i]; const r=Math.random();
    if((t.type||'Percent')==='Fib' && r<0.5){ const fibs=slCfg.fibs; out[i].fib = fibs[(Math.random()*fibs.length)|0]; out[i].value=out[i].fib; }
    else if((t.type||'Percent')==='Percent' && r<0.5){ const p = slCfg.pctMin + Math.random()*(Math.max(0,slCfg.pctMax-slCfg.pctMin)); out[i].pct=+p.toFixed(3); out[i].value=out[i].pct; }
    else if((t.type||'Percent')==='EMA' && r<0.5){ out[i].emaLen = rEMALen[(Math.random()*rEMALen.length)|0]; }
    else {
      const types=[]; if(slCfg.allowFib) types.push('Fib'); if(slCfg.allowPct) types.push('Percent'); if(slCfg.allowEMA) types.push('EMA'); if(types.length){ const nt=types[(Math.random()*types.length)|0]; if(nt==='Fib'){ const fibs=slCfg.fibs; out[i]={ type:'Fib', fib:fibs[(Math.random()*fibs.length)|0] }; } else if(nt==='Percent'){ const p=slCfg.pctMin + Math.random()*(Math.max(0,slCfg.pctMax-slCfg.pctMin)); out[i]={ type:'Percent', pct:+p.toFixed(3) }; } else { out[i]={ type:'EMA', emaLen: rEMALen[(Math.random()*rEMALen.length)|0] }; } }
    }
    // occasionally add or remove a rung
    if(Math.random()<0.2 && out.length<10){ out.push(sampleSLList(slCfg)[0]); }
    if(Math.random()<0.2 && out.length>1){ out.splice((Math.random()*out.length)|0, 1); }
    return out;
  }
  function crossoverSL(a,b, slCfg){
    const n = 1 + ((Math.random()*10)|0);
    const res=[];
    for(let i=0;i<n;i++){
      const src = (Math.random()<0.5? a:b);
      const pick = src[i%Math.max(1, src.length||1)];
      if(pick){ res.push({...pick}); } else { res.push(sampleSLList(slCfg)[0]); }
    }
    return res;
  }
function crossoverTP(a,b,tpCfg){ const n=Math.max(1, tpCfg.count|0); const res=[]; for(let i=0;i<n;i++){ const as=a[i%Math.max(1,a.length||1)], bs=b[i%Math.max(1,b.length||1)]; const src=(Math.random()<0.5? as:bs); let t = src? {...src}: null; if(!t){ t = { type:'Fib', fib:(tpCfg.fibs[0]||0.382), qty: 1/n }; }
  // mix extras
  const other = (src===as? bs: as) || {};
  if(Math.random()<0.5) t.beOn = !!(other.beOn); // inherit from other sometimes
  if(Math.random()<0.5) t.trail = other.trail? {...other.trail} : t.trail;
  if(Math.random()<0.5){ t.sl = other.sl? {...other.sl} : t.sl; if(other.sl && other.sl.trail){ t.sl.trail = {...other.sl.trail}; } }
  res[i]=t; }
  const s=res.reduce((u,x)=> u+(x.qty||0),0)||1; for(const x of res){ x.qty = (x.qty||0)/s; } return res; }

function __sampleEntries(p){ try{ const modes=['Both','Original','Fib Retracement']; const cmodes=['Bounce','Touch']; const em = modes[(Math.random()*modes.length)|0]; let ufr = Math.random()<0.6; if(em==='Original') ufr=false; if(em==='Fib Retracement') ufr=true; const cf = cmodes[(Math.random()*cmodes.length)|0]; return { entryMode: em, useFibRet: ufr, confirmMode: cf, ent382: Math.random()<0.7, ent500: Math.random()<0.7, ent618: Math.random()<0.7, ent786: Math.random()<0.4 }; }catch(_){ return { entryMode:p.entryMode, useFibRet:p.useFibRet, confirmMode:p.confirmMode, ent382:p.ent382, ent500:p.ent500, ent618:p.ent618, ent786:p.ent786 }; } }
function randomParams(){ const vars=readLabVarToggles(); const tpCfg=readTPOpt(); const slCfg=readSLOpt(); const p={ nol: pick(rNol), prd: pick(rPrd), slInitPct: pick(rSL), beAfterBars: pick(rBEb), beLockPct: pick(rBEL), emaLen: pick(rEMALen), entryMode: lbcOpts.entryMode||'Both', useFibRet: !!lbcOpts.useFibRet, confirmMode: lbcOpts.confirmMode||'Bounce', ent382: !!lbcOpts.ent382, ent500: !!lbcOpts.ent500, ent618: !!lbcOpts.ent618, ent786: !!lbcOpts.ent786, tpEnable: true, tpCompound: (Math.random()<0.6), tpCloseAllLast: (Math.random()<0.7), tp: [], slEnable: true, sl: [] };
    if(!vars.varNol) p.nol = lbcOpts.nol|0;
    if(!vars.varPrd) p.prd = lbcOpts.prd|0;
    if(!vars.varSLInit) p.slInitPct = +lbcOpts.slInitPct;
    if(!vars.varBEBars) p.beAfterBars = lbcOpts.beAfterBars|0;
    if(!vars.varBELock) p.beLockPct = +lbcOpts.beLockPct;
    if(!vars.varEMALen) p.emaLen = lbcOpts.emaLen|0;
    if(vars.varEntries){ const e=__sampleEntries(p); Object.assign(p, e); }
    if(vars.varTP && tpCfg.en){ p.tp = sampleTPList(tpCfg).slice(0,10); p.tpEnable=true; } else { p.tp = Array.isArray(lbcOpts.tp)? lbcOpts.tp.slice(0,10):[]; p.tpEnable=!!p.tp.length; }
    if(vars.varSL && slCfg.en){ p.sl = sampleSLList(slCfg).slice(0,10); p.slEnable=true; } else { p.sl = Array.isArray(lbcOpts.sl)? lbcOpts.sl.slice(0,10):[]; p.slEnable=!!p.sl.length; }
    return p; }
  function neighbor(arr, v){ const i=arr.indexOf(v); const out=[]; if(i>0) out.push(arr[i-1]); out.push(v); if(i>=0 && i<arr.length-1) out.push(arr[i+1]); return pick(out.length?out:arr); }
function mutate(p, rate){ const vars=readLabVarToggles(); const tpCfg=readTPOpt(); const slCfg=readSLOpt(); const q={...p}; if(vars.varNol && Math.random()<rate) q.nol = neighbor(rNol, q.nol); if(vars.varPrd && Math.random()<rate) q.prd = neighbor(rPrd, q.prd); if(vars.varSLInit && Math.random()<rate) q.slInitPct = neighbor(rSL, q.slInitPct); if(vars.varBEBars && Math.random()<rate) q.beAfterBars = neighbor(rBEb, q.beAfterBars); if(vars.varBELock && Math.random()<rate) q.beLockPct = neighbor(rBEL, q.beLockPct); if(vars.varEMALen && Math.random()<rate) q.emaLen = neighbor(rEMALen, q.emaLen); if(vars.varEntries && Math.random()<rate){ const e=__sampleEntries(q); Object.assign(q, e); }
  if(vars.varTP && Math.random()<rate){ q.tp = mutateTP(Array.isArray(q.tp)? q.tp: [], tpCfg).slice(0,10); q.tpEnable=true; }
  if(vars.varSL && Math.random()<rate){ q.sl = mutateSL(Array.isArray(q.sl)? q.sl: [], slCfg).slice(0,10); q.slEnable=true; }
  if(Math.random()<rate){ q.tpCompound = !q.tpCompound; }
  if(Math.random()<rate){ q.tpCloseAllLast = !q.tpCloseAllLast; }
  return q; }
function crossover(a,b){ const tpCfg=readTPOpt(); const slCfg=readSLOpt(); return { nol: Math.random()<0.5?a.nol:b.nol, prd: Math.random()<0.5?a.prd:b.prd, slInitPct: Math.random()<0.5?a.slInitPct:b.slInitPct, beAfterBars: Math.random()<0.5?a.beAfterBars:b.beAfterBars, beLockPct: Math.random()<0.5?a.beLockPct:b.beLockPct, emaLen: Math.random()<0.5?a.emaLen:b.emaLen, entryMode: a.entryMode, useFibRet: a.useFibRet, confirmMode: a.confirmMode, ent382:a.ent382, ent500:a.ent500, ent618:a.ent618, ent786:a.ent786, tpEnable:true, tpCompound: (Math.random()<0.5? a.tpCompound : b.tpCompound), tpCloseAllLast: (Math.random()<0.5? a.tpCloseAllLast : b.tpCloseAllLast), tp: crossoverTP(a.tp||[], b.tp||[], tpCfg).slice(0,10), slEnable:true, sl: crossoverSL(a.sl||[], b.sl||[], slCfg).slice(0,10) }; }
async function evalParamsList(list, phase='Eval'){
    const out=[]; let idx=0; const N=list.length||0;
    function fmtTP(tp){ try{ if(!Array.isArray(tp)||!tp.length) return '—'; return tp.map(t=>{ const typ=(t.type||'Fib'); if(typ==='Fib'){ return `F:${t.fib}`; } if(typ==='Percent'){ return `P:${t.pct}%`; } if(typ==='EMA'){ return `E:${t.emaLen}`; } return typ; }).slice(0,10).join(';'); }catch(_){ return '—'; } }
    function fmtParams(p){ try{ return `nol=${p.nol} prd=${p.prd} sl=${p.slInitPct}% be=${p.beAfterBars}/${p.beLockPct}% ema=${p.emaLen} entry=${p.entryMode||'Both'} fibRet=${p.useFibRet?1:0} confirm=${p.confirmMode||'Bounce'} ent=[${p.ent382?'382':''}${p.ent500? (p.ent382?',500':'500'):''}${p.ent618? (p.ent382||p.ent500?',618':'618'):''}${p.ent786? ((p.ent382||p.ent500||p.ent618)?',786':'786'):''}] tp=${fmtTP(p.tp)}`; }catch(_){ return ''; } }

    // Worker pool for parallel evals
    const CONC = Math.max(1, Math.min( Math.floor((navigator && navigator.hardwareConcurrency) || 2), 6)); __labConc = CONC;
    function makePool(conc){
      const workers=[]; const idle=[]; let closed=false; let failed=false;
      function spawn(){
        let w=null;
        try{ w=new Worker('src/worker_eval.js'); }catch(e){ failed=true; return; }
        if(!w){ failed=true; return; }
        w._busy=false; w.onmessage=(ev)=>{ const d=ev.data||{}; if(w._state==='init'){
            if(d && d.ok){ w._state='idle'; idle.push(w); trySchedule(); }
            else { w._state='dead'; }
            return;
          }
          if(w._state==='eval'){
            const cb=w._cb; w._cb=null; w._busy=false; w._state='idle'; if(cb){ if(d && d.ok){ cb.resolve(d.res); } else { cb.reject(new Error(d && d.error || 'worker error')); } }
            idle.push(w); trySchedule(); return;
          }
        };
        w._state='init';
        w.postMessage({ type:'init', payload:{ bars, sIdx, eIdx, conf } });
        workers.push(w);
      }
      for(let i=0;i<conc;i++) spawn();
      if(failed || workers.length===0){ return null; }
      const queue=[];
      function trySchedule(){ if(closed) return; while(idle.length && queue.length){ const w=idle.shift(); const job=queue.shift(); if(!w) break; w._busy=true; w._state='eval'; w._cb=job.cb; try{ w.postMessage({ type:'eval', payload:{ params: job.params } }); }catch(e){ w._busy=false; w._state='idle'; job.cb.reject(e); idle.push(w); } } }
      return {
        eval(params){ if(closed) return Promise.reject(new Error('pool closed'));
          return new Promise((resolve,reject)=>{ queue.push({ params, cb:{resolve,reject} }); trySchedule(); }); },
        close(){ closed=true; while(workers.length){ try{ workers.pop().terminate(); }catch(_){} } }
      };
    }

    const fallbackPool = { eval: (params)=> Promise.resolve(runBacktestSliceFor(bars, sIdx, eIdx, conf, params)), close(){ } };
    let pool=null;
    try{ pool = makePool(CONC); }catch(_){ pool=null; }
    if(!pool){ try{ addBtLog(`[${phase}] mode séquentiel (fallback, workers indisponibles)`); }catch(_){ }
      pool = fallbackPool; __labConc=1; }
    let done=0;
    const tasks = list.map(async (item)=>{
      if(btAbort) return null;
      while(btPaused && !btAbort){ if(labRunStatusEl) labRunStatusEl.textContent='Pause'; await new Promise(r=> setTimeout(r, 150)); }
      if(btAbort) return null; if(quotaReached()) return null;
      const t0=performance.now();
      try{
const res = await pool.eval(item.p);
        const dt=performance.now()-t0; __labSimDone++; __labSimDtSum+=dt; __labSimDtCnt++;
        try{ const prev=Number(localStorage.getItem('lab:avgEvalMs')); const newAvg=(Number.isFinite(prev)&&prev>0)? (0.6*prev + 0.4*dt) : dt; localStorage.setItem('lab:avgEvalMs', String(Math.round(newAvg))); }catch(_){ }
        updateGlobalProgressUI();
// Robustified score: base + mini-MC jitter + optional halves; penalize variance
const __baseScore=scoreResult(res, weights);
function __mean(a){ return a.length? a.reduce((x,y)=>x+y,0)/a.length : 0; }
function __sd(a){ const m=__mean(a); return Math.sqrt(__mean(a.map(x=> (x-m)*(x-m)))); }
function __jitter(src, sigma){ const out=new Array(src.length); for(let i=0;i<src.length;i++){ const m=1+(Math.random()*2-1)*sigma; const b=src[i]; out[i]={ time:b.time, open:b.open*m, high:b.high*m, low:b.low*m, close:b.close*m }; } return out; }
const __scores=[__baseScore];
try{ const __rJ = runBacktestSliceFor(__jitter(bars, 0.0015), sIdx, eIdx, conf, item.p); __scores.push(scoreResult(__rJ, weights)); }catch(_){ }
try{ const __span=(eIdx - sIdx); if(__span>400){ const __mid = Math.floor((sIdx+eIdx)/2); const __r1=runBacktestSliceFor(bars, sIdx, __mid, conf, item.p); const __r2=runBacktestSliceFor(bars, __mid+1, eIdx, conf, item.p); __scores.push(scoreResult(__r1, weights)); __scores.push(scoreResult(__r2, weights)); } }catch(_){ }
const __m=__mean(__scores), __sdd=__sd(__scores);
const score = Math.max(0, __m - Math.min(5, __sdd*1.5));
        const rec={ p:item.p, res, score, owner:item.owner||null };
        out.push(rec);
        try{ allTested.push({ params: rec.p, metrics: rec.res, score: rec.score }); }catch(_){ }
        idx++; done++;
        try{ if(btProgNote) btProgNote.textContent = `${phase} • ${Math.round(dt)} ms`; }catch(_){ }
try{ const pfStr = (res.profitFactor===Infinity?'∞':(Number(res.profitFactor||0)).toFixed(2)); addBtLog(`[${phase}] ${done}/${N} ${fmtParams(item.p)} => score ${score.toFixed(2)} PF ${pfStr} trades ${res.tradesCount} win ${Number(res.winrate||0).toFixed(1)}% (${Math.round(dt)} ms)`); }catch(_){ }
      }catch(e){ try{ addBtLog(`[${phase}] error: ${e&&e.message?e.message:e}`); }catch(_){ } }
      if(btProgBar && btProgText){ const pct=Math.round(done/Math.max(1,N)*100); btProgBar.style.width=pct+'%'; btProgText.textContent=`${phase} ${pct}% (${done}/${N})`; }
      await new Promise(r=> setTimeout(r, 0));
      return null;
    });
    await Promise.all(tasks);
    try{ pool.close(); }catch(_){ }
    return out;
  }
  function updateProgress(text, pct){ if(btProgText) btProgText.textContent=text; if(btProgBar) btProgBar.style.width = Math.max(0,Math.min(100,Math.round(pct)))+'%'; }

  async function runEA(seed){ const pop = Math.max(4, parseInt((document.getElementById('labEAPop')&&document.getElementById('labEAPop').value)||'40',10));
    const gens = Math.max(1, parseInt((document.getElementById('labEAGen')&&document.getElementById('labEAGen').value)||'20',10));
    const mutPct = Math.max(0, Math.min(100, parseFloat((document.getElementById('labEAMut')&&document.getElementById('labEAMut').value)||'20')))/100;
    const cxPct = Math.max(0, Math.min(100, parseFloat((document.getElementById('labEACx')&&document.getElementById('labEACx').value)||'60')))/100;
    const seen=new Set(); const isDup=(p)=>{ const k=keyOf(p); if(seen.has(k)) return true; const ck=canonKey(p); if(seenCanon.has(ck)) return true; return false; }; const pushSeen=(p)=>{ seen.add(keyOf(p)); seenCanon.add(canonKey(p)); };
    let pool=[];
    // init population
    const init=[]; if(Array.isArray(seed)&&seed.length){ for(const s of seed){ if(isDup(s.p)) continue; pushSeen(s.p); init.push({ p:s.p, owner:s.owner||null }); if(init.length>=pop) break; } }
    while(init.length<pop){ const p=randomParams(); if(isDup(p)) continue; pushSeen(p); init.push({ p }); }
__labSimTotal += init.length; updateGlobalProgressUI();
try{ addBtLog && addBtLog(`EA:init — scheduling ${init.length} évals`); }catch(_){ }
    let cur = await evalParamsList(init, 'EA:init');
    cur.sort((a,b)=> b.score-a.score);
try{ const top=cur[0]; if(top){ addBtLog(`EA init — best score ${top.score.toFixed(2)} • PF ${(top.res.profitFactor===Infinity?'∞':(top.res.profitFactor||0).toFixed(2))} • Trades ${top.res.tradesCount} • Win ${(top.res.winrate||0).toFixed(1)}%`); } }catch(_){ }
    bestGlobal = Math.max(bestGlobal, (cur[0]?.score ?? -Infinity));
    if(timeUp() || goalReached() || quotaReached()) return cur;
    updateProgress(`EA g 1/${gens}`, 100*(1/(gens+1)));
for(let g=2; g<=gens+1 && !btAbort; g++){
      while(btPaused && !btAbort){ if(labRunStatusEl) labRunStatusEl.textContent='Pause'; await new Promise(r=> setTimeout(r, 200)); }
      if(timeUp() || goalReached() || quotaReached()) break;
      const elites = cur.slice(0, Math.max(2, Math.floor(pop*0.3)));
      // children
      const children=[];
      let guardCtr=0;
      while(children.length<pop && guardCtr<pop*4){
        guardCtr++;
        const hasElites = elites && elites.length>0;
        const a = hasElites? pick(elites) : null;
        const b = hasElites? pick(elites) : null;
        let baseP = hasElites && a && a.p ? a.p : randomParams();
        let child = (hasElites && a && b && (Math.random()<cxPct))? crossover(a.p, b.p) : { ...baseP };
        child = mutate(child, mutPct);
        if(isDup(child)) continue; pushSeen(child); children.push({ p:child, owner: (a&&a.owner) || (b&&b.owner) || null }); }
const t0g=performance.now();
      __labSimTotal += children.length; updateGlobalProgressUI();
      const evald = await evalParamsList(children, 'EA'); if(!Array.isArray(evald)||!evald.length){ if(!elites.length){ // nothing to build upon
          break; }
        }
      const dtg=performance.now()-t0g;
      cur = elites.concat(evald).sort((x,y)=> y.score-x.score).slice(0,pop);
try{ const top=cur[0]; if(top){ addBtLog(`EA g ${g-1}→${g-1} done — ${children.length} évals en ${Math.round(dtg)} ms (${Math.round(dtg/Math.max(1,children.length))} ms/éval) — best ${top.score.toFixed(2)} PF ${(top.res.profitFactor===Infinity?'∞':(top.res.profitFactor||0).toFixed(2))} Trades ${top.res.tradesCount}`); } }catch(_){ }
      bestGlobal = Math.max(bestGlobal, (cur[0]?.score ?? -Infinity));
      updateProgress(`EA g ${g}/${gens}`, 100*(g/(gens+1)));
    }
    return cur; }

  async function runBayes(seed){ const iters = Math.max(0, parseInt((document.getElementById('labBayIters')&&document.getElementById('labBayIters').value)||'150',10));
    const initN = Math.max(1, parseInt((document.getElementById('labBayInit')&&document.getElementById('labBayInit').value)||'40',10));
    const elitePct = Math.max(5, Math.min(80, parseInt((document.getElementById('labBayElitePct')&&document.getElementById('labBayElitePct').value)||'30',10)));
    const seen=new Set(); const isDup=(p)=>{ const k=keyOf(p); if(seen.has(k)) return true; const ck=canonKey(p); if(seenCanon.has(ck)) return true; return false; }; const pushSeen=(p)=>{ seen.add(keyOf(p)); seenCanon.add(canonKey(p)); };
    let pool=[];
    const seeds = Array.isArray(seed)? seed.slice(0) : [];
    const start=[]; for(const s of seeds){ if(isDup(s.p)) continue; pushSeen(s.p); start.push({ p:s.p, owner:s.owner||null }); if(start.length>=initN) break; }
    while(start.length<initN){ const p=randomParams(); if(isDup(p)) continue; pushSeen(p); start.push({ p }); }
    try{ setBtTitle('Bayes (EDA)'); addBtLog('Bayes: démarrage'); }catch(_){ }
__labSimTotal += start.length; updateGlobalProgressUI();
try{ addBtLog && addBtLog(`Bayes:init — scheduling ${start.length} évals`); }catch(_){ }
    let cur = (await evalParamsList(start, 'Bayes:init')).sort((a,b)=> b.score - a.score);
try{ const top=cur[0]; if(top){ addBtLog(`Bayes init — best ${top.score.toFixed(2)} PF ${(top.res.profitFactor===Infinity?'∞':(top.res.profitFactor||0).toFixed(2))}`); } }catch(_){ }
    bestGlobal = Math.max(bestGlobal, (cur[0]?.score ?? -Infinity));
    updateProgress(`Bayes 0/${iters}`, 0);
    for(let it=1; it<=iters && !btAbort; it++){
      while(btPaused && !btAbort){ if(labRunStatusEl) labRunStatusEl.textContent='Pause'; await new Promise(r=> setTimeout(r, 200)); }
      if(timeUp() || goalReached() || quotaReached()) break;
      const eliteN = Math.max(1, Math.floor(cur.length * elitePct/100));
      const elite = cur.slice(0, eliteN);
      // build categorical distributions (frequency)
      function distFrom(el){ const freq=(arr,sel)=>{ const m=new Map(); for(const e of el){ const v=sel(e.p); m.set(v,(m.get(v)||0)+1); } return Array.from(arr).map(v=>({v, w:(m.get(v)||0)+1})); };
        return { nol:freq(rNol,x=>x.nol), prd:freq(rPrd,x=>x.prd), sl:freq(rSL,x=>x.slInitPct), beb:freq(rBEb,x=>x.beAfterBars), bel:freq(rBEL,x=>x.beLockPct), ema:freq(rEMALen,x=>x.emaLen) };
      }
      const D=distFrom(elite);
      function sampleFrom(list){ const tot=list.reduce((s,a)=>s+a.w,0); let r=Math.random()*tot; for(const it of list){ r-=it.w; if(r<=0) return it.v; } return list[list.length-1].v; }
      const tpCfg = readTPOpt();
      const slCfg = readSLOpt();
const vars = readLabVarToggles();
      const batch=[]; while(batch.length<Math.max(10, cur.length)){
        const p={ nol: vars.varNol? sampleFrom(D.nol) : (lbcOpts.nol|0), prd: vars.varPrd? sampleFrom(D.prd) : (lbcOpts.prd|0), slInitPct: vars.varSLInit? sampleFrom(D.sl) : (+lbcOpts.slInitPct||0), beAfterBars: vars.varBEBars? sampleFrom(D.beb) : (lbcOpts.beAfterBars|0), beLockPct: vars.varBELock? sampleFrom(D.bel) : (+lbcOpts.beLockPct||0), emaLen: vars.varEMALen? sampleFrom(D.ema) : (lbcOpts.emaLen|0), entryMode: lbcOpts.entryMode||'Both', useFibRet: !!lbcOpts.useFibRet, confirmMode: lbcOpts.confirmMode||'Bounce', ent382: !!lbcOpts.ent382, ent500: !!lbcOpts.ent500, ent618: !!lbcOpts.ent618, ent786: !!lbcOpts.ent786, tpEnable: true, tp: [], slEnable: true, sl: [] };
        if(vars.varEntries){ const e=__sampleEntries(p); Object.assign(p, e); }
        if(vars.varTP && tpCfg.en){ p.tp = sampleTPList(tpCfg).slice(0,10); } else { p.tp = Array.isArray(lbcOpts.tp)? lbcOpts.tp.slice(0,10):[]; p.tpEnable=!!p.tp.length; }
        if(vars.varSL && slCfg.en){ p.sl = sampleSLList(slCfg).slice(0,10); } else { p.sl = Array.isArray(lbcOpts.sl)? lbcOpts.sl.slice(0,10):[]; p.slEnable=!!p.sl.length; }
        if(isDup(p)) continue; pushSeen(p); batch.push({ p }); }
      const t0=performance.now();
      __labSimTotal += batch.length; updateGlobalProgressUI();
      const evald = await evalParamsList(batch, `Bayes`);
      const dt=performance.now()-t0;
      cur = cur.concat(evald).sort((a,b)=> b.score-a.score).slice(0, Math.max(50, initN));
try{ const top=cur[0]; if(top && (it===1 || it%5===0 || it===iters)){ addBtLog(`Bayes it ${it}/${iters} — batch ${batch.length} évals en ${Math.round(dt)} ms — best ${top.score.toFixed(2)} PF ${(top.res.profitFactor===Infinity?'∞':(top.res.profitFactor||0).toFixed(2))}`); } }catch(_){ }
      bestGlobal = Math.max(bestGlobal, (cur[0]?.score ?? -Infinity));
      updateProgress(`Bayes ${it}/${iters}`, 100*it/iters);
    }
    return cur; }
    
  // Build seeds (prefer Supabase-backed palmarès cache when available)
  let seeds=[];
  if(goal==='improve'){
    let pal = (Array.isArray(window.labPalmaresCache) && window.labPalmaresCache.length)
      ? window.labPalmaresCache.slice(0,25)
      : [];
    if((!pal.length) && window.SUPA && typeof SUPA.fetchPalmares==='function'){
      try{ pal = await SUPA.fetchPalmares(sym, tfSel, 25); }catch(_){ pal = []; }
    }
    for(const it of pal){ seeds.push({ p:{ ...(it.params||{}) }, owner:it }); }
  }

btAbort=false; btPaused=false; updateProgress('Entraînement...', 0);
  if(labRunStatusEl) labRunStatusEl.textContent='En cours';
  let eaOut=[], bayOut=[];
  if(strategy==='ea' || strategy==='hybrid'){ eaOut = await runEA(seeds); }
  if(strategy==='bayes'){ bayOut = await runBayes(seeds); }
if(strategy==='hybrid' && !timeUp() && !goalReached()){ bayOut = await runBayes(eaOut); }
  const results = (strategy==='ea'? eaOut : (strategy==='bayes'? bayOut : ((eaOut||[]).concat(bayOut||[]))));
  try{ addBtLog && addBtLog(`Résultats finaux — EA:${(eaOut||[]).length} Bayes:${(bayOut||[]).length} Choisi:${(results||[]).length}`); }catch(_){ }
  // Fallback: si aucun résultat (cas rare), prendre le top des évaluations accumulées
  let finalResults = Array.isArray(results)? results.slice() : [];
  // Toujours trier par score décroissant avant de persister
  try{ finalResults.sort((a,b)=> (Number(b&&b.score)||0) - (Number(a&&a.score)||0)); }catch(_){ }
  if(!finalResults.length && Array.isArray(allTested) && allTested.length){
    try{ const sorted = allTested.slice().sort((a,b)=> (b.score||0)-(a.score||0)); finalResults = sorted.slice(0, Math.min(10, sorted.length)).map(it=>({ p: it.params||{}, res: it.metrics||{}, score: it.score||0, gen:1, name:null })); addBtLog && addBtLog(`Fallback best depuis évaluations: ${finalResults.length}`); }catch(_){ }
  }

  if(goal==='new'){
    const bestOut = finalResults.slice(0, Math.min(10, finalResults.length)).map(x=>({ params:x.p, metrics:x.res, score:x.score, gen:1, name: x.name||null }));
    if(window.SUPA && typeof SUPA.isConfigured==='function' && SUPA.isConfigured() && typeof SUPA.persistLabResults==='function'){
      // Tout passe par Supabase
      try{ await SUPA.persistLabResults({ symbol:sym, tf: tfSel, tested: allTested, best: bestOut, profileName: (localStorage.getItem('labWeightsProfile')||'balancee') }); }catch(_){ }
      try{ await renderLabFromStorage(); await computeLabBenchmarkAndUpdate(); }catch(_){ }
    } else {
      // Fallback local uniquement si Supabase non configuré
      try{ writePalmares(sym, tfSel, bestOut); }catch(_){ }
      try{ await renderLabFromStorage(); await computeLabBenchmarkAndUpdate(); }catch(_){ }
    }
    setStatus('Palmarès mis à jour'); closeBtProgress();
  } else {
    const bestOut = finalResults.slice(0, Math.min(10, finalResults.length)).map(x=>({ params:x.p, metrics:x.res, score:x.score, gen: (x.gen||1), name: x.name||null }));
    if(window.SUPA && typeof SUPA.isConfigured==='function' && SUPA.isConfigured() && typeof SUPA.persistLabResults==='function'){
      try{ await SUPA.persistLabResults({ symbol:sym, tf: tfSel, tested: allTested, best: bestOut, profileName: (localStorage.getItem('labWeightsProfile')||'balancee') }); }catch(_){ }
      try{ await renderLabFromStorage(); await computeLabBenchmarkAndUpdate(); }catch(_){ }
    } else {
      try{ writePalmares(sym, tfSel, bestOut); }catch(_){ }
      try{ await renderLabFromStorage(); await computeLabBenchmarkAndUpdate(); }catch(_){ }
    }
    setStatus('Amélioration terminée'); closeBtProgress();
  }
 }catch(e){ try{ addBtLog(`Erreur entraînement: ${e&&e.message?e.message:e}`); }catch(_){ } setStatus('Erreur entraînement'); try{ closeBtProgress(); }catch(_){ } } }); }

// Lab Pause/Stop controls are now on the progress popup (btPause/btStop)

// Presets (Heaven)
const lbcPresetName=document.getElementById('lbcPresetName'); const lbcPresetSave=document.getElementById('lbcPresetSave'); const lbcPresetSelect=document.getElementById('lbcPresetSelect'); const lbcPresetLoad=document.getElementById('lbcPresetLoad'); const lbcPresetDelete=document.getElementById('lbcPresetDelete'); const lbcResetBtn=document.getElementById('lbcReset');
function loadPresetList(){ try{ const s=localStorage.getItem('lbcPresetList'); const names=s? JSON.parse(s): []; if(lbcPresetSelect){ lbcPresetSelect.innerHTML = names.map(n=>`<option value=\"${n}\">${n}</option>`).join(''); } return names; }catch(_){ return []; } }
function savePresetList(names){ try{ localStorage.setItem('lbcPresetList', JSON.stringify(names)); }catch(_){ } }
function savePreset(name){ const names=loadPresetList(); const idx=names.indexOf(name); if(idx===-1){ names.push(name); savePresetList(names); loadPresetList(); } try{ localStorage.setItem('lbcPreset:'+name, JSON.stringify(lbcOpts)); }catch(_){ } }
function loadPresetByName(name){ try{ const s=localStorage.getItem('lbcPreset:'+name); if(!s) return false; lbcOpts = { ...defaultLBC, ...JSON.parse(s) }; saveLBCOpts(); renderLBC(); return true; }catch(_){ return false; } }
function deletePreset(name){ try{ localStorage.removeItem('lbcPreset:'+name); const names=loadPresetList().filter(n=>n!==name); savePresetList(names); loadPresetList(); }catch(_){} }
loadPresetList();
if(lbcPresetSave){ lbcPresetSave.addEventListener('click', ()=>{ const name=(lbcPresetName&&lbcPresetName.value||'').trim(); if(!name){ setStatus('Nom du preset requis'); return; } savePreset(name); setStatus('Preset sauvegardé'); }); }
if(lbcPresetLoad){ lbcPresetLoad.addEventListener('click', ()=>{ const name=(lbcPresetSelect&&lbcPresetSelect.value)||''; if(!name){ setStatus('Aucun preset'); return; } if(loadPresetByName(name)){ setStatus('Preset chargé'); try{ computeLabBenchmarkAndUpdate(); }catch(_){ } } }); }
if(lbcPresetDelete){ lbcPresetDelete.addEventListener('click', ()=>{ const name=(lbcPresetSelect&&lbcPresetSelect.value)||''; if(!name) return; if(confirm(`Supprimer le preset \"${name}\" ?`)){ deletePreset(name); setStatus('Preset supprimé'); } }); }
if(lbcResetBtn){ lbcResetBtn.addEventListener('click', ()=>{ lbcOpts = { ...defaultLBC }; saveLBCOpts(); renderLBC(); setStatus('Paramètres réinitialisés'); try{ computeLabBenchmarkAndUpdate(); }catch(_){ } }); }

// Supabase-backed Heaven strategies
const lbcSupaName=document.getElementById('lbcSupaName');
const lbcSupaSave=document.getElementById('lbcSupaSave');
const lbcSupaSelect=document.getElementById('lbcSupaSelect');
const lbcSupaLoad=document.getElementById('lbcSupaLoad');
const lbcSupaDelete=document.getElementById('lbcSupaDelete');

function currentHeavenParamsForPersist(){ try{
  return {
    nol:lbcOpts.nol, prd:lbcOpts.prd, slInitPct:lbcOpts.slInitPct,
    beAfterBars:lbcOpts.beAfterBars, beLockPct:lbcOpts.beLockPct,
    emaLen:lbcOpts.emaLen,
    entryMode:lbcOpts.entryMode||'Both', useFibRet:!!lbcOpts.useFibRet, confirmMode:lbcOpts.confirmMode||'Bounce',
    ent382:!!lbcOpts.ent382, ent500:!!lbcOpts.ent500, ent618:!!lbcOpts.ent618, ent786:!!lbcOpts.ent786,
    tpEnable:!!lbcOpts.tpEnable, tp: Array.isArray(lbcOpts.tp)? lbcOpts.tp.slice(0,10):[],
    slEnable:!!lbcOpts.slEnable, sl: Array.isArray(lbcOpts.sl)? lbcOpts.sl.slice(0,10):[],
    tp1R:lbcOpts.tp1R, tpCompound: !!lbcOpts.tpCompound, tpCloseAllLast: !!lbcOpts.tpCloseAllLast,
  };
}catch(_){ return {}; }}
function applyHeavenParams(p){ try{
  if(p==null || typeof p!=='object') return;
  if(p.nol!=null) lbcOpts.nol = p.nol|0;
  if(p.prd!=null) lbcOpts.prd = p.prd|0;
  if(p.slInitPct!=null) lbcOpts.slInitPct = +p.slInitPct;
  if(p.beAfterBars!=null) lbcOpts.beAfterBars = p.beAfterBars|0;
  if(p.beLockPct!=null) lbcOpts.beLockPct = +p.beLockPct;
  if(p.emaLen!=null) lbcOpts.emaLen = p.emaLen|0;
  if(p.entryMode!=null) lbcOpts.entryMode = String(p.entryMode);
  if(p.useFibRet!=null) lbcOpts.useFibRet = !!p.useFibRet;
  if(p.confirmMode!=null) lbcOpts.confirmMode = String(p.confirmMode);
  if(p.ent382!=null) lbcOpts.ent382 = !!p.ent382;
  if(p.ent500!=null) lbcOpts.ent500 = !!p.ent500;
  if(p.ent618!=null) lbcOpts.ent618 = !!p.ent618;
  if(p.ent786!=null) lbcOpts.ent786 = !!p.ent786;
  if(p.tpEnable!=null) lbcOpts.tpEnable = !!p.tpEnable;
  if(Array.isArray(p.tp)) lbcOpts.tp = p.tp.slice(0,10);
  if(p.slEnable!=null) lbcOpts.slEnable = !!p.slEnable;
  if(Array.isArray(p.sl)) lbcOpts.sl = p.sl.slice(0,10);
  if(p.tp1R!=null) lbcOpts.tp1R = +p.tp1R;
  if(p.tpCompound!=null) lbcOpts.tpCompound = !!p.tpCompound;
  if(p.tpCloseAllLast!=null) lbcOpts.tpCloseAllLast = !!p.tpCloseAllLast;
  saveLBCOpts(); renderLBC();
}catch(_){ }}
async function populateHeavenSupaList(){ try{
  if(!(window.SUPA && typeof SUPA.isConfigured==='function' && SUPA.isConfigured())){ if(lbcSupaSelect) lbcSupaSelect.innerHTML=''; return; }
  const sym = (symbolSelect&&symbolSelect.value)||currentSymbol;
  const tf = (intervalSelect&&intervalSelect.value)||currentInterval;
  let rows=[]; try{ rows = await SUPA.fetchHeavenStrategies(sym, tf, 50); }catch(_){ rows=[]; }
  window.__heavenSupaList = Array.isArray(rows)? rows.slice() : [];
  if(lbcSupaSelect){ lbcSupaSelect.innerHTML = (rows||[]).map(r=>`<option value=\"${r.id}\">${(r.name||'(sans nom)')} — ${new Date(r.created_at).toLocaleString()}</option>`).join(''); }
}catch(_){ }}
if(lbcSupaSave){ lbcSupaSave.addEventListener('click', async ()=>{ try{
  if(!(window.SUPA && SUPA.isConfigured && SUPA.isConfigured())){ setStatus('Supabase non configuré'); return; }
  let name=(lbcSupaName&&lbcSupaName.value||'').trim(); if(!name){ try{ name=randomName(); }catch(_){ name='heaven'; } }
  const params=currentHeavenParamsForPersist();
  // Optional metrics snapshot over visible range
  let metrics=null; try{
    const conf={ startCap: 10000, fee: 0.1, lev: 1, maxPct:100, base:'initial' };
    let from=null, to=null; const r=getVisibleRange(); if(r){ from=r.from; to=r.to; }
    const [sIdx,eIdx]=idxFromTime(from,to);
    metrics = runBacktestSliceFor(candles, sIdx, eIdx, conf, params);
  }catch(_){ metrics=null; }
  const ok = await SUPA.persistHeavenStrategy({ symbol: ((symbolSelect&&symbolSelect.value)||currentSymbol), tf: ((intervalSelect&&intervalSelect.value)||currentInterval), name, params, metrics });
  if(ok){ setStatus('Heaven sauvegardée (Supabase)'); await populateHeavenSupaList(); }
}catch(_){ setStatus('Erreur sauvegarde Supabase'); } }); }
if(lbcSupaLoad){ lbcSupaLoad.addEventListener('click', ()=>{ try{
  const id=(lbcSupaSelect&&lbcSupaSelect.value)||''; if(!id) return; const rows=Array.isArray(window.__heavenSupaList)? window.__heavenSupaList:[]; const it=rows.find(r=> r.id===id); if(!it) return; applyHeavenParams(it.params||{}); try{ computeLabBenchmarkAndUpdate(); }catch(_){ } setStatus('Stratégie Heaven chargée');
}catch(_){ } }); }
if(lbcSupaDelete){ lbcSupaDelete.addEventListener('click', async ()=>{ try{
  const id=(lbcSupaSelect&&lbcSupaSelect.value)||''; if(!id) return; if(!confirm('Supprimer cette stratégie Supabase ?')) return; const ok=await SUPA.deleteHeavenStrategy(id); if(ok){ setStatus('Supprimée'); await populateHeavenSupaList(); }
}catch(_){ } }); }

// Live (paper) minimal
let liveSession=null; const liveStartBtn=document.getElementById('liveStart'); const liveStopBtn=document.getElementById('liveStop'); const liveStartCap=document.getElementById('liveStartCap'); const liveFee=document.getElementById('liveFee'); const liveLev=document.getElementById('liveLev');
// Multi-wallet sessions support
let liveSessions = {}; let activeLiveId=null;
function anyLiveActive(){ try{ return Object.values(liveSessions).some(s=>!!s.active); }catch(_){ return !!(liveSession&&liveSession.active); } }
function ensureLiveDrawer(){ try{ if(document.getElementById('liveDrawer')) return; // Drawer
  const d=document.createElement('div'); d.id='liveDrawer'; d.style.position='fixed'; d.style.left='0'; d.style.top='60px'; d.style.bottom='0'; d.style.width='260px'; d.style.background= isDark()? '#0b0f1a' : '#f9fafb'; d.style.borderRight= isDark()? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)'; d.style.transform='translateX(-240px)'; d.style.transition='transform .2s ease'; d.style.zIndex='1500'; d.style.padding='8px'; d.innerHTML = '<div style="font-weight:600;margin-bottom:6px;">Live wallets</div><div id="liveDrawerList" style="overflow:auto; max-height: calc(100% - 10px);"></div>';
  document.body.appendChild(d);
  // Toggle button
  if(!document.getElementById('liveDrawerBtn')){ const b=document.createElement('button'); b.id='liveDrawerBtn'; b.textContent='≡'; b.className='btn'; b.style.position='fixed'; b.style.left='8px'; b.style.top='70px'; b.style.zIndex='1501'; b.addEventListener('click', ()=>{ const open = d.dataset.open==='1'; d.dataset.open = open?'0':'1'; d.style.transform = open? 'translateX(-240px)' : 'translateX(0)'; }); document.body.appendChild(b); }
}catch(_){ } }
function renderLiveDrawer(){ try{ ensureLiveDrawer(); const list=document.getElementById('liveDrawerList'); if(!list) return; const arr=Object.values(liveSessions); list.innerHTML = arr.map(s=>{ const on=!!s.active; const sel=(s.id===activeLiveId); return `<div data-id="${s.id}" class="lw-item" style="padding:6px; margin:4px 0; border-radius:6px; cursor:pointer; background:${sel? (isDark()? '#111827':'#e5e7eb') : 'transparent'};">`+
  `<div style=\"display:flex; align-items:center; justify-content:space-between;\"><div style=\"font-weight:600;\">${s.name||s.id}</div>`+
  `<label style=\"font-size:12px; display:flex; align-items:center; gap:6px;\">Actif <input type=\"checkbox\" data-act=\"1\" ${on?'checked':''} /></label></div>`+
  `<div style=\"font-size:12px; color:${isDark()? '#9ca3af':'#4b5563'};\">${symbolToDisplay(s.symbol)} • ${s.tf}</div>`+
  `</div>`; }).join('');
  list.querySelectorAll('.lw-item').forEach(el=>{ const id=el.getAttribute('data-id'); el.addEventListener('click', (e)=>{ const t=e.target; if(t && t.getAttribute && t.getAttribute('data-act')==='1') return; setActiveLive(id); }); const ck=el.querySelector('input[type=checkbox][data-act]'); if(ck){ ck.addEventListener('change', ()=>{ const s=liveSessions[id]; if(s){ s.active=!!ck.checked; } }); } });
}catch(_){ } }
async function setActiveLive(id){ try{ const s=liveSessions[id]; if(!s) return; activeLiveId=id; liveSession=s; // adopt TF/symbol/strategy
  if(s.strategy){ lbcOpts = { ...defaultLBC, ...s.strategy }; saveLBCOpts(); }
  const needSwitch = (s.symbol!==currentSymbol) || (s.tf!==currentInterval);
  if(needSwitch){ currentSymbol=s.symbol; currentInterval=s.tf; try{ if(symbolSelect) symbolSelect.value=currentSymbol; if(intervalSelect) intervalSelect.value=currentInterval; localStorage.setItem('chart:tf', currentInterval); updateTitle(currentSymbol); updateWatermark(); }catch(_){ }
    closeWs(); await load(currentSymbol, currentInterval); openWs(currentSymbol, currentInterval);
  }
  try{ tpHitMarkers=(s.markers&&s.markers.tps)||[]; slHitMarkers=(s.markers&&s.markers.sls)||[]; beHitMarkers=(s.markers&&s.markers.bes)||[]; liveEntryMarkers=(s.markers&&s.markers.entries)||[]; }catch(_){ }
  renderLBC(); renderLiveHUD(); refreshLiveTradesUI(); renderLiveDrawer();
  // Re-open the two floating popups (Résultats + Trades) when switching wallet via left menu
  try{ openModalEl(stratModalEl); openModalEl(tradesModalEl); ensureFloatingModal(stratModalEl, 'strat', { left: 40, top: 40, width: 480, height: 300, zIndex: bumpZ() }); ensureFloatingModal(tradesModalEl, 'trades', { left: 540, top: 40, width: 720, height: 360, zIndex: bumpZ() }); }catch(_){ }
}catch(_){ } }
function multiLiveOnBar(bar){ try{ const arr=Object.values(liveSessions); for(const s of arr){ if(!s.active) continue; if(!(s.symbol===currentSymbol && s.tf===currentInterval)) continue; __mkRoutingSession = s; if(!s.markers) s.markers={ entries:[], tps:[], sls:[], bes:[] };
    const prevLS=liveSession, prevPos=livePos, prevPF=livePendingFib, prevTrades=liveTrades; liveSession=s; livePos=s.pos||null; livePendingFib=s.pendingFib||null; liveTrades=s.trades||[]; try{ liveOnBar(bar); }catch(_){ } s.pos=livePos; s.pendingFib=livePendingFib; s.trades=liveTrades; if(s.id===activeLiveId){ try{ tpHitMarkers=(s.markers&&s.markers.tps)||[]; slHitMarkers=(s.markers&&s.markers.sls)||[]; beHitMarkers=(s.markers&&s.markers.bes)||[]; liveEntryMarkers=(s.markers&&s.markers.entries)||[]; renderLBC(); renderLiveHUD(); refreshLiveTradesUI(); }catch(_){ } } liveSession=prevLS; livePos=prevPos; livePendingFib=prevPF; liveTrades=prevTrades; __mkRoutingSession=null; } }catch(_){ } }
// Live state for markers and position mgmt (with equity and trade events)
let livePos=null; let livePendingFib=null; let liveTrades=[];
function clearLiveTrades(){ liveTrades=[]; }
function renderLiveHUD(){ try{ if(!liveSession||!liveSession.active) return; if(stratTitle){ stratTitle.textContent = `${symbolToDisplay(liveSession.symbol)} • ${liveSession.tf} — Live`; } if(stratTBody){ const eq=Number(liveSession.equity)||0; const start=Number(liveSession.startCap)||0; const pnl=eq-start; const rows=[]; rows.push(`<tr><td style=\"text-align:left\">Capital</td><td>—</td><td style=\"text-align:right\">${eq.toFixed(2)}</td></tr>`); rows.push(`<tr><td style=\"text-align:left\">P&L net</td><td>—</td><td style=\"text-align:right\">${pnl.toFixed(2)}</td></tr>`); stratTBody.innerHTML = rows.join(''); } }catch(_){ } }
function refreshLiveTradesUI(){ try{ const state={ trades: liveTrades.slice(), symbol: liveSession.symbol, tf: liveSession.tf, startCap: liveSession.startCap, equityFinal: liveSession.equity, totalPnl: (Number(liveSession.equity)||0) - (Number(liveSession.startCap)||0) }; lastTradesCtx = state; populateTradesModal(state); }catch(_){ } }
function liveOnBar(bar){
  if(!liveSession||!liveSession.active) return;
  try{
    const i=candles.length-1; if(i<1) return;
    const lb=computeLineBreakState(candles, Math.max(1, lbcOpts.nol|0));
    const prd=Math.max(2, lbcOpts.prd|0);
    const pivAll=computePivots(candles, prd);
    const segLast=getLastPivotSeg(pivAll);
    const trendNow=lb.trend[i]; const trendPrev=lb.trend[i-1];
    const feePct=(Number.isFinite(liveSession.fee)? liveSession.fee: 0.1)/100;
    const lev=Number.isFinite(liveSession.lev)? liveSession.lev:1;
    const slEmaCache=new Map(); clearTPHitMarkers();
function computeSLFromLadder(dir, entry, i){ try{ if(!(lbcOpts.slEnable && Array.isArray(lbcOpts.sl) && lbcOpts.sl.length)) return null; const seg=segLast; const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null; const cands=[]; for(const t of lbcOpts.sl){ const typ=(t&&t.type)||'Percent'; let price=null; if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B - move*r) : (B + move*r); } else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1 - p/100)) : (entry*(1 + p/100)); } else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (lbcOpts.emaLen||55)),10)); let ema=slEmaCache.get(len); if(!ema){ ema=emaCalc(candles, len); slEmaCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; } if(price!=null){ if(dir==='long'){ if(price<=entry) cands.push(price); } else { if(price>=entry) cands.push(price); } } } if(!cands.length) return null; return dir==='long'? Math.max(...cands) : Math.min(...cands); }catch(_){ return null; } }
  function liveBuildTargets(dir, entry, riskAbs, i){
      let list=[];
      if(lbcOpts.tpEnable && Array.isArray(lbcOpts.tp) && lbcOpts.tp.length){
        const A=segLast?segLast.a.price:null, B=segLast?segLast.b.price:null, move=segLast?Math.abs(B-A):null;
        for(let idx=0; idx<lbcOpts.tp.length; idx++){ const t=lbcOpts.tp[idx]; let price=null; const typ=(t.type||'Fib');
          if(typ==='Fib' && segLast && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (segLast.dir==='up')? (B + move*r) : (B - move*r); }
          else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1+p/100)) : (entry*(1-p/100)); }
          else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v=ema[ema.length-1]; if(isFinite(v)) price=v; }
          if(price!=null){ if((dir==='long' && price>entry) || (dir==='short' && price<entry)){ let w=null; const q=t.qty; if(q!=null && isFinite(q)) w=(q>1? q/100 : q); list.push({price, w, srcIdx: idx}); } }
        }
        if(dir==='long') list.sort((a,b)=>a.price-b.price); else list.sort((a,b)=>b.price-a.price);
        let sumW=0, hasW=false; for(const it of list){ if(it.w!=null && it.w>0){ sumW+=it.w; hasW=true; } }
        if(!hasW){ if(list.length){ const even=1/list.length; list=list.map(it=>({ price:it.price, w:even, srcIdx: it.srcIdx })); }
          else { list=[{price: (dir==='long'? entry + riskAbs*(lbcOpts.tp1R||1) : entry - riskAbs*(lbcOpts.tp1R||1)), w:1, srcIdx: 0}]; }
        } else {
          if(sumW>1){ const k=1/sumW; for(const it of list){ if(it.w!=null) it.w*=k; } }
          else if(lbcOpts.tpCloseAllLast && sumW<1 && list.length){ list[list.length-1].w = (list[list.length-1].w||0) + (1-sumW); }
        }
      } else {
        list=[{ price: dir==='long'? (entry + riskAbs*(lbcOpts.tp1R||1)) : (entry - riskAbs*(lbcOpts.tp1R||1)), w:1, srcIdx: 0 }];
      }
      return list;
    }
    function __liveComputeQty(entry, sl){ if(!(isFinite(entry)&&isFinite(sl))) return 0; const equity=Number(liveSession.equity)||0; if(equity<=0) return 0; const budget=Math.max(0, equity); const notional=budget*lev; const qty0 = notional/Math.max(1e-12, entry); const riskAbs=Math.abs(entry-sl); const perUnitWorstLoss = riskAbs + ((Math.abs(entry)+Math.abs(sl)) * feePct); const qtyRisk = perUnitWorstLoss>0? (equity / perUnitWorstLoss) : 0; const q=Math.max(0, Math.min(qty0, qtyRisk)); return q; }
    let dirty=false, uiDirty=false;
    // Entry logic (trend flip and optional Fib retracement)
    if(!livePos){
      if(trendNow!==trendPrev){
        if(segLast){
          const A=segLast.a.price, B=segLast.b.price; const up=segLast.dir==='up'; const move=Math.abs(B-A);
          const levels=[]; if(lbcOpts.ent382) levels.push(up? (B - move*0.382) : (B + move*0.382)); if(lbcOpts.ent500) levels.push(up? (B - move*0.5) : (B + move*0.5)); if(lbcOpts.ent618) levels.push(up? (B - move*0.618) : (B + move*0.618)); if(lbcOpts.ent786) levels.push(up? (B - move*0.786) : (B + move*0.786));
          livePendingFib = { dir:(trendNow===1?'long':'short'), levels, mode: lbcOpts.confirmMode||'Bounce' };
        }
        if(lbcOpts.entryMode!=='Fib Retracement'){
          const dir=(trendNow===1)?'long':'short';
          const entry=bar.close;
          let sl=computeSLFromLadder(dir, entry, i);
          if(sl==null){ const riskPx=entry*(lbcOpts.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; }
          const qty=__liveComputeQty(entry, sl);
          if(qty>1e-12 && isFinite(qty)){
            const targets=liveBuildTargets(dir, entry, Math.abs(entry-sl), i);
            livePos={ dir, entry, sl, initSL:sl, qty:qty, initQty:qty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets, hiSince: bar.high, loSince: bar.low, lastTpIdx: 0, tpTrailCfg: null, slTrailCfg: null };
            try{ addLiveEntryMarker(candles[i].time, dir); }catch(_){ }
            try{ liveTrades.push({ dir, entryTime:candles[i].time, entry, initSL:sl, exitTime:candles[i].time, exit:entry, reason:'Entry', qty:qty, pnl:0, fees:0, net:0, rr:null }); }catch(_){ }
            dirty=true; uiDirty=true;
          }
        }
      }
      if(!livePos && lbcOpts.useFibRet && (lbcOpts.entryMode!=='Original') && livePendingFib && livePendingFib.levels && livePendingFib.levels.length){
        for(const lv of livePendingFib.levels){ const dir=livePendingFib.dir; let ok=false; if(dir==='long'){ ok=(livePendingFib.mode==='Touch')? (bar.low<=lv) : (bar.low<=lv && bar.close>lv); } else { ok=(livePendingFib.mode==='Touch')? (bar.high>=lv) : (bar.high>=lv && bar.close<lv); }
          if(ok){ const entry=bar.close; let sl=computeSLFromLadder(dir, entry, i); if(sl==null){ const riskPx=entry*(lbcOpts.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; } const qty=__liveComputeQty(entry, sl); if(qty>1e-12 && isFinite(qty)){ const targets=liveBuildTargets(dir, entry, Math.abs(entry-sl), i); livePos={ dir, entry, sl, initSL:sl, qty:qty, initQty:qty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets, hiSince: bar.high, loSince: bar.low, lastTpIdx: 0, tpTrailCfg: null, slTrailCfg: null }; try{ addLiveEntryMarker(candles[i].time, dir); }catch(_){ } dirty=true; uiDirty=true; livePendingFib=null; break; } }
        }
      }
    } else {
      // Update extremes since entry
      livePos.hiSince = Math.max(livePos.hiSince||bar.high, bar.high);
      livePos.loSince = Math.min(livePos.loSince||bar.low, bar.low);
      // BE arming
      if(lbcOpts.beEnable && !livePos.beActive && (i - livePos.entryIdx) >= lbcOpts.beAfterBars){
        const movePct = livePos.dir==='long'? ((bar.high - livePos.entry)/livePos.entry*100) : ((livePos.entry - bar.low)/livePos.entry*100);
        if(movePct >= lbcOpts.beLockPct){ livePos.beActive=true; livePos.sl = livePos.entry; }
      }
      // Continuous per-TP trailing (ema/percent)
      if(livePos.tpTrailCfg){ try{ let cand=null; if(livePos.tpTrailCfg.mode==='ema'){ const len=Math.max(1, parseInt((livePos.tpTrailCfg.emaLen!=null? livePos.tpTrailCfg.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(livePos.tpTrailCfg.mode==='percent'){ const pct=Number(livePos.tpTrailCfg.pct)||0; if(livePos.dir==='long'){ cand=(livePos.hiSince||bar.high)*(1 - pct/100); } else { cand=(livePos.loSince||bar.low)*(1 + pct/100); } } if(cand!=null){ let b=cand; if(!livePos.beActive){ b=(livePos.dir==='long')? Math.min(cand, livePos.entry) : Math.max(cand, livePos.entry); } livePos.sl = (livePos.dir==='long')? Math.max(livePos.sl, b) : Math.min(livePos.sl, b); } }catch(_){ } }
      // Continuous SL-attached trailing (ema/percent)
      if(livePos.slTrailCfg){ try{ let cand=null; if(livePos.slTrailCfg.mode==='ema'){ const len=Math.max(1, parseInt((livePos.slTrailCfg.emaLen!=null? livePos.slTrailCfg.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(livePos.slTrailCfg.mode==='percent'){ const pct=Number(livePos.slTrailCfg.pct)||0; if(livePos.dir==='long'){ cand=(livePos.hiSince||bar.high)*(1 - pct/100); } else { cand=(livePos.loSince||bar.low)*(1 + pct/100); } } if(cand!=null){ let b=cand; if(!livePos.beActive){ b=(livePos.dir==='long')? Math.min(cand, livePos.entry) : Math.max(cand, livePos.entry); } livePos.sl = (livePos.dir==='long')? Math.max(livePos.sl, b) : Math.min(livePos.sl, b); } }catch(_){ } }
      // SL ladder merge
      { const sl2=computeSLFromLadder(livePos.dir, livePos.entry, i); if(sl2!=null){ let b=sl2; if(!livePos.beActive){ b=(livePos.dir==='long')? Math.min(sl2, livePos.entry) : Math.max(sl2, livePos.entry); } livePos.sl = (livePos.dir==='long')? Math.max(livePos.sl, b) : Math.min(livePos.sl, b); } }
      // SL check
      if(livePos.dir==='long'){
        if(bar.low <= livePos.sl){ const portionQty = livePos.qty; const pnl = (livePos.sl - livePos.entry) * portionQty; const fees = (livePos.entry*portionQty + livePos.sl*portionQty) * feePct; const net=pnl-fees; liveSession.equity += net; if(liveSession.equity<0) liveSession.equity=0; liveTrades.push({ dir:livePos.dir, entryTime:candles[livePos.entryIdx].time, entry:livePos.entry, initSL:livePos.initSL, exitTime:candles[i].time, exit:livePos.sl, reason:'SL', qty:portionQty, pnl, fees, net, rr: (Math.abs(livePos.entry-livePos.initSL)*portionQty>0? net/(Math.abs(livePos.entry-livePos.initSL)*portionQty) : null) }); if(Math.abs(livePos.sl - livePos.entry) <= 1e-8){ addBEHitMarker(candles[i].time, livePos.dir); } else { addSLHitMarker(candles[i].time, livePos.dir); } livePos=null; dirty=true; uiDirty=true; }
      } else {
        if(bar.high >= livePos.sl){ const portionQty = livePos.qty; const pnl = (livePos.entry - livePos.sl) * portionQty; const fees = (livePos.entry*portionQty + livePos.sl*portionQty) * feePct; const net=pnl-fees; liveSession.equity += net; if(liveSession.equity<0) liveSession.equity=0; liveTrades.push({ dir:livePos.dir, entryTime:candles[livePos.entryIdx].time, entry:livePos.entry, initSL:livePos.initSL, exitTime:candles[i].time, exit:livePos.sl, reason:'SL', qty:portionQty, pnl, fees, net, rr: (Math.abs(livePos.entry-livePos.initSL)*portionQty>0? net/(Math.abs(livePos.entry-livePos.initSL)*portionQty) : null) }); if(Math.abs(livePos.sl - livePos.entry) <= 1e-8){ addBEHitMarker(candles[i].time, livePos.dir); } else { addSLHitMarker(candles[i].time, livePos.dir); } livePos=null; dirty=true; uiDirty=true; }
      }
      // TP sequential
      if(livePos && livePos.targets && livePos.tpIdx < livePos.targets.length){
        while(livePos && livePos.tpIdx < livePos.targets.length){ const tp=livePos.targets[livePos.tpIdx]; const hit = livePos.dir==='long'? (bar.high >= tp.price) : (bar.low <= tp.price); if(!hit) break; const portionFrac = lbcOpts.tpCompound? (tp.w||1) : 1; const portionQty = livePos.initQty * portionFrac; const usedQty = Math.min(portionQty, livePos.qty); const exitPx = tp.price; const pnl = (livePos.dir==='long'? (exitPx - livePos.entry) : (livePos.entry - exitPx)) * usedQty; const fees = (livePos.entry*usedQty + exitPx*usedQty) * feePct; const net = pnl - fees; liveSession.equity += net; if(liveSession.equity<0) liveSession.equity=0; liveTrades.push({ dir:livePos.dir, entryTime:candles[livePos.entryIdx].time, entry:livePos.entry, initSL:livePos.initSL, exitTime:candles[i].time, exit:exitPx, reason:`TP${livePos.tpIdx+1}`, qty:usedQty, pnl, fees, net, rr: (Math.abs(livePos.entry-livePos.initSL)*usedQty>0? net/(Math.abs(livePos.entry-livePos.initSL)*usedQty) : null) }); addTPHitMarker(candles[i].time, livePos.dir); livePos.qty -= usedQty; livePos.anyTP=true; // Per-TP actions
          let tCfg = (Array.isArray(lbcOpts.tp) && tp.srcIdx!=null)? lbcOpts.tp[tp.srcIdx] : null; if(!tCfg){ tCfg={}; }
          if(tCfg.beOn){ livePos.sl = livePos.entry; }
          const slNew=(function(){ try{ const s=tCfg.sl; if(!(s)) return null; let price=null; if(s.type==='Fib' && segLast){ const A=segLast.a.price, B=segLast.b.price; const move=Math.abs(B-A); const r=parseFloat(s.fib!=null? s.fib : s.value); if(isFinite(r)) price = (segLast.dir==='up')? (B - move*r) : (B + move*r); } else if(s.type==='Percent'){ const p=parseFloat(s.pct!=null? s.pct : s.value); if(isFinite(p)) price = livePos.dir==='long'? (livePos.entry*(1 - p/100)) : (livePos.entry*(1 + p/100)); } else if(s.type==='EMA'){ const len=Math.max(1, parseInt(((s&&s.emaLen)!=null? s.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; } return price; }catch(_){ return null; } })();
          if(slNew!=null){ let b=slNew; if(!livePos.beActive){ b=(livePos.dir==='long')? Math.min(slNew, livePos.entry) : Math.max(slNew, livePos.entry); } livePos.sl = (livePos.dir==='long')? Math.max(livePos.sl, b) : Math.min(livePos.sl, b); }
          if(tCfg.trail && tCfg.trail.mode){ let cand=null; const m=tCfg.trail.mode; if(m==='be'){ cand=livePos.entry; } else if(m==='prev'){ cand=exitPx; } else if(m==='ema'){ const len=Math.max(1, parseInt(((tCfg.trail.emaLen!=null? tCfg.trail.emaLen : (lbcOpts.emaLen||55))),10)); const ema=emaCalc(candles, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(m==='percent'){ const pct=Number(tCfg.trail.pct)||0; if(livePos.dir==='long'){ cand=(livePos.hiSince||bar.high)*(1 - pct/100); } else { cand=(livePos.loSince||bar.low)*(1 + pct/100); } } if(cand!=null){ let b=cand; if(!livePos.beActive){ b=(livePos.dir==='long')? Math.min(cand, livePos.entry) : Math.max(cand, livePos.entry); } livePos.sl = (livePos.dir==='long')? Math.max(livePos.sl, b) : Math.min(livePos.sl, b); } if(m==='ema' || m==='percent'){ livePos.tpTrailCfg = { mode:m, emaLen: tCfg.trail.emaLen, pct: tCfg.trail.pct }; } }
          if(tCfg.sl && tCfg.sl.trail && tCfg.sl.trail.mode){ const m2=tCfg.sl.trail.mode; if(m2==='ema' || m2==='percent'){ livePos.slTrailCfg = { mode:m2, emaLen: tCfg.sl.trail.emaLen, pct: tCfg.sl.trail.pct }; } }
          livePos.tpIdx++; if(!lbcOpts.tpCompound || livePos.qty<=1e-12){ livePos=null; } dirty=true; uiDirty=true; if(!livePos) break; }
      }
      // Flip close (no specific symbol but we record close)
      if(livePos && ((livePos.dir==='long' && trendNow!==trendPrev && trendNow!==1) || (livePos.dir==='short' && trendNow!==trendPrev && trendNow!==-1))){ const exit=bar.close; const portionQty=livePos.qty; const pnl=(livePos.dir==='long'? (exit - livePos.entry):(livePos.entry - exit))*portionQty; const fees=(livePos.entry*portionQty + exit*portionQty)*feePct; const net=pnl-fees; liveSession.equity+=net; if(liveSession.equity<0) liveSession.equity=0; liveTrades.push({ dir:livePos.dir, entryTime:candles[livePos.entryIdx].time, entry:livePos.entry, initSL:livePos.initSL, exitTime:candles[i].time, exit:exit, reason:'Flip', qty:portionQty, pnl, fees, net, rr: (Math.abs(livePos.entry-livePos.initSL)*portionQty>0? net/(Math.abs(livePos.entry-livePos.initSL)*portionQty) : null) }); livePos=null; dirty=true; uiDirty=true; }
    }
    if(dirty){ renderLBC(); }
    if(uiDirty){ renderLiveHUD(); refreshLiveTradesUI(); }
  }catch(_){ }
}
if(liveStartBtn){ liveStartBtn.addEventListener('click', async ()=>{ const cap=Math.max(0, parseFloat(liveStartCap&&liveStartCap.value||'10000')); const fee=Math.max(0, parseFloat(liveFee&&liveFee.value||'0.1')); const lev=Math.max(1, parseFloat(liveLev&&liveLev.value||'1')); const id='w'+Date.now(); const sess={ id, name:(liveWalletName&&liveWalletName.value)||id, active:true, symbol: currentSymbol, tf: (intervalSelect&&intervalSelect.value)||currentInterval||'', equity: cap, startCap: cap, fee, lev, strategy:{ ...lbcOpts }, pos:null, pendingFib:null, trades:[], markers:{ entries:[], tps:[], sls:[], bes:[] } }; liveSessions[id]=sess; liveSession=sess; activeLiveId=id; livePos=null; livePendingFib=null; clearLiveTrades(); try{ clearTPHitMarkers(); clearSLHitMarkers(); clearBEHitMarkers(); clearLiveEntryMarkers(); clearMkLayer(); candleSeries.setMarkers([]); }catch(_){ } try{ lbcLastMarkers=[]; }catch(_){ } renderLBC(); try{ openModalEl(stratModalEl); openModalEl(tradesModalEl); ensureFloatingModal(stratModalEl, 'strat', { left: 40, top: 40, width: 480, height: 300, zIndex: bumpZ() }); ensureFloatingModal(tradesModalEl, 'trades', { left: 540, top: 40, width: 720, height: 360, zIndex: bumpZ() }); renderLiveHUD(); refreshLiveTradesUI(); ensureLiveDrawer(); renderLiveDrawer(); }catch(_){ } closeModalEl(liveModalEl); setStatus('Paper trading actif'); }); }
if(liveStopBtn){ liveStopBtn.addEventListener('click', ()=>{ if(liveSession){ liveSession.active=false; } closeModalEl(liveModalEl); setStatus('Live arrêté'); }); }

// Live wallets management
const liveWalletSel=document.getElementById('liveWalletSel');
const liveWalletName=document.getElementById('liveWalletName');
const liveWalletSave=document.getElementById('liveWalletSave');
const liveWalletLoad=document.getElementById('liveWalletLoad');
const liveWalletDelete=document.getElementById('liveWalletDelete');
function readLiveWallets(){ try{ const s=localStorage.getItem('liveWallets'); return s? JSON.parse(s): []; }catch(_){ return []; } }
function writeLiveWallets(arr){ try{ localStorage.setItem('liveWallets', JSON.stringify(arr)); }catch(_){} }
async function populateLiveWalletsUI(){ try{ const locals = readLiveWallets(); if(window.SUPA && typeof SUPA.isConfigured==='function' && SUPA.isConfigured() && typeof SUPA.fetchLiveWallets==='function'){ let rows=[]; try{ rows = await SUPA.fetchLiveWallets(100, 'paper'); }catch(_){ rows=[]; }
  // Merge Supabase rows with local (avoid duplicate names; Supabase wins)
  const byName=new Map(); const merged=[]; if(Array.isArray(rows)){ for(const r of rows){ if(!byName.has(r.name)){ byName.set(r.name, true); merged.push(r); } } }
  if(Array.isArray(locals)){ for(const l of locals){ if(l && l.name && !byName.has(l.name)){ merged.push({ name: l.name, startCap:l.startCap, fee:l.fee, lev:l.lev, __local:true }); } } }
  try{ window.__liveWalletsCache = Array.isArray(rows)? rows.slice(): []; }catch(_){ }
  if(liveWalletSel){ liveWalletSel.innerHTML = (merged||[]).map(w=>`<option value=\"${w.name}\">${w.name}</option>`).join(''); }
} else { if(liveWalletSel){ liveWalletSel.innerHTML = (locals||[]).map(w=>`<option value=\"${w.name}\">${w.name}</option>`).join(''); } }
}catch(_){ } }
if(liveWalletSave){ liveWalletSave.addEventListener('click', async ()=>{ try{ const name=(liveWalletName&&liveWalletName.value||'').trim(); if(!name){ setStatus('Nom du wallet requis'); return; } const cap=+(liveStartCap&&liveStartCap.value||'10000'); const fee=+(liveFee&&liveFee.value||'0.1'); const lev=+(liveLev&&liveLev.value||'1'); if(window.SUPA && typeof SUPA.isConfigured==='function' && SUPA.isConfigured() && typeof SUPA.persistLiveWallet==='function'){ const ok = await SUPA.persistLiveWallet({ name, startCap:cap, fee, lev, exchange:'paper', base_currency:'USDC' }); if(ok){ setStatus('Wallet enregistré (Supabase)'); await populateLiveWalletsUI(); } else { setStatus('Erreur enregistrement Supabase'); } } else { let arr=readLiveWallets(); const idx=arr.findIndex(w=>w.name===name); const item={ name, startCap:cap, fee, lev }; if(idx>=0) arr[idx]=item; else arr.unshift(item); writeLiveWallets(arr.slice(0,100)); populateLiveWalletsUI(); setStatus('Wallet enregistré'); } }catch(_){ } }); }
if(liveWalletLoad){ liveWalletLoad.addEventListener('click', async ()=>{ try{ const sel=(liveWalletSel&&liveWalletSel.value)||''; if(!sel) return; if(window.SUPA && typeof SUPA.isConfigured==='function' && SUPA.isConfigured() && Array.isArray(window.__liveWalletsCache)){ const w = window.__liveWalletsCache.find(x=>x.name===sel); if(w){ if(liveStartCap) liveStartCap.value=String(w.startCap||''); if(liveFee) liveFee.value=String(w.fee||''); if(liveLev) liveLev.value=String(w.lev||''); setStatus('Wallet chargé (Supabase)'); return; } } const w=readLiveWallets().find(x=>x.name===sel); if(!w) return; if(liveStartCap) liveStartCap.value=String(w.startCap||''); if(liveFee) liveFee.value=String(w.fee||''); if(liveLev) liveLev.value=String(w.lev||''); setStatus('Wallet chargé'); }catch(_){ } }); }
if(liveWalletDelete){ liveWalletDelete.addEventListener('click', async ()=>{ try{ const sel=(liveWalletSel&&liveWalletSel.value)||''; if(!sel) return; if(window.SUPA && typeof SUPA.isConfigured==='function' && SUPA.isConfigured() && typeof SUPA.deleteLiveWallet==='function'){ const ok = await SUPA.deleteLiveWallet(sel, 'paper'); if(ok){ await populateLiveWalletsUI(); setStatus('Wallet supprimé (Supabase)'); } else { setStatus('Suppression échouée (Supabase)'); } } else { let arr=readLiveWallets().filter(x=>x.name!==sel); writeLiveWallets(arr); populateLiveWalletsUI(); setStatus('Wallet supprimé'); } }catch(_){ } }); }
