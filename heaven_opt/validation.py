from __future__ import annotations

import math

from .simulator import HeavenOpts, backtest_with_bars
from .utils import Bar


def _time_to_index(bars: list[Bar], t: int) -> int:
    lo, hi = 0, len(bars) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if bars[mid].time < t:
            lo = mid + 1
        elif bars[mid].time > t:
            hi = mid - 1
        else:
            return mid
    return max(0, min(len(bars) - 1, lo))


def walk_forward_validate(bars: list[Bar], opts: HeavenOpts, train_days: int, test_days: int, stride_days: int, equity_start: float, fee_pct: float) -> dict[str, float]:
    if not bars:
        return {}
    train_sec = train_days * 86400
    test_sec = test_days * 86400
    stride_sec = stride_days * 86400
    start_t = bars[0].time
    end_t = bars[-1].time
    folds: list[dict] = []
    t = start_t
    while t + train_sec + test_sec <= end_t:
        train_from, train_to = t, t + train_sec
        test_from, test_to = train_to, train_to + test_sec
        folds.append({"train": (train_from, train_to), "test": (test_from, test_to)})
        t += stride_sec
    if not folds:
        return {}
    pf_vals = []
    pnl_vals = []
    dd_vals = []
    for f in folds:
        tf, tt = f["test"]
        fi = _time_to_index(bars, tf)
        ti = _time_to_index(bars, tt)
        rep = backtest_with_bars(opts, bars, fi, ti, equity_start, fee_pct)
        if not rep:
            continue
        pf_vals.append(float(rep.get("profitFactor", 0.0)))
        pnl_vals.append(float(rep.get("totalPnl", 0.0)))
        dd_vals.append(float(rep.get("maxDDPct", 0.0)))
    def mean(a: list[float]) -> float:
        return sum(a) / len(a) if a else 0.0
    def std(a: list[float]) -> float:
        m = mean(a)
        v = sum((x - m) * (x - m) for x in a) / len(a) if a else 0.0
        return math.sqrt(v)
    return {
        "wf_pf_mean": mean(pf_vals),
        "wf_pf_std": std(pf_vals),
        "wf_pnl_mean": mean(pnl_vals),
        "wf_dd_mean": mean(dd_vals),
    }


def monte_carlo_validate(bars: list[Bar], opts: HeavenOpts, n: int, sigma: float, equity_start: float, fee_pct: float) -> dict[str, float]:
    import random
    pf_vals = []
    for _i in range(n):
        mul = [1.0 + random.gauss(0.0, sigma) for _ in bars]
        pert: list[Bar] = []
        for b, m in zip(bars, mul):
            # scale OHLC uniformly to keep shape
            pert.append(Bar(time=b.time, open=b.open * m, high=b.high * m, low=b.low * m, close=b.close * m))
        rep = backtest_with_bars(opts, pert, 0, len(pert) - 1, equity_start, fee_pct)
        if rep:
            pf_vals.append(float(rep.get("profitFactor", 0.0)))
    def mean(a: list[float]) -> float:
        return sum(a) / len(a) if a else 0.0
    def std(a: list[float]) -> float:
        m = mean(a)
        v = sum((x - m) * (x - m) for x in a) / len(a) if a else 0.0
        return math.sqrt(v)
    return {
        "mc_pf_mean": mean(pf_vals),
        "mc_pf_std": std(pf_vals),
    }
