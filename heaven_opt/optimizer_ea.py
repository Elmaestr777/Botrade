from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass
from multiprocessing.pool import ThreadPool

from deap import base, creator, tools

from .scoring import composite_score


@dataclass
class EASpace:
    nol_list: list[int]
    prd_list: list[int]
    sl_list: list[float]
    beb_list: list[int]
    bel_list: list[float]
    ema_list: list[int]
    entry_modes: list[str]
    tp_vectors: list[list[float]]
    alloc_patterns: list[list[float]]


def _ind_to_candidate(ind, space: EASpace) -> dict:
    i = 0
    nol = space.nol_list[ind[i]]; i += 1
    prd = space.prd_list[ind[i]]; i += 1
    sl = space.sl_list[ind[i]]; i += 1
    beb = space.beb_list[ind[i]]; i += 1
    bel = space.bel_list[ind[i]]; i += 1
    ema = space.ema_list[ind[i]]; i += 1
    mode = space.entry_modes[ind[i]]; i += 1
    tpv = space.tp_vectors[ind[i]] if space.tp_vectors else [] ; i += 1
    alloc = space.alloc_patterns[ind[i]] if space.alloc_patterns else [100.0]; i += 1
    return {
        "nol": int(nol),
        "prd": int(prd),
        "sl_init_pct": float(sl),
        "be_after_bars": int(beb),
        "be_lock_pct": float(bel),
        "ema_len": int(ema),
        "entry_mode": mode,
        "tp_types": ["Fib"] * 10 if all(x <= 5 for x in tpv) else ["Percent"] * 10,
        "tp_r": list(tpv) + [0.0] * (10 - len(tpv)),
        "tp_p": list(alloc) + [0.0] * (10 - len(alloc)),
    }


def run_ea(space: EASpace,
           weights: dict[str, float],
           eval_candidate: Callable[[dict], dict],
           pop_size: int = 80,
           n_generations: int = 12,
           cx_prob: float = 0.7,
           mut_prob: float = 0.2,
           elitism_frac: float = 0.02,
           tournament_size: int = 3,
           n_jobs: int = 4,
           on_progress: Callable[[float, str], None] | None = None,
           early_stop_patience: int | None = 3,
           early_stop_eps: float = 1e-9) -> list[dict]:
    # Genome: indices into lists
    gene_sizes = [
        len(space.nol_list), len(space.prd_list), len(space.sl_list), len(space.beb_list),
        len(space.bel_list), len(space.ema_list), len(space.entry_modes),
        max(1, len(space.tp_vectors)), max(1, len(space.alloc_patterns)),
    ]
    if not hasattr(creator, "FitnessMax"):
        creator.create("FitnessMax", base.Fitness, weights=(1.0,))
    if not hasattr(creator, "Individual"):
        creator.create("Individual", list, fitness=creator.FitnessMax)
    toolbox = base.Toolbox()
    for gi, gs in enumerate(gene_sizes):
        toolbox.register(f"attr_{gi}", random.randrange, gs)
    def init_ind():
        return creator.Individual([toolbox.__getattribute__(f"attr_{gi}")() for gi in range(len(gene_sizes))])
    toolbox.register("individual", init_ind)
    toolbox.register("population", tools.initRepeat, list, toolbox.individual)

    def mate(ind1, ind2):
        for i in range(len(ind1)):
            if random.random() < 0.5:
                ind1[i], ind2[i] = ind2[i], ind1[i]
        return ind1, ind2
    def mutate(ind):
        i = random.randrange(len(ind))
        ind[i] = random.randrange(gene_sizes[i])
        return (ind,)
    def evaluate(ind):
        cand = _ind_to_candidate(ind, space)
        rep = eval_candidate(cand)
        score = composite_score(rep, weights)
        return (score,)
    toolbox.register("mate", mate)
    toolbox.register("mutate", mutate)
    toolbox.register("select", tools.selTournament, tournsize=tournament_size)
    toolbox.register("evaluate", evaluate)

    # Optional threaded map for Windows-safe parallelism
    pool: ThreadPool | None = None
    if isinstance(n_jobs, int) and n_jobs > 1:
        pool = ThreadPool(processes=n_jobs)
        toolbox.register("map", pool.map)
    else:
        toolbox.register("map", map)

    pop = toolbox.population(n=pop_size)
    hall = tools.HallOfFame(max(1, int(pop_size * elitism_frac)))

    try:
        best_score = float('-inf')
        no_improve = 0
        for gen in range(n_generations):
            # Evaluate fitness (parallel via toolbox.map if pool set)
            invalid = [ind for ind in pop if not ind.fitness.valid]
            if invalid:
                fits = list(toolbox.map(toolbox.evaluate, invalid))
                for ind, fv in zip(invalid, fits):
                    ind.fitness.values = fv
            hall.update(pop)
            # Early stopping on stagnation
            try:
                cur_best = max((ind.fitness.values[0] for ind in pop if ind.fitness.valid), default=float('-inf'))
            except Exception:
                cur_best = float('-inf')
            if cur_best > best_score + early_stop_eps:
                best_score = cur_best
                no_improve = 0
            else:
                no_improve += 1
            if early_stop_patience is not None and no_improve >= early_stop_patience:
                break
            if on_progress:
                on_progress((gen / max(1, n_generations)) * 100.0, f"EA gen {gen}/{n_generations}")
            # Selection
            offspring = toolbox.select(pop, len(pop))
            offspring = list(map(toolbox.clone, offspring))
            # Crossover
            for i in range(1, len(offspring), 2):
                if random.random() < cx_prob:
                    toolbox.mate(offspring[i - 1], offspring[i])
                    del offspring[i - 1].fitness.values
                    del offspring[i].fitness.values
            # Mutation
            for mut in offspring:
                if random.random() < mut_prob:
                    toolbox.mutate(mut)
                    del mut.fitness.values
            pop[:] = offspring
        # Final evaluate
        invalid = [ind for ind in pop if not ind.fitness.valid]
        if invalid:
            fits = list(toolbox.map(toolbox.evaluate, invalid))
            for ind, fv in zip(invalid, fits):
                ind.fitness.values = fv
        hall.update(pop)
    finally:
        if pool is not None:
            pool.close()
            pool.join()
    # Build seeds
    seeds: list[dict] = []
    for ind in tools.selBest(pop, k=min(len(pop), 50)):
        cand = _ind_to_candidate(ind, space)
        rep = eval_candidate(cand)
        rep["score"] = composite_score(rep, weights)
        seeds.append({"params": cand, "metrics": rep, "provenance": "EA"})
    # Deduplicate by params
    seen = set()
    unique = []
    for s in seeds:
        key = tuple(sorted((k, tuple(v) if isinstance(v, list) else v) for k, v in s["params"].items()))
        if key in seen:
            continue
        seen.add(key)
        unique.append(s)
    return unique
