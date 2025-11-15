/* worker_eval.js: Parallel backtest worker (mirrors runBacktestSliceFor from main.js) */

let BARS = [];
let S_IDX = 0;
let E_IDX = 0;
let CONF = { startCap: 10000, fee: 0.1, lev: 1, maxPct: 100, base: 'initial' };
// Simple caches per worker session to speed repeated evals
const __LB_CACHE = new Map(); // nol -> lb
const __PIV_CACHE = new Map(); // prd -> pivots
const __EMA_CACHE = new Map(); // len -> ema array

function emaCalc(data, len){ const out=new Array(data.length); let k=2/(len+1); let prev=null; for(let i=0;i<data.length;i++){ const v=data[i].close; if(prev==null){ prev=v; } else { prev = v*k + prev*(1-k); } out[i]=prev; } return out; }
function getEMA(len){ let arr=__EMA_CACHE.get(len); if(!arr){ arr=emaCalc(BARS, Math.max(1, len|0)); __EMA_CACHE.set(len, arr); } return arr; }
function computeLineBreakState(bars, nol){ const n=bars.length; if(!n) return {trend:[], level:[], flips:[]}; const trend=new Array(n).fill(0); const level=new Array(n).fill(null); const flips=[]; let t=bars[0].close>=bars[0].open?1:-1; let opens=[bars[0].open]; let closes=[bars[0].close]; for(let i=0;i<n;i++){ const c=bars[i].close; if(t===1){ const cnt=Math.min(nol, opens.length); const minUp=Math.min(...opens.slice(0,cnt), ...closes.slice(0,cnt)); if(c<minUp) t=-1; if(c>closes[0]||t===-1){ const o=(t===-1? opens[0]:closes[0]); opens.unshift(o); closes.unshift(c); } } else { const cnt=Math.min(nol, opens.length); const maxDn=Math.max(...opens.slice(0,cnt), ...closes.slice(0,cnt)); if(c>maxDn) t=1; if(c<closes[0]||t===1){ const o=(t===1? opens[0]:closes[0]); opens.unshift(o); closes.unshift(c); } } trend[i]=t; const cnt2=Math.min(nol, opens.length); const minUp2=Math.min(...opens.slice(0,cnt2), ...closes.slice(0,cnt2)); const maxDn2=Math.max(...opens.slice(0,cnt2), ...closes.slice(0,cnt2)); level[i]=(t===1? minUp2: maxDn2); if(i>0 && trend[i]!==trend[i-1]) flips.push(i); } return {trend, level, flips}; }
function computePivots(bars, prd){ const piv=[]; for(let i=prd;i<bars.length-prd;i++){ let isH=true, isL=true; for(let j=1;j<=prd;j++){ if(!(bars[i].high>bars[i-j].high && bars[i].high>bars[i+j].high)) isH=false; if(!(bars[i].low<bars[i-j].low && bars[i].low<bars[i+j].low)) isL=false; if(!isH&&!isL) break; } if(isH||isL) piv.push({ idx:i, time:bars[i].time, price: isH? bars[i].high : bars[i].low }); } return piv; }

function mean(a){ return a.length? a.reduce((x,y)=>x+y,0)/a.length : 0; }
function std(a){ const m=mean(a); const v=a.length? a.reduce((s,v)=> s+(v-m)*(v-m),0)/a.length : 0; return Math.sqrt(v); }
function linReg(y){ const n=y.length; if(n<2) {return {slope:0,r2:0};} const xs=Array.from({length:n},(_,i)=>i); const mx=(n-1)/2; const my=mean(y); let num=0,den=0,sst=0,sse=0; for(let i=0;i<n;i++){ const dx=xs[i]-mx; num+=dx*(y[i]-my); den+=dx*dx; } const a=num/Math.max(1e-9,den); const b=my - a*mx; for(let i=0;i<n;i++){ const fit=a*xs[i]+b; const err=y[i]-fit; sse+=err*err; const dy=y[i]-my; sst+=dy*dy; } return { slope:a, r2: sst>0? 1 - sse/sst : 0 }; }

