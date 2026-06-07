from __future__ import annotations

import argparse
import json
from typing import Any

from heaven_opt.supabase_io import headless_entry_mode_failures, normalize_ui_strategy_params
from validate_paper_session import (
    _fetch_events,
    _fetch_session,
    _fetch_wallet,
    _headers,
    _json_response,
    _json_safe,
    _num,
    _record_validation_event,
    _required_env,
    compute_paper_metrics,
    paper_gate_failures,
)


def _strategy_params(session: dict[str, Any]) -> dict[str, Any]:
    params = session.get("strategy_params") or {}
    return normalize_ui_strategy_params(dict(params)) if isinstance(params, dict) else {}


def _strategy_lookup_params(strategy_name: str | None, strategy_id: str | None) -> dict[str, str]:
    if bool(strategy_name) == bool(strategy_id):
        raise RuntimeError("Use exactly one of --strategy-name or --strategy-id")
    if strategy_id:
        return {"id": f"eq.{strategy_id}"}
    return {"name": f"eq.{strategy_name}"}


def _strategy_label(strategy_name: str | None, strategy_id: str | None) -> str:
    return str(strategy_id or strategy_name or "").strip()


def _fetch_strategy(base: str, key: str, *, strategy_name: str | None, strategy_id: str | None) -> dict[str, Any]:
    import requests

    lookup = _strategy_lookup_params(strategy_name, strategy_id)
    response = requests.get(
        f"{base}/rest/v1/heaven_strategies",
        params={
            "select": "id,name,symbol,tf,params,metrics",
            **lookup,
        },
        headers=_headers(key),
        timeout=30,
    )
    rows = _json_response(response, "fetch live-prep strategy") or []
    if len(rows) != 1:
        raise RuntimeError(f"Heaven strategy not found or ambiguous: {_strategy_label(strategy_name, strategy_id)}")
    row = dict(rows[0])
    row["params"] = normalize_ui_strategy_params(dict(row.get("params") or {}))
    row["metrics"] = dict(row.get("metrics") or {})
    return row


