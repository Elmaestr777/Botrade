from __future__ import annotations

import math

from .signal_engine import (
    compute_line_break_state,
    compute_pivots,
    ema_series,
    last_two_pivots_before,
)
from .utils import Bar


class HeavenOpts:
    def __init__(self,
                 nol: int = 3,
                 prd: int = 15,
                 entry_mode: str = "Both",
                 risk_mgmt: bool = True,
                 risk_max_pct: float = 1.0,
                 sl_init_pct: float = 2.0,
                 be_enable: bool = True,
                 be_after_bars: int = 5,
                 be_lock_pct: float = 5.0,
                 tp_enable: bool = True,
                 tp_norm: bool = True,
                 ema_len: int = 55,
                 tp_types: list[str] | None = None,
                 tp_r: list[float] | None = None,
                 tp_p: list[float] | None = None,
                 use_fib_ret: bool = True,
                 confirm_mode: str = "Bounce",
                 ) -> None:
        self.nol = int(max(1, nol))
        self.prd = int(max(2, prd))
        self.entry_mode = entry_mode
        self.risk_mgmt = bool(risk_mgmt)
        self.risk_max_pct = float(max(0.0, risk_max_pct))
        self.sl_init_pct = float(max(0.0, sl_init_pct))
        self.be_enable = bool(be_enable)
        self.be_after_bars = int(max(1, be_after_bars))
        self.be_lock_pct = float(max(0.0, be_lock_pct))
        self.tp_enable = bool(tp_enable)
        self.tp_norm = bool(tp_norm)
        self.ema_len = int(max(1, ema_len))
        self.tp_types = list(tp_types) if tp_types is not None else ["Fib"] * 10
        self.tp_r = list(tp_r) if tp_r is not None else [0.382, 0.5, 0.68, 1.0, 1.382, 1.618, 2.0, 2.236, 2.618, 3.0]
        self.tp_p = list(tp_p) if tp_p is not None else [10, 15, 15, 10, 10, 10, 10, 10, 5, 5]
        self.use_fib_ret = bool(use_fib_ret)
        self.confirm_mode = confirm_mode


def normalize_tp_percents(opts: HeavenOpts) -> None:
    s = sum(opts.tp_p)
    if opts.tp_norm and s > 0:
        for i in range(10):
            opts.tp_p[i] = (opts.tp_p[i] / s) * 100.0


def generate_heaven_signals(opts: HeavenOpts, bars: list[Bar], precomputed: dict | None = None) -> list[dict[str, object]]:
    if precomputed and "lb" in precomputed:
        trend, level, flips = precomputed["lb"]
    else:
        trend, level, flips = compute_line_break_state(bars, opts.nol)
    piv = precomputed.get("piv") if (precomputed and "piv" in precomputed) else compute_pivots(bars, opts.prd)
    use_lb = (opts.entry_mode in ("Original", "Both"))
    use_fib = (opts.entry_mode in ("Fib", "Both")) and opts.use_fib_ret
    sigs: list[dict[str, object]] = []
    if use_lb:
        for i in flips:
            entry_idx = min(len(bars) - 1, i + 1)
            risk_ok = (not opts.risk_mgmt) or (math.isfinite(level[i]) and (opts.risk_max_pct / 100.0 >= abs(bars[i].open - level[i]) / max(1e-9, bars[i].open)))
            if not risk_ok:
                continue
            direction = 'long' if trend[i] == 1 else 'short'
            sigs.append({"idx": entry_idx, "dir": direction, "type": "LB"})
    if use_fib and len(piv) >= 2:
        def use_lvl(ratio: float, swing_up: bool) -> None:
            for s in range(1, len(piv)):
                a = piv[s - 1]
                b = piv[s]
                swing_up_now = b["price"] > a["price"]
                if swing_up_now != swing_up:
                    continue
                lvl = a["price"] + (b["price"] - a["price"]) * ratio
                start = int(b["idx"])
                end = int(piv[s + 1]["idx"] if s + 1 < len(piv) else len(bars))
                for j in range(start + 1, end):
                    if swing_up:
                        if opts.confirm_mode == "Bounce":
                            bounce = (bars[j - 1].close <= lvl and bars[j].close > lvl)
                        else:
                            bounce = (bars[j].low <= lvl and bars[j].close > lvl)
                        if bounce:
                            risk_ok = (not opts.risk_mgmt) or (math.isfinite(level[j]) and (opts.risk_max_pct / 100.0 >= abs(bars[j].close - level[j]) / max(1e-9, bars[j].close)))
                            if risk_ok and trend[j] == 1:
                                entry_idx = min(len(bars) - 1, j + 1)
                                sigs.append({"idx": entry_idx, "dir": 'long', "type": 'Fib'})
                                break
                    else:
                        if opts.confirm_mode == "Bounce":
                            bounce = (bars[j - 1].close >= lvl and bars[j].close < lvl)
                        else:
                            bounce = (bars[j].high >= lvl and bars[j].close < lvl)
                        if bounce:
                            risk_ok = (not opts.risk_mgmt) or (math.isfinite(level[j]) and (opts.risk_max_pct / 100.0 >= abs(bars[j].close - level[j]) / max(1e-9, bars[j].close)))
                            if risk_ok and trend[j] == -1:
                                entry_idx = min(len(bars) - 1, j + 1)
                                sigs.append({"idx": entry_idx, "dir": 'short', "type": 'Fib'})
                                break
        # Enable common fib ratios as in UI
        ratios = []
        for i in range(10):
            ratios.append(opts.tp_r[i])
        used = set()
        def maybe(r: float):
            if r not in used:
                used.add(r)
                use_lvl(r, True)
                use_lvl(r, False)
        for r in (0.382, 0.5, 0.618, 0.786):
            maybe(r)
    # sort by idx and prioritize LB over Fib on same entry bar
    sigs.sort(key=lambda x: (int(x["idx"]), 0 if x["type"] == "LB" else 1))
    return sigs


