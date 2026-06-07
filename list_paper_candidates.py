from __future__ import annotations

import argparse
import json
import math
import os
import re
from collections import Counter
from typing import Any

import requests

from heaven_opt.env import load_repo_env
from heaven_opt.supabase_io import headless_entry_mode_failures, normalize_ui_strategy_params


def _required_env() -> tuple[str, str]:
    load_repo_env()
    url = str(os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = str(
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SERVICE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or ""
    )
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_KEY, or SUPABASE_ANON_KEY are required"
        )
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


def _safe_slug(value: Any, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return slug or fallback


def _strategy_ref(candidate: dict[str, Any]) -> tuple[str, str]:
    strategy_id = str(candidate.get("id") or "").strip()
    if strategy_id:
        return "--strategy-id", strategy_id
    name = str(candidate.get("name") or "").strip()
    if not name:
        raise RuntimeError("Paper candidate requires an id or name")
    return "--strategy-name", json.dumps(name)


def _session_stub(candidate: dict[str, Any], prefix: str) -> str:
    symbol = _safe_slug(candidate.get("symbol"), "symbol")
    tf = _safe_slug(candidate.get("tf"), "tf")
    ref = _safe_slug(candidate.get("id") or candidate.get("name"), "strategy")[:12]
    return f"{_safe_slug(prefix, 'paper')}-{symbol}-{tf}-{ref}"


def _gate_failures(metrics: dict[str, Any]) -> list[str]:
    failures = metrics.get("paper_gate_failures")
    return [str(item) for item in failures] if isinstance(failures, list) else []


def paper_candidate_failures(
    row: dict[str, Any],
    *,
    require_robust: bool = True,
    require_supported_entry: bool = True,
    max_risk_pct: float = 1.0,
    max_leverage: float = 1.0,
) -> list[str]:
    metrics = dict(row.get("metrics") or {})
    params = normalize_ui_strategy_params(dict(row.get("params") or {}))
    risk_pct = _num(params.get("riskMaxPct"))
    leverage = _num(params.get("leverage"), default=1.0)
    failures: list[str] = []
    if _num(metrics.get("paper_eligible")) < 1.0:
        failures.append("paper_eligible")
    if _gate_failures(metrics):
        failures.append("paper_gate_failures")
    if require_robust and _num(metrics.get("robustly_validated")) < 1.0:
        failures.append("robustly_validated")
    if require_supported_entry:
        failures.extend(headless_entry_mode_failures(params))
    if risk_pct <= 0.0 or risk_pct > max_risk_pct:
        failures.append("max_risk_pct")
    if leverage < 1.0 or leverage > max_leverage:
        failures.append("max_leverage")
    return failures


def compact_candidate(
    row: dict[str, Any],
    *,
    session_prefix: str,
    max_risk_pct: float = 1.0,
    max_leverage: float = 1.0,
) -> dict[str, Any]:
    metrics = dict(row.get("metrics") or {})
    params = normalize_ui_strategy_params(dict(row.get("params") or {}))
    candidate = {
        "id": row.get("id"),
        "name": row.get("name"),
        "symbol": row.get("symbol"),
        "tf": row.get("tf"),
        "created_at": row.get("created_at"),
        "score": _round(metrics.get("score")),
        "robustness_score": _round(metrics.get("robustness_score")),
        "paper_eligible": int(_num(metrics.get("paper_eligible")) >= 1.0),
        "robustly_validated": int(_num(metrics.get("robustly_validated")) >= 1.0),
        "entry_mode": params.get("entryMode"),
        "risk_max_pct": _round(params.get("riskMaxPct"), 3),
        "leverage": _round(params.get("leverage"), 3),
        "paper_gate_failures": _gate_failures(metrics),
    }
    session_name = _session_stub(candidate, session_prefix)
    live_name = session_name.replace(f"{_safe_slug(session_prefix, 'paper')}-", "live-", 1)
    strategy_flag, strategy_value = _strategy_ref(candidate)
    strategy_args = f"{strategy_flag} {strategy_value}"
    control_args = f"--max-risk-pct {max_risk_pct:g} --max-leverage {max_leverage:g}"
    candidate["commands"] = {
        "start_paper": (
            f"python start_paper_candidate.py {strategy_args} --session-name {session_name} "
            f"{control_args} --invoke-runner"
        ),
        "validate_paper": f"python validate_paper_session.py --session-name {session_name} --record-event --strict-exit",
        "audit_live": (
            f"python prepare_live_candidate.py --session-name {session_name} {strategy_args} "
            f"--target-session-name {live_name} {control_args} --record-event --strict-exit"
        ),
    }
    return candidate


def build_paper_candidate_report(
    rows: list[dict[str, Any]],
    *,
    top_n: int = 10,
    session_prefix: str = "paper",
    require_robust: bool = True,
    require_supported_entry: bool = True,
    max_risk_pct: float = 1.0,
    max_leverage: float = 1.0,
) -> dict[str, Any]:
    excluded_counts: Counter[str] = Counter()
    candidates: list[dict[str, Any]] = []
    for row in rows:
        failures = paper_candidate_failures(
            row,
            require_robust=require_robust,
            require_supported_entry=require_supported_entry,
            max_risk_pct=max_risk_pct,
            max_leverage=max_leverage,
        )
        if failures:
            excluded_counts.update(failures)
            continue
        candidates.append(
            compact_candidate(
                row,
                session_prefix=session_prefix,
                max_risk_pct=max_risk_pct,
                max_leverage=max_leverage,
            )
        )
    candidates.sort(
        key=lambda item: (
            _num(item.get("robustness_score")),
            _num(item.get("score")),
            str(item.get("created_at") or ""),
        ),
        reverse=True,
    )
    top = candidates[: max(1, int(top_n))]
    return {
        "rows": len(rows),
        "candidates": top,
        "candidate_count": len(candidates),
        "excluded_count": max(0, len(rows) - len(candidates)),
        "excluded_failure_counts": dict(sorted(excluded_counts.items(), key=lambda item: (-item[1], item[0]))),
        "controls": {
            "max_risk_pct": float(max_risk_pct),
            "max_leverage": float(max_leverage),
        },
    }


def fetch_heaven_strategies(
    base: str,
    key: str,
    *,
    symbol: str | None,
    tf: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    params = {
        "select": "id,name,symbol,tf,params,metrics,created_at",
        "order": "created_at.desc",
        "limit": str(max(1, int(limit))),
    }
    if symbol:
        params["symbol"] = f"eq.{symbol}"
    if tf:
        params["tf"] = f"eq.{tf}"
    response = requests.get(
        f"{base}/rest/v1/heaven_strategies",
        params=params,
        headers=_headers(key),
        timeout=60,
    )
    rows = _json_response(response, "fetch heaven strategies") or []
    return [dict(row) for row in rows]


def _print_text(report: dict[str, Any]) -> None:
    print(
        f"rows={report['rows']} candidates={report['candidate_count']} "
        f"excluded={report['excluded_count']}"
    )
    if report.get("excluded_failure_counts"):
        print("excluded_failure_counts:")
        for name, count in report["excluded_failure_counts"].items():
            print(f"- {name}: {count}")
    if report.get("candidates"):
        print("paper_candidates:")
        for idx, item in enumerate(report["candidates"], start=1):
            print(
                f"{idx}. {item.get('name')} id={item.get('id')} {item.get('symbol')} {item.get('tf')} "
                f"score={item.get('score'):.4f} robust={item.get('robustness_score'):.4f} "
                f"risk={item.get('risk_max_pct'):.3f}% lev={item.get('leverage'):.3f}"
            )
            for command_name, command in item["commands"].items():
                print(f"   {command_name}: {command}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="List concrete Supabase Heaven strategies ready for paper trading")
    parser.add_argument("--symbol")
    parser.add_argument("--tf")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument("--session-prefix", default="paper")
    parser.add_argument("--max-risk-pct", type=float, default=1.0)
    parser.add_argument("--max-leverage", type=float, default=1.0)
    parser.add_argument("--allow-unrobust", action="store_true")
    parser.add_argument("--allow-unsupported-entry", action="store_true")
    parser.add_argument(
        "--allow-non-original",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if args.max_risk_pct <= 0:
        raise RuntimeError("--max-risk-pct must be positive")
    if args.max_leverage < 1.0:
        raise RuntimeError("--max-leverage must be at least 1")

    base, key = _required_env()
    rows = fetch_heaven_strategies(
        base,
        key,
        symbol=args.symbol,
        tf=args.tf,
        limit=args.limit,
    )
    report = build_paper_candidate_report(
        rows,
        top_n=args.top_n,
        session_prefix=args.session_prefix,
        require_robust=not bool(args.allow_unrobust),
        require_supported_entry=not bool(args.allow_unsupported_entry or args.allow_non_original),
        max_risk_pct=float(args.max_risk_pct),
        max_leverage=float(args.max_leverage),
    )
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True, default=str))
    else:
        _print_text(report)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        raise SystemExit(1) from None
