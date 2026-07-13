from __future__ import annotations

import math
from typing import Any


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _std(values: list[float]) -> float:
    mean = _mean(values)
    variance = sum((value - mean) * (value - mean) for value in values) / len(values) if values else 0.0
    return math.sqrt(variance)


def _longest_streak(values: list[float], positive: bool) -> int:
    best = 0
    current = 0
    for value in values:
        hit = value > 0.0 if positive else value < 0.0
        if hit:
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best


def trade_diagnostics(trades: list[dict[str, Any]], from_idx: int | None = None, to_idx: int | None = None) -> dict[str, float]:
    """Return strategy-analysis metrics derived from executed trades."""
    if not trades:
        return {
            "diag_avg_hold_bars": 0.0,
            "diag_max_hold_bars": 0.0,
            "diag_exposure_frac": 0.0,
            "diag_long_frac": 0.0,
            "diag_short_frac": 0.0,
            "diag_tp_exit_frac": 0.0,
            "diag_sl_exit_frac": 0.0,
            "diag_close_exit_frac": 0.0,
            "diag_expectancy": 0.0,
            "diag_avg_win": 0.0,
            "diag_avg_loss": 0.0,
            "diag_payoff_ratio": 0.0,
            "diag_max_consec_wins": 0.0,
            "diag_max_consec_losses": 0.0,
            "diag_rr_mean": 0.0,
            "diag_rr_std": 0.0,
        }

    pnl = [float(trade.get("pnl", 0.0) or 0.0) for trade in trades]
    wins = [value for value in pnl if value > 0.0]
    losses = [value for value in pnl if value < 0.0]
    holds = [
        max(0.0, float(trade.get("exitIdx", 0) or 0) - float(trade.get("entryIdx", 0) or 0) + 1.0)
        for trade in trades
    ]
    rr_values = [
        float(trade.get("rr"))
        for trade in trades
        if trade.get("rr") is not None and math.isfinite(float(trade.get("rr")))
    ]
    reasons = [str(trade.get("reason") or "") for trade in trades]
    dirs = [str(trade.get("dir") or "") for trade in trades]
    count = float(len(trades))
    window_bars = 0.0
    if from_idx is not None and to_idx is not None:
        window_bars = max(1.0, float(to_idx - from_idx + 1))
    avg_loss = _mean(losses)

    return {
        "diag_avg_hold_bars": _mean(holds),
        "diag_max_hold_bars": max(holds) if holds else 0.0,
        "diag_exposure_frac": (sum(holds) / window_bars) if window_bars > 0.0 else 0.0,
        "diag_long_frac": sum(1 for value in dirs if value == "long") / count,
        "diag_short_frac": sum(1 for value in dirs if value == "short") / count,
        "diag_tp_exit_frac": sum(1 for value in reasons if value == "TP") / count,
        "diag_sl_exit_frac": sum(1 for value in reasons if value == "SL") / count,
        "diag_close_exit_frac": sum(1 for value in reasons if value == "Close") / count,
        "diag_expectancy": _mean(pnl),
        "diag_avg_win": _mean(wins),
        "diag_avg_loss": avg_loss,
        "diag_payoff_ratio": (_mean(wins) / abs(avg_loss)) if avg_loss < 0.0 else 0.0,
        "diag_max_consec_wins": float(_longest_streak(pnl, positive=True)),
        "diag_max_consec_losses": float(_longest_streak(pnl, positive=False)),
        "diag_rr_mean": _mean(rr_values),
        "diag_rr_std": _std(rr_values),
    }


def prefix_metrics(metrics: dict[str, float], prefix: str) -> dict[str, float]:
    return {f"{prefix}_{key}": float(value) for key, value in metrics.items()}
