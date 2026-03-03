from __future__ import annotations

import math
import os
import time
import uuid
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


def _sanitize_json_value(v):
    if isinstance(v, float):
        if not math.isfinite(v):
            return None
        return float(v)
    if isinstance(v, dict):
        return {k: _sanitize_json_value(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_sanitize_json_value(x) for x in v]
    return v


def _sanitize_metrics(metrics: dict | None) -> dict:
    raw = metrics or {}
    cleaned = _sanitize_json_value(raw)
    return cleaned if isinstance(cleaned, dict) else {}


def _params_key_local(p: dict | None) -> str:
    import json
    return json.dumps(p or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class PersistencePartialError(RuntimeError):
    pass


def _passes_metric_gates(metrics: dict, config: OptimizationConfig) -> bool:
    pf = float(metrics.get("profitFactor", 0.0) or 0.0)
    pnl = float(metrics.get("totalPnl", 0.0) or 0.0)
    trades = float(metrics.get("trades", 0.0) or 0.0)
    dd_pct = float(metrics.get("maxDDPct", 9999.0) or 9999.0)
    return (
        pf >= float(config.metrics.pf_min)
        and pnl > float(config.metrics.pnl_min)
        and trades >= float(config.metrics.min_trades)
        and dd_pct <= float(config.metrics.max_dd_pct)
    )


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
        trades_count = float(len(rep.get("trades", [])))
        backtest_hours = max((float(end_sec) - float(start_sec)) / 3600.0, 1e-9)
        metrics_numeric = {
            "totalPnl": float(rep.get("totalPnl", 0.0)),
            "profitFactor": float(rep.get("profitFactor", 0.0)),
            "trades": trades_count,
            "tradesPerHour": float(trades_count / backtest_hours) if backtest_hours > 0 else -1.0,
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
    run_id = os.getenv("HEAVEN_RUN_ID") or str(uuid.uuid4())
    campaign_id = os.getenv("HEAVEN_CAMPAIGN_ID") or run_id
    run_type = (os.getenv("HEAVEN_RUN_TYPE") or "NEW").strip().upper()
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

    def _closest_num(value, candidates):
        if not candidates:
            return value
        try:
            return min(candidates, key=lambda x: abs(float(x) - float(value)))
        except Exception:
            return candidates[0]

    def _narrow_list_around_seed(candidates, seed_value, span_steps: int = 1):
        if not candidates:
            return candidates
        sorted_vals = sorted(candidates)
        if seed_value is None:
            return sorted_vals
        center = _closest_num(seed_value, sorted_vals)
        try:
            idx = sorted_vals.index(center)
        except ValueError:
            return sorted_vals
        lo = max(0, idx - max(0, int(span_steps)))
        hi = min(len(sorted_vals), idx + max(0, int(span_steps)) + 1)
        narrowed = sorted_vals[lo:hi]
        return narrowed or sorted_vals

    def _merge_narrowed_from_many(candidates, seed_values, span_steps: int = 1):
        if not candidates:
            return candidates
        merged = set()
        for sv in (seed_values or []):
            narrowed = _narrow_list_around_seed(candidates, sv, span_steps=span_steps)
            for v in narrowed:
                merged.add(v)
        if not merged:
            return sorted(candidates)
        return sorted(merged)

    lab_seed_params_list: list[dict] = []

    # LAB mode semantic: mutate in parallel around top NEW seeds (top by score + top by profit)
    if run_type == "LAB":
        try:
            import heaven_opt.supabase_io as sio
            svc_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or ""
            lab_seed_params_list = []
            if svc_key:
                lab_seed_params_list = sio.get_lab_seed_params(
                    svc_key,
                    symbol=sym,
                    tf=tf,
                    campaign_id=campaign_id,
                    prefer_run_type="NEW",
                    top_n_score=10,
                    top_n_profit=10,
                )
                if not lab_seed_params_list:
                    # fallback: bootstrap LAB from recent TF winners even if campaign has no NEW yet
                    lab_seed_params_list = sio.get_lab_seed_params(
                        svc_key,
                        symbol=sym,
                        tf=tf,
                        campaign_id=None,
                        prefer_run_type="NEW",
                        top_n_score=10,
                        top_n_profit=10,
                    )
            if lab_seed_params_list:
                nol_list = _merge_narrowed_from_many(nol_list, [p.get("nol") for p in lab_seed_params_list], span_steps=1)
                prd_list = _merge_narrowed_from_many(prd_list, [p.get("prd") for p in lab_seed_params_list], span_steps=1)
                sl_list = _merge_narrowed_from_many(sl_list, [p.get("sl_init_pct") for p in lab_seed_params_list], span_steps=1)
                beb_list = _merge_narrowed_from_many(beb_list, [p.get("be_after_bars") for p in lab_seed_params_list], span_steps=1)
                bel_list = _merge_narrowed_from_many(bel_list, [p.get("be_lock_pct") for p in lab_seed_params_list], span_steps=1)
                ema_list = _merge_narrowed_from_many(ema_list, [p.get("ema_len") for p in lab_seed_params_list], span_steps=1)
                mode_set = {
                    str((p or {}).get("entry_mode") or "").replace("Fib Retracement", "Fib")
                    for p in lab_seed_params_list
                }
                mode_set = {m for m in mode_set if m in modes}
                if mode_set:
                    modes = sorted(mode_set)
                log.info(
                    "LAB multi-seed applied: seeds=%s modes=%s (top score+profit)",
                    len(lab_seed_params_list),
                    ",".join(modes) or "N/A",
                )
            else:
                log.info("LAB multi-seed not found; fallback to broad search space")
        except Exception as e:
            log.warning(f"LAB multi-seed apply failed: {e}")

    if mode == "ea_bayesian_hybrid":
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

        lab_isolated = str(os.getenv("HEAVEN_LAB_ISOLATED", "1")).strip().lower() in {"1", "true", "yes", "on"}
        if run_type == "LAB" and lab_isolated and lab_seed_params_list:
            import random
            from joblib import Parallel, delayed
            import heaven_opt.supabase_io as sio

            per_seed_budget = max(10, int(os.getenv("HEAVEN_LAB_PER_SEED_CANDIDATES", "30")))
            span_steps = max(1, int(os.getenv("HEAVEN_LAB_SEED_SPAN_STEPS", "1")))
            avoid_retest = str(os.getenv("HEAVEN_LAB_AVOID_RETEST", "1")).strip().lower() in {"1", "true", "yes", "on"}

            svc_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or ""
            existing_keys = set()
            if avoid_retest and svc_key:
                existing_keys = sio.get_existing_param_keys(
                    svc_key,
                    symbol=sym,
                    tf=tf,
                    campaign_id=None,
                    limit=20000,
                )

            def _sample_branch_candidates(seed_params: dict, budget: int) -> list[dict]:
                local_nol = _narrow_list_around_seed(nol_list, seed_params.get("nol"), span_steps=span_steps)
                local_prd = _narrow_list_around_seed(prd_list, seed_params.get("prd"), span_steps=span_steps)
                local_sl = _narrow_list_around_seed(sl_list, seed_params.get("sl_init_pct"), span_steps=span_steps)
                local_beb = _narrow_list_around_seed(beb_list, seed_params.get("be_after_bars"), span_steps=span_steps)
                local_bel = _narrow_list_around_seed(bel_list, seed_params.get("be_lock_pct"), span_steps=span_steps)
                local_ema = _narrow_list_around_seed(ema_list, seed_params.get("ema_len"), span_steps=span_steps)
                seed_mode = str(seed_params.get("entry_mode") or "").replace("Fib Retracement", "Fib")
                local_modes = [seed_mode] if seed_mode and seed_mode in modes else modes

                out = []
                seen_local = set()
                tries = 0
                while len(out) < budget and tries < budget * 30:
                    tries += 1
                    tpv = random.choice(tp_vectors) if tp_vectors else []
                    alloc = random.choice(alloc_patterns) if alloc_patterns else [100.0]
                    cand = {
                        "nol": int(random.choice(local_nol)),
                        "prd": int(random.choice(local_prd)),
                        "sl_init_pct": float(random.choice(local_sl)),
                        "be_after_bars": int(random.choice(local_beb)),
                        "be_lock_pct": float(random.choice(local_bel)),
                        "ema_len": int(random.choice(local_ema)),
                        "entry_mode": random.choice(local_modes),
                        "tp_types": tp_types[:],
                        "tp_r": list(tpv) + [0.0] * (10 - len(tpv)),
                        "tp_p": list(alloc) + [0.0] * (10 - len(alloc)),
                    }
                    hk = sha1_of_params(cand)
                    if hk in seen_local:
                        continue
                    if avoid_retest and _params_key_local(cand) in existing_keys:
                        continue
                    seen_local.add(hk)
                    out.append(cand)
                return out

            branch_candidates: list[dict] = []
            seen_global = set()
            for idx, seed in enumerate(lab_seed_params_list, start=1):
                for cand in _sample_branch_candidates(seed, per_seed_budget):
                    hk = sha1_of_params(cand)
                    if hk in seen_global:
                        continue
                    seen_global.add(hk)
                    cand["_lab_seed_idx"] = idx
                    branch_candidates.append(cand)

            log.info(
                "LAB isolated branches: seeds=%s per_seed_budget=%s total_candidates=%s",
                len(lab_seed_params_list),
                per_seed_budget,
                len(branch_candidates),
            )

            n_jobs = int(config.resource.n_jobs)
            mets = Parallel(n_jobs=max(1, n_jobs), prefer="threads")(delayed(eval_candidate)(c) for c in branch_candidates)
            results = [
                {
                    "params": {k: v for k, v in c.items() if k != "_lab_seed_idx"},
                    "metrics": m,
                    "provenance": f"LAB_BRANCH_{c.get('_lab_seed_idx', 0)}",
                }
                for c, m in zip(branch_candidates, mets)
            ]
        else:
            # Build EA space
            from .optimizer_ea import EASpace, run_ea
            space = EASpace(
                nol_list=nol_list, prd_list=prd_list, sl_list=sl_list, beb_list=beb_list, bel_list=bel_list,
                ema_list=ema_list, entry_modes=modes, tp_vectors=tp_vectors, alloc_patterns=alloc_patterns,
                tp_mode=str(config.TP.mode),
            )
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
            entry_mode = random.choice(modes)
            tpv = random.choice(tp_vectors) if tp_vectors else []
            alloc = random.choice(alloc_patterns) if alloc_patterns else [100.0]
            cand = {
                "nol": int(nol),
                "prd": int(prd),
                "sl_init_pct": float(sl),
                "be_after_bars": int(beb),
                "be_lock_pct": float(bel),
                "ema_len": int(ema),
                "entry_mode": entry_mode,
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

    # Persist all tested strategies to Supabase (fail-fast on partial persistence)
    from . import supabase_io as sio  # local module
    svc_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    base_ok = bool(svc_key) and bool(os.getenv("SUPABASE_URL") or os.getenv("SUPABASE_REST_URL"))
    profile_name = os.getenv("HEAVEN_PROFILE_NAME", "balancee")
    profile_id = None
    if base_ok and results:
        user_id = os.getenv("HEAVEN_USER_ID")  # optional; leave null if not provided
        profile_id = sio.get_profile_id(svc_key, profile_name)
        # Build run context
        rc = {
            "mode": str(mode),
            "date_from": str(getattr(config.general, "date_from", "")),
            "date_to": str(getattr(config.general, "date_to", "")),
            "seed": os.getenv("HEAVEN_SEED"),
            "ts": time.time(),
            "run_id": run_id,
            "campaign_id": campaign_id,
            "run_type": run_type,
            "profile": profile_name,
        }
        rows_all: list[dict] = []
        for r in list(results):
            rows_all.append({
                "user_id": user_id,
                "symbol": sym,
                "tf": tf,
                "profile_id": profile_id,
                "params": r.get("params") or {},
                "metrics": _sanitize_metrics(r.get("metrics") or {}),
                "score": float((_sanitize_metrics(r.get("metrics") or {})).get("score") or 0.0),
                "selected": False,
                "palmares_set_id": None,
                "provenance": r.get("provenance", "coarse"),
                "run_context": rc,
                "run_id": run_id,
                "campaign_id": campaign_id,
                "run_type": run_type,
                "profile": profile_name,
            })
        p_sum = sio.insert_strategy_evaluations(rows_all, svc_key)
        if p_sum.get("persisted", 0) < p_sum.get("rows_total", 0):
            msg = (
                f"FAILED_PARTIAL strategy_evaluations persisted={p_sum.get('persisted',0)} "
                f"rows_total={p_sum.get('rows_total',0)}"
            )
            log.error(msg)
            raise PersistencePartialError(msg)

    # Metric gates before top selection
    gated_results = [r for r in results if _passes_metric_gates(r.get("metrics") or {}, config)]
    log.info("Metric gates: total=%s passed=%s", len(results), len(gated_results))
    results.sort(key=lambda r: -float(r["metrics"].get("score", 0.0)))
    gated_results.sort(key=lambda r: -float(r["metrics"].get("score", 0.0)))
    top_results = gated_results[: int(config.general.top_n_results)]

    # Create palmarès set and entries
    set_id = None

    def _strategy_name_for_rank(rank: int, params: dict, generation: int = 1) -> str:
        sig = sha1_of_params(params)[:6]
        # Legacy-style human names: random-like dictionary word (FR/ES/PL) + generation + rank + short signature.
        # Deterministic mapping from params hash to keep names stable across re-reads.
        dict_fr = [
            "aurore", "brise", "cascade", "delta", "eclat", "forge", "galaxie", "horizon", "ivoire", "jardin",
            "krypton", "lueur", "mirage", "nebuleuse", "onyx", "prisme", "quartz", "rivage", "sillage", "tempete",
        ]
        dict_es = [
            "amanecer", "brisa", "cumbre", "destello", "esfera", "faro", "gacela", "halcon", "isla", "joya",
            "karma", "lucero", "marea", "nube", "origen", "pulso", "quimera", "rayo", "sendero", "trueno",
        ]
        dict_pl = [
            "zorza", "bryza", "gwiazda", "iskra", "jutrzenka", "kruk", "latarnia", "mewa", "noc", "ognisko",
            "perla", "rzeka", "sokół", "tarcza", "ulica", "wiatr", "zorza2", "zamek", "źródło", "żagiel",
        ]
        pool = dict_fr + dict_es + dict_pl
        idx = int(sig, 16) % len(pool)
        word = pool[idx]
        tf_tag = str(tf).replace('/', '').replace(' ', '').lower()
        return f"{word}-g{int(generation):02d}-{tf_tag}-{sig}"

    persist_empty_set = str(os.getenv("HEAVEN_PERSIST_EMPTY_SET", "0")).strip().lower() in {"1", "true", "yes", "on"}
    can_persist_set = bool(svc_key) and bool(os.getenv("SUPABASE_URL") or os.getenv("SUPABASE_REST_URL"))
    should_create_set = can_persist_set and (bool(top_results) or persist_empty_set)

    # Generation promotion logic for LAB
    generation_for_entries = 1
    if run_type == "LAB" and top_results and can_persist_set:
        try:
            ref = sio.get_reference_top_entry(
                svc_key,
                symbol=sym,
                tf=tf,
                campaign_id=campaign_id,
                run_type="NEW",
            )
            if isinstance(ref, dict):
                ref_gen = int((ref.get("generation") or 1))
                ref_score = float(ref.get("score") or 0.0)
                ref_metrics = (ref.get("metrics") or {}) if isinstance(ref.get("metrics"), dict) else {}
                ref_avgrr = float(ref_metrics.get("avgRR") or 0.0)
                ref_dd = float(ref_metrics.get("maxDDPct") or 9999.0)

                topm = top_results[0].get("metrics") or {}
                new_score = float(topm.get("score") or 0.0)
                new_avgrr = float(topm.get("avgRR") or 0.0)
                new_dd = float(topm.get("maxDDPct") or 9999.0)

                promoted = (new_score > ref_score) and (new_avgrr >= ref_avgrr) and (new_dd <= ref_dd)
                generation_for_entries = (ref_gen + 1) if promoted else ref_gen
                log.info(
                    "LAB promotion check: promoted=%s ref(score=%.4f rr=%.4f dd=%.4f gen=%s) new(score=%.4f rr=%.4f dd=%.4f)",
                    promoted,
                    ref_score,
                    ref_avgrr,
                    ref_dd,
                    ref_gen,
                    new_score,
                    new_avgrr,
                    new_dd,
                )
        except Exception as e:
            log.warning(f"LAB promotion check failed: {e}")

    if should_create_set:
        user_id = os.getenv("HEAVEN_USER_ID")
        note = os.getenv("HEAVEN_NOTE") or f"{mode} {sym} {tf}"
        set_id = sio.create_palmares_set({
            "user_id": user_id,
            "symbol": sym,
            "tf": tf,
            "profile_id": profile_id,
            "top_n": int(config.general.top_n_results),
            "note": note,
            "run_id": run_id,
            "campaign_id": campaign_id,
            "run_type": run_type,
            "profile": profile_name,
        }, svc_key)
        if set_id:
            ents = []
            rank = 1
            for r in top_results:
                params_r = r.get("params") or {}
                ents.append({
                    "set_id": set_id,
                    "rank": rank,
                    "name": _strategy_name_for_rank(rank, params_r, generation_for_entries),
                    "params": params_r,
                    "metrics": _sanitize_metrics(r.get("metrics") or {}),
                    "score": float((_sanitize_metrics(r.get("metrics") or {})).get("score") or 0.0),
                    "provenance": r.get("provenance", "coarse"),
                    "generation": generation_for_entries,
                    "run_id": run_id,
                    "campaign_id": campaign_id,
                    "run_type": run_type,
                    "profile": profile_name,
                })
                rank += 1
            e_sum = sio.insert_palmares_entries(ents, svc_key)
            if e_sum.get("persisted", 0) < e_sum.get("rows_total", 0):
                msg = (
                    f"FAILED_PARTIAL palmares_entries persisted={e_sum.get('persisted',0)} "
                    f"rows_total={e_sum.get('rows_total',0)}"
                )
                log.error(msg)
                raise PersistencePartialError(msg)
            rows_sel = [{
                "user_id": os.getenv("HEAVEN_USER_ID"),
                "symbol": sym,
                "tf": tf,
                "profile_id": profile_id,
                "params": r.get("params") or {},
                "run_id": run_id,
            } for r in top_results]
            s_sum = sio.mark_selected_for_set(rows_sel, set_id, svc_key)
            if s_sum.get("updated", 0) < len(rows_sel):
                msg = (
                    f"FAILED_PARTIAL selected_mark updated={s_sum.get('updated',0)} rows_total={len(rows_sel)}"
                )
                log.error(msg)
                raise PersistencePartialError(msg)

    # Build OptimizationResult
    top = []
    for r in top_results:
        rep = r["metrics"]
        metrics_numeric = {k: float(v) for k, v in rep.items() if isinstance(v, (int, float))}
        top.append(Candidate(params=r["params"], metrics=metrics_numeric, provenance=r.get("provenance", "grid")))
    (run_dir / "results.yaml").write_text(yaml.safe_dump({"top": [c.params for c in top]}), encoding="utf-8")
    return OptimizationResult(top=top, logs=[f"duration_sec={time.time()-t0:.2f}"] , artifacts_dir=str(run_dir))