def simulate_trade_from_signal(sig: dict[str, object], to_idx: int, piv: list[dict[str, float]], opts: HeavenOpts, equity: float, fee_pct: float, equity_start: float, bars: list[Bar]):
    is_long = (sig["dir"] == 'long')
    entry_idx = int(sig["idx"])  # entry at next bar open already computed in signals
    if entry_idx >= len(bars) or entry_idx > to_idx:
        return None
    entry_price = bars[entry_idx].open
    sl = entry_price * (1.0 - opts.sl_init_pct / 100.0) if is_long else entry_price * (1.0 + opts.sl_init_pct / 100.0)
    # sizing
    if opts.risk_mgmt:
        risk_cash = equity * (opts.risk_max_pct / 100.0)
        risk_per_unit = max(1e-9, abs(entry_price - sl))
        qty = max(0.0, risk_cash / risk_per_unit)
    else:
        # no explicit cap in Python config; leverage supported by qty sizing here
        qty = max(0.0, (equity) / max(1e-9, entry_price))
    if qty <= 0:
        return None
    last2 = last_two_pivots_before(piv, int(sig["idx"]))
    values = opts.tp_r
    percs = opts.tp_p
    tmp = HeavenOpts(tp_norm=opts.tp_norm)
    tmp.tp_p = percs.copy()
    normalize_tp_percents(tmp)
    norm_percs = tmp.tp_p
    targets: list[dict[str, object]] = []
    tp_types = opts.tp_types
    a = last2["a"] if last2 else None
    b = last2["b"] if last2 else None
    swing_up = (b and a and b["price"] > a["price"]) if last2 else None
    def price_at(r: float) -> float:
        assert a and b
        return a["price"] + (b["price"] - a["price"]) * r
    ema_rem = 0.0
    for i in range(10):
        if norm_percs[i] <= 0:
            continue
        t = tp_types[i] if i < len(tp_types) else 'Fib'
        if t == 'Percent':
            pct = max(0.0, float(values[i] if i < len(values) else 0.0))
            if pct <= 0:
                continue
            p = entry_price * (1.0 + pct / 100.0) if is_long else entry_price * (1.0 - pct / 100.0)
            targets.append({"price": p, "qty": qty * norm_percs[i] / 100.0, "filled": False, "label": f"TP{i+1}"})
        elif t == 'EMA':
            ema_rem += qty * norm_percs[i] / 100.0
        elif last2:
            p = price_at(values[i] if i < len(values) else 0.0)
            if (is_long and swing_up and p > entry_price) or ((not is_long) and (not swing_up) and p < entry_price):
                targets.append({"price": p, "qty": qty * norm_percs[i] / 100.0, "filled": False, "label": f"TP{i+1}"})
    targets.sort(key=(lambda x: x["price"])) if is_long else targets.sort(key=(lambda x: x["price"]), reverse=True)
    remaining = qty
    realized = 0.0
    exit_idx = to_idx
    exit_price = bars[to_idx].close
    reason = 'Close'
    fills: list[dict[str, object]] = []
    use_ema_tp = any((t == 'EMA' and p > 0) for t, p in zip(tp_types, percs))
    ema_arr = (precomputed.get('ema') if (precomputed and 'ema' in precomputed) else ema_series(bars, opts.ema_len)) if use_ema_tp else None
    for j in range(entry_idx, to_idx + 1):
        # BE trailing
        if opts.be_enable:
            bars_since = j - entry_idx
            if bars_since >= opts.be_after_bars:
                lc = bars[j].close
                if is_long:
                    cand = max(entry_price, entry_price + (opts.be_lock_pct / 100.0) * (lc - entry_price))
                    if cand > sl:
                        sl = cand
                else:
                    cand = min(entry_price, entry_price - (opts.be_lock_pct / 100.0) * (entry_price - lc))
                    if cand < sl:
                        sl = cand
        bar = bars[j]
        if is_long:
            if bar.low <= sl:
                realized += (sl - entry_price) * remaining
                fills.append({"kind": 'SL', "qty": remaining, "price": sl, "timeIdx": j, "pnl": (sl - entry_price) * remaining})
                exit_idx = j
                exit_price = sl
                reason = 'SL'
                remaining = 0.0
                break
            for t in targets:
                if (not t["filled"]) and (bar.high >= float(t["price"])):
                    amt = min(remaining, float(t["qty"]))
                    if amt > 0:
                        fp = (float(t["price"]) - entry_price) * amt
                        realized += fp
                        remaining -= amt
                        t["filled"] = True
                        fills.append({"kind": t["label"], "qty": amt, "price": float(t["price"]), "timeIdx": j, "pnl": fp})
            if ema_arr is not None and remaining > 1e-9:
                pema = ema_arr[j]
                if bar.low <= pema:
                    amt = remaining
                    fp = (pema - entry_price) * amt
                    realized += fp
                    remaining -= amt
                    fills.append({"kind": 'TP8', "qty": amt, "price": pema, "timeIdx": j, "pnl": fp})
            if remaining <= 1e-9:
                exit_idx = j
                exit_price = float(next((t["price"] for t in targets if t["filled"]), bar.close))
                reason = 'TP'
                break
        else:
            if bar.high >= sl:
                realized += (entry_price - sl) * remaining
                fills.append({"kind": 'SL', "qty": remaining, "price": sl, "timeIdx": j, "pnl": (entry_price - sl) * remaining})
                exit_idx = j
                exit_price = sl
                reason = 'SL'
                remaining = 0.0
                break
            for t in targets:
                if (not t["filled"]) and (bar.low <= float(t["price"])):
                    amt = min(remaining, float(t["qty"]))
                    if amt > 0:
                        fp = (entry_price - float(t["price"])) * amt
                        realized += fp
                        remaining -= amt
                        t["filled"] = True
                        fills.append({"kind": t["label"], "qty": amt, "price": float(t["price"]), "timeIdx": j, "pnl": fp})
            if ema_arr is not None and remaining > 1e-9:
                pema = ema_arr[j]
                if bar.high >= pema:
                    amt = remaining
                    fp = (entry_price - pema) * amt
                    realized += fp
                    remaining -= amt
                    fills.append({"kind": 'TP8', "qty": amt, "price": pema, "timeIdx": j, "pnl": fp})
            if remaining <= 1e-9:
                exit_idx = j
                exit_price = float(next((t["price"] for t in targets if t["filled"]), bar.close))
                reason = 'TP'
                break
    if remaining > 1e-9:
        last = bars[to_idx].close
        fp = (last - entry_price) * remaining if is_long else (entry_price - last) * remaining
        realized += fp
        fills.append({"kind": 'Close', "qty": remaining, "price": last, "timeIdx": to_idx, "pnl": fp})
        exit_idx = to_idx
        exit_price = last
        reason = 'Close'
        remaining = 0.0
    entry_notional = entry_price * qty
    exit_notional = exit_price * qty
    fees = (fee_pct / 100.0) * (entry_notional + exit_notional)
    pnl = realized - fees
    init_risk_cash = abs(entry_price - (entry_price * (1.0 - opts.sl_init_pct / 100.0) if is_long else entry_price * (1.0 + opts.sl_init_pct / 100.0))) * qty
    rr = (pnl / init_risk_cash) if init_risk_cash > 1e-9 else None
    return {
        "entryIdx": entry_idx,
        "exitIdx": exit_idx,
        "entryPrice": entry_price,
        "exitPrice": exit_price,
        "dir": ('long' if is_long else 'short'),
        "type": sig["type"],
        "qty": qty,
        "pnl": pnl,
        "rr": rr,
        "reason": reason,
        "fills": fills,
    }


