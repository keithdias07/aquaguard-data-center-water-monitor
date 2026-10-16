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

45 hand-written **synthetic** prompts (none collected from users) in 9 categories: simple questions, coding, long technical prompts, multi-step instructions, numbers and units, constraints and negations, structured JSON/Markdown output, verbose prompts, and prompts that must not be compressed (quoted text to translate, text to proofread, tables, near-duplicate but different instructions, non-English text, capability questions such as "Can you remember previous conversations?").

## Results (engine 1.0.0, 2026-10-17)

| Metric | Conservative | Balanced |
|---|---|---|
| Prompts compressed | 25 / 45 | 25 / 45 |
| Decision accuracy | 100% | 100% |
| Required phrases preserved | 100% | 100% |
| Numbers / negations / constraints preserved | 100% | 100% |
| False compressions | 0 / 15 | 0 / 15 |
| Mean reduction, compressed prompts (o200k) | 20.6% | 21.0% |
| Total reduction across dataset (o200k) | 15.8% | 16.1% |
| Median latency | ~0.3 ms | ~0.25 ms |

Heuristic tokenizer vs `o200k_base`: **4.3%** mean absolute error, **+3.2%** mean signed error (slight overestimate), within ±10% for 84% of texts. A separate check (see `tokenizer.js` comments) found about 9% error on source code and up to about 30% **under**counting for rare, very long words.

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
