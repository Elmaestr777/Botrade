# Heaven Strategy Hybrid Optimizer (EA + Bayesian)

This Python package provides an optimization engine for the Heaven trading strategy. It supports:
- Grid/Random search
- Evolutionary Algorithm (EA) exploration
- Local Bayesian refinement (Optuna TPE/Gaussian)
- Caching, early stopping, walk-forward validation, Monte Carlo robustness checks
- Parallel evaluation and progress callbacks for UI integration

Quickstart
- Install requirements: pip install -r requirements.txt
- Create a config: see config.example.yaml
- Run: python run_optimize.py --config config.example.yaml

Outputs
- JSON/CSV of top-N results
- Equity curves (CSV) per candidate
- Logs and cache under cache_dir

Notes
- Data loading uses Binance REST; provide your own data or cache for speed.
- Simulation mirrors the JS logic (SL/BE/TP) for numerical parity; minor rounding deltas may occur.
- Optional numba acceleration can be enabled if available.

---

## Audit de l’optimiseur
- Template d’audit: see `docs/audit_prompt.md`
- Snapshot actuel (rempli): see `docs/audit_snapshot_current.md`

How to refresh the snapshot (PowerShell, non-destructive):
- `Select-String -Path (gci -Recurse -Include *.py).FullName -Pattern "DEAP|optuna|joblib|walk[- ]?forward|Monte Carlo|results\.yaml"`
- `Select-String -Path (gci -Recurse -Include *.yaml,*.yml).FullName -Pattern "range|min|max|weights|metrics"`
- `Select-String -Path (gci -Recurse -Include *.js).FullName -Pattern "Worker|importScripts|localStorage|WebSocket|CSV|export"`
