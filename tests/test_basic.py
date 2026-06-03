
import pytest

from heaven_opt import api, simulator, supabase_io
from heaven_opt.combo_generator import generate_alloc_patterns
from heaven_opt.scoring import composite_score
from heaven_opt.simulator import HeavenOpts, simulate_trade_from_signal
from heaven_opt.supabase_io import SupabasePersistenceError, canonical_params_to_ui_params
from heaven_opt.utils import Bar


def test_allocation_normalization_quantization():
    k = 3
    for _ in range(20):
        pats = generate_alloc_patterns(k, step=5, max_patterns=5)
        assert len(pats) >= 3
        for p in pats:
            assert len(p) == k
            assert sum(p) == 100
            for x in p:
                assert int(x) % 5 == 0


def test_ema_tp_respects_its_allocation_with_precomputed_series():
    bars = [Bar(time=1, open=100.0, high=110.0, low=99.0, close=106.0)]
    opts = HeavenOpts(
        risk_mgmt=True,
        risk_max_pct=1.0,
        sl_init_pct=2.0,
        be_enable=False,
        tp_types=["EMA", "Percent"] + ["Fib"] * 8,
        tp_r=[0.0, 50.0] + [0.0] * 8,
        tp_p=[25.0, 75.0] + [0.0] * 8,
    )

    result = simulate_trade_from_signal(
        {"idx": 0, "dir": "long", "type": "LB"},
        0,
        [],
        opts,
        equity=10_000.0,
        fee_pct=0.0,
        equity_start=10_000.0,
        bars=bars,
        precomputed={"ema": [105.0]},
    )

    assert result is not None
    assert result["fills"][0]["kind"] == "TP1"
    assert result["fills"][0]["qty"] == 12.5
    assert result["fills"][1]["kind"] == "Close"
    assert result["fills"][1]["qty"] == 37.5


def test_fib_tp_uses_extension_from_last_pivot():
    bars = [
        Bar(time=1, open=100.0, high=100.0, low=99.0, close=100.0),
        Bar(time=2, open=100.0, high=131.0, low=99.0, close=125.0),
    ]
    opts = HeavenOpts(
        risk_mgmt=True,
        risk_max_pct=1.0,
        sl_init_pct=2.0,
        be_enable=False,
        tp_types=["Fib"] * 10,
        tp_r=[0.5] + [0.0] * 9,
        tp_p=[100.0] + [0.0] * 9,
    )

    result = simulate_trade_from_signal(
        {"idx": 1, "dir": "long", "type": "LB"},
        1,
        [{"idx": 0, "price": 80.0}, {"idx": 0, "price": 100.0}],
        opts,
        equity=10_000.0,
        fee_pct=0.0,
        equity_start=10_000.0,
        bars=bars,
    )

    assert result is not None
    assert result["fills"][0]["price"] == 110.0
    assert result["reason"] == "TP"


def test_break_even_waits_for_the_configured_move_threshold():
    bars = [
        Bar(time=1, open=100.0, high=104.0, low=99.0, close=103.0),
        Bar(time=2, open=103.0, high=104.0, low=99.0, close=101.0),
    ]
    opts = HeavenOpts(
        risk_mgmt=True,
        risk_max_pct=1.0,
        sl_init_pct=2.0,
        be_enable=True,
        be_after_bars=1,
        be_lock_pct=5.0,
        tp_enable=False,
        tp_p=[0.0] * 10,
    )

    result = simulate_trade_from_signal(
        {"idx": 0, "dir": "long", "type": "LB"},
        1,
        [],
        opts,
        equity=10_000.0,
        fee_pct=0.0,
        equity_start=10_000.0,
        bars=bars,
    )

    assert result is not None
    assert result["reason"] == "Close"
    assert result["exitPrice"] == 101.0


def test_canonical_params_convert_to_reloadable_ui_shape():
    ui = canonical_params_to_ui_params(
        {
            "nol": 4,
            "prd": 18,
            "sl_init_pct": 1.5,
            "be_after_bars": 4,
            "be_lock_pct": 6.0,
            "ema_len": 55,
            "entry_mode": "Fib",
            "tp_types": ["Fib", "Percent", "EMA"],
            "tp_r": [0.382, 2.0, 0.0],
            "tp_p": [40.0, 35.0, 25.0],
        }
    )

    assert ui["entryMode"] == "Fib Retracement"
    assert ui["slInitPct"] == 1.5
    assert [tp["type"] for tp in ui["tp"]] == ["Fib", "Percent", "EMA"]
    assert ui["tp"][2]["emaLen"] == 55


def test_composite_score_uses_consistency_weight():
    score = composite_score({"consistency": 0.75}, {"cons": 1.0})

    assert score == 0.75


