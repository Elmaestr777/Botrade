from __future__ import annotations

import json
import math
from typing import Any, Iterable

import requests

from .data_sources import _rest_base_url
from .env import load_repo_env
from .params import normalize_canonical_params


class SupabasePersistenceError(RuntimeError):
    """Raised when a required Heaven persistence operation fails."""


def _headers(api_key: str) -> dict[str, str]:
    return {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        # Upserts may use this Prefer header; set per call as needed
    }


def _chunked(arr: list[Any], n: int) -> Iterable[list[Any]]:
    for i in range(0, len(arr), n):
        yield arr[i : i + n]


def _json_safe(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        if math.isnan(value):
            return "NaN"
        return "Infinity" if value > 0 else "-Infinity"
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _score_value(row: dict[str, Any]) -> float:
    try:
        value = float(row.get("score", float("-inf")))
        return value if math.isfinite(value) else float("-inf")
    except (TypeError, ValueError):
        return float("-inf")


def _normalize_canonical_row_params(row: dict[str, Any]) -> dict[str, Any]:
    if "params" not in row:
        return row
    normalized = dict(row)
    normalized["params"] = normalize_canonical_params(normalized.get("params") or {})
    return normalized


def _dedupe_strategy_evaluations(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[Any, ...], dict[str, Any]] = {}
    for original in rows:
        row = _normalize_canonical_row_params(original)
        params_key = json.dumps(
            _json_safe(row.get("params") or {}),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        key = (
            row.get("user_id"),
            row.get("symbol"),
            row.get("tf"),
            row.get("profile_id"),
            params_key,
            row.get("run_id"),
        )
        existing = unique.get(key)
        if existing is None:
            unique[key] = row
            continue
        existing_rank = (bool(existing.get("selected")), _score_value(existing))
        row_rank = (bool(row.get("selected")), _score_value(row))
        if row_rank >= existing_rank:
            unique[key] = row
    return list(unique.values())


def _raise_for_status(response: Any) -> None:
    try:
        response.raise_for_status()
    except Exception as e:
        detail = str(getattr(response, "text", "") or "").strip()
        if detail:
            raise RuntimeError(f"{e}; response={detail[:500]}") from e
        raise


def _required_base(api_key: str) -> str:
    load_repo_env()
    base = _rest_base_url()
    if not base:
        raise SupabasePersistenceError("SUPABASE_URL or SUPABASE_REST_URL is required")
    if not api_key:
        raise SupabasePersistenceError("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY is required")
    return base


def get_balancee_profile_id(api_key: str) -> str | None:
    base = _required_base(api_key)
    url = f"{base}/lab_profiles"
    params = {
        "select": "id",
        "name": "eq.balancee",
        "is_public": "is.true",
        "limit": "1",
    }
    try:
        r = requests.get(url, params=params, headers=_headers(api_key), timeout=15)
        _raise_for_status(r)
        arr = r.json() or []
        if arr:
            return arr[0].get("id")
    except Exception as e:
        raise SupabasePersistenceError(f"Supabase lab_profiles lookup failed: {e}") from e
    return None


def upsert_strategy_evaluations(rows: list[dict[str, Any]], api_key: str, batch: int = 100) -> None:
    if not rows:
        return
    rows = _dedupe_strategy_evaluations(rows)
    base = _required_base(api_key)
    url = f"{base}/strategy_evaluations"
    headers = _headers(api_key)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    params = {
        "on_conflict": "user_id,symbol,tf,profile_id,params,run_id",
    }
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=_json_safe(chunk), params=params, headers=headers, timeout=30)
            _raise_for_status(r)
        except Exception as e:
            raise SupabasePersistenceError(f"Supabase strategy_evaluations upsert failed: {e}") from e


def create_palmares_set(row: dict[str, Any], api_key: str) -> str:
    base = _required_base(api_key)
    url = f"{base}/palmares_sets"
    headers = _headers(api_key)
    headers["Prefer"] = "return=representation"
    try:
        r = requests.post(url, json=_json_safe(row), headers=headers, timeout=20)
        _raise_for_status(r)
        data = r.json() or []
        # PostgREST returns an array when Prefer: return=representation
        if isinstance(data, list) and data:
            return data[0].get("id")
        if isinstance(data, dict):
            return data.get("id")
    except Exception as e:
        raise SupabasePersistenceError(f"Supabase palmares_sets insert failed: {e}") from e
    raise SupabasePersistenceError("Supabase palmares_sets insert returned no id")


def insert_palmares_entries(rows: list[dict[str, Any]], api_key: str, batch: int = 100) -> None:
    if not rows:
        return
    rows = [_normalize_canonical_row_params(row) for row in rows]
    base = _required_base(api_key)
    url = f"{base}/palmares_entries"
    headers = _headers(api_key)
    headers["Prefer"] = "return=minimal"
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=_json_safe(chunk), headers=headers, timeout=30)
            _raise_for_status(r)
        except Exception as e:
            raise SupabasePersistenceError(f"Supabase palmares_entries insert failed: {e}") from e


