"""Unit tests for src/extension_analytics.py (no Streamlit needed)."""

import json
import math

import pytest

import extension_analytics as ea


def make_export(**overrides):
    data = {
        "schema": ea.STATS_SCHEMA,
        "schemaVersion": 1,
        "exportedAt": "2026-10-17T00:00:00Z",
        "tokenizer": {"id": "heuristic-bpe-v1", "exact": False},
        "totals": {field: 0 for field in ea.TOTAL_FIELDS},
        "daily": [],
        "transformations": {},
    }
    data.update(overrides)
    return data


def test_reduction_percent_formula_and_edge_cases():
    assert ea.reduction_percent(100, 75) == 25
    assert ea.reduction_percent(8, 6) == 25
    assert ea.reduction_percent(0, 0) == 0
    assert ea.reduction_percent(-5, 0) == 0


def test_summary_metrics_match_extension_formulas():
    totals = {field: 0 for field in ea.TOTAL_FIELDS}
    totals.update(
        optimizationRuns=4,
        latencyMsTotal=6,
        applyActions=2,
        reductionPctSum=50,
        tokensSaved=30,
        tokensSavedUndone=5,
        promptsOptimized=1,
        promptsLeftUnchanged=2,
        promptsDeclined=1,
        undoActions=1,
    )
    stats = ea.parse_stats(make_export(totals=totals))
    s = ea.summarize(stats)
    assert s.net_tokens_saved == 25
    assert s.average_reduction_pct == 25
    assert s.average_latency_ms == 1.5
    assert s.prompts_optimized == 1
    assert s.prompts_left_unchanged == 2
    assert s.prompts_declined == 1


def test_zero_activity_does_not_divide_by_zero():
    s = ea.summarize(ea.parse_stats(make_export()))
    assert s.average_reduction_pct == 0
    assert s.average_latency_ms == 0
    assert s.net_tokens_saved == 0


def test_rejects_wrong_schema_and_version():
    with pytest.raises(ea.StatsFormatError):
        ea.parse_stats({"schema": "something-else"})
    with pytest.raises(ea.StatsFormatError):
        ea.parse_stats(make_export(schemaVersion=99))
    with pytest.raises(ea.StatsFormatError):
        ea.load_stats_bytes(b"not json")


def test_parse_drops_unknown_fields_and_bad_values():
    raw = make_export(
        totals={"tokensSaved": "12", "applyActions": -3, "promptText": "secret"},
        daily=[{"date": "2026-10-01", "tokensSaved": 5, "prompt": "secret"}, {"date": "garbage"}, "x"],
        transformations={"greeting": 3},
        prompt="secret",
    )
    stats = ea.parse_stats(raw)
    assert stats["totals"]["tokensSaved"] == 12
    assert stats["totals"]["applyActions"] == 0
    assert "secret" not in json.dumps(stats)
    assert len(stats["daily"]) == 1


def test_daily_and_transformation_frames():
    raw = make_export(
        daily=[
            {"date": "2026-10-02", "tokensSaved": 10, "tokensSavedUndone": 2, "promptsOptimized": 1},
            {"date": "2026-10-01", "tokensSaved": 4},
        ],
        transformations={"greeting": 2, "verbose-phrase": 5},
    )
    stats = ea.parse_stats(raw)
    daily = ea.daily_frame(stats)
    assert list(daily["date"].dt.strftime("%Y-%m-%d")) == ["2026-10-01", "2026-10-02"]
    assert list(daily["netTokensSaved"]) == [4, 8]
    rules = ea.transformation_frame(stats)
    assert list(rules["ruleId"]) == ["verbose-phrase", "greeting"]


def test_sample_file_is_valid_and_marked_synthetic():
    stats = ea.load_stats_file(ea.SAMPLE_STATS_FILE)
    assert stats["sample"] is True
    assert stats["tokenizer_exact"] is False
    assert ea.summarize(stats).prompts_optimized > 0


def test_eval_results_load_and_summarize():
    evaluation = ea.load_eval()
    assert evaluation is not None, "run `npm run eval` in extension/ first"
    frame = ea.eval_summary_frame(evaluation)
    assert {"Metric", "conservative", "balanced"} <= set(frame.columns)
    assert len(ea.eval_category_frame(evaluation)) >= 8
    # The dashboard copy must not contain prompt text.
    for row in evaluation["rows"]:
        assert "original" not in row and "optimized" not in row


def test_impact_unavailable_without_assumptions():
    r = ea.estimate_impact(1000, None, None, None, None)
    assert r.available is False
    assert ea.estimate_impact(1000, 1, 0.5, 1, 2).available is False  # low > high
    assert ea.estimate_impact(1000, -1, 1, 1, 2).available is False
    assert ea.estimate_impact(1000, float("nan"), 1, 1, 2).available is False


def test_impact_illustrative_arithmetic_matches_extension():
    r = ea.estimate_impact(2000, 0.1, 0.5, 0.5, 2)
    assert r.available
    assert math.isclose(r.energy_wh_low, 0.2)
    assert math.isclose(r.energy_wh_high, 1.0)
    assert math.isclose(r.water_ml_low, 0.1)
    assert math.isclose(r.water_ml_high, 2.0)
