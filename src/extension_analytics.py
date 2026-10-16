"""Analytics helpers for AquaGuard Prompt Optimizer statistics.

This module is deliberately free of Streamlit code so it can be unit-tested.
It reads two kinds of files, both documented in docs/EXTENSION_STATS_SCHEMA.md:

* a statistics export from the browser extension (aggregate counts only,
  never prompt text), and
* the offline evaluation results produced by ``npm run eval``.

These numbers are kept completely separate from the synthetic sensor data
used by the water-monitoring dashboard (data/*.csv).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

STATS_SCHEMA = "aquaguard.prompt-optimizer.stats"
EVAL_SCHEMA = "aquaguard.prompt-optimizer.eval"
SUPPORTED_VERSION = 1

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_DATA_DIR = REPO_ROOT / "data" / "extension"
USER_STATS_FILE = EXTENSION_DATA_DIR / "extension_stats.json"  # your own export (git-ignored)
SAMPLE_STATS_FILE = EXTENSION_DATA_DIR / "extension_stats_sample.json"  # synthetic sample
EVAL_RESULTS_FILE = EXTENSION_DATA_DIR / "prompt_eval_results.json"

TOTAL_FIELDS = (
    "optimizationRuns",
    "runsWithSuggestion",
    "runsUnchanged",
    "latencyMsTotal",
    "promptsCompleted",
    "promptsOptimized",
    "promptsLeftUnchanged",
    "promptsDeclined",
    "applyActions",
    "autoApplied",
    "undoActions",
    "originalTokensApplied",
    "optimizedTokensApplied",
    "tokensSaved",
    "tokensSavedUndone",
    "reductionPctSum",
)
DAILY_FIELDS = (
    "optimizationRuns",
    "runsUnchanged",
    "promptsOptimized",
    "promptsLeftUnchanged",
    "promptsDeclined",
    "tokensSaved",
    "tokensSavedUndone",
)


class StatsFormatError(ValueError):
    """Raised when a file is not a valid AquaGuard statistics export."""


def _non_negative(value: Any) -> float:
    """Convert to a finite, non-negative float (anything else becomes 0)."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(number) or math.isinf(number) or number < 0:
        return 0.0
    return number


