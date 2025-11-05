from __future__ import annotations


def norm01(x: float, a: float, b: float) -> float:
    if x != x:
        return 0.0
    if b == a:
        return 0.0
    v = (x - a) / (b - a)
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def composite_score(metrics: dict[str, float], weights: dict[str, float]) -> float:
    # Heuristic normalizations similar to UI
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
    consN = 0.0  # placeholder
    w = weights
    return (
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
