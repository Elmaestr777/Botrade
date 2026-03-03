#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
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


def _load_env_file(env_file: str | None) -> bool:
    if not env_file:
        return False
    p = Path(env_file)
    if not p.exists() or not p.is_file():
        return False
    loaded = False
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        k, v = raw.split("=", 1)
        key = k.strip()
        if not key:
            continue
        value = v.strip().strip('"').strip("'")
        if key not in os.environ:
            os.environ[key] = value
            loaded = True
    return loaded


def _num(v: Any) -> str:
    try:
        if v is None:
            return "N/D"
        return f"{float(v):.4f}"
    except Exception:
        return "N/D"


def _missing_column_from_error(body: str | None) -> str | None:
    if not body:
        return None
    m = re.search(r"column\s+\w+\.([a-zA-Z0-9_]+)\s+does not exist", body, flags=re.IGNORECASE)
    return m.group(1) if m else None


def _infer_run_type(note: Any, run_context: Any) -> str:
    note_s = str(note or "").upper()
    if "LAB" in note_s:
        return "LAB"
    if "TRAIN" in note_s or "BATCH" in note_s or "NEW" in note_s:
        return "NEW"

    if isinstance(run_context, dict):
        mode_s = str(run_context.get("mode") or "").lower()
        if "lab" in mode_s:
            return "LAB"
        if mode_s:
            return "NEW"
    return ""


def _ddl_fix_hint_for_palmares_sets(missing_columns: list[str]) -> str:
    cols = sorted({c for c in missing_columns if c in {"run_id", "campaign_id", "run_type", "profile"}})
    if not cols:
        return ""

    parts: list[str] = []
    if "run_id" in cols:
        parts.append("  add column if not exists run_id uuid")
    if "campaign_id" in cols:
        parts.append("  add column if not exists campaign_id text")
    if "run_type" in cols:
        parts.append("  add column if not exists run_type text")
    if "profile" in cols:
        parts.append("  add column if not exists profile text")

    ddl = "alter table public.palmares_sets\n" + ",\n".join(parts) + ";"
    if "run_type" in cols:
        ddl += (
            "\n\nalter table public.palmares_sets drop constraint if exists palmares_sets_run_type_ck;"
            "\nalter table public.palmares_sets"
            "\n  add constraint palmares_sets_run_type_ck"
            "\n  check (run_type is null or run_type in ('NEW','LAB'));"
        )
    return ddl


def main() -> int:
    p = argparse.ArgumentParser(description="Report latest palmares from Botrade Supabase")
    p.add_argument("--symbol", required=True)
    p.add_argument("--tf", required=True)
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--note-contains", default=None)
    p.add_argument("--campaign-id", default=None)
    p.add_argument("--env-file", default=".env.local", help="Optional env file to auto-load if vars are missing")
    p.add_argument("--min-rr", type=float, default=1.0, help="Minimum avgRR required on top rank for GO gate")
    p.add_argument("--min-trades", type=int, default=30, help="Minimum trades required on top rank for GO gate")
    args = p.parse_args()

    _load_env_file(args.env_file)
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
    set_columns = [
        "id",
        "created_at",
        "symbol",
        "tf",
        "top_n",
        "note",
        "run_id",
        "campaign_id",
        "run_type",
        "profile",
    ]
    schema_missing_columns: list[str] = []
    try:
        rs = None
        for idx in range(len(set_columns)):
            set_params["select"] = ",".join(set_columns)
            rs = requests.get(f"{base}/palmares_sets", params=set_params, headers=h, timeout=20)
            if rs.status_code < 400:
                break
            snippet = (rs.text or "")[:300].replace("\n", " ")
            missing_col = _missing_column_from_error(rs.text)
            if rs.status_code == 400 and missing_col and missing_col in set_columns:
                print(
                    f"palmares_sets attempt#{idx+1} HTTP {rs.status_code}: dropping missing column '{missing_col}'",
                    file=sys.stderr,
                )
                schema_missing_columns.append(missing_col)
                set_columns = [c for c in set_columns if c != missing_col]
                continue
            print(f"palmares_sets attempt#{idx+1} HTTP {rs.status_code}: {snippet}", file=sys.stderr)
        if rs is None:
            print("Failed to fetch palmares_sets: no HTTP response", file=sys.stderr)
            return 1
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

    cmp_sets = [s for s in sets if (campaign_id and s.get("campaign_id") == campaign_id)] if campaign_id else sets
    run_types = {
        (str(s.get("run_type") or "").upper() or _infer_run_type(s.get("note"), run_context))
        for s in cmp_sets
    }
    run_types.discard("")
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

    ddl_fix_hint = _ddl_fix_hint_for_palmares_sets(schema_missing_columns)
    schema_missing_sorted = sorted(list(set(schema_missing_columns)))

    top_rr = None
    top_trades = None
    if entries:
        top_metrics = entries[0].get("metrics") or {}
        try:
            top_rr = float(top_metrics.get("avgRR")) if top_metrics.get("avgRR") is not None else None
        except Exception:
            top_rr = None
        try:
            raw_trades = top_metrics.get("trades", top_metrics.get("tradesCount"))
            top_trades = int(raw_trades) if raw_trades is not None else None
        except Exception:
            top_trades = None

    go_reasons: list[str] = []
    if comparability != "COMPARABLE":
        go_reasons.append("comparability_not_comparable")
        if "LAB" not in run_types:
            go_reasons.append("comparability_missing_run_type_lab")
        if "NEW" not in run_types:
            go_reasons.append("comparability_missing_run_type_new")
    if schema_missing_sorted:
        go_reasons.append("schema_drift_detected")
    if top_rr is None:
        go_reasons.append("top_avgRR_missing")
    elif top_rr < float(args.min_rr):
        go_reasons.append(f"top_avgRR_below_min({top_rr:.4f}<{float(args.min_rr):.4f})")
    if top_trades is None:
        go_reasons.append("top_trades_missing")
    elif top_trades < int(args.min_trades):
        go_reasons.append(f"top_trades_below_min({top_trades}<{int(args.min_trades)})")

    go_status = "GO" if not go_reasons else "NO_GO"
    out = {
        "set": s0,
        "run_context": run_context,
        "comparability": comparability,
        "run_types_seen": sorted(list(run_types)),
        "schema_missing_columns": schema_missing_sorted,
        "ddl_fix_hint": ddl_fix_hint,
        "go_status": go_status,
        "go_reasons": go_reasons,
        "top_avgRR": top_rr,
        "min_rr_required": float(args.min_rr),
        "top_trades": top_trades,
        "min_trades_required": int(args.min_trades),
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
    print(f"GO gate: {go_status}")
    print(f"GO reasons: {','.join(go_reasons) if go_reasons else 'none'}")
    print(f"Risk gate avgRR: top={_num(top_rr)} min_required={_num(args.min_rr)}")
    print(f"Risk gate trades: top={top_trades if top_trades is not None else 'N/D'} min_required={int(args.min_trades)}")
    print(f"Schema drift: missing_columns={','.join(schema_missing_sorted) or 'none'}")
    if ddl_fix_hint:
        print("DDL fix hint for palmares_sets:")
        print(ddl_fix_hint)
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
