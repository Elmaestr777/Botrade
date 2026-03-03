from __future__ import annotations

from typing import Any, Iterable, Optional

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


def get_latest_top_params(
    api_key: str,
    symbol: str,
    tf: str,
    campaign_id: Optional[str] = None,
    prefer_run_type: str = "NEW",
) -> dict[str, Any] | None:
    """
    Fetch params of the best-ranked (rank=1) entry from the latest palmarès set
    for the given symbol/tf (+ optional campaign).
    """
    base = _rest_base_url()
    if not base or not api_key or not symbol or not tf:
        return None

    sets_url = f"{base}/palmares_sets"
    sets_params = {
        "select": "id,created_at,run_type,campaign_id",
        "symbol": f"eq.{symbol}",
        "tf": f"eq.{tf}",
        "order": "created_at.desc",
        "limit": "20",
    }
    if campaign_id:
        sets_params["campaign_id"] = f"eq.{campaign_id}"

    try:
        rs = requests.get(sets_url, params=sets_params, headers=_headers(api_key), timeout=20)
        rs.raise_for_status()
        sets = rs.json() or []
    except Exception as e:
        setup_logger().warning(f"Supabase get_latest_top_params sets query failed: {e}")
        return None

    if not sets:
        return None

    preferred = (prefer_run_type or "NEW").strip().upper()
    chosen = None
    for s in sets:
        rt = str((s or {}).get("run_type") or "").upper()
        if preferred and rt == preferred:
            chosen = s
            break
    if not chosen:
        chosen = sets[0]

    set_id = (chosen or {}).get("id")
    if not set_id:
        return None

    ent_url = f"{base}/palmares_entries"
    ent_params = {
        "select": "params,rank",
        "set_id": f"eq.{set_id}",
        "order": "rank.asc",
        "limit": "1",
    }
    try:
        re = requests.get(ent_url, params=ent_params, headers=_headers(api_key), timeout=20)
        re.raise_for_status()
        arr = re.json() or []
        if arr:
            params = (arr[0] or {}).get("params")
            if isinstance(params, dict):
                return params
    except Exception as e:
        setup_logger().warning(f"Supabase get_latest_top_params entries query failed: {e}")

    return None


def get_existing_param_keys(
    api_key: str,
    symbol: str,
    tf: str,
    campaign_id: Optional[str] = None,
    limit: int = 10000,
) -> set[str]:
    """Return hashed params keys already evaluated for symbol/tf (and optional campaign)."""
    base = _rest_base_url()
    if not base or not api_key or not symbol or not tf:
        return set()

    url = f"{base}/strategy_evaluations"
    params = {
        "select": "params",
        "symbol": f"eq.{symbol}",
        "tf": f"eq.{tf}",
        "limit": str(max(1, int(limit))),
    }
    if campaign_id:
        params["campaign_id"] = f"eq.{campaign_id}"

    try:
        r = requests.get(url, params=params, headers=_headers(api_key), timeout=30)
        r.raise_for_status()
        arr = r.json() or []
    except Exception as e:
        setup_logger().warning(f"Supabase get_existing_param_keys failed: {e}")
        return set()

    out = set()
    for row in arr:
        p = (row or {}).get("params")
        if isinstance(p, dict):
            out.add(_params_key(p))
    return out


def get_reference_top_entry(
    api_key: str,
    symbol: str,
    tf: str,
    campaign_id: Optional[str] = None,
    run_type: str = "NEW",
) -> dict[str, Any] | None:
    """Fetch latest top (rank=1) palmares entry for the requested run_type."""
    base = _rest_base_url()
    if not base or not api_key or not symbol or not tf:
        return None

    sets_url = f"{base}/palmares_sets"
    sets_params = {
        "select": "id,created_at,run_type",
        "symbol": f"eq.{symbol}",
        "tf": f"eq.{tf}",
        "order": "created_at.desc",
        "limit": "50",
    }
    if campaign_id:
        sets_params["campaign_id"] = f"eq.{campaign_id}"

    try:
        rs = requests.get(sets_url, params=sets_params, headers=_headers(api_key), timeout=20)
        rs.raise_for_status()
        sets = rs.json() or []
    except Exception as e:
        setup_logger().warning(f"Supabase get_reference_top_entry sets failed: {e}")
        return None

    target = str(run_type or "NEW").upper()
    set_id = None
    for s in sets:
        if str((s or {}).get("run_type") or "").upper() == target:
            set_id = (s or {}).get("id")
            break
    if not set_id:
        return None

    ent_url = f"{base}/palmares_entries"
    ent_params = {
        "select": "params,metrics,score,generation,rank",
        "set_id": f"eq.{set_id}",
        "rank": "eq.1",
        "limit": "1",
    }
    try:
        re = requests.get(ent_url, params=ent_params, headers=_headers(api_key), timeout=20)
        re.raise_for_status()
        arr = re.json() or []
        return arr[0] if arr else None
    except Exception as e:
        setup_logger().warning(f"Supabase get_reference_top_entry entry failed: {e}")
        return None


