"""Smoke tests: both Streamlit pages run without exceptions and show their core content.

Uses Streamlit's built-in AppTest, which executes the script in-process.
The original dashboard reads data/*.csv relative to the repository root, so
each test runs from there.
"""

import pandas as pd
import pytest
from streamlit.testing.v1 import AppTest

from conftest import REPO_ROOT


@pytest.fixture(autouse=True)
def run_from_repo_root(monkeypatch):
    monkeypatch.chdir(REPO_ROOT)


def test_water_dashboard_runs_and_shows_core_metrics():
    at = AppTest.from_file(str(REPO_ROOT / "app.py"), default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.title[0].value == "💧 AquaGuard"
    labels = [m.label for m in at.metric]
    assert labels == ["Total Water Consumption", "Anomalies Detected", "Estimated Excess Water"]

    # Core analytics still agree with the data files.
    df = pd.read_csv(REPO_ROOT / "data" / "water_wastage_results.csv")
    assert at.metric[0].value == f"{df['water_consumption_liters'].sum():,.0f} L"
    assert at.metric[1].value == str((df["anomaly"] == -1).sum())
    assert at.metric[2].value == f"{df['estimated_excess_water'].sum():,.0f} L"
    assert len(at.dataframe) == 2  # waste events + recommendations
    assert any("simulated" in i.value for i in at.info)


def test_prompt_optimizer_page_runs_with_sample_and_eval_data():
    at = AppTest.from_file(str(REPO_ROOT / "pages" / "1_Prompt_Optimizer.py"), default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.title[0].value == "💧 Prompt Optimizer Analytics"
    labels = [m.label for m in at.metric]
    assert "Prompts optimized" in labels
    assert "Estimated tokens saved (net)" in labels
    assert "Average compression latency" in labels
    # sample data must be labelled as synthetic unless the user has their own export
    from extension_analytics import USER_STATS_FILE

    if not USER_STATS_FILE.exists():
        assert any("synthetic sample data" in w.value for w in at.warning)
    # impact stays unavailable by default
    assert any("unavailable" in i.value for i in at.info)
