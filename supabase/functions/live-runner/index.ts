// supabase/functions/live-runner/index.ts
// Supabase Edge Function: headless live engine (paper trading)
// - Scans active sessions in public.live_sessions (user_id IS NULL)
// - Fetches latest candles from Binance REST per (symbol, tf)
// - Simulates strategy on new bars since last_bar_time
// - Persists trade events to public.live_events and updates session state
//
// NOTE: This implements a simplified version of the front-end liveOnBar logic
//       sufficient for headless operation. It uses UI strategy_params schema.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("PUBLIC_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("PUBLIC_SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

// Fetch klines from Binance
async function fetchKlines(symbol: string, interval: string, limit = 500) {
  const u = new URL("https://api.binance.com/api/v3/klines");
  u.searchParams.set("symbol", symbol.toUpperCase());
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error("HTTP " + res.status);
  const raw = await res.json();
  const now = Date.now();
  const mapped = raw
    .filter((k: any) => Number(k[6]) <= now)
    .map((k: any) => ({
      time: Math.floor(k[0] / 1000),
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
    }));
  mapped.sort((a: any, b: any) => a.time - b.time);
  return mapped;
}

// ===== Strategy helpers (subset from front) =====
function computeLineBreakState(bars: any[], nol: number) {
  const n = bars.length;
  if (!n) return { trend: [], level: [], flips: [] };
  const trend = new Array(n).fill(0);
  const level = new Array(n).fill(null as number | null);
  const flips: number[] = [];
  let t = bars[0].close >= bars[0].open ? 1 : -1;
  let opens = [bars[0].open];
  let closes = [bars[0].close];
  for (let i = 0; i < n; i++) {
    const c = bars[i].close;
    if (t === 1) {
      const cnt = Math.min(nol, opens.length);
      const minUp = Math.min(
        ...opens.slice(0, cnt),
        ...closes.slice(0, cnt),
      );
      if (c < minUp) t = -1;
      if (c > closes[0] || t === -1) {
        const o = (t === -1 ? opens[0] : closes[0]);
        opens.unshift(o); closes.unshift(c);
      }
    } else {
      const cnt = Math.min(nol, opens.length);
      const maxDn = Math.max(
        ...opens.slice(0, cnt),
        ...closes.slice(0, cnt),
      );
      if (c > maxDn) t = 1;
      if (c < closes[0] || t === 1) {
        const o = (t === 1 ? opens[0] : closes[0]);
        opens.unshift(o); closes.unshift(c);
      }
    }
    trend[i] = t;
    const cnt2 = Math.min(nol, opens.length);
    const minUp2 = Math.min(
      ...opens.slice(0, cnt2),
      ...closes.slice(0, cnt2),
    );
    const maxDn2 = Math.max(
      ...opens.slice(0, cnt2),
      ...closes.slice(0, cnt2),
    );
    level[i] = (t === 1 ? minUp2 : maxDn2);
    if (i > 0 && trend[i] !== trend[i - 1]) flips.push(i);
  }
  return { trend, level, flips };
}

function computePivots(bars: any[], prd: number) {
  const piv: any[] = [];
  for (let i = prd; i < bars.length - prd; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= prd; j++) {
      if (!(bars[i].high > bars[i - j].high && bars[i].high > bars[i + j].high)) isH = false;
      if (!(bars[i].low < bars[i - j].low && bars[i].low < bars[i + j].low)) isL = false;
      if (!isH && !isL) break;
    }
    if (isH || isL) piv.push({ idx: i, time: bars[i].time, price: isH ? bars[i].high : bars[i].low });
  }
  return piv;
}

function getLastConfirmedPivotSeg(piv: any[], currentIdx: number, prd: number) {
  const confirmedThrough = currentIdx - prd;
  const available = (piv || []).filter((p) => p.idx <= confirmedThrough);
  if (available.length < 2) return null as any;
  const a = available[available.length - 2], b = available[available.length - 1];
  return { a, b, dir: b.price > a.price ? 'up' : 'down' };
}

function emaAt(bars: any[], length: number, idx: number) {
  const k = 2 / (Math.max(1, length) + 1);
  let ema: number | null = null;
  for (let i = 0; i <= idx && i < bars.length; i++) {
    const v = bars[i].close;
    ema = ema == null ? v : v * k + ema * (1 - k);
  }
  return ema;
}