def get_lab_seed_params(
    api_key: str,
    symbol: str,
    tf: str,
    campaign_id: Optional[str] = None,
    prefer_run_type: str = "NEW",
    top_n_score: int = 10,
    top_n_profit: int = 10,
) -> list[dict[str, Any]]:
    """
    Build LAB mutation seeds from NEW palmarès entries on the target TF:
    - top N by score
    - top N by totalPnl
    Selection is global across recent matching sets (not a single set), then dedup by params.
    """
    base = _rest_base_url()
    if not base or not api_key or not symbol or not tf:
        return []

    sets_url = f"{base}/palmares_sets"
    sets_params = {
        "select": "id,created_at,run_type,campaign_id",
        "symbol": f"eq.{symbol}",
        "tf": f"eq.{tf}",
        "order": "created_at.desc",
        "limit": "50",
    }
    if campaign_id:
        sets_params["campaign_id"] = f"eq.{campaign_id}"

    try:
        rs = requests.get(sets_url, params=sets_params, headers=_headers(api_key), timeout=20)
        rs.raise_for_status()
        sets = rs.json() or []
    except Exception as e:
        setup_logger().warning(f"Supabase get_lab_seed_params sets query failed: {e}")
        return []

    if not sets:
        return []

    preferred = (prefer_run_type or "NEW").strip().upper()
    target_set_ids = [
        str((s or {}).get("id"))
        for s in sets
        if str((s or {}).get("run_type") or "").upper() == preferred and (s or {}).get("id")
    ]
    if not target_set_ids:
        # fallback: use latest set if no preferred run_type found
        latest_id = (sets[0] or {}).get("id")
        if latest_id:
            target_set_ids = [str(latest_id)]

    if not target_set_ids:
        return []

    ent_url = f"{base}/palmares_entries"
    rows_all: list[dict[str, Any]] = []
    for sid in target_set_ids[:20]:
        ent_params = {
            "select": "params,rank,metrics,score,set_id",
            "set_id": f"eq.{sid}",
            "limit": "200",
        }
        try:
            re = requests.get(ent_url, params=ent_params, headers=_headers(api_key), timeout=20)
            re.raise_for_status()
            arr = re.json() or []
            if isinstance(arr, list):
                rows_all.extend(arr)
        except Exception as e:
            setup_logger().warning(f"Supabase get_lab_seed_params entries query failed for set_id={sid}: {e}")

    if not rows_all:
        return []

    def _score(row):
        try:
            if row.get("score") is not None:
                return float(row.get("score") or 0.0)
            m = (row or {}).get("metrics") or {}
            return float(m.get("score", 0.0) or 0.0)
        except Exception:
            return 0.0

    def _pnl(row):
        m = (row or {}).get("metrics") or {}
        try:
            return float(m.get("totalPnl", 0.0) or 0.0)
        except Exception:
            return 0.0

    by_score = sorted(rows_all, key=_score, reverse=True)[: max(1, int(top_n_score))]
    by_profit = sorted(rows_all, key=_pnl, reverse=True)[: max(1, int(top_n_profit))]

    out: list[dict[str, Any]] = []
    seen = set()
    for row in by_score + by_profit:
        params = (row or {}).get("params")
        if not isinstance(params, dict):
            continue
        key = _params_key(params)
        if key in seen:
            continue
        seen.add(key)
        out.append(params)

    return out
