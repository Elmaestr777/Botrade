from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

import numpy as np
import pandas as pd
from joblib import Memory, Parallel, delayed
from pydantic import BaseModel, Field, field_validator

# ========= Config models =========

class Range(BaseModel):
    min: float
    max: float
    step: float

    @classmethod
    def from_list(cls, lst: list[float]) -> Range:
        assert len(lst) == 3, "range must be [min,max,step]"
        return cls(min=float(lst[0]), max=float(lst[1]), step=float(lst[2]))

class GeneralCfg(BaseModel):
    symbol: str
    tf_optim: Literal["1m","5m","15m","1h","4h","1d"]
    date_from: str
    date_to: str
    max_combinations: int = 1000
    top_n_results: int = 20

class SearchCfg(BaseModel):
    mode: Literal["grid","random","ea_bayesian_hybrid","ml_surrogate"] = "ea_bayesian_hybrid"

class RangesCfg(BaseModel):
    nol_range: Range
    prd_range: Range
    sl_pct_range: Range
    be_bars_range: Range
    be_lock_pct_range: Range
    ema_len_range: Range

class TPAllocCfg(BaseModel):
    allocation_step_pct: int = 5
    max_patterns: int = 8
    allowed_patterns: list[Literal["equal","front","back","random"]] = ["equal","front","back","random"]

class TPCfg(BaseModel):
    mode: Literal["Fib","Percent"] = "Fib"
    allowed_ratios: list[float] | None = None
    percent_min: float | None = None
    percent_max: float | None = None
    percent_step: float | None = None

class EACfg(BaseModel):
    pop_size: int = 200
    n_generations: int = 40
    cx_prob: float = 0.7
    mut_prob: float = 0.2
    elitism_frac: float = 0.02
    tournament_size: int = 3

class BayesianCfg(BaseModel):
    n_trials: int = 40
    sampler: Literal["TPE","Gaussian"] = "TPE"
    refine_radius: float = 0.2

class BacktestCfg(BaseModel):
    initial_equity: float = 10000.0
    fee_pct: float = 0.10
    leverage: float = 1.0
    risk_max_pct: float = 1.0

class WalkForwardCfg(BaseModel):
    train_window: str = "21d"
    test_window: str = "7d"
    stride: str = "7d"

class ValidationCfg(BaseModel):
    walk_forward: WalkForwardCfg | None = None
    oos_split: list[str] | None = None

class ResourceCfg(BaseModel):
    n_jobs: int = 4
    cache_dir: str = ".cache_heaven"

class MetricsWeights(BaseModel):
    pf: float = 0.24
    sharpe: float = 0.18
    calmar: float = 0.14
    dd: float = 0.12
    rr: float = 0.12
    recov: float = 0.08
    cons: float = 0.06
    r2: float = 0.04
    slope: float = 0.02

class MetricsCfg(BaseModel):
    weights: MetricsWeights = Field(default_factory=MetricsWeights)
    min_trades: int = 30
    penalize_complexity: bool = True

class OptimizationConfig(BaseModel):
    general: GeneralCfg
    search: SearchCfg
    ranges: RangesCfg
    entry_modes: list[Literal["Original","Fib","Both"]]
    TP: TPCfg
    TP_allocation: TPAllocCfg
    EA: EACfg
    Bayesian: BayesianCfg
    backtest: BacktestCfg
    validation: ValidationCfg = Field(default_factory=ValidationCfg)
    resource: ResourceCfg = Field(default_factory=ResourceCfg)
    metrics: MetricsCfg = Field(default_factory=MetricsCfg)

    # Optional callbacks (not serialized)
    on_progress: Callable[[float, str], None] | None = Field(default=None, exclude=True)
    on_candidate: Callable[[dict, str], None] | None = Field(default=None, exclude=True)

class Candidate(BaseModel):
    params: dict[str, Any]
    metrics: dict[str, float]
    provenance: str = "grid"

class OptimizationResult(BaseModel):
    top: list[Candidate]
    logs: list[str] = []
    artifacts_dir: str | None = None

# ========= Helpers =========

def num_range(r: Range, as_int: bool) -> list[float]:
    vals = []
    x = r.min
    while x <= r.max + 1e-12:
        vals.append(int(round(x))) if as_int else vals.append(float(x))
        x += r.step
    return vals

# disk cache
_memory: Memory | None = None

def get_memory(cache_dir: str) -> Memory:
    global _memory
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    if _memory is None or _memory.store_backend.location != os.path.abspath(cache_dir):
        _memory = Memory(location=cache_dir, verbose=0)
    return _memory