function intervalSeconds(tf: string) {
  const m = String(tf || '').match(/^(\d+)([mhdw])$/i);
  if (!m) return 60;
  const n = Math.max(1, Number(m[1]) || 1);
  const unit = m[2].toLowerCase();
  return n * (unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 604800);
}

// ===== Engine per session =====
function mergeDuplicateTargets(list: any[]) {
  const out: any[] = [];
  const seen = new Map<string, any>();
  for (const raw of Array.isArray(list) ? list : []) {
    const price = Number(raw && raw.price);
    if (!Number.isFinite(price)) continue;
    const key = price.toFixed(8);
    const w = raw.w != null && isFinite(raw.w) ? Number(raw.w) : null;
    const existing = seen.get(key);
    if (existing) {
      if (w != null) existing.w = existing.w != null && isFinite(existing.w) ? existing.w + w : w;
    } else {
      const t = { ...raw, price };
      if (w != null) t.w = w;
      seen.set(key, t);
      out.push(t);
    }
  }
  return out;
}

function buildTargets(params: any, segLast: any, dir: 'long'|'short', entry: number, riskAbs: number, bars: any[], i: number) {
  let out: any[] = [];
  if (params.tpEnable && Array.isArray(params.tp) && params.tp.length) {
    const A = segLast ? segLast.a.price : null;
    const B = segLast ? segLast.b.price : null;
    const move = (segLast && A != null && B != null) ? Math.abs(B - A) : null;
    for (let idx = 0; idx < params.tp.length; idx++) {
      const t = params.tp[idx];
      let price: number | null = null;
      const typ = String(t.type || 'Fib');
      if (typ === 'Fib' && segLast && move != null) {
        const r = parseFloat((t.fib != null ? t.fib : t.value));
        if (isFinite(r)) price = (segLast.dir === 'up') ? (B + move * r) : (B - move * r);
      } else if (typ === 'Percent') {
        const p = parseFloat((t.pct != null ? t.pct : t.value));
        if (isFinite(p)) price = dir === 'long' ? (entry * (1 + p / 100)) : (entry * (1 - p / 100));
      } else if (typ === 'EMA') {
        const len = Math.max(1, parseInt((t.emaLen != null ? t.emaLen : (params.emaLen || 55))));
        price = emaAt(bars, len, i);
      }
      if (price != null) {
        if ((dir === 'long' && price > entry) || (dir === 'short' && price < entry)) {
          let w: number | null = null;
          const q = (t.qty != null ? Number(t.qty) : null);
          if (q != null) w = (q > 1 ? q / 100 : q);
          out.push({ price, w, srcIdx: idx });
        }
      }
    }
    out = mergeDuplicateTargets(out);
    if (dir === 'long') out.sort((a, b) => a.price - b.price); else out.sort((a, b) => b.price - a.price);
    let sumW = 0, hasW = false;
    for (const it of out) { if (it.w != null && it.w > 0) { sumW += it.w; hasW = true; } }
    if (!hasW) {
      if (out.length) {
        const even = 1 / out.length; for (const it of out) it.w = even;
      } else {
        out.push({ price: dir === 'long' ? (entry + riskAbs * (params.tp1R || 1)) : (entry - riskAbs * (params.tp1R || 1)), w: 1, srcIdx: 0 });
      }
    } else {
      if (sumW > 1) { const k = 1 / sumW; for (const it of out) { if (it.w != null) it.w *= k; } }
      else if (params.tpCloseAllLast && sumW < 1 && out.length) { out[out.length - 1].w = (out[out.length - 1].w || 0) + (1 - sumW); }
    }
  } else {
    out.push({ price: dir === 'long' ? (entry + riskAbs * (params.tp1R || 1)) : (entry - riskAbs * (params.tp1R || 1)), w: 1, srcIdx: 0 });
  }
  return out;
}

