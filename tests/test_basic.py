
import os
from pathlib import Path

import pytest

from advance_heaven_project import build_advancement_report, session_name_for_candidate
from analyze_strategy_evaluations import (
    build_experiment_plan,
    paper_failure_names,
    summarize_evaluations,
)
from heaven_opt import api, data_loader, simulator, supabase_io, validation
from heaven_opt.analysis import trade_diagnostics
from heaven_opt.combo_generator import generate_alloc_patterns
from heaven_opt.env import load_repo_env
from heaven_opt.naming import STRATEGY_NAME_WORDS, dictionary_word, strategy_name_for_rank
from heaven_opt.optimizer_bayes import _snap_float_bounds, _top_complete_trials
from heaven_opt.optimizer_ea import EASpace, _ind_to_candidate, run_ea
from heaven_opt.optimizer_ml import propose_with_surrogate
from heaven_opt.params import normalize_canonical_params
from heaven_opt.scoring import composite_score, robustness_score
from heaven_opt.signal_engine import last_two_pivots_before
from heaven_opt.simulator import HeavenOpts, generate_heaven_signals, simulate_trade_from_signal
from heaven_opt.supabase_io import (
    SupabasePersistenceError,
    canonical_params_to_ui_params,
    normalize_ui_strategy_params,
)
from heaven_opt.utils import Bar
from list_paper_candidates import build_paper_candidate_report, paper_candidate_failures
from prepare_live_candidate import (
    _strategy_lookup_params as _live_strategy_lookup_params,
)
from prepare_live_candidate import (
    analysis_gate_failures,
    build_live_preparation_plan,
    live_preparation_failures,
)
from run_experiment_matrix import (
    _paper_failure_names,
    build_config_data,
    latest_closed_day_boundary,
)
from start_paper_candidate import (
    _strategy_lookup_params as _paper_strategy_lookup_params,
)
from start_paper_candidate import (
    paper_start_failures,
    strategy_for_paper_session,
)
from validate_paper_session import compute_paper_metrics, paper_gate_failures


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


