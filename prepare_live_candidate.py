from __future__ import annotations

import argparse
import json
from typing import Any

from validate_paper_session import (
    _fetch_events,
    _fetch_session,
    _fetch_wallet,
    _json_safe,
    _num,
    _record_validation_event,
    _required_env,
    compute_paper_metrics,
    paper_gate_failures,
)


def _strategy_params(session: dict[str, Any]) -> dict[str, Any]:
    params = session.get("strategy_params") or {}
    return dict(params) if isinstance(params, dict) else {}


def live_preparation_failures(
    session: dict[str, Any],
    metrics: dict[str, Any],
    paper_failures: list[str],
    *,
    target_session_name: str,
    max_risk_pct: float,
    max_leverage: float,
) -> list[str]:
    failures = [f"paper:{name}" for name in paper_failures]
    params = _strategy_params(session)
    entry_mode = str(params.get("entryMode") or "")
    risk_pct = _num(params.get("riskMaxPct"), default=0.0)
    leverage = _num(session.get("lev"), default=_num(params.get("leverage"), default=1.0))

    checks = [
        ("source_session_active", bool(session.get("active"))),
        ("target_session_name", bool(str(target_session_name or "").strip())),
        ("target_differs_from_paper", str(target_session_name or "").strip() != str(session.get("name") or "").strip()),
        ("original_entry_mode", entry_mode == "Original"),
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
    parser.add_argument("--target-session-name", required=True)
    parser.add_argument("--events-limit", type=int, default=10_000)
    parser.add_argument("--min-days", type=float, default=7.0)
    parser.add_argument("--min-trades", type=float, default=20.0)
    parser.add_argument("--min-profit-factor", type=float, default=1.10)
    parser.add_argument("--min-return-pct", type=float, default=0.0)
    parser.add_argument("--max-drawdown-pct", type=float, default=10.0)
    parser.add_argument("--max-risk-pct", type=float, default=1.0)
    parser.add_argument("--max-leverage", type=float, default=1.0)
    parser.add_argument("--record-event", action="store_true")
    parser.add_argument("--strict-exit", action="store_true")
    args = parser.parse_args(argv)

    base, key = _required_env()
    session = _fetch_session(base, key, args.session_name, args.session_id)
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
    plan = build_live_preparation_plan(
        session,
        metrics,
        paper_failures,
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
