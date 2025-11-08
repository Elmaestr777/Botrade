
// --- Lab: Entrainer (AI surrogate) ---


// --- Lab: lecture et palmarès (localStorage) ---
const labTBody = document.getElementById('labTBody'); const labSummaryEl=document.getElementById('labSummary'); const labTFSelect=document.getElementById('labTFSelect');
function labKey(sym, tf){ return `lab:results:${sym}:${tf}`; }
function readLabStorage(sym, tf){ try{ const s=localStorage.getItem(labKey(sym,tf)); return s? JSON.parse(s): []; }catch(_){ return []; } }
function writeLabStorage(sym, tf, arr){ try{ localStorage.setItem(labKey(sym,tf), JSON.stringify(arr)); }catch(_){} }
function palmaresKey(sym, tf){ return `lab:palmares:${sym}:${tf}`; }
function readPalmares(sym, tf){ try{ const s=localStorage.getItem(palmaresKey(sym,tf)); return s? JSON.parse(s): []; }catch(_){ return []; } }
function writePalmares(sym, tf, arr){ try{ localStorage.setItem(palmaresKey(sym,tf), JSON.stringify(arr)); }catch(_){} }
function paramsKey(p){ if(!p) return ''; const o={ nol:p.nol, prd:p.prd, slInitPct:p.slInitPct, beAfterBars:p.beAfterBars, beLockPct:p.beLockPct, emaLen:p.emaLen, entryMode:p.entryMode, useFibRet:!!p.useFibRet, confirmMode:p.confirmMode, ent382:!!p.ent382, ent500:!!p.ent500, ent618:!!p.ent618, ent786:!!p.ent786, tp: Array.isArray(p.tp)? p.tp.slice(0,10): [] }; return JSON.stringify(o); }
// Dictionnaires (échantillons)
const DICT_FR=["étoile","forêt","rivière","montagne","océan","tempête","harmonie","nuage","pluie","lueur","zèbre","quartz","vallée","soleil","déluge","orage","saphir","primevère","cendre","ivoire"];
const DICT_EN=["river","stone","oak","ember","nova","zenith","aurora","lunar","solar","atlas","odyssey","phoenix","falcon","drake","comet","orbit","vertex","harbor","willow","meadow"];
const DICT_ES=["río","piedra","roble","brasa","nube","estrella","luna","sol","mar","tierra","tormenta","sierra","valle","bosque","isla","puerto","águila","toro","lince","cometa"];
const DICT_PL=["rzeka","kamień","dąb","iskra","gwiazda","księżyc","słońce","morze","ziemia","wiatr","burza","las","pustynia","wyspa","orzeł","żubr","ryś","kometa","polana","dolina"];
function randomName(){ const dicts=[DICT_FR,DICT_EN,DICT_ES,DICT_PL]; const d=dicts[Math.floor(Math.random()*dicts.length)]; return d[Math.floor(Math.random()*d.length)]; }
function uniqueNameFor(sym, tf, base){ const pal=readPalmares(sym, tf); const names=new Set(pal.map(x=>x.name)); let n=base; let k=2; while(names.has(n)){ n=base+"-"+k; k++; } return n; }
async function renderLabFromStorage(){
  const tf = labTFSelect? labTFSelect.value: (intervalSelect? intervalSelect.value:''), sym=currentSymbol;
  let arr=[]; let source='local';
  try{
    if(window.SUPA && typeof SUPA.isConfigured==='function' && SUPA.isConfigured() && typeof SUPA.fetchPalmares==='function'){
      const supaArr = await SUPA.fetchPalmares(sym, tf, 25);
      if(Array.isArray(supaArr) && supaArr.length){ arr = supaArr; source='Supabase'; }
    }
  }catch(_){ /* ignore, will fallback */ }
  // Pas de fallback local: Supabase obligatoire (si vide, on affiche vide)
  window.labPalmaresCache = Array.isArray(arr)? arr.slice() : [];
  if(labSummaryEl) labSummaryEl.textContent = arr.length? `Palmarès: ${arr.length} stratégies (symbole ${symbolToDisplay(sym)} • TF ${tf}) — Supabase` : 'Aucun palmarès';
  if(!labTBody){ return; }
  if(!arr.length){ labTBody.innerHTML = '<tr><td colspan=\"14\">Aucune donnée</td></tr>'; return; }
  const rows=[]; let idx=1; const weights=getWeights(localStorage.getItem('labWeightsProfile')||'balancee');
  const sorted=arr.slice().sort((a,b)=> (b.score||scoreResult(b.res||{},weights)) - (a.score||scoreResult(a.res||{},weights)));
  for(const r of sorted){
    const st=r.res||{}; const p=r.params||{};
    const pf=Number(st.profitFactor||0), pnl=Number(st.totalPnl||0), eq1=Number(st.equityFinal||0), cnt=Number(st.tradesCount||0), wr=Number(st.winrate||0), rr=Number(st.avgRR||0), mdd=Number(st.maxDDAbs||0);
    const paramsStr = `nol=${p.nol}, prd=${p.prd}, sl=${p.slInitPct}%, be=${p.beAfterBars}/${p.beLockPct}%, ema=${p.emaLen}`;
    const robust = Number.isFinite(r.score)? r.score : scoreResult(st, weights);
    const raw = scoreResult(st, weights);
    const penalty = Math.max(0, raw - robust);
rows.push('<tr>' + `<td>${idx}</td>` + `<td style=\\\"text-align:left\\\">${(r.name||'—')}</td>` + `<td>${(r.gen||1)}</td>` + `<td style=\\\"text-align:left\\\">${paramsStr}</td>` + `<td>${raw.toFixed(2)}</td>` + `<td title=\\\"brut: ${raw.toFixed(2)} • pénalité: ${penalty.toFixed(2)}\\\">${robust.toFixed(2)}</td>` + `<td>${pf.toFixed(2)}</td>` + `<td>${pnl.toFixed(0)}</td>` + `<td>${eq1.toFixed(0)}</td>` + `<td>${cnt}</td>` + `<td>${wr.toFixed(1)}</td>` + `<td>${Number.isFinite(rr)? rr.toFixed(2): '—'}</td>` + `<td>${mdd.toFixed(0)}</td>` + `<td style=\\\"white-space:nowrap;\\\"><button class=\\\"btn\\\" data-action=\\\"apply\\\" data-idx=\\\"${idx-1}\\\">Appliquer</button> <button class=\\\"btn\\\" data-action=\\\"view\\\" data-idx=\\\"${idx-1}\\\">Voir</button> <button class=\\\"btn\\\" data-action=\\\"detail\\\" data-idx=\\\"${idx-1}\\\">Détail</button></td>` + '</tr>');
    idx++;
  }
  labTBody.innerHTML = rows.join('');
  if(!labTBody.dataset || labTBody.dataset.wired!=='1'){
    labTBody.addEventListener('click', async (ev)=>{
      const t=ev.target; if(!t || !t.getAttribute) return;
      const act=t.getAttribute('data-action'); if(!act) return;
      const i=parseInt(t.getAttribute('data-idx')||'-1',10);
      // Re-read current sym/TF at click time to avoid stale closures
      const tfNow = labTFSelect? labTFSelect.value : (intervalSelect? intervalSelect.value:'');
      const symNow = currentSymbol;
      // Use the same sorted order as rendered
      const w=getWeights(localStorage.getItem('labWeightsProfile')||'balancee');
      const base = Array.isArray(window.labPalmaresCache)? window.labPalmaresCache.slice() : [];
      const cur=base.slice().sort((a,b)=> (b.score||scoreResult(b.res||{},w)) - (a.score||scoreResult(a.res||{},w)));
      if(!(i>=0 && i<cur.length)) return;
      const rec=cur[i]||{};
      if(act==='apply'){
        const p=rec.params||{};
        lbcOpts.nol=(p.nol!=null)?p.nol:lbcOpts.nol;
        lbcOpts.prd=(p.prd!=null)?p.prd:lbcOpts.prd;
        if(p.slInitPct!=null) lbcOpts.slInitPct=p.slInitPct;
        if(p.beAfterBars!=null) lbcOpts.beAfterBars=p.beAfterBars;
        if(p.beLockPct!=null) lbcOpts.beLockPct=p.beLockPct;
        if(p.emaLen!=null) lbcOpts.emaLen=p.emaLen;
        if(p.tp1R!=null) lbcOpts.tp1R=p.tp1R;
        if(p.entryMode) lbcOpts.entryMode=p.entryMode;
        if(p.useFibRet!=null) lbcOpts.useFibRet=!!p.useFibRet;
        if(p.useFibDraw!=null) lbcOpts.useFibDraw=!!p.useFibDraw;
        if(p.confirmMode) lbcOpts.confirmMode=p.confirmMode;
        if(p.ent382!=null) lbcOpts.ent382=!!p.ent382;
        if(p.ent500!=null) lbcOpts.ent500=!!p.ent500;
        if(p.ent618!=null) lbcOpts.ent618=!!p.ent618;
        if(p.ent786!=null) lbcOpts.ent786=!!p.ent786;
        if(p.tpEnable!=null) lbcOpts.tpEnable=!!p.tpEnable;
        if(p.tpAfterHit) lbcOpts.tpAfterHit=p.tpAfterHit;
        if(p.tpCompound!=null) lbcOpts.tpCompound=!!p.tpCompound;
        if(p.tpCloseAllLast!=null) lbcOpts.tpCloseAllLast=!!p.tpCloseAllLast;
        if(Array.isArray(p.tp)) lbcOpts.tp=p.tp;
        if(p.slEnable!=null) lbcOpts.slEnable=!!p.slEnable;
        if(Array.isArray(p.sl)) lbcOpts.sl=p.sl.slice(0,10);
        saveLBCOpts();
        if(nolEl) nolEl.value=String(lbcOpts.nol);
        if(optNol) optNol.value=String(lbcOpts.nol);
        if(optPrd) optPrd.value=String(lbcOpts.prd);
        if(optSLInitPct) optSLInitPct.value=String(lbcOpts.slInitPct);
        if(optBEBars) optBEBars.value=String(lbcOpts.beAfterBars);
        if(optBELockPct) optBELockPct.value=String(lbcOpts.beLockPct);
        if(optEMALen) optEMALen.value=String(lbcOpts.emaLen);
        const eM=document.getElementById('optEntryMode'); if(eM) eM.value=lbcOpts.entryMode;
        const ufR=document.getElementById('optUseFibRet'); if(ufR) ufR.checked=!!lbcOpts.useFibRet;
        const ufD=document.getElementById('optUseFibDraw'); if(ufD) ufD.checked=!!lbcOpts.useFibDraw;
        const cM=document.getElementById('optConfirmMode'); if(cM) cM.value=lbcOpts.confirmMode;
        if(optEnt382) optEnt382.checked=!!lbcOpts.ent382;
        if(optEnt500) optEnt500.checked=!!lbcOpts.ent500;
        if(optEnt618) optEnt618.checked=!!lbcOpts.ent618;
        if(optEnt786) optEnt786.checked=!!lbcOpts.ent786;
        const tpEn=document.getElementById('optTPEnable'); if(tpEn) tpEn.checked=!!lbcOpts.tpEnable;
        const tpAH=document.getElementById('optTPAfterHit'); if(tpAH) tpAH.value=lbcOpts.tpAfterHit||'be';
        const tpC=document.getElementById('optTPCompound'); if(tpC) tpC.checked=!!lbcOpts.tpCompound;
        const tpAL=document.getElementById('optTPAllLast'); if(tpAL) tpAL.checked=!!lbcOpts.tpCloseAllLast;
        const __optSLEnable=document.getElementById('optSLEnable'); if(__optSLEnable) __optSLEnable.checked=!!lbcOpts.slEnable;
        try{ populateHeavenModal(); }catch(_){ }
        renderLBC(); setStatus('Paramètres appliqués depuis Lab');
      } else if(act==='view'){
        showStrategyResult(rec.res||{}, {symbol: currentSymbol, tf: tfNow});
      } else if(act==='detail'){
        try{ await showStrategyDetail(rec, { symbol: currentSymbol, tf: tfNow }); }catch(_){ }
      }
    });
    labTBody.dataset.wired='1';
  }
}


