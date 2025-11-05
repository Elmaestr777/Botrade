from __future__ import annotations

import itertools
import random


def _normalize_alloc_to_step(vec: list[float], step: int = 5) -> list[float]:
    # Quantize to multiples of step, sum to 100
    s_units = max(1, int(100 / step))
    units = [max(0, int(round((x / 100.0) * s_units))) for x in vec]
    tot = sum(units)
    if tot == 0:
        units[0] = s_units
        tot = s_units
    while tot > s_units:
        i = units.index(max(units))
        units[i] -= 1
        tot -= 1
    while tot < s_units:
        i = units.index(min(units))
        units[i] += 1
        tot += 1
    return [u * step for u in units]


def generate_alloc_patterns(k: int, step: int = 5, max_patterns: int = 8) -> list[list[float]]:
    out: list[list[float]] = []
    # equal
    out.append(_normalize_alloc_to_step([100.0 / k] * k, step))
    # front/back heavy
    w_up = [i + 1 for i in range(k)]
    w_dn = [k - i for i in range(k)]
    def scale(ws: list[int]) -> list[float]:
        s = float(sum(ws))
        return [100.0 * (x / s) for x in ws]
    out.append(_normalize_alloc_to_step(scale(w_up), step))
    out.append(_normalize_alloc_to_step(scale(w_dn), step))
    # random partitions
    s_units = max(1, int(100 / step))
    seen = set(
        ",".join(str(int(x)) for x in p) for p in out
    )
    tries = 0
    while len(out) < max_patterns and tries < max_patterns * 5:
        tries += 1
        cuts = sorted(set(random.randrange(1, s_units) for _ in range(max(0, k - 1))))
        seq = [0] + cuts + [s_units]
        parts = [seq[i + 1] - seq[i] for i in range(len(seq) - 1)]
        patt = [p * step for p in parts]
        key = ",".join(str(int(x)) for x in patt)
        if key not in seen:
            seen.add(key)
            out.append(patt)
    return out[:max_patterns]


def generate_tp_fib_combos(allowed: list[float], k: int, limit: int) -> list[list[float]]:
    allowed = sorted(set(float(x) for x in allowed))
    combos = list(itertools.combinations(allowed, k))
    if limit and len(combos) > limit:
        random.shuffle(combos)
        combos = combos[:limit]
    return [list(c) for c in combos]


def generate_tp_percent_combos(pmin: float, pmax: float, pstep: float, k: int, limit: int) -> list[list[float]]:
    grid = []
    x = float(pmin)
    while x <= pmax + 1e-12:
        if x > 0:
            grid.append(float(round(x, 10)))
        x += pstep
    grid = sorted(set(grid))
    combos = list(itertools.combinations(grid, k))
    if limit and len(combos) > limit:
        random.shuffle(combos)
        combos = combos[:limit]
    return [list(c) for c in combos]


def cap_max_combinations(candidates: list[dict], max_combinations: int) -> list[dict]:
    if len(candidates) <= max_combinations:
        return candidates
    # stratified-ish sampling by hashing
    step = max(1, len(candidates) // max_combinations)
    sampled = []
    for i, c in enumerate(candidates):
        if i % step == 0:
            sampled.append(c)
        if len(sampled) >= max_combinations:
            break
    return sampled
