#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

import yaml

from heaven_opt import OptimizationConfig
from heaven_opt.api import PersistencePartialError, optimize_heaven


def _runtime_risk_gate_errors(data: dict) -> list[str]:
    errs: list[str] = []
    general = data.get("general") or {}
    backtest = data.get("backtest") or {}
    ranges = data.get("ranges") or {}
    tp = data.get("TP") or {}

    symbol = str(general.get("symbol") or "").upper()
    if not symbol.startswith("BTC"):
        errs.append(f"symbol '{symbol or '?'}' refusé: focus runtime actuel = BTC uniquement")

    risk_max_pct = backtest.get("risk_max_pct")
    try:
        risk_max_pct_f = float(risk_max_pct)
        if not (0.0 < risk_max_pct_f <= 2.0):
            errs.append("backtest.risk_max_pct doit être dans ]0,2] pour limiter le risque par trade")
    except Exception:
        errs.append("backtest.risk_max_pct manquant ou invalide")

    daily_dd = backtest.get("max_daily_drawdown_pct")
    rolling_dd = backtest.get("max_rolling_drawdown_pct")
    daily_dd_f = None
    rolling_dd_f = None
    try:
        daily_dd_f = float(daily_dd)
        if not (0.0 < daily_dd_f <= 10.0):
            errs.append("backtest.max_daily_drawdown_pct doit être dans ]0,10] (kill-switch journalier)")
    except Exception:
        errs.append("backtest.max_daily_drawdown_pct manquant ou invalide (kill-switch journalier requis)")

    try:
        rolling_dd_f = float(rolling_dd)
        if not (0.0 < rolling_dd_f <= 25.0):
            errs.append("backtest.max_rolling_drawdown_pct doit être dans ]0,25] (kill-switch rolling)")
    except Exception:
        errs.append("backtest.max_rolling_drawdown_pct manquant ou invalide (kill-switch rolling requis)")

    if daily_dd_f is not None and rolling_dd_f is not None and daily_dd_f > rolling_dd_f:
        errs.append("backtest.max_daily_drawdown_pct ne peut pas dépasser backtest.max_rolling_drawdown_pct")

    sl_range = ranges.get("sl_pct_range") or {}
    sl_min = sl_range.get("min") if isinstance(sl_range, dict) else None
    try:
        if float(sl_min) <= 0.0:
            errs.append("ranges.sl_pct_range.min doit être > 0 (stop-loss obligatoire)")
    except Exception:
        errs.append("ranges.sl_pct_range.min manquant ou invalide")

    tp_mode = str(tp.get("mode") or "Fib")
    if tp_mode == "Fib":
        ratios = tp.get("allowed_ratios") or []
        if not ratios:
            errs.append("TP.allowed_ratios requis en mode Fib (take-profit obligatoire)")
    elif tp_mode == "Percent":
        try:
            pct_max = float(tp.get("percent_max"))
            if pct_max <= 0:
                errs.append("TP.percent_max doit être > 0 en mode Percent")
        except Exception:
            errs.append("TP.percent_max manquant ou invalide en mode Percent")

    return errs


def _run_report_refresh(config_path: Path, symbol: str, tf: str) -> bool:
    report_script = None
    explicit = os.getenv("HEAVEN_PALMARES_REPORT")
    if explicit:
        p = Path(explicit)
        if p.exists():
            report_script = p

    if report_script is None:
        candidates = [
            Path.home() / ".openclaw/workspace/botrade_dev/tools/report_latest_palmares.py",
            Path("tools/report_latest_palmares.py"),
        ]
        for cand in candidates:
            if cand.exists():
                report_script = cand
                break

    if report_script is None:
        print("[refresh] report script not found (set HEAVEN_PALMARES_REPORT)")
        return False

    env_file = os.getenv("HEAVEN_ENV_FILE", str(Path.home() / ".openclaw/workspace/botrade_dev/.env.local"))
    max_dd = os.getenv("HEAVEN_MAX_DD_PCT", "3.0")
    max_tph = os.getenv("HEAVEN_MAX_TRADES_PER_HOUR", "2.0")
    lookback = os.getenv("HEAVEN_COMPARABILITY_LOOKBACK_SETS", "3")

    cmd = [
        sys.executable,
        str(report_script),
        "--symbol",
        symbol,
        "--tf",
        tf,
        "--limit",
        "10",
        "--env-file",
        env_file,
        "--max-dd-pct",
        str(max_dd),
        "--max-trades-per-hour",
        str(max_tph),
        "--comparability-lookback-sets",
        str(lookback),
    ]
    print(f"[refresh] running palmares refresh report: {report_script}")
    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        print(f"[refresh] report failed with code {proc.returncode}", file=sys.stderr)
        return False
    return True


