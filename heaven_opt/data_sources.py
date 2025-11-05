from __future__ import annotations

import os
from typing import Any

import requests

from .scoring import composite_score


def _rest_base_url() -> str | None:
    # Prefer explicit REST URL; else SUPABASE_URL + '/rest/v1'
    rest = os.getenv("SUPABASE_REST_URL")
    if rest:
        return rest.rstrip("/")
    url = os.getenv("SUPABASE_URL")
    if url:
        return url.rstrip("/") + "/rest/v1"
    return None


def fetch_history_from_supabase(symbol: str, tf: str, profile: str | None, max_rows: int = 2000) -> list[dict[str, Any]]:
    base = _rest_base_url()
    api_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    if not base or not api_key:
        return []
    url = f"{base}/strategy_evaluations"
    params = {
        "select": "params,metrics,score",
        "symbol": f"eq.{symbol}",
        "tf": f"eq.{tf}",
        "order": "created_at.desc",
        "limit": str(int(max_rows)),
    }
    if profile:
        params["profile_id"] = "is.null"  # placeholder unless you pass IDs; profile name join omitted
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    try:
        r = requests.get(url, params=params, headers=headers, timeout=20)
        r.raise_for_status()
        arr = r.json() or []
        out: list[dict[str, Any]] = []
        for it in arr:
            params_d = it.get("params") or {}
            mets = it.get("metrics") or {}
            score = it.get("score")
            out.append({"params": params_d, "metrics": mets, "score": score})
        return out
    except Exception:
        return []


def compute_scores_if_missing(items: list[dict[str, Any]], weights: dict[str, float]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for it in items:
        s = it.get("score")
        if s is None:
            s = composite_score(it.get("metrics") or {}, weights)
        out.append({"params": it.get("params") or {}, "score": float(s)})
    return out