def lin_reg(y: list[float]) -> tuple[float, float]:
    n = len(y)
    if n < 2:
        return 0.0, 0.0
    xs = list(range(n))
    mx = (n - 1) / 2.0
    my = sum(y) / n
    num = 0.0
    den = 0.0
    sst = 0.0
    sse = 0.0
    for i in range(n):
        dx = xs[i] - mx
        num += dx * (y[i] - my)
        den += dx * dx
    a = num / max(1e-9, den)
    b = my - a * mx
    for i in range(n):
        fit = a * xs[i] + b
        err = y[i] - fit
        sse += err * err
        dy = y[i] - my
        sst += dy * dy
    r2 = (1.0 - sse / sst) if sst > 0 else 0.0
    return a, r2


def backtest_with_bars(opts: HeavenOpts, bars: list[Bar], from_idx: int, to_idx: int, equity_start: float = 10000.0, fee_pct: float = 0.10, precomputed: dict | None = None):
    if from_idx < 0 or to_idx <= from_idx:
        return None
    piv = precomputed.get("piv") if (precomputed and "piv" in precomputed) else compute_pivots(bars, opts.prd)
    signals = generate_heaven_signals(opts, bars, precomputed=precomputed)
    signals = [s for s in signals if int(s["idx"]) >= from_idx and int(s["idx"]) <= to_idx]
    trades: list[dict[str, object]] = []
    equity = equity_start
    peak = equity
    max_dd = 0.0
    gross_prof = 0.0
    gross_loss = 0.0
    wins = 0
    returns: list[float] = []
    eq_series: list[float] = []
    for i, sig in enumerate(signals):
        end_bound = min(to_idx, int(signals[i + 1]["idx"]) if i + 1 < len(signals) else to_idx)
        eq_before = equity
        res = simulate_trade_from_signal(sig, end_bound, piv, opts, equity, fee_pct, equity_start, bars)
        if res is None:
            continue
        trades.append(res)
        equity += float(res["pnl"])  # type: ignore
        if float(res["pnl"]) >= 0:  # type: ignore
            gross_prof += float(res["pnl"])  # type: ignore
        else:
            gross_loss += float(res["pnl"])  # type: ignore
        if float(res["pnl"]) > 0:
            wins += 1
        returns.append((float(res["pnl"]) / eq_before) if eq_before > 1e-9 else 0.0)
        eq_series.append(equity)
        if equity > peak:
            peak = equity
        dd = (peak - equity) / max(1e-9, peak)
        if dd > max_dd:
            max_dd = dd
    total_pnl = equity - equity_start
    winrate = (wins / len(trades) * 100.0) if trades else 0.0
    pf = (gross_prof / abs(gross_loss)) if gross_loss < 0 else (float('inf') if gross_prof > 0 else 0.0)
    def mean(a: list[float]) -> float:
        return sum(a) / len(a) if a else 0.0
    def std(a: list[float]) -> float:
        m = mean(a)
        v = (sum((x - m) * (x - m) for x in a) / len(a)) if a else 0.0
        return math.sqrt(v)
    sharpe = (mean(returns) / max(1e-9, std(returns))) if returns else 0.0
    slope, r2 = lin_reg(eq_series)
    days = max(1, int((bars[to_idx].time - bars[from_idx].time) / 86400))
    cagr = (equity / max(1e-9, equity_start)) ** (365.0 / days) - 1.0 if days > 0 else 0.0
    calmar = (cagr / max(1e-9, max_dd)) if max_dd > 0 else 0.0
    return {
        "fromIdx": from_idx,
        "toIdx": to_idx,
        "trades": trades,
        "equity": equity,
        "totalPnl": total_pnl,
        "winrate": winrate,
        "grossProf": gross_prof,
        "grossLoss": gross_loss,
        "profitFactor": pf,
        "avgRR": float(sum(float(t["rr"]) for t in trades if t["rr"] is not None) / max(1, sum(1 for t in trades if t["rr"] is not None))) if trades else None,
        "sharpe": sharpe,
        "slope": slope,
        "r2": r2,
        "calmar": calmar,
        "maxDDPct": max_dd * 100.0,
        "maxDDAbs": (0.0 if not eq_series else (max(eq_series) - min(eq_series))),
    }
