from __future__ import annotations

import math

from joblib import Memory

from . import get_memory
from .data_loader import cached_fetch_klines_range
from .utils import Bar


def ema_series(bars: list[Bar], length: int) -> list[float]:
    k = 2.0 / (length + 1.0)
    out: list[float] = []
    ema = None
    for b in bars:
        v = b.close
        ema = v if ema is None else v * k + ema * (1.0 - k)
        out.append(float(ema))
    return out


def compute_line_break_state(bars: list[Bar], nol: int) -> tuple[list[int], list[float], list[int]]:
    n = len(bars)
    if n == 0:
        return [], [], []
    trend: list[int] = [0] * n
    level: list[float] = [math.nan] * n
    flips: list[int] = []
    t = 1 if bars[0].close >= bars[0].open else -1
    opens: list[float] = [bars[0].open]
    closes: list[float] = [bars[0].close]
    for i in range(n):
        c = bars[i].close
        if t == 1:
            count = min(nol, len(opens))
            min_up = min(opens[:count] + closes[:count])
            if c < min_up:
                t = -1
            if c > closes[0] or t == -1:
                o = opens[0] if t == -1 else closes[0]
                opens.insert(0, o)
                closes.insert(0, c)
        else:
            count = min(nol, len(opens))
            max_dn = max(opens[:count] + closes[:count])
            if c > max_dn:
                t = 1
            if c < closes[0] or t == 1:
                o = opens[0] if t == 1 else closes[0]
                opens.insert(0, o)
                closes.insert(0, c)
        trend[i] = t
        cnt = min(nol, len(opens))
        min_up = min(opens[:cnt] + closes[:cnt])
        max_dn = max(opens[:cnt] + closes[:cnt])
        level[i] = float(min_up if t == 1 else max_dn)
        if i > 0 and trend[i] != trend[i - 1]:
            flips.append(i)
    return trend, level, flips


def compute_pivots(bars: list[Bar], prd: int) -> list[dict[str, float]]:
    piv: list[dict[str, float]] = []
    n = len(bars)
    for i in range(prd, n - prd):
        is_high = True
        is_low = True
        for j in range(1, prd + 1):
            if not (bars[i].high > bars[i - j].high and bars[i].high > bars[i + j].high):
                is_high = False
            if not (bars[i].low < bars[i - j].low and bars[i].low < bars[i + j].low):
                is_low = False
            if not is_high and not is_low:
                break
        if is_high or is_low:
            piv.append({"idx": i, "time": bars[i].time, "price": bars[i].high if is_high else bars[i].low})
    return piv


def last_two_pivots_before(piv: list[dict[str, float]], idx: int):
    b = None
    a = None
    for k in range(len(piv) - 1, -1, -1):
        if piv[k]["idx"] <= idx:
            if b is None:
                b = piv[k]
            else:
                a = piv[k]
                break
    if a and b:
        return {"a": a, "b": b}
    return None


# Disk-cached computation of LB state and pivots keyed by (symbol, tf, time range, params)

def _compute_lb_piv(symbol: str, interval: str, start_sec: int, end_sec: int, nol: int, prd: int, cache_dir: str):
    bars = cached_fetch_klines_range(symbol, interval, start_sec, end_sec, cache_dir)
    trend, level, flips = compute_line_break_state(bars, int(nol))
    piv = compute_pivots(bars, int(prd))
    return trend, level, flips, piv


def cached_lb_piv(symbol: str, interval: str, start_sec: int, end_sec: int, nol: int, prd: int, cache_dir: str):
    mem: Memory = get_memory(cache_dir)
    fn = mem.cache(_compute_lb_piv)
    return fn(symbol, interval, int(start_sec), int(end_sec), int(nol), int(prd), cache_dir)


def _compute_ema(symbol: str, interval: str, start_sec: int, end_sec: int, ema_len: int, cache_dir: str):
    bars = cached_fetch_klines_range(symbol, interval, start_sec, end_sec, cache_dir)
    return ema_series(bars, int(ema_len))


def cached_ema_series(symbol: str, interval: str, start_sec: int, end_sec: int, ema_len: int, cache_dir: str):
    mem: Memory = get_memory(cache_dir)
    fn = mem.cache(_compute_ema)
    return fn(symbol, interval, int(start_sec), int(end_sec), int(ema_len), cache_dir)
