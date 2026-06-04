from __future__ import annotations

import math

from .simulator import HeavenOpts, backtest_with_bars
from .utils import Bar


def _finite_pf(value: object, cap: float = 10.0) -> float:
    try:
        pf = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(pf):
        return 0.0
    if math.isinf(pf):
        return cap if pf > 0 else 0.0
    return max(0.0, min(cap, pf))


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _std(values: list[float]) -> float:
    mean = _mean(values)
    variance = sum((value - mean) * (value - mean) for value in values) / len(values) if values else 0.0
    return math.sqrt(variance)


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
    trade_vals = []
    for f in folds:
        tf, tt = f["test"]
        fi = _time_to_index(bars, tf)
        ti = _time_to_index(bars, tt)
        rep = backtest_with_bars(opts, bars, fi, ti, equity_start, fee_pct)
        if not rep:
            continue
        pf_vals.append(_finite_pf(rep.get("profitFactor", 0.0)))
        pnl_vals.append(float(rep.get("totalPnl", 0.0)))
        dd_vals.append(float(rep.get("maxDDPct", 0.0)))
        trade_vals.append(float(len(rep.get("trades", []))))
    active_indexes = [idx for idx, trades in enumerate(trade_vals) if trades > 0.0]
    active_pf = [pf_vals[idx] for idx in active_indexes]
    active_pnl = [pnl_vals[idx] for idx in active_indexes]
    active_dd = [dd_vals[idx] for idx in active_indexes]
    return {
        "wf_folds": float(len(pf_vals)),
        "wf_active_folds": float(len(active_indexes)),
        "wf_active_frac": (len(active_indexes) / len(pf_vals)) if pf_vals else 0.0,
        "wf_pf_mean": _mean(active_pf),
        "wf_pf_std": _std(active_pf),
        "wf_pnl_mean": _mean(active_pnl),
        "wf_pnl_std": _std(active_pnl),
        "wf_positive_frac": (sum(1 for pnl in active_pnl if pnl > 0.0) / len(active_pnl)) if active_pnl else 0.0,
        "wf_dd_mean": _mean(active_dd),
        "wf_dd_max": max(active_dd) if active_dd else 0.0,
        "wf_trades_mean": _mean(trade_vals),
    }


def monte_carlo_validate(bars: list[Bar], opts: HeavenOpts, n: int, sigma: float, equity_start: float, fee_pct: float) -> dict[str, float]:
    import random
    pf_vals = []
    pnl_vals = []
    for _i in range(n):
        mul = [1.0 + random.gauss(0.0, sigma) for _ in bars]
        pert: list[Bar] = []
        for b, m in zip(bars, mul):
            # scale OHLC uniformly to keep shape
            pert.append(Bar(time=b.time, open=b.open * m, high=b.high * m, low=b.low * m, close=b.close * m))
        rep = backtest_with_bars(opts, pert, 0, len(pert) - 1, equity_start, fee_pct)
        if rep:
            pf_vals.append(_finite_pf(rep.get("profitFactor", 0.0)))
            pnl_vals.append(float(rep.get("totalPnl", 0.0)))
    return {
        "mc_runs": float(len(pf_vals)),
        "mc_pf_mean": _mean(pf_vals),
        "mc_pf_std": _std(pf_vals),
        "mc_pnl_mean": _mean(pnl_vals),
        "mc_positive_frac": (sum(1 for pnl in pnl_vals if pnl > 0.0) / len(pnl_vals)) if pnl_vals else 0.0,
    }


def evaluate_period(
    bars: list[Bar],
    opts: HeavenOpts,
    from_idx: int,
    to_idx: int,
    equity_start: float,
    fee_pct: float,
    prefix: str = "oos",
) -> dict[str, float]:
    rep = backtest_with_bars(opts, bars, from_idx, to_idx, equity_start, fee_pct)
    if not rep:
        return {}
    total_pnl = float(rep.get("totalPnl", 0.0))
    return {
        f"{prefix}_totalPnl": total_pnl,
        f"{prefix}_return_pct": (total_pnl / equity_start * 100.0) if equity_start > 0 else 0.0,
        f"{prefix}_profitFactor": _finite_pf(rep.get("profitFactor", 0.0)),
        f"{prefix}_trades": float(len(rep.get("trades", []))),
        f"{prefix}_winrate": float(rep.get("winrate", 0.0)),
        f"{prefix}_avgRR": float(rep.get("avgRR", 0.0) or 0.0),
        f"{prefix}_sharpe": float(rep.get("sharpe", 0.0)),
        f"{prefix}_maxDDPct": float(rep.get("maxDDPct", 0.0)),
        f"{prefix}_maxDDAbs": float(rep.get("maxDDAbs", 0.0)),
        f"{prefix}_equityFinal": float(rep.get("equity", equity_start)),
    }
