from heaven_opt import MetricsCfg, OptimizationConfig
from heaven_opt.api import _passes_metric_gates
from heaven_opt.simulator import max_drawdown_abs_from_equity


def _mk_cfg() -> OptimizationConfig:
    return OptimizationConfig.model_validate({
        "general": {"symbol": "BTCUSDT", "tf_optim": "1m", "date_from": "2026-01-01T00:00:00Z", "date_to": "2026-01-02T00:00:00Z"},
        "search": {"mode": "random"},
        "ranges": {
            "nol_range": {"min": 3, "max": 3, "step": 1},
            "prd_range": {"min": 15, "max": 15, "step": 1},
            "sl_pct_range": {"min": 1, "max": 1, "step": 1},
            "be_bars_range": {"min": 3, "max": 3, "step": 1},
            "be_lock_pct_range": {"min": 5, "max": 5, "step": 1},
            "ema_len_range": {"min": 21, "max": 21, "step": 1},
        },
        "entry_modes": ["Both"],
        "TP": {"mode": "Fib"},
        "TP_allocation": {"allocation_step_pct": 5, "max_patterns": 3},
        "EA": {},
        "Bayesian": {},
        "backtest": {},
        "validation": {},
        "resource": {},
        "metrics": MetricsCfg().model_dump(),
    })


def test_metric_gates_enforced():
    cfg = _mk_cfg()
    ok = {"profitFactor": 1.2, "totalPnl": 10, "trades": 40, "maxDDPct": 20}
    bad_pf = {"profitFactor": 0.9, "totalPnl": 10, "trades": 40, "maxDDPct": 20}
    bad_dd = {"profitFactor": 1.2, "totalPnl": 10, "trades": 40, "maxDDPct": 80}
    assert _passes_metric_gates(ok, cfg)
    assert not _passes_metric_gates(bad_pf, cfg)
    assert not _passes_metric_gates(bad_dd, cfg)


def test_max_dd_abs_peak_to_trough():
    # Old implementation used max(eq)-min(eq) => 130-100=30 (incorrect here)
    # Correct peak-to-trough max DD is 120->110 = 10.
    eq = [100.0, 120.0, 110.0, 130.0]
    assert max_drawdown_abs_from_equity(eq) == 10.0