def _stable_json(value: Any) -> str:
    return json.dumps(value or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def analysis_gate_failures(
    strategy: dict[str, Any],
    session: dict[str, Any],
    *,
    min_robustness_score: float,
    require_param_match: bool = True,
) -> list[str]:
    metrics = dict(strategy.get("metrics") or {})
    strategy_params = dict(strategy.get("params") or {})
    session_params = _strategy_params(session)
    paper_gate_failures_value = metrics.get("paper_gate_failures")
    listed_failures = paper_gate_failures_value if isinstance(paper_gate_failures_value, list) else []
    checks = [
        ("analysis_symbol_match", str(strategy.get("symbol") or "") == str(session.get("symbol") or "")),
        ("analysis_tf_match", str(strategy.get("tf") or "") == str(session.get("tf") or "")),
        ("analysis_paper_eligible", _num(metrics.get("paper_eligible")) >= 1.0),
        ("analysis_robustly_validated", _num(metrics.get("robustly_validated")) >= 1.0),
        ("analysis_robustness_score", _num(metrics.get("robustness_score")) >= min_robustness_score),
        ("analysis_gate_failures_empty", not listed_failures),
    ]
    if require_param_match:
        checks.append(("analysis_params_match_session", _stable_json(strategy_params) == _stable_json(session_params)))
    return [name for name, passed in checks if not passed]


def live_preparation_failures(
    session: dict[str, Any],
    metrics: dict[str, Any],
    paper_failures: list[str],
    analysis_failures: list[str],
    *,
    target_session_name: str,
    max_risk_pct: float,
    max_leverage: float,
) -> list[str]:
    failures = [f"paper:{name}" for name in paper_failures]
    failures.extend(f"analysis:{name}" for name in analysis_failures)
    params = _strategy_params(session)
    risk_pct = _num(params.get("riskMaxPct"), default=0.0)
    leverage = _num(session.get("lev"), default=_num(params.get("leverage"), default=1.0))

    checks = [
        ("source_session_active", bool(session.get("active"))),
        ("target_session_name", bool(str(target_session_name or "").strip())),
        ("target_differs_from_paper", str(target_session_name or "").strip() != str(session.get("name") or "").strip()),
        ("paper_runner_entry_mode", not headless_entry_mode_failures(params)),
        ("max_risk_pct", risk_pct > 0.0 and risk_pct <= max_risk_pct),
        ("max_leverage", leverage >= 1.0 and leverage <= max_leverage),
        ("paper_equity_positive", _num(metrics.get("equity")) > 0.0),
    ]
    failures.extend(name for name, passed in checks if not passed)
    return failures


def build_live_preparation_plan(
    session: dict[str, Any],
    metrics: dict[str, Any],
    paper_failures: list[str],
    strategy: dict[str, Any],
    analysis_failures: list[str],
    *,
    target_session_name: str,
    max_risk_pct: float,
    max_leverage: float,
) -> dict[str, Any]:
    params = _strategy_params(session)
    failures = live_preparation_failures(
        session,
        metrics,
        paper_failures,
        analysis_failures,
        target_session_name=target_session_name,
        max_risk_pct=max_risk_pct,
        max_leverage=max_leverage,
    )
    ready = not failures
    return {
        "ready_for_live_preparation": ready,
        "failures": failures,
        "source_paper_session": {
            "id": session.get("id"),
            "name": session.get("name"),
            "symbol": session.get("symbol"),
            "tf": session.get("tf"),
            "active": bool(session.get("active")),
            "wallet_id": session.get("wallet_id"),
        },
        "target_live_session": {
            "name": target_session_name,
            "symbol": session.get("symbol"),
            "tf": session.get("tf"),
            "entry_mode": params.get("entryMode"),
            "risk_max_pct": _num(params.get("riskMaxPct")),
            "leverage": _num(session.get("lev"), default=_num(params.get("leverage"), default=1.0)),
        },
        "strategy_analysis": {
            "id": strategy.get("id"),
            "name": strategy.get("name"),
            "symbol": strategy.get("symbol"),
            "tf": strategy.get("tf"),
            "score": _num((strategy.get("metrics") or {}).get("score")),
            "paper_eligible": _num((strategy.get("metrics") or {}).get("paper_eligible")),
            "robustly_validated": _num((strategy.get("metrics") or {}).get("robustly_validated")),
            "robustness_score": _num((strategy.get("metrics") or {}).get("robustness_score")),
            "paper_gate_failures": (strategy.get("metrics") or {}).get("paper_gate_failures") or [],
        },
        "paper_metrics": metrics,
        "controls": {
            "max_risk_pct": max_risk_pct,
            "max_leverage": max_leverage,
            "requires_manual_live_activation": True,
            "creates_live_session": False,
            "places_orders": False,
        },
        "next_steps": (
            [
                "Create a dedicated live wallet/session only after operator review.",
                "Start with the same symbol/timeframe/strategy params as the validated paper session.",
                "Keep the first live run manually supervised and capped by the controls above.",
                "Record the final go/no-go decision in Supabase before activation.",
            ]
            if ready
            else [
                "Do not prepare live trading for this strategy yet.",
                "Resolve the listed failures through more paper/runtime evidence or new optimization campaigns.",
            ]
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare a controlled live-readiness audit from a Supabase paper session")
    parser.add_argument("--session-name")
    parser.add_argument("--session-id")
    selector = parser.add_mutually_exclusive_group(required=True)
    selector.add_argument("--strategy-name")
    selector.add_argument("--strategy-id")
    parser.add_argument("--target-session-name", required=True)
    parser.add_argument("--events-limit", type=int, default=10_000)
    parser.add_argument("--min-days", type=float, default=7.0)
    parser.add_argument("--min-trades", type=float, default=20.0)
    parser.add_argument("--min-profit-factor", type=float, default=1.10)
    parser.add_argument("--min-return-pct", type=float, default=0.0)
    parser.add_argument("--max-drawdown-pct", type=float, default=10.0)
    parser.add_argument("--max-risk-pct", type=float, default=1.0)
    parser.add_argument("--max-leverage", type=float, default=1.0)
    parser.add_argument("--min-robustness-score", type=float, default=0.0)
    parser.add_argument("--allow-param-mismatch", action="store_true")
    parser.add_argument("--record-event", action="store_true")
    parser.add_argument("--strict-exit", action="store_true")
    args = parser.parse_args(argv)

    base, key = _required_env()
    session = _fetch_session(base, key, args.session_name, args.session_id)
    strategy = _fetch_strategy(base, key, strategy_name=args.strategy_name, strategy_id=args.strategy_id)
    wallet = _fetch_wallet(base, key, session.get("wallet_id"))
    events = _fetch_events(base, key, str(session["id"]), args.events_limit)
    gates = {
        "min_days": float(args.min_days),
        "min_trades": float(args.min_trades),
        "min_profit_factor": float(args.min_profit_factor),
        "min_return_pct": float(args.min_return_pct),
        "max_drawdown_pct": float(args.max_drawdown_pct),
    }
    metrics = compute_paper_metrics(session, events, wallet)
    paper_failures = paper_gate_failures(metrics, gates)
    analysis_failures = analysis_gate_failures(
        strategy,
        session,
        min_robustness_score=float(args.min_robustness_score),
        require_param_match=not bool(args.allow_param_mismatch),
    )
    plan = build_live_preparation_plan(
        session,
        metrics,
        paper_failures,
        strategy,
        analysis_failures,
        target_session_name=args.target_session_name,
        max_risk_pct=float(args.max_risk_pct),
        max_leverage=float(args.max_leverage),
    )
    plan["paper_gates"] = gates
    if args.record_event:
        _record_validation_event(
            base,
            key,
            str(session["id"]),
            {"code": "live_preparation_audit", **plan},
        )
    print(json.dumps(_json_safe(plan), indent=2, sort_keys=True, default=str))
    return 2 if args.strict_exit and not plan["ready_for_live_preparation"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        raise SystemExit(1) from None
