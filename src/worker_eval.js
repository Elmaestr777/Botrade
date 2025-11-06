/* worker_eval.js: Parallel backtest worker (mirrors runBacktestSliceFor from main.js) */

let BARS = [];
let S_IDX = 0;
let E_IDX = 0;
let CONF = { startCap: 10000, fee: 0.1, lev: 1, maxPct: 100, base: 'initial' };

function emaCalc(data, len){ const out=new Array(data.length); let k=2/(len+1); let prev=null; for(let i=0;i<data.length;i++){ const v=data[i].close; if(prev==null){ prev=v; } else { prev = v*k + prev*(1-k); } out[i]=prev; } return out; }
function computeLineBreakState(bars, nol){ const n=bars.length; if(!n) return {trend:[], level:[], flips:[]}; const trend=new Array(n).fill(0); const level=new Array(n).fill(null); const flips=[]; let t=bars[0].close>=bars[0].open?1:-1; let opens=[bars[0].open]; let closes=[bars[0].close]; for(let i=0;i<n;i++){ const c=bars[i].close; if(t===1){ const cnt=Math.min(nol, opens.length); const minUp=Math.min(...opens.slice(0,cnt), ...closes.slice(0,cnt)); if(c<minUp) t=-1; if(c>closes[0]||t===-1){ const o=(t===-1? opens[0]:closes[0]); opens.unshift(o); closes.unshift(c); } } else { const cnt=Math.min(nol, opens.length); const maxDn=Math.max(...opens.slice(0,cnt), ...closes.slice(0,cnt)); if(c>maxDn) t=1; if(c<closes[0]||t===1){ const o=(t===1? opens[0]:closes[0]); opens.unshift(o); closes.unshift(c); } } trend[i]=t; const cnt2=Math.min(nol, opens.length); const minUp2=Math.min(...opens.slice(0,cnt2), ...closes.slice(0,cnt2)); const maxDn2=Math.max(...opens.slice(0,cnt2), ...closes.slice(0,cnt2)); level[i]=(t===1? minUp2: maxDn2); if(i>0 && trend[i]!==trend[i-1]) flips.push(i); } return {trend, level, flips}; }
function computePivots(bars, prd){ const piv=[]; for(let i=prd;i<bars.length-prd;i++){ let isH=true, isL=true; for(let j=1;j<=prd;j++){ if(!(bars[i].high>bars[i-j].high && bars[i].high>bars[i+j].high)) isH=false; if(!(bars[i].low<bars[i-j].low && bars[i].low<bars[i+j].low)) isL=false; if(!isH&&!isL) break; } if(isH||isL) piv.push({ idx:i, time:bars[i].time, price: isH? bars[i].high : bars[i].low }); } return piv; }

