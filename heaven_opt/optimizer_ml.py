from __future__ import annotations

import random
from typing import Any

import numpy as np
from sklearn.ensemble import RandomForestRegressor

from .utils import sha1_of_params


def _features_from_params(p: dict[str, Any]) -> list[float]:
    # Core hyperparams
    nol = float(p.get("nol", 3))
    prd = float(p.get("prd", 15))
    sl = float(p.get("sl_init_pct", 2.0))
    beb = float(p.get("be_after_bars", 5))
    bel = float(p.get("be_lock_pct", 5.0))
    ema = float(p.get("ema_len", 55))
    entry_mode = p.get("entry_mode", "Both")
    em_onehot = [
        1.0 if entry_mode == k else 0.0 for k in ("Original", "Fib", "Both")
    ]
    # TP summary features
    tp_r = p.get("tp_r") or []
    tp_p = p.get("tp_p") or []
    nz = sum(1 for v in tp_p if float(v) > 0)
    avg_r = float(np.mean([float(x) for x in tp_r[:nz]]) if nz > 0 else 0.0)
    sum_p = float(sum(float(x) for x in tp_p))
    return [nol, prd, sl, beb, bel, ema] + em_onehot + [nz, avg_r, sum_p]


def _sample_candidate(bounds: dict[str, tuple[float, float, float]], modes: list[str], tp_vectors: list[list[float]] | None, alloc_patterns: list[list[float]] | None) -> dict[str, Any]:
    def draw_int(lo, hi, step):
        grid = list({int(round(x)) for x in np.arange(lo, hi + 1e-12, step)})
        return int(random.choice(grid))
    def draw_float(lo, hi, step):
        grid = list({float(round(x, 10)) for x in np.arange(lo, hi + 1e-12, step)})
        return float(random.choice(grid))
    nol = draw_int(*bounds["nol"])
    prd = draw_int(*bounds["prd"])
    sl = draw_float(*bounds["sl_init_pct"])
    beb = draw_int(*bounds["be_after_bars"])
    bel = draw_float(*bounds["be_lock_pct"])
    ema = draw_int(*bounds["ema_len"])
    mode = random.choice(modes)
    tpv = random.choice(tp_vectors) if tp_vectors else []
    alloc = random.choice(alloc_patterns) if alloc_patterns else [100.0]
    return {
        "nol": nol,
        "prd": prd,
        "sl_init_pct": sl,
        "be_after_bars": beb,
        "be_lock_pct": bel,
        "ema_len": ema,
        "entry_mode": mode,
        "tp_types": (["Fib"] * 10 if tpv else ["Fib"] * 10),
        "tp_r": list(tpv) + [0.0] * (10 - len(tpv)),
        "tp_p": list(alloc) + [0.0] * (10 - len(alloc)),
    }


def propose_with_surrogate(
    history: list[dict[str, Any]],
    bounds: dict[str, tuple[float, float, float]],
    modes: list[str],
    tp_vectors: list[list[float]] | None,
    alloc_patterns: list[list[float]] | None,
    n_suggest: int = 100,
    pool_size: int = 5000,
    rng_seed: int | None = None,
) -> list[dict[str, Any]]:
    if rng_seed is not None:
        random.seed(rng_seed)
        np.random.seed(rng_seed)
    if len(history) < 10:
        # Not enough data: random suggestions
        seen = set()
        out = []
        while len(out) < n_suggest and len(seen) < pool_size * 2:
            c = _sample_candidate(bounds, modes, tp_vectors, alloc_patterns)
            h = sha1_of_params(c)
            if h in seen:
                continue
            seen.add(h)
            out.append(c)
        return out[:n_suggest]
    X = np.array([_features_from_params(it["params"]) for it in history], dtype=float)
    y = np.array([float(it["score"]) for it in history], dtype=float)
    # Simple robust target transform
    y = np.clip(y, np.percentile(y, 1), np.percentile(y, 99))
    model = RandomForestRegressor(
        n_estimators=300, max_depth=None, min_samples_leaf=2, n_jobs=-1, random_state=rng_seed or 0
    )
    model.fit(X, y)
    # Generate pool
    pool: list[dict[str, Any]] = []
    seen = {sha1_of_params(it["params"]) for it in history}
    tries = 0
    while len(pool) < pool_size and tries < pool_size * 10:
        tries += 1
        c = _sample_candidate(bounds, modes, tp_vectors, alloc_patterns)
        h = sha1_of_params(c)
        if h in seen:
            continue
        seen.add(h)
        pool.append(c)
    if not pool:
        return []
    FX = np.array([_features_from_params(p) for p in pool], dtype=float)
    # Mean prediction and approximate std via tree ensemble
    preds = np.stack([est.predict(FX) for est in model.estimators_], axis=1)
    mu = preds.mean(axis=1)
    sigma = preds.std(axis=1)
    acq = mu + 0.25 * sigma
    idx = np.argsort(-acq)[:n_suggest]
    return [pool[int(i)] for i in idx]