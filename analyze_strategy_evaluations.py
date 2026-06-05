from __future__ import annotations

import argparse
import json
import math
import os
from collections import Counter
from typing import Any

import requests

PAPER_GATE_ORDER = (
    "paper_runner_entry_mode",
    "train_trades",
    "oos_missing",
    "oos_trades",
    "oos_profit_factor",
    "oos_return",
    "oos_drawdown",
    "wf_positive_frac",
    "wf_active_frac",
    "wf_profit_factor",
    "mc_profit_factor",
    "not_robustly_validated",
)


def _required_env() -> tuple[str, str]:
    url = str(os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = str(os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_ANON_KEY") or "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY are required")
    return url, key


def _headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _json_response(response: requests.Response, context: str) -> Any:
    try:
        response.raise_for_status()
    except Exception as exc:
        detail = response.text[:500] if response.text else str(exc)
        raise RuntimeError(f"{context}: {detail}") from exc
    if not response.content:
        return None
    return response.json()


def _num(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(out):
        return default
    return out


def _round(value: Any, digits: int = 4) -> float:
    value = _num(value)
    if math.isinf(value):
        return value
    return round(value, digits)


def paper_failure_names(metrics: dict[str, Any]) -> list[str]:
    prefix = "paper_fail_"
    active = {
        key[len(prefix):]
        for key, value in metrics.items()
        if key.startswith(prefix) and _num(value) >= 1.0
    }
    legacy = metrics.get("paper_gate_failures")
    if isinstance(legacy, list):
        active.update(str(name) for name in legacy)
    ordered = [name for name in PAPER_GATE_ORDER if name in active]
    return ordered + sorted(active.difference(ordered))


def summarize_evaluations(rows: list[dict[str, Any]], top_n: int = 10) -> dict[str, Any]:
    sorted_rows = sorted(rows, key=lambda row: _num(row.get("score")), reverse=True)
    failure_counts: Counter[str] = Counter()
    eligible_count = 0
    top: list[dict[str, Any]] = []
    best_by_scope: dict[str, dict[str, Any]] = {}

    for row in sorted_rows:
        metrics = dict(row.get("metrics") or {})
        failures = paper_failure_names(metrics)
        failure_counts.update(failures)
        if _num(metrics.get("paper_eligible")) >= 1.0:
            eligible_count += 1
        compact = {
            "campaign_id": row.get("campaign_id"),
            "symbol": row.get("symbol"),
            "tf": row.get("tf"),
            "score": _round(row.get("score")),
            "paper_eligible": int(_num(metrics.get("paper_eligible")) >= 1.0),
            "oos_return_pct": _round(metrics.get("oos_return_pct"), 2),
            "oos_profit_factor": _round(metrics.get("oos_profitFactor"), 3),
            "oos_max_drawdown_pct": _round(metrics.get("oos_maxDDPct"), 2),
            "wf_positive_frac": _round(metrics.get("wf_positive_frac"), 3),
            "wf_active_frac": _round(metrics.get("wf_active_frac"), 3),
            "wf_profit_factor": _round(metrics.get("wf_pf_mean"), 3),
            "mc_profit_factor": _round(metrics.get("mc_pf_mean"), 3),
            "failures": failures,
            "created_at": row.get("created_at"),
        }
        scope_key = f"{compact['symbol']}|{compact['tf']}|{compact['campaign_id']}"
        best_by_scope.setdefault(scope_key, compact)
        if len(top) < max(1, int(top_n)):
            top.append(compact)

    return {
        "rows": len(rows),
        "paper_eligible": eligible_count,
        "paper_ineligible": max(0, len(rows) - eligible_count),
        "failure_counts": dict(sorted(failure_counts.items(), key=lambda item: (-item[1], item[0]))),
        "top": top,
        "best_by_scope": list(best_by_scope.values()),
    }


def fetch_evaluations(
    base: str,
    key: str,
    *,
    campaign_id: str | None,
    campaign_prefix: str | None,
    symbol: str | None,
    tf: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    params = {
        "select": "campaign_id,symbol,tf,score,metrics,created_at",
        "order": "score.desc",
        "limit": str(max(1, int(limit))),
    }
    if campaign_id and campaign_prefix:
        raise RuntimeError("Use either --campaign-id or --campaign-prefix, not both")
    if campaign_id:
        params["campaign_id"] = f"eq.{campaign_id}"
    if campaign_prefix:
        params["campaign_id"] = f"like.{campaign_prefix}*"
    if symbol:
        params["symbol"] = f"eq.{symbol}"
    if tf:
        params["tf"] = f"eq.{tf}"
    response = requests.get(
        f"{base}/rest/v1/strategy_evaluations",
        params=params,
        headers=_headers(key),
        timeout=60,
    )
    rows = _json_response(response, "fetch strategy evaluations") or []
    return [dict(row) for row in rows]


def _print_text(summary: dict[str, Any]) -> None:
    print(f"rows={summary['rows']} paper_eligible={summary['paper_eligible']} paper_ineligible={summary['paper_ineligible']}")
    if summary["failure_counts"]:
        print("failure_counts:")
        for name, count in summary["failure_counts"].items():
            print(f"- {name}: {count}")
    if summary["top"]:
        print("top:")
        for idx, row in enumerate(summary["top"], start=1):
            failures = ",".join(row["failures"]) if row["failures"] else "none"
            print(
                f"{idx}. {row['symbol']} {row['tf']} score={row['score']:.4f} "
                f"eligible={row['paper_eligible']} oos_ret={row['oos_return_pct']:.2f}% "
                f"oos_pf={row['oos_profit_factor']:.3f} wf_pos={row['wf_positive_frac']:.3f} "
                f"failures={failures} campaign={row['campaign_id']}"
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze Supabase Heaven strategy evaluations")
    parser.add_argument("--campaign-id")
    parser.add_argument("--campaign-prefix")
    parser.add_argument("--symbol")
    parser.add_argument("--tf")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    base, key = _required_env()
    rows = fetch_evaluations(
        base,
        key,
        campaign_id=args.campaign_id,
        campaign_prefix=args.campaign_prefix,
        symbol=args.symbol,
        tf=args.tf,
        limit=args.limit,
    )
    summary = summarize_evaluations(rows, top_n=args.top_n)
    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True, default=str))
    else:
        _print_text(summary)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        raise SystemExit(1) from None
