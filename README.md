# Heaven Strategy Hybrid Optimizer (EA + Bayesian)

This Python package provides an optimization engine for the Heaven trading strategy. It supports:
- Grid/Random search
- Evolutionary Algorithm (EA) exploration
- Local Bayesian refinement (Optuna TPE/Gaussian)
- Caching, true EA elitism, early stopping, walk-forward validation, Monte Carlo robustness checks
- Trade diagnostics for strategy analysis (streaks, exits, exposure, payoff)
- Parallel evaluation and progress callbacks for UI integration
- Supabase-only persistence for evaluated and selected strategies

Quickstart
- Install requirements: pip install -r requirements.txt
- Create a config: see config.example.yaml
- Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`)
- Run: python run_optimize.py --config config.example.yaml
- Reproducible historical BTCUSDC 15m diagnostic: set `HEAVEN_SEED=20260603`, then run `python run_optimize.py --config config.btc15m.yaml`
- Preview the recent pair/TF matrix: `python run_experiment_matrix.py --dry-run`
- Run a first recent robust pass: `python run_experiment_matrix.py --fast`
- Compare Percent exits: `python run_experiment_matrix.py --fast --tp-mode Percent`
- Explore short-TF break-even sensitivity: `python run_experiment_matrix.py --fast --tp-mode Percent --include-no-be`
- Analyze a Supabase campaign and next experiment recommendations: `python analyze_strategy_evaluations.py --campaign-prefix heaven-robust --symbol BTCUSDC --tf 15m`
- Audit expected matrix coverage: `python analyze_strategy_evaluations.py --campaign-prefix heaven-robust --expected-symbols BTCUSDC ETHUSDC BNBUSDC --expected-timeframes 15m 1h 4h`
- Start a paper session from an eligible Supabase strategy: `python start_paper_candidate.py --strategy-name <heaven_strategies.name> --session-name <paper-name> --invoke-runner`
- Audit controlled live readiness from a validated paper session: `python prepare_live_candidate.py --session-name <paper-name> --strategy-name <heaven_strategies.name> --target-session-name <live-name> --record-event --strict-exit`

Outputs
- Evaluations in `strategy_evaluations`, scoped by an immutable `run_id`
- Strategy-analysis metrics in each evaluation (`diag_*` and `oos_diag_*`)
- Campaign performance summaries read from `strategy_evaluations` with no local export required
- Ranked selections in `palmares_sets` and `palmares_entries`
- Reloadable best strategies in `heaven_strategies`
- Runtime logs and deterministic computation cache under `cache_dir`

Notes
- Data loading uses Binance REST; provide your own data or cache for speed.
- Optimization uses closed candles only. `validation.oos_split` reserves an untouched holdout range.
- Walk-forward, Monte Carlo, and holdout metrics affect the final robust score.
- The robust validation pool keeps the best training scores and adds diversified winners by PF, PnL, Calmar, consistency, trades, and low drawdown.
- Only strategies that pass the paper-trading gates are copied to `heaven_strategies`.
- No strategy result or preset is written to local files by the optimizer.
- Campaign analysis is Supabase-only: it reads persisted evaluations and prints the top candidates, failed validation gates, per symbol/TF readiness, and next experiment recommendations.
- Paper sessions are Supabase-only. `start_paper_candidate.py` refuses non-eligible strategies and never writes local strategy state.
- Live preparation is audit-only by default: `prepare_live_candidate.py` refuses failed paper gates, weak strategy-analysis metrics, risk/leverage violations, unsupported entries, and never creates live sessions or orders.
- Optional `HEAVEN_RUN_TYPE` (`NEW` or `LAB`) and `HEAVEN_CAMPAIGN_ID` values are stored with each run.
- The recent matrix defaults to `Original` entries because the headless paper runner does not yet execute Fib retracement entries.
- Simulation and paper runners only use pivots after their confirmation delay, close flip exits at signal close, and enter the next trade at the following candle open.
- A runner that cannot cover all missed candles stops the paper session with a `history_gap` event instead of silently replaying partial history.
- Optional numba acceleration can be enabled if available.

---

## Audit de l’optimiseur
- Template d’audit: see `docs/audit_prompt.md`
- Snapshot actuel (rempli): see `docs/audit_snapshot_current.md`

How to refresh the snapshot (PowerShell, non-destructive):
- `Select-String -Path (gci -Recurse -Include *.py).FullName -Pattern "DEAP|optuna|joblib|walk[- ]?forward|Monte Carlo|results\.yaml"`
- `Select-String -Path (gci -Recurse -Include *.yaml,*.yml).FullName -Pattern "range|min|max|weights|metrics"`
- `Select-String -Path (gci -Recurse -Include *.js).FullName -Pattern "Worker|importScripts|localStorage|WebSocket|CSV|export"`