function runBacktestSliceFor(bars, sIdx, eIdx, conf, params){
  const lb=computeLineBreakState(bars, Math.max(1, params.nol|0));
  const prd=Math.max(2, params.prd|0);
  const pivAll=computePivots(bars, prd);
  const emaTargetCache=new Map();
  const slEmaCache=new Map();
  let pivIdx=-1;
  function advancePivotIdxTo(i){ while(pivIdx+1<pivAll.length && pivAll[pivIdx+1].idx<=i){ pivIdx++; } }
  function segAtIdx(){ if(pivIdx>=1){ const a=pivAll[pivIdx-1], b=pivAll[pivIdx]; return { a, b, dir: b.price>a.price?'up':'down' }; } return null; }
  function computeSLFromLadder(dir, entry, i){ try{ if(!(params.slEnable && Array.isArray(params.sl) && params.sl.length)) return null; const seg=segAtIdx(); const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null; const cands=[]; for(const t of params.sl){ const typ=(t&&t.type)||'Percent'; let price=null; if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)) price = (seg.dir==='up')? (B - move*r) : (B + move*r); } else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)) price = dir==='long'? (entry*(1 - p/100)) : (entry*(1 + p/100)); } else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (params.emaLen||55)),10)); let ema=slEmaCache.get(len); if(!ema){ ema=emaCalc(bars, len); slEmaCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; } if(price!=null){ if(dir==='long'){ if(price<=entry) cands.push(price); } else { if(price>=entry) cands.push(price); } } } if(!cands.length) return null; return dir==='long'? Math.max(...cands) : Math.min(...cands); }catch(_){ return null; } }
  function buildTargets(dir, entry, riskAbs, i){ const tps=[]; if(params.tpEnable && Array.isArray(params.tp) && params.tp.length){ const seg=segAtIdx(); const A=seg?seg.a.price:null, B=seg?seg.b.price:null, move=seg?Math.abs(B-A):null; for(const t of params.tp){ let price=null; const typ=(t.type||'Fib'); if(typ==='Fib' && seg && move!=null){ const r=parseFloat(t.fib!=null? t.fib : t.value); if(isFinite(r)){ price = (seg.dir==='up')? (B + move*r) : (B - move*r); } } else if(typ==='Percent'){ const p=parseFloat(t.pct!=null? t.pct : t.value); if(isFinite(p)){ price = dir==='long'? (entry*(1+p/100)) : (entry*(1-p/100)); } } else if(typ==='EMA'){ const len=Math.max(1, parseInt(((t&&t.emaLen)!=null? t.emaLen : (params.emaLen||55)),10)); let ema=emaTargetCache.get(len); if(!ema){ ema=emaCalc(bars, len); emaTargetCache.set(len, ema); } const v=ema[Math.min(i, ema.length-1)]; if(isFinite(v)) price=v; } if(price!=null){ if((dir==='long' && price>entry) || (dir==='short' && price<entry)){ tps.push(price); } } } if(dir==='long') tps.sort((a,b)=>a-b); else tps.sort((a,b)=>b-a); } else { const mult=(typeof params.tp1R==='number' && params.tp1R>0)? params.tp1R : 1; const price=dir==='long'? (entry + riskAbs*mult) : (entry - riskAbs*mult); tps.push(price); } return tps; }
  let equity=conf.startCap; let peak=equity; let maxDDAbs=0; let grossProfit=0, grossLoss=0; let wins=0, losses=0; let rrSum=0; let tradesCount=0;
  let pos=null; let pendingFib=null;
  const feePct=conf.fee/100; const maxPct=conf.maxPct/100; const lev=conf.lev; const baseMode=conf.base;
  function __computeQty(entry, sl){ if(!(isFinite(entry)&&isFinite(sl))) return 0; if(equity<=0) return 0; const capBase=(baseMode==='equity')?equity:conf.startCap; const budget=Math.max(0, Math.min(capBase*maxPct, equity)); const notional=budget*lev; const qty0=notional/Math.max(1e-12, entry); const riskAbs=Math.abs(entry-sl); const perUnitWorstLoss = riskAbs + ((Math.abs(entry)+Math.abs(sl)) * feePct); const qtyRisk = perUnitWorstLoss>0? (equity / perUnitWorstLoss) : 0; const q=Math.max(0, Math.min(qty0, qtyRisk)); return q; }
  for(let i=Math.max(1,sIdx); i<=eIdx; i++){
    if(equity<=0) break;
    const bar=bars[i]; const trendNow=lb.trend[i]; const trendPrev=lb.trend[i-1];
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
        for(const lv of pendingFib.levels){ let ok=false; if(pendingFib.dir==='long'){ ok=(pendingFib.mode==='Touch')? (bar.low<=lv) : (bar.low<=lv && bar.close>lv); } else { ok=(pendingFib.mode==='Touch')? (bar.high>=lv) : (bar.high>=lv && bar.close<lv); } if(ok){ const dir=pendingFib.dir; const entry=bar.close; let sl=computeSLFromLadder(dir, entry, i); if(sl==null){ const riskPx=entry*(params.slInitPct/100); sl=dir==='long'?(entry-riskPx):(entry+riskPx); } else { if(dir==='long' && sl>entry) sl=entry; if(dir==='short' && sl<entry) sl=entry; } const qty=__computeQty(entry, sl); if(qty>1e-12 && isFinite(qty)){ const targets=buildTargets(dir, entry, Math.abs(entry-sl), i); pos={ dir, entry, sl, qty, entryIdx:i, beActive:false, risk: Math.abs(entry-sl)*qty, targets }; pendingFib=null; break; } }
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
      if(exit!=null){ const pnl = (pos.dir==='long'? (exit - pos.entry) : (pos.entry - exit)) * pos.qty; const fees = (pos.entry*pos.qty + exit*pos.qty) * feePct; const net = pnl - fees; equity += net; if(equity<0) equity=0; tradesCount++; if(pos.risk>0){ rrSum += (net/pos.risk); } if(net>=0){ grossProfit += net; wins++; } else { grossLoss += net; losses++; } if(equity>peak){ peak=equity; } const dd = peak - equity; if(dd>maxDDAbs){ maxDDAbs=dd; } pos=null; }
    }
  }
  const res = { equityFinal: equity, totalPnl: equity - conf.startCap, tradesCount: tradesCount, winrate: tradesCount? (wins/tradesCount*100):0, avgRR: tradesCount? (rrSum/tradesCount):0, profitFactor: (grossLoss<0? (grossProfit/Math.abs(grossLoss)) : (tradesCount? Infinity:0)), maxDDAbs };
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