/* Chart BTC/USDC avec Lightweight Charts + données Binance + UI Heaven/Lab/Backtest/EMA (restauré) */

// --- Elements de base ---
let container = document.getElementById('chart');
if(!container){ try{ const el=document.createElement('div'); el.id='chart'; el.style.width='100%'; el.style.height='calc(100vh - 100px)'; document.body.appendChild(el); container = el; }catch(_){ /* fallback */ } }
const intervalSelect = document.getElementById('interval');
const symbolSelect = document.getElementById('symbol');
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
function exportEvalsCSV(){ try{ const arr=Array.isArray(__lastLabTested)? __lastLabTested: []; if(!arr.length){ setStatus('Aucune évaluation'); return; } let csv='score,pf,totalPnl,trades,winrate,avgRR,nol,prd,slInitPct,beAfterBars,beLockPct,emaLen,entryMode,useFibRet,confirmMode,ent382,ent500,ent618,ent786,tpEnable,slEnable,tp_json,sl_json\\n'; for(const it of arr){ const st=it.metrics||it.res||{}; const p=it.params||{}; const tp=Array.isArray(p.tp)? JSON.stringify(p.tp).replaceAll(',', ';') : ''; const sl=Array.isArray(p.sl)? JSON.stringify(p.sl).replaceAll(',', ';') : ''; csv+=`${(Number.isFinite(it.score)? it.score.toFixed(2):'')},${st.profitFactor||''},${st.totalPnl||''},${st.tradesCount||''},${st.winrate||''},${st.avgRR||''},${p.nol||''},${p.prd||''},${p.slInitPct||''},${p.beAfterBars||''},${p.beLockPct||''},${p.emaLen||''},${p.entryMode||''},${p.useFibRet??''},${p.confirmMode||''},${p.ent382??''},${p.ent500??''},${p.ent618??''},${p.ent786??''},${p.tpEnable??''},${p.slEnable??''},\"${tp}\",\"${sl}\"\\n`; }
  const blob=new Blob([csv], {type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`evals_${currentSymbol}_${(labTFSelect&&labTFSelect.value)||currentInterval}.csv`; a.click(); }catch(_){ }
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
  timeScale: { borderColor: isDark() ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)', timeVisible: true },
});
const candleSeries = chart.addCandlestickSeries({ upColor:'#26a69a', downColor:'#ef5350', borderUpColor:'#26a69a', borderDownColor:'#ef5350', wickUpColor:'#26a69a', wickDownColor:'#ef5350' });
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
try{ chart.timeScale().subscribeVisibleTimeRangeChange(()=>{ try{ updateMkPositions(); }catch(_){ } }); }catch(_){ }

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
        let vr=null; try{ vr=chart.timeScale().getVisibleRange(); }catch(_){ }
        try{ candleSeries.setData(candles); updateEMAs(); renderLBC(); }catch(_){ }
        try{ if(vr){ chart.timeScale().setVisibleRange(vr); } }catch(_){ }
        lastUiUpdate = now;
      }
      if(batch.length < need) break; // hit API boundary for now
      // Yield to UI
      await new Promise(r=> setTimeout(r, 0));
    }
    // Final push if still active: save cache, rehydrate series, preserve view, clear status
    if(token === __bgLoadToken){
      let vr=null; try{ vr=chart.timeScale().getVisibleRange(); }catch(_){ }
      try{ candleSeries.setData(candles); updateEMAs(); renderLBC(); }catch(_){ }
      try{ if(vr){ chart.timeScale().setVisibleRange(vr); } }catch(_){ }
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
      chart.timeScale().fitContent();
      updateEMAs(); renderLBC();
    } else {
      setStatus('Chargement...');
    }
    // Ensure preload fetch (fresh)
    candles = await fetchAllKlines(symbol, interval, PRELOAD_BARS);
    candleSeries.setData(candles);
    chart.timeScale().fitContent();
    setStatus('');
    updateEMAs(); renderLBC();
    try{ saveKlinesToCache(symbol, interval, candles); }catch(_){ }
    // Deep background extend to maximize history depth for Lab/Backtest
    backgroundExtendKlines(symbol, interval, token);
  }catch(e){ setStatus('Erreur chargement'); }
}

if(intervalSelect){ intervalSelect.addEventListener('change', ()=>{ currentInterval=intervalSelect.value; try{ localStorage.setItem('chart:tf', currentInterval); }catch(_){} updateWatermark(); closeWs(); load(currentSymbol, currentInterval).then(()=> openWs(currentSymbol, currentInterval)); }); }
if(symbolSelect){ symbolSelect.addEventListener('change', ()=>{ currentSymbol=symbolSelect.value; updateTitle(currentSymbol); updateWatermark(); closeWs(); load(currentSymbol, currentInterval).then(()=> openWs(currentSymbol, currentInterval)); }); }
if(gotoEndBtn){ gotoEndBtn.addEventListener('click', ()=>{ try{ chart.timeScale().scrollToRealTime(); }catch(_){ } }); }
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

function openModalEl(el){ if(!el) return; el.classList.remove('hidden'); el.setAttribute('aria-hidden','false'); try{ const z=String(bumpModalZ()); el.style.zIndex = z; const c=el.querySelector && el.querySelector('.modal-content'); if(c){ c.style.zIndex = String(bumpModalZ()); } }catch(_){ } }
function closeModalEl(el){ if(!el) return; el.classList.add('hidden'); el.setAttribute('aria-hidden','true'); }
if(liveOpenBtn&&liveModalEl) liveOpenBtn.addEventListener('click', ()=>{ try{ populateLiveWalletsUI(); }catch(_){ } openModalEl(liveModalEl); }); if(liveCloseBtn&&liveModalEl) liveCloseBtn.addEventListener('click', ()=> closeModalEl(liveModalEl)); if(liveModalEl) liveModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close) closeModalEl(liveModalEl); });
if(labOpenBtn&&labModalEl) labOpenBtn.addEventListener('click', ()=>{ try{ renderLabFromStorage(); }catch(_){ } openModalEl(labModalEl); }); if(labCloseBtn&&labModalEl) labCloseBtn.addEventListener('click', ()=> closeModalEl(labModalEl)); if(labModalEl) labModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close) closeModalEl(labModalEl); });

if(btOpenBtn&&btModalEl) btOpenBtn.addEventListener('click', ()=> openModalEl(btModalEl)); if(btCloseBtn&&btModalEl) btCloseBtn.addEventListener('click', ()=> closeModalEl(btModalEl)); if(btModalEl) btModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close) closeModalEl(btModalEl); });
if(heavenCfgBtn&&lbcModalEl) heavenCfgBtn.addEventListener('click', ()=>{ try{ populateHeavenModal(); }catch(_){ } openModalEl(lbcModalEl); }); if(lbcCloseBtn&&lbcModalEl) lbcCloseBtn.addEventListener('click', ()=> closeModalEl(lbcModalEl)); if(lbcModalEl) lbcModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close) closeModalEl(lbcModalEl); });

