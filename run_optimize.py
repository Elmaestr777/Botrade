#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

from heaven_opt import OptimizationConfig
from heaven_opt.api import optimize_heaven


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Heaven Strategy Optimizer")
    parser.add_argument("--config", required=True, help="Path to YAML config")
    parser.add_argument("--fast", action="store_true", help="Fast overrides for quick run")
    parser.add_argument("--no-wf", action="store_true", help="Disable Walk-Forward/Monte-Carlo validation")
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

    config = OptimizationConfig(**data)

    # runtime flags not in schema
    if args.no_wf:
        import os
        os.environ["HEAVEN_NO_WF"] = "1"

    res = optimize_heaven(config)

    print(f"Top {len(res.top)} results. Artifacts: {res.artifacts_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
