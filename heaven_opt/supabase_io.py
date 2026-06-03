from __future__ import annotations

from typing import Any, Iterable

import requests

from .data_sources import _rest_base_url


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


def _required_base(api_key: str) -> str:
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
        r.raise_for_status()
        arr = r.json() or []
        if arr:
            return arr[0].get("id")
    except Exception as e:
        raise SupabasePersistenceError(f"Supabase lab_profiles lookup failed: {e}") from e
    return None


def upsert_strategy_evaluations(rows: list[dict[str, Any]], api_key: str, batch: int = 100) -> None:
    if not rows:
        return
    base = _required_base(api_key)
    url = f"{base}/strategy_evaluations"
    headers = _headers(api_key)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    params = {
        "on_conflict": "user_id,symbol,tf,profile_id,params,run_id",
    }
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=chunk, params=params, headers=headers, timeout=30)
            r.raise_for_status()
        except Exception as e:
            raise SupabasePersistenceError(f"Supabase strategy_evaluations upsert failed: {e}") from e


def create_palmares_set(row: dict[str, Any], api_key: str) -> str:
    base = _required_base(api_key)
    url = f"{base}/palmares_sets"
    headers = _headers(api_key)
    headers["Prefer"] = "return=representation"
    try:
        r = requests.post(url, json=row, headers=headers, timeout=20)
        r.raise_for_status()
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
    base = _required_base(api_key)
    url = f"{base}/palmares_entries"
    headers = _headers(api_key)
    headers["Prefer"] = "return=minimal"
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=chunk, headers=headers, timeout=30)
            r.raise_for_status()
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


def canonical_params_to_ui_params(params: dict[str, Any]) -> dict[str, Any]:
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
    return {
        "nol": int(params.get("nol") or 3),
        "prd": int(params.get("prd") or 15),
        "slInitPct": float(params.get("sl_init_pct") or 2.0),
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
    base = _required_base(api_key)
    url = f"{base}/heaven_strategies"
    headers = _headers(api_key)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    params = {"on_conflict": "user_id,symbol,tf,name"}
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=chunk, params=params, headers=headers, timeout=30)
            r.raise_for_status()
        except Exception as e:
            raise SupabasePersistenceError(f"Supabase heaven_strategies upsert failed: {e}") from e
