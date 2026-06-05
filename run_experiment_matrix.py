#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

from heaven_opt import OptimizationConfig
from heaven_opt.api import optimize_heaven

SUPPORTED_SYMBOLS = ("BTCUSDC", "ETHUSDC", "BNBUSDC")
SUPPORTED_TIMEFRAMES = ("1m", "5m", "15m", "1h", "4h", "1d")
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


@dataclass(frozen=True)
class WindowPolicy:
    train_days: int
    holdout_days: int
    wf_train: str
    wf_test: str
    wf_stride: str
    min_trades: int
    min_oos_trades: int


WINDOW_POLICIES = {
    "1m": WindowPolicy(120, 30, "21d", "7d", "7d", 100, 30),
    "5m": WindowPolicy(365, 60, "60d", "14d", "14d", 80, 25),
    "15m": WindowPolicy(730, 90, "90d", "30d", "30d", 60, 20),
    "1h": WindowPolicy(1095, 180, "180d", "60d", "60d", 40, 15),
    "4h": WindowPolicy(1460, 240, "240d", "60d", "60d", 30, 10),
    "1d": WindowPolicy(1825, 730, "365d", "365d", "180d", 20, 8),
}


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def latest_closed_day_boundary(now: datetime | None = None) -> datetime:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return current.replace(hour=0, minute=0, second=0, microsecond=0)


