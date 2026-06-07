from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime
from typing import Any

import requests

from heaven_opt.env import load_repo_env
from heaven_opt.supabase_io import normalize_ui_strategy_params


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


def _strategy_lookup_params(strategy_name: str | None, strategy_id: str | None) -> dict[str, str]:
    if bool(strategy_name) == bool(strategy_id):
        raise RuntimeError("Use exactly one of --strategy-name or --strategy-id")
    if strategy_id:
        return {"id": f"eq.{strategy_id}"}
    return {"name": f"eq.{strategy_name}"}


def _strategy_label(strategy_name: str | None, strategy_id: str | None) -> str:
    return str(strategy_id or strategy_name or "").strip()


def _get_strategy(
    base: str,
    key: str,
    *,
    strategy_name: str | None,
    strategy_id: str | None,
) -> dict[str, Any]:
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
    rows = _json_response(response, "fetch heaven strategy") or []
    if len(rows) != 1:
        raise RuntimeError(f"Heaven strategy not found or ambiguous: {_strategy_label(strategy_name, strategy_id)}")
    row = dict(rows[0])
    metrics = dict(row.get("metrics") or {})
    params = normalize_ui_strategy_params(dict(row.get("params") or {}))
    row["params"] = params
    if float(metrics.get("paper_eligible") or 0.0) < 1.0:
        raise RuntimeError(f"Heaven strategy is not paper-eligible: {strategy_name}")
    if str(params.get("entryMode") or "") != "Original":
        raise RuntimeError("The headless paper runner currently supports only Original entries")
    return row


def _upsert_wallet(
    base: str,
    key: str,
    session_name: str,
    start_cap: float,
    fee: float,
    leverage: float,
) -> dict[str, Any]:
    row = {
        "user_id": None,
        "name": session_name,
        "exchange": "paper",
        "base_currency": "USDC",
        "paper": True,
        "leverage": leverage,
        "settings": {"start_cap": start_cap, "fee": fee},
    }
    response = requests.post(
        f"{base}/rest/v1/wallets",
        params={"on_conflict": "user_id,name,exchange"},
        headers=_headers(key, "resolution=merge-duplicates,return=representation"),
        json=[row],
        timeout=30,
    )
    rows = _json_response(response, "upsert paper wallet") or []
    if len(rows) != 1:
        raise RuntimeError("Paper wallet upsert returned no row")
    return dict(rows[0])


def _existing_session(base: str, key: str, session_name: str) -> dict[str, Any] | None:
    response = requests.get(
        f"{base}/rest/v1/live_sessions",
        params={
            "select": "id,name,active",
            "name": f"eq.{session_name}",
            "user_id": "is.null",
        },
        headers=_headers(key),
        timeout=30,
    )
    rows = _json_response(response, "fetch paper session") or []
    if len(rows) > 1:
        raise RuntimeError(f"Multiple public paper sessions share the name: {session_name}")
    return dict(rows[0]) if rows else None


def _start_session(
    base: str,
    key: str,
    strategy: dict[str, Any],
    wallet: dict[str, Any],
    session_name: str,
    start_cap: float,
    fee: float,
    leverage: float,
    reset_existing: bool,
) -> dict[str, Any]:
    existing = _existing_session(base, key, session_name)
    if existing and not reset_existing:
        raise RuntimeError(
            f"Paper session already exists: {session_name}. Use --reset-existing only for an intentional fresh start."
        )
    payload = {
        "user_id": None,
        "wallet_id": wallet.get("id"),
        "name": session_name,
        "symbol": strategy["symbol"],
        "tf": strategy["tf"],
        "active": True,
        "strategy_params": strategy["params"],
        "equity": start_cap,
        "start_cap": start_cap,
        "fee": fee,
        "lev": leverage,
        "last_bar_time": None,
        "pos": None,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    headers = _headers(key, "return=representation")
    if existing:
        response = requests.patch(
            f"{base}/rest/v1/live_sessions",
            params={"id": f"eq.{existing['id']}"},
            headers=headers,
            json=payload,
            timeout=30,
        )
    else:
        response = requests.post(
            f"{base}/rest/v1/live_sessions",
            headers=headers,
            json=[payload],
            timeout=30,
        )
    rows = _json_response(response, "start paper session") or []
    if len(rows) != 1:
        raise RuntimeError("Paper session start returned no row")
    return dict(rows[0])


def _invoke_runner(base: str, key: str) -> dict[str, Any]:
    response = requests.post(
        f"{base}/functions/v1/live-runner",
        headers=_headers(key),
        json={},
        timeout=60,
    )
    return dict(_json_response(response, "invoke live-runner") or {})


def _fetch_session(base: str, key: str, session_id: str) -> dict[str, Any]:
    response = requests.get(
        f"{base}/rest/v1/live_sessions",
        params={
            "select": "id,name,symbol,tf,active,equity,last_bar_time,pos,strategy_params",
            "id": f"eq.{session_id}",
        },
        headers=_headers(key),
        timeout=30,
    )
    rows = _json_response(response, "verify paper session") or []
    if len(rows) != 1:
        raise RuntimeError("Paper session verification returned no row")
    return dict(rows[0])


def main() -> int:
    parser = argparse.ArgumentParser(description="Start a Supabase-only paper session from an eligible Heaven strategy")
    selector = parser.add_mutually_exclusive_group(required=True)
    selector.add_argument("--strategy-name")
    selector.add_argument("--strategy-id")
    parser.add_argument("--session-name", required=True)
    parser.add_argument("--start-cap", type=float, default=10_000.0)
    parser.add_argument("--fee", type=float, default=0.1)
    parser.add_argument("--leverage", type=float, default=None)
    parser.add_argument("--reset-existing", action="store_true")
    parser.add_argument("--invoke-runner", action="store_true")
    args = parser.parse_args()

    if args.start_cap <= 0:
        raise RuntimeError("--start-cap must be positive")
    if args.fee < 0:
        raise RuntimeError("--fee cannot be negative")

    base, key = _required_env()
    strategy = _get_strategy(base, key, strategy_name=args.strategy_name, strategy_id=args.strategy_id)
    params = dict(strategy.get("params") or {})
    leverage = float(args.leverage if args.leverage is not None else params.get("leverage") or 1.0)
    if leverage < 1.0:
        raise RuntimeError("--leverage must be at least 1")

    wallet = _upsert_wallet(base, key, args.session_name, args.start_cap, args.fee, leverage)
    session = _start_session(
        base,
        key,
        strategy,
        wallet,
        args.session_name,
        args.start_cap,
        args.fee,
        leverage,
        args.reset_existing,
    )
    runner_result = _invoke_runner(base, key) if args.invoke_runner else None
    verified = _fetch_session(base, key, str(session["id"]))

    print(
        json.dumps(
            {
                "session_id": verified["id"],
                "session_name": verified["name"],
                "strategy_id": strategy.get("id"),
                "strategy_name": strategy["name"],
                "symbol": verified["symbol"],
                "tf": verified["tf"],
                "active": verified["active"],
                "equity": verified["equity"],
                "last_bar_time": verified["last_bar_time"],
                "position_open": bool(verified.get("pos")),
                "entry_mode": (verified.get("strategy_params") or {}).get("entryMode"),
                "paper_eligible": (strategy.get("metrics") or {}).get("paper_eligible"),
                "runner_invoked": runner_result is not None,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