function runBacktestSliceFor(bars, sIdx, eIdx, conf, params){
  // Heaven-fidelity backtest (partial exits, per-TP BE/trails, attached SL per TP, compound/close-all-last)
  const nolVal=Math.max(1, params.nol|0);
  const lb = (__LB_CACHE.get(nolVal) || (function(){ const v=computeLineBreakState(bars, nolVal); __LB_CACHE.set(nolVal, v); return v; })());
  const prd=Math.max(2, params.prd|0);
  const pivAll = (__PIV_CACHE.get(prd) || (function(){ const v=computePivots(bars, prd); __PIV_CACHE.set(prd, v); return v; })());
  const emaTargetCache=new Map();
  const slEmaCache=new Map();
  let pivIdx=-1;
  function advancePivotIdxTo(i){ while(pivIdx+1<pivAll.length && pivAll[pivIdx+1].idx<=i){ pivIdx++; } }
  function segAtIdx(){ if(pivIdx>=1){ const a=pivAll[pivIdx-1], b=pivAll[pivIdx]; return { a, b, dir: b.price>a.price?'up':'down' }; } return null; }
  function computeSLFromLadder(dir, entry, i){
    try{
      if(!(params.slEnable && Array.isArray(params.sl) && params.sl.length)) return null;
      const seg=segAtIdx(); const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null; const cands=[];
      for(const t of params.sl){ const typ=(t&&t.type)||'Percent'; let price=null;
        if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B - move*r) : (B + move*r); }
        else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1 - p/100)) : (entry*(1 + p/100)); }
        else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (params.emaLen||55)),10)); let ema=slEmaCache.get(len); if(!ema){ ema=getEMA(len); slEmaCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; }
        if(price!=null){ if(dir==='long'){ if(price<=entry) cands.push(price); } else { if(price>=entry) cands.push(price); } }
      }
      if(!cands.length) return null; return dir==='long'? Math.max(...cands) : Math.min(...cands);
    }catch(_){ return null; }
  }
  const tpCompound = (typeof params.tpCompound==='boolean')? params.tpCompound : true;
  const tpCloseAllLast = (typeof params.tpCloseAllLast==='boolean')? params.tpCloseAllLast : true;
  function buildTargets(dir, entry, riskAbs, i){
    let list=[];
    if(params.tpEnable && Array.isArray(params.tp) && params.tp.length){
      const seg=segAtIdx(); const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null;
      for(let idx=0; idx<params.tp.length; idx++){
        const t=params.tp[idx]; let price=null; const typ=(t.type||'Fib');
        if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B + move*r) : (B - move*r); }
        else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1+p/100)) : (entry*(1-p/100)); }
        else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (params.emaLen||55)),10)); let ema=emaTargetCache.get(len); if(!ema){ ema=getEMA(len); emaTargetCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; }
        if(price!=null){ if((dir==='long' && price>entry) || (dir==='short' && price<entry)){
          let w=null; const q=t.qty; if(q!=null && isFinite(q)){ w = (q>1? q/100 : q); }
          list.push({price, w, srcIdx: idx});
        } }
      }
      if(dir==='long') list.sort((a,b)=>a.price-b.price); else list.sort((a,b)=>b.price-a.price);
      let sumW=0, hasW=false; for(const it of list){ if(it.w!=null && it.w>0){ sumW+=it.w; hasW=true; } }
      if(!hasW){ if(list.length){ const even=1/list.length; list=list.map(it=>({ price:it.price, w:even, srcIdx: it.srcIdx })); } else { list=[{price: (dir==='long'? entry + riskAbs*(params.tp1R||1) : entry - riskAbs*(params.tp1R||1)), w:1, srcIdx: 0}]; } }
      else { if(sumW>1){ const k=1/sumW; for(const it of list){ if(it.w!=null) it.w*=k; } }
      }
      if(tpCloseAllLast && list.length){ let s=0; for(const it of list){ s+=(it.w||0); } if(s<1){ list[list.length-1].w = (list[list.length-1].w||0) + (1-s); } }
      return list;
    } else {
      return [{ price: dir==='long'? (entry + riskAbs*(params.tp1R||1)) : (entry - riskAbs*(params.tp1R||1)), w:1, srcIdx: 0 }];
    }
  }
  let equity=conf.startCap; let peak=equity; let maxDDAbs=0; let grossProfit=0, grossLoss=0; let wins=0, losses=0; let rrSum=0; let tradesCount=0;
  let positions=[]; let pendingFib=null;
  const returns=[]; const eqSeries=[];
  const feePct=conf.fee/100; const maxPct=conf.maxPct/100; const lev=conf.lev; const baseMode=conf.base;
  function __computeQty(entry, sl){ if(!(isFinite(entry)&&isFinite(sl))) return 0; if(equity<=0) return 0; const capBase=(baseMode==='equity')?equity:conf.startCap; const budget=Math.max(0, Math.min(capBase*maxPct, equity)); const notional=budget*lev; const qty0=notional/Math.max(1e-12, entry); const riskAbs=Math.abs(entry-sl); const perUnitWorstLoss = riskAbs + ((Math.abs(entry)+Math.abs(sl)) * feePct); const qtyRisk = perUnitWorstLoss>0? (equity / perUnitWorstLoss) : 0; const q=Math.max(0, Math.min(qty0, qtyRisk)); return q; }
  function tryOpen(dir, entry, i){ let sl=computeSLFromLadder(dir, entry, i); if(sl==null){ const riskPx=entry*(params.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; } const initQty=__computeQty(entry, sl); if(initQty>1e-12 && isFinite(initQty)){ const targets=buildTargets(dir, entry, Math.abs(entry-sl), i); positions.push({ dir, entry, sl, initSL:sl, qty:initQty, initQty, entryIdx:i, beActive:false, anyTP:false, tpIdx:0, targets, risk: Math.abs(entry-sl)*initQty, hiSince: bars[i].high, loSince: bars[i].low, lastTpIdx: 0, tpTrailCfg: null, slTrailCfg: null }); } }
  for(let i=Math.max(1,sIdx); i<=eIdx; i++){
    if(equity<=0) break;
    const bar=bars[i]; const trendNow=lb.trend[i]; const trendPrev=lb.trend[i-1];
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
      if(pos.tpTrailCfg){ try{ let cand=null; if(pos.tpTrailCfg.mode==='ema'){ const len=Math.max(1, parseInt((pos.tpTrailCfg.emaLen!=null? pos.tpTrailCfg.emaLen : (params.emaLen||55)),10)); const ema=getEMA(len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(pos.tpTrailCfg.mode==='percent'){ const pct=Number(pos.tpTrailCfg.pct)||0; cand = (pos.dir==='long')? ( (pos.hiSince||bar.high)*(1 - pct/100) ) : ( (pos.loSince||bar.low)*(1 + pct/100) ); } if(cand!=null){ let b=cand; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(cand, pos.entry) : Math.max(cand, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }catch(_){ } }
      if(pos.slTrailCfg){ try{ let cand=null; if(pos.slTrailCfg.mode==='ema'){ const len=Math.max(1, parseInt((pos.slTrailCfg.emaLen!=null? pos.slTrailCfg.emaLen : (params.emaLen||55)),10)); const ema=getEMA(len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(pos.slTrailCfg.mode==='percent'){ const pct=Number(pos.slTrailCfg.pct)||0; cand = (pos.dir==='long')? ( (pos.hiSince||bar.high)*(1 - pct/100) ) : ( (pos.loSince||bar.low)*(1 + pct/100) ); } if(cand!=null){ let b=cand; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(cand, pos.entry) : Math.max(cand, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }catch(_){ } }
      { const sl2=computeSLFromLadder(pos.dir, pos.entry, i); if(sl2!=null){ let b=sl2; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(sl2, pos.entry) : Math.max(sl2, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } }
      // SL check
      let closedBySL=false;
      if(pos.dir==='long'){
        if(bar.low <= pos.sl){ const portionQty = pos.qty; const pnl = (pos.sl - pos.entry) * portionQty; const fees = (pos.entry*portionQty + pos.sl*portionQty) * feePct; const net=pnl-fees; const eqBefore=equity; equity+=net; if(equity<0) equity=0; tradesCount++; if(eqBefore>0) returns.push(net/eqBefore); eqSeries.push(equity/Math.max(1e-9, conf.startCap)); if(pos.risk>0) rrSum+=(net/pos.risk); if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; } if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd; closedBySL=true; }
      } else {
        if(bar.high >= pos.sl){ const portionQty = pos.qty; const pnl = (pos.entry - pos.sl) * portionQty; const fees = (pos.entry*portionQty + pos.sl*portionQty) * feePct; const net=pnl-fees; const eqBefore=equity; equity+=net; if(equity<0) equity=0; tradesCount++; if(eqBefore>0) returns.push(net/eqBefore); eqSeries.push(equity/Math.max(1e-9, conf.startCap)); if(pos.risk>0) rrSum+=(net/pos.risk); if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; } if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd; closedBySL=true; }
      }
      if(closedBySL){ positions.splice(k,1); continue; }
      // TP sequential
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
          const net = pnl - fees; const eqBefore=equity; equity += net; if(equity<0) equity=0; tradesCount++; if(eqBefore>0) returns.push(net/eqBefore); eqSeries.push(equity/Math.max(1e-9, conf.startCap)); if(pos.risk>0) rrSum += (net/pos.risk); if(net>=0){ grossProfit+=net; wins++; } else { grossLoss+=net; losses++; } if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDDAbs) maxDDAbs=dd;
          pos.qty -= usedQty; pos.anyTP=true;
          let tCfg = (Array.isArray(params.tp) && tp.srcIdx!=null)? params.tp[tp.srcIdx] : null; if(!tCfg){ tCfg={}; }
          if(tCfg.beOn){ pos.sl = pos.entry; }
          const slNew=(function(){ try{ const seg=segAtIdx(); const s=tCfg.sl; if(!(seg && s)) return null; let price=null; if(s.type==='Fib'){ const A=seg.a.price, B=seg.b.price; const move=Math.abs(B-A); const r=parseFloat(s.fib!=null? s.fib : s.value); if(isFinite(r)) price = (seg.dir==='up')? (B - move*r) : (B + move*r); } else if(s.type==='Percent'){ const p=parseFloat(s.pct!=null? s.pct : s.value); if(isFinite(p)) price = pos.dir==='long'? (pos.entry*(1 - p/100)) : (pos.entry*(1 + p/100)); } else if(s.type==='EMA'){ const len=Math.max(1, parseInt(((s&&s.emaLen)!=null? s.emaLen : (params.emaLen||55)),10)); const ema=getEMA(len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; } return price; }catch(_){ return null; } })(); if(slNew!=null){ let b=slNew; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(slNew, pos.entry) : Math.max(slNew, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } if(tCfg.trail && tCfg.trail.mode){ let cand=null; const m=tCfg.trail.mode; if(m==='be'){ cand=pos.entry; } else if(m==='prev'){ cand=exitPx; } else if(m==='ema'){ const len=Math.max(1, parseInt(((tCfg.trail.emaLen!=null? tCfg.trail.emaLen : (params.emaLen||55))),10)); const ema=getEMA(len); const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) cand=v; } else if(m==='percent'){ const pct=Number(tCfg.trail.pct)||0; cand = (pos.dir==='long')? ( (pos.hiSince||bar.high)*(1 - pct/100) ) : ( (pos.loSince||bar.low)*(1 + pct/100) ); } if(cand!=null){ let b=cand; if(!pos.beActive){ b=(pos.dir==='long')? Math.min(cand, pos.entry) : Math.max(cand, pos.entry); } pos.sl = (pos.dir==='long')? Math.max(pos.sl, b) : Math.min(pos.sl, b); } if(m==='ema' || m==='percent'){ pos.tpTrailCfg = { mode:m, emaLen: tCfg.trail.emaLen, pct: tCfg.trail.pct }; } } if(tCfg.sl && tCfg.sl.trail && tCfg.sl.trail.mode){ const m2=tCfg.sl.trail.mode; if(m2==='ema' || m2==='percent'){ pos.slTrailCfg = { mode:m2, emaLen: tCfg.sl.trail.emaLen, pct: tCfg.sl.trail.pct }; } } if(!tpCompound || pos.qty<=1e-12){ positions.splice(k,1); break; } pos.tpIdx++; }
    }
    }
  }
  const totalPnl = equity - conf.startCap;
  const sharpe=(function(){ const m=mean(returns), s=std(returns); return s>0? m/s : 0; })();
  let slope=0, r2=0;
  if(eqSeries.length>=2){ const lr=linReg(eqSeries); slope=lr.slope; r2=lr.r2; }
  const retPct = conf.startCap>1e-9? (totalPnl/conf.startCap*100) : 0;
  const expectancy = returns.length? (mean(returns)*100) : 0;
  const positives = returns.filter(x=> x>=0).length;
  const consistency = returns.length? positives/returns.length : 0;
  const res = {
    equityFinal: equity,
    totalPnl,
    tradesCount: tradesCount,
    winrate: tradesCount? (wins/tradesCount*100):0,
    avgRR: tradesCount? (rrSum/tradesCount):0,
    profitFactor: (grossLoss<0? (grossProfit/Math.abs(grossLoss)) : (tradesCount? Infinity:0)),
    maxDDAbs,
    sharpe,
    slope,
    r2,
    retPct,
    expectancy,
    consistency,
  };
  return res;
}

self.onmessage = (e)=>{
  const dat = e && e.data || {};
  const type = dat.type;
  try{
    if(type==='init'){
      const p = dat.payload || {};
      BARS = Array.isArray(p.bars)? p.bars : [];
      S_IDX = +p.sIdx || 0;
      E_IDX = +p.eIdx || (BARS.length-1);
      const c=p.conf||{}; CONF = { startCap:+(c.startCap||10000), fee:+(c.fee||0.1), lev:+(c.lev||1), maxPct:+(c.maxPct||100), base: String(c.base||'initial') };
      try{ __LB_CACHE.clear(); __PIV_CACHE.clear(); __EMA_CACHE.clear(); }catch(_){ }
      self.postMessage({ ok:true });
      return;
    }
    if(type==='eval'){
      const params = (dat.payload && dat.payload.params) || {};
      const res = runBacktestSliceFor(BARS, S_IDX, E_IDX, CONF, params);
      self.postMessage({ ok:true, res });
      return;
    }
    self.postMessage({ ok:false, error:'unknown message' });
  }catch(err){
    self.postMessage({ ok:false, error: String(err && err.message || err) });
  }
};
