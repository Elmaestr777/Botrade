/* Optimization worker: backtest evaluations with caching */

let BARS = [];
let FROM = 0, TO = 0;
let SETTINGS = { startCapital: 10000, feePct: 0.10, lev: 1, maxPosPct: 100, maxPosBase: 'initial' };

// Caches (reset on init)
const pivotCache = new Map(); // prd -> pivots
const emaCache = new Map();   // len -> array
const lbCache = new Map();    // nol -> {trend, level, flips}
const sigCache = new Map();   // key(opts subset) -> signals

function resetCaches(){ pivotCache.clear(); emaCache.clear(); lbCache.clear(); sigCache.clear(); }

function sanitizeOpts(inp){
  const o = inp || {};
  function num(v, d){ v = Number(v); return Number.isFinite(v)? v : d; }
  function bool(v, d){ return (typeof v === 'boolean')? v : !!d; }
  function str(v, d){ return (typeof v === 'string')? v : d; }
  const out = {
    nol: Math.max(1, Math.floor(num(o.nol, 3))),
    prd: Math.max(2, Math.floor(num(o.prd, 15))),
    entryMode: str(o.entryMode, 'Both'),
    riskMgmt: bool(o.riskMgmt, false),
    riskMaxPct: Math.max(0, num(o.riskMaxPct, 1.0)),
    slInitPct: Math.max(0, num(o.slInitPct, 2.0)),
    beEnable: bool(o.beEnable, true),
    beAfterBars: Math.max(1, Math.floor(num(o.beAfterBars, 5))),
    beLockPct: Math.max(0, num(o.beLockPct, 5.0)),
    tpEnable: bool(o.tpEnable, true),
    tpNorm: bool(o.tpNorm, true),
    emaLen: Math.max(1, Math.floor(num(o.emaLen, 55))),
    useFibRet: bool(o.useFibRet, false),
    confirmMode: str(o.confirmMode, 'Bounce'),
    ent382: bool(o.ent382, true),
    ent500: bool(o.ent500, true),
    ent618: bool(o.ent618, true),
    ent786: bool(o.ent786, false),
  };
  // TP ratios and allocations
  for(let i=1;i<=10;i++){
    const rKey = 'tp'+i+'R';
    const pKey = 'tp'+i+'P';
    out[rKey] = num(o[rKey], 0);
    out[pKey] = Math.max(0, num(o[pKey], 0));
  }
  // tpTypes normalization
  const tt = Array.isArray(o.tpTypes)? o.tpTypes.slice(0,10) : [];
  while(tt.length<10) {tt.push('Fib');}
  out.tpTypes = tt;
  return out;
}

