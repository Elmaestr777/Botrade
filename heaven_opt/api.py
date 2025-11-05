from __future__ import annotations

import os
import time
from pathlib import Path

import yaml

from . import Candidate, OptimizationConfig, OptimizationResult
from .combo_generator import (
    generate_alloc_patterns,
    generate_tp_fib_combos,
    generate_tp_percent_combos,
)
from .data_loader import cached_fetch_klines_range
from .simulator import HeavenOpts, backtest_with_bars
from .utils import epoch_seconds_range, setup_logger, sha1_of_params


def _build_opts_from_candidate(base_opts: HeavenOpts, cand: dict) -> HeavenOpts:
    # Copy and update fields
    o = HeavenOpts(
        nol=cand.get("nol", base_opts.nol),
        prd=cand.get("prd", base_opts.prd),
        entry_mode=cand.get("entry_mode", base_opts.entry_mode),
        risk_mgmt=base_opts.risk_mgmt,
        risk_max_pct=base_opts.risk_max_pct,
        sl_init_pct=cand.get("sl_init_pct", base_opts.sl_init_pct),
        be_enable=True,
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


def optimize_heaven(config: OptimizationConfig) -> OptimizationResult:
    log = setup_logger()
    t0 = time.time()
    # Seed (env override): HEAVEN_SEED
    try:
        from .utils import seed_everything
        seed_val = int(os.getenv("HEAVEN_SEED")) if os.getenv("HEAVEN_SEED") else None
        s = seed_everything(seed_val)
        log.info(f"Heaven seed: {s}")
    except Exception:
        pass
    # Prepare run directory early
    run_dir = Path("runs") / time.strftime("%Y%m%d_%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    sym = config.general.symbol
    tf = config.general.tf_optim
    start_sec, end_sec = epoch_seconds_range(config.general.date_from, config.general.date_to)
    bars = cached_fetch_klines_range(sym, tf, start_sec, end_sec, config.resource.cache_dir)
    if len(bars) < 100:
        raise RuntimeError("Not enough bars for optimization window")

    # Helper to evaluate one candidate and return metrics dict only with numbers
    from .scoring import composite_score
    def eval_candidate(cand: dict) -> dict[str, float]:
        # Map entry mode alias
        em = cand.get("entry_mode", "Both")
        em = "Fib" if em in ("Fib Retracement", "Fib") else em
        opts = HeavenOpts(
            nol=int(cand.get("nol")), prd=int(cand.get("prd")), entry_mode=em,
            risk_mgmt=True, risk_max_pct=float(config.backtest.risk_max_pct), sl_init_pct=float(cand.get("sl_init_pct")),
            be_enable=True, be_after_bars=int(cand.get("be_after_bars")), be_lock_pct=float(cand.get("be_lock_pct")),
            ema_len=int(cand.get("ema_len")), tp_types=cand.get("tp_types"), tp_r=cand.get("tp_r"), tp_p=cand.get("tp_p"),
            use_fib_ret=True, confirm_mode="Bounce",
        )
        # Precompute LB/Piv cache
        from .signal_engine import cached_ema_series, cached_lb_piv
        tr, lv, flips, piv = cached_lb_piv(sym, tf, start_sec, end_sec, int(cand.get("nol")), int(cand.get("prd")), config.resource.cache_dir)
        pre = {"lb": (tr, lv, flips), "piv": piv}
        # Precompute EMA only if used
        if any((t == 'EMA' and p > 0) for t, p in zip(cand.get("tp_types", []), cand.get("tp_p", []))):
            pre["ema"] = cached_ema_series(sym, tf, start_sec, end_sec, int(cand.get("ema_len")), config.resource.cache_dir)
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
            "maxDDPct": float(rep.get("maxDDPct", 0.0)),
            "maxDDAbs": float(rep.get("maxDDAbs", 0.0)),
            "equityFinal": float(rep.get("equity", 0.0)),
        }
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
    ema_list = list({int(x) for x in rng(config.ranges.ema_len_range)})
    modes = [m.replace("Fib Retracement", "Fib") for m in (config.entry_modes or ["Both"])]
    if mode == "ea_bayesian_hybrid":
        # Build EA space
        from .optimizer_ea import EASpace, run_ea
        space = EASpace(
            nol_list=nol_list, prd_list=prd_list, sl_list=sl_list, beb_list=beb_list, bel_list=bel_list,
            ema_list=ema_list, entry_modes=modes, tp_vectors=tp_vectors, alloc_patterns=alloc_patterns,
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
        # Save EA seeds checkpoint
        try:
            (run_dir / "ea_seeds.yaml").write_text(yaml.safe_dump([s["params"] for s in seeds]), encoding="utf-8")
        except Exception:
            pass
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
            mode = random.choice(modes)
            tpv = random.choice(tp_vectors) if tp_vectors else []
            alloc = random.choice(alloc_patterns) if alloc_patterns else [100.0]
            cand = {
                "nol": int(nol),
                "prd": int(prd),
                "sl_init_pct": float(sl),
                "be_after_bars": int(beb),
                "be_lock_pct": float(bel),
                "ema_len": int(ema),
                "entry_mode": mode,
                "tp_types": tp_types[:],
                "tp_r": list(tpv) + [0.0] * (10 - len(tpv)),
                "tp_p": list(alloc) + [0.0] * (10 - len(alloc)),
            }
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
    from .validation import monte_carlo_validate, walk_forward_validate
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
    }
    for r in results:
        # augment with validation metrics (fast defaults)
        opts = HeavenOpts(
            nol=int(r["params"]["nol"]), prd=int(r["params"]["prd"]), entry_mode=str(r["params"].get("entry_mode","Both")),
            risk_mgmt=True, risk_max_pct=float(config.backtest.risk_max_pct), sl_init_pct=float(r["params"]["sl_init_pct"]),
            be_enable=True, be_after_bars=int(r["params"]["be_after_bars"]), be_lock_pct=float(r["params"]["be_lock_pct"]),
            ema_len=int(r["params"]["ema_len"]), tp_types=r["params"].get("tp_types"), tp_r=r["params"].get("tp_r"), tp_p=r["params"].get("tp_p"),
        )
        if not (os.getenv("HEAVEN_NO_WF") == "1"):
            wf = walk_forward_validate(bars, opts, 21, 7, 7, float(config.backtest.initial_equity), float(config.backtest.fee_pct))
            mc = monte_carlo_validate(bars, opts, n=10, sigma=0.001, equity_start=float(config.backtest.initial_equity), fee_pct=float(config.backtest.fee_pct))
            r["metrics"].update(wf)
            r["metrics"].update(mc)
        r["metrics"]["score"] = composite_score(r["metrics"], weights)
    # Sort and select top-N
    results.sort(key=lambda r: -float(r["metrics"].get("score", 0.0)))
    results = results[: config.general.top_n_results]
    # Build OptimizationResult
    top = []
    for r in results:
        rep = r["metrics"]
        metrics_numeric = {k: float(v) for k, v in rep.items() if isinstance(v, (int, float))}
        top.append(Candidate(params=r["params"], metrics=metrics_numeric, provenance=r.get("provenance", "grid")))
    (run_dir / "results.yaml").write_text(yaml.safe_dump({"top": [c.params for c in top]}), encoding="utf-8")
    return OptimizationResult(top=top, logs=[f"duration_sec={time.time()-t0:.2f}"] , artifacts_dir=str(run_dir))
