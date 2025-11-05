# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Scope
- This repo contains two parts:
  - Python engine (package heaven_opt) to optimize and backtest the “Heaven” trading strategy with EA exploration, Bayesian refinement, and validation.
  - Browser UI (src/) that visualizes charts and includes a local “Lab” for quick, client-side backtesting/optimization, served via a static HTTP server.

Common commands
- Install dependencies
  - Python
    - pip install -r requirements.txt
    - pip install -r requirements-dev.txt
  - JavaScript
    - npm install
- Lint
  - JavaScript: npm run lint  (auto-fix: npm run lint:fix)
  - Python: npm run lint:py  (auto-fix: npm run lint:py:fix)
- Tests (Python)
  - All tests: npm run test:py  (equivalent: python -m pytest -q)
  - Single test: python -m pytest tests/test_basic.py::test_allocation_normalization_quantization -q
- Run the optimizer (Python)
  - python run_optimize.py --config config.example.yaml
  - Optional flags: --fast (smaller EA/Bayes budgets), --no-wf (skip walk-forward/Monte Carlo)
  - Env vars: HEAVEN_SEED=<int> (reproducible RNG), HEAVEN_NO_WF=1 (alternate skip validation)
- Serve the browser UI locally
  - npm run dev
  - Open http://127.0.0.1:5173 in your browser
- Caching and artifacts
  - Python caches under .cache_heaven (joblib); delete the folder to force recomputation.
  - Optimizer outputs go to runs/<timestamp> (results.yaml and, if EA mode, ea_seeds.yaml).

High-level architecture and flow
- Configuration and models (heaven_opt/__init__.py)
  - Pydantic models define OptimizationConfig with sub-models for general/search/ranges/TP/EA/Bayesian/backtest/validation/resource/metrics.
  - Ranges are numeric [min,max,step] (coerced from YAML) and used to build discrete search lists.
  - A shared joblib Memory is initialized per cache_dir.
- Orchestrator (heaven_opt/api.py)
  - Loads market data via cached_fetch_klines_range, defines eval_candidate() to simulate one parameter set, and orchestrates optimization.
  - EA + Bayesian: DEAP-based EA explores a coarse space; Optuna refines top seeds within local bounds.
  - Consolidation: walk-forward and Monte Carlo validation augment metrics (unless disabled), then composite_score() ranks and top-N are saved.
- Simulation engine (heaven_opt/simulator.py)
  - Mirrors the browser logic: Line Break entries, optional Fib retracement confirmation, trailing to BE, optional EMA-based exits, and a 10-target TP ladder.
  - Computes equity, P&L, PF, Sharpe, slope/R², Calmar, and drawdowns.
- Signals and preprocessing (heaven_opt/signal_engine.py)
  - compute_line_break_state(), compute_pivots(), and EMA series; cached on disk keyed by (symbol, tf, time range, params).
- Scoring (heaven_opt/scoring.py)
  - composite_score() normalizes PF/Sharpe/DD/RR/Calmar/R²/slope/Recovery using weights from config.metrics.
- Search helpers (heaven_opt/combo_generator.py)
  - Generates TP level combinations (Fib/Percent) and allocation patterns; offers simple sampling to cap combinations.
- Data loading (heaven_opt/data_loader.py)
  - Fetches Binance klines (REST) in reverse batches; returns ascending bars; cached via joblib.
- CLI entrypoint (run_optimize.py)
  - Reads YAML, coerces [min,max,step] into Range models, applies --fast overrides, honors HEAVEN_NO_WF, and calls optimize_heaven().

Browser “Lab” and UI (src/)
- src/main.js renders the chart (Lightweight Charts), streams live klines (Binance WS), and exposes modals for Live/Lab/Backtest/Heaven config.
- The “Lab” stores per-symbol/TF candidates/results in localStorage (lab:results:* and lab:palmares:*), provides a sortable palmarès, and includes a client-side optimizer over parameter grids.
- The Python simulator mirrors these UI choices to keep numerical parity; minor rounding deltas are expected.

Key configs and knobs
- YAML example: config.example.yaml shows EA/Bayesian parameters, ranges, TP mode, allocation, backtest settings, validation (walk-forward), resource.n_jobs, and metric weights.
- Validation controls: --no-wf or HEAVEN_NO_WF=1 to skip walk-forward and Monte Carlo.
- Parallelism: resource.n_jobs controls joblib threading and Optuna parallel trials.
- Time window: general.date_from/date_to define the klines range fetched and simulated.

Outputs and notes (from README)
- Outputs: JSON/CSV of top-N results; Equity curves (CSV) per candidate; logs and caches under cache_dir.
- Data via Binance REST; providing cached data speeds up runs.
- Optional numba acceleration is listed in requirements but excluded on Windows.

Repository layout (high level)
- heaven_opt/ (Python engine) • src/ (browser UI) • docs/ (audit prompts/snapshots) • runs/ (artifacts) • vendor/ (lightweight-charts bundle) • tools/ (small JS utilities)