def test_load_repo_env_reads_runner_env_without_overwriting(monkeypatch, tmp_path):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "already-exported")
    env_file = tmp_path / ".env.runner"
    env_file.write_text(
        "\n".join(
            [
                "SUPABASE_URL=https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY='role-key'",
                "SUPABASE_SERVICE_KEY=from-file",
                "export HEAVEN_SEED=42",
                "bad-key=ignored",
            ]
        ),
        encoding="utf-8",
    )

    loaded = load_repo_env(tmp_path)

    assert loaded == [env_file]
    assert os.getenv("SUPABASE_URL") == "https://example.supabase.co"
    assert os.getenv("SUPABASE_SERVICE_ROLE_KEY") == "role-key"
    assert os.getenv("SUPABASE_SERVICE_KEY") == "already-exported"
    assert os.getenv("HEAVEN_SEED") == "42"


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
        Bar(time=2, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=3, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=4, open=100.0, high=131.0, low=99.0, close=125.0),
    ]
    opts = HeavenOpts(
        prd=2,
        risk_mgmt=True,
        risk_max_pct=1.0,
        sl_init_pct=2.0,
        be_enable=False,
        tp_types=["Fib"] * 10,
        tp_r=[0.5] + [0.0] * 9,
        tp_p=[100.0] + [0.0] * 9,
    )

    result = simulate_trade_from_signal(
        {"idx": 3, "dir": "long", "type": "LB"},
        3,
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


def test_duplicate_fib_tp_levels_merge_into_single_target():
    bars = [
        Bar(time=1, open=100.0, high=100.0, low=99.0, close=100.0),
        Bar(time=2, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=3, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=4, open=100.0, high=131.0, low=99.0, close=125.0),
    ]
    opts = HeavenOpts(
        prd=2,
        risk_mgmt=True,
        risk_max_pct=1.0,
        sl_init_pct=2.0,
        be_enable=False,
        tp_types=["Fib"] * 10,
        tp_r=[0.5, 0.5] + [0.0] * 8,
        tp_p=[50.0, 50.0] + [0.0] * 8,
    )

    result = simulate_trade_from_signal(
        {"idx": 3, "dir": "long", "type": "LB"},
        3,
        [{"idx": 0, "price": 80.0}, {"idx": 0, "price": 100.0}],
        opts,
        equity=10_000.0,
        fee_pct=0.0,
        equity_start=10_000.0,
        bars=bars,
    )

    assert result is not None
    assert [fill["kind"] for fill in result["fills"]] == ["TP1"]
    assert result["fills"][0]["price"] == 110.0
    assert result["fills"][0]["qty"] == 50.0
    assert result["reason"] == "TP"


def test_canonical_params_to_ui_merges_duplicate_tp_levels():
    ui = canonical_params_to_ui_params(
        {
            "tp_types": ["Fib", "Fib", "Percent"],
            "tp_r": [0.618, 0.618, 2.0],
            "tp_p": [40.0, 60.0, 0.0],
        }
    )

    assert ui["tp"] == [{"type": "Fib", "fib": 0.618, "value": 0.618, "qty": 1.0}]


def test_canonical_params_merge_duplicate_active_tp_slots():
    params = normalize_canonical_params(
        {
            "tp_types": ["Fib", "Fib", "Percent"],
            "tp_r": [0.618, 0.618, 2.0],
            "tp_p": [40.0, 60.0, 0.0],
        }
    )

    assert params["tp_types"][:2] == ["Fib", "Fib"]
    assert params["tp_r"][:3] == [0.618, 0.0, 0.0]
    assert params["tp_p"][:3] == [100.0, 0.0, 0.0]


def test_canonical_params_cap_merged_tp_weight():
    params = normalize_canonical_params(
        {
            "tp_types": ["Percent", "Percent"],
            "tp_r": [2.0, 2.0],
            "tp_p": [100.0, 100.0],
        }
    )

    assert params["tp_p"][:2] == [100.0, 0.0]


def test_ui_strategy_params_merge_duplicate_tp_levels():
    ui = normalize_ui_strategy_params(
        {
            "tpEnable": True,
            "tp": [
                {"type": "Percent", "pct": 2.0, "qty": 0.4},
                {"type": "Percent", "value": 2.0, "qty": 0.6},
            ],
        }
    )

    assert ui["tp"] == [{"type": "Percent", "pct": 2.0, "qty": 1.0}]


def test_browser_worker_fib_tp_uses_extension_formula():
    repo_root = Path(__file__).resolve().parents[1]
    source = (repo_root / "src" / "opt_worker.js").read_text(encoding="utf-8")

    assert "a.price + (b.price-a.price)*r" not in source
    assert "b.price + move*r" in source
    assert "b.price - move*r" in source


def test_ui_distinguishes_fib_retracement_and_extension_labels():
    repo_root = Path(__file__).resolve().parents[1]
    source = (repo_root / "src" / "main.js").read_text(encoding="utf-8")

    assert "Fib Ret ${fibDirLabel} ${r}" in source
    assert "Fib Ext ${fibDirLabel} ${r}" in source
    assert "A ${A.toFixed(2)} -> B ${B.toFixed(2)}" in source
    assert "normalizeTPLadder(tpArr)" in source
    assert "mergeDuplicateTargets(list)" in source
    assert "rebuildFibSelect(sFib, (st&&st.fib!=null)? st.fib : (sFib&&sFib.value), 'sl')" in source
    assert "rebuildFibSelect(vFib, (t&&t.fib!=null)? t.fib : (vFib&&vFib.value), 'sl')" in source


def test_headless_runners_only_process_paper_wallet_sessions():
    repo_root = Path(__file__).resolve().parents[1]
    runner_source = (repo_root / "runner" / "index.js").read_text(encoding="utf-8")
    edge_source = (
        repo_root / "supabase" / "functions" / "live-runner" / "index.ts"
    ).read_text(encoding="utf-8")

    assert "loadWalletPaperMap" in runner_source
    assert "isPaperSession" in runner_source
    assert "rows.filter((s)=> isPaperSession(s, walletMap))" in runner_source
    assert "ignored_non_paper" in edge_source
    assert ".filter((s: any) => isPaperSession(s, walletMap))" in edge_source


def test_headless_runners_restore_and_trigger_fib_pending_entries():
    repo_root = Path(__file__).resolve().parents[1]
    runner_source = (repo_root / "runner" / "index.js").read_text(encoding="utf-8")
    edge_source = (
        repo_root / "supabase" / "functions" / "live-runner" / "index.ts"
    ).read_text(encoding="utf-8")

    for source in (runner_source, edge_source):
        assert "buildFibPending" in source
        assert "fibPendingHit" in source
        assert "pendingFib" in source
        assert "type:'Fib'" in source or "type: 'Fib'" in source
        assert "entryMode !== 'Original'" in source


def test_headless_ui_persists_wallet_id_for_paper_sessions():
    repo_root = Path(__file__).resolve().parents[1]
    main_source = (repo_root / "src" / "main.js").read_text(encoding="utf-8")
    supa_source = (repo_root / "src" / "supa_ui.js").read_text(encoding="utf-8")

    assert "wallet_id: walletId" in supa_source
    assert "walletId=wallet&&wallet.id?wallet.id:null" in main_source


def test_paper_session_validation_passes_live_ready_gates():
    session = {
        "active": True,
        "start_cap": 10_000,
        "equity": 10_800,
        "created_at": "2026-05-01T00:00:00Z",
        "updated_at": "2026-05-10T00:00:00Z",
        "pos": None,
    }
    events = [
        {"kind": "entry", "at_time": "2026-05-02T00:00:00Z", "payload": {}},
        {"kind": "tp", "at_time": "2026-05-03T00:00:00Z", "payload": {"net": 300}},
        {"kind": "sl", "at_time": "2026-05-04T00:00:00Z", "payload": {"net": -100}},
        {"kind": "flip", "at_time": "2026-05-10T00:00:00Z", "payload": {"net": 600}},
    ]

    metrics = compute_paper_metrics(
        session,
        events,
        wallet={"paper": True, "exchange": "paper"},
    )
    failures = paper_gate_failures(
        metrics,
        {
            "min_days": 7.0,
            "min_trades": 3.0,
            "min_profit_factor": 2.0,
            "min_return_pct": 5.0,
            "max_drawdown_pct": 2.0,
        },
    )

    assert metrics["trade_events"] == 3
    assert metrics["profit_factor"] == 9.0
    assert metrics["return_pct"] == 8.0
    assert failures == []


def test_paper_session_validation_blocks_history_gap_and_open_position():
    metrics = compute_paper_metrics(
        {
            "start_cap": 10_000,
            "equity": 9_900,
            "created_at": "2026-05-01T00:00:00Z",
            "updated_at": "2026-05-03T00:00:00Z",
            "pos": {"dir": "long"},
        },
        [
            {"kind": "info", "at_time": "2026-05-02T00:00:00Z", "payload": {"code": "history_gap"}},
            {"kind": "sl", "at_time": "2026-05-03T00:00:00Z", "payload": {"net": -100}},
        ],
        wallet={"paper": True, "exchange": "paper"},
    )

    failures = paper_gate_failures(
        metrics,
        {
            "min_days": 7.0,
            "min_trades": 3.0,
            "min_profit_factor": 1.1,
            "min_return_pct": 0.0,
            "max_drawdown_pct": 10.0,
        },
    )

    assert "no_history_gap" in failures
    assert "no_open_position" in failures
    assert "min_observed_days" in failures


def test_paper_session_validation_blocks_non_paper_wallet():
    metrics = compute_paper_metrics(
        {
            "start_cap": 10_000,
            "equity": 11_000,
            "created_at": "2026-05-01T00:00:00Z",
            "updated_at": "2026-05-15T00:00:00Z",
            "pos": None,
        },
        [{"kind": "tp", "at_time": "2026-05-15T00:00:00Z", "payload": {"net": 1_000}}],
        wallet={"paper": False, "exchange": "live"},
    )

    failures = paper_gate_failures(
        metrics,
        {
            "min_days": 1.0,
            "min_trades": 1.0,
            "min_profit_factor": 1.0,
            "min_return_pct": 0.0,
            "max_drawdown_pct": 10.0,
        },
    )

    assert "paper_wallet" in failures


def test_paper_session_validation_accepts_infinite_profit_factor():
    metrics = {
        "paper_wallet": True,
        "history_gap": False,
        "open_position": False,
        "observed_days": 10.0,
        "trade_events": 3.0,
        "profit_factor": float("inf"),
        "return_pct": 3.0,
        "max_drawdown_pct": 0.0,
        "equity": 10_300.0,
    }

    failures = paper_gate_failures(
        metrics,
        {
            "min_days": 7.0,
            "min_trades": 3.0,
            "min_profit_factor": 1.1,
            "min_return_pct": 0.0,
            "max_drawdown_pct": 10.0,
        },
    )

    assert failures == []


def test_live_preparation_plan_passes_only_after_validated_paper_controls():
    session = {
        "id": "paper-1",
        "name": "paper-btcusdc-15m",
        "symbol": "BTCUSDC",
        "tf": "15m",
        "active": True,
        "wallet_id": "wallet-1",
        "lev": 1.0,
        "strategy_params": {"entryMode": "Original", "riskMaxPct": 0.75, "leverage": 1.0},
    }
    metrics = {"equity": 10_500.0}
    strategy = {
        "name": "heaven-btcusdc-15m-top-1",
        "symbol": "BTCUSDC",
        "tf": "15m",
        "params": {"entryMode": "Original", "riskMaxPct": 0.75, "leverage": 1.0},
        "metrics": {
            "score": 0.8,
            "paper_eligible": 1.0,
            "robustly_validated": 1.0,
            "robustness_score": 0.7,
            "paper_gate_failures": [],
        },
    }

    plan = build_live_preparation_plan(
        session,
        metrics,
        [],
        strategy,
        [],
        target_session_name="live-btcusdc-15m",
        max_risk_pct=1.0,
        max_leverage=1.0,
    )

    assert plan["ready_for_live_preparation"] is True
    assert plan["controls"]["creates_live_session"] is False
    assert plan["controls"]["places_orders"] is False


def test_live_preparation_refuses_failed_paper_and_unsafe_controls():
    failures = live_preparation_failures(
        {
            "name": "paper-btcusdc-15m",
            "active": False,
            "lev": 3.0,
            "strategy_params": {"entryMode": "Unsupported", "riskMaxPct": 2.0},
        },
        {"equity": 0.0},
        ["min_trades"],
        ["analysis_paper_eligible"],
        target_session_name="paper-btcusdc-15m",
        max_risk_pct=1.0,
        max_leverage=1.0,
    )

    assert failures == [
        "paper:min_trades",
        "analysis:analysis_paper_eligible",
        "source_session_active",
        "target_differs_from_paper",
        "paper_runner_entry_mode",
        "max_risk_pct",
        "max_leverage",
        "paper_equity_positive",
    ]


def test_live_preparation_requires_matching_robust_strategy_analysis():
    session = {
        "symbol": "BTCUSDC",
        "tf": "15m",
        "strategy_params": {"entryMode": "Original", "riskMaxPct": 0.75},
    }
    strategy = {
        "symbol": "BTCUSDC",
        "tf": "15m",
        "params": {"entryMode": "Original", "riskMaxPct": 0.75},
        "metrics": {
            "paper_eligible": 1.0,
            "robustly_validated": 1.0,
            "robustness_score": 0.65,
            "paper_gate_failures": [],
        },
    }

    failures = analysis_gate_failures(strategy, session, min_robustness_score=0.5)

    assert failures == []


def test_live_preparation_blocks_weak_or_mismatched_strategy_analysis():
    failures = analysis_gate_failures(
        {
            "symbol": "ETHUSDC",
            "tf": "4h",
            "params": {"entryMode": "Original"},
            "metrics": {
                "paper_eligible": 0.0,
                "robustly_validated": 0.0,
                "robustness_score": 0.2,
                "paper_gate_failures": ["oos_return"],
            },
        },
        {
            "symbol": "BTCUSDC",
            "tf": "15m",
            "strategy_params": {"entryMode": "Original", "riskMaxPct": 1.0},
        },
        min_robustness_score=0.5,
    )

    assert failures == [
        "analysis_symbol_match",
        "analysis_tf_match",
        "analysis_paper_eligible",
        "analysis_robustly_validated",
        "analysis_robustness_score",
        "analysis_gate_failures_empty",
        "analysis_params_match_session",
    ]


def test_paper_and_live_strategy_lookup_accept_exactly_one_identifier():
    assert _paper_strategy_lookup_params("heaven-btc", None) == {"name": "eq.heaven-btc"}
    assert _paper_strategy_lookup_params(None, "strategy-1") == {"id": "eq.strategy-1"}
    assert _live_strategy_lookup_params(None, "strategy-2") == {"id": "eq.strategy-2"}

    with pytest.raises(RuntimeError, match="exactly one"):
        _paper_strategy_lookup_params(None, None)
    with pytest.raises(RuntimeError, match="exactly one"):
        _live_strategy_lookup_params("heaven-btc", "strategy-1")


def test_list_paper_candidates_filters_to_supported_robust_strategies():
    rows = [
        {
            "id": "abc123",
            "name": "heaven-btc-15m",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "created_at": "2026-06-05T08:00:00Z",
            "params": {"entryMode": "Original", "riskMaxPct": 0.75, "leverage": 1.0},
            "metrics": {
                "score": 0.82,
                "robustness_score": 0.71,
                "paper_eligible": 1.0,
                "robustly_validated": 1.0,
                "paper_gate_failures": [],
            },
        },
        {
            "id": "fib123",
            "name": "heaven-btc-fib",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "created_at": "2026-06-05T07:00:00Z",
            "params": {"entryMode": "Fib Retracement", "useFibRet": True, "riskMaxPct": 0.75, "leverage": 1.0},
            "metrics": {"score": 0.7, "robustness_score": 0.6, "paper_eligible": 1.0, "robustly_validated": 1.0},
        },
        {
            "id": "badmode123",
            "name": "heaven-btc-badmode",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "params": {"entryMode": "Unsupported", "riskMaxPct": 0.75, "leverage": 1.0},
            "metrics": {"paper_eligible": 1.0, "robustly_validated": 1.0},
        },
        {
            "id": "weak123",
            "name": "heaven-btc-weak",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "params": {"entryMode": "Original", "riskMaxPct": 0.75, "leverage": 1.0},
            "metrics": {"paper_eligible": 1.0, "robustly_validated": 0.0},
        },
        {
            "id": "fail123",
            "name": "heaven-btc-fail",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "params": {"entryMode": "Original", "riskMaxPct": 0.75, "leverage": 1.0},
            "metrics": {"paper_eligible": 0.0, "robustly_validated": 1.0},
        },
    ]

    report = build_paper_candidate_report(rows, top_n=5)

    assert report["candidate_count"] == 2
    assert report["excluded_failure_counts"] == {
        "paper_eligible": 1,
        "paper_runner_entry_mode": 1,
        "robustly_validated": 1,
    }
    candidate = report["candidates"][0]
    assert candidate["id"] == "abc123"
    assert candidate["commands"]["start_paper"] == (
        "python start_paper_candidate.py --strategy-id abc123 "
        "--session-name paper-btcusdc-15m-abc123 --max-risk-pct 1 --max-leverage 1 --invoke-runner"
    )
    assert candidate["commands"]["validate_paper"] == (
        "python validate_paper_session.py --session-name paper-btcusdc-15m-abc123 --record-event --strict-exit"
    )
    assert "--strategy-id abc123" in candidate["commands"]["audit_live"]
    assert "--max-risk-pct 1 --max-leverage 1" in candidate["commands"]["audit_live"]
    assert report["candidates"][1]["id"] == "fib123"
    assert report["candidates"][1]["entry_mode"] == "Fib Retracement"


def test_list_paper_candidates_can_explicitly_include_unrobust_candidates():
    row = {
        "id": "weak123",
        "name": "heaven-btc-weak",
        "symbol": "BTCUSDC",
        "tf": "15m",
        "params": {"entryMode": "Original", "riskMaxPct": 0.75, "leverage": 1.0},
        "metrics": {"paper_eligible": 1.0, "robustly_validated": 0.0},
    }

    assert paper_candidate_failures(row, require_robust=True) == ["robustly_validated"]
    assert paper_candidate_failures(row, require_robust=False) == []
    assert build_paper_candidate_report([row], require_robust=False)["candidate_count"] == 1


def test_list_paper_candidates_enforces_risk_and_leverage_controls():
    rows = [
        {
            "id": "safe123",
            "name": "heaven-safe",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "params": {"entryMode": "Original", "riskMaxPct": 1.0, "leverage": 1.0},
            "metrics": {"paper_eligible": 1.0, "robustly_validated": 1.0},
        },
        {
            "id": "risk123",
            "name": "heaven-risk",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "params": {"entryMode": "Original", "riskMaxPct": 1.5, "leverage": 1.0},
            "metrics": {"paper_eligible": 1.0, "robustly_validated": 1.0},
        },
        {
            "id": "lev123",
            "name": "heaven-lev",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "params": {"entryMode": "Original", "riskMaxPct": 1.0, "leverage": 2.0},
            "metrics": {"paper_eligible": 1.0, "robustly_validated": 1.0},
        },
    ]

    report = build_paper_candidate_report(rows, max_risk_pct=1.0, max_leverage=1.0)

    assert [item["id"] for item in report["candidates"]] == ["safe123"]
    assert report["excluded_failure_counts"] == {"max_leverage": 1, "max_risk_pct": 1}
    assert report["controls"] == {"max_risk_pct": 1.0, "max_leverage": 1.0}


def test_advance_heaven_project_starts_missing_candidate_session():
    strategy_rows = [
        {
            "id": "abc123",
            "name": "heaven-btc-15m",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "created_at": "2026-06-13T15:49:47Z",
            "params": {"entryMode": "Original", "riskMaxPct": 1.0, "leverage": 1.0},
            "metrics": {
                "score": 0.6,
                "robustness_score": 0.66,
                "paper_eligible": 1.0,
                "robustly_validated": 1.0,
                "paper_gate_failures": [],
            },
        }
    ]
    evaluation_rows = [
        {
            "campaign_id": "old-campaign",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "score": 50,
            "created_at": "2025-12-11T19:01:30Z",
            "metrics": {"paper_eligible": 0.0},
        }
    ]

    report = build_advancement_report(
        strategy_rows=strategy_rows,
        evaluation_rows=evaluation_rows,
        paper_sessions=[],
        paper_session_report={"rows": 0, "live_ready": 0, "top": []},
        symbol="BTCUSDC",
        tf="15m",
        top_n=1,
        session_prefix="paper",
        max_risk_pct=1.0,
        max_leverage=1.0,
    )

    assert report["status"] == "ready_to_start_paper"
    assert report["candidate_report"]["candidate_count"] == 1
    assert report["actions"][0]["action"] == "start_paper"
    assert report["actions"][0]["session_name"] == "paper-btcusdc-15m-abc123"
    assert "heaven_strategies is fresher" in report["warnings"][0]


def test_advance_heaven_project_validates_existing_candidate_session_instead_of_duplicate_start():
    strategy_rows = [
        {
            "id": "abc123",
            "name": "heaven-btc-15m",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "created_at": "2026-06-13T15:49:47Z",
            "params": {"entryMode": "Original", "riskMaxPct": 1.0, "leverage": 1.0},
            "metrics": {"paper_eligible": 1.0, "robustly_validated": 1.0},
        }
    ]
    paper_sessions = [
        {
            "id": "session-1",
            "name": "paper-btcusdc-15m-abc123",
            "symbol": "BTCUSDC",
            "tf": "15m",
            "active": True,
        }
    ]

    report = build_advancement_report(
        strategy_rows=strategy_rows,
        evaluation_rows=[],
        paper_sessions=paper_sessions,
        paper_session_report={"rows": 1, "live_ready": 0, "top": []},
        symbol="BTCUSDC",
        tf="15m",
        top_n=1,
        session_prefix="paper",
        max_risk_pct=1.0,
        max_leverage=1.0,
    )

    actions = [item["action"] for item in report["actions"]]
    assert report["status"] == "paper_running_or_needs_validation"
    assert actions == ["validate_paper", "audit_live_after_validation"]
    assert report["matched_candidate_sessions"] == 1


def test_session_name_for_candidate_reads_generated_start_command():
    report = build_paper_candidate_report(
        [
            {
                "id": "abc123",
                "name": "heaven-safe",
                "symbol": "BTCUSDC",
                "tf": "1h",
                "params": {"entryMode": "Original", "riskMaxPct": 1.0, "leverage": 1.0},
                "metrics": {"paper_eligible": 1.0, "robustly_validated": 1.0},
            }
        ]
    )

    assert session_name_for_candidate(report["candidates"][0]) == "paper-btcusdc-1h-abc123"


def test_start_paper_candidate_enforces_risk_and_leverage_controls():
    strategy = {"params": {"riskMaxPct": 1.25, "leverage": 2.0}}

    assert paper_start_failures(strategy, leverage=2.0, max_risk_pct=1.0, max_leverage=1.0) == [
        "max_risk_pct",
        "max_leverage",
    ]
    assert paper_start_failures(strategy, leverage=1.0, max_risk_pct=2.0, max_leverage=1.0) == []
    assert paper_start_failures(
        {"params": {"entryMode": "Unsupported", "riskMaxPct": 1.0, "leverage": 1.0}},
        leverage=1.0,
        max_risk_pct=1.0,
        max_leverage=1.0,
    ) == ["paper_runner_entry_mode"]
    assert (
        paper_start_failures(
            {"params": {"entryMode": "Fib Retracement", "useFibRet": True, "riskMaxPct": 1.0, "leverage": 1.0}},
            leverage=1.0,
            max_risk_pct=1.0,
            max_leverage=1.0,
        )
        == []
    )


def test_start_paper_candidate_syncs_effective_leverage_into_session_params():
    strategy = {"params": {"entryMode": "Original", "riskMaxPct": 1.0, "leverage": 2.0}}

    session_strategy = strategy_for_paper_session(strategy, leverage=1.0)

    assert session_strategy["params"]["leverage"] == 1.0
    assert strategy["params"]["leverage"] == 2.0


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
            "risk_max_pct": 0.75,
            "leverage": 2.0,
            "be_enable": False,
            "entry_mode": "Fib",
            "tp_types": ["Fib", "Percent", "EMA"],
            "tp_r": [0.382, 2.0, 0.0],
            "tp_p": [40.0, 35.0, 25.0],
        }
    )

    assert ui["entryMode"] == "Fib Retracement"
    assert ui["slInitPct"] == 1.5
    assert ui["riskMaxPct"] == 0.75
    assert ui["leverage"] == 2.0
    assert ui["beEnable"] is False
    assert [tp["type"] for tp in ui["tp"]] == ["Fib", "Percent", "EMA"]
    assert ui["tp"][2]["emaLen"] == 55


