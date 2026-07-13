from __future__ import annotations

import math
from typing import Any

TP_SLOT_COUNT = 10


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def _slot(values: list[Any], idx: int, default: Any) -> Any:
    return values[idx] if idx < len(values) else default


def _tp_type(value: Any) -> str:
    raw = str(value or "Fib").strip().lower()
    if raw in {"percent", "pct"}:
        return "Percent"
    if raw == "ema":
        return "EMA"
    return "Fib"


def _tp_key(tp_type: str, value: float) -> tuple[str, float]:
    if tp_type == "EMA":
        return ("EMA", 0.0)
    return (tp_type, round(value, 8))


def _clamp_percent(value: float) -> float:
    return max(0.0, min(100.0, value))


def normalize_canonical_params(params: dict[str, Any] | None) -> dict[str, Any]:
    """Return canonical Heaven params with active duplicate TP slots merged.

    The optimizer stores TP targets as parallel canonical arrays
    (`tp_types`, `tp_r`, `tp_p`). Two active slots with the same effective
    target should be one strategy, not two duplicated orders.
    """

    out = dict(params or {})
    if not any(key in out for key in ("tp_types", "tp_r", "tp_p")):
        return out

    raw_types = list(out.get("tp_types") or [])[:TP_SLOT_COUNT]
    raw_values = list(out.get("tp_r") or [])[:TP_SLOT_COUNT]
    raw_weights = list(out.get("tp_p") or [])[:TP_SLOT_COUNT]

    merged: dict[tuple[str, float], dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []
    for idx in range(TP_SLOT_COUNT):
        tp_type = _tp_type(_slot(raw_types, idx, "Fib"))
        value = _as_float(_slot(raw_values, idx, 0.0))
        weight = _as_float(_slot(raw_weights, idx, 0.0))
        if weight <= 0.0:
            continue
        store_value = 0.0 if tp_type == "EMA" else value
        key = _tp_key(tp_type, store_value)
        if key in merged:
            merged[key]["weight"] = _clamp_percent(float(merged[key]["weight"]) + weight)
            continue
        item = {"type": tp_type, "value": store_value, "weight": _clamp_percent(weight)}
        merged[key] = item
        ordered.append(item)

    normalized_types = [_tp_type(_slot(raw_types, idx, "Fib")) for idx in range(TP_SLOT_COUNT)]
    if ordered:
        out["tp_types"] = [item["type"] for item in ordered] + normalized_types[len(ordered):]
        out["tp_r"] = [float(item["value"]) for item in ordered] + [0.0] * (TP_SLOT_COUNT - len(ordered))
        out["tp_p"] = [float(item["weight"]) for item in ordered] + [0.0] * (TP_SLOT_COUNT - len(ordered))
        return out

    out["tp_types"] = normalized_types
    out["tp_r"] = [_as_float(_slot(raw_values, idx, 0.0)) for idx in range(TP_SLOT_COUNT)]
    out["tp_p"] = [_as_float(_slot(raw_weights, idx, 0.0)) for idx in range(TP_SLOT_COUNT)]
    return out
