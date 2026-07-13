from __future__ import annotations

import argparse
import json
import shlex
from collections import Counter
from datetime import UTC, datetime
from typing import Any

import requests

from analyze_strategy_evaluations import fetch_evaluations, summarize_evaluations
from list_paper_candidates import build_paper_candidate_report, fetch_heaven_strategies
from start_paper_candidate import (
    _fetch_session as _fetch_started_session,
)
from start_paper_candidate import (
    _get_strategy,
    _invoke_runner,
    _start_session,
    _upsert_wallet,
    paper_start_failures,
    strategy_for_paper_session,
)
from validate_paper_session import (
    _fetch_events,
    _fetch_wallet,
    _headers,
    _json_response,
    _json_safe,
    _num,
    _required_env,
    compute_paper_metrics,
    paper_gate_failures,
)

DEFAULT_PAPER_GATES = {
    "min_days": 7.0,
    "min_trades": 20.0,
    "min_profit_factor": 1.10,
    "min_return_pct": 0.0,
    "max_drawdown_pct": 10.0,
}


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def latest_time(rows: list[dict[str, Any]]) -> str | None:
    values = [parsed for row in rows if (parsed := parse_time(row.get("created_at")))]
    if not values:
        return None
    return max(values).isoformat()


def command_arg(command: str, flag: str) -> str | None:
    parts = shlex.split(command)
    try:
        idx = parts.index(flag)
    except ValueError:
        return None
    return parts[idx + 1] if idx + 1 < len(parts) else None


def session_name_for_candidate(candidate: dict[str, Any]) -> str:
    command = ((candidate.get("commands") or {}).get("start_paper") or "").strip()
    session_name = command_arg(command, "--session-name")
    if not session_name:
        raise RuntimeError(f"Candidate has no start-paper session name: {candidate.get('id')}")
    return session_name


def target_live_name_for_candidate(candidate: dict[str, Any]) -> str:
    command = ((candidate.get("commands") or {}).get("audit_live") or "").strip()
    return command_arg(command, "--target-session-name") or f"live-{session_name_for_candidate(candidate)}"


