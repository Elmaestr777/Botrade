from __future__ import annotations

import os
import time
import uuid

from . import Candidate, OptimizationConfig, OptimizationResult
from .analysis import trade_diagnostics
from .combo_generator import (
    generate_alloc_patterns,
    generate_tp_fib_combos,
    generate_tp_percent_combos,
)
from .data_loader import cached_fetch_klines_range
from .env import load_repo_env
from .params import normalize_canonical_params
from .simulator import HeavenOpts, backtest_with_bars
from .utils import duration_days, epoch_seconds_range, setup_logger, sha1_of_params


def _build_opts_from_candidate(base_opts: HeavenOpts, cand: dict) -> HeavenOpts:
    cand = normalize_canonical_params(cand)
    # Copy and update fields
    o = HeavenOpts(
        nol=cand.get("nol", base_opts.nol),
        prd=cand.get("prd", base_opts.prd),
        entry_mode=cand.get("entry_mode", base_opts.entry_mode),
        risk_mgmt=base_opts.risk_mgmt,
        risk_max_pct=base_opts.risk_max_pct,
        leverage=base_opts.leverage,
        sl_init_pct=cand.get("sl_init_pct", base_opts.sl_init_pct),
        be_enable=bool(cand.get("be_enable", base_opts.be_enable)),
        be_after_bars=cand.get("be_after_bars", base_opts.be_after_bars),
        be_lock_pct=cand.get("be_lock_pct", base_opts.be_lock_pct),
        tp_enable=True,
        tp_norm=True,
        ema_len=cand.get("ema_len", base_opts.ema_len),
        tp_types=cand.get("tp_types", base_opts.tp_types),
        tp_r=cand.get("tp_r", base_opts.tp_r),
        tp_p=cand.get("tp_p", base_opts.tp_p),
        use_fib_ret=True,
        confirm_mode="Bounce",
    )
    return o


def _rank_key(m: dict) -> tuple:
    # Sort primarily by PF, then totalPnl
    pf = float(m.get("profitFactor", 0.0))
    pnl = float(m.get("totalPnl", 0.0))
    return (-pf, -pnl)


def _dedupe_results_by_params(results: list[dict]) -> list[dict]:
    unique: dict[str, dict] = {}
    for result in results:
        normalized = dict(result)
        normalized["params"] = normalize_canonical_params(result.get("params") or {})
        key = sha1_of_params(normalized["params"])
        existing = unique.get(key)
        if existing is None:
            unique[key] = normalized
            continue
        existing_score = float((existing.get("metrics") or {}).get("score", float("-inf")))
        result_score = float((normalized.get("metrics") or {}).get("score", float("-inf")))
        if result_score > existing_score:
            unique[key] = normalized
    return list(unique.values())


PAPER_GATE_NAMES = (
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
)


def _headless_entry_mode_supported(params: dict | None) -> bool:
    params = params or {}
    mode = str(params.get("entry_mode") or params.get("entryMode") or "Both")
    if mode == "Fib Retracement":
        mode = "Fib"
    if mode not in {"Original", "Fib", "Both"}:
        return False
    if mode == "Fib" and not bool(params.get("use_fib_ret", params.get("useFibRet", True))):
        return False
    return True


def _paper_gate_failures(metrics: dict, config: OptimizationConfig, params: dict | None = None) -> list[str]:
    cfg = config.metrics
    params = params or {}
    checks = [
        ("paper_runner_entry_mode", _headless_entry_mode_supported(params)),
        ("train_trades", float(metrics.get("trades", 0.0)) >= float(cfg.min_trades)),
        ("oos_missing", "oos_profitFactor" in metrics),
        ("oos_trades", float(metrics.get("oos_trades", 0.0)) >= float(cfg.min_oos_trades)),
        ("oos_profit_factor", float(metrics.get("oos_profitFactor", 0.0)) >= float(cfg.min_oos_profit_factor)),
        ("oos_return", float(metrics.get("oos_return_pct", -1e9)) > float(cfg.min_oos_return_pct)),
        ("oos_drawdown", float(metrics.get("oos_maxDDPct", 1e9)) <= float(cfg.max_oos_dd_pct)),
        ("wf_positive_frac", float(metrics.get("wf_positive_frac", 0.0)) >= float(cfg.min_wf_positive_frac)),
        ("wf_active_frac", float(metrics.get("wf_active_frac", 0.0)) >= float(cfg.min_wf_active_frac)),
        ("wf_profit_factor", float(metrics.get("wf_pf_mean", 0.0)) >= float(cfg.min_wf_profit_factor)),
        ("mc_profit_factor", float(metrics.get("mc_pf_mean", 0.0)) >= float(cfg.min_mc_profit_factor)),
    ]
    return [name for name, passed in checks if not passed]