// --- Heaven overlay (Line Break + ZigZag + options) ---
const emaToggleEl = document.getElementById('emaToggle'); const nolEl=document.getElementById('nolInput'); const toggleLBCEl=document.getElementById('toggleLBC');
const defaultLBC={ enabled:true, nol:3, prd:15, showTrend:true, trendUpColor:'#00ff00', trendDnColor:'#ff0000', showClose:true, showArrows:true, arrowOffsetPx:8, arrowSizePx:12, useZZDraw:true, zzUp:'#00ff00', zzDn:'#ff0000', useFibDraw:true, useFibRet:false, entryMode:'Both', confirmMode:'Bounce', ent382:true, ent500:true, ent618:true, ent786:false, slInitPct:2.0, slEnable:false, sl:[], tp1R:1.0, tpAfterHit:'be', tpCompound:true, tpCloseAllLast:true, beEnable:true, beAfterBars:5, beLockPct:5.0, emaLen:55, tpEnable:true, tp:[] };
let lbcOpts = (()=>{ try{ const s=localStorage.getItem('lbcOptions'); return s? { ...defaultLBC, ...JSON.parse(s) } : { ...defaultLBC }; }catch(_){ return { ...defaultLBC }; } })();
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
  const optTPAfterHit=document.getElementById('optTPAfterHit'); if(optTPAfterHit) optTPAfterHit.value=lbcOpts.tpAfterHit||'be';
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
  function updateTPRow(i, t){ const tSel=document.getElementById(`optTP${i}Type`); const vNum=document.getElementById(`optTP${i}R`); const vFib=document.getElementById(`optTP${i}Fib`); const vEma=document.getElementById(`optTP${i}Ema`); if(!tSel) return; const typ=tSel.value||'Fib'; // show/hide
    if(vNum) vNum.style.display = (typ==='Percent')? '' : 'none'; if(vFib) vFib.style.display = (typ==='Fib')? '' : 'none'; if(vEma) vEma.style.display = (typ==='EMA')? '' : 'none'; if(typ==='Fib'){ rebuildFibSelect(vFib, (t&&t.fib!=null)? t.fib : (vFib&&vFib.value)); }
    else if(typ==='EMA'){ rebuildEmaSelect(vEma, (t&&t.emaLen!=null)? t.emaLen : (vEma&&vEma.value)); } }
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
    updateTPRow(i, t);
    if(tSel && (!tSel.dataset || tSel.dataset.wired!=='1')){ tSel.addEventListener('change', ()=> updateTPRow(i, arr[i-1]||{})); if(!tSel.dataset) tSel.dataset={}; tSel.dataset.wired='1'; }
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
if(toggleLBCEl) toggleLBCEl.addEventListener('change', ()=>{ lbcOpts.enabled=!!toggleLBCEl.checked; saveLBCOpts(); renderLBC(); });
if(nolEl) nolEl.addEventListener('change', ()=>{ lbcOpts.nol=Math.max(1, parseInt(nolEl.value||'3')); saveLBCOpts(); renderLBC(); });
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
if(lbcSaveBtn){ lbcSaveBtn.addEventListener('click', ()=>{ if(optEnabled) lbcOpts.enabled=!!optEnabled.checked; if(optNol) lbcOpts.nol = Math.max(1, parseInt(optNol.value||String(lbcOpts.nol))); if(optShowTrend) lbcOpts.showTrend = !!optShowTrend.checked; if(optTrendUp) lbcOpts.trendUpColor = optTrendUp.value||lbcOpts.trendUpColor; if(optTrendDn) lbcOpts.trendDnColor = optTrendDn.value||lbcOpts.trendDnColor; if(optUseZZDraw) lbcOpts.useZZDraw = !!optUseZZDraw.checked; if(optPrd) lbcOpts.prd = Math.max(2, parseInt(optPrd.value||String(lbcOpts.prd))); if(optSLInitPct) lbcOpts.slInitPct = Math.max(0, parseFloat(optSLInitPct.value||String(lbcOpts.slInitPct))); if(optSLEnable) lbcOpts.slEnable=!!optSLEnable.checked; if(optBEEnable) lbcOpts.beEnable=!!optBEEnable.checked; if(optBEBars) lbcOpts.beAfterBars=Math.max(1, parseInt(optBEBars.value||String(lbcOpts.beAfterBars))); if(optBELockPct) lbcOpts.beLockPct=Math.max(0, parseFloat(optBELockPct.value||String(lbcOpts.beLockPct))); if(optEMALen) lbcOpts.emaLen=Math.max(1, parseInt(optEMALen.value||String(lbcOpts.emaLen))); if(optShowClose) lbcOpts.showClose=!!optShowClose.checked; const optShowArrows=document.getElementById('optShowArrows'); if(optShowArrows) lbcOpts.showArrows=!!optShowArrows.checked; const optUseFibDraw=document.getElementById('optUseFibDraw'); const optUseFibRet=document.getElementById('optUseFibRet'); const optConfirmMode=document.getElementById('optConfirmMode'); const optZZUp=document.getElementById('optZZUp'); const optZZDn=document.getElementById('optZZDn'); const optTPEnable=document.getElementById('optTPEnable'); const optTPAfterHit=document.getElementById('optTPAfterHit'); const optTPCompound=document.getElementById('optTPCompound'); const optTPAllLast=document.getElementById('optTPAllLast'); if(optUseFibDraw) lbcOpts.useFibDraw=!!optUseFibDraw.checked; if(optUseFibRet) lbcOpts.useFibRet=!!optUseFibRet.checked; if(optEntryMode) lbcOpts.entryMode=optEntryMode.value||lbcOpts.entryMode; if(optConfirmMode) lbcOpts.confirmMode=optConfirmMode.value||lbcOpts.confirmMode; if(optEnt382) lbcOpts.ent382=!!optEnt382.checked; if(optEnt500) lbcOpts.ent500=!!optEnt500.checked; if(optEnt618) lbcOpts.ent618=!!optEnt618.checked; if(optEnt786) lbcOpts.ent786=!!optEnt786.checked; if(optZZUp) lbcOpts.zzUp=optZZUp.value||lbcOpts.zzUp; if(optZZDn) lbcOpts.zzDn=optZZDn.value||lbcOpts.zzDn; if(optTPEnable) lbcOpts.tpEnable=!!optTPEnable.checked; if(optTPAfterHit) lbcOpts.tpAfterHit=optTPAfterHit.value||lbcOpts.tpAfterHit; if(optTPCompound) lbcOpts.tpCompound=!!optTPCompound.checked; if(optTPAllLast) lbcOpts.tpCloseAllLast=!!optTPAllLast.checked; const tpArr=[]; for(let i=1;i<=10;i++){ const tSel=document.getElementById(`optTP${i}Type`); if(!tSel) continue; const typ=tSel.value||'Fib'; const vNum=document.getElementById(`optTP${i}R`); const vFib=document.getElementById(`optTP${i}Fib`); const vEma=document.getElementById(`optTP${i}Ema`); const pPct=document.getElementById(`optTP${i}P`); const qPct=document.getElementById(`optTP${i}Qty`); const entry={ type:typ }; if(typ==='Fib'){ const r=parseFloat(((vFib && vFib.value) || (vNum && vNum.value) || '')); if(isFinite(r)) { entry.fib=r; } else { continue; } } else if(typ==='Percent'){ const p=parseFloat(((vNum && vNum.value) || (vFib && vFib.value) || '')); if(isFinite(p)) { entry.pct=p; } else { continue; } } else if(typ==='EMA'){ const len=parseInt(((vEma && vEma.value) || (optEMALen && optEMALen.value) || ''),10); if(isFinite(len) && len>0){ entry.emaLen=len; } }
    if(qPct && qPct.value!==''){ const qv=parseFloat(qPct.value); if(isFinite(qv)) entry.qty=qv; } tpArr.push(entry); } lbcOpts.tp = tpArr; const slArr=[]; for(let i=1;i<=10;i++){ const tSel=document.getElementById(`optSL${i}Type`); if(!tSel) continue; const typ=tSel.value||'Percent'; const vNum=document.getElementById(`optSL${i}R`); const vFib=document.getElementById(`optSL${i}Fib`); const vEma=document.getElementById(`optSL${i}Ema`); const slEntry={ type:typ }; if(typ==='Fib'){ const r=parseFloat(((vFib && vFib.value) || (vNum && vNum.value) || '')); if(isFinite(r)) { slEntry.fib=r; } else { continue; } } else if(typ==='Percent'){ const p=parseFloat(((vNum && vNum.value) || (vFib && vFib.value) || '')); if(isFinite(p)) { slEntry.pct=p; } else { continue; } } else if(typ==='EMA'){ const len=parseInt(((vEma && vEma.value) || (optEMALen && optEMALen.value) || ''),10); if(isFinite(len) && len>0){ slEntry.emaLen=len; } } slArr.push(slEntry); } lbcOpts.sl = slArr; saveLBCOpts(); renderLBC(); closeModalEl(lbcModalEl); }); }

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
  const emaTrail = (lbcOpts.tpAfterHit==='ema') ? emaCalc(candles, Math.max(1, lbcOpts.emaLen|0)) : null;
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
      for(const t of lbcOpts.tp){
        let price=null; const typ=(t.type||'Fib');
        if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B + move*r) : (B - move*r); }
        else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1+p/100)) : (entry*(1-p/100)); }
        else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; }
        if(price!=null){ if((dir==='long' && price>entry) || (dir==='short' && price<entry)){
            let w=null; const q=t.qty; if(q!=null && isFinite(q)){ w = (q>1? q/100 : q); }
            list.push({price, w});
        } }
      }
      if(dir==='long') list.sort((a,b)=>a.price-b.price); else list.sort((a,b)=>b.price-a.price);
      let sumW=0, hasW=false; for(const it of list){ if(it.w!=null && it.w>0){ sumW+=it.w; hasW=true; } }
      if(!hasW){ if(list.length){ const even=1/list.length; list=list.map(it=>({ price:it.price, w:even })); } else { list=[{price: (dir==='long'? entry + riskAbs*(lbcOpts.tp1R||1) : entry - riskAbs*(lbcOpts.tp1R||1)), w:1}]; } }
      else { if(sumW>1){ const k=1/sumW; for(const it of list){ if(it.w!=null) it.w*=k; } } else if(lbcOpts.tpCloseAllLast && sumW<1 && list.length){ list[list.length-1].w = (list[list.length-1].w||0) + (1-sumW); } }
      return list;
    } else {
      return [{ price: dir==='long'? (entry + riskAbs*(lbcOpts.tp1R||1)) : (entry - riskAbs*(lbcOpts.tp1R||1)), w:1 }];
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
            pos={ dir, entry, sl, initSL:sl, qty:initQty, initQty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets, risk: Math.abs(entry-sl)*initQty };
          }
        }
      }
      if(!pos && lbcOpts.useFibRet && (lbcOpts.entryMode!=='Original') && pendingFib && pendingFib.levels && pendingFib.levels.length){
        for(const lv of pendingFib.levels){
          let ok=false;
          if(pendingFib.dir==='long') ok=(pendingFib.mode==='Touch')? (bar.low<=lv) : (bar.low<=lv && bar.close>lv);
          else ok=(pendingFib.mode==='Touch')? (bar.high>=lv) : (bar.high>=lv && bar.close<lv);
          if(ok){ const dir=pendingFib.dir; const entry=bar.close; let sl=computeSLFromLadder(dir, entry, i); if(sl==null){ const riskPx=entry*(lbcOpts.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; } const initQty=__computeQty(entry, sl); if(initQty>1e-12 && isFinite(initQty)){ const targets=buildTargets(dir, entry, Math.abs(entry-sl), i); pos={ dir, entry, sl, initSL:sl, qty:initQty, initQty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets, risk: Math.abs(entry-sl)*initQty }; pendingFib=null; break; } }
        }
      }
    } else {
      if(lbcOpts.beEnable && !pos.beActive && (i - pos.entryIdx) >= lbcOpts.beAfterBars){ const movePct = pos.dir==='long'? ((bar.high - pos.entry)/pos.entry*100) : ((pos.entry - bar.low)/pos.entry*100); if(movePct >= lbcOpts.beLockPct){ pos.beActive=true; pos.sl = pos.entry; } }
      if(pos.anyTP && lbcOpts.tpAfterHit==='ema' && emaTrail){ const v=emaTrail[Math.min(i, emaTrail.length-1)]; if(isFinite(v)){ if(pos.dir==='long') pos.sl=Math.max(pos.sl, v); else pos.sl=Math.min(pos.sl, v); } }
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
          const exitPx = tp.price; const pnl = (pos.dir==='long'? (exitPx - pos.entry) : (pos.entry - exitPx)) * usedQty; const fees = (pos.entry*usedQty + exitPx*usedQty) * feePct; const net = pnl - fees;
          equity += net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0) rrSum += (net/pos.risk);
          if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; }
          if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd;
          trades.push({ dir:pos.dir, entryTime:candles[pos.entryIdx].time, entry:pos.entry, initSL:pos.initSL, exitTime:candles[i].time, exit:exitPx, reason:`TP${pos.tpIdx+1}`, qty:usedQty, pnl, fees, net, rr: (Math.abs(pos.entry-pos.initSL)*usedQty>0? net/(Math.abs(pos.entry-pos.initSL)*usedQty) : null) });
          try{ addTPHitMarker(candles[i].time, pos.dir); }catch(_){ }
          pos.qty -= usedQty; pos.anyTP=true;
          if(lbcOpts.tpAfterHit==='be'){ pos.sl = pos.entry; }
          else if(lbcOpts.tpAfterHit==='prev'){ if(pos.dir==='long') pos.sl=Math.max(pos.sl, exitPx); else pos.sl=Math.min(pos.sl, exitPx); }
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
  function buildTargets(dir, entry, riskAbs, i){
    const tps=[];
    if(params.tpEnable && Array.isArray(params.tp) && params.tp.length){
      const seg=segAtIdx(); const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null;
      for(const t of params.tp){ let price=null; const typ=(t.type||'Fib');
        if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)){ price = (seg.dir==='up')? (B + move*r) : (B - move*r); } }
        else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)){ price = dir==='long'? (entry*(1+p/100)) : (entry*(1-p/100)); } }
        else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (params.emaLen||55)),10)); let ema=emaTargetCache.get(len); if(!ema){ ema=emaCalc(bars, len); emaTargetCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; }
        if(price!=null){ if((dir==='long' && price>entry) || (dir==='short' && price<entry)){ tps.push(price); } }
      }
      if(dir==='long') tps.sort((a,b)=>a-b); else tps.sort((a,b)=>b-a);
    } else {
      const mult=(typeof params.tp1R==='number' && params.tp1R>0)? params.tp1R : 1; const price=dir==='long'? (entry + riskAbs*mult) : (entry - riskAbs*mult); tps.push(price);
    }
    return tps;
  }
  let equity=conf.startCap; let peak=equity; let maxDDAbs=0; let grossProfit=0, grossLoss=0; let wins=0, losses=0; let rrSum=0; let tradesCount=0;
  let pos=null; let pendingFib=null; const trades = collect? []: null; const eqPts = collect? []: null;
  const feePct=conf.fee/100; const maxPct=conf.maxPct/100; const lev=conf.lev; const baseMode=conf.base;
  function __computeQty(entry, sl){ if(!(isFinite(entry)&&isFinite(sl))) return 0; if(equity<=0) return 0; const capBase=(baseMode==='equity')?equity:conf.startCap; const budget=Math.max(0, Math.min(capBase*maxPct, equity)); const notional=budget*lev; const qty0=notional/Math.max(1e-12, entry); const riskAbs=Math.abs(entry-sl); const perUnitWorstLoss = riskAbs + ((Math.abs(entry)+Math.abs(sl)) * feePct); const qtyRisk = perUnitWorstLoss>0? (equity / perUnitWorstLoss) : 0; const q=Math.max(0, Math.min(qty0, qtyRisk)); return q; }
  for(let i=Math.max(1,sIdx); i<=eIdx; i++){
    if(btAbort) break; if(equity<=0) break;
    const bar=bars[i]; const trendNow=lb.trend[i]; const trendPrev=lb.trend[i-1];
    if(eqPts){ eqPts.push({ time: bar.time, equity }); }
    advancePivotIdxTo(i);
    if(!pos){
      if(trendNow!==trendPrev){
        const seg=segAtIdx(); if(seg){ const A=seg.a.price, B=seg.b.price; const up=seg.dir==='up'; const move=Math.abs(B-A); const levels=[]; if(params.ent382) levels.push(up? (B - move*0.382) : (B + move*0.382)); if(params.ent500) levels.push(up? (B - move*0.5) : (B + move*0.5)); if(params.ent618) levels.push(up? (B - move*0.618) : (B + move*0.618)); if(params.ent786) levels.push(up? (B - move*0.786) : (B + move*0.786)); pendingFib={ dir:(trendNow===1?'long':'short'), levels, mode: params.confirmMode||'Bounce' }; }
        if(params.entryMode!=='Fib Retracement'){
          const dir=(trendNow===1)?'long':'short'; const entry=bar.close; let sl=computeSLFromLadder(dir, entry, i); if(sl==null){ const riskPx=entry*(params.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; }
          const qty=__computeQty(entry, sl);
          if(qty>1e-12 && isFinite(qty)){ const targets=buildTargets(dir, entry, Math.abs(entry-sl), i); pos={ dir, entry, sl, qty, entryIdx:i, beActive:false, risk: Math.abs(entry-sl)*qty, targets }; }
        }
      }
      if(!pos && params.useFibRet && (params.entryMode!=='Original') && pendingFib && pendingFib.levels && pendingFib.levels.length){
        for(const lv of pendingFib.levels){ let ok=false; if(pendingFib.dir==='long'){ ok=(pendingFib.mode==='Touch')? (bar.low<=lv) : (bar.low<=lv && bar.close>lv); } else { ok=(pendingFib.mode==='Touch')? (bar.high>=lv) : (bar.high>=lv && bar.close<lv); }
          if(ok){ const dir=pendingFib.dir; const entry=bar.close; let sl=computeSLFromLadder(dir, entry, i); if(sl==null){ const riskPx=entry*(params.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; } const qty=__computeQty(entry, sl); if(qty>1e-12 && isFinite(qty)){ const targets=buildTargets(dir, entry, Math.abs(entry-sl), i); pos={ dir, entry, sl, qty, entryIdx:i, beActive:false, risk: Math.abs(entry-sl)*qty, targets }; pendingFib=null; break; } }
        }
      }
    } else {
      if(params.beEnable && !pos.beActive && (i - pos.entryIdx) >= params.beAfterBars){ const movePct = pos.dir==='long'? ((bar.high - pos.entry)/pos.entry*100) : ((pos.entry - bar.low)/pos.entry*100); if(movePct >= params.beLockPct){ pos.beActive=true; pos.sl = pos.entry; } }
      { const sl2=computeSLFromLadder(pos.dir, pos.entry, i); if(sl2!=null){ let b=sl2; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(sl2, pos.entry) : Math.max(sl2, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }
      let exit=null;
      if(pos.dir==='long'){
        if(bar.low <= pos.sl){ exit = pos.sl; }
        else if(pos.targets && pos.targets.length && bar.high >= pos.targets[0]){ exit = pos.targets[0]; }
        else if(trendNow!==trendPrev && trendNow!==1){ exit = bar.close; }
      } else {
        if(bar.high >= pos.sl){ exit = pos.sl; }
        else if(pos.targets && pos.targets.length && bar.low <= pos.targets[0]){ exit = pos.targets[0]; }
        else if(trendNow!==trendPrev && trendNow!==-1){ exit = bar.close; }
      }
      if(exit!=null){ const eqBefore=equity; const pnl = (pos.dir==='long'? (exit - pos.entry) : (pos.entry - exit)) * pos.qty; const fees = (pos.entry*pos.qty + exit*pos.qty) * feePct; const net = pnl - fees; equity += net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0){ rrSum += (net/pos.risk); } if(net>=0){ grossProfit += net; wins++; } else { grossLoss += net; losses++; } if(equity>peak){ peak=equity; } const dd = peak - equity; if(dd>maxDDAbs){ maxDDAbs=dd; } if(trades){ trades.push({ dir:pos.dir, entryTime:bars[pos.entryIdx].time, entry:pos.entry, exitTime:bars[i].time, exit, qty:pos.qty, net, fees, rr: (pos.risk>0? net/pos.risk:null), eqBefore }); } pos=null; }
    }
    if(btProgBar && btProgText){ const p = Math.round((i - sIdx) / Math.max(1, (eIdx - sIdx)) * 100); if(p%5===0){ btProgBar.style.width = p+'%'; btProgText.textContent = `Optimisation ${p}%`; } }
  }
  if(eqPts){ eqPts.push({ time: bars[Math.min(eIdx, bars.length-1)].time, equity }); }
  const res = { equityFinal: equity, totalPnl: equity - conf.startCap, tradesCount: tradesCount, winrate: tradesCount? (wins/tradesCount*100):0, avgRR: tradesCount? (rrSum/tradesCount):0, profitFactor: (grossLoss<0? (grossProfit/Math.abs(grossLoss)) : (tradesCount? Infinity:0)), maxDDAbs };
  if(trades) res.trades = trades;
  if(eqPts) res.eqSeries = eqPts;
  return res;
}
if(btCancelBtn){ btCancelBtn.addEventListener('click', ()=> closeModalEl(btModalEl)); }
if(btAbortBtn){ btAbortBtn.addEventListener('click', ()=>{ btAbort=true; setStatus('Simulation annulée'); closeBtProgress(); }); }
// Pause/Stop controls + details actions inside progress popup
try{
  const btPauseBtn2=document.getElementById('btPause');
  const btStopBtn2=document.getElementById('btStop');
  const btShowDetails=document.getElementById('btShowDetails');
  const btExportDetails=document.getElementById('btExportDetails');
  if(btPauseBtn2){ btPauseBtn2.addEventListener('click', ()=>{ btPaused=!btPaused; addBtLog(btPaused?'Pause':'Reprise'); if(labRunStatusEl) labRunStatusEl.textContent = btPaused? 'Pause' : 'En cours'; btPauseBtn2.textContent = btPaused? 'Reprendre' : 'Pause'; }); }
  if(btStopBtn2){ btStopBtn2.addEventListener('click', ()=>{ btAbort=true; addBtLog('Arrêt demandé'); if(labRunStatusEl) labRunStatusEl.textContent='Arrêt'; }); }
  if(btShowDetails){ btShowDetails.addEventListener('click', ()=> openEvalsModal(currentSymbol, (labTFSelect&&labTFSelect.value)||currentInterval)); }
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
    if(done<total && !btAbort){ setTimeout(()=> step(end), 0); } else { closeBtProgress(); closeModalEl(btModalEl); try{ await renderLabFromStorage(); }catch(_){ } setStatus('Optimisation terminée'); }
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
if(detailClose){ detailClose.addEventListener('click', ()=> closeModalEl(detailModalEl)); }
if(detailModalEl){ detailModalEl.addEventListener('click', (e)=>{ const t=e.target; if(t&&t.dataset&&t.dataset.close){ closeModalEl(detailModalEl); } }); }

function __drawText(ctx, x, y, txt, align='left'){ ctx.save(); ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg')||'#111827'; ctx.font='12px Segoe UI, Arial'; ctx.textAlign=align; ctx.textBaseline='middle'; ctx.fillText(txt, x, y); ctx.restore(); }
function __clr(){ const cs=getComputedStyle(document.documentElement); return { fg: cs.getPropertyValue('--fg')||'#111827', muted: cs.getPropertyValue('--muted')||'#6b7280', border: cs.getPropertyValue('--header-border')||'#e5e7eb' }; }
function drawRadar(canvas, labels, vals){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); const cx=w/2, cy=h/2+10, R=Math.min(w,h)/2-30; const n=labels.length; ctx.strokeStyle=__clr().border; ctx.lineWidth=1; for(let r=0;r<=4;r++){ const rr=R*(r/4); ctx.beginPath(); for(let k=0;k<n;k++){ const ang = -Math.PI/2 + 2*Math.PI*k/n; const x=cx+rr*Math.cos(ang), y=cy+rr*Math.sin(ang); if(k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); } ctx.closePath(); ctx.stroke(); }
  for(let k=0;k<n;k++){ const ang=-Math.PI/2 + 2*Math.PI*k/n; const x=cx+(R+10)*Math.cos(ang), y=cy+(R+10)*Math.sin(ang); __drawText(ctx, x, y, labels[k], (Math.cos(ang)>0?'left':(Math.cos(ang)<0?'right':'center'))); }
  ctx.beginPath(); for(let k=0;k<n;k++){ const v=Math.max(0,Math.min(100, vals[k]||0))/100; const ang=-Math.PI/2 + 2*Math.PI*k/n; const x=cx+R*v*Math.cos(ang), y=cy+R*v*Math.sin(ang); if(k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); } ctx.closePath(); ctx.fillStyle='rgba(37,99,235,0.25)'; ctx.strokeStyle='#2563eb'; ctx.lineWidth=2; ctx.fill(); ctx.stroke(); }
function drawEquity(canvas, eq){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); if(!eq||!eq.length) return; const min=Math.min(...eq.map(p=>p.equity)); const max=Math.max(...eq.map(p=>p.equity)); const x=(i)=> i/(eq.length-1)*(w-40)+20; const y=(v)=> h-20 - (v-min)/(max-min+1e-9)*(h-40); let peak=-Infinity; ctx.fillStyle='rgba(239,68,68,0.15)'; ctx.beginPath(); for(let i=0;i<eq.length;i++){ peak=Math.max(peak, eq[i].equity); const dd=peak-eq[i].equity; if(dd>0){ const xx=x(i); ctx.fillRect(xx-1, y(peak), 2, Math.max(0, y(eq[i].equity)-y(peak))); } } ctx.fill(); ctx.strokeStyle='#2563eb'; ctx.lineWidth=2; ctx.beginPath(); for(let i=0;i<eq.length;i++){ const xx=x(i), yy=y(eq[i].equity); if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); } ctx.stroke(); }
function drawDD(canvas, eq){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); if(!eq||!eq.length) return; let peak=-Infinity; const min=0, maxDD=Math.max(1e-9, ...eq.map(p=>{ peak=Math.max(peak, p.equity); return peak-p.equity; })); peak=-Infinity; for(let i=0;i<eq.length;i++){ peak=Math.max(peak, eq[i].equity); const dd=peak-eq[i].equity; const xx=i/(eq.length-1)*(w-40)+20; const hh=(dd/maxDD)*(h-30); ctx.fillStyle='rgba(239,68,68,0.6)'; ctx.fillRect(xx-1, h-10-hh, 2, hh); } __drawText(ctx, 10, 10, 'Drawdowns', 'left'); }
function drawHist(canvas, data){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); if(!data||!data.length) return; const min=Math.min(...data), max=Math.max(...data); const bins=20; const step=(max-min)/(bins||1)||1; const hist=new Array(bins).fill(0); for(const v of data){ let b=Math.floor((v-min)/step); if(b<0) b=0; if(b>=bins) b=bins-1; hist[b]++; } const mcount=Math.max(...hist); for(let i=0;i<bins;i++){ const x=i/bins*(w-40)+20; const hh= (hist[i]/(mcount||1))*(h-30); ctx.fillStyle='#2563eb'; ctx.fillRect(x, h-10-hh, (w-40)/bins-2, hh); } __drawText(ctx, 10, 10, 'Distribution des rendements (%)', 'left'); }
function drawBars(canvas, labels, vals){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); const n=labels.length; for(let i=0;i<n;i++){ const y=20+i*((h-30)/n); const val=Math.max(0,Math.min(100, vals[i]||0)); ctx.fillStyle='#e5e7eb'; ctx.fillRect(120, y, w-140, 12); ctx.fillStyle='#2563eb'; ctx.fillRect(120, y, (w-140)*val/100, 12); __drawText(ctx, 110, y+6, String(val.toFixed(0))+'%', 'right'); __drawText(ctx, 10, y+6, labels[i], 'left'); } }
function drawRobust(canvas, complexity, robustness){ if(!canvas) return; const ctx=canvas.getContext('2d'); const w=canvas.width, h=canvas.height; ctx.clearRect(0,0,w,h); __drawText(ctx, 10, 20, 'Complexité & Robustesse', 'left'); // bars
  const labels=['Complexité (params actifs)','Robustesse (stabilité)']; const vals=[complexity, robustness]; for(let i=0;i<2;i++){ const y=40+i*40; ctx.fillStyle='#e5e7eb'; ctx.fillRect(220, y, w-240, 14); ctx.fillStyle=i===0?'#f59e0b':'#10b981'; ctx.fillRect(220, y, (w-240)*Math.max(0,Math.min(100, vals[i]))/100, 14); __drawText(ctx, 210, y+7, String(Math.round(vals[i]))+'%', 'right'); __drawText(ctx, 10, y+7, labels[i], 'left'); } }