def test_backtest_sizing_respects_configured_leverage_cap():
    bars = [Bar(time=1, open=100.0, high=100.0, low=99.0, close=100.0)]
    opts = HeavenOpts(
        leverage=1.0,
        risk_mgmt=True,
        risk_max_pct=1.0,
        sl_init_pct=0.5,
        be_enable=False,
        tp_enable=False,
        tp_p=[0.0] * 10,
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
    )

    assert result is not None
    assert result["qty"] == 100.0


def test_composite_score_uses_consistency_weight():
    score = composite_score({"consistency": 0.75}, {"cons": 1.0})

    assert score == 0.75


def test_composite_score_discounts_losing_train_edge():
    weights = {"pf": 1.0, "dd": 1.0, "cons": 1.0}
    weak = {
        "profitFactor": 0.75,
        "return_pct": -12.0,
        "maxDDPct": 5.0,
        "consistency": 0.75,
    }
    break_even = {
        **weak,
        "profitFactor": 1.01,
        "return_pct": 0.1,
    }

    assert composite_score(break_even, weights) > composite_score(weak, weights)
    assert composite_score(weak, weights) < 0.5


def test_pivots_are_not_available_before_confirmation():
    pivots = [{"idx": 2, "price": 90.0}, {"idx": 4, "price": 110.0}]

    assert last_two_pivots_before(pivots, idx=6, prd=2) is None
    assert last_two_pivots_before(pivots, idx=7, prd=2) is not None