def fetch_public_live_sessions(
    base: str,
    key: str,
    *,
    symbol: str | None,
    tf: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    params = {
        "select": "id,name,symbol,tf,active,equity,start_cap,fee,lev,last_bar_time,pos,wallet_id,strategy_params,created_at,updated_at",
        "user_id": "is.null",
        "order": "updated_at.desc",
        "limit": str(max(1, int(limit))),
    }
    if symbol:
        params["symbol"] = f"eq.{symbol}"
    if tf:
        params["tf"] = f"eq.{tf}"
    response = requests.get(
        f"{base}/rest/v1/live_sessions",
        params=params,
        headers=_headers(key),
        timeout=60,
    )
    rows = _json_response(response, "fetch public live sessions") or []
    return [dict(row) for row in rows]


def compact_paper_session(
    session: dict[str, Any],
    metrics: dict[str, Any],
    failures: list[str],
) -> dict[str, Any]:
    return {
        "id": session.get("id"),
        "name": session.get("name"),
        "symbol": session.get("symbol"),
        "tf": session.get("tf"),
        "active": bool(session.get("active")),
        "live_ready": not failures,
        "failures": failures,
        "equity": _num(metrics.get("equity")),
        "start_cap": _num(metrics.get("start_cap")),
        "return_pct": round(_num(metrics.get("return_pct")), 4),
        "event_return_pct": round(_num(metrics.get("event_return_pct")), 4),
        "profit_factor": metrics.get("profit_factor"),
        "trade_events": int(_num(metrics.get("trade_events"))),
        "entry_events": int(_num(metrics.get("entry_events"))),
        "max_drawdown_pct": round(_num(metrics.get("max_drawdown_pct")), 4),
        "observed_days": round(_num(metrics.get("observed_days")), 4),
        "open_position": bool(metrics.get("open_position")),
        "history_gap": bool(metrics.get("history_gap")),
        "last_event_at": metrics.get("last_event_at"),
        "updated_at": session.get("updated_at"),
    }


def build_paper_session_report(
    sessions: list[dict[str, Any]],
    session_metrics: dict[str, dict[str, Any]],
    session_failures: dict[str, list[str]],
) -> dict[str, Any]:
    rows = []
    failures = Counter()
    for session in sessions:
        session_id = str(session.get("id") or "")
        compact = compact_paper_session(
            session,
            dict(session_metrics.get(session_id) or {}),
            list(session_failures.get(session_id) or []),
        )
        rows.append(compact)
        failures.update(compact["failures"])

    rows.sort(
        key=lambda item: (
            bool(item.get("live_ready")),
            _num(item.get("return_pct")),
            _num(item.get("profit_factor")),
            _num(item.get("trade_events")),
        ),
        reverse=True,
    )
    return {
        "rows": len(rows),
        "live_ready": sum(1 for row in rows if row.get("live_ready")),
        "active": sum(1 for row in rows if row.get("active")),
        "positive_return": sum(
            1
            for row in rows
            if max(_num(row.get("return_pct")), _num(row.get("event_return_pct"))) > 0
        ),
        "enough_trades": sum(1 for row in rows if _num(row.get("trade_events")) >= 20),
        "failure_counts": dict(sorted(failures.items(), key=lambda item: (-item[1], item[0]))),
        "top": rows[:10],
    }


def fetch_paper_session_report(
    base: str,
    key: str,
    *,
    symbol: str | None,
    tf: str | None,
    limit: int,
    gates: dict[str, float],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    sessions = fetch_public_live_sessions(base, key, symbol=symbol, tf=tf, limit=limit)
    session_metrics: dict[str, dict[str, Any]] = {}
    session_failures: dict[str, list[str]] = {}
    for session in sessions:
        session_id = str(session.get("id") or "")
        wallet = _fetch_wallet(base, key, session.get("wallet_id"))
        events = _fetch_events(base, key, session_id, 10_000)
        metrics = compute_paper_metrics(session, events, wallet)
        session_metrics[session_id] = dict(metrics)
        session_failures[session_id] = paper_gate_failures(metrics, gates)
    return sessions, build_paper_session_report(sessions, session_metrics, session_failures)


def _status(candidate_count: int, matched_session_count: int, live_ready_count: int) -> str:
    if live_ready_count > 0:
        return "paper_validated_needs_live_audit"
    if matched_session_count > 0:
        return "paper_running_or_needs_validation"
    if candidate_count > 0:
        return "ready_to_start_paper"
    return "needs_optimization"


def _stale_warning(
    strategy_rows: list[dict[str, Any]],
    evaluation_rows: list[dict[str, Any]],
) -> str | None:
    latest_strategy = latest_time(strategy_rows)
    latest_eval = latest_time(evaluation_rows)
    if not latest_strategy:
        return None
    if not latest_eval:
        return "heaven_strategies has paper candidates but strategy_evaluations has no matching rows."
    strategy_dt = parse_time(latest_strategy)
    eval_dt = parse_time(latest_eval)
    if strategy_dt and eval_dt and strategy_dt > eval_dt:
        return (
            "heaven_strategies is fresher than strategy_evaluations; refresh the evaluation "
            "campaign before calling candidates genuinely proven."
        )
    return None


def build_advancement_report(
    *,
    strategy_rows: list[dict[str, Any]],
    evaluation_rows: list[dict[str, Any]],
    paper_sessions: list[dict[str, Any]],
    paper_session_report: dict[str, Any],
    symbol: str | None,
    tf: str | None,
    top_n: int,
    session_prefix: str,
    max_risk_pct: float,
    max_leverage: float,
) -> dict[str, Any]:
    candidate_report = build_paper_candidate_report(
        strategy_rows,
        top_n=top_n,
        session_prefix=session_prefix,
        max_risk_pct=max_risk_pct,
        max_leverage=max_leverage,
    )
    evaluation_summary = summarize_evaluations(evaluation_rows, top_n=top_n)
    sessions_by_name = {str(session.get("name") or ""): session for session in paper_sessions}
    matched_sessions = []
    actions: list[dict[str, Any]] = []

    for candidate in candidate_report["candidates"]:
        session_name = session_name_for_candidate(candidate)
        existing = sessions_by_name.get(session_name)
        if existing:
            matched_sessions.append(existing)
            actions.append(
                {
                    "action": "validate_paper",
                    "strategy_id": candidate.get("id"),
                    "strategy_name": candidate.get("name"),
                    "session_name": session_name,
                    "command": candidate["commands"]["validate_paper"],
                    "reason": "Paper session already exists; validate it before any live audit.",
                }
            )
            actions.append(
                {
                    "action": "audit_live_after_validation",
                    "strategy_id": candidate.get("id"),
                    "strategy_name": candidate.get("name"),
                    "session_name": session_name,
                    "target_session_name": target_live_name_for_candidate(candidate),
                    "command": candidate["commands"]["audit_live"],
                    "reason": "Only run this after validate_paper passes all gates.",
                }
            )
            continue
        actions.append(
            {
                "action": "start_paper",
                "strategy_id": candidate.get("id"),
                "strategy_name": candidate.get("name"),
                "session_name": session_name,
                "command": candidate["commands"]["start_paper"],
                "reason": "Eligible Supabase strategy has no matching paper session yet.",
            }
        )

    if candidate_report["candidate_count"] <= 0:
        plan = evaluation_summary.get("experiment_plan") or {}
        for item in plan.get("commands") or []:
            actions.append(
                {
                    "action": item.get("action") or "run_experiment",
                    "command": item.get("command"),
                    "reason": item.get("reason") or "No paper-ready strategy exists for this scope.",
                }
            )

    warning = _stale_warning(strategy_rows, evaluation_rows)
    warnings = [warning] if warning else []
    if paper_session_report.get("rows") and not paper_session_report.get("live_ready"):
        warnings.append("No paper session currently passes the live-readiness gates.")

    live_ready_names = {
        str(row.get("name") or "")
        for row in paper_session_report.get("top") or []
        if row.get("live_ready")
    }
    matched_live_ready = sum(
        1 for session in matched_sessions if str(session.get("name") or "") in live_ready_names
    )
    return {
        "status": _status(candidate_report["candidate_count"], len(matched_sessions), matched_live_ready),
        "scope": {"symbol": symbol, "tf": tf},
        "latest": {
            "heaven_strategy_created_at": latest_time(strategy_rows),
            "strategy_evaluation_created_at": latest_time(evaluation_rows),
        },
        "candidate_report": candidate_report,
        "evaluation_summary": evaluation_summary,
        "paper_session_report": paper_session_report,
        "matched_candidate_sessions": len(matched_sessions),
        "actions": actions,
        "warnings": warnings,
    }


def start_paper_from_candidate(
    base: str,
    key: str,
    candidate: dict[str, Any],
    *,
    start_cap: float,
    fee: float,
    max_risk_pct: float,
    max_leverage: float,
    reset_existing: bool,
    invoke_runner: bool,
) -> dict[str, Any]:
    strategy = _get_strategy(base, key, strategy_name=None, strategy_id=str(candidate["id"]))
    params = dict(strategy.get("params") or {})
    leverage = float(params.get("leverage") or 1.0)
    failures = paper_start_failures(
        strategy,
        leverage=leverage,
        max_risk_pct=max_risk_pct,
        max_leverage=max_leverage,
    )
    if failures:
        raise RuntimeError(f"Paper start refused by controls: {','.join(failures)}")
    session_name = session_name_for_candidate(candidate)
    wallet = _upsert_wallet(base, key, session_name, start_cap, fee, leverage)
    session = _start_session(
        base,
        key,
        strategy_for_paper_session(strategy, leverage=leverage),
        wallet,
        session_name,
        start_cap,
        fee,
        leverage,
        reset_existing,
    )
    runner_result = _invoke_runner(base, key) if invoke_runner else None
    verified = _fetch_started_session(base, key, str(session["id"]))
    return {
        "session_id": verified.get("id"),
        "session_name": verified.get("name"),
        "strategy_id": strategy.get("id"),
        "strategy_name": strategy.get("name"),
        "symbol": verified.get("symbol"),
        "tf": verified.get("tf"),
        "active": bool(verified.get("active")),
        "equity": _num(verified.get("equity")),
        "last_bar_time": verified.get("last_bar_time"),
        "runner_invoked": runner_result is not None,
    }


def _print_text(report: dict[str, Any], started: list[dict[str, Any]]) -> None:
    scope = report.get("scope") or {}
    scope_label = " ".join(str(scope.get(name) or "") for name in ("symbol", "tf")).strip() or "GLOBAL"
    candidates = report.get("candidate_report") or {}
    paper = report.get("paper_session_report") or {}
    print(f"scope={scope_label} status={report.get('status')}")
    print(
        f"candidates={candidates.get('candidate_count', 0)} "
        f"matched_sessions={report.get('matched_candidate_sessions', 0)} "
        f"paper_sessions={paper.get('rows', 0)} live_ready={paper.get('live_ready', 0)}"
    )
    if report.get("warnings"):
        print("warnings:")
        for warning in report["warnings"]:
            print(f"- {warning}")
    if started:
        print("started_sessions:")
        for item in started:
            print(f"- {item['session_name']} strategy={item['strategy_name']} active={item['active']}")
    if report.get("actions"):
        print("next_actions:")
        for item in report["actions"][:12]:
            print(f"- {item['action']}: {item.get('command')}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Advance Heaven from Supabase candidates to paper validation and live audit readiness"
    )
    parser.add_argument("--symbol")
    parser.add_argument("--tf")
    parser.add_argument("--top-n", type=int, default=4)
    parser.add_argument("--strategies-limit", type=int, default=100)
    parser.add_argument("--evaluations-limit", type=int, default=500)
    parser.add_argument("--sessions-limit", type=int, default=100)
    parser.add_argument("--session-prefix", default="paper")
    parser.add_argument("--max-risk-pct", type=float, default=1.0)
    parser.add_argument("--max-leverage", type=float, default=1.0)
    parser.add_argument("--start-paper", action="store_true")
    parser.add_argument("--invoke-runner", action="store_true")
    parser.add_argument("--reset-existing", action="store_true")
    parser.add_argument("--start-cap", type=float, default=10_000.0)
    parser.add_argument("--fee", type=float, default=0.1)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if args.top_n <= 0:
        raise RuntimeError("--top-n must be positive")
    if args.max_risk_pct <= 0:
        raise RuntimeError("--max-risk-pct must be positive")
    if args.max_leverage < 1.0:
        raise RuntimeError("--max-leverage must be at least 1")
    if args.start_cap <= 0:
        raise RuntimeError("--start-cap must be positive")
    if args.fee < 0:
        raise RuntimeError("--fee cannot be negative")

    base, key = _required_env()
    strategy_rows = fetch_heaven_strategies(
        base,
        key,
        symbol=args.symbol,
        tf=args.tf,
        limit=args.strategies_limit,
    )
    evaluation_rows = fetch_evaluations(
        base,
        key,
        campaign_id=None,
        campaign_prefix=None,
        symbol=args.symbol,
        tf=args.tf,
        limit=args.evaluations_limit,
    )
    sessions, paper_report = fetch_paper_session_report(
        base,
        key,
        symbol=args.symbol,
        tf=args.tf,
        limit=args.sessions_limit,
        gates=DEFAULT_PAPER_GATES,
    )
    report = build_advancement_report(
        strategy_rows=strategy_rows,
        evaluation_rows=evaluation_rows,
        paper_sessions=sessions,
        paper_session_report=paper_report,
        symbol=args.symbol,
        tf=args.tf,
        top_n=args.top_n,
        session_prefix=args.session_prefix,
        max_risk_pct=float(args.max_risk_pct),
        max_leverage=float(args.max_leverage),
    )

    started: list[dict[str, Any]] = []
    if args.start_paper:
        existing_names = {str(session.get("name") or "") for session in sessions}
        for candidate in (report.get("candidate_report") or {}).get("candidates") or []:
            session_name = session_name_for_candidate(candidate)
            if session_name in existing_names and not args.reset_existing:
                continue
            started.append(
                start_paper_from_candidate(
                    base,
                    key,
                    candidate,
                    start_cap=float(args.start_cap),
                    fee=float(args.fee),
                    max_risk_pct=float(args.max_risk_pct),
                    max_leverage=float(args.max_leverage),
                    reset_existing=bool(args.reset_existing),
                    invoke_runner=bool(args.invoke_runner),
                )
            )
        if started:
            sessions, paper_report = fetch_paper_session_report(
                base,
                key,
                symbol=args.symbol,
                tf=args.tf,
                limit=args.sessions_limit,
                gates=DEFAULT_PAPER_GATES,
            )
            report = build_advancement_report(
                strategy_rows=strategy_rows,
                evaluation_rows=evaluation_rows,
                paper_sessions=sessions,
                paper_session_report=paper_report,
                symbol=args.symbol,
                tf=args.tf,
                top_n=args.top_n,
                session_prefix=args.session_prefix,
                max_risk_pct=float(args.max_risk_pct),
                max_leverage=float(args.max_leverage),
            )
    report["started_sessions"] = started

    if args.json:
        print(json.dumps(_json_safe(report), indent=2, sort_keys=True, default=str))
    else:
        _print_text(report, started)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        raise SystemExit(1) from None