async function showStrategyDetail(item, ctx){ try{ const sym=ctx.symbol, tf=ctx.tf; const p=item.params||{}; const conf={ startCap: Math.max(0, +((document.getElementById('labStartCap')||{}).value||10000)), fee: Math.max(0, +((document.getElementById('labFee')||{}).value||0.1)), lev: Math.max(1, +((document.getElementById('labLev')||{}).value||1)), maxPct:100, base:'initial' };
  let bars=candles; if(tf!==currentInterval){ try{ bars=await fetchAllKlines(sym, tf, 5000); }catch(_){ bars=candles; } }
  const sIdx=Math.max(0, bars.length-Math.min(5000, bars.length)); const eIdx=bars.length-1;
  const res=runBacktestSliceFor(bars, sIdx, eIdx, conf, p, true);
  const eq = (res.eqSeries||[]).map(x=>({ time:x.time, equity:x.equity }));
  // returns per trade
  const rets=[]; let totalDur=0; let minTs=Infinity, maxTs=-Infinity; let wins=0, losses=0; for(const t of (res.trades||[])){ const cap=Math.max(1, t.eqBefore||conf.startCap); rets.push((t.net/cap)*100); if(t.net>=0) wins++; else losses++; totalDur += Math.max(0, (t.exitTime||0)-(t.entryTime||0)); if(Number.isFinite(t.entryTime)&&t.entryTime<minTs) minTs=t.entryTime; if(Number.isFinite(t.exitTime)&&t.exitTime>maxTs) maxTs=t.exitTime; }
  const mean=(arr)=> arr.length? arr.reduce((a,b)=>a+b,0)/arr.length : 0; const m=mean(rets); const sd=Math.sqrt(mean(rets.map(x=> (x-m)*(x-m)))); const sharpe = (sd>0? (m/sd*Math.sqrt(Math.max(1, rets.length))) : 0);
  // Radar metrics (0..100)
  const pf = (res.profitFactor===Infinity? 3 : Math.max(0, Math.min(3, +res.profitFactor||0))); const pfN = (pf/3)*100;
  const sharpeN = Math.max(0, Math.min(100, (sharpe/3)*100));
  const recov = (res.maxDDAbs>0? (res.totalPnl/Math.max(1e-9, res.maxDDAbs)) : 0); const recovN = Math.max(0, Math.min(100, (recov/3)*100));
  const consN = Math.max(0, Math.min(100, 100*(1 - Math.min(1, sd/3))));
  const cpiN = Math.max(0, Math.min(100, 100*(1 - Math.min(1, (res.maxDDAbs/Math.max(1, conf.startCap)) / 0.5))));
  const r2 = (()=>{ const n=eq.length; if(n<3) return 0; const xs=eq.map((_,i)=>i); const ys=eq.map(p=>p.equity); const xm=mean(xs), ym=mean(ys); let num=0, den=0; for(let i=0;i<n;i++){ const xv=xs[i]-xm, yv=ys[i]-ym; num += xv*yv; den += xv*xv; } const a=num/(den||1); const b=ym - a*xm; let ssTot=0, ssRes=0; for(let i=0;i<n;i++){ const y=ys[i]; const yhat=a*xs[i]+b; ssTot += (y-ym)*(y-ym); ssRes += (y-yhat)*(y-yhat); } return 1 - (ssRes/(ssTot||1)); })();
  const r2N = Math.max(0, Math.min(100, r2*100));
  const winrate = +res.winrate||0; const avgRR = +res.avgRR||0; const teN = Math.max(0, Math.min(100, (winrate/100) * (pf/(pf+1))*100));
  const edgeN = Math.max(0, Math.min(100, (pf/(pf+1)) * (1 - Math.min(1, sd/5))*100));
  drawRadar(canRadar, ['Profit Factor','Sharpe','Recovery','Consistency','Cap. Protection','R² equity','Trade Efficiency','Edge Robustness'], [pfN, sharpeN, recovN, consN, cpiN, r2N, teN, edgeN]);
  drawEquity(canEquity, eq);
  drawDD(canDD, eq);
  drawHist(canHist, rets);
  // Efficiency
  const totalSecs=Math.max(1, (maxTs>minTs? (maxTs-minTs) : (bars[eIdx].time-bars[sIdx].time)));
  const days=totalSecs/86400; const freq = (res.tradesCount||0)/(days||1);
  const timeInMkt = Math.max(0, Math.min(100, 100*(totalDur/Math.max(1, totalSecs))));
  const effLabels=['Win Rate','Avg R:R','Trade Efficiency','Time in Market','Trades / jour'];
  const effVals=[winrate, Math.max(0, Math.min(100, (avgRR/2)*100)), teN, timeInMkt, Math.max(0, Math.min(100, (freq/20)*100))];
  drawBars(canEff, effLabels, effVals);
  // Complexity & robustness
  const complexity = (6 + (p.useFibRet?1:0) + (p.confirmMode?1:0) + (Array.isArray(p.tp)? p.tp.length:0)); const compN = Math.max(0, Math.min(100, (complexity/20)*100));
  drawRobust(canRob, compN, edgeN);
  if(detailCtxEl){ detailCtxEl.textContent = `${symbolToDisplay(sym)} • ${tf} — ${item.name||'Stratégie'} — PF ${(res.profitFactor===Infinity?'∞':(+res.profitFactor||0).toFixed(2))} • Trades ${res.tradesCount}`; }
  openModalEl(detailModalEl);
 }catch(_){ setStatus('Erreur analyse'); }
}