def mark_selected_for_set(rows: list[dict[str, Any]], set_id: str, api_key: str, batch: int = 100) -> None:
    # Reuse upsert on strategy_evaluations, forcing selected=true and palmares_set_id
    if not rows or not set_id:
        return
    rows2: list[dict[str, Any]] = []
    for r in rows:
        row = dict(r)
        row["selected"] = True
        row["palmares_set_id"] = set_id
        rows2.append(row)
    upsert_strategy_evaluations(rows2, api_key, batch=batch)


def _dedupe_ui_tp(tp: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []
    for rung in tp[:10]:
        typ = str(rung.get("type") or "Fib")
        if typ == "Percent":
            value = float(rung.get("pct", rung.get("value", 0.0)) or 0.0)
            key = f"P:{value:.8f}"
        elif typ == "EMA":
            value = int(rung.get("emaLen") or 0)
            key = f"E:{value}"
        else:
            value = float(rung.get("fib", rung.get("value", 0.0)) or 0.0)
            key = f"F:{value:.8f}"
        qty = max(0.0, min(1.0, float(rung.get("qty") or 0.0)))
        if key in merged:
            merged[key]["qty"] = max(0.0, min(1.0, float(merged[key].get("qty") or 0.0) + qty))
        else:
            item = dict(rung)
            item["qty"] = qty
            merged[key] = item
            ordered.append(item)
    return ordered[:10]


def normalize_ui_strategy_params(params: dict[str, Any] | None) -> dict[str, Any]:
    out = dict(params or {})
    tp = out.get("tp")
    if isinstance(tp, list):
        deduped = _dedupe_ui_tp([dict(rung) for rung in tp if isinstance(rung, dict)])
        out["tp"] = deduped
        if out.get("tpEnable") is None or bool(out.get("tpEnable")):
            out["tpEnable"] = bool(deduped)
    return out


def canonical_params_to_ui_params(params: dict[str, Any]) -> dict[str, Any]:
    params = normalize_canonical_params(params)
    tp_types = list(params.get("tp_types") or [])[:10]
    tp_r = list(params.get("tp_r") or [])[:10]
    tp_p = list(params.get("tp_p") or [])[:10]
    tp: list[dict[str, Any]] = []
    for i in range(10):
        typ = str(tp_types[i] if i < len(tp_types) else "Fib")
        val = float(tp_r[i]) if i < len(tp_r) and tp_r[i] is not None else 0.0
        weight = float(tp_p[i]) if i < len(tp_p) and tp_p[i] is not None else 0.0
        if weight <= 0:
            continue
        qty = max(0.0, min(1.0, weight / 100.0))
        if typ == "Percent":
            tp.append({"type": "Percent", "pct": val, "value": val, "qty": qty})
        elif typ == "EMA":
            tp.append({"type": "EMA", "emaLen": int(params.get("ema_len") or 55), "qty": qty})
        else:
            tp.append({"type": "Fib", "fib": val, "value": val, "qty": qty})
    entry_mode = str(params.get("entry_mode") or "Both")
    if entry_mode == "Fib":
        entry_mode = "Fib Retracement"
    tp = _dedupe_ui_tp(tp)
    return {
        "nol": int(params.get("nol") or 3),
        "prd": int(params.get("prd") or 15),
        "slInitPct": float(params.get("sl_init_pct") or 2.0),
        "riskMgmt": bool(params.get("risk_mgmt", True)),
        "riskMaxPct": float(params.get("risk_max_pct") or 1.0),
        "leverage": float(params.get("leverage") or 1.0),
        "beEnable": bool(params.get("be_enable", True)),
        "beAfterBars": int(params.get("be_after_bars") or 5),
        "beLockPct": float(params.get("be_lock_pct") or 5.0),
        "emaLen": int(params.get("ema_len") or 55),
        "entryMode": entry_mode,
        "useFibRet": bool(params.get("use_fib_ret", True)),
        "confirmMode": str(params.get("confirm_mode") or "Bounce"),
        "ent382": True,
        "ent500": True,
        "ent618": True,
        "ent786": False,
        "tpEnable": bool(tp),
        "tp": tp,
        "slEnable": False,
        "sl": [],
        "tp1R": 1.0,
        "tpCompound": True,
        "tpCloseAllLast": True,
    }


def upsert_heaven_strategies(rows: list[dict[str, Any]], api_key: str, batch: int = 100) -> None:
    if not rows:
        return
    rows = [
        {**row, "params": normalize_ui_strategy_params(row.get("params") or {})}
        if "params" in row
        else row
        for row in rows
    ]
    base = _required_base(api_key)
    url = f"{base}/heaven_strategies"
    headers = _headers(api_key)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    params = {"on_conflict": "user_id,symbol,tf,name"}
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=_json_safe(chunk), params=params, headers=headers, timeout=30)
            _raise_for_status(r)
        except Exception as e:
            raise SupabasePersistenceError(f"Supabase heaven_strategies upsert failed: {e}") from e