def test_worker_eval_waits_for_confirmed_pivots():
    source = Path("src/worker_eval.js").read_text(encoding="utf-8")

    assert "pivAll[pivIdx+1].idx+prd<=i" in source
    assert "pivAll[pivIdx+1].idx<=i" not in source


def test_fib_signals_wait_for_pivot_confirmation():
    bars = [
        Bar(time=i, open=close, high=close + 1.0, low=close - 1.0, close=close)
        for i, close in enumerate([100.0, 101.0, 102.0, 103.0, 106.0, 104.0, 106.0, 107.0])
    ]
    opts = HeavenOpts(prd=2, entry_mode="Fib", risk_mgmt=False)
    precomputed = {
        "lb": ([1] * len(bars), [90.0] * len(bars), [5]),
        "piv": [{"idx": 1, "price": 100.0}, {"idx": 3, "price": 110.0}],
    }

    signals = generate_heaven_signals(opts, bars, precomputed=precomputed)

    assert signals
    assert min(int(signal["idx"]) for signal in signals) >= 6


def test_signal_generation_does_not_mix_position_risk_with_entry_filtering():
    bars = [
        Bar(time=1, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=2, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=3, open=100.0, high=101.0, low=99.0, close=100.0),
    ]
    opts = HeavenOpts(entry_mode="Original", risk_mgmt=True, risk_max_pct=0.1)
    precomputed = {"lb": ([1, -1, -1], [10.0, 10.0, 10.0], [1]), "piv": []}

    signals = generate_heaven_signals(opts, bars, precomputed=precomputed)

    assert signals == [{"idx": 2, "dir": "short", "type": "LB"}]