function emaSeries(bars, len){ const k = 2/(len+1); const out=[]; let ema=null; for(let i=0;i<bars.length;i++){ const v=bars[i].close; ema = (ema==null? v : v*k + ema*(1-k)); out.push(ema); } return out; }
function computePivots(bars, prd){ const piv=[]; for(let i=prd;i<bars.length-prd;i++){ let isHigh=true, isLow=true; for(let j=1;j<=prd;j++){ if(!(bars[i].high>bars[i-j].high && bars[i].high>bars[i+j].high)) {isHigh=false;} if(!(bars[i].low<bars[i-j].low && bars[i].low<bars[i+j].low)) {isLow=false;} if(!isHigh && !isLow) {break;} } if(isHigh||isLow){ piv.push({ idx:i, time:bars[i].time, price: isHigh? bars[i].high : bars[i].low }); } } return piv; }
function computeLineBreakState(bars, nol){ const n=bars.length; if(n===0) {return {trend:[], level:[], flips:[]};} const trend=new Array(n).fill(0); const level=new Array(n).fill(null); const flips=[]; let t = bars[0].close >= bars[0].open ? 1 : -1; const opens=[bars[0].open]; const closes=[bars[0].close]; for(let i=0;i<n;i++){ const c=bars[i].close; if(t===1){ const count=Math.min(nol, opens.length); const minUp=Math.min(...opens.slice(0,count), ...closes.slice(0,count)); if(c<minUp){ t=-1; } if(c>closes[0] || t===-1){ const o=(t===-1 ? opens[0] : closes[0]); opens.unshift(o); closes.unshift(c); } } else { const count=Math.min(nol, opens.length); const maxDn=Math.max(...opens.slice(0,count), ...closes.slice(0,count)); if(c>maxDn){ t=1; } if(c<closes[0] || t===1){ const o=(t===1 ? opens[0] : closes[0]); opens.unshift(o); closes.unshift(c); } } trend[i]=t; const cnt=Math.min(nol, opens.length); const minUp=Math.min(...opens.slice(0,cnt), ...closes.slice(0,cnt)); const maxDn=Math.max(...opens.slice(0,cnt), ...closes.slice(0,cnt)); level[i]=(t===1? minUp : maxDn); if(i>0 && trend[i]!==trend[i-1]) {flips.push(i);} } return {trend, level, flips}; }
function normalizeTPPercents(opts){ const sum = opts.tp1P+opts.tp2P+opts.tp3P+opts.tp4P+opts.tp5P+opts.tp6P+opts.tp7P+opts.tp8P+opts.tp9P+opts.tp10P; if(opts.tpNorm && sum>0){ const s=100/sum; opts.tp1P*=s; opts.tp2P*=s; opts.tp3P*=s; opts.tp4P*=s; opts.tp5P*=s; opts.tp6P*=s; opts.tp7P*=s; opts.tp8P*=s; opts.tp9P*=s; opts.tp10P*=s; } }
function generateHeavenSignalsOnBars(opts, bars){
  const signals = [];
  let lb = lbCache.get(opts.nol);
  if(!lb){ lb = computeLineBreakState(bars, opts.nol); lbCache.set(opts.nol, lb); }
  let piv = pivotCache.get(opts.prd);
  if(!piv){ piv = computePivots(bars, opts.prd); pivotCache.set(opts.prd, piv); }
  const useLB = (opts.entryMode==='Original' || opts.entryMode==='Both');
  const useFib = (opts.entryMode==='Fib Retracement' || opts.entryMode==='Both') && opts.useFibRet;
  if(useLB){
    for(const i of lb.flips){
      const entryIdx = Math.min(bars.length-1, i+1);
      const riskOk = !opts.riskMgmt || (Number.isFinite(lb.level[i]) && (opts.riskMaxPct/100 >= Math.abs(bars[i].open - lb.level[i]) / Math.max(1e-9, bars[i].open)));
      if(!riskOk) {continue;}
      const dir = lb.trend[i]===1? 'long':'short';
      signals.push({ idx: entryIdx, dir, type:'LB' });
    }
  }
  if(useFib && piv.length>=2){
    const useLvl = (ratio, swingUp)=>{
      for(let s=1;s<piv.length;s++){
        const a=piv[s-1], b=piv[s];
        const swingUpNow=b.price>a.price;
        if(swingUpNow!==swingUp) {continue;}
        const lvl=a.price+(b.price-a.price)*ratio;
        const start=b.idx;
        const end=(s+1<piv.length? piv[s+1].idx : bars.length);
        for(let j=start+1;j<end;j++){
          if(swingUp){
            const bounce=(opts.confirmMode==='Bounce')? (bars[j-1].close<=lvl && bars[j].close>lvl) : (bars[j].low<=lvl && bars[j].close>lvl);
            if(bounce){
              const riskOk = !opts.riskMgmt || (Number.isFinite(lb.level[j]) && (opts.riskMaxPct/100 >= Math.abs(bars[j].close - lb.level[j]) / Math.max(1e-9, bars[j].close)));
              if(riskOk && lb.trend[j]===1){
                const entryIdx=Math.min(bars.length-1, j+1);
                signals.push({ idx:entryIdx, dir:'long', type:'Fib' });
                break;
              }
            }
          } else {
            const bounce=(opts.confirmMode==='Bounce')? (bars[j-1].close>=lvl && bars[j].close<lvl) : (bars[j].high>=lvl && bars[j].close<lvl);
            if(bounce){
              const riskOk = !opts.riskMgmt || (Number.isFinite(lb.level[j]) && (opts.riskMaxPct/100 >= Math.abs(bars[j].close - lb.level[j]) / Math.max(1e-9, bars[j].close)));
              if(riskOk && lb.trend[j]===-1){
                const entryIdx=Math.min(bars.length-1, j+1);
                signals.push({ idx:entryIdx, dir:'short', type:'Fib' });
                break;
              }
            }
          }
        }
      }
    };
    if(opts.ent382){ useLvl(0.382,true); useLvl(0.382,false); }
    if(opts.ent500){ useLvl(0.5,true); useLvl(0.5,false); }
    if(opts.ent618){ useLvl(0.618,true); useLvl(0.618,false); }
    if(opts.ent786){ useLvl(0.786,true); useLvl(0.786,false); }
  }
  signals.sort((a,b)=> a.idx===b.idx ? (a.type==='LB' ? -1 : 1) : a.idx-b.idx);
  return signals;
}
function lastTwoPivotsBefore(piv, idx){ let b=null,a=null; for(let i=piv.length-1;i>=0;i--){ if(piv[i].idx<=idx){ if(!b) {b=piv[i];} else { a=piv[i]; break; } } } return (a&&b)? {a,b}: null; }
function simulateTradeFromSignalOnBars(sig, toIdx, piv, opts, equity, settings, bars){ const emaArr = (opts.tp8P>0) ? (emaCache.get(opts.emaLen)||emaSeries(bars, opts.emaLen)) : null; if(opts.tp8P>0 && !emaCache.has(opts.emaLen)) {emaCache.set(opts.emaLen, emaArr);}
  const entryBarIdx = sig.idx; if(entryBarIdx>=bars.length || entryBarIdx>toIdx) {return null;} const entryPrice = bars[entryBarIdx].open; const isLong = sig.dir==='long'; let sl = isLong ? entryPrice * (1 - opts.slInitPct/100) : entryPrice * (1 + opts.slInitPct/100);
  let qty;
  const lev = Math.max(1, +(((settings && settings.lev) != null) ? settings.lev : 1));
  const baseCap = ((settings && settings.maxPosBase) === 'equity') ? equity : (((settings && settings.startCapital) != null) ? settings.startCapital : equity);
  const maxPct = Math.max(0, +(((settings && settings.maxPosPct) != null) ? settings.maxPosPct : 100));
  const capNotional = maxPct>0 ? (baseCap * (maxPct/100) * lev) : Infinity;
  const qtyCap = isFinite(capNotional) ? capNotional / Math.max(1e-9, entryPrice) : Infinity;
  if(opts.riskMgmt){ const riskCash = equity * (opts.riskMaxPct/100); const riskPerUnit = Math.max(1e-9, Math.abs(entryPrice - sl)); qty = Math.max(0, riskCash / riskPerUnit);} else { qty = Math.max(0, (equity * lev) / Math.max(1e-9, entryPrice)); }
  qty = Math.min(qty, qtyCap);
  if(qty<=0) {return null;}
  const last2 = lastTwoPivotsBefore(piv, sig.idx); const values=[opts.tp1R,opts.tp2R,opts.tp3R,opts.tp4R,opts.tp5R,opts.tp6R,opts.tp7R,opts.tp8R,opts.tp9R,opts.tp10R]; const percs=[opts.tp1P,opts.tp2P,opts.tp3P,opts.tp4P,opts.tp5P,opts.tp6P,opts.tp7P,opts.tp8P,opts.tp9P,opts.tp10P]; const tmp={tpNorm:opts.tpNorm, tp1P:percs[0],tp2P:percs[1],tp3P:percs[2],tp4P:percs[3],tp5P:percs[4],tp6P:percs[5],tp7P:percs[6],tp8P:percs[7],tp9P:percs[8],tp10P:percs[9]}; normalizeTPPercents(tmp); const normPercs=[tmp.tp1P,tmp.tp2P,tmp.tp3P,tmp.tp4P,tmp.tp5P,tmp.tp6P,tmp.tp7P,tmp.tp8P,tmp.tp9P,tmp.tp10P];
  const targets=[]; const tpTypes=Array.isArray(opts.tpTypes)? opts.tpTypes:[]; const {a,b}=last2||{}; const swingUp=last2 ? (b.price>a.price) : null; const priceAt=(r)=> a.price + (b.price-a.price)*r; let emaRem=0; for(let i=0;i<10;i++){ if(normPercs[i]<=0) {continue;} const t=tpTypes[i]||'Fib'; if(t==='Percent'){ const pct=Math.max(0, parseFloat(values[i]||0)); if(pct<=0) {continue;} const p = isLong? entryPrice*(1+pct/100) : entryPrice*(1-pct/100); targets.push({ price:p, qty: qty*normPercs[i]/100, filled:false, label:`TP${i+1}` }); } else if(t==='EMA'){ emaRem += qty*normPercs[i]/100; } else if(last2){ const p = priceAt(values[i]); if(isLong && swingUp && p>entryPrice) {targets.push({ price:p, qty: qty*normPercs[i]/100, filled:false, label:`TP${i+1}` });} else if(!isLong && !swingUp && p<entryPrice) {targets.push({ price:p, qty: qty*normPercs[i]/100, filled:false, label:`TP${i+1}` });} } }
  if(isLong) {targets.sort((x,y)=>x.price-y.price);} else {targets.sort((x,y)=>y.price-x.price);}
  let remaining=qty; let realized=0; let exitIdx=toIdx; let exitPrice=bars[toIdx].close; let reason='Close'; const fills=[];
  for(let j=entryBarIdx; j<=toIdx; j++){
    if(opts.beEnable){ const barsSince=j-entryBarIdx; if(barsSince>=opts.beAfterBars){ const lc=bars[j].close; if(isLong){ const cand=Math.max(entryPrice, entryPrice + (opts.beLockPct/100)*(lc-entryPrice)); if(cand>sl) {sl=cand;} } else { const cand=Math.min(entryPrice, entryPrice - (opts.beLockPct/100)*(entryPrice-lc)); if(cand<sl) {sl=cand;} } } }
    const bar=bars[j];
    if(isLong){ if(bar.low<=sl){ realized += (sl-entryPrice)*remaining; fills.push({kind:'SL',qty:remaining,price:sl,timeIdx:j,pnl:(sl-entryPrice)*remaining}); exitIdx=j; exitPrice=sl; reason='SL'; remaining=0; break; }
      for(const t of targets){ if(!t.filled && bar.high>=t.price){ const amt=Math.min(remaining,t.qty); if(amt>0){ const fp=(t.price-entryPrice)*amt; realized+=fp; remaining-=amt; t.filled=true; fills.push({kind:t.label,qty:amt,price:t.price,timeIdx:j,pnl:fp}); } } }
      if(emaRem>1e-9 && emaArr){ const pEMA=emaArr[j]; if(bar.low<=pEMA){ const amt=Math.min(remaining, emaRem); if(amt>0){ const fp=(pEMA-entryPrice)*amt; realized+=fp; remaining-=amt; emaRem=Math.max(0, emaRem-amt); fills.push({kind:'TP8',qty:amt,price:pEMA,timeIdx:j,pnl:fp}); } } }
      if(remaining<=1e-9){ exitIdx=j; const _lt=targets.filter(t=>t.filled).slice(-1)[0]; exitPrice = _lt ? _lt.price : (emaArr? emaArr[j]: bar.close); reason='TP'; break; }
    } else { if(bar.high>=sl){ realized += (entryPrice-sl)*remaining; fills.push({kind:'SL',qty:remaining,price:sl,timeIdx:j,pnl:(entryPrice-sl)*remaining}); exitIdx=j; exitPrice=sl; reason='SL'; remaining=0; break; }
      for(const t of targets){ if(!t.filled && bar.low<=t.price){ const amt=Math.min(remaining,t.qty); if(amt>0){ const fp=(entryPrice-t.price)*amt; realized+=fp; remaining-=amt; t.filled=true; fills.push({kind:t.label,qty:amt,price:t.price,timeIdx:j,pnl:fp}); } } }
      if(emaRem>1e-9 && emaArr){ const pEMA=emaArr[j]; if(bar.high>=pEMA){ const amt=Math.min(remaining, emaRem); if(amt>0){ const fp=(entryPrice-pEMA)*amt; realized+=fp; remaining-=amt; emaRem=Math.max(0, emaRem-amt); fills.push({kind:'TP8',qty:amt,price:pEMA,timeIdx:j,pnl:fp}); } } }
      if(remaining<=1e-9){ exitIdx=j; const _lt=targets.filter(t=>t.filled).slice(-1)[0]; exitPrice = _lt ? _lt.price : (emaArr? emaArr[j]: bar.close); reason='TP'; break; }
    }
  }
  if(remaining>1e-9){ const last=bars[toIdx].close; const fp=isLong? (last-entryPrice)*remaining : (entryPrice-last)*remaining; realized+=fp; fills.push({kind:'Close',qty:remaining,price:last,timeIdx:toIdx,pnl:fp}); exitIdx=toIdx; exitPrice=last; reason='Close'; remaining=0; }
  const entryNotional=entryPrice*qty; const exitNotional=exitPrice*qty; const fees=(SETTINGS.feePct/100)*(entryNotional+exitNotional); const pnl=realized - fees;
  const initRiskCash = Math.abs(entryPrice - (isLong ? entryPrice * (1 - opts.slInitPct/100) : entryPrice * (1 + opts.slInitPct/100))) * qty; const rr = initRiskCash>1e-9 ? (pnl / initRiskCash) : null;
  return { entryIdx: entryBarIdx, exitIdx, entryPrice, exitPrice, dir: sig.dir, type: sig.type, qty, pnl, rr, reason, fills, fees };
}
function mean(a){ return a.length? a.reduce((x,y)=>x+y,0)/a.length : 0; }
function std(a){ const m=mean(a); const v=a.length? a.reduce((s,v)=> s+(v-m)*(v-m),0)/a.length : 0; return Math.sqrt(v); }
function linReg(y){ const n=y.length; if(n<2) {return {slope:0,r2:0};} const xs=Array.from({length:n},(_,i)=>i); const mx=(n-1)/2; const my=mean(y); let num=0,den=0,sst=0,sse=0; for(let i=0;i<n;i++){ const dx=xs[i]-mx; num+=dx*(y[i]-my); den+=dx*dx; } const a=num/Math.max(1e-9,den); const b=my - a*mx; for(let i=0;i<n;i++){ const fit=a*xs[i]+b; const err=y[i]-fit; sse+=err*err; const dy=y[i]-my; sst+=dy*dy; } return { slope:a, r2: sst>0? 1 - sse/sst : 0 } }
function runBacktestWithBars(opts, fromIdx, toIdx, forcedSignals=null, forcedPivots=null){ if(fromIdx<0||toIdx<0||fromIdx>=toIdx) {return null;} const piv = Array.isArray(forcedPivots)? forcedPivots : (pivotCache.get(opts.prd) || computePivots(BARS, opts.prd)); if(!Array.isArray(forcedPivots)) {pivotCache.set(opts.prd, piv);} const baseSignals = Array.isArray(forcedSignals)? forcedSignals : generateHeavenSignalsOnBars(opts, BARS); const signals = baseSignals.filter(s=> s.idx>=fromIdx && s.idx<=toIdx);
  const trades=[]; const returns=[]; const eqSeries=[]; let equity=SETTINGS.startCapital; let peak=equity, maxDD=0, maxDDAbs=0, grossProf=0, grossLoss=0, wins=0; let sumRR=0, cntRR=0; let holdSumSec=0;
  for(let i=0;i<signals.length;i++){
    const sig=signals[i]; const endBound = i+1 < signals.length ? Math.min(toIdx, signals[i+1].idx) : toIdx; const eqBefore=equity; const res=simulateTradeFromSignalOnBars(sig, endBound, piv, opts, equity, SETTINGS, BARS); if(res){ trades.push(res); equity += res.pnl; returns.push(eqBefore>1e-9? (res.pnl/eqBefore):0); eqSeries.push(equity); if(res.pnl>=0) {grossProf+=res.pnl;} else {grossLoss+=res.pnl;} if(res.pnl>0) {wins++;} if(Number.isFinite(res.rr)){ sumRR+=res.rr; cntRR++; } if(equity>peak) {peak=equity;} const dd=(peak-equity)/Math.max(1e-9,peak); if(dd>maxDD) {maxDD=dd;} const dda=(peak-equity); if(dda>maxDDAbs) {maxDDAbs=dda;} try{ holdSumSec += Math.max(0, (BARS[res.exitIdx].time - BARS[res.entryIdx].time)); }catch(e){} }
  }
  const totalPnl=equity-SETTINGS.startCapital; const winrate=trades.length? (wins/trades.length*100):0; const pf = grossLoss<0 ? (grossProf/Math.abs(grossLoss)) : (grossProf>0?Infinity:0); const avgRR = cntRR>0? (sumRR/cntRR) : null; const sharpe=(function(){ const m=mean(returns), s=std(returns); return s>0? m/s : 0; })(); const lr=linReg(eqSeries); const days=Math.max(1, Math.floor((BARS[toIdx].time - BARS[fromIdx].time)/86400)); const cagr=Math.pow(Math.max(1e-9, equity/SETTINGS.startCapital), 365/days) - 1; const calmar=(maxDD>0)? (cagr/(maxDD)) : 0; const retPct = (SETTINGS.startCapital>1e-9) ? ((equity - SETTINGS.startCapital)/SETTINGS.startCapital*100) : 0; const expectancy=mean(returns)*100; const positives=returns.filter(x=>x>=0).length; const negatives=returns.filter(x=>x<0).length; const consistency=(returns.length? positives/returns.length : 0); const capProtectIdx=(positives+negatives)>0? (negatives/(positives+negatives)*100) : 0; const volatility=std(returns)*100; const avgHoldH=trades.length? (holdSumSec/trades.length)/3600 : 0; const rangeSec=Math.max(1, (BARS[toIdx].time - BARS[fromIdx].time)); const timeInMarket=rangeSec>0? (holdSumSec/rangeSec*100):0; const tradesPerDay = days>0? (trades.length/days) : trades.length; const tradeEff=(function(){ const pos=returns.filter(x=>x>0); const neg=returns.filter(x=>x<0).map(x=>-x); const ap=pos.length? mean(pos):0; const an=neg.length? mean(neg):0; return an>0? (ap/an) : (ap>0? Infinity:0); })();
  const stats = { totalPnl, profitFactor: pf, tradesCount: trades.length, winrate, avgRR, sharpe, slope: lr.slope, r2: lr.r2, calmar, maxDDPct: maxDD*100, maxDDAbs, equityFinal: equity, retPct, expectancy, consistency, capProtectIdx, volatility, avgHoldH, timeInMarket, tradesPerDay, tradeEff };
  // Map trades to include times and fees
  const tradesOut = trades.map(t=>({ dir: t.dir==='long'?'Long':'Short', entryIdx:t.entryIdx, exitIdx:t.exitIdx, entryTime: (BARS[t.entryIdx]&&BARS[t.entryIdx].time)||null, exitTime:(BARS[t.exitIdx]&&BARS[t.exitIdx].time)||null, entryPrice:t.entryPrice, exitPrice:t.exitPrice, qty:t.qty, fees:(t.fees!=null?t.fees: ( (SETTINGS.feePct/100)*(t.entryPrice*t.qty + t.exitPrice*t.qty) )), pnl:t.pnl, fills: t.fills||[] }));
  return { ...stats, stats, trades: tradesOut };
}