function computeSLFromLadder(params: any, segLast: any, dir: 'long'|'short', entry: number, bars: any[], i: number, emaLen: number) {
  if (!(params.slEnable && Array.isArray(params.sl) && params.sl.length)) return null as number | null;
  const A = segLast ? segLast.a.price : null;
  const B = segLast ? segLast.b.price : null;
  const move = (segLast && A != null && B != null) ? Math.abs(B - A) : null;
  const cands: number[] = [];
  for (const t of params.sl) {
    const typ = String(t.type || 'Percent');
    let price: number | null = null;
    if (typ === 'Fib' && segLast && move != null) {
      const r = parseFloat((t.fib != null ? t.fib : t.value));
      if (isFinite(r)) price = (segLast.dir === 'up') ? (B - move * r) : (B + move * r);
    } else if (typ === 'Percent') {
      const p = parseFloat((t.pct != null ? t.pct : t.value));
      if (isFinite(p)) price = dir === 'long' ? (entry * (1 - p / 100)) : (entry * (1 + p / 100));
    } else if (typ === 'EMA') {
      const len = Math.max(1, parseInt((t.emaLen != null ? t.emaLen : emaLen)));
      price = emaAt(bars, len, i);
    }
    if (price != null) {
      if (dir === 'long') { if (price <= entry) cands.push(price); } else { if (price >= entry) cands.push(price); }
    }
  }
  if (!cands.length) return null;
  return dir === 'long' ? Math.max(...cands) : Math.min(...cands);
}

function qtyFromEquity(equity: number, entry: number, sl: number, feePct: number, lev: number, riskMaxPct: number) {
  if (!(isFinite(entry) && isFinite(sl))) return 0;
  const budget = Math.max(0, equity);
  const notional = budget * Math.max(1, lev || 1);
  const qty0 = notional / Math.max(1e-12, entry);
  const riskAbs = Math.abs(entry - sl);
  const perUnitWorstLoss = riskAbs + ((Math.abs(entry) + Math.abs(sl)) * feePct);
  const qtyRisk = perUnitWorstLoss > 0 ? ((equity * Math.max(0, riskMaxPct) / 100) / perUnitWorstLoss) : 0;
  return Math.max(0, Math.min(qty0, qtyRisk));
}