def test_validation_metrics_change_the_composite_score():
    base_metrics = {"profitFactor": 2.0, "maxDDPct": 5.0}
    weak = {
        **base_metrics,
        "oos_profitFactor": 0.5,
        "oos_return_pct": -10.0,
        "oos_maxDDPct": 30.0,
        "oos_trades": 30.0,
    }
    strong = {
        **base_metrics,
        "oos_profitFactor": 1.5,
        "oos_return_pct": 10.0,
        "oos_maxDDPct": 5.0,
        "oos_trades": 30.0,
    }
    weights = {"pf": 1.0, "robustness": 0.65}

    assert robustness_score(strong) > robustness_score(weak)
    assert composite_score(strong, weights) > composite_score(weak, weights)


def test_experiment_matrix_builds_recent_holdout_without_fib_by_default():
    template = {
        "general": {"max_combinations": 1000, "top_n_results": 20},
        "ranges": {"nol_range": [2, 6, 1]},
        "EA": {"pop_size": 80, "n_generations": 12},
        "Bayesian": {"n_trials": 20},
    }
    date_to = latest_closed_day_boundary()

    data = build_config_data(template, "BTCUSDC", "15m", date_to, fast=True)

    assert data["entry_modes"] == ["Original"]
    assert data["TP"]["mode"] == "Fib"
    assert data["general"]["tf_optim"] == "15m"
    assert data["validation"]["oos_split"][1].endswith("T00:00:00Z")
    assert data["metrics"]["min_oos_trades"] == 10
    assert data["ranges"]["nol_range"] == {"min": 6.0, "max": 18.0, "step": 2.0}
    assert data["ranges"]["prd_range"] == {"min": 16.0, "max": 64.0, "step": 4.0}
    assert data["metrics"]["max_trades"] == 360
    assert data["metrics"]["max_oos_trades"] == 70

    data_no_be = build_config_data(template, "BTCUSDC", "15m", date_to, fast=True, include_no_be=True)

    assert data_no_be["ranges"]["be_enable_values"] == [True, False]


def test_experiment_matrix_applies_all_timeframe_profiles():
    template = {
        "general": {"max_combinations": 1000, "top_n_results": 20},
        "ranges": {"nol_range": [2, 6, 1]},
        "EA": {"pop_size": 80, "n_generations": 12},
        "Bayesian": {"n_trials": 20},
    }
    date_to = latest_closed_day_boundary()

    expected = {
        "1m": (2500, 650, 0.35),
        "5m": (2400, 380, 0.45),
        "15m": (360, 70, 0.45),
        "1h": (700, 120, 0.65),
        "4h": (360, 70, 0.70),
        "1d": (160, 45, 0.80),
    }
    for tf, (max_trades, max_oos, exposure) in expected.items():
        data = build_config_data(template, "BTCUSDC", tf, date_to, fast=True, tp_mode="Percent")

        assert data["metrics"]["max_trades"] == max_trades
        assert data["metrics"]["max_oos_trades"] == max_oos
        assert data["metrics"]["max_exposure_frac"] == exposure
        assert data["Bayesian"]["refine_radius"] > 0.0
        assert data["TP"]["percent_min"] > 0


def test_experiment_matrix_applies_scalping_1m_profile():
    template = {
        "general": {"max_combinations": 1000, "top_n_results": 20},
        "ranges": {"nol_range": [2, 6, 1]},
        "EA": {"pop_size": 80, "n_generations": 12},
        "Bayesian": {"n_trials": 20},
    }
    date_to = latest_closed_day_boundary()

    data = build_config_data(
        template,
        "BTCUSDC",
        "1m",
        date_to,
        fast=True,
        include_fib=True,
        include_no_be=True,
        tp_mode="Percent",
        scalping_1m=True,
    )

    assert data["entry_modes"] == ["Original"]
    assert data["TP"]["percent_min"] == 0.15
    assert data["TP"]["percent_max"] == 1.2
    assert data["ranges"]["prd_range"] == {"min": 3.0, "max": 12.0, "step": 1.0}
    assert data["ranges"]["sl_pct_range"] == {"min": 0.3, "max": 1.2, "step": 0.1}
    assert data["ranges"]["be_enable_values"] == [True, False]
    assert data["EA"]["pop_size"] == 12
    assert data["Bayesian"]["refine_radius"] == 0.35
    assert data["metrics"]["validation_top_n"] == 8


def test_ea_keeps_percent_tp_type_explicit():
    space = EASpace(
        nol_list=[3],
        prd_list=[15],
        sl_list=[1.0],
        beb_list=[5],
        bel_list=[5.0],
        be_enable_list=[False],
        ema_list=[55],
        entry_modes=["Original"],
        tp_vectors=[[0.5, 1.0, 2.0]],
        alloc_patterns=[[30.0, 30.0, 40.0]],
        tp_type="Percent",
    )

    candidate = _ind_to_candidate([0] * 10, space)

    assert candidate["tp_types"] == ["Percent"] * 10
    assert candidate["be_enable"] is False


def test_ea_reuses_candidate_metrics_for_final_seeds():
    space = EASpace(
        nol_list=[3],
        prd_list=[15],
        sl_list=[1.0],
        beb_list=[5],
        bel_list=[5.0],
        be_enable_list=[True],
        ema_list=[55],
        entry_modes=["Original"],
        tp_vectors=[[0.5, 1.0, 2.0]],
        alloc_patterns=[[30.0, 30.0, 40.0]],
        tp_type="Percent",
    )
    calls = 0

    def eval_candidate(_cand):
        nonlocal calls
        calls += 1
        return {"profitFactor": 2.0, "totalPnl": 100.0, "maxDDPct": 1.0}

    seeds = run_ea(
        space,
        {"pf": 1.0},
        eval_candidate,
        pop_size=3,
        n_generations=1,
        cx_prob=0.0,
        mut_prob=0.0,
        n_jobs=1,
        early_stop_patience=None,
    )

    assert len(seeds) == 1
    assert calls == 1


def test_ml_surrogate_keeps_percent_tp_type_explicit():
    bounds = {
        "nol": (3.0, 3.0, 1.0),
        "prd": (15.0, 15.0, 1.0),
        "sl_init_pct": (1.0, 1.0, 0.5),
        "be_after_bars": (5.0, 5.0, 1.0),
        "be_lock_pct": (5.0, 5.0, 1.0),
        "ema_len": (55.0, 55.0, 1.0),
    }

    suggestions = propose_with_surrogate(
        [],
        bounds,
        ["Original"],
        [[0.5, 1.0, 1.5]],
        [[30.0, 30.0, 40.0]],
        be_enable_values=[False],
        tp_type="Percent",
        n_suggest=1,
        rng_seed=7,
    )

    assert suggestions
    assert suggestions[0]["tp_types"] == ["Percent"] * 10
    assert suggestions[0]["be_enable"] is False


def test_range_loader_continues_when_closed_candle_filter_shortens_a_batch(monkeypatch):
    batches = iter(
        [
            [Bar(time=20, open=1, high=1, low=1, close=1), Bar(time=30, open=1, high=1, low=1, close=1)],
            [Bar(time=10, open=1, high=1, low=1, close=1)],
            [],
        ]
    )
    monkeypatch.setattr(data_loader, "_fetch_batch", lambda *args, **kwargs: next(batches))

    bars = data_loader.fetch_klines_range("BTCUSDC", "15m", start_sec=0, end_sec=40, hard_cap=10)

    assert [bar.time for bar in bars] == [10, 20, 30]


