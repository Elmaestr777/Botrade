from run_optimize import _runtime_risk_gate_errors


def _base_cfg(symbol: str = "BTCUSDC") -> dict:
    return {
        "general": {
            "symbol": symbol,
            "tf_optim": "1h",
            "date_from": "2024-01-01T00:00:00Z",
            "date_to": "2024-02-01T00:00:00Z",
        },
        "ranges": {
            "nol_range": {"min": 2, "max": 6, "step": 1},
            "prd_range": {"min": 8, "max": 34, "step": 2},
            "sl_pct_range": {"min": 0.5, "max": 3.0, "step": 0.5},
            "be_bars_range": {"min": 3, "max": 8, "step": 1},
            "be_lock_pct_range": {"min": 3.0, "max": 10.0, "step": 1.0},
            "ema_len_range": {"min": 21, "max": 89, "step": 4},
        },
        "backtest": {
            "risk_max_pct": 1.0,
            "max_daily_drawdown_pct": 4.0,
            "max_rolling_drawdown_pct": 8.0,
        },
        "TP": {"mode": "Fib", "allowed_ratios": [0.382, 0.618, 1.0]},
    }


def test_runtime_risk_gate_accepts_btc_config():
    errs = _runtime_risk_gate_errors(_base_cfg())
    assert errs == []


def test_runtime_risk_gate_rejects_non_btc_symbol():
    errs = _runtime_risk_gate_errors(_base_cfg(symbol="ETHUSDC"))
    assert any("BTC uniquement" in e for e in errs)


def test_runtime_risk_gate_rejects_invalid_risk_bounds():
    cfg = _base_cfg()
    cfg["backtest"]["risk_max_pct"] = 5.0
    errs = _runtime_risk_gate_errors(cfg)
    assert any("risk_max_pct" in e for e in errs)


def test_runtime_risk_gate_rejects_missing_drawdown_killswitch_fields():
    cfg = _base_cfg()
    cfg["backtest"].pop("max_daily_drawdown_pct", None)
    cfg["backtest"].pop("max_rolling_drawdown_pct", None)
    errs = _runtime_risk_gate_errors(cfg)
    assert any("max_daily_drawdown_pct" in e for e in errs)
    assert any("max_rolling_drawdown_pct" in e for e in errs)


def test_runtime_risk_gate_rejects_daily_dd_above_rolling_dd():
    cfg = _base_cfg()
    cfg["backtest"]["max_daily_drawdown_pct"] = 9.0
    cfg["backtest"]["max_rolling_drawdown_pct"] = 6.0
    errs = _runtime_risk_gate_errors(cfg)
    assert any("ne peut pas dépasser" in e for e in errs)
