import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.runner') });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const BINANCE_WS = process.env.BINANCE_WS || 'wss://stream.binance.com:9443/ws';
const BINANCE_REST = process.env.BINANCE_REST || 'https://api.binance.com/api/v3/klines';

if(!SUPABASE_URL || !SUPABASE_KEY){
  console.error('[runner] Missing SUPABASE_URL/SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession:false } });

function sleep(ms){ return new Promise(r=> setTimeout(r, ms)); }

function lbState(bars, nol){ const n=bars.length; if(!n) return {trend:[],level:[],flips:[]}; const trend=new Array(n).fill(0); const level=new Array(n).fill(null); const flips=[]; let t=bars[0].close>=bars[0].open?1:-1; let opens=[bars[0].open]; let closes=[bars[0].close]; for(let i=0;i<n;i++){ const c=bars[i].close; if(t===1){ const cnt=Math.min(nol, opens.length); const minUp=Math.min(...opens.slice(0,cnt), ...closes.slice(0,cnt)); if(c<minUp) t=-1; if(c>closes[0]||t===-1){ const o=(t===-1? opens[0]:closes[0]); opens.unshift(o); closes.unshift(c);} } else { const cnt=Math.min(nol, opens.length); const maxDn=Math.max(...opens.slice(0,cnt), ...closes.slice(0,cnt)); if(c>maxDn) t=1; if(c<closes[0]||t===1){ const o=(t===1? opens[0]:closes[0]); opens.unshift(o); closes.unshift(c);} } trend[i]=t; const cnt2=Math.min(nol, opens.length); const minUp2=Math.min(...opens.slice(0,cnt2), ...closes.slice(0,cnt2)); const maxDn2=Math.max(...opens.slice(0,cnt2), ...closes.slice(0,cnt2)); level[i]=(t===1? minUp2: maxDn2); if(i>0 && trend[i]!==trend[i-1]) flips.push(i);} return {trend,level,flips}; }
function pivots(bars, prd){ const piv=[]; for(let i=prd;i<bars.length-prd;i++){ let isH=true,isL=true; for(let j=1;j<=prd;j++){ if(!(bars[i].high>bars[i-j].high && bars[i].high>bars[i+j].high)) isH=false; if(!(bars[i].low<bars[i-j].low && bars[i].low<bars[i+j].low)) isL=false; if(!isH&&!isL) break; } if(isH||isL) piv.push({ idx:i, time:bars[i].time, price:isH?bars[i].high:bars[i].low }); } return piv; }
function lastConfirmedSeg(piv, currentIdx, prd){ const available=(piv||[]).filter(p=>p.idx+prd<currentIdx); if(available.length<2) return null; const a=available[available.length-2], b=available[available.length-1]; return { a,b, dir:b.price>a.price?'up':'down' }; }
function emaAt(bars, len, idx){ const k=2/(Math.max(1,len)+1); let ema=null; for(let i=0;i<=idx && i<bars.length;i++){ const v=bars[i].close; ema=(ema==null? v : v*k + ema*(1-k)); } return ema; }
function intervalSeconds(tf){ const m=String(tf||'').match(/^(\d+)([mhdw])$/i); if(!m) return 60; const n=Math.max(1,Number(m[1])||1); const unit=m[2].toLowerCase(); return n*(unit==='m'?60:unit==='h'?3600:unit==='d'?86400:604800); }
function sessionEquity(st){ return Number(st.equity??st.start_cap??0)||0; }

async function fetchRecentClosedBars(symbol, tf, limit=1000){
  const url=new URL(BINANCE_REST); url.searchParams.set('symbol', String(symbol).toUpperCase()); url.searchParams.set('interval', String(tf)); url.searchParams.set('limit', String(limit));
  const res=await fetch(url); if(!res.ok) throw new Error(`Binance klines HTTP ${res.status}`);
  const now=Date.now(); const raw=await res.json(); const bars=(Array.isArray(raw)?raw:[]).filter(k=>Number(k[6])<=now).map(k=>({ time:Math.floor(Number(k[0])/1000), open:Number(k[1]), high:Number(k[2]), low:Number(k[3]), close:Number(k[4]), closed:true }));
  bars.sort((a,b)=>a.time-b.time); return bars;
}

const groupKey = (s)=> `${String(s.symbol).toUpperCase()}|${String(s.tf)}`;
const sessions = new Map(); // id -> state
const groups = new Map();   // key -> { ws, refs:Set(sessionId), reconnectTimer, backoff, closed }

async function fetchActiveSessions(){
  const { data, error } = await supa.from('live_sessions').select('*').eq('active', true).limit(500);
  if(error) throw new Error(`fetch sessions: ${error.message||error}`);
  return Array.isArray(data)? data:[];
}

function openStream(symbol, tf){
  const stream = `${symbol.toLowerCase()}@kline_${tf}`;
  const url = `${BINANCE_WS}/${stream}`;
  const ws = new WebSocket(url);
  return { ws, stream };
}

function connectGroup(g){
  if(g.closed || g.refs.size===0) return;
  const { ws, stream } = openStream(g.sym, g.tf);
  g.ws=ws;
  ws.on('open', ()=>{ g.backoff=1000; console.log('[ws] open', stream); });
  ws.on('error', (e)=> console.warn('[ws] error', stream, e.message||e));
  ws.on('close', ()=>{ console.log('[ws] close', stream); if(g.closed || g.refs.size===0) return; const base=Math.min(30000, Math.max(1000, g.backoff||1000)); const jitter=Math.floor(Math.random()*Math.min(1000, base*0.2)); g.backoff=Math.min(30000, Math.round(base*1.5)); clearTimeout(g.reconnectTimer); g.reconnectTimer=setTimeout(()=> connectGroup(g), base+jitter); });
  ws.on('message', async (raw)=>{ try{ const msg=JSON.parse(raw.toString()); const k = (msg && msg.k) || (msg && msg.data && msg.data.k); if(!k) return; const bar={ time: Math.floor(k.t/1000), open:+k.o, high:+k.h, low:+k.l, close:+k.c, closed: !!k.x };
    for(const id of g.refs){ const st=sessions.get(id); if(!st) continue; await onBar(st, bar); }
  }catch(_){ } });
}

function closeGroup(g){
  g.closed=true;
  clearTimeout(g.reconnectTimer);
  try{ if(g.ws && (g.ws.readyState===WebSocket.OPEN || g.ws.readyState===WebSocket.CONNECTING)) g.ws.close(); }catch(_){ }
}

function ensureGroup(sym, tf){ const key=`${sym}|${tf}`; let g=groups.get(key); if(!g){ g={ key, sym, tf, ws:null, refs:new Set(), reconnectTimer:null, backoff:1000, closed:false };
  groups.set(key, g); }
  return g;
}

async function onBar(st, bar){
  if(!bar.closed) return;
  if(Number(st.last_bar_time||0)>0 && bar.time<=Number(st.last_bar_time)) return;
  // Simple per-bar engine replicating edge logic
  const p = st.params; const feePct=(Number(st.fee)||0.1)/100; const lev=Number(st.lev)||1;
  // Maintain rolling arrays (small for lb/piv)
  if(!st.bars) st.bars=[]; const arr=st.bars; const last=arr[arr.length-1]; if(last && last.time===bar.time){ arr[arr.length-1]=bar; } else { arr.push(bar); if(arr.length>2000) arr.shift(); }
  const prd=Math.max(2, parseInt(p.prd||15)); const lb = lbState(arr, Math.max(1, parseInt(p.nol||3))); const piv = pivots(arr, prd);
  const i = arr.length-1; const trendNow=lb.trend[i], trendPrev=lb.trend[i-1]??trendNow;
  const segAtOpen=lastConfirmedSeg(piv, i, prd); const segAtClose=lastConfirmedSeg(piv, i+1, prd);
  const emit = async (kind, payload)=>{ const row={ session_id: st.id, kind, at_time: new Date((payload.time||bar.time)*1000).toISOString(), payload }; const { error } = await supa.from('live_events').insert([row]); if(error) console.warn('[runner] insert event', error.message||error); };
  if(st.pos && st.pos.pending){
    const pending=st.pos; st.pos=null;
    const dir=pending.dir; const entry=bar.open; const riskPx=entry*((Number(p.slInitPct||2.0))/100); const sl=dir==='long'? (entry-riskPx) : (entry+riskPx);
    const equity=sessionEquity(st); const notional=equity*Math.max(1,lev); const qty0=notional/Math.max(1e-12, entry); const riskAbs=Math.abs(entry-sl); const perUnit=riskAbs+((Math.abs(entry)+Math.abs(sl))*feePct); const riskPct=(p.riskMgmt===false)?100:Math.max(0,Number(p.riskMaxPct)||1); const qtyRisk=perUnit>0?((equity*riskPct/100)/perUnit):0; const qty=Math.max(0,Math.min(qty0,qtyRisk));
    if(qty>1e-12){ const targets=buildTargets(p, segAtOpen, dir, entry, riskAbs, arr, Math.max(0,i-1)); st.pos={ dir, entry, sl, initSL:sl, qty, initQty:qty, entryTime:bar.time, beActive:false, tpIdx:0, targets, hiSince:entry, loSince:entry };
      await emit('entry', { time:bar.time, signalTime:pending.signalTime, dir, entry, sl, qty }); }
  }
  if(st.pos && !Array.isArray(st.pos.targets)){ const initSL=Number(st.pos.initSL!=null?st.pos.initSL:st.pos.sl); const riskAbs=Math.abs(Number(st.pos.entry)-initSL); st.pos.targets=buildTargets(p, segAtClose, st.pos.dir, Number(st.pos.entry), riskAbs, arr, i); }
  if(st.pos){
    const pos=st.pos; pos.hiSince=Math.max(pos.hiSince||bar.high, bar.high); pos.loSince=Math.min(pos.loSince||bar.low, bar.low);
    if(p.beEnable && !pos.beActive){ const barsSince=Math.max(0,Math.floor((bar.time-pos.entryTime)/intervalSeconds(st.tf))); const movePct = pos.dir==='long'? ((bar.high-pos.entry)/pos.entry*100) : ((pos.entry-bar.low)/pos.entry*100); if(barsSince>=Math.max(1,parseInt(p.beAfterBars||5)) && movePct >= Number(p.beLockPct||5.0)){ pos.beActive=true; pos.sl=pos.entry; await emit('be', { time: bar.time, dir:pos.dir, sl:pos.sl }); } }
    // SL check
    if(pos.dir==='long'){
      if(bar.low <= pos.sl){ const pnl=(pos.sl - pos.entry)*pos.qty; const fees=(pos.entry*pos.qty + pos.sl*pos.qty)*feePct; const net=pnl-fees; st.equity = sessionEquity(st) + net; if(st.equity<0) st.equity=0; await emit('sl', { time: bar.time, dir:pos.dir, entry:pos.entry, exit:pos.sl, qty:pos.qty, pnl, fees, net }); st.pos=null; }
    } else {
      if(bar.high >= pos.sl){ const pnl=(pos.entry - pos.sl)*pos.qty; const fees=(pos.entry*pos.qty + pos.sl*pos.qty)*feePct; const net=pnl-fees; st.equity=sessionEquity(st)+net; if(st.equity<0) st.equity=0; await emit('sl', { time: bar.time, dir:pos.dir, entry:pos.entry, exit:pos.sl, qty:pos.qty, pnl, fees, net }); st.pos=null; }
    }
    // TP check (sequential)
    if(st.pos && Array.isArray(st.pos.targets) && st.pos.tpIdx < st.pos.targets.length){
      while(st.pos && st.pos.tpIdx<st.pos.targets.length){ const tp=st.pos.targets[st.pos.tpIdx]; const hit = st.pos.dir==='long'? (bar.high>=tp.price) : (bar.low<=tp.price); if(!hit) break; const usedQty = Math.min(st.pos.initQty*(tp.w||1), st.pos.qty); const exitPx=tp.price; const pnl=(st.pos.dir==='long'? (exitPx - st.pos.entry):(st.pos.entry - exitPx))*usedQty; const fees=(st.pos.entry*usedQty + exitPx*usedQty)*feePct; const net=pnl-fees; st.equity=sessionEquity(st)+net; if(st.equity<0) st.equity=0; await emit('tp', { time: bar.time, dir:st.pos.dir, entry:st.pos.entry, exit:exitPx, qty:usedQty, pnl, fees, net, idx: st.pos.tpIdx+1 }); st.pos.qty -= usedQty; st.pos.tpIdx++; if(!p.tpCompound || st.pos.qty<=1e-12){ st.pos=null; break; } }
    }
  }
  if(trendNow!==trendPrev && p.entryMode!=='Fib Retracement'){
    const nextDir=(trendNow===1?'long':'short');
    if(st.pos && st.pos.dir!==nextDir){ const exit=bar.close; const qty=st.pos.qty; const pnl=(st.pos.dir==='long'? (exit-st.pos.entry):(st.pos.entry-exit))*qty; const fees=(st.pos.entry*qty+exit*qty)*feePct; const net=pnl-fees; st.equity=sessionEquity(st)+net; if(st.equity<0) st.equity=0; await emit('flip', { time:bar.time, dir:st.pos.dir, entry:st.pos.entry, exit, qty, pnl, fees, net }); st.pos=null; }
    if(!st.pos) st.pos={ pending:true, dir:nextDir, signalTime:bar.time };
  }
  st.last_bar_time = bar.time;
  // Throttle session update writes
  const now=Date.now(); if(!st.__lastSave || (now - st.__lastSave)>1500 || bar.closed){ st.__lastSave=now; const upd={ equity: st.equity, last_bar_time: st.last_bar_time, pos: st.pos, updated_at: new Date().toISOString() }; const { error:e2 }=await supa.from('live_sessions').update(upd).eq('id', st.id); if(e2) console.warn('[runner] update session', e2.message||e2); }
}

function mergeDuplicateTargets(list){ const out=[]; const seen=new Map(); for(const raw of Array.isArray(list)?list:[]){ const price=Number(raw&&raw.price); if(!Number.isFinite(price)) continue; const key=price.toFixed(8); const w=(raw.w!=null && isFinite(raw.w))? Number(raw.w): null; const existing=seen.get(key); if(existing){ if(w!=null) existing.w=(existing.w!=null && isFinite(existing.w))? existing.w+w : w; } else { const t={...raw, price}; if(w!=null) t.w=w; seen.set(key,t); out.push(t); } } return out; }
function buildTargets(params, segLast, dir, entry, riskAbs, bars, i){
  let out=[]; if(params.tpEnable && Array.isArray(params.tp) && params.tp.length){ const A=segLast?segLast.a.price:null, B=segLast?segLast.b.price:null, move=segLast?Math.abs(B-A):null; for(let idx=0; idx<params.tp.length; idx++){ const t=params.tp[idx]; let price=null; const typ=String(t.type||'Fib'); if(typ==='Fib' && segLast && move!=null){ const r=parseFloat((t.fib!=null? t.fib : t.value)); if(isFinite(r)) price = (segLast.dir==='up')? (B + move*r) : (B - move*r); } else if(typ==='Percent'){ const p=parseFloat((t.pct!=null? t.pct : t.value)); if(isFinite(p)) price = dir==='long'? (entry*(1+p/100)) : (entry*(1-p/100)); } else if(typ==='EMA'){ const len=Math.max(1,parseInt((t.emaLen!=null?t.emaLen:(params.emaLen||55)),10)); price=emaAt(bars,len,i); } if(price!=null){ if((dir==='long' && price>entry) || (dir==='short' && price<entry)){ let w=null; const q=t.qty; if(q!=null && isFinite(q)) w=(q>1? q/100 : q); out.push({ price, w, srcIdx: idx }); } } } out=mergeDuplicateTargets(out); if(dir==='long') out.sort((a,b)=>a.price-b.price); else out.sort((a,b)=>b.price-a.price); let sumW=0, hasW=false; for(const it of out){ if(it.w!=null && it.w>0){ sumW+=it.w; hasW=true; } } if(!hasW){ if(out.length){ const even=1/out.length; for(const it of out) it.w=even; } else { out.push({ price: dir==='long'? (entry + riskAbs*(params.tp1R||1)) : (entry - riskAbs*(params.tp1R||1)), w:1, srcIdx:0 }); } } else { if(sumW>1){ const k=1/sumW; for(const it of out){ if(it.w!=null) it.w*=k; } } else if(params.tpCloseAllLast && sumW<1 && out.length){ const last=out[out.length-1]; last.w=(last.w||0)+(1-sumW); } } } else { out.push({ price: dir==='long'? (entry + riskAbs*(params.tp1R||1)) : (entry - riskAbs*(params.tp1R||1)), w:1, srcIdx:0 }); } return out; }

async function syncSessions(){
  const act=await fetchActiveSessions(); const byKey=new Map(); for(const s of act){ const k=groupKey(s); let g=byKey.get(k); if(!g){ g={ sym:String(s.symbol).toUpperCase(), tf:String(s.tf), list:[] }; byKey.set(k,g); } g.list.push(s); }
  // mount streams
  for(const [k,grp] of byKey.entries()){
    const g=ensureGroup(grp.sym, grp.tf);
    for(const s of grp.list){
      if(!sessions.has(s.id)){
        const warmup=await fetchRecentClosedBars(grp.sym, grp.tf, 1000); const lastTs=Number(s.last_bar_time||0)||0;
        const oldestContinuousTs=(warmup[0]?.time||0)-intervalSeconds(grp.tf);
        if(lastTs>0 && warmup.length && lastTs<oldestContinuousTs){
          const nowIso=new Date().toISOString(); const payload={ code:'history_gap', message:'Session stopped because the available Binance window cannot cover all missed candles.', last_bar_time:lastTs, oldest_available_time:warmup[0].time };
          const { error:eventError }=await supa.from('live_events').insert([{ session_id:s.id, kind:'info', at_time:nowIso, payload }]); if(eventError) console.warn('[runner] insert history gap event', eventError.message||eventError);
          const { error:gapError }=await supa.from('live_sessions').update({ active:false, updated_at:nowIso }).eq('id',s.id); if(gapError) console.warn('[runner] stop session with history gap', gapError.message||gapError);
          continue;
        }
        const context=lastTs>0?warmup.filter(b=>b.time<=lastTs):warmup; const st={ ...s, params:(s.strategy_params||{}), fee:s.fee, lev:s.lev, equity:Number(s.equity??s.start_cap??0)||0, bars:context.slice(-2000), pos:s.pos||null, last_bar_time:lastTs||(warmup[warmup.length-1]?.time||0) };
        sessions.set(s.id,st);
        if(lastTs>0){ for(const missed of warmup.filter(b=>b.time>lastTs)){ await onBar(st,missed); } }
        else if(st.last_bar_time>0){ const { error }=await supa.from('live_sessions').update({ last_bar_time:st.last_bar_time, updated_at:new Date().toISOString() }).eq('id',st.id); if(error) console.warn('[runner] initialize session', error.message||error); }
      }
      if(sessions.has(s.id)) g.refs.add(s.id);
    }
    if(!g.ws && !g.reconnectTimer) connectGroup(g);
  }
  // cleanup refs not present anymore
  for(const [k,g] of groups.entries()){ const expected = byKey.get(k)?.list?.map(s=>s.id) || []; for(const id of Array.from(g.refs)){ if(!expected.includes(id)){ g.refs.delete(id); sessions.delete(id); } } if(g.refs.size===0){ closeGroup(g); groups.delete(k); } }
}

async function main(){ console.log('[runner] starting'); let backoff=1000; for(;;){ let wait=5000; try{ await syncSessions(); backoff=1000; }catch(e){ console.warn('[runner] syncSessions', e.message||e); wait=backoff; backoff=Math.min(30000, Math.round(backoff*1.5)); } await sleep(wait); }
}

main().catch(e=>{ console.error('[runner] fatal', e); process.exit(1); });
