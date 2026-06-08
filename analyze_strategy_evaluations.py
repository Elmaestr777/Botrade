from __future__ import annotations

import argparse
import json
import math
import os
from collections import Counter
from typing import Any

import requests

from heaven_opt.env import load_repo_env

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

PAPER_OR_LIVE_ACTIONS = {
    "list_paper_candidates",
    "prepare_controlled_paper",
    "validate_before_live",
    "audit_controlled_live",
}


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


def summarize_evaluations(
    rows: list[dict[str, Any]],
    top_n: int = 10,
    expected_symbols: list[str] | None = None,
    expected_timeframes: list[str] | None = None,
) -> dict[str, Any]:
    sorted_rows = sorted(rows, key=lambda row: _num(row.get("score")), reverse=True)
    failure_counts: Counter[str] = Counter()
    eligible_count = 0
    top: list[dict[str, Any]] = []
    best_by_scope: dict[str, dict[str, Any]] = {}
    compact_rows: list[dict[str, Any]] = []

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
            "time_budget_exhausted": int(_num(metrics.get("time_budget_exhausted")) >= 1.0),
            "failures": failures,
            "created_at": row.get("created_at"),
        }
        compact_rows.append(compact)
        scope_key = f"{compact['symbol']}|{compact['tf']}|{compact['campaign_id']}"
        best_by_scope.setdefault(scope_key, compact)
        if len(top) < max(1, int(top_n)):
            top.append(compact)

    scope_summaries = summarize_scopes(
        compact_rows,
        top_n=top_n,
        expected_symbols=expected_symbols,
        expected_timeframes=expected_timeframes,
    )
    summary = {
        "rows": len(rows),
        "paper_eligible": eligible_count,
        "paper_ineligible": max(0, len(rows) - eligible_count),
        "time_budget_exhausted": sum(1 for row in compact_rows if int(row.get("time_budget_exhausted") or 0) >= 1),
        "failure_counts": dict(sorted(failure_counts.items(), key=lambda item: (-item[1], item[0]))),
        "top": top,
        "best_by_scope": list(best_by_scope.values()),
        "scope_summaries": scope_summaries,
        "scope_coverage": scope_coverage(scope_summaries),
    }
    summary["status"] = readiness_status(summary)
    summary["recommendations"] = recommend_next_actions(summary)
    summary["experiment_plan"] = build_experiment_plan(summary)
    return summary


def readiness_status(summary: dict[str, Any]) -> str:
    if int(summary.get("rows") or 0) <= 0:
        return "missing_evaluations"
    if int(summary.get("paper_eligible") or 0) > 0:
        return "analysis_passed"
    return "needs_more_experiments"


def summarize_scopes(
    compact_rows: list[dict[str, Any]],
    top_n: int = 10,
    expected_symbols: list[str] | None = None,
    expected_timeframes: list[str] | None = None,
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str | None, str | None], list[dict[str, Any]]] = {}
    for row in compact_rows:
        key = (row.get("symbol"), row.get("tf"))
        grouped.setdefault(key, []).append(row)

    summaries: list[dict[str, Any]] = []
    for (symbol, tf), rows in sorted(grouped.items(), key=lambda item: (str(item[0][0]), str(item[0][1]))):
        rows_sorted = sorted(rows, key=lambda row: _num(row.get("score")), reverse=True)
        failure_counts: Counter[str] = Counter()
        for row in rows_sorted:
            failure_counts.update(row.get("failures") or [])
        eligible_count = sum(1 for row in rows_sorted if int(row.get("paper_eligible") or 0) >= 1)
        time_budget_count = sum(1 for row in rows_sorted if int(row.get("time_budget_exhausted") or 0) >= 1)
        summary = {
            "symbol": symbol,
            "tf": tf,
            "rows": len(rows_sorted),
            "paper_eligible": eligible_count,
            "paper_ineligible": max(0, len(rows_sorted) - eligible_count),
            "time_budget_exhausted": time_budget_count,
            "failure_counts": dict(sorted(failure_counts.items(), key=lambda item: (-item[1], item[0]))),
            "top": rows_sorted[: max(1, int(top_n))],
        }
        summary["status"] = readiness_status(summary)
        summary["recommendations"] = recommend_next_actions(summary)
        summaries.append(summary)
    summaries = add_missing_expected_scopes(
        summaries,
        expected_symbols=expected_symbols,
        expected_timeframes=expected_timeframes,
    )
    return summaries


