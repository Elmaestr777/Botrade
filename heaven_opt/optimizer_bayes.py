from __future__ import annotations

import math
import time
from collections.abc import Callable

import optuna
from optuna.trial import FrozenTrial, TrialState

from .params import normalize_canonical_params
from .scoring import composite_score


def _snap_float_bounds(bounds: tuple[float, float], step: float) -> tuple[float, float]:
    lo, hi = (round(float(bounds[0]), 6), round(float(bounds[1]), 6))
    if step <= 0.0 or hi <= lo:
        return (float(lo), float(hi))
    steps = max(0, int(math.floor(((hi - lo) / step) + 1e-9)))
    return (float(lo), float(round(lo + steps * step, 6)))


def _top_complete_trials(study: optuna.Study, limit: int = 5) -> list[FrozenTrial]:
    completed = [
        trial
        for trial in study.trials
        if trial.state == TrialState.COMPLETE and trial.value is not None
    ]
    completed.sort(key=lambda trial: float(trial.value), reverse=True)
    return completed[: max(1, int(limit))]


def _objective_factory(seed_params: dict, global_bounds: dict[str, tuple], weights: dict[str, float], eval_candidate: Callable[[dict], dict], refine_radius: float):
    seed_params = normalize_canonical_params(seed_params)
    # Define local bounds around seed
    def bound_param(name: str, seed_val, is_int=False):
        gmin, gmax = global_bounds[name]
        if isinstance(seed_val, (int, float)) and seed_val != 0:
            span = abs(seed_val) * refine_radius
        else:
            span = (gmax - gmin) * refine_radius
        lo = max(gmin, seed_val - span)
        hi = min(gmax, seed_val + span)
        return (int(lo), int(hi)) if is_int else (float(lo), float(hi))

    localspec = {
        "nol": bound_param("nol", int(seed_params["nol"]), is_int=True),
        "prd": bound_param("prd", int(seed_params["prd"]), is_int=True),
        "sl_init_pct": _snap_float_bounds(bound_param("sl_init_pct", float(seed_params["sl_init_pct"]), is_int=False), 0.1),
        "be_after_bars": bound_param("be_after_bars", int(seed_params["be_after_bars"]), is_int=True),
        "be_lock_pct": _snap_float_bounds(bound_param("be_lock_pct", float(seed_params["be_lock_pct"]), is_int=False), 0.1),
        "ema_len": bound_param("ema_len", int(seed_params["ema_len"]), is_int=True),
    }

    def objective(trial: optuna.Trial) -> float:
        cand = {
            "nol": int(trial.suggest_int("nol", *localspec["nol"])),
            "prd": int(trial.suggest_int("prd", *localspec["prd"])),
            "sl_init_pct": float(trial.suggest_float("sl_init_pct", *localspec["sl_init_pct"], step=0.1)),
            "be_enable": bool(seed_params.get("be_enable", True)),
            "be_after_bars": int(trial.suggest_int("be_after_bars", *localspec["be_after_bars"])),
            "be_lock_pct": float(trial.suggest_float("be_lock_pct", *localspec["be_lock_pct"], step=0.1)),
            "ema_len": int(trial.suggest_int("ema_len", *localspec["ema_len"])),
            "entry_mode": seed_params.get("entry_mode", "Both"),
            "tp_types": seed_params.get("tp_types", ["Fib"] * 10),
            "tp_r": seed_params.get("tp_r", [0.0] * 10),
            "tp_p": seed_params.get("tp_p", [0.0] * 10),
        }
        cand = normalize_canonical_params(cand)
        rep = eval_candidate(cand)
        score = composite_score(rep, weights)
        return score

    return objective


def refine_seeds(seeds: list[dict],
                 global_bounds: dict[str, tuple],
                 weights: dict[str, float],
                 eval_candidate: Callable[[dict], dict],
                 n_trials: int = 20,
                 sampler: str = "TPE",
                 refine_radius: float = 0.2,
                 n_jobs: int = 4,
                 on_progress: Callable[[float, str], None] | None = None,
                 deadline_time: float | None = None) -> list[dict]:
    results: list[dict] = []

    def run_one(idx: int, seed: dict) -> list[dict]:
        objective = _objective_factory(seed["params"], global_bounds, weights, eval_candidate, refine_radius)
        def timed_objective(trial: optuna.Trial) -> float:
            if deadline_time is not None and time.time() >= deadline_time:
                raise optuna.TrialPruned("Heaven time budget reached")
            return objective(trial)

        sampler_obj = optuna.samplers.TPESampler() if sampler.upper() == "TPE" else optuna.samplers.QMCSampler()
        pruner = optuna.pruners.MedianPruner(n_warmup_steps=5, n_min_trials=10)
        study = optuna.create_study(direction="maximize", sampler=sampler_obj, pruner=pruner)
        # Run trials possibly in parallel (threads). If n_jobs>1, Optuna will schedule concurrently.
        study.optimize(timed_objective, n_trials=n_trials, n_jobs=max(1, int(n_jobs or 1)), show_progress_bar=False)
        out = []
        seen: set[tuple[tuple[str, object], ...]] = set()
        for t in _top_complete_trials(study, limit=5):
            params = normalize_canonical_params(seed["params"].copy())
            params.update({k: t.params[k] for k in ["nol","prd","sl_init_pct","be_after_bars","be_lock_pct","ema_len"]})
            params = normalize_canonical_params(params)
            key = tuple(sorted((k, tuple(v) if isinstance(v, list) else v) for k, v in params.items()))
            if key in seen:
                continue
            seen.add(key)
            rep = eval_candidate(params)
            rep["score"] = composite_score(rep, weights)
            out.append({"params": params, "metrics": rep, "provenance": f"Bayesian(seed={idx})"})
        return out

    for i, seed in enumerate(seeds):
        if deadline_time is not None and time.time() >= deadline_time:
            break
        if on_progress:
            on_progress(0.0, f"Bayes seed {i+1}/{len(seeds)}")
        results.extend(run_one(i, seed))
        if on_progress:
            on_progress(((i+1)/max(1,len(seeds)))*100.0, f"Bayes seed {i+1}/{len(seeds)} done")
    return results