// Lab actions: refresh/export/weights
const labExportBtn=document.getElementById('labExport'); const labWeightsBtn=document.getElementById('labWeights'); const labRunNewBtn=document.getElementById('labRunNew');
const weightsModalEl=document.getElementById('weightsModal'); const weightsClose=document.getElementById('weightsClose'); const weightsSave=document.getElementById('weightsSave'); const weightsProfile=document.getElementById('weightsProfile'); const weightsBody=document.getElementById('weightsBody');
if(labTFSelect){ labTFSelect.addEventListener('change', ()=>{ try{ renderLabFromStorage(); }catch(_){ } }); }
if(labRunNewBtn){ labRunNewBtn.addEventListener('click', ()=>{ try{ window.__labGoalOverride='new'; if(labRunBtn){ labRunBtn.click(); } }catch(_){ } }); }
if(labExportBtn){ labExportBtn.addEventListener('click', ()=>{ try{ const tf=(labTFSelect&&labTFSelect.value)||(intervalSelect&&intervalSelect.value)||''; const arr=Array.isArray(window.labPalmaresCache)? window.labPalmaresCache : []; if(!arr.length){ setStatus('Rien à exporter'); return; } let csv='idx,nom,gen,nol,prd,slInitPct,beAfterBars,beLockPct,emaLen,tp1R,entryMode,useFibRet,useFibDraw,confirmMode,ent382,ent500,ent618,ent786,tpEnable,tp,score,profitFactor,totalPnl,equityFinal,tradesCount,winrate,avgRR,maxDDAbs\n'; let idx=1; const weights=getWeights(localStorage.getItem('labWeightsProfile')||'balancee'); for(const r of arr){ const p=r.params||{}; const st=r.res||{}; const tpStr = Array.isArray(p.tp)? JSON.stringify(p.tp).replaceAll(',', ';') : ''; const score = Number.isFinite(r.score)? r.score : scoreResult(st, weights); csv+=`${idx},\"${r.name||''}\",${r.gen||1},${p.nol||''},${p.prd||''},${p.slInitPct||''},${p.beAfterBars||''},${p.beLockPct||''},${p.emaLen||''},${p.tp1R||''},${p.entryMode||''},${p.useFibRet??''},${p.useFibDraw??''},${p.confirmMode||''},${p.ent382??''},${p.ent500??''},${p.ent618??''},${p.ent786??''},${p.tpEnable??''},\"${tpStr}\",${score.toFixed(2)},${st.profitFactor||''},${st.totalPnl||''},${st.equityFinal||''},${st.tradesCount||''},${st.winrate||''},${st.avgRR||''},${st.maxDDAbs||''}\\n`; idx++; } const blob=new Blob([csv], {type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`palmares_${currentSymbol}_${tf}.csv`; a.click(); }catch(_){ } }); }
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
if(weightsSave){ weightsSave.addEventListener('click', ()=>{ try{ const prof = (weightsProfile&&weightsProfile.value)||'balancee'; const w = readWeightsFromUI(); saveWeights(prof, w); localStorage.setItem('labWeightsProfile', prof); closeModalEl(weightsModalEl); setStatus('Pondérations enregistrées'); try{ renderLabFromStorage(); }catch(_){ } }catch(_){ } }); }

// Lab — Entraîner
const labRunBtn=document.getElementById('labRun');
if(labRunBtn){ labRunBtn.addEventListener('click', async ()=>{ try{
  const profSel = (document.getElementById('labProfile') && document.getElementById('labProfile').value) || (localStorage.getItem('labWeightsProfile')||'balancee');
  try{ localStorage.setItem('labWeightsProfile', profSel); }catch(_){ }
  const sym=currentSymbol;
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
  try{ if(window.SUPA && typeof SUPA.fetchKnownKeys==='function'){ seenCanon = await SUPA.fetchKnownKeys(sym, tfSel) || new Set(); addBtLog && addBtLog(`Déduplication: ${seenCanon.size} stratégies déjà en base`); } }catch(_){ }
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
  const rNol=[2,3,4,5]; const rPrd=[]; for(let v=8; v<=34; v+=2){ rPrd.push(v); }
  const rSL=[0.5,1,1.5,2,2.5,3]; const rBEb=[3,4,5,6,7,8]; const rBEL=[3,4,5,6,7,8,9,10];
  const rEMALen=[]; for(let v=21; v<=89; v+=4){ rEMALen.push(v); }
  const keyOf=(p)=> JSON.stringify([p.nol,p.prd,p.slInitPct,p.beAfterBars,p.beLockPct,p.emaLen,p.entryMode,p.useFibRet,p.confirmMode,p.ent382,p.ent500,p.ent618,p.ent786,Array.isArray(p.tp)? p.tp.slice(0,10):[], Array.isArray(p.sl)? p.sl.slice(0,10):[]]);
  const canonKey=(p)=>{ try{
      const tp = Array.isArray(p.tp) ? p.tp.slice(0,10) : [];
      const tp_types = new Array(10).fill('Fib');
      const tp_r = new Array(10).fill(0.0);
      const tp_p = new Array(10).fill(0.0);
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
        let w = t.qty;
        if(w != null) w = (w > 1 ? Number(w) : Number(w) * 100);
        tp_p[i] = Number.isFinite(w) ? Math.max(0, w) : 0;
        sumW += tp_p[i];
      }
      if(sumW > 0){
        for(let i=0;i<10;i++) tp_p[i] = +(tp_p[i] / sumW * 100).toFixed(6);
      }
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
        tp_types, tp_r, tp_p,
      };
      return JSON.stringify(obj, Object.keys(obj).sort());
    }catch(_){ return ''; } };

  function readTPOpt(){
    try{
      // UI toggles hidden: always enable TP optimization and allow all types/levels
      const count = Math.max(1, Math.min(10, parseInt(document.getElementById('labTPCount')?.value||'10',10)));
      const pctMin = parseFloat(document.getElementById('labTPPctMin')?.value||'0.5');
      const pctMax = parseFloat(document.getElementById('labTPPctMax')?.value||'5');
      const fibsFull = [0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.382,1.414,1.618,2.0,2.236,2.618,3.0];
      return { en:true, count, allowFib:true, allowPct:true, allowEMA:true, pctMin, pctMax, fibs: fibsFull };
    }catch(_){
      return { en:true, count:10, allowFib:true, allowPct:true, allowEMA:true, pctMin:0.5, pctMax:5, fibs:[0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.382,1.414,1.618,2.0,2.236,2.618,3.0] };
    }
  }
  function randWeights(n){ const arr=new Array(n).fill(0).map(()=> Math.random()+0.05); const s=arr.reduce((a,b)=>a+b,0); return arr.map(x=> x/s); }
  function sampleTPList(tpCfg){
    const { allowFib, allowPct, allowEMA, pctMin, pctMax, fibs } = tpCfg || {};
    const n = Math.max(1, Math.min(10, Number(tpCfg && tpCfg.count) || 10));
    const types=[]; if(allowFib) types.push('Fib'); if(allowPct) types.push('Percent'); if(allowEMA) types.push('EMA'); if(!types.length) types.push('Fib');
    const ws=randWeights(n);
    const list=[];
    for(let i=0;i<n;i++){
      const t=types[(Math.random()*types.length)|0];
      if(t==='Fib'){
        const r=fibs[(Math.random()*fibs.length)|0];
        list.push({ type:'Fib', fib:r, value:r, qty: ws[i] });
      } else if(t==='Percent'){
        const p = pctMin + Math.random()*(Math.max(0,pctMax-pctMin));
        list.push({ type:'Percent', pct:+p.toFixed(3), value:+p.toFixed(3), qty: ws[i] });
      } else {
        const len = rEMALen[(Math.random()*rEMALen.length)|0];
        list.push({ type:'EMA', emaLen: len, qty: ws[i] });
      }
    }
    return list;
  }
  function mutateTP(list,tpCfg){ if(!Array.isArray(list)||!list.length) return list; const out=list.map(x=> ({...x})); const i=(Math.random()*out.length)|0; const t=out[i]; const r=Math.random(); if(t.type==='Fib' && (r<0.5)){ const fibs=tpCfg.fibs; out[i].fib = fibs[(Math.random()*fibs.length)|0]; out[i].value=out[i].fib; } else if(t.type==='Percent' && (r<0.5)){ const p = tpCfg.pctMin + Math.random()*(Math.max(0,tpCfg.pctMax-tpCfg.pctMin)); out[i].pct=+p.toFixed(3); out[i].value=out[i].pct; } else if(t.type==='EMA' && (r<0.5)){ out[i].emaLen = rEMALen[(Math.random()*rEMALen.length)|0]; } else { // change type
    const types=[]; if(tpCfg.allowFib) types.push('Fib'); if(tpCfg.allowPct) types.push('Percent'); if(tpCfg.allowEMA) types.push('EMA'); if(types.length){ const nt=types[(Math.random()*types.length)|0]; if(nt==='Fib'){ const fibs=tpCfg.fibs; out[i]={ type:'Fib', fib:fibs[(Math.random()*fibs.length)|0], qty:t.qty||null }; } else if(nt==='Percent'){ const p=tpCfg.pctMin + Math.random()*(Math.max(0,tpCfg.pctMax-tpCfg.pctMin)); out[i]={ type:'Percent', pct:+p.toFixed(3), qty:t.qty||null }; } else { out[i]={ type:'EMA', emaLen: rEMALen[(Math.random()*rEMALen.length)|0], qty:t.qty||null }; } }
  }
    // mutate weights slightly
    const ws=out.map(x=> x.qty||0); const j=(Math.random()*ws.length)|0; ws[j] = Math.max(0.01, ws[j] + (Math.random()*0.2-0.1)); const s=ws.reduce((a,b)=>a+b,0); for(let k=0;k<out.length;k++){ out[k].qty = ws[k]/s; }
    return out; }

  function readSLOpt(){
    try{
      const pctMin = parseFloat(document.getElementById('labSLPctMin')?.value||'0.5');
      const pctMax = parseFloat(document.getElementById('labSLPctMax')?.value||'5');
      const fibsFull = [0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.382,1.414,1.618,2.0,2.236,2.618,3.0];
      const count = Math.max(1, Math.min(10, parseInt(document.getElementById('labSLCount')?.value||'1',10)));
      return { allowFib:true, allowPct:true, allowEMA:true, pctMin, pctMax, fibs: fibsFull, count };
    }catch(_){
      return { allowFib:true, allowPct:true, allowEMA:true, pctMin:0.5, pctMax:5.0, fibs:[0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.382,1.414,1.618,2.0,2.236,2.618,3.0], count:1 };
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
  function crossoverTP(a,b,tpCfg){ const n=Math.max(1, tpCfg.count|0); const res=[]; for(let i=0;i<n;i++){ const src=(Math.random()<0.5? a:b); res[i] = src[i%src.length]? {...src[i%src.length]} : (a[i]||b[i]||null); if(!res[i]){ res[i]={ type:'Fib', fib:(tpCfg.fibs[0]||0.382), qty: 1/n }; } } const s=res.reduce((u,x)=> u+(x.qty||0),0)||1; for(const x of res){ x.qty = (x.qty||0)/s; } return res; }

  function randomParams(){ const tpCfg=readTPOpt(); const slCfg=readSLOpt(); const p={ nol: pick(rNol), prd: pick(rPrd), slInitPct: pick(rSL), beAfterBars: pick(rBEb), beLockPct: pick(rBEL), emaLen: pick(rEMALen), entryMode: lbcOpts.entryMode||'Both', useFibRet: !!lbcOpts.useFibRet, confirmMode: lbcOpts.confirmMode||'Bounce', ent382: !!lbcOpts.ent382, ent500: !!lbcOpts.ent500, ent618: !!lbcOpts.ent618, ent786: !!lbcOpts.ent786, tpEnable: true, tp: [], slEnable: true, sl: [] };
    p.tp = sampleTPList(tpCfg).slice(0,10);
    p.sl = sampleSLList(slCfg).slice(0,10);
    return p; }
  function neighbor(arr, v){ const i=arr.indexOf(v); const out=[]; if(i>0) out.push(arr[i-1]); out.push(v); if(i>=0 && i<arr.length-1) out.push(arr[i+1]); return pick(out.length?out:arr); }
  function mutate(p, rate){ const tpCfg=readTPOpt(); const slCfg=readSLOpt(); const q={...p}; if(Math.random()<rate) q.nol = neighbor(rNol, q.nol); if(Math.random()<rate) q.prd = neighbor(rPrd, q.prd); if(Math.random()<rate) q.slInitPct = neighbor(rSL, q.slInitPct); if(Math.random()<rate) q.beAfterBars = neighbor(rBEb, q.beAfterBars); if(Math.random()<rate) q.beLockPct = neighbor(rBEL, q.beLockPct); if(Math.random()<rate) q.emaLen = neighbor(rEMALen, q.emaLen); if(Math.random()<rate){ q.tp = mutateTP(Array.isArray(q.tp)? q.tp: [], tpCfg).slice(0,10); q.tpEnable=true; } if(Math.random()<rate){ q.sl = mutateSL(Array.isArray(q.sl)? q.sl: [], slCfg).slice(0,10); q.slEnable=true; } return q; }
  function crossover(a,b){ const tpCfg=readTPOpt(); const slCfg=readSLOpt(); return { nol: Math.random()<0.5?a.nol:b.nol, prd: Math.random()<0.5?a.prd:b.prd, slInitPct: Math.random()<0.5?a.slInitPct:b.slInitPct, beAfterBars: Math.random()<0.5?a.beAfterBars:b.beAfterBars, beLockPct: Math.random()<0.5?a.beLockPct:b.beLockPct, emaLen: Math.random()<0.5?a.emaLen:b.emaLen, entryMode: a.entryMode, useFibRet: a.useFibRet, confirmMode: a.confirmMode, ent382:a.ent382, ent500:a.ent500, ent618:a.ent618, ent786:a.ent786, tpEnable:true, tp: crossoverTP(a.tp||[], b.tp||[], tpCfg).slice(0,10), slEnable:true, sl: crossoverSL(a.sl||[], b.sl||[], slCfg).slice(0,10) }; }
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
      while(children.length<pop){ const a=pick(elites), b=pick(elites);
        let child = (Math.random()<cxPct)? crossover(a.p, b.p) : {...(pick(elites).p)};
        child = mutate(child, mutPct);
        if(isDup(child)) continue; pushSeen(child); children.push({ p:child, owner: (a.owner||b.owner||null) }); }
const t0g=performance.now();
      __labSimTotal += children.length; updateGlobalProgressUI();
      const evald = await evalParamsList(children, 'EA');
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
      const batch=[]; while(batch.length<Math.max(10, cur.length)){
        const p={ nol: sampleFrom(D.nol), prd: sampleFrom(D.prd), slInitPct: sampleFrom(D.sl), beAfterBars: sampleFrom(D.beb), beLockPct: sampleFrom(D.bel), emaLen: sampleFrom(D.ema), entryMode: lbcOpts.entryMode||'Both', useFibRet: !!lbcOpts.useFibRet, confirmMode: lbcOpts.confirmMode||'Bounce', ent382: !!lbcOpts.ent382, ent500: !!lbcOpts.ent500, ent618: !!lbcOpts.ent618, ent786: !!lbcOpts.ent786, tpEnable: true, tp: [], slEnable: true, sl: [] };
        p.tp = sampleTPList(tpCfg).slice(0,10);
        p.sl = sampleSLList(slCfg).slice(0,10);
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
  const results = (strategy==='ea'? eaOut : (strategy==='bayes'? bayOut : bayOut));

  if(goal==='new'){
    // Persister uniquement dans Supabase
    try{ if(window.SUPA && typeof SUPA.persistLabResults==='function'){ const bestOut = results.slice(0, Math.min(10, results.length)).map(x=>({ params:x.p, metrics:x.res, score:x.score, gen:1, name:null })); await SUPA.persistLabResults({ symbol:sym, tf: tfSel, tested: allTested, best: bestOut }); } }catch(_){ }
    try{ await renderLabFromStorage(); }catch(_){ }
    setStatus('Palmarès mis à jour'); closeBtProgress();
  } else {
    // Persister uniquement dans Supabase
    try{ if(window.SUPA && typeof SUPA.persistLabResults==='function'){ const bestOut = results.slice(0, Math.min(10, results.length)).map(x=>({ params:x.p, metrics:x.res, score:x.score, gen: (x.gen||1), name: x.name||null })); await SUPA.persistLabResults({ symbol:sym, tf: tfSel, tested: allTested, best: bestOut }); } }catch(_){ }
    try{ await renderLabFromStorage(); }catch(_){ }
    setStatus('Amélioration terminée'); closeBtProgress();
  }
 }catch(e){ try{ addBtLog(`Erreur entraînement: ${e&&e.message?e.message:e}`); }catch(_){ } setStatus('Erreur entraînement'); try{ closeBtProgress(); }catch(_){ } } }); }

// Lab Pause/Stop controls are now on the progress popup (btPause/btStop)

// Presets (Heaven)
const lbcPresetName=document.getElementById('lbcPresetName'); const lbcPresetSave=document.getElementById('lbcPresetSave'); const lbcPresetSelect=document.getElementById('lbcPresetSelect'); const lbcPresetLoad=document.getElementById('lbcPresetLoad'); const lbcPresetDelete=document.getElementById('lbcPresetDelete'); const lbcResetBtn=document.getElementById('lbcReset');
function loadPresetList(){ try{ const s=localStorage.getItem('lbcPresetList'); const names=s? JSON.parse(s): []; if(lbcPresetSelect){ lbcPresetSelect.innerHTML = names.map(n=>`<option value="${n}">${n}</option>`).join(''); } return names; }catch(_){ return []; } }
function savePresetList(names){ try{ localStorage.setItem('lbcPresetList', JSON.stringify(names)); }catch(_){ } }
function savePreset(name){ const names=loadPresetList(); const idx=names.indexOf(name); if(idx===-1){ names.push(name); savePresetList(names); loadPresetList(); } try{ localStorage.setItem('lbcPreset:'+name, JSON.stringify(lbcOpts)); }catch(_){ } }
function loadPresetByName(name){ try{ const s=localStorage.getItem('lbcPreset:'+name); if(!s) return false; lbcOpts = { ...defaultLBC, ...JSON.parse(s) }; saveLBCOpts(); renderLBC(); return true; }catch(_){ return false; } }
function deletePreset(name){ try{ localStorage.removeItem('lbcPreset:'+name); const names=loadPresetList().filter(n=>n!==name); savePresetList(names); loadPresetList(); }catch(_){} }
loadPresetList();
if(lbcPresetSave){ lbcPresetSave.addEventListener('click', ()=>{ const name=(lbcPresetName&&lbcPresetName.value||'').trim(); if(!name){ setStatus('Nom du preset requis'); return; } savePreset(name); setStatus('Preset sauvegardé'); }); }
if(lbcPresetLoad){ lbcPresetLoad.addEventListener('click', ()=>{ const name=(lbcPresetSelect&&lbcPresetSelect.value)||''; if(!name){ setStatus('Aucun preset'); return; } if(loadPresetByName(name)){ setStatus('Preset chargé'); } }); }
if(lbcPresetDelete){ lbcPresetDelete.addEventListener('click', ()=>{ const name=(lbcPresetSelect&&lbcPresetSelect.value)||''; if(!name) return; if(confirm(`Supprimer le preset "${name}" ?`)){ deletePreset(name); setStatus('Preset supprimé'); } }); }
if(lbcResetBtn){ lbcResetBtn.addEventListener('click', ()=>{ lbcOpts = { ...defaultLBC }; saveLBCOpts(); renderLBC(); setStatus('Paramètres réinitialisés'); }); }

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
  renderLBC(); renderLiveHUD(); refreshLiveTradesUI(); renderLiveDrawer(); }catch(_){ } }
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
const emaTrail = (lbcOpts.tpAfterHit==='ema') ? emaCalc(candles, Math.max(1, lbcOpts.emaLen|0)) : null; const slEmaCache=new Map(); clearTPHitMarkers();
function computeSLFromLadder(dir, entry, i){ try{ if(!(lbcOpts.slEnable && Array.isArray(lbcOpts.sl) && lbcOpts.sl.length)) return null; const seg=segLast; const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null; const cands=[]; for(const t of lbcOpts.sl){ const typ=(t&&t.type)||'Percent'; let price=null; if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B - move*r) : (B + move*r); } else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1 - p/100)) : (entry*(1 + p/100)); } else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (lbcOpts.emaLen||55)),10)); let ema=slEmaCache.get(len); if(!ema){ ema=emaCalc(candles, len); slEmaCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; } if(price!=null){ if(dir==='long'){ if(price<=entry) cands.push(price); } else { if(price>=entry) cands.push(price); } } } if(!cands.length) return null; return dir==='long'? Math.max(...cands) : Math.min(...cands); }catch(_){ return null; } }
  function liveBuildTargets(dir, entry, riskAbs, i){
      let list=[];
      if(lbcOpts.tpEnable && Array.isArray(lbcOpts.tp) && lbcOpts.tp.length){
        const A=segLast?segLast.a.price:null, B=segLast?segLast.b.price:null, move=segLast?Math.abs(B-A):null;
        for(const t of lbcOpts.tp){ let price=null; const typ=(t.type||'Fib');
          if(typ==='Fib' && segLast && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (segLast.dir==='up')? (B + move*r) : (B - move*r); }
          else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1+p/100)) : (entry*(1-p/100)); }
          else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (lbcOpts.emaLen||55)),10)); const ema=emaCalc(candles, len); const v=ema[ema.length-1]; if(isFinite(v)) price=v; }
          if(price!=null){ if((dir==='long' && price>entry) || (dir==='short' && price<entry)){ let w=null; const q=t.qty; if(q!=null && isFinite(q)) w=(q>1? q/100 : q); list.push({price, w}); } }
        }
        if(dir==='long') list.sort((a,b)=>a.price-b.price); else list.sort((a,b)=>b.price-a.price);
        let sumW=0, hasW=false; for(const it of list){ if(it.w!=null && it.w>0){ sumW+=it.w; hasW=true; } }
        if(!hasW){ if(list.length){ const even=1/list.length; list=list.map(it=>({ price:it.price, w:even })); }
          else { list=[{price: (dir==='long'? entry + riskAbs*(lbcOpts.tp1R||1) : entry - riskAbs*(lbcOpts.tp1R||1)), w:1}]; }
        } else {
          if(sumW>1){ const k=1/sumW; for(const it of list){ if(it.w!=null) it.w*=k; } }
          else if(lbcOpts.tpCloseAllLast && sumW<1 && list.length){ list[list.length-1].w = (list[list.length-1].w||0) + (1-sumW); }
        }
      } else {
        list=[{ price: dir==='long'? (entry + riskAbs*(lbcOpts.tp1R||1)) : (entry - riskAbs*(lbcOpts.tp1R||1)), w:1 }];
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
          const riskPx=entry*(lbcOpts.slInitPct/100);
          const sl=dir==='long'?(entry-riskPx):(entry+riskPx);
          const qty=__liveComputeQty(entry, sl);
          if(qty>1e-12 && isFinite(qty)){
            const targets=liveBuildTargets(dir, entry, Math.abs(entry-sl));
            livePos={ dir, entry, sl, initSL:sl, qty:qty, initQty:qty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets };
            try{ addLiveEntryMarker(candles[i].time, dir); }catch(_){ }
            try{ liveTrades.push({ dir, entryTime:candles[i].time, entry, initSL:sl, exitTime:candles[i].time, exit:entry, reason:'Entry', qty:qty, pnl:0, fees:0, net:0, rr:null }); }catch(_){ }
            dirty=true; uiDirty=true;
          }
        }
      }
      if(!livePos && lbcOpts.useFibRet && (lbcOpts.entryMode!=='Original') && livePendingFib && livePendingFib.levels && livePendingFib.levels.length){
        const dir=livePendingFib.dir; for(const lv of livePendingFib.levels){ let ok=false; if(dir==='long'){ ok=(livePendingFib.mode==='Touch')? (bar.low<=lv) : (bar.low<=lv && bar.close>lv); } else { ok=(livePendingFib.mode==='Touch')? (bar.high>=lv) : (bar.high>=lv && bar.close<lv); }
          if(ok){ const entry=bar.close; const riskPx=entry*(lbcOpts.slInitPct/100); const sl=dir==='long'?(entry-riskPx):(entry+riskPx); const qty=__liveComputeQty(entry, sl); if(qty>1e-12 && isFinite(qty)){ const targets=liveBuildTargets(dir, entry, Math.abs(entry-sl)); livePos={ dir, entry, sl, initSL:sl, qty:qty, initQty:qty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets }; try{ addLiveEntryMarker(candles[i].time, dir); }catch(_){ } dirty=true; uiDirty=true; livePendingFib=null; break; } }
        }
      }
    } else {
      // BE arming
      if(lbcOpts.beEnable && !livePos.beActive && (i - livePos.entryIdx) >= lbcOpts.beAfterBars){
        const movePct = livePos.dir==='long'? ((bar.high - livePos.entry)/livePos.entry*100) : ((livePos.entry - bar.low)/livePos.entry*100);
        if(movePct >= lbcOpts.beLockPct){ livePos.beActive=true; livePos.sl = livePos.entry; }
      }
      // EMA trailing after first TP
      if(livePos.anyTP && lbcOpts.tpAfterHit==='ema' && emaTrail){ const v=emaTrail[emaTrail.length-1]; if(isFinite(v)){ if(livePos.dir==='long') livePos.sl=Math.max(livePos.sl, v); else livePos.sl=Math.min(livePos.sl, v); } }
      // SL first
      if(livePos.dir==='long'){
        if(bar.low <= livePos.sl){ const portionQty = livePos.qty; const pnl = (livePos.sl - livePos.entry) * portionQty; const fees = (livePos.entry*portionQty + livePos.sl*portionQty) * feePct; const net=pnl-fees; liveSession.equity += net; if(liveSession.equity<0) liveSession.equity=0; liveTrades.push({ dir:livePos.dir, entryTime:candles[livePos.entryIdx].time, entry:livePos.entry, initSL:livePos.initSL, exitTime:candles[i].time, exit:livePos.sl, reason:'SL', qty:portionQty, pnl, fees, net, rr: (Math.abs(livePos.entry-livePos.initSL)*portionQty>0? net/(Math.abs(livePos.entry-livePos.initSL)*portionQty) : null) }); if(Math.abs(livePos.sl - livePos.entry) <= 1e-8){ addBEHitMarker(candles[i].time, livePos.dir); } else { addSLHitMarker(candles[i].time, livePos.dir); } livePos=null; dirty=true; uiDirty=true; }
      } else {
        if(bar.high >= livePos.sl){ const portionQty = livePos.qty; const pnl = (livePos.entry - livePos.sl) * portionQty; const fees = (livePos.entry*portionQty + livePos.sl*portionQty) * feePct; const net=pnl-fees; liveSession.equity += net; if(liveSession.equity<0) liveSession.equity=0; liveTrades.push({ dir:livePos.dir, entryTime:candles[livePos.entryIdx].time, entry:livePos.entry, initSL:livePos.initSL, exitTime:candles[i].time, exit:livePos.sl, reason:'SL', qty:portionQty, pnl, fees, net, rr: (Math.abs(livePos.entry-livePos.initSL)*portionQty>0? net/(Math.abs(livePos.entry-livePos.initSL)*portionQty) : null) }); if(Math.abs(livePos.sl - livePos.entry) <= 1e-8){ addBEHitMarker(candles[i].time, livePos.dir); } else { addSLHitMarker(candles[i].time, livePos.dir); } livePos=null; dirty=true; uiDirty=true; }
      }
      // TP sequential
      if(livePos && livePos.targets && livePos.tpIdx < livePos.targets.length){
        while(livePos && livePos.tpIdx < livePos.targets.length){ const tp=livePos.targets[livePos.tpIdx]; const hit = livePos.dir==='long'? (bar.high >= tp.price) : (bar.low <= tp.price); if(!hit) break; const portionFrac = lbcOpts.tpCompound? (tp.w||1) : 1; const portionQty = livePos.initQty * portionFrac; const usedQty = Math.min(portionQty, livePos.qty); const exitPx = tp.price; const pnl = (livePos.dir==='long'? (exitPx - livePos.entry) : (livePos.entry - exitPx)) * usedQty; const fees = (livePos.entry*usedQty + exitPx*usedQty) * feePct; const net = pnl - fees; liveSession.equity += net; if(liveSession.equity<0) liveSession.equity=0; liveTrades.push({ dir:livePos.dir, entryTime:candles[livePos.entryIdx].time, entry:livePos.entry, initSL:livePos.initSL, exitTime:candles[i].time, exit:exitPx, reason:`TP${livePos.tpIdx+1}`, qty:usedQty, pnl, fees, net, rr: (Math.abs(livePos.entry-livePos.initSL)*usedQty>0? net/(Math.abs(livePos.entry-livePos.initSL)*usedQty) : null) }); addTPHitMarker(candles[i].time, livePos.dir); livePos.qty -= usedQty; livePos.anyTP=true; if(lbcOpts.tpAfterHit==='be'){ livePos.sl = livePos.entry; } else if(lbcOpts.tpAfterHit==='prev'){ if(livePos.dir==='long') livePos.sl=Math.max(livePos.sl, exitPx); else livePos.sl=Math.min(livePos.sl, exitPx); } livePos.tpIdx++; if(!lbcOpts.tpCompound || livePos.qty<=1e-12){ livePos=null; } dirty=true; uiDirty=true; if(!livePos) break; }
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
function populateLiveWalletsUI(){ try{ const arr=readLiveWallets(); if(liveWalletSel){ liveWalletSel.innerHTML = arr.map(w=>`<option value="${w.name}">${w.name}</option>`).join(''); } }catch(_){ } }
if(liveWalletSave){ liveWalletSave.addEventListener('click', ()=>{ try{ const name=(liveWalletName&&liveWalletName.value||'').trim(); if(!name){ setStatus('Nom du wallet requis'); return; } const cap=+(liveStartCap&&liveStartCap.value||'10000'); const fee=+(liveFee&&liveFee.value||'0.1'); const lev=+(liveLev&&liveLev.value||'1'); let arr=readLiveWallets(); const idx=arr.findIndex(w=>w.name===name); const item={ name, startCap:cap, fee, lev }; if(idx>=0) arr[idx]=item; else arr.unshift(item); writeLiveWallets(arr.slice(0,100)); populateLiveWalletsUI(); setStatus('Wallet enregistré'); }catch(_){ } }); }
if(liveWalletLoad){ liveWalletLoad.addEventListener('click', ()=>{ try{ const sel=(liveWalletSel&&liveWalletSel.value)||''; if(!sel) return; const w=readLiveWallets().find(x=>x.name===sel); if(!w) return; if(liveStartCap) liveStartCap.value=String(w.startCap||''); if(liveFee) liveFee.value=String(w.fee||''); if(liveLev) liveLev.value=String(w.lev||''); setStatus('Wallet chargé'); }catch(_){ } }); }
if(liveWalletDelete){ liveWalletDelete.addEventListener('click', ()=>{ try{ const sel=(liveWalletSel&&liveWalletSel.value)||''; if(!sel) return; let arr=readLiveWallets().filter(x=>x.name!==sel); writeLiveWallets(arr); populateLiveWalletsUI(); setStatus('Wallet supprimé'); }catch(_){ } }); }