def add_missing_expected_scopes(
    summaries: list[dict[str, Any]],
    expected_symbols: list[str] | None,
    expected_timeframes: list[str] | None,
) -> list[dict[str, Any]]:
    if not expected_symbols or not expected_timeframes:
        return summaries
    seen = {(item.get("symbol"), item.get("tf")) for item in summaries}
    out = list(summaries)
    for symbol in sorted(str(item) for item in expected_symbols):
        for tf in sorted(str(item) for item in expected_timeframes):
            if (symbol, tf) in seen:
                continue
            missing = {
                "symbol": symbol,
                "tf": tf,
                "rows": 0,
                "paper_eligible": 0,
                "paper_ineligible": 0,
                "failure_counts": {},
                "top": [],
            }
            missing["status"] = readiness_status(missing)
            missing["recommendations"] = recommend_next_actions(missing)
            out.append(missing)
    return sorted(out, key=lambda item: (str(item.get("symbol")), str(item.get("tf"))))


def scope_coverage(scope_summaries: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(str(item.get("status") or "unknown") for item in scope_summaries)
    total = len(scope_summaries)
    return {
        "total": total,
        "analysis_passed": int(counts.get("analysis_passed", 0)),
        "needs_more_experiments": int(counts.get("needs_more_experiments", 0)),
        "missing_evaluations": int(counts.get("missing_evaluations", 0)),
    }


def _recommendation(action: str, reason: str, command_hint: str | None = None) -> dict[str, str]:
    out = {"action": action, "reason": reason}
    if command_hint:
        out["command_hint"] = command_hint
    return out


def _failure_count(summary: dict[str, Any], *names: str) -> int:
    counts = dict(summary.get("failure_counts") or {})
    return sum(int(counts.get(name) or 0) for name in names)


def _matrix_command(summary: dict[str, Any], *extra: str) -> str:
    parts = ["python", "run_experiment_matrix.py"]
    symbol = summary.get("symbol")
    tf = summary.get("tf")
    if symbol:
        parts.extend(["--symbols", str(symbol)])
    if tf:
        parts.extend(["--timeframes", str(tf)])
    parts.append("--fast")
    parts.extend(item for item in extra if item)
    return " ".join(parts)


def _paper_candidate_command(summary: dict[str, Any], best: dict[str, Any]) -> str:
    parts = ["python", "list_paper_candidates.py"]
    symbol = best.get("symbol") or summary.get("symbol")
    tf = best.get("tf") or summary.get("tf")
    if symbol:
        parts.extend(["--symbol", str(symbol)])
    if tf:
        parts.extend(["--tf", str(tf)])
    return " ".join(parts)


def recommend_next_actions(summary: dict[str, Any]) -> list[dict[str, str]]:
    rows = int(summary.get("rows") or 0)
    eligible = int(summary.get("paper_eligible") or 0)
    top = list(summary.get("top") or [])
    recommendations: list[dict[str, str]] = []

    if rows <= 0:
        return [
            _recommendation(
                "run_recent_matrix",
                "No Supabase evaluations match this scope yet.",
                _matrix_command(summary),
            )
        ]

    if eligible > 0:
        best = next((row for row in top if int(row.get("paper_eligible") or 0) >= 1), top[0] if top else {})
        scope = f"{best.get('symbol')} {best.get('tf')} {best.get('campaign_id')}".strip()
        recommendations.append(
            _recommendation(
                "list_paper_candidates",
                f"Resolve the exact Supabase strategy id before starting paper for {scope}.",
                _paper_candidate_command(summary, best),
            )
        )
        recommendations.append(
            _recommendation(
                "prepare_controlled_paper",
                f"At least one strategy passes the analysis gates for {scope}.",
                "python start_paper_candidate.py --strategy-id <heaven_strategies.id> --session-name <paper-name> --invoke-runner",
            )
        )
        recommendations.append(
            _recommendation(
                "validate_before_live",
                "Live preparation still requires a Supabase paper-session validation audit.",
                "python validate_paper_session.py --session-name <paper-name> --record-event --strict-exit",
            )
        )
        recommendations.append(
            _recommendation(
                "audit_controlled_live",
                "Only prepare live activation after the paper session and matching strategy pass all gates.",
                "python prepare_live_candidate.py --session-name <paper-name> --strategy-id <heaven_strategies.id> --target-session-name <live-name> --record-event --strict-exit",
            )
        )
        return recommendations

    oos_failures = _failure_count(summary, "oos_profit_factor", "oos_return", "oos_drawdown")
    wf_failures = _failure_count(summary, "wf_positive_frac", "wf_active_frac", "wf_profit_factor")
    trade_failures = _failure_count(summary, "train_trades", "oos_trades")
    mc_failures = _failure_count(summary, "mc_profit_factor")
    entry_failures = _failure_count(summary, "paper_runner_entry_mode")
    time_budget_count = int(summary.get("time_budget_exhausted") or 0)

    if time_budget_count:
        recommendations.append(
            _recommendation(
                "increase_time_budget_or_narrow_search",
                "The run persisted partial candidates but stopped before robust validation completed.",
                _matrix_command(
                    summary,
                    "--include-no-be",
                    "--tp-mode",
                    "Percent",
                    "--max-combinations",
                    "300",
                    "--top-n",
                    "10",
                    "--time-budget-sec",
                    "900",
                ),
            )
        )

    if oos_failures:
        recommendations.append(
            _recommendation(
                "compare_exit_modes_and_expand_search",
                "Holdout performance is the main blocker; do not promote these candidates.",
                _matrix_command(summary, "--include-no-be", "--tp-mode", "Percent", "--max-combinations", "500", "--top-n", "10"),
            )
        )
    if wf_failures:
        recommendations.append(
            _recommendation(
                "favor_walk_forward_stability",
                "Walk-forward stability is insufficient across folds.",
                _matrix_command(summary, "--include-no-be", "--max-combinations", "500", "--top-n", "10"),
            )
        )
    if trade_failures:
        recommendations.append(
            _recommendation(
                "increase_signal_coverage",
                "Too few train or holdout trades make the performance evidence weak.",
                "Review nol/prd ranges or test a shorter timeframe before live preparation.",
            )
        )
    if mc_failures:
        recommendations.append(
            _recommendation(
                "reduce_noise_sensitivity",
                "Monte Carlo robustness is below the minimum profit-factor gate.",
                "Prioritize lower drawdown and higher MC PF candidates in the next campaign analysis.",
            )
        )
    if entry_failures:
        recommendations.append(
            _recommendation(
                "fix_unsupported_entry_modes",
                "Some candidates use an entry mode or Fib setting unsupported by the headless paper runner.",
                "Keep entry modes to Original, Fib Retracement, or Both before starting paper sessions.",
            )
        )
    if not recommendations:
        recommendations.append(
            _recommendation(
                "inspect_top_candidates",
                "No eligible strategy was found, but no known gate dominates the failures.",
                "python analyze_strategy_evaluations.py --campaign-prefix <prefix> --json",
            )
        )
    return recommendations


def build_experiment_plan(summary: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    commands: list[dict[str, str]] = []
    manual_actions: list[dict[str, str]] = []
    seen_commands: set[str] = set()
    seen_manual: set[tuple[str, str, str]] = set()
    seen_scoped_manual: set[tuple[str, str]] = set()

    sources = []
    for scope in summary.get("scope_summaries") or []:
        source = _scope_label(scope)
        sources.append((source, scope.get("recommendations") or []))
    sources.append(("GLOBAL", summary.get("recommendations") or []))

    for source, recommendations in sources:
        for item in recommendations:
            command_hint = str(item.get("command_hint") or "").strip()
            if not command_hint:
                continue
            action = str(item.get("action") or "unknown")
            category = "paper_or_live" if action in PAPER_OR_LIVE_ACTIONS else "experiments"
            reason = str(item.get("reason") or "")
            if _is_executable_command(command_hint):
                command_key = _normalize_command(command_hint)
                if command_key in seen_commands:
                    continue
                seen_commands.add(command_key)
                commands.append(
                    {
                        "category": category,
                        "action": action,
                        "source": source,
                        "command": command_key,
                        "reason": reason,
                    }
                )
                continue
            scoped_manual_key = (action, command_hint)
            if source == "GLOBAL" and scoped_manual_key in seen_scoped_manual:
                continue
            if source != "GLOBAL":
                seen_scoped_manual.add(scoped_manual_key)
            manual_key = (source, action, command_hint)
            if manual_key in seen_manual:
                continue
            seen_manual.add(manual_key)
            manual_actions.append(
                {
                    "category": category,
                    "action": action,
                    "source": source,
                    "instruction": command_hint,
                    "reason": reason,
                }
            )

    return {"commands": commands, "manual_actions": manual_actions}


def _scope_label(summary: dict[str, Any]) -> str:
    symbol = str(summary.get("symbol") or "").strip()
    tf = str(summary.get("tf") or "").strip()
    if symbol and tf:
        return f"{symbol} {tf}"
    if symbol:
        return symbol
    if tf:
        return tf
    return "GLOBAL"


def _normalize_command(command: str) -> str:
    return " ".join(command.split())


def _is_executable_command(command: str) -> bool:
    normalized = _normalize_command(command)
    if "<" in normalized or ">" in normalized:
        return False
    return normalized.startswith("python ")


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
    budget_suffix = ""
    if int(summary.get("time_budget_exhausted") or 0) > 0:
        budget_suffix = f" time_budget_exhausted={summary['time_budget_exhausted']}"
    print(
        f"rows={summary['rows']} paper_eligible={summary['paper_eligible']} "
        f"paper_ineligible={summary['paper_ineligible']}{budget_suffix}"
    )
    if summary.get("scope_coverage"):
        coverage = summary["scope_coverage"]
        print(
            "scope_coverage="
            f"total:{coverage.get('total', 0)} "
            f"passed:{coverage.get('analysis_passed', 0)} "
            f"needs_more:{coverage.get('needs_more_experiments', 0)} "
            f"missing:{coverage.get('missing_evaluations', 0)}"
        )
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
    if summary.get("scope_summaries"):
        print("scopes:")
        for scope in summary["scope_summaries"]:
            action = "none"
            recommendations = scope.get("recommendations") or []
            if recommendations:
                action = str(recommendations[0].get("action") or "none")
            print(
                f"- {scope.get('symbol')} {scope.get('tf')}: status={scope.get('status')} "
                f"rows={scope.get('rows')} eligible={scope.get('paper_eligible')} "
                f"next={action}"
            )
    if summary["recommendations"]:
        print("recommendations:")
        for item in summary["recommendations"]:
            line = f"- {item['action']}: {item['reason']}"
            if item.get("command_hint"):
                line += f" | {item['command_hint']}"
            print(line)
    plan = summary.get("experiment_plan") or {}
    commands = plan.get("commands") or []
    manual_actions = plan.get("manual_actions") or []
    if commands or manual_actions:
        print("experiment_plan:")
        if commands:
            print("commands:")
            for item in commands:
                print(f"- [{item['category']}] {item['source']}: {item['command']}")
        if manual_actions:
            print("manual_actions:")
            for item in manual_actions:
                print(f"- [{item['category']}] {item['source']}: {item['instruction']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze Supabase Heaven strategy evaluations")
    parser.add_argument("--campaign-id")
    parser.add_argument("--campaign-prefix")
    parser.add_argument("--symbol")
    parser.add_argument("--tf")
    parser.add_argument("--expected-symbols", nargs="+")
    parser.add_argument("--expected-timeframes", nargs="+")
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
    summary = summarize_evaluations(
        rows,
        top_n=args.top_n,
        expected_symbols=args.expected_symbols,
        expected_timeframes=args.expected_timeframes,
    )
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
