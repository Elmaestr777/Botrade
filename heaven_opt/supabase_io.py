from __future__ import annotations

from typing import Any, Iterable

import json
import requests

from .data_sources import _rest_base_url
from .utils import setup_logger


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


def get_profile_id(api_key: str, profile_name: str = "balancee") -> str | None:
    base = _rest_base_url()
    if not base:
        return None
    name = (profile_name or "balancee").strip().lower()
    url = f"{base}/lab_profiles"
    params = {
        "select": "id",
        "name": f"eq.{name}",
        "is_public": "is.true",
        "limit": "1",
    }
    try:
        r = requests.get(url, params=params, headers=_headers(api_key), timeout=15)
        r.raise_for_status()
        arr = r.json() or []
        if arr:
            return arr[0].get("id")
    except Exception:
        pass
    return None


def get_balancee_profile_id(api_key: str) -> str | None:
    # Backward-compatible helper
    return get_profile_id(api_key, "balancee")


def insert_strategy_evaluations(rows: list[dict[str, Any]], api_key: str, batch: int = 100) -> dict[str, int]:
    base = _rest_base_url()
    if not base or not api_key or not rows:
        return {"rows_total": len(rows or []), "persisted": 0, "failed": 0}
    url = f"{base}/strategy_evaluations"
    headers = _headers(api_key)
    headers["Prefer"] = "return=minimal"

    persisted = 0
    failed = 0
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=chunk, headers=headers, timeout=30)
            r.raise_for_status()
            persisted += len(chunk)
        except Exception as e:
            failed += len(chunk)
            setup_logger().warning(f"Supabase insert_strategy_evaluations failed: {e}")

    out = {"rows_total": len(rows), "persisted": persisted, "failed": failed}
    setup_logger().info(
        "Supabase insert_strategy_evaluations summary: rows_total=%s persisted=%s failed=%s",
        out["rows_total"],
        out["persisted"],
        out["failed"],
    )
    return out


def create_palmares_set(row: dict[str, Any], api_key: str) -> str | None:
    base = _rest_base_url()
    if not base or not api_key:
        return None
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
        setup_logger().warning(f"Supabase create_palmares_set failed: {e}")
    return None


def insert_palmares_entries(rows: list[dict[str, Any]], api_key: str, batch: int = 100) -> dict[str, int]:
    base = _rest_base_url()
    if not base or not api_key or not rows:
        return {"rows_total": len(rows or []), "persisted": 0, "failed": 0}
    url = f"{base}/palmares_entries"
    headers = _headers(api_key)
    headers["Prefer"] = "return=minimal"
    persisted = 0
    failed = 0
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=chunk, headers=headers, timeout=30)
            r.raise_for_status()
            persisted += len(chunk)
        except Exception as e:
            failed += len(chunk)
            setup_logger().warning(f"Supabase insert_palmares_entries failed: {e}")
    return {"rows_total": len(rows), "persisted": persisted, "failed": failed}


def _params_key(p: dict[str, Any] | None) -> str:
    return json.dumps(p or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def mark_selected_for_set(rows: list[dict[str, Any]], set_id: str, api_key: str, batch: int = 100) -> dict[str, int]:
    """
    Mark rows as selected=true for a given palmarès set.

    Pass2 strategy (to avoid 409 conflicts on public rows with NULL user_id):
    - update-first by row id (fetched via key lookup), no upsert here.
    - optional fallback insert is intentionally skipped to keep behavior safe and deterministic.
    """
    base = _rest_base_url()
    if not base or not api_key or not rows or not set_id:
        return {"rows_total": len(rows or []), "updated": 0, "missing": len(rows or []), "failed": 0}

    url = f"{base}/strategy_evaluations"
    headers = _headers(api_key)
    headers["Prefer"] = "return=minimal"

    updated = 0
    missing = 0
    failed = 0

    # Group lookups to reduce REST calls
    groups: dict[tuple[Any, str, str, Any, Any], list[dict[str, Any]]] = {}
    for r in rows:
        key = (r.get("user_id"), str(r.get("symbol")), str(r.get("tf")), r.get("profile_id"), r.get("run_id"))
        groups.setdefault(key, []).append(r)

    for (user_id, symbol, tf, profile_id, run_id), grp_rows in groups.items():
        # Fetch candidate rows for this scope
        params = {
            "select": "id,params,run_id",
            "symbol": f"eq.{symbol}",
            "tf": f"eq.{tf}",
            "limit": "5000",
        }
        if user_id is None:
            params["user_id"] = "is.null"
        else:
            params["user_id"] = f"eq.{user_id}"
        if profile_id is None:
            params["profile_id"] = "is.null"
        else:
            params["profile_id"] = f"eq.{profile_id}"
        if run_id:
            params["run_id"] = f"eq.{run_id}"

        try:
            rr = requests.get(url, params=params, headers=headers, timeout=30)
            rr.raise_for_status()
            arr = rr.json() or []
        except Exception as e:
            failed += len(grp_rows)
            setup_logger().warning(f"Supabase mark_selected_for_set fetch failed: {e}")
            continue

        by_params: dict[str, str] = {}
        for it in arr:
            by_params[_params_key(it.get("params") or {})] = str(it.get("id"))

        for r in grp_rows:
            rid = by_params.get(_params_key(r.get("params") or {}))
            if not rid:
                missing += 1
                continue
            try:
                pr = requests.patch(
                    url,
                    params={"id": f"eq.{rid}"},
                    json={"selected": True, "palmares_set_id": set_id},
                    headers=headers,
                    timeout=30,
                )
                pr.raise_for_status()
                updated += 1
            except Exception as e:
                failed += 1
                setup_logger().warning(f"Supabase mark_selected_for_set patch failed: {e}")

    setup_logger().info(
        "Supabase mark_selected_for_set summary: rows_total=%s updated=%s missing=%s failed=%s",
        len(rows),
        updated,
        missing,
        failed,
    )
    return {"rows_total": len(rows), "updated": updated, "missing": missing, "failed": failed}