def parse_stats(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate an extension statistics export and return a cleaned copy.

    Unknown keys are dropped, so even a tampered file cannot smuggle text
    into the dashboard.
    """
    if not isinstance(raw, dict) or raw.get("schema") != STATS_SCHEMA:
        raise StatsFormatError("Not an AquaGuard statistics export (wrong or missing 'schema').")
    if raw.get("schemaVersion") != SUPPORTED_VERSION:
        raise StatsFormatError(f"Unsupported schemaVersion {raw.get('schemaVersion')!r}.")

    totals_in = raw.get("totals") or {}
    totals = {field: _non_negative(totals_in.get(field)) for field in TOTAL_FIELDS}

    daily = []
    for row in raw.get("daily") or []:
        if not isinstance(row, dict):
            continue
        date = str(row.get("date", ""))[:10]
        try:
            pd.Timestamp(date)
        except (ValueError, TypeError):
            continue
        daily.append({"date": date, **{f: _non_negative(row.get(f)) for f in DAILY_FIELDS}})

    transformations = {
        str(k)[:40]: _non_negative(v)
        for k, v in (raw.get("transformations") or {}).items()
        if isinstance(k, str)
    }
    tokenizer = raw.get("tokenizer") or {}
    return {
        "totals": totals,
        "daily": daily,
        "transformations": transformations,
        "sample": bool(raw.get("sampleData")),
        "exported_at": str(raw.get("exportedAt", ""))[:40],
        "extension_version": str(raw.get("extensionVersion") or "")[:20],
        "tokenizer_exact": bool(tokenizer.get("exact", False)),
        "tokenizer_id": str(tokenizer.get("id", "unknown"))[:40],
    }


def load_stats_file(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return parse_stats(json.load(fh))


def load_stats_bytes(data: bytes) -> dict[str, Any]:
    try:
        raw = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StatsFormatError(f"File is not valid JSON: {exc}") from exc
    return parse_stats(raw)


def default_stats_source() -> tuple[Path | None, str]:
    """Pick the user's own export if present, otherwise the synthetic sample."""
    if USER_STATS_FILE.exists():
        return USER_STATS_FILE, "your exported statistics (data/extension/extension_stats.json)"
    if SAMPLE_STATS_FILE.exists():
        return SAMPLE_STATS_FILE, "SYNTHETIC SAMPLE data (data/extension/extension_stats_sample.json)"
    return None, "no statistics file"


@dataclass(frozen=True)
class StatsSummary:
    prompts_optimized: int
    prompts_left_unchanged: int
    prompts_declined: int
    net_tokens_saved: int
    average_reduction_pct: float
    average_latency_ms: float
    optimization_runs: int
    apply_actions: int
    undo_actions: int


def summarize(stats: dict[str, Any]) -> StatsSummary:
    """Derived metrics. Same formulas as summarizeStats() in the extension."""
    t = stats["totals"]
    applies = t["applyActions"]
    runs = t["optimizationRuns"]
    return StatsSummary(
        prompts_optimized=int(t["promptsOptimized"]),
        prompts_left_unchanged=int(t["promptsLeftUnchanged"]),
        prompts_declined=int(t["promptsDeclined"]),
        net_tokens_saved=int(max(0.0, t["tokensSaved"] - t["tokensSavedUndone"])),
        average_reduction_pct=t["reductionPctSum"] / applies if applies else 0.0,
        average_latency_ms=t["latencyMsTotal"] / runs if runs else 0.0,
        optimization_runs=int(runs),
        apply_actions=int(applies),
        undo_actions=int(t["undoActions"]),
    )


def reduction_percent(original_tokens: float, optimized_tokens: float) -> float:
    """100 x (original - optimized) / original, with 0 for empty input."""
    if original_tokens <= 0:
        return 0.0
    return 100.0 * (original_tokens - optimized_tokens) / original_tokens


def daily_frame(stats: dict[str, Any]) -> pd.DataFrame:
    frame = pd.DataFrame(stats["daily"], columns=["date", *DAILY_FIELDS])
    if frame.empty:
        return frame
    frame["date"] = pd.to_datetime(frame["date"])
    frame["netTokensSaved"] = (frame["tokensSaved"] - frame["tokensSavedUndone"]).clip(lower=0)
    return frame.sort_values("date").reset_index(drop=True)


RULE_LABELS = {
    "greeting": "Opening greeting",
    "pleasantry": "Pleasantry / sign-off",
    "request-preamble": '"Could you please..." preamble',
    "want-preamble": '"I would like you to..." preamble',
    "please-prefix": 'Leading "please"',
    "please-suffix": 'Trailing "please"',
    "help-me": '"Help me ..." shortening',
    "hedge-intro": 'Openers ("So,", "Basically,")',
    "verbose-phrase": "Verbose phrase",
    "kindly": '"kindly"',
    "filler-word": "Filler word",
    "doubled-word": "Doubled word",
    "duplicate-sentence": "Repeated instruction",
    "whitespace": "Extra whitespace",
}


def transformation_frame(stats: dict[str, Any]) -> pd.DataFrame:
    rows = [
        {"rule": RULE_LABELS.get(rule, rule), "ruleId": rule, "count": int(count)}
        for rule, count in stats["transformations"].items()
    ]
    frame = pd.DataFrame(rows, columns=["rule", "ruleId", "count"])
    return frame.sort_values("count", ascending=False).reset_index(drop=True)


# --------------------------------------------------------------- evaluation


def load_eval(path: Path = EVAL_RESULTS_FILE) -> dict[str, Any] | None:
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if data.get("schema") != EVAL_SCHEMA:
        return None
    return data


EVAL_METRIC_LABELS = {
    "prompts": "Prompts evaluated",
    "changed": "Prompts compressed",
    "unchanged": "Prompts left unchanged",
    "expectationAccuracy": "Compress / don't-compress decisions correct (%)",
    "mustPreserveRate": "Required phrases preserved (%)",
    "termPreservationRate": "Numbers, negations and constraints preserved (%)",
    "falseCompressions": "Should-not-compress prompts that were changed",
    "shouldNotCompressCases": "Should-not-compress prompts in dataset",
    "meanReductionPctChangedOnly": "Mean reduction, compressed prompts only (%)",
    "meanReductionPctAllPrompts": "Mean reduction, all prompts (%)",
    "aggregateReductionPctExact": "Total token reduction, o200k_base (%)",
    "latencyMsMedian": "Median latency (ms)",
    "latencyMsMax": "Slowest prompt latency (ms)",
}


def eval_summary_frame(evaluation: dict[str, Any]) -> pd.DataFrame:
    """One row per metric, one column per compression level."""
    summary = evaluation.get("summary", {})
    levels = list(summary.keys())
    rows = []
    for key, label in EVAL_METRIC_LABELS.items():
        rows.append({"Metric": label, **{lvl: summary[lvl].get(key) for lvl in levels}})
    return pd.DataFrame(rows)


def eval_category_frame(evaluation: dict[str, Any], level: str = "conservative") -> pd.DataFrame:
    cats = evaluation.get("categories", {}).get(level, {})
    rows = [
        {
            "Category": name,
            "Prompts": c.get("prompts"),
            "Compressed": c.get("changed"),
            "Decisions correct (%)": c.get("expectationAccuracy"),
            "Terms preserved (%)": c.get("termPreservationRate"),
            "Mean reduction, compressed (%)": c.get("meanReductionPctChangedOnly"),
        }
        for name, c in cats.items()
    ]
    return pd.DataFrame(rows)


# ------------------------------------------------------------------- impact


@dataclass(frozen=True)
class ImpactEstimate:
    available: bool
    reason: str = ""
    energy_wh_low: float = 0.0
    energy_wh_high: float = 0.0
    water_ml_low: float = 0.0
    water_ml_high: float = 0.0


def estimate_impact(
    tokens_saved: float,
    energy_wh_per_1k_low: float | None,
    energy_wh_per_1k_high: float | None,
    water_l_per_kwh_low: float | None,
    water_l_per_kwh_high: float | None,
) -> ImpactEstimate:
    """Illustrative scenario only. Mirrors estimateImpact() in extension/src/engine/impact.js.

    There is no default coefficient: if any assumption is missing the result
    is 'unavailable', because a made-up litres-per-token factor would be
    misleading.
    """
    values = [energy_wh_per_1k_low, energy_wh_per_1k_high, water_l_per_kwh_low, water_l_per_kwh_high]
    if any(v is None or not math.isfinite(v) or v < 0 for v in values):
        return ImpactEstimate(False, "Enter all four low/high assumptions to see an illustrative scenario.")
    if energy_wh_per_1k_low > energy_wh_per_1k_high or water_l_per_kwh_low > water_l_per_kwh_high:
        return ImpactEstimate(False, "Each low assumption must be less than or equal to its high assumption.")
    tokens = max(0.0, float(tokens_saved))
    e_low = tokens / 1000 * energy_wh_per_1k_low
    e_high = tokens / 1000 * energy_wh_per_1k_high
    return ImpactEstimate(
        True,
        "",
        e_low,
        e_high,
        e_low / 1000 * water_l_per_kwh_low * 1000,
        e_high / 1000 * water_l_per_kwh_high * 1000,
    )
