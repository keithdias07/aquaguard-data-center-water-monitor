"""Streamlit page: AquaGuard Prompt Optimizer analytics.

Shows aggregate statistics exported from the browser extension and the
offline compression-quality evaluation. Nothing here is mixed with the
simulated sensor data on the main dashboard page.
"""

import sys
from pathlib import Path

import plotly.express as px
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import extension_analytics as ea  # noqa: E402  (path set up above)

st.set_page_config(page_title="AquaGuard · Prompt Optimizer", page_icon="💧", layout="wide")

st.title("💧 Prompt Optimizer Analytics")
st.write(
    "Aggregate results from the AquaGuard Chrome extension, which shortens AI prompts "
    "locally before you send them."
)

with st.expander("What these numbers are (and are not)", expanded=False):
    st.markdown(
        """
| Kind of number | Where it comes from | Status |
|---|---|---|
| **Observed token reduction** | Counted by the extension when you click Apply | **Estimated** token counts (local heuristic, not the provider's tokenizer) |
| **Evaluation results** | `npm run eval` on a fixed set of synthetic test prompts | Exact `o200k_base` token counts; automated meaning checks only |
| **Energy / water** | Your own assumptions in the box below | **Illustrative only**, not measured, off by default |
| **Sensor data on the main page** | `src/generate_data.py` | **Simulated**, unrelated to the extension |

AquaGuard cannot see what you finally send, so "tokens saved" means *saved in the text at the moment you applied
the optimization*. Fewer tokens do not guarantee an equally good answer; see the evaluation section.
"""
    )

# ------------------------------------------------------------- data source

uploaded = st.file_uploader(
    "Load a statistics export (Extension settings → Export statistics). It is read in memory and not saved.",
    type=["json"],
)

stats = None
source_label = ""
if uploaded is not None:
    try:
        stats = ea.load_stats_bytes(uploaded.getvalue())
        source_label = f"uploaded file `{uploaded.name}`"
    except ea.StatsFormatError as exc:
        st.error(f"Could not read that file: {exc}")

if stats is None:
    path, source_label = ea.default_stats_source()
    if path is not None:
        try:
            stats = ea.load_stats_file(path)
        except (ea.StatsFormatError, OSError, ValueError) as exc:
            st.error(f"Could not read {path.name}: {exc}")

if stats is None:
    st.info("No statistics yet. Turn on statistics in the extension settings, then export them here.")