def test_walk_forward_positive_fraction_uses_active_folds(monkeypatch):
    bars = [
        Bar(time=day * 86400, open=1, high=1, low=1, close=1)
        for day in range(51)
    ]
    reports = iter(
        [
            {"trades": [], "profitFactor": 0.0, "totalPnl": 0.0, "maxDDPct": 0.0},
            {"trades": [{}], "profitFactor": 2.0, "totalPnl": 10.0, "maxDDPct": 1.0},
            {"trades": [{}], "profitFactor": 1.0, "totalPnl": -5.0, "maxDDPct": 2.0},
            {"trades": [], "profitFactor": 0.0, "totalPnl": 0.0, "maxDDPct": 0.0},
        ]
    )
    monkeypatch.setattr(validation, "backtest_with_bars", lambda *args, **kwargs: next(reports))

    metrics = validation.walk_forward_validate(
        bars,
        HeavenOpts(),
        train_days=10,
        test_days=10,
        stride_days=10,
        equity_start=10_000,
        fee_pct=0.1,
    )

    assert metrics["wf_active_frac"] == 0.5
    assert metrics["wf_positive_frac"] == 0.5
    assert metrics["wf_pf_mean"] == 1.5


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


def test_trade_diagnostics_report_exit_mix_and_streaks():
    metrics = trade_diagnostics(
        [
            {"entryIdx": 0, "exitIdx": 1, "pnl": 10.0, "rr": 1.0, "reason": "TP", "dir": "long"},
            {"entryIdx": 2, "exitIdx": 4, "pnl": -5.0, "rr": -0.5, "reason": "SL", "dir": "short"},
            {"entryIdx": 5, "exitIdx": 5, "pnl": -3.0, "rr": -0.3, "reason": "Close", "dir": "short"},
        ],
        0,
        9,
    )

    assert metrics["diag_avg_hold_bars"] == pytest.approx(2.0)
    assert metrics["diag_exposure_frac"] == pytest.approx(0.6)
    assert metrics["diag_long_frac"] == pytest.approx(1 / 3)
    assert metrics["diag_short_frac"] == pytest.approx(2 / 3)
    assert metrics["diag_tp_exit_frac"] == pytest.approx(1 / 3)
    assert metrics["diag_sl_exit_frac"] == pytest.approx(1 / 3)
    assert metrics["diag_close_exit_frac"] == pytest.approx(1 / 3)
    assert metrics["diag_payoff_ratio"] == pytest.approx(2.5)
    assert metrics["diag_max_consec_losses"] == 2.0


def test_evaluate_period_prefixes_trade_diagnostics(monkeypatch):
    bars = [
        Bar(time=1, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=2, open=100.0, high=101.0, low=99.0, close=100.0),
        Bar(time=3, open=100.0, high=101.0, low=99.0, close=100.0),
    ]
    monkeypatch.setattr(
        validation,
        "backtest_with_bars",
        lambda *args, **kwargs: {
            "totalPnl": -5.0,
            "profitFactor": 0.5,
            "trades": [
                {"entryIdx": 0, "exitIdx": 1, "pnl": -5.0, "rr": -0.5, "reason": "SL", "dir": "long"}
            ],
            "winrate": 0.0,
            "avgRR": -0.5,
            "sharpe": 0.0,
            "maxDDPct": 1.0,
            "maxDDAbs": 5.0,
            "equity": 995.0,
        },
    )

    metrics = validation.evaluate_period(bars, HeavenOpts(), 0, 2, equity_start=1000.0, fee_pct=0.1)

    assert metrics["oos_diag_sl_exit_frac"] == 1.0
    assert metrics["oos_diag_max_consec_losses"] == 1.0


def test_backtest_closes_before_next_signal_open_and_deduplicates_entries(monkeypatch):
    bars = [
        Bar(time=i, open=100.0, high=101.0, low=99.0, close=100.0)
        for i in range(5)
    ]
    calls = []
    monkeypatch.setattr(
        simulator,
        "generate_heaven_signals",
        lambda opts, bars, precomputed=None: [
            {"idx": 1, "dir": "long", "type": "LB"},
            {"idx": 3, "dir": "short", "type": "LB"},
            {"idx": 3, "dir": "short", "type": "Fib"},
            {"idx": 4, "dir": "long", "type": "LB"},
        ],
    )

    def fake_simulate(sig, to_idx, *args, **kwargs):
        calls.append((int(sig["idx"]), to_idx))
        return {"pnl": 0.0, "rr": 0.0}

    monkeypatch.setattr(simulator, "simulate_trade_from_signal", fake_simulate)

    result = simulator.backtest_with_bars(HeavenOpts(), bars, 0, 4, equity_start=100.0)

    assert result is not None
    assert calls == [(1, 2), (3, 3), (4, 4)]


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


def test_optimizer_strategy_names_use_project_dictionaries():
    name = strategy_name_for_rank("00000000-0000-4000-8000-000000000001", 3)
    word = name.split("-")[0]

    assert word in STRATEGY_NAME_WORDS
    assert dictionary_word("00000000", 3) == word
    assert name.endswith("-3")


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


def test_strategy_evaluation_upsert_normalizes_duplicate_tp_params(monkeypatch):
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
                "params": {
                    "tp_types": ["Fib", "Fib"],
                    "tp_r": [0.618, 0.618],
                    "tp_p": [40.0, 60.0],
                },
            }
        ],
        "service-key",
    )

    params = captured["json"][0]["params"]
    assert params["tp_r"][:2] == [0.618, 0.0]
    assert params["tp_p"][:2] == [100.0, 0.0]


def test_optimizer_results_deduplicate_identical_params():
    params = {"nol": 3, "prd": 15, "tp_r": [0.618, 1.0]}
    results = [
        {"params": params, "metrics": {"score": 0.5}, "provenance": "EA"},
        {"params": dict(params), "metrics": {"score": 0.7}, "provenance": "Bayesian"},
    ]

    deduped = api._dedupe_results_by_params(results)

    assert len(deduped) == 1
    assert deduped[0]["provenance"] == "Bayesian"


def test_optimizer_results_deduplicate_equivalent_duplicate_tp_params():
    results = [
        {
            "params": {
                "nol": 3,
                "prd": 15,
                "tp_types": ["Fib", "Fib"],
                "tp_r": [0.618, 0.618],
                "tp_p": [40.0, 60.0],
            },
            "metrics": {"score": 0.5},
            "provenance": "duplicate",
        },
        {
            "params": {
                "nol": 3,
                "prd": 15,
                "tp_types": ["Fib"],
                "tp_r": [0.618],
                "tp_p": [100.0],
            },
            "metrics": {"score": 0.7},
            "provenance": "merged",
        },
    ]

    deduped = api._dedupe_results_by_params(results)

    assert len(deduped) == 1
    assert deduped[0]["provenance"] == "merged"
    assert deduped[0]["params"]["tp_p"][:2] == [100.0, 0.0]


def test_paper_gate_failures_are_exposed_as_numeric_metrics():
    metrics = {}

    api._annotate_paper_gate_failure_metrics(metrics, ["oos_trades", "wf_active_frac"])

    assert metrics["paper_gate_failure_count"] == 2.0
    assert metrics["paper_fail_oos_trades"] == 1.0
    assert metrics["paper_fail_wf_active_frac"] == 1.0
    assert metrics["paper_fail_oos_return"] == 0.0


