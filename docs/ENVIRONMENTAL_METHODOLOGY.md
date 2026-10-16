# Environmental impact methodology

AquaGuard distinguishes three quantities and never mixes them up:

| # | Quantity | Status in AquaGuard |
|---|---|---|
| 1 | **Input tokens removed** from your prompt | Observed in your text, counted with a local **estimate** |
| 2 | **Inference energy** avoided | Not measured. Only an *illustrative* scenario from your assumptions |
| 3 | **Operational water** avoided | Not measured. Only an *illustrative* scenario from your assumptions |

## Why energy and water are "unavailable" by default

Converting (1) into (2) needs a coefficient: energy per input token for a specific model on a specific serving stack. AI providers have not published verified per-input-token figures for the chat services AquaGuard supports. Published estimates vary by orders of magnitude depending on the model size, hardware, batching, prompt caching, and whether idle and overhead power are included. Input (prefill) tokens are also much cheaper per token than generated output tokens, so a per-prompt or per-output-token figure cannot be reused for input tokens.

Converting (2) into (3) needs a water intensity: on-site cooling water per kWh (depends on cooling technology and climate) and, optionally, off-site water used to generate the electricity (depends on the grid mix).

Picking a single number for either step would produce precise-looking but unsupported claims. AquaGuard therefore shows token savings only, unless you opt in to an illustrative scenario.

## Illustrative scenario formula

You enter four numbers (low and high for each assumption):

```
energy_Wh   = tokens_saved / 1000 × Wh_per_1000_input_tokens        (low, high)
water_mL    = energy_Wh / 1000 × litres_per_kWh × 1000              (low, high)
```

The result is labelled *"Illustrative scenario … not a measurement"* in the extension and the dashboard. The same formula is implemented in `extension/src/engine/impact.js` and `src/extension_analytics.py`, and both are unit-tested.

## Background sources (context, not coefficients)

- Shehabi et al. (2016), *United States Data Center Energy Usage Report*, Lawrence Berkeley National Laboratory. Often-cited average on-site water use of about **1.8 L per kWh** for US data centers (mid-2010s). Individual sites range from near zero (dry cooling) to much higher.
- Google (2025), *Measuring the environmental impact of delivering AI at Google scale*. Reports a median Gemini Apps text prompt at about **0.24 Wh** and **0.26 mL** of water. This is per **whole prompt** (including output generation) on Google's fleet, **not** per input token.

Please check these sources yourself before relying on them. They help you choose a plausible *range*; they do not make the scenario a measurement.

## The water dashboard is simulated

The Water Monitor page (`app.py`) uses synthetic sensor data from `src/generate_data.py`. Its litres are not measurements and are never presented as savings from the extension.