def _run_once(config: OptimizationConfig) -> int:
    try:
        res = optimize_heaven(config)
    except PersistencePartialError as e:
        print(str(e), file=sys.stderr)
        return 1
    print(f"Top {len(res.top)} results. Artifacts: {res.artifacts_dir}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Heaven Strategy Optimizer")
    parser.add_argument("--config", required=True, help="Path to YAML config")
    parser.add_argument("--fast", action="store_true", help="Fast overrides for quick run")
    parser.add_argument("--no-wf", action="store_true", help="Disable Walk-Forward/Monte-Carlo validation")
    parser.add_argument(
        "--cycle-full",
        action="store_true",
        help="Run canonical full cycle: NEW -> palmares refresh -> LAB",
    )
    args = parser.parse_args(argv)

    cfg_path = Path(args.config)
    if not cfg_path.exists():
        print(f"Config not found: {cfg_path}", file=sys.stderr)
        return 2

    data = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))

    # Coerce YAML-friendly structures to Pydantic expectations
    def _coerce_ranges(rngs: dict) -> dict:
        out = {}
        for k, v in rngs.items():
            if isinstance(v, (list, tuple)) and len(v) == 3:
                out[k] = {"min": float(v[0]), "max": float(v[1]), "step": float(v[2])}
            else:
                out[k] = v
        return out

    if isinstance(data.get("general", {}).get("date_from"), (str,)) is False:
        df = data["general"].get("date_from")
        try:
            data["general"]["date_from"] = df.isoformat().replace("+00:00", "Z")
        except Exception:
            pass
    if isinstance(data.get("general", {}).get("date_to"), (str,)) is False:
        dt = data["general"].get("date_to")
        try:
            data["general"]["date_to"] = dt.isoformat().replace("+00:00", "Z")
        except Exception:
            pass
    if "ranges" in data and isinstance(data["ranges"], dict):
        data["ranges"] = _coerce_ranges(data["ranges"])

    # Fast overrides
    if args.fast:
        data.setdefault("EA", {})
        data.setdefault("Bayesian", {})
        data.setdefault("general", {})
        data["EA"]["pop_size"] = min(int(data["EA"].get("pop_size", 80)), 40)
        data["EA"]["n_generations"] = min(int(data["EA"].get("n_generations", 12)), 8)
        data["Bayesian"]["n_trials"] = min(int(data["Bayesian"].get("n_trials", 20)), 10)
        data["general"]["max_combinations"] = min(int(data["general"].get("max_combinations", 1000)), 500)
        data["general"]["top_n_results"] = min(int(data["general"].get("top_n_results", 20)), 10)

    gate_errors = _runtime_risk_gate_errors(data)
    if gate_errors:
        print("NO-GO risk gate:", file=sys.stderr)
        for err in gate_errors:
            print(f"- {err}", file=sys.stderr)
        return 2

    config = OptimizationConfig(**data)

    # runtime flags not in schema
    if args.no_wf:
        os.environ["HEAVEN_NO_WF"] = "1"

    if not args.cycle_full:
        return _run_once(config)

    # Canonical full cycle: NEW -> refresh palmares -> LAB
    original_run_type = os.getenv("HEAVEN_RUN_TYPE")
    original_campaign_id = os.getenv("HEAVEN_CAMPAIGN_ID")
    cycle_campaign_id = original_campaign_id or (
        f"cmp-{str(config.general.symbol).lower()}-{str(config.general.tf_optim).lower()}-{time.strftime('%Y%m%d%H%M%S')}"
    )
    try:
        os.environ["HEAVEN_CAMPAIGN_ID"] = cycle_campaign_id
        print(f"[cycle] campaign={cycle_campaign_id}")

        os.environ["HEAVEN_RUN_TYPE"] = "NEW"
        print("[cycle] step 1/3 NEW")
        code = _run_once(config)
        if code != 0:
            return code

        print("[cycle] step 2/3 Refresh palmares")
        if not _run_report_refresh(cfg_path, config.general.symbol, config.general.tf_optim):
            return 1

        os.environ["HEAVEN_RUN_TYPE"] = "LAB"
        print("[cycle] step 3/3 LAB")
        return _run_once(config)
    finally:
        if original_run_type is None:
            os.environ.pop("HEAVEN_RUN_TYPE", None)
        else:
            os.environ["HEAVEN_RUN_TYPE"] = original_run_type

        if original_campaign_id is None:
            os.environ.pop("HEAVEN_CAMPAIGN_ID", None)
        else:
            os.environ["HEAVEN_CAMPAIGN_ID"] = original_campaign_id


if __name__ == "__main__":
    raise SystemExit(main())
