from __future__ import annotations

from collections.abc import Callable

import optuna

from .scoring import composite_score


def _objective_factory(seed_params: dict, global_bounds: dict[str, tuple], weights: dict[str, float], eval_candidate: Callable[[dict], dict], refine_radius: float):
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
        "sl_init_pct": bound_param("sl_init_pct", float(seed_params["sl_init_pct"]), is_int=False),
        "be_after_bars": bound_param("be_after_bars", int(seed_params["be_after_bars"]), is_int=True),
        "be_lock_pct": bound_param("be_lock_pct", float(seed_params["be_lock_pct"]), is_int=False),
        "ema_len": bound_param("ema_len", int(seed_params["ema_len"]), is_int=True),
    }

    def objective(trial: optuna.Trial) -> float:
        cand = {
            "nol": int(trial.suggest_int("nol", *localspec["nol"])),
            "prd": int(trial.suggest_int("prd", *localspec["prd"])),
            "sl_init_pct": float(trial.suggest_float("sl_init_pct", *localspec["sl_init_pct"], step=0.1)),
            "be_after_bars": int(trial.suggest_int("be_after_bars", *localspec["be_after_bars"])),
            "be_lock_pct": float(trial.suggest_float("be_lock_pct", *localspec["be_lock_pct"], step=0.1)),
            "ema_len": int(trial.suggest_int("ema_len", *localspec["ema_len"])),
            "entry_mode": seed_params.get("entry_mode", "Both"),
            "tp_types": seed_params.get("tp_types", ["Fib"] * 10),
            "tp_r": seed_params.get("tp_r", [0.0] * 10),
            "tp_p": seed_params.get("tp_p", [0.0] * 10),
        }
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
                 on_progress: Callable[[float, str], None] | None = None) -> list[dict]:
    results: list[dict] = []

    def run_one(idx: int, seed: dict) -> list[dict]:
        objective = _objective_factory(seed["params"], global_bounds, weights, eval_candidate, refine_radius)
        sampler_obj = optuna.samplers.TPESampler() if sampler.upper() == "TPE" else optuna.samplers.QMCSampler()
        pruner = optuna.pruners.MedianPruner(n_warmup_steps=5, n_min_trials=10)
        study = optuna.create_study(direction="maximize", sampler=sampler_obj, pruner=pruner)
        # Run trials possibly in parallel (threads). If n_jobs>1, Optuna will schedule concurrently.
        study.optimize(objective, n_trials=n_trials, n_jobs=max(1, int(n_jobs or 1)), show_progress_bar=False)
        out = []
        for t in study.best_trials[:5]:
            params = seed["params"].copy()
            params.update({k: t.params[k] for k in ["nol","prd","sl_init_pct","be_after_bars","be_lock_pct","ema_len"]})
            rep = eval_candidate(params)
            rep["score"] = composite_score(rep, weights)
            out.append({"params": params, "metrics": rep, "provenance": f"Bayesian(seed={idx})"})
        return out

    for i, seed in enumerate(seeds):
        if on_progress:
            on_progress(0.0, f"Bayes seed {i+1}/{len(seeds)}")
        results.extend(run_one(i, seed))
        if on_progress:
            on_progress(((i+1)/max(1,len(seeds)))*100.0, f"Bayes seed {i+1}/{len(seeds)} done")
    return results