else:
    if stats["sample"]:
        st.warning(
            "Showing **synthetic sample data** so the charts are not empty. These are not real usage numbers. "
            "Upload your own export above, or save it as `data/extension/extension_stats.json`."
        )
    st.caption(
        f"Source: {source_label} · exported {stats['exported_at'] or 'unknown'} · "
        f"token counts are {'exact' if stats['tokenizer_exact'] else 'ESTIMATES'} ({stats['tokenizer_id']})"
    )

    summary = ea.summarize(stats)
    c1, c2, c3 = st.columns(3)
    c1.metric("Prompts optimized", f"{summary.prompts_optimized:,}", help="Prompts sent or cleared after you applied an optimization.")
    c2.metric("Estimated tokens saved (net)", f"{summary.net_tokens_saved:,}", help="Tokens removed by applied optimizations, minus undone ones. Estimated counts.")
    c3.metric("Average reduction", f"{summary.average_reduction_pct:.1f}%", help="Mean of 100 × (original − optimized) / original over applied optimizations.")
    c4, c5, c6 = st.columns(3)
    c4.metric("Average compression latency", f"{summary.average_latency_ms:.2f} ms")
    c5.metric("Prompts left unchanged", f"{summary.prompts_left_unchanged:,}", help="No safe optimization was found.")
    c6.metric("Suggestions not applied", f"{summary.prompts_declined:,}")

    daily = ea.daily_frame(stats)
    if not daily.empty:
        st.subheader("Estimated tokens saved per day")
        fig = px.bar(
            daily,
            x="date",
            y="netTokensSaved",
            labels={"date": "Day", "netTokensSaved": "Estimated tokens saved (net)"},
            color_discrete_sequence=["#0891b2"],
        )
        st.plotly_chart(fig, width="stretch")

        st.subheader("Prompt outcomes per day")
        outcomes = daily.melt(
            id_vars="date",
            value_vars=["promptsOptimized", "promptsDeclined", "promptsLeftUnchanged"],
            var_name="outcome",
            value_name="prompts",
        )
        outcomes["outcome"] = outcomes["outcome"].map(
            {
                "promptsOptimized": "Optimized",
                "promptsDeclined": "Suggestion not applied",
                "promptsLeftUnchanged": "No safe optimization",
            }
        )
        fig2 = px.bar(
            outcomes,
            x="date",
            y="prompts",
            color="outcome",
            labels={"date": "Day", "prompts": "Prompts", "outcome": "Outcome"},
            color_discrete_sequence=["#0891b2", "#94a3b8", "#1e3a8a"],
        )
        st.plotly_chart(fig2, width="stretch")

    rules = ea.transformation_frame(stats)
    if not rules.empty:
        st.subheader("What the optimizer removed most often")
        fig3 = px.bar(
            rules,
            x="count",
            y="rule",
            orientation="h",
            labels={"count": "Applied optimizations using this rule", "rule": ""},
            color_discrete_sequence=["#2563eb"],
        )
        fig3.update_layout(yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(fig3, width="stretch")

# --------------------------------------------------------- quality results

st.header("Compression quality evaluation")
evaluation = ea.load_eval()
if evaluation is None:
    st.info("No evaluation results found. Run `npm run eval` in the `extension/` folder.")
else:
    st.write(
        f"{evaluation['dataset']['prompts']} synthetic test prompts "
        "(simple questions, code, long technical prompts, multi-step instructions, numbers and units, "
        "constraints and negations, JSON/Markdown output, and prompts that must not be changed). "
        f"Generated {evaluation['generatedAt'][:10]}, engine {evaluation['engineVersion']}."
    )
    st.dataframe(ea.eval_summary_frame(evaluation), hide_index=True, width="stretch")
    st.caption(
        "Automated checks confirm that required phrases, numbers, negations and constraints survive. "
        "They do not prove that a model gives an equally good answer to the shorter prompt, which needs "
        "output-level evaluation. The dataset was also used while developing the rules, so treat these "
        "scores as optimistic."
    )
    with st.expander("Results by prompt category (conservative level)"):
        st.dataframe(ea.eval_category_frame(evaluation), hide_index=True, width="stretch")
    cal = evaluation.get("calibration")
    if cal:
        st.caption(
            f"Heuristic token estimates vs exact {cal['reference']}: mean absolute error "
            f"{cal['meanAbsPctError']}%, within ±10% on {cal['within10Pct']}% of {cal['samples']} texts."
        )

# ------------------------------------------------------------------ impact

st.header("Environmental impact (illustrative)")
st.markdown(
    "Removing input tokens reduces the work a model does to read your prompt, but **AquaGuard does not "
    "measure energy or water**. Providers do not publish verified per-input-token energy figures for "
    "these chat services, so this section stays **unavailable** unless you enter your own assumptions."
)
tokens_for_impact = ea.summarize(stats).net_tokens_saved if stats else 0
with st.expander("Build an illustrative scenario from your own assumptions"):
    col_a, col_b = st.columns(2)
    e_low = col_a.number_input("Energy, low (Wh per 1,000 input tokens)", min_value=0.0, value=None, format="%.6f")
    e_high = col_b.number_input("Energy, high (Wh per 1,000 input tokens)", min_value=0.0, value=None, format="%.6f")
    w_low = col_a.number_input("Water intensity, low (L per kWh)", min_value=0.0, value=None, format="%.3f")
    w_high = col_b.number_input("Water intensity, high (L per kWh)", min_value=0.0, value=None, format="%.3f")
    st.caption(
        "Context, not per-token factors: Shehabi et al. (2016, LBNL) report roughly 1.8 L of on-site water per kWh "
        "for US data centers; Google (2025) reports a median Gemini Apps text prompt at about 0.24 Wh and 0.26 mL "
        "of water per whole prompt."
    )
impact = ea.estimate_impact(tokens_for_impact, e_low, e_high, w_low, w_high)
if impact.available:
    st.info(
        f"**Illustrative scenario, not a measurement.** For {tokens_for_impact:,} estimated tokens saved: "
        f"{impact.energy_wh_low:.4g}–{impact.energy_wh_high:.4g} Wh and "
        f"{impact.water_ml_low:.4g}–{impact.water_ml_high:.4g} mL of water, using your assumptions."
    )
else:
    st.info(f"Environmental impact: **unavailable**. {impact.reason}")