self.onmessage = async (e)=>{
  const dat = (e && e.data) ? e.data : {};
  const id = dat.id;
  const type = dat.type;
  const payload = dat.payload || {};
  try {
    if(type==='init'){
      BARS = (payload && Array.isArray(payload.bars))? payload.bars : [];
      FROM = Number(payload && payload.fromIdx)||0; TO = Number(payload && payload.toIdx)||Math.max(0, BARS.length-1);
      SETTINGS = { startCapital: Number(payload && payload.settings && payload.settings.startCapital)||10000, feePct: Number(payload && payload.settings && payload.settings.feePct)||0.10, lev: Number(payload && payload.settings && payload.settings.lev)||1, maxPosPct: Number(payload && payload.settings && payload.settings.maxPosPct)||100, maxPosBase: String((payload && payload.settings && payload.settings.maxPosBase) || 'initial') };
      resetCaches();
      self.postMessage({ id, ok:true });
      return;
    }
    if(type==='eval'){
      const optsRaw = (payload && payload.opts) || {};
      const opts = sanitizeOpts(optsRaw);
      const preSig = (payload && Array.isArray(payload.preSig))? payload.preSig : null;
      const prePiv = (payload && Array.isArray(payload.prePiv))? payload.prePiv : null;
      const res = runBacktestWithBars(opts, FROM, TO, preSig, prePiv);
      self.postMessage({ id, ok:true, res });
      return;
    }
    throw new Error('unknown message');
  } catch(err){
    self.postMessage({ id, ok:false, error: String((err && err.message) || err) });
  }
};