async function processSession(c: any, s: any) {
  const symbol = String(s.symbol || '').toUpperCase();
  const tf = String(s.tf || '1h');
  const params = s.strategy_params || {};
  const lev = Number(s.lev || 1) || 1;
  const feePct = (Number(s.fee || 0.1) || 0.1) / 100;
  let equity = Number(s.equity ?? s.start_cap ?? 0) || 0;
  let lastTs = Number(s.last_bar_time || 0) || 0;

  const bars = await fetchKlines(symbol, tf, 500);
  if (!bars.length) return { updated: false };

  // Only process bars after lastTs
  let startIdx = bars.length;
  if (lastTs > 0) {
    const oldestContinuousTs = bars[0].time - intervalSeconds(tf);
    if (lastTs < oldestContinuousTs) {
      const nowIso = new Date().toISOString();
      const payload = {
        code: 'history_gap',
        message: 'Session stopped because the available Binance window cannot cover all missed candles.',
        last_bar_time: lastTs,
        oldest_available_time: bars[0].time,
      };
      const { error: eventError } = await c.from('live_events').insert([{
        session_id: s.id,
        kind: 'info',
        at_time: nowIso,
        payload,
      }]);
      if (eventError) console.warn('insert history gap event', eventError.message || eventError);
      const { error: gapError } = await c.from('live_sessions').update({ active: false, updated_at: nowIso }).eq('id', s.id);
      if (gapError) console.warn('stop session with history gap', gapError.message || gapError);
      return { updated: true, events: eventError ? 0 : 1, history_gap: true };
    }
    for (let i = 0; i < bars.length; i++) { if (bars[i].time > lastTs) { startIdx = i; break; } }
  } else {
    // Start from the next closed candle; do not create a historical entry at session creation.
    lastTs = bars[bars.length - 1].time;
    const { error: initError } = await c.from('live_sessions').update({ last_bar_time: lastTs, updated_at: new Date().toISOString() }).eq('id', s.id);
    if (initError) console.warn('initialize live_sessions', initError.message || initError);
    return { updated: true, events: 0 };
  }
  if (startIdx >= bars.length) return { updated: false };

  // Compute context series once
  const lb = computeLineBreakState(bars, Math.max(1, parseInt(params.nol || 3)));
  const pivotPrd = Math.max(2, parseInt(params.prd || 15));
  const pivAll = computePivots(bars, pivotPrd);

  // Read persisted position state
  let pos = s.pos || null;
  const events: any[] = [];

  function addEvent(kind: string, payload: any) { events.push({ kind, payload, at_time: new Date(payload.time * 1000).toISOString() }); }

  for (let i = startIdx; i < bars.length; i++) {
    const bar = bars[i];
    const trendNow = lb.trend[i];
    const trendPrev = (i > 0 ? lb.trend[i - 1] : trendNow);
    const segAtOpen = getLastConfirmedPivotSeg(pivAll, i - 1, pivotPrd);
    const segAtClose = getLastConfirmedPivotSeg(pivAll, i, pivotPrd);

    const emaLen = Math.max(1, parseInt(params.emaLen || 55));

    // A signal is known only at candle close, so its order is filled at the next candle open.
    if (pos?.pending) {
      const pending = pos;
      pos = null;
      const dir: 'long'|'short' = pending.dir;
      const entry = bar.open;
      const decisionIdx = Math.max(0, i - 1);
      let sl = computeSLFromLadder(params, segAtOpen, dir, entry, bars, decisionIdx, emaLen);
      if (sl == null) {
        const riskPx = entry * ((Number(params.slInitPct || 2.0)) / 100);
        sl = dir === 'long' ? (entry - riskPx) : (entry + riskPx);
      } else {
        if (dir === 'long' && sl > entry) sl = entry;
        if (dir === 'short' && sl < entry) sl = entry;
      }
      const riskMaxPct = params.riskMgmt === false ? 100 : (Number(params.riskMaxPct || 1.0) || 1.0);
      const qty = qtyFromEquity(equity, entry, sl, feePct, lev, riskMaxPct);
      if (qty > 1e-12 && isFinite(qty)) {
        const riskAbs = Math.abs(entry - sl);
        const targets = buildTargets(params, segAtOpen, dir, entry, riskAbs, bars, decisionIdx);
        pos = { dir, entry, sl, initSL: sl, qty, initQty: qty, entryTime: bar.time, beActive: false, anyTP: false, tpIdx: 0, targets, hiSince: entry, loSince: entry };
        addEvent('entry', { time: bar.time, signalTime: pending.signalTime, dir, entry, sl, qty });
      }
    }

    if (pos && !pos.pending) {
      // UPDATE
      pos.hiSince = Math.max(pos.hiSince || bar.high, bar.high);
      pos.loSince = Math.min(pos.loSince || bar.low, bar.low);
      // BE arming
      if (params.beEnable && !pos.beActive) {
        const barsSince = Math.max(0, Math.floor((bar.time - pos.entryTime) / intervalSeconds(tf)));
        if (barsSince >= (parseInt(params.beAfterBars || 5))) {
          const movePct = pos.dir === 'long' ? ((bar.high - pos.entry) / pos.entry * 100) : ((pos.entry - bar.low) / pos.entry * 100);
          if (movePct >= (Number(params.beLockPct || 5.0))) { pos.beActive = true; pos.sl = pos.entry; addEvent('be', { time: bar.time, dir: pos.dir, sl: pos.sl }); }
        }
      }
      // SL ladder merge
      {
        const sl2 = computeSLFromLadder(params, segAtClose, pos.dir, pos.entry, bars, i, emaLen);
        if (sl2 != null) {
          let b = sl2;
          if (!pos.beActive) {
            b = (pos.dir === 'long') ? Math.min(sl2, pos.entry) : Math.max(sl2, pos.entry);
          }
          pos.sl = (pos.dir === 'long') ? Math.max(pos.sl, b) : Math.min(pos.sl, b);
        }
      }
      // SL check
      if (pos.dir === 'long') {
        if (bar.low <= pos.sl) {
          const portionQty = pos.qty;
          const pnl = (pos.sl - pos.entry) * portionQty;
          const fees = (pos.entry * portionQty + pos.sl * portionQty) * feePct;
          const net = pnl - fees;
          equity += net; if (equity < 0) equity = 0;
          addEvent('sl', { time: bar.time, dir: pos.dir, entry: pos.entry, exit: pos.sl, qty: portionQty, pnl, fees, net });
          pos = null;
        }
      } else {
        if (bar.high >= pos.sl) {
          const portionQty = pos.qty;
          const pnl = (pos.entry - pos.sl) * portionQty;
          const fees = (pos.entry * portionQty + pos.sl * portionQty) * feePct;
          const net = pnl - fees;
          equity += net; if (equity < 0) equity = 0;
          addEvent('sl', { time: bar.time, dir: pos.dir, entry: pos.entry, exit: pos.sl, qty: portionQty, pnl, fees, net });
          pos = null;
        }
      }
      // TP sequential
      if (pos && pos.targets && pos.tpIdx < pos.targets.length) {
        while (pos && pos.tpIdx < pos.targets.length) {
          const tp = pos.targets[pos.tpIdx];
          const hit = pos.dir === 'long' ? (bar.high >= tp.price) : (bar.low <= tp.price);
          if (!hit) break;
          const portionFrac = (params.tpCompound ? (tp.w || 1) : 1);
          const portionQty = pos.initQty * portionFrac;
          const usedQty = Math.min(portionQty, pos.qty);
          const exitPx = tp.price;
          const pnl = (pos.dir === 'long' ? (exitPx - pos.entry) : (pos.entry - exitPx)) * usedQty;
          const fees = (pos.entry * usedQty + exitPx * usedQty) * feePct;
          const net = pnl - fees;
          equity += net; if (equity < 0) equity = 0;
          addEvent('tp', { time: bar.time, dir: pos.dir, entry: pos.entry, exit: exitPx, qty: usedQty, pnl, fees, net, idx: pos.tpIdx + 1 });
          pos.qty -= usedQty; pos.anyTP = true; pos.tpIdx++;
          if (!params.tpCompound || pos.qty <= 1e-12) { pos = null; break; }
        }
      }
    }

    if (trendNow !== trendPrev && params.entryMode !== 'Fib Retracement') {
      const nextDir: 'long'|'short' = (trendNow === 1 ? 'long' : 'short');
      if (pos && !pos.pending && pos.dir !== nextDir) {
        const exit = bar.close; const portionQty = pos.qty;
        const pnl = (pos.dir === 'long' ? (exit - pos.entry) : (pos.entry - exit)) * portionQty;
        const fees = (pos.entry * portionQty + exit * portionQty) * feePct;
        const net = pnl - fees; equity += net; if (equity < 0) equity = 0;
        addEvent('flip', { time: bar.time, dir: pos.dir, entry: pos.entry, exit, qty: portionQty, pnl, fees, net });
        pos = null;
      }
      if (!pos) pos = { pending: true, dir: nextDir, signalTime: bar.time };
    }

    lastTs = bar.time;
  }

  // Persist events and session update
  if (events.length) {
    const rows = events.map((e) => ({ session_id: s.id, kind: e.kind, at_time: e.at_time, payload: e.payload }));
    // Split inserts if large
    const chunk = (arr: any[], n: number) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
    for (const part of chunk(rows, 80)) {
      const { error } = await c.from('live_events').insert(part);
      if (error) console.warn('insert live_events', error.message || error);
    }
  }

  const { error: e2 } = await c.from('live_sessions').update({ equity, last_bar_time: lastTs, pos, updated_at: new Date().toISOString() }).eq('id', s.id);
  if (e2) console.warn('update live_sessions', e2.message || e2);
  return { updated: true, events: events.length };
}

serve(async (req) => {
  try {
    const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    // Fetch active sessions (public pool)
    const { data: sessions, error } = await c.from('live_sessions').select('*').eq('active', true).limit(100);
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { 'content-type': 'application/json' } });
    const stats: any[] = [];
    for (const s of (sessions || [])) {
      try {
        const r = await processSession(c, s);
        stats.push({ id: s.id, name: s.name, updated: r.updated, events: r.events || 0, history_gap: !!r.history_gap });
      } catch (e) {
        console.warn('process session error', s.id, (e as any)?.message || e);
        stats.push({ id: s.id, name: s.name, error: (e as any)?.message || String(e) });
      }
    }
    return new Response(JSON.stringify({ ok: true, count: (sessions || []).length, stats }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as any)?.message || String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
