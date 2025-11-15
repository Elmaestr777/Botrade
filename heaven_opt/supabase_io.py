from __future__ import annotations

from typing import Any, Iterable

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


def get_balancee_profile_id(api_key: str) -> str | None:
    base = _rest_base_url()
    if not base:
        return None
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
    except Exception:
        pass
    return None


def upsert_strategy_evaluations(rows: list[dict[str, Any]], api_key: str, batch: int = 100) -> None:
    base = _rest_base_url()
    if not base or not api_key or not rows:
        return
    url = f"{base}/strategy_evaluations"
    headers = _headers(api_key)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    params = {
        # Use partial unique index for public pooling (user_id IS NULL)
        "on_conflict": "symbol,tf,profile_id,params",
    }
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=chunk, params=params, headers=headers, timeout=30)
            r.raise_for_status()
        except Exception as e:
            # best-effort; log and continue
            setup_logger().warning(f"Supabase upsert_strategy_evaluations failed: {e}")


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


def insert_palmares_entries(rows: list[dict[str, Any]], api_key: str, batch: int = 100) -> None:
    base = _rest_base_url()
    if not base or not api_key or not rows:
        return
    url = f"{base}/palmares_entries"
    headers = _headers(api_key)
    headers["Prefer"] = "return=minimal"
    for chunk in _chunked(rows, max(1, batch)):
        try:
            r = requests.post(url, json=chunk, headers=headers, timeout=30)
            r.raise_for_status()
        except Exception as e:
            setup_logger().warning(f"Supabase insert_palmares_entries failed: {e}")


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
