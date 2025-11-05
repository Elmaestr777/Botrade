import hashlib
import logging
import os
import random
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np


def setup_logger(name: str = "heaven_opt", level: int = logging.INFO) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        logger.setLevel(level)
        ch = logging.StreamHandler()
        ch.setLevel(level)
        fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
        ch.setFormatter(fmt)
        logger.addHandler(ch)
    return logger


def iso_to_epoch_seconds(iso: str) -> int:
    # Accept 'YYYY-mm-ddTHH:MM:SSZ' or any ISO-like string
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return int(dt.timestamp())


def epoch_seconds_range(date_from: str, date_to: str) -> tuple[int, int]:
    return iso_to_epoch_seconds(date_from), iso_to_epoch_seconds(date_to)


def sha1_of_params(obj: Any) -> str:
    def normalize(o: Any) -> Any:
        if isinstance(o, dict):
            return {k: normalize(o[k]) for k in sorted(o)}
        if isinstance(o, (list, tuple)):
            return [normalize(x) for x in o]
        if isinstance(o, float):
            # reduce float noise
            return float(f"{o:.10g}")
        return o

    s = repr(normalize(obj)).encode("utf-8")
    return hashlib.sha1(s).hexdigest()


@dataclass
class Bar:
    time: int
    open: float
    high: float
    low: float
    close: float


def seed_everything(seed: int | None = None) -> int:
    if seed is None:
        seed = int.from_bytes(os.urandom(4), "little")
    random.seed(seed)
    np.random.seed(seed)
    try:
        import optuna  # type: ignore

        optuna.logging.set_verbosity(optuna.logging.WARNING)
        # No global seed setter; handled per study/sampler
    except Exception:
        pass
    return seed
