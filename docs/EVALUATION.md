# Evaluation methodology

How the AquaGuard compressor is evaluated, what the numbers mean, and what they do **not** show.

## What is measured

`npm run eval` (in `extension/`) runs every prompt in `extension/eval/prompts.json` through the compressor at both levels (`conservative`, `balanced`) and records:

| Metric | How |
|---|---|
| **Token reduction** | Heuristic estimate (what the extension shows) **and** exact `o200k_base` counts via `js-tiktoken`. Reduction = `100 × (original − optimized) / original`; 0 for empty input. |
| **Decision accuracy** | Each prompt is labelled `compress`, `unchanged` or `either`. Correct if the compressor's choice matches. |
| **Required-phrase preservation** | `mustPreserve` substrings (case-insensitive) must appear in the output. |
| **Term preservation** | Every distinct number, negation and constraint term in the original (e.g. `42`, `not`, `only`, `at least`) must still appear. Documented exceptions: `whether or not` → `whether`, and terms listed in a prompt's `allowedLoss` (a recorded human judgement, e.g. "any" in "Any help would be appreciated"). |
| **False compressions** | Prompts labelled `unchanged` that were modified. |
| **Latency** | Median of 25 runs per prompt after a warm-up run (Node 24, laptop CPU). In the browser the first run on a page is slower (JIT warm-up, ~20–30 ms). |
| **Tokenizer calibration** | Heuristic vs `o200k_base` on all original and optimized texts. |

## Dataset

52 hand-written **synthetic** prompts (none collected from users) in 10 categories: simple questions, coding, long technical prompts, multi-step instructions, numbers and units, constraints and negations, structured JSON/Markdown output, verbose prompts, a long regression prompt, and prompts that must not be compressed (quoted text to translate, text to proofread, tables, near-duplicate but different instructions, non-English text, capability questions such as "Can you remember previous conversations?", a re-stated audience with no earlier self-description).

## Results (engine 1.0.0 + multi-pass rules, extension 0.2.0, 2026-10-17)

| Metric | Conservative | Balanced (default) |
|---|---|---|
| Prompts compressed | 31 / 52 | 31 / 52 |
| Decision accuracy | 100% | 100% |
| Required phrases preserved | 100% | 100% |
| Numbers / negations / constraints preserved | 100% | 100% |
| False compressions | 0 / 17 | 0 / 17 |
| Mean reduction, compressed prompts (o200k) | 22.8% | 23.1% |
| Total reduction across dataset (o200k) | 18.9% | 19.1% |
| Median latency | ~0.27 ms | ~0.27 ms |

Previous version, for comparison (45 prompts): 20.6% mean reduction on compressed prompts, 15.8% total.

### User's original test prompt

`eval/regression/ml_learning_prompt_original.txt` (dataset id `regression-ml-original`).

| | Original | Optimized | Saved | Reduction |
|---|---|---|---|---|
| Estimated tokens, extension v0.1 | 239 | 228 | 11 | 4.6% |
| Estimated tokens, after automatic-mode release (before recap rule) | 239 | 219 | 20 | 8.4% |
| **Estimated tokens, now** | **239** | **177** | **62** | **25.9%** |
| Exact `o200k_base` | 226 | 167 | 59 | 26.1% |

This prompt has little social filler, so greeting/thanks rules barely help. The gains come from: removing the closing recap sentence (explicitly marked "As I mentioned earlier", 87.5% of its key words already present; the recap rule requires ≥85% and never drops numbers or negations), collapsing "simple and easy-to-understand" to "simple", turning "I want you to explain to me" / "I would like you to give me" into instructions, and dropping mid-sentence "please". All 13 requirements are checked in `tests/unit/regression-and-rules-v2.test.js`. The evaluation records one human judgement (`allowedLoss`): the words "all" and "requirements" only occur in the recap's meta clause "make sure that all of these requirements are included".

### Reconstructed regression prompt

`eval/regression/ml_learning_prompt.txt` was written from the requirements of the user's original test prompt before the original text was available, in a chattier style.

| | Original | Optimized | Saved | Reduction |
|---|---|---|---|---|
| Estimated tokens (heuristic) | 232 | 152 | 80 | 34.5% |
| Exact `o200k_base` | 222 | 144 | 78 | 35.1% |
| Before this change (heuristic) | 232 | 201 | 31 | 13.4% |

Requirements checked by `tests/unit/regression-and-rules-v2.test.js`, all preserved: exactly three real-world examples; healthcare; cybersecurity; exactly five numbered Python-learning steps; no advanced mathematical equations; at most 500 words; small Python code example at the end; beginner-friendly language; second-year computer engineering student; explain what machine learning is. The repeated "do not use advanced math equations" now appears once.

What changed in the engine: rules now also apply after a lead-in ("After that, could you also…"); additive transitions ("Also,") and "Keep in mind that" are dropped; "I would really like it if" becomes "Ideally,"; "explain to me" / "provide me with" are shortened; empty intensifiers ("actually is") are removed; reworded repeats are removed only when they normalise to *exactly* the same requirement (never a broader or narrower one); a re-stated self-description is removed only when the prompt already says "I am a …"; and the pipeline runs up to three passes until nothing changes. Every rewrite still goes through the same meaning guard.

Heuristic tokenizer vs `o200k_base`: **3.8%** mean absolute error, **+2.8%** mean signed error (slight overestimate), within ±10% for 87% of texts. A separate check (see `tokenizer.js` comments) found about 9% error on source code and up to about 30% **under**counting for rare, very long words.

The current numbers are in `data/extension/prompt_eval_results.json`, which the dashboard displays.

## Problems the evaluation caught during development

The first evaluation run failed several checks, and those failures led to fixes:

- **A real corruption bug:** `{"name": string}` became `{: string}`, because a quoted string masked inside a brace span was not restored. Fixed by restoring nested spans, plus a final check that no placeholder survives into the output.
- **Compressing material the user wanted edited:** "Proofread: Thank you so much for your help in order to…" was being shortened. Fixed by protecting text after a colon that follows cues such as *proofread, translate, review, paragraph, text, below*.
- **Over-protection:** a prose line mentioning `| a | b |` was treated as a table and skipped entirely.
- **Missed repeats:** repeated instructions containing quoted words were not deduplicated.

## Limitations: read before quoting these numbers

1. **Not a held-out test.** The same prompts guided rule development, so the scores are optimistic. A fresh, independently written dataset is needed for an unbiased estimate.
2. **Automated proxies, not output quality.** Preserving phrases, numbers and constraints is necessary but not sufficient for meaning preservation. **No model outputs were compared.** A shorter prompt can still change how a model responds (for example, removing politeness can change tone).
3. **Small dataset, English only.**
4. **Real-world savings will differ.** Many real prompts are already concise and will be left unchanged. Savings in the field are recorded by the extension's opt-in statistics as estimates.

## Suggested next step: output-level evaluation

For a held-out set of prompts: send the original and optimized versions to the target model(s) several times, then compare the answers with a rubric (task completed, constraints respected, format correct, factual consistency), rated by humans or an LLM judge with spot checks. Report the difference in quality alongside the token reduction.