def test_optimizer_paper_gate_accepts_headless_fib_entries():
    cfg = type(
        "Cfg",
        (),
        {
            "metrics": type(
                "Metrics",
                (),
                {
                    "min_trades": 1,
                    "max_trades": None,
                    "min_oos_trades": 1,
                    "max_oos_trades": None,
                    "min_oos_profit_factor": 1.0,
                    "min_oos_return_pct": 0.0,
                    "max_oos_dd_pct": 20.0,
                    "max_exposure_frac": 1.0,
                    "max_oos_exposure_frac": 1.0,
                    "min_wf_positive_frac": 0.5,
                    "min_wf_active_frac": 0.5,
                    "min_wf_profit_factor": 1.0,
                    "min_mc_profit_factor": 1.0,
                },
            )()
        },
    )()
    metrics = {
        "trades": 2,
        "oos_profitFactor": 1.2,
        "oos_trades": 2,
        "oos_return_pct": 1.0,
        "oos_maxDDPct": 5.0,
        "wf_positive_frac": 0.7,
        "wf_active_frac": 0.7,
        "wf_pf_mean": 1.1,
        "mc_pf_mean": 1.1,
    }

    assert api._paper_gate_failures(metrics, cfg, {"entry_mode": "Fib", "use_fib_ret": True}) == []
    assert api._paper_gate_failures(metrics, cfg, {"entry_mode": "Unsupported"}) == ["paper_runner_entry_mode"]


def test_optimizer_penalizes_overtrading_and_exposure():
    cfg = type(
        "Cfg",
        (),
        {
            "metrics": type(
                "Metrics",
                (),
                {
                    "max_trades": 100,
                    "max_oos_trades": 20,
                    "max_exposure_frac": 0.5,
                    "max_oos_exposure_frac": 0.4,
                },
            )()
        },
    )()
    metrics = {
        "trades": 250,
        "oos_trades": 50,
        "diag_exposure_frac": 0.75,
        "oos_diag_exposure_frac": 0.6,
    }

    api._annotate_behavior_penalty(metrics, cfg)

    assert metrics["penalty_train_trade_excess"] > 0.0
    assert metrics["penalty_oos_trade_excess"] > 0.0
    assert metrics["penalty_train_exposure_excess"] > 0.0
    assert metrics["penalty_oos_exposure_excess"] > 0.0
    assert metrics["score_penalty"] > 0.0
    assert composite_score({"profitFactor": 3.0, "score_penalty": 0.5}, {"pf": 1.0}) == pytest.approx(0.5)


def test_optimizer_validation_pool_includes_diverse_training_winners():
    results = [
        {"metrics": {"score": 10.0, "profitFactor": 1.0, "totalPnl": 100.0, "maxDDPct": 20.0}},
        {"metrics": {"score": 9.0, "profitFactor": 1.1, "totalPnl": 90.0, "maxDDPct": 18.0}},
        {"metrics": {"score": 8.0, "profitFactor": 1.2, "totalPnl": 80.0, "maxDDPct": 16.0}},
        {"metrics": {"score": 1.0, "profitFactor": 5.0, "totalPnl": 70.0, "maxDDPct": 30.0}},
        {"metrics": {"score": 0.5, "profitFactor": 1.0, "totalPnl": 60.0, "maxDDPct": 1.0}},
    ]

    selected = api._select_validation_candidate_indexes(results, validation_count=2)

    assert {0, 1}.issubset(selected)
    assert 3 in selected


def test_optimizer_seed_selection_keeps_entry_mode_diversity():
    results = [
        {"params": {"entry_mode": "Fib", "be_enable": True}, "metrics": {"score": 10.0}},
        {"params": {"entry_mode": "Fib", "be_enable": True}, "metrics": {"score": 9.0}},
        {"params": {"entry_mode": "Fib", "be_enable": True}, "metrics": {"score": 8.0}},
        {"params": {"entry_mode": "Original", "be_enable": False}, "metrics": {"score": 1.0}},
        {"params": {"entry_mode": "Both", "be_enable": True}, "metrics": {"score": 0.5}},
    ]

    selected = api._select_diverse_search_results(results, count=4)

    assert results[0] in selected
    assert results[3] in selected
    assert results[4] in selected


def test_optimizer_deadline_blocks_expensive_validation(monkeypatch):
    monkeypatch.setenv("HEAVEN_VALIDATION_RESERVE_SEC", "120")
    monkeypatch.setattr(api.time, "time", lambda: 1_000.0)

    assert api._deadline_blocks_validation(None) is False
    assert api._deadline_blocks_validation(1_200.0) is False
    assert api._deadline_blocks_validation(1_100.0) is True


def test_bayesian_refinement_keeps_top_completed_trials():
    import optuna

    study = optuna.create_study(direction="maximize")
    values = [0.2, 0.9, 0.0, 0.7, -0.1, 0.8]
    for value in values:
        trial = study.ask()
        study.tell(trial, value)
    pruned = study.ask()
    study.tell(pruned, state=optuna.trial.TrialState.PRUNED)

    top = _top_complete_trials(study, limit=5)

    assert [trial.value for trial in top] == [0.9, 0.8, 0.7, 0.2, 0.0]


def test_bayesian_float_bounds_snap_to_step():
    lo, hi = _snap_float_bounds((1.8719999999999999, 2.928), 0.1)

    assert lo == pytest.approx(1.872)
    assert hi == pytest.approx(2.872)


def test_experiment_summary_reads_paper_failure_flags_in_gate_order():
    metrics = {
        "paper_fail_wf_active_frac": 1.0,
        "paper_fail_oos_trades": 1.0,
        "paper_fail_custom_gate": 1.0,
    }

    assert _paper_failure_names(metrics) == ["oos_trades", "wf_active_frac", "custom_gate"]


def test_strategy_evaluation_analysis_summarizes_top_and_failures():
    summary = summarize_evaluations(
        [
            {
                "campaign_id": "camp-fib",
                "symbol": "BTCUSDC",
                "tf": "15m",
                "score": 0.2,
                "metrics": {
                    "paper_eligible": 0.0,
                    "oos_return_pct": -3.0,
                    "oos_profitFactor": 0.8,
                    "oos_maxDDPct": 5.0,
                    "wf_positive_frac": 0.4,
                    "paper_fail_oos_return": 1.0,
                    "paper_fail_wf_positive_frac": 1.0,
                },
            },
            {
                "campaign_id": "camp-percent",
                "symbol": "BTCUSDC",
                "tf": "15m",
                "score": 0.5,
                "metrics": {
                    "paper_eligible": 1.0,
                    "oos_return_pct": 4.0,
                    "oos_profitFactor": 1.4,
                    "oos_maxDDPct": 4.0,
                    "wf_positive_frac": 0.7,
                },
            },
        ],
        top_n=2,
    )

    assert summary["rows"] == 2
    assert summary["paper_eligible"] == 1
    assert summary["failure_counts"] == {"oos_return": 1, "wf_positive_frac": 1}
    assert summary["top"][0]["campaign_id"] == "camp-percent"
    assert summary["top"][1]["failures"] == ["oos_return", "wf_positive_frac"]
    assert [item["action"] for item in summary["recommendations"]] == [
        "list_paper_candidates",
        "prepare_controlled_paper",
        "validate_before_live",
        "audit_controlled_live",
    ]
    assert (
        summary["recommendations"][0]["command_hint"]
        == "python list_paper_candidates.py --symbol BTCUSDC --tf 15m"
    )


def test_strategy_evaluation_analysis_reads_legacy_failure_lists():
    failures = paper_failure_names(
        {
            "paper_gate_failures": ["mc_profit_factor"],
            "paper_fail_oos_trades": 1.0,
        }
    )

    assert failures == ["oos_trades", "mc_profit_factor"]