def test_backtest_reports_consistency_and_peak_to_trough_drawdown(monkeypatch):
    bars = [
        Bar(time=1, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=2, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=3, open=100.0, high=101.0, low=99.0, close=100.0),
    ]
    pnls = iter([-10.0, 20.0, -5.0])
    monkeypatch.setattr(
        simulator,
        "generate_heaven_signals",
        lambda opts, bars, precomputed=None: [
            {"idx": 0, "dir": "long", "type": "LB"},
            {"idx": 1, "dir": "long", "type": "LB"},
            {"idx": 2, "dir": "long", "type": "LB"},
        ],
    )
    monkeypatch.setattr(
        simulator,
        "simulate_trade_from_signal",
        lambda *args, **kwargs: {"pnl": next(pnls), "rr": 0.0},
    )

    result = simulator.backtest_with_bars(HeavenOpts(), bars, 0, 2, equity_start=100.0)

    assert result is not None
    assert result["consistency"] == pytest.approx(1 / 3)
    assert result["maxDDAbs"] == 10.0


def test_supabase_write_failures_are_not_silenced(monkeypatch):
    class FailingResponse:
        text = '{"code":"21000","message":"duplicate conflict target"}'

        def raise_for_status(self):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(supabase_io, "_rest_base_url", lambda: "https://example.test/rest/v1")
    monkeypatch.setattr(supabase_io.requests, "post", lambda *args, **kwargs: FailingResponse())

    with pytest.raises(SupabasePersistenceError, match="21000"):
        supabase_io.upsert_strategy_evaluations([{"symbol": "BTCUSDC"}], "service-key")


def test_strategy_evaluation_upsert_is_scoped_to_run(monkeypatch):
    captured = {}

    class SuccessfulResponse:
        def raise_for_status(self):
            return None

    def fake_post(*args, **kwargs):
        captured.update(kwargs)
        return SuccessfulResponse()

    monkeypatch.setattr(supabase_io, "_rest_base_url", lambda: "https://example.test/rest/v1")
    monkeypatch.setattr(supabase_io.requests, "post", fake_post)

    supabase_io.upsert_strategy_evaluations(
        [{"symbol": "BTCUSDC", "run_id": "00000000-0000-4000-8000-000000000001"}],
        "service-key",
    )

    assert captured["params"]["on_conflict"] == "user_id,symbol,tf,profile_id,params,run_id"


def test_supabase_json_serializes_non_finite_metrics(monkeypatch):
    captured = {}

    class SuccessfulResponse:
        def raise_for_status(self):
            return None

    def fake_post(*args, **kwargs):
        captured.update(kwargs)
        return SuccessfulResponse()

    monkeypatch.setattr(supabase_io, "_rest_base_url", lambda: "https://example.test/rest/v1")
    monkeypatch.setattr(supabase_io.requests, "post", fake_post)

    supabase_io.upsert_strategy_evaluations(
        [
            {
                "symbol": "BTCUSDC",
                "metrics": {
                    "profitFactor": float("inf"),
                    "wf_pf_std": float("nan"),
                    "nested": [float("-inf")],
                },
            }
        ],
        "service-key",
    )

    metrics = captured["json"][0]["metrics"]
    assert metrics["profitFactor"] == "Infinity"
    assert metrics["wf_pf_std"] == "NaN"
    assert metrics["nested"] == ["-Infinity"]


def test_strategy_evaluation_upsert_deduplicates_conflict_keys(monkeypatch):
    captured = {}

    class SuccessfulResponse:
        def raise_for_status(self):
            return None

    def fake_post(*args, **kwargs):
        captured.update(kwargs)
        return SuccessfulResponse()

    monkeypatch.setattr(supabase_io, "_rest_base_url", lambda: "https://example.test/rest/v1")
    monkeypatch.setattr(supabase_io.requests, "post", fake_post)

    identity = {
        "user_id": None,
        "symbol": "BTCUSDC",
        "tf": "15m",
        "profile_id": None,
        "params": {"prd": 15, "nol": 3},
        "run_id": "00000000-0000-4000-8000-000000000001",
    }
    supabase_io.upsert_strategy_evaluations(
        [
            {**identity, "score": 1.0, "selected": False},
            {**identity, "score": 2.0, "selected": False},
        ],
        "service-key",
    )

    assert len(captured["json"]) == 1
    assert captured["json"][0]["score"] == 2.0


def test_optimizer_results_deduplicate_identical_params():
    params = {"nol": 3, "prd": 15, "tp_r": [0.618, 1.0]}
    results = [
        {"params": params, "metrics": {"score": 0.5}, "provenance": "EA"},
        {"params": dict(params), "metrics": {"score": 0.7}, "provenance": "Bayesian"},
    ]

    deduped = api._dedupe_results_by_params(results)

    assert len(deduped) == 1
    assert deduped[0]["provenance"] == "Bayesian"
