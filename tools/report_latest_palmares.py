#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import requests


def _rest_base() -> str | None:
    rest = os.getenv("SUPABASE_REST_URL")
    if rest:
        return rest.rstrip("/")
    url = os.getenv("SUPABASE_URL")
    if url:
        return url.rstrip("/") + "/rest/v1"
    return None


def _headers(api_key: str) -> dict[str, str]:
    return {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }


def _num(v: Any) -> str:
    try:
        if v is None:
            return "N/D"
        return f"{float(v):.4f}"
    except Exception:
        return "N/D"


def main() -> int:
    p = argparse.ArgumentParser(description="Report latest palmares from Botrade Supabase")
    p.add_argument("--symbol", required=True)
    p.add_argument("--tf", required=True)
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--note-contains", default=None)
    p.add_argument("--campaign-id", default=None)
    args = p.parse_args()

    base = _rest_base()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        print("Missing SUPABASE_URL/SUPABASE_REST_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2

    h = _headers(key)
    set_params = {
        "select": "id,created_at,symbol,tf,top_n,note,run_id,campaign_id,run_type,profile",
        "symbol": f"eq.{args.symbol}",
        "tf": f"eq.{args.tf}",
        "order": "created_at.desc",
        "limit": "5",
    }
    try:
        rs = requests.get(f"{base}/palmares_sets", params=set_params, headers=h, timeout=20)
        rs.raise_for_status()
        sets = rs.json() or []
    except Exception as e:
        print(f"Failed to fetch palmares_sets: {e}", file=sys.stderr)
        return 1

    if args.note_contains:
        sets = [s for s in sets if args.note_contains.lower() in str(s.get("note") or "").lower()]
    if args.campaign_id:
        sets = [s for s in sets if str(s.get("campaign_id") or "") == str(args.campaign_id)]

    if not sets:
        print("No palmares set found")
        return 0

    s0 = sets[0]
    set_id = s0.get("id")
    campaign_id = s0.get("campaign_id")
    cmp_sets = [s for s in sets if (campaign_id and s.get("campaign_id") == campaign_id)] if campaign_id else sets
    run_types = {str(s.get("run_type") or "").upper() for s in cmp_sets}
    comparability = "COMPARABLE" if ("NEW" in run_types and "LAB" in run_types) else "INCOMPARABLE"
    e_params = {
        "select": "rank,name,generation,score,metrics",
        "set_id": f"eq.{set_id}",
        "order": "rank.asc",
        "limit": str(max(1, args.limit)),
    }
    try:
        re = requests.get(f"{base}/palmares_entries", params=e_params, headers=h, timeout=20)
        re.raise_for_status()
        entries = re.json() or []
    except Exception as e:
        print(f"Failed to fetch palmares_entries: {e}", file=sys.stderr)
        return 1

    # Optional run context (date range, mode) from strategy_evaluations linked by palmares_set_id
    run_context = None
    try:
        rc_params = {
            "select": "run_context",
            "palmares_set_id": f"eq.{set_id}",
            "order": "created_at.desc",
            "limit": "1",
        }
        rr = requests.get(f"{base}/strategy_evaluations", params=rc_params, headers=h, timeout=20)
        rr.raise_for_status()
        rc_rows = rr.json() or []
        if rc_rows:
            run_context = rc_rows[0].get("run_context") or None
    except Exception:
        run_context = None

    out = {
        "set": s0,
        "run_context": run_context,
        "comparability": comparability,
        "run_types_seen": sorted(list(run_types)),
        "entries": entries,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    print("\n# Summary")
    date_from = ((run_context or {}).get("date_from") if isinstance(run_context, dict) else None) or "N/D"
    date_to = ((run_context or {}).get("date_to") if isinstance(run_context, dict) else None) or "N/D"
    print("Engine: Heaven")
    print(f"Set: {set_id} | Pair: {s0.get('symbol')} | TF: {s0.get('tf')} | Note: {s0.get('note') or 'N/D'}")
    print(f"Run: run_id={s0.get('run_id') or 'N/D'} campaign_id={campaign_id or 'N/D'} run_type={s0.get('run_type') or 'N/D'} profile={s0.get('profile') or 'N/D'}")
    print(f"Comparability: {comparability} (run_types_seen={','.join(sorted(list(run_types))) or 'none'})")
    print(f"Test range: {date_from} -> {date_to}")
    for r in entries:
        m = r.get("metrics") or {}
        trades = m.get("trades", m.get("tradesCount"))
        print(
            f"{r.get('rank','N/D')}. name={r.get('name') or 'N/D'} gen={r.get('generation','N/D')} "
            f"score={_num(r.get('score'))} pnl={_num(m.get('totalPnl'))} "
            f"eq={_num(m.get('equityFinal'))} pf={_num(m.get('profitFactor'))} "
            f"win={_num(m.get('winrate'))} rr={_num(m.get('avgRR'))} dd={_num(m.get('maxDDPct'))} trades={trades if trades is not None else 'N/D'}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