def test_strategy_evaluation_analysis_recommends_experiment_when_no_rows():
    summary = summarize_evaluations([], top_n=3)

    assert summary["rows"] == 0
    assert summary["recommendations"][0]["action"] == "run_recent_matrix"
    assert summary["experiment_plan"]["commands"][0]["command"] == "python run_experiment_matrix.py --fast"


def test_strategy_evaluation_analysis_recommends_next_experiments_from_failures():
    summary = summarize_evaluations(
        [
            {
                "campaign_id": "camp-fib",
                "symbol": "BTCUSDC",
                "tf": "15m",
                "score": 0.3,
                "metrics": {
                    "paper_eligible": 0.0,
                    "paper_fail_oos_profit_factor": 1.0,
                    "paper_fail_oos_return": 1.0,
                    "paper_fail_wf_positive_frac": 1.0,
                    "paper_fail_mc_profit_factor": 1.0,
                },
            }
        ],
        top_n=1,
    )

    actions = [item["action"] for item in summary["recommendations"]]
    assert actions == [
        "compare_exit_modes_and_expand_search",
        "favor_walk_forward_stability",
        "reduce_noise_sensitivity",
    ]


def test_strategy_evaluation_analysis_recommends_budgeted_rerun():
    summary = summarize_evaluations(
        [
            {
                "campaign_id": "camp-budget",
                "symbol": "BTCUSDC",
                "tf": "1m",
                "score": 0.1,
                "metrics": {
                    "paper_eligible": 0.0,
                    "time_budget_exhausted": 1.0,
                    "paper_fail_not_robustly_validated": 1.0,
                },
            }
        ],
        top_n=1,
    )

    assert summary["time_budget_exhausted"] == 1
    assert summary["recommendations"][0]["action"] == "increase_time_budget_or_narrow_search"
    assert "--time-budget-sec 900" in summary["recommendations"][0]["command_hint"]


def test_strategy_evaluation_analysis_groups_recommendations_by_symbol_tf():
    summary = summarize_evaluations(
        [
            {
                "campaign_id": "btc-camp",
                "symbol": "BTCUSDC",
                "tf": "15m",
                "score": 0.4,
                "metrics": {
                    "paper_eligible": 0.0,
                    "paper_fail_oos_return": 1.0,
                },
            },
            {
                "campaign_id": "eth-camp",
                "symbol": "ETHUSDC",
                "tf": "1h",
                "score": 0.8,
                "metrics": {
                    "paper_eligible": 1.0,
                    "oos_return_pct": 2.0,
                    "oos_profitFactor": 1.3,
                },
            },
        ],
        top_n=2,
    )

    scopes = {(row["symbol"], row["tf"]): row for row in summary["scope_summaries"]}

    assert scopes[("BTCUSDC", "15m")]["status"] == "needs_more_experiments"
    assert scopes[("BTCUSDC", "15m")]["recommendations"][0]["action"] == "compare_exit_modes_and_expand_search"
    assert scopes[("ETHUSDC", "1h")]["status"] == "analysis_passed"
    assert scopes[("ETHUSDC", "1h")]["recommendations"][0]["action"] == "list_paper_candidates"
    assert (
        scopes[("ETHUSDC", "1h")]["recommendations"][0]["command_hint"]
        == "python list_paper_candidates.py --symbol ETHUSDC --tf 1h"
    )


def test_strategy_evaluation_analysis_reports_missing_expected_scopes():
    summary = summarize_evaluations(
        [
            {
                "campaign_id": "btc-camp",
                "symbol": "BTCUSDC",
                "tf": "15m",
                "score": 0.4,
                "metrics": {"paper_eligible": 0.0, "paper_fail_oos_return": 1.0},
            }
        ],
        top_n=2,
        expected_symbols=["BTCUSDC", "ETHUSDC"],
        expected_timeframes=["15m"],
    )

    scopes = {(row["symbol"], row["tf"]): row for row in summary["scope_summaries"]}

    assert summary["scope_coverage"] == {
        "total": 2,
        "analysis_passed": 0,
        "needs_more_experiments": 1,
        "missing_evaluations": 1,
    }
    assert scopes[("ETHUSDC", "15m")]["status"] == "missing_evaluations"
    assert (
        scopes[("ETHUSDC", "15m")]["recommendations"][0]["command_hint"]
        == "python run_experiment_matrix.py --symbols ETHUSDC --timeframes 15m --fast"
    )
    assert any(
        item["command"] == "python run_experiment_matrix.py --symbols ETHUSDC --timeframes 15m --fast"
        for item in summary["experiment_plan"]["commands"]
    )


def test_strategy_evaluation_analysis_scope_recommendations_use_targeted_matrix_commands():
    summary = summarize_evaluations(
        [
            {
                "campaign_id": "eth-camp",
                "symbol": "ETHUSDC",
                "tf": "4h",
                "score": 0.2,
                "metrics": {"paper_eligible": 0.0, "paper_fail_wf_positive_frac": 1.0},
            }
        ],
        top_n=1,
    )

    recommendation = summary["scope_summaries"][0]["recommendations"][0]

    assert recommendation["action"] == "favor_walk_forward_stability"
    assert recommendation["command_hint"].startswith(
        "python run_experiment_matrix.py --symbols ETHUSDC --timeframes 4h --fast"
    )


def test_strategy_evaluation_analysis_experiment_plan_deduplicates_commands():
    summary = {
        "scope_summaries": [
            {
                "symbol": "BTCUSDC",
                "tf": "15m",
                "recommendations": [
                    {
                        "action": "favor_walk_forward_stability",
                        "reason": "same command",
                        "command_hint": "python run_experiment_matrix.py --symbols BTCUSDC --timeframes 15m --fast",
                    },
                    {
                        "action": "favor_walk_forward_stability",
                        "reason": "same command again",
                        "command_hint": "python   run_experiment_matrix.py   --symbols BTCUSDC --timeframes 15m --fast",
                    },
                ],
            }
        ],
        "recommendations": [
            {
                "action": "favor_walk_forward_stability",
                "reason": "same global command",
                "command_hint": "python run_experiment_matrix.py --symbols BTCUSDC --timeframes 15m --fast",
            }
        ],
    }

    plan = build_experiment_plan(summary)

    assert [item["command"] for item in plan["commands"]] == [
        "python run_experiment_matrix.py --symbols BTCUSDC --timeframes 15m --fast"
    ]


def test_strategy_evaluation_analysis_experiment_plan_separates_manual_paper_actions():
    summary = summarize_evaluations(
        [
            {
                "campaign_id": "eth-camp",
                "symbol": "ETHUSDC",
                "tf": "1h",
                "score": 0.8,
                "metrics": {
                    "paper_eligible": 1.0,
                    "oos_return_pct": 2.0,
                    "oos_profitFactor": 1.3,
                },
            }
        ],
        top_n=1,
    )

    plan = summary["experiment_plan"]

    assert plan["commands"] == [
        {
            "category": "paper_or_live",
            "action": "list_paper_candidates",
            "source": "ETHUSDC 1h",
            "command": "python list_paper_candidates.py --symbol ETHUSDC --tf 1h",
            "reason": "Resolve the exact Supabase strategy id before starting paper for ETHUSDC 1h eth-camp.",
        }
    ]
    assert [item["category"] for item in plan["manual_actions"]] == [
        "paper_or_live",
        "paper_or_live",
        "paper_or_live",
    ]
    assert [item["source"] for item in plan["manual_actions"]] == ["ETHUSDC 1h", "ETHUSDC 1h", "ETHUSDC 1h"]
    assert "--strategy-id <heaven_strategies.id>" in plan["manual_actions"][0]["instruction"]
    assert "--strategy-id <heaven_strategies.id>" in plan["manual_actions"][2]["instruction"]
