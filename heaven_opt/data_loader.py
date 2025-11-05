from __future__ import annotations

import requests
from joblib import Memory

from . import get_memory
from .utils import Bar

BASE = "https://api.binance.com/api/v3/klines"


def _fetch_batch(symbol: str, interval: str, limit: int = 1000, end_time_ms: int | None = None) -> list[Bar]:
    params = {"symbol": symbol, "interval": interval, "limit": str(limit)}
    if end_time_ms is not None:
        params["endTime"] = str(end_time_ms)
    r = requests.get(BASE, params=params, timeout=30)
    r.raise_for_status()
    raw = r.json()
    out: list[Bar] = []
    for k in raw:
        t = int(k[0] // 1000)
        out.append(Bar(time=t, open=float(k[1]), high=float(k[2]), low=float(k[3]), close=float(k[4])))
    # ensure ascending by time
    out.sort(key=lambda b: b.time)
    return out


def fetch_klines_range(symbol: str, interval: str, start_sec: int, end_sec: int, hard_cap: int = 400000) -> list[Bar]:
    out: list[Bar] = []
    cursor = int(end_sec * 1000)
    while cursor > start_sec * 1000 and len(out) < hard_cap:
        need = min(1000, hard_cap - len(out))
        batch = _fetch_batch(symbol, interval, limit=need, end_time_ms=cursor)
        if not batch:
            break
        # keep only strictly older than current earliest
        earliest = out[0].time if out else float("inf")
        filtered = [b for b in batch if b.time < earliest and b.time >= start_sec]
        if not filtered:
            break
        out = filtered + out
        cursor = filtered[0].time * 1000 - 1
        if len(batch) < need:
            break
    return out


def cached_fetch_klines_range(symbol: str, interval: str, start_sec: int, end_sec: int, cache_dir: str) -> list[Bar]:
    mem: Memory = get_memory(cache_dir)
    fn = mem.cache(fetch_klines_range)
    return fn(symbol, interval, start_sec, end_sec)
