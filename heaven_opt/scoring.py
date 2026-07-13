from __future__ import annotations

import math


def norm01(x: float, a: float, b: float) -> float:
    if x != x:
        return 0.0
    if b == a:
        return 0.0
    v = (x - a) / (b - a)
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def _base_score(metrics: dict[str, float], weights: dict[str, float]) -> float:
    """Score the optimization window without pretending it is out-of-sample."""
    pfN = norm01(float(metrics.get("profitFactor", 0.0)), 0.0, 3.0)
    sharpeN = norm01(float(metrics.get("sharpe", 0.0)), 0.0, 2.0)
    ddN = 1.0 - norm01(float(metrics.get("maxDDPct", 0.0)), 0.0, 50.0)
    rrN = norm01(float(metrics.get("avgRR", 0.0)), 0.0, 2.0)
    calmarN = norm01(float(metrics.get("calmar", 0.0)), 0.0, 3.0)
    r2N = max(0.0, min(1.0, float(metrics.get("r2", 0.0))))
    slopeN = norm01(float(metrics.get("slope", 0.0)), 0.0, 0.02)
    pnl = float(metrics.get("totalPnl", 0.0))
    ddAbs = float(metrics.get("maxDDAbs", 0.0))
    recov = (pnl / ddAbs) if ddAbs > 1e-9 else 0.0
    recovN = norm01(recov, 0.0, 3.0)
    consN = max(0.0, min(1.0, float(metrics.get("consistency", 0.0))))
    w = weights
    score = (
        (w.get("pf", 0.0) * pfN)
        + (w.get("sharpe", 0.0) * sharpeN)
        + (w.get("dd", 0.0) * ddN)
        + (w.get("rr", 0.0) * rrN)
        + (w.get("calmar", 0.0) * calmarN)
        + (w.get("r2", 0.0) * r2N)
        + (w.get("slope", 0.0) * slopeN)
        + (w.get("recov", 0.0) * recovN)
        + (w.get("cons", 0.0) * consN)
    )
    if "profitFactor" in metrics:
        pf = float(metrics.get("profitFactor", 0.0))
        if pf < 1.0:
            score *= norm01(pf, 0.50, 1.0)
    if "return_pct" in metrics:
        ret_pct = float(metrics.get("return_pct", 0.0))
        if ret_pct < 0.0:
            score *= norm01(ret_pct, -20.0, 0.0)
    return score


def _has_finite(metrics: dict[str, float], key: str) -> bool:
    try:
        return key in metrics and math.isfinite(float(metrics[key]))
    except (TypeError, ValueError):
        return False


def robustness_score(metrics: dict[str, float]) -> float | None:
    """Summarize holdout, walk-forward, and Monte-Carlo stability on a 0-1 scale."""
    groups: list[tuple[float, float]] = []

    if _has_finite(metrics, "oos_profitFactor"):
        oos_pf = norm01(float(metrics["oos_profitFactor"]), 0.8, 1.8)
        oos_ret = norm01(float(metrics.get("oos_return_pct", 0.0)), -5.0, 15.0)
        oos_dd = 1.0 - norm01(float(metrics.get("oos_maxDDPct", 100.0)), 0.0, 30.0)
        oos_trades = norm01(float(metrics.get("oos_trades", 0.0)), 5.0, 30.0)
        groups.append((0.50, 0.35 * oos_pf + 0.25 * oos_ret + 0.20 * oos_dd + 0.20 * oos_trades))

    if _has_finite(metrics, "wf_pf_mean"):
        wf_pf = norm01(float(metrics["wf_pf_mean"]), 0.8, 1.8)
        wf_positive = norm01(float(metrics.get("wf_positive_frac", 0.0)), 0.35, 0.80)
        wf_activity = norm01(float(metrics.get("wf_active_frac", 0.0)), 0.30, 0.80)
        wf_stability = 1.0 - norm01(float(metrics.get("wf_pf_std", 10.0)), 0.0, 1.5)
        groups.append((0.30, 0.40 * wf_pf + 0.30 * wf_positive + 0.15 * wf_activity + 0.15 * wf_stability))

    if _has_finite(metrics, "mc_pf_mean"):
        mc_pf = norm01(float(metrics["mc_pf_mean"]), 0.8, 1.8)
        mc_positive = norm01(float(metrics.get("mc_positive_frac", 0.0)), 0.35, 0.80)
        mc_stability = 1.0 - norm01(float(metrics.get("mc_pf_std", 10.0)), 0.0, 1.5)
        groups.append((0.20, 0.60 * mc_pf + 0.25 * mc_positive + 0.15 * mc_stability))

    total_weight = sum(weight for weight, _value in groups)
    if total_weight <= 0:
        return None
    return sum(weight * value for weight, value in groups) / total_weight


def composite_score(metrics: dict[str, float], weights: dict[str, float]) -> float:
    base = _base_score(metrics, weights)
    robust = robustness_score(metrics)
    if robust is None:
        score = base
    else:
        robust_weight = max(0.0, min(1.0, float(weights.get("robustness", 0.65))))
        score = (1.0 - robust_weight) * base + robust_weight * robust
    penalty = max(0.0, min(1.0, float(metrics.get("score_penalty", 0.0) or 0.0)))
    return max(0.0, score - penalty)
