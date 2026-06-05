from __future__ import annotations

import argparse
import json
import math
import os
from datetime import UTC, datetime
from typing import Any

import requests


def _required_env() -> tuple[str, str]:
    url = str(os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = str(os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_ANON_KEY") or "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY are required")
    return url, key


def _headers(key: str, prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _json_response(response: requests.Response, context: str) -> Any:
    try:
        response.raise_for_status()
    except Exception as exc:
        detail = response.text[:500] if response.text else str(exc)
        raise RuntimeError(f"{context}: {detail}") from exc
    if not response.content:
        return None
    return response.json()


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def _num(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) or math.isinf(out) else default


def _json_safe(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        if math.isnan(value):
            return "NaN"
        return "Infinity" if value > 0 else "-Infinity"
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _fetch_session(base: str, key: str, session_name: str | None, session_id: str | None) -> dict[str, Any]:
    if not session_name and not session_id:
        raise RuntimeError("--session-name or --session-id is required")
    params = {
        "select": "id,name,symbol,tf,active,equity,start_cap,fee,lev,last_bar_time,pos,strategy_params,wallet_id,created_at,updated_at",
    }
    if session_id:
        params["id"] = f"eq.{session_id}"
    else:
        params["name"] = f"eq.{session_name}"
        params["user_id"] = "is.null"
    response = requests.get(
        f"{base}/rest/v1/live_sessions",
        params=params,
        headers=_headers(key),
        timeout=30,
    )
    rows = _json_response(response, "fetch paper session") or []
    if len(rows) != 1:
        target = session_id or session_name
        raise RuntimeError(f"Paper session not found or ambiguous: {target}")
    return dict(rows[0])


def _fetch_wallet(base: str, key: str, wallet_id: str | None) -> dict[str, Any] | None:
    if not wallet_id:
        return None
    response = requests.get(
        f"{base}/rest/v1/wallets",
        params={"select": "id,name,exchange,paper", "id": f"eq.{wallet_id}"},
        headers=_headers(key),
        timeout=30,
    )
    rows = _json_response(response, "fetch paper wallet") or []
    if len(rows) != 1:
        raise RuntimeError(f"Wallet not found or ambiguous: {wallet_id}")
    return dict(rows[0])


def _fetch_events(base: str, key: str, session_id: str, limit: int) -> list[dict[str, Any]]:
    response = requests.get(
        f"{base}/rest/v1/live_events",
        params={
            "select": "kind,at_time,payload",
            "session_id": f"eq.{session_id}",
            "order": "at_time.asc",
            "limit": str(max(1, int(limit))),
        },
        headers=_headers(key),
        timeout=30,
    )
    rows = _json_response(response, "fetch paper events") or []
    return [dict(row) for row in rows]


def compute_paper_metrics(
    session: dict[str, Any],
    events: list[dict[str, Any]],
    wallet: dict[str, Any] | None = None,
) -> dict[str, float | int | bool | str | None]:
    start_cap = _num(session.get("start_cap"))
    equity = _num(session.get("equity"), start_cap)
    created_at = _parse_time(session.get("created_at"))
    updated_at = _parse_time(session.get("updated_at"))
    last_event_at = _parse_time(events[-1].get("at_time")) if events else None
    observed_to = last_event_at or updated_at or datetime.now(UTC)
    observed_days = (
        max(0.0, (observed_to - created_at).total_seconds() / 86400.0)
        if created_at
        else 0.0
    )

    exit_nets: list[float] = []
    equity_curve = [start_cap]
    history_gap = False
    for event in events:
        payload = event.get("payload") or {}
        if event.get("kind") == "info" and payload.get("code") == "history_gap":
            history_gap = True
        if event.get("kind") not in {"tp", "sl", "flip"}:
            continue
        net = _num(payload.get("net"))
        exit_nets.append(net)
        equity_curve.append(max(0.0, equity_curve[-1] + net))

    gross_profit = sum(value for value in exit_nets if value > 0)
    gross_loss = abs(sum(value for value in exit_nets if value < 0))
    profit_factor = (
        gross_profit / gross_loss
        if gross_loss > 0
        else (float("inf") if gross_profit > 0 else 0.0)
    )
    wins = sum(1 for value in exit_nets if value > 0)
    trade_events = len(exit_nets)
    winrate = (wins / trade_events * 100.0) if trade_events else 0.0

    peak = equity_curve[0] if equity_curve else start_cap
    max_dd_pct = 0.0
    for value in equity_curve:
        peak = max(peak, value)
        if peak > 0:
            max_dd_pct = max(max_dd_pct, (peak - value) / peak * 100.0)

    paper_wallet = True
    wallet_exchange = None
    if wallet is not None:
        wallet_exchange = str(wallet.get("exchange") or "")
        paper_wallet = bool(wallet.get("paper") is not False and wallet_exchange.lower() == "paper")

    return {
        "active": bool(session.get("active")),
        "open_position": bool(session.get("pos")),
        "paper_wallet": paper_wallet,
        "wallet_exchange": wallet_exchange,
        "history_gap": history_gap,
        "observed_days": observed_days,
        "entry_events": sum(1 for event in events if event.get("kind") == "entry"),
        "trade_events": trade_events,
        "winrate_pct": winrate,
        "profit_factor": profit_factor,
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        "total_net": sum(exit_nets),
        "return_pct": ((equity - start_cap) / start_cap * 100.0) if start_cap > 0 else 0.0,
        "event_return_pct": (sum(exit_nets) / start_cap * 100.0) if start_cap > 0 else 0.0,
        "max_drawdown_pct": max_dd_pct,
        "equity": equity,
        "start_cap": start_cap,
        "last_bar_time": session.get("last_bar_time"),
        "last_event_at": last_event_at.isoformat() if last_event_at else None,
    }


def paper_gate_failures(metrics: dict[str, Any], gates: dict[str, float]) -> list[str]:
    checks = [
        ("paper_wallet", bool(metrics.get("paper_wallet"))),
        ("no_history_gap", not bool(metrics.get("history_gap"))),
        ("no_open_position", not bool(metrics.get("open_position"))),
        ("min_observed_days", _num(metrics.get("observed_days")) >= gates["min_days"]),
        ("min_trades", _num(metrics.get("trade_events")) >= gates["min_trades"]),
        ("min_profit_factor", _num(metrics.get("profit_factor")) >= gates["min_profit_factor"]),
        ("min_return_pct", _num(metrics.get("return_pct")) >= gates["min_return_pct"]),
        ("max_drawdown_pct", _num(metrics.get("max_drawdown_pct")) <= gates["max_drawdown_pct"]),
        ("positive_equity", _num(metrics.get("equity")) > 0),
    ]
    return [name for name, ok in checks if not ok]


def _record_validation_event(
    base: str,
    key: str,
    session_id: str,
    payload: dict[str, Any],
) -> None:
    response = requests.post(
        f"{base}/rest/v1/live_events",
        headers=_headers(key, "return=minimal"),
        json=[
            {
                "session_id": session_id,
                "kind": "info",
                "at_time": datetime.now(UTC).isoformat(),
                "payload": _json_safe(payload),
            }
        ],
        timeout=30,
    )
    _json_response(response, "record paper validation")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a Supabase paper session before live preparation")
    parser.add_argument("--session-name")
    parser.add_argument("--session-id")
    parser.add_argument("--events-limit", type=int, default=10_000)
    parser.add_argument("--min-days", type=float, default=7.0)
    parser.add_argument("--min-trades", type=float, default=20.0)
    parser.add_argument("--min-profit-factor", type=float, default=1.10)
    parser.add_argument("--min-return-pct", type=float, default=0.0)
    parser.add_argument("--max-drawdown-pct", type=float, default=10.0)
    parser.add_argument("--record-event", action="store_true")
    parser.add_argument("--strict-exit", action="store_true")
    args = parser.parse_args()

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
    failures = paper_gate_failures(metrics, gates)
    result = {
        "session": {
            "id": session.get("id"),
            "name": session.get("name"),
            "symbol": session.get("symbol"),
            "tf": session.get("tf"),
            "active": session.get("active"),
            "wallet_id": session.get("wallet_id"),
        },
        "gates": gates,
        "metrics": metrics,
        "live_ready": not failures,
        "failures": failures,
    }
    if args.record_event:
        _record_validation_event(
            base,
            key,
            str(session["id"]),
            {"code": "paper_validation", **result},
        )
    print(json.dumps(_json_safe(result), indent=2, sort_keys=True, default=str))
    return 2 if args.strict_exit and failures else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        raise SystemExit(1) from None