def _parse_date_to(value: str | None) -> datetime:
    if not value:
        return latest_closed_day_boundary()
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _coerce_ranges(ranges: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in ranges.items():
        if isinstance(value, (list, tuple)) and len(value) == 3:
            out[key] = {"min": float(value[0]), "max": float(value[1]), "step": float(value[2])}
        else:
            out[key] = value
    return out


def build_config_data(
    template: dict[str, Any],
    symbol: str,
    tf: str,
    date_to: datetime,
    *,
    fast: bool = False,
    include_fib: bool = False,
    include_no_be: bool = False,
    tp_mode: str = "Fib",
    max_combinations: int | None = None,
    top_n: int | None = None,
) -> dict[str, Any]:
    policy = WINDOW_POLICIES[tf]
    holdout_from = date_to - timedelta(days=policy.holdout_days)
    date_from = holdout_from - timedelta(days=policy.train_days)
    data = copy.deepcopy(template)
    data.setdefault("general", {})
    data.setdefault("validation", {})
    data.setdefault("metrics", {})
    data.setdefault("TP", {})
    data.setdefault("EA", {})
    data.setdefault("Bayesian", {})
    data["general"].update(
        {
            "symbol": symbol,
            "tf_optim": tf,
            "date_from": _iso(date_from),
            "date_to": _iso(date_to),
        }
    )
    data["validation"].update(
        {
            "oos_split": [_iso(holdout_from), _iso(date_to)],
            "monte_carlo_runs": 20,
            "monte_carlo_sigma": 0.001,
            "walk_forward": {
                "train_window": policy.wf_train,
                "test_window": policy.wf_test,
                "stride": policy.wf_stride,
            },
        }
    )
    data["metrics"].update(
        {
            "min_trades": policy.min_trades,
            "min_oos_trades": policy.min_oos_trades,
            "validation_top_n": 50,
            "robustness_weight": 0.65,
            "min_oos_profit_factor": 1.10,
            "min_oos_return_pct": 0.0,
            "max_oos_dd_pct": 20.0,
            "min_wf_positive_frac": 0.55,
            "min_wf_active_frac": 0.50,
            "min_wf_profit_factor": 1.0,
            "min_mc_profit_factor": 1.0,
        }
    )
    # The current headless paper runner supports causal Line Break entries.
    data["entry_modes"] = ["Original", "Fib", "Both"] if include_fib else ["Original"]
    data["TP"]["mode"] = tp_mode
    if tp_mode == "Percent":
        data["TP"].update({"percent_min": 0.5, "percent_max": 5.0, "percent_step": 0.5})
    data.setdefault("ranges", {})
    if include_no_be:
        data["ranges"]["be_enable_values"] = [True, False]
    if fast:
        data["EA"]["pop_size"] = min(int(data["EA"].get("pop_size", 80)), 30)
        data["EA"]["n_generations"] = min(int(data["EA"].get("n_generations", 12)), 5)
        data["Bayesian"]["n_trials"] = min(int(data["Bayesian"].get("n_trials", 20)), 6)
        data["general"]["max_combinations"] = min(int(data["general"].get("max_combinations", 1000)), 300)
        data["general"]["top_n_results"] = min(int(data["general"].get("top_n_results", 20)), 10)
        data["validation"]["monte_carlo_runs"] = 10
        data["metrics"]["validation_top_n"] = 20
    if max_combinations is not None:
        data["general"]["max_combinations"] = max(1, int(max_combinations))
    if top_n is not None:
        data["general"]["top_n_results"] = max(1, int(top_n))
    if "ranges" in data and isinstance(data["ranges"], dict):
        data["ranges"] = _coerce_ranges(data["ranges"])
    return data


def _seed_for(symbol: str, tf: str, date_to: datetime) -> int:
    raw = f"{symbol}|{tf}|{_iso(date_to)}".encode()
    return int(hashlib.sha1(raw).hexdigest()[:8], 16)


@contextmanager
def _run_environment(values: dict[str, str]) -> Iterator[None]:
    previous = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _summary_line(symbol: str, tf: str, result: Any) -> str:
    top = result.top[0] if result.top else None
    if not top:
        return f"{symbol} {tf}: no result"
    metrics = top.metrics
    failure_names = _paper_failure_names(metrics)
    failure_suffix = ""
    if failure_names:
        failure_suffix = f" failures={','.join(failure_names)}"
    return (
        f"{symbol} {tf}: score={metrics.get('score', 0.0):.4f} "
        f"eligible={int(metrics.get('paper_eligible', 0.0))} "
        f"oos_ret={metrics.get('oos_return_pct', 0.0):.2f}% "
        f"oos_pf={metrics.get('oos_profitFactor', 0.0):.3f} "
        f"oos_dd={metrics.get('oos_maxDDPct', 0.0):.2f}%"
        f"{failure_suffix}"
    )


def _paper_failure_names(metrics: dict[str, Any]) -> list[str]:
    prefix = "paper_fail_"
    active = {
        key[len(prefix):]
        for key, value in metrics.items()
        if key.startswith(prefix) and float(value or 0.0) >= 1.0
    }
    ordered = [name for name in PAPER_GATE_ORDER if name in active]
    return ordered + sorted(active.difference(ordered))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the recent robust Heaven experiment matrix")
    parser.add_argument("--config", default="config.example.yaml", help="YAML template path")
    parser.add_argument("--symbols", nargs="+", choices=SUPPORTED_SYMBOLS, default=list(SUPPORTED_SYMBOLS))
    parser.add_argument("--timeframes", nargs="+", choices=SUPPORTED_TIMEFRAMES, default=list(SUPPORTED_TIMEFRAMES))
    parser.add_argument("--date-to", help="UTC ISO end boundary; defaults to today's 00:00 UTC")
    parser.add_argument("--campaign-prefix", default="heaven-robust")
    parser.add_argument("--fast", action="store_true", help="Use a smaller first-pass search")
    parser.add_argument("--include-fib", action="store_true", help="Explore Fib/Both entries, which are not paper-eligible yet")
    parser.add_argument("--include-no-be", action="store_true", help="Explore disabling break-even in addition to the default enabled mode")
    parser.add_argument("--tp-mode", choices=("Fib", "Percent"), default="Fib")
    parser.add_argument("--max-combinations", type=int)
    parser.add_argument("--top-n", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    template_path = Path(args.config)
    if not template_path.exists():
        parser.error(f"Config template not found: {template_path}")
    template = yaml.safe_load(template_path.read_text(encoding="utf-8")) or {}
    if not isinstance(template, dict):
        parser.error("Config template must contain a YAML mapping")
    date_to = _parse_date_to(args.date_to)
    failures = 0
    for symbol in args.symbols:
        for tf in args.timeframes:
            data = build_config_data(
                template,
                symbol,
                tf,
                date_to,
                fast=args.fast,
                include_fib=args.include_fib,
                include_no_be=args.include_no_be,
                tp_mode=args.tp_mode,
                max_combinations=args.max_combinations,
                top_n=args.top_n,
            )
            campaign = f"{args.campaign_prefix}-{args.tp_mode.lower()}-{symbol.lower()}-{tf}-{date_to:%Y%m%d}"
            general = data["general"]
            holdout = data["validation"]["oos_split"]
            print(
                f"{symbol} {tf}: train {general['date_from']} -> {holdout[0]}, "
                f"holdout {holdout[0]} -> {holdout[1]}, campaign={campaign}"
            )
            if args.dry_run:
                continue
            env = {
                "HEAVEN_CAMPAIGN_ID": campaign,
                "HEAVEN_NOTE": campaign,
                "HEAVEN_RUN_TYPE": "NEW",
                "HEAVEN_SEED": str(_seed_for(symbol, tf, date_to)),
            }
            try:
                config = OptimizationConfig(**data)
                with _run_environment(env):
                    result = optimize_heaven(config)
                print(_summary_line(symbol, tf, result))
            except Exception as exc:
                failures += 1
                print(f"{symbol} {tf}: ERROR {exc}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