def _annotate_paper_gate_failure_metrics(metrics: dict, failures: list[str]) -> dict:
    failures = [str(name) for name in failures]
    failure_set = set(failures)
    known_names = set(PAPER_GATE_NAMES)
    known_names.add("not_robustly_validated")
    metrics["paper_gate_failure_count"] = float(len(failures))
    for name in sorted(known_names):
        metrics[f"paper_fail_{name}"] = 1.0 if name in failure_set else 0.0
    for name in failures:
        metrics[f"paper_fail_{name}"] = 1.0
    return metrics


def _metric_value(result: dict, key: str, default: float = 0.0) -> float:
    try:
        value = float((result.get("metrics") or {}).get(key, default))
    except (TypeError, ValueError):
        return default
    return value if value == value else default


def _select_validation_candidate_indexes(results: list[dict], validation_count: int) -> set[int]:
    if validation_count <= 0 or not results:
        return set()
    base_count = min(len(results), max(1, int(validation_count)))
    selected: set[int] = set(range(base_count))
    extra_budget = min(len(results) - len(selected), max(0, base_count // 2))
    if extra_budget <= 0:
        return selected

    indexed = list(enumerate(results))
    ranking_specs = (
        ("profitFactor", True),
        ("totalPnl", True),
        ("calmar", True),
        ("consistency", True),
        ("trades", True),
        ("maxDDPct", False),
    )
    cursors = {key: 0 for key, _reverse in ranking_specs}
    rankings = {
        key: sorted(indexed, key=lambda item, metric=key: _metric_value(item[1], metric), reverse=reverse)
        for key, reverse in ranking_specs
    }
    while extra_budget > 0:
        added = False
        for key, _reverse in ranking_specs:
            ranking = rankings[key]
            cursor = cursors[key]
            while cursor < len(ranking) and ranking[cursor][0] in selected:
                cursor += 1
            cursors[key] = cursor
            if cursor >= len(ranking):
                continue
            selected.add(ranking[cursor][0])
            cursors[key] += 1
            extra_budget -= 1
            added = True
            if extra_budget <= 0:
                break
        if not added:
            break
    return selected


def optimize_heaven(config: OptimizationConfig) -> OptimizationResult:
    load_repo_env()
    log = setup_logger()
    t0 = time.time()
    svc_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if not svc_key or not (os.getenv("SUPABASE_URL") or os.getenv("SUPABASE_REST_URL")):
        raise RuntimeError(
            "Supabase is required for Heaven optimization: set SUPABASE_URL "
            "and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)"
        )
    run_type = (os.getenv("HEAVEN_RUN_TYPE") or "NEW").upper()
    if run_type not in {"NEW", "LAB"}:
        raise RuntimeError("HEAVEN_RUN_TYPE must be NEW or LAB")
    from . import supabase_io as sio

    # Seed (env override): HEAVEN_SEED
    try:
        from .utils import seed_everything
        seed_val = int(os.getenv("HEAVEN_SEED")) if os.getenv("HEAVEN_SEED") else None
        s = seed_everything(seed_val)
        log.info(f"Heaven seed: {s}")
    except Exception:
        pass
    sym = config.general.symbol
    tf = config.general.tf_optim
    start_sec, end_sec = epoch_seconds_range(config.general.date_from, config.general.date_to)
    bars_all = cached_fetch_klines_range(sym, tf, start_sec, end_sec, config.resource.cache_dir)
    if len(bars_all) < 100:
        raise RuntimeError("Not enough bars for optimization window")
    bars = bars_all
    eval_end_sec = end_sec
    oos_from_sec = None
    oos_to_sec = None
    if config.validation.oos_split:
        if len(config.validation.oos_split) != 2:
            raise RuntimeError("validation.oos_split must be [holdout_from, holdout_to]")
        oos_from_sec, oos_to_sec = epoch_seconds_range(*config.validation.oos_split)
        if not (start_sec < oos_from_sec < oos_to_sec <= end_sec):
            raise RuntimeError("validation.oos_split must be inside the general date range")
        bars = [bar for bar in bars_all if bar.time < oos_from_sec]
        eval_end_sec = oos_from_sec
        oos_bars = [bar for bar in bars_all if oos_from_sec <= bar.time < oos_to_sec]
        if len(oos_bars) < 50:
            raise RuntimeError("Not enough bars in validation.oos_split holdout window")
    if len(bars) < 100:
        raise RuntimeError("Not enough bars before validation.oos_split for optimization")

    # Helper to evaluate one candidate and return metrics dict only with numbers
    from .scoring import composite_score
    def eval_candidate(cand: dict) -> dict[str, float]:
        cand = normalize_canonical_params(cand)
        # Map entry mode alias
        em = cand.get("entry_mode", "Both")
        em = "Fib" if em in ("Fib Retracement", "Fib") else em
        opts = HeavenOpts(
            nol=int(cand.get("nol")), prd=int(cand.get("prd")), entry_mode=em,
            risk_mgmt=True, risk_max_pct=float(config.backtest.risk_max_pct), leverage=float(config.backtest.leverage), sl_init_pct=float(cand.get("sl_init_pct")),
            be_enable=bool(cand.get("be_enable", True)), be_after_bars=int(cand.get("be_after_bars")), be_lock_pct=float(cand.get("be_lock_pct")),
            ema_len=int(cand.get("ema_len")), tp_types=cand.get("tp_types"), tp_r=cand.get("tp_r"), tp_p=cand.get("tp_p"),
            use_fib_ret=True, confirm_mode="Bounce",
        )
        # Precompute LB/Piv cache
        from .signal_engine import cached_ema_series, cached_lb_piv
        tr, lv, flips, piv = cached_lb_piv(sym, tf, start_sec, eval_end_sec, int(cand.get("nol")), int(cand.get("prd")), config.resource.cache_dir)
        pre = {"lb": (tr, lv, flips), "piv": piv}
        # Precompute EMA only if used
        if any((t == 'EMA' and p > 0) for t, p in zip(cand.get("tp_types", []), cand.get("tp_p", []))):
            pre["ema"] = cached_ema_series(sym, tf, start_sec, eval_end_sec, int(cand.get("ema_len")), config.resource.cache_dir)
        rep_full = backtest_with_bars(opts, bars, 0, len(bars)-1, float(config.backtest.initial_equity), float(config.backtest.fee_pct), precomputed=pre)
        if not rep_full:
            return {"profitFactor": 0.0, "totalPnl": -1e9, "maxDDPct": 100.0}
        rep = rep_full
        # numeric extraction
        metrics_numeric = {
            "totalPnl": float(rep.get("totalPnl", 0.0)),
            "profitFactor": float(rep.get("profitFactor", 0.0)),
            "trades": float(len(rep.get("trades", []))),
            "winrate": float(rep.get("winrate", 0.0)),
            "avgRR": float(rep.get("avgRR", 0.0)) if rep.get("avgRR") is not None else 0.0,
            "sharpe": float(rep.get("sharpe", 0.0)),
            "slope": float(rep.get("slope", 0.0)),
            "r2": float(rep.get("r2", 0.0)),
            "calmar": float(rep.get("calmar", 0.0)),
            "consistency": float(rep.get("consistency", 0.0)),
            "maxDDPct": float(rep.get("maxDDPct", 0.0)),
            "maxDDAbs": float(rep.get("maxDDAbs", 0.0)),
            "equityFinal": float(rep.get("equity", 0.0)),
        }
        metrics_numeric.update(trade_diagnostics(rep.get("trades", []), 0, len(bars) - 1))
        # Penalty if trades below min_trades
        if metrics_numeric["trades"] < float(config.metrics.min_trades):
            metrics_numeric["profitFactor"] *= 0.5
            metrics_numeric["totalPnl"] -= 1e6
        return metrics_numeric

    # Orchestration per mode
    mode = (config.search.mode or "ea_bayesian_hybrid")
    # Base options from backtest cfg
    base_opts = HeavenOpts(
        nol=int((config.ranges.nol_range.min + config.ranges.nol_range.max) // 2),
        prd=int((config.ranges.prd_range.min + config.ranges.prd_range.max) // 2),
        entry_mode=(config.entry_modes[0] if config.entry_modes else "Both").replace("Fib Retracement", "Fib"),
        risk_mgmt=True,
        risk_max_pct=float(config.backtest.risk_max_pct),
        leverage=float(config.backtest.leverage),
        sl_init_pct=float((config.ranges.sl_pct_range.min + config.ranges.sl_pct_range.max) / 2.0),
        be_after_bars=int((config.ranges.be_bars_range.min + config.ranges.be_bars_range.max) // 2),
        be_lock_pct=float((config.ranges.be_lock_pct_range.min + config.ranges.be_lock_pct_range.max) / 2.0),
        ema_len=int((config.ranges.ema_len_range.min + config.ranges.ema_len_range.max) // 2),
    )
    # TP vectors and allocation patterns
    tp_levels = min(3, 10)  # simple default K
    if config.TP.mode == "Fib":
        tp_vectors = generate_tp_fib_combos(config.TP.allowed_ratios or [0.382, 0.5, 0.618], tp_levels, max(1, config.general.max_combinations // 10))
        tp_types = ["Fib"] * 10
    else:
        pmin = float(config.TP.percent_min or 0.5)
        pmax = float(config.TP.percent_max or 5.0)
        pstep = float(config.TP.percent_step or 0.5)
        tp_vectors = generate_tp_percent_combos(pmin, pmax, pstep, tp_levels, max(1, config.general.max_combinations // 10))
        tp_types = ["Percent"] * 10
    alloc_patterns = generate_alloc_patterns(tp_levels, config.TP_allocation.allocation_step_pct, config.TP_allocation.max_patterns)
    # Hyperparam grid (coarse)
    def rng(r):
        x = r.min
        out = []
        while x <= r.max + 1e-12:
            out.append(type(r.min)(x))
            x += r.step
        return out
    nol_list = list({int(x) for x in rng(config.ranges.nol_range)})
    prd_list = list({int(x) for x in rng(config.ranges.prd_range)})
    sl_list = list({float(x) for x in rng(config.ranges.sl_pct_range)})
    beb_list = list({int(x) for x in rng(config.ranges.be_bars_range)})
    bel_list = list({float(x) for x in rng(config.ranges.be_lock_pct_range)})
    be_enable_list = list(dict.fromkeys(bool(x) for x in config.ranges.be_enable_values))
    if not be_enable_list:
        be_enable_list = [True]
    ema_list = list({int(x) for x in rng(config.ranges.ema_len_range)})
    modes = [m.replace("Fib Retracement", "Fib") for m in (config.entry_modes or ["Both"])]
    if mode == "ea_bayesian_hybrid":
        # Build EA space
        from .optimizer_ea import EASpace, run_ea
        space = EASpace(
            nol_list=nol_list, prd_list=prd_list, sl_list=sl_list, beb_list=beb_list, bel_list=bel_list,
            be_enable_list=be_enable_list, ema_list=ema_list, entry_modes=modes, tp_vectors=tp_vectors, alloc_patterns=alloc_patterns,
            tp_type=str(config.TP.mode),
        )
        weights = {
            "pf": float(config.metrics.weights.pf),
            "sharpe": float(config.metrics.weights.sharpe),
            "calmar": float(config.metrics.weights.calmar),
            "dd": float(config.metrics.weights.dd),
            "rr": float(config.metrics.weights.rr),
            "recov": float(config.metrics.weights.recov),
            "cons": float(config.metrics.weights.cons),
            "r2": float(config.metrics.weights.r2),
            "slope": float(config.metrics.weights.slope),
            "robustness": float(config.metrics.robustness_weight),
        }
        seeds = run_ea(
            space,
            weights,
            eval_candidate=eval_candidate,
            pop_size=int(config.EA.pop_size),
            n_generations=int(config.EA.n_generations),
            cx_prob=float(config.EA.cx_prob),
            mut_prob=float(config.EA.mut_prob),
            elitism_frac=float(config.EA.elitism_frac),
            tournament_size=int(config.EA.tournament_size),
            n_jobs=int(config.resource.n_jobs),
            on_progress=(config.on_progress if hasattr(config, 'on_progress') else None),
        )
        # Select top-M seeds by score
        seeds.sort(key=lambda s: -float(s["metrics"].get("score", 0.0)))
        top_m = min(10, 2 * int(config.general.top_n_results))
        seeds = seeds[:top_m]
        # Bayesian refinement
        from .optimizer_bayes import refine_seeds
        global_bounds = {
            "nol": (min(nol_list), max(nol_list)),
            "prd": (min(prd_list), max(prd_list)),
            "sl_init_pct": (min(sl_list), max(sl_list)),
            "be_after_bars": (min(beb_list), max(beb_list)),
            "be_lock_pct": (min(bel_list), max(bel_list)),
            "ema_len": (min(ema_list), max(ema_list)),
        }
        bayes_results = refine_seeds(
            seeds,
            global_bounds,
            weights,
            eval_candidate,
            n_trials=int(config.Bayesian.n_trials),
            sampler=str(config.Bayesian.sampler),
            refine_radius=float(config.Bayesian.refine_radius),
            n_jobs=int(config.resource.n_jobs),
            on_progress=(config.on_progress if hasattr(config, 'on_progress') else None),
        )
        results = seeds + bayes_results
        # proceed to consolidation below
    elif mode == "ml_surrogate":
        # ML surrogate: train on historical evaluations (Supabase if configured), propose candidates, evaluate
        from .data_sources import compute_scores_if_missing, fetch_history_from_supabase
        from .optimizer_ml import propose_with_surrogate
        # Historical data
        weights = {
            "pf": float(config.metrics.weights.pf),
            "sharpe": float(config.metrics.weights.sharpe),
            "calmar": float(config.metrics.weights.calmar),
            "dd": float(config.metrics.weights.dd),
            "rr": float(config.metrics.weights.rr),
            "recov": float(config.metrics.weights.recov),
            "cons": float(config.metrics.weights.cons),
            "r2": float(config.metrics.weights.r2),
            "slope": float(config.metrics.weights.slope),
            "robustness": float(config.metrics.robustness_weight),
        }
        hist_raw = fetch_history_from_supabase(sym, tf, None, max_rows=2000)
        history = compute_scores_if_missing(hist_raw, weights)
        # Bounds by range triplets (min,max,step)
        bounds = {
            "nol": (float(config.ranges.nol_range.min), float(config.ranges.nol_range.max), float(config.ranges.nol_range.step)),
            "prd": (float(config.ranges.prd_range.min), float(config.ranges.prd_range.max), float(config.ranges.prd_range.step)),
            "sl_init_pct": (float(config.ranges.sl_pct_range.min), float(config.ranges.sl_pct_range.max), float(config.ranges.sl_pct_range.step)),
            "be_after_bars": (float(config.ranges.be_bars_range.min), float(config.ranges.be_bars_range.max), float(config.ranges.be_bars_range.step)),
            "be_lock_pct": (float(config.ranges.be_lock_pct_range.min), float(config.ranges.be_lock_pct_range.max), float(config.ranges.be_lock_pct_range.step)),
            "ema_len": (float(config.ranges.ema_len_range.min), float(config.ranges.ema_len_range.max), float(config.ranges.ema_len_range.step)),
        }
        # Suggest
        n_suggest = int(min(config.general.max_combinations, 200))
        suggestions = propose_with_surrogate(
            history,
            bounds,
            modes,
            tp_vectors,
            alloc_patterns,
            be_enable_values=be_enable_list,
            tp_type=str(config.TP.mode),
            n_suggest=n_suggest,
            rng_seed=None,
        )
        # Evaluate suggestions
        from joblib import Parallel, delayed
        n_jobs = int(config.resource.n_jobs)
        mets = Parallel(n_jobs=max(1, n_jobs), prefer="threads")(delayed(eval_candidate)(c) for c in suggestions)
        results = [
            {"params": c, "metrics": m, "provenance": "ML"} for c, m in zip(suggestions, mets)
        ]
    else:
        candidates: list[dict] = []
        # Random sampling to respect max_combinations without materializing the full grid
        maxc = int(config.general.max_combinations)
        seen = set()
        import random
        tries = 0
        while len(candidates) < maxc and tries < maxc * 20:
            tries += 1
            nol = random.choice(nol_list)
            prd = random.choice(prd_list)
            sl = random.choice(sl_list)
            beb = random.choice(beb_list)
            bel = random.choice(bel_list)
            ema = random.choice(ema_list)
            entry_mode = random.choice(modes)
            tpv = random.choice(tp_vectors) if tp_vectors else []
            alloc = random.choice(alloc_patterns) if alloc_patterns else [100.0]
            cand = {
                "nol": int(nol),
                "prd": int(prd),
                "sl_init_pct": float(sl),
                "be_after_bars": int(beb),
                "be_lock_pct": float(bel),
                "be_enable": bool(random.choice(be_enable_list)),
                "ema_len": int(ema),
                "entry_mode": entry_mode,
                "tp_types": tp_types[:],
                "tp_r": list(tpv) + [0.0] * (10 - len(tpv)),
                "tp_p": list(alloc) + [0.0] * (10 - len(alloc)),
            }
            cand = normalize_canonical_params(cand)
            h = sha1_of_params(cand)
            if h in seen:
                continue
            seen.add(h)
            candidates.append(cand)
        log.info(f"Evaluating {len(candidates)} candidates (coarse)")
        # Evaluate in parallel if possible
        from joblib import Parallel, delayed
        n_jobs = int(config.resource.n_jobs)
        mets = Parallel(n_jobs=max(1, n_jobs), prefer="threads")(delayed(eval_candidate)(c) for c in candidates)
        results: list[dict] = [
            {"params": c, "metrics": m, "provenance": "coarse"} for c, m in zip(candidates, mets)
        ]
    # Consolidation & ranking
    results = _dedupe_results_by_params(results)
    from .scoring import robustness_score
    from .validation import evaluate_period, monte_carlo_validate, walk_forward_validate
    weights = {
        "pf": float(config.metrics.weights.pf),
        "sharpe": float(config.metrics.weights.sharpe),
        "calmar": float(config.metrics.weights.calmar),
        "dd": float(config.metrics.weights.dd),
        "rr": float(config.metrics.weights.rr),
        "recov": float(config.metrics.weights.recov),
        "cons": float(config.metrics.weights.cons),
        "r2": float(config.metrics.weights.r2),
        "slope": float(config.metrics.weights.slope),
        "robustness": float(config.metrics.robustness_weight),
    }
    validation_bars = [bar for bar in bars_all if oos_to_sec is None or bar.time < oos_to_sec]
    oos_from_idx = None
    if oos_from_sec is not None:
        oos_from_idx = next(
            (idx for idx, bar in enumerate(validation_bars) if bar.time >= oos_from_sec),
            len(validation_bars),
        )
    for r in results:
        r["metrics"]["score"] = composite_score(r["metrics"], weights)
    results.sort(key=lambda r: -float(r["metrics"].get("score", 0.0)))
    validation_count = min(len(results), max(1, int(config.metrics.validation_top_n)))
    validation_indexes = _select_validation_candidate_indexes(results, validation_count)
    for result_idx, r in enumerate(results):
        if result_idx not in validation_indexes:
            r["metrics"]["robustly_validated"] = 0.0
            r["metrics"]["robustness_score"] = 0.0
            r["metrics"]["paper_eligible"] = 0.0
            r["metrics"]["paper_gate_failures"] = ["not_robustly_validated"]
            _annotate_paper_gate_failure_metrics(r["metrics"], ["not_robustly_validated"])
            continue
        # augment with validation metrics (fast defaults)
        opts = HeavenOpts(
            nol=int(r["params"]["nol"]), prd=int(r["params"]["prd"]), entry_mode=str(r["params"].get("entry_mode","Both")),
            risk_mgmt=True, risk_max_pct=float(config.backtest.risk_max_pct), leverage=float(config.backtest.leverage), sl_init_pct=float(r["params"]["sl_init_pct"]),
            be_enable=bool(r["params"].get("be_enable", True)), be_after_bars=int(r["params"]["be_after_bars"]), be_lock_pct=float(r["params"]["be_lock_pct"]),
            ema_len=int(r["params"]["ema_len"]), tp_types=r["params"].get("tp_types"), tp_r=r["params"].get("tp_r"), tp_p=r["params"].get("tp_p"),
        )
        if not (os.getenv("HEAVEN_NO_WF") == "1"):
            wf_cfg = config.validation.walk_forward
            if wf_cfg:
                wf = walk_forward_validate(
                    bars,
                    opts,
                    duration_days(wf_cfg.train_window),
                    duration_days(wf_cfg.test_window),
                    duration_days(wf_cfg.stride),
                    float(config.backtest.initial_equity),
                    float(config.backtest.fee_pct),
                )
                r["metrics"].update(wf)
            mc = monte_carlo_validate(
                bars,
                opts,
                n=max(1, int(config.validation.monte_carlo_runs)),
                sigma=max(0.0, float(config.validation.monte_carlo_sigma)),
                equity_start=float(config.backtest.initial_equity),
                fee_pct=float(config.backtest.fee_pct),
            )
            r["metrics"].update(mc)
        if oos_from_idx is not None and oos_from_idx < len(validation_bars) - 1:
            r["metrics"].update(
                evaluate_period(
                    validation_bars,
                    opts,
                    oos_from_idx,
                    len(validation_bars) - 1,
                    float(config.backtest.initial_equity),
                    float(config.backtest.fee_pct),
                )
            )
        robust = robustness_score(r["metrics"])
        r["metrics"]["robustly_validated"] = 1.0
        r["metrics"]["robustness_score"] = float(robust or 0.0)
        gate_failures = _paper_gate_failures(r["metrics"], config, r.get("params") or {})
        r["metrics"]["paper_eligible"] = 0.0 if gate_failures else 1.0
        r["metrics"]["paper_gate_failures"] = gate_failures
        _annotate_paper_gate_failure_metrics(r["metrics"], gate_failures)
        r["metrics"]["score"] = composite_score(r["metrics"], weights)

    # Supabase is the only strategy store: persistence failures must fail clearly.
    user_id = os.getenv("HEAVEN_USER_ID")  # optional; leave null if not provided
    profile_id = sio.get_balancee_profile_id(svc_key)
    run_id = str(uuid.uuid4())
    campaign_id = os.getenv("HEAVEN_CAMPAIGN_ID") or None
    run_meta = {
        "run_id": run_id,
        "campaign_id": campaign_id,
        "run_type": run_type,
        "profile": "balancee",
    }
    rc = {
        "mode": str(mode),
        "date_from": str(getattr(config.general, "date_from", "")),
        "date_to": str(getattr(config.general, "date_to", "")),
        "train_date_to": str(config.validation.oos_split[0]) if config.validation.oos_split else str(getattr(config.general, "date_to", "")),
        "oos_split": list(config.validation.oos_split) if config.validation.oos_split else None,
        "seed": os.getenv("HEAVEN_SEED"),
        "ts": time.time(),
        "run_id": run_id,
        "campaign_id": campaign_id,
    }
    rows_all: list[dict] = []
    for r in results:
        rows_all.append({
            **run_meta,
            "user_id": user_id,
            "symbol": sym,
            "tf": tf,
            "profile_id": profile_id,
            "params": r.get("params") or {},
            "metrics": r.get("metrics") or {},
            "score": float((r.get("metrics") or {}).get("score", 0.0)),
            "selected": False,
            "palmares_set_id": None,
            "provenance": r.get("provenance", "coarse"),
            "run_context": rc,
        })
    sio.upsert_strategy_evaluations(rows_all, svc_key)

    # Sort and select top-N
    results.sort(
        key=lambda r: (
            -float(r["metrics"].get("paper_eligible", 0.0)),
            -float(r["metrics"].get("robustly_validated", 0.0)),
            -float(r["metrics"].get("score", 0.0)),
        )
    )
    top_results = results[: int(config.general.top_n_results)]

    # Create palmarès set and reloadable Heaven strategies.
    set_id = None
    if top_results:
        note = os.getenv("HEAVEN_NOTE") or f"{mode} {sym} {tf}"
        set_id = sio.create_palmares_set({
            **run_meta,
            "user_id": user_id,
            "symbol": sym,
            "tf": tf,
            "profile_id": profile_id,
            "top_n": int(config.general.top_n_results),
            "note": note,
        }, svc_key)
        ents = []
        heaven_rows = []
        for rank, r in enumerate(top_results, start=1):
            strat_name = f"{note}-top-{rank}"
            ents.append({
                **run_meta,
                "set_id": set_id,
                "rank": rank,
                "name": strat_name,
                "params": r.get("params") or {},
                "metrics": r.get("metrics") or {},
                "score": float((r.get("metrics") or {}).get("score", 0.0)),
                "provenance": r.get("provenance", "coarse"),
                "generation": 1,
            })
            if float((r.get("metrics") or {}).get("paper_eligible", 0.0)) >= 1.0:
                reload_params = {
                    **(r.get("params") or {}),
                    "risk_mgmt": True,
                    "risk_max_pct": float(config.backtest.risk_max_pct),
                    "leverage": float(config.backtest.leverage),
                }
                heaven_rows.append({
                    "user_id": user_id,
                    "symbol": sym,
                    "tf": tf,
                    "name": strat_name,
                    "params": sio.canonical_params_to_ui_params(reload_params),
                    "metrics": r.get("metrics") or {},
                })
        sio.insert_palmares_entries(ents, svc_key)
        if heaven_rows:
            sio.upsert_heaven_strategies(heaven_rows, svc_key)
        log.info(f"Paper-eligible Heaven strategies: {len(heaven_rows)}/{len(top_results)}")
        rows_sel = [{
            **run_meta,
            "user_id": user_id,
            "symbol": sym,
            "tf": tf,
            "profile_id": profile_id,
            "params": r.get("params") or {},
        } for r in top_results]
        sio.mark_selected_for_set(rows_sel, set_id, svc_key)

    # Build OptimizationResult
    top = []
    for r in top_results:
        rep = r["metrics"]
        metrics_numeric = {k: float(v) for k, v in rep.items() if isinstance(v, (int, float))}
        top.append(Candidate(params=r["params"], metrics=metrics_numeric, provenance=r.get("provenance", "grid")))
    return OptimizationResult(
        top=top,
        logs=[
            f"duration_sec={time.time()-t0:.2f}",
            f"supabase_run_id={run_id}",
            f"supabase_evaluations={len(rows_all)}",
            f"robust_validation_candidates={len(validation_indexes)}",
            f"supabase_palmares_set={set_id or ''}",
        ],
        artifacts_dir=None,
    )
