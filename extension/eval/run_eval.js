#!/usr/bin/env node
/*
 * Offline evaluation of the AquaGuard compressor.
 *
 * Measures, for each prompt in eval/prompts.json and each compression level:
 *   - token reduction (heuristic estimate AND exact o200k_base count)
 *   - whether required substrings survived (mustPreserve)
 *   - whether every distinct number / negation / constraint term survived
 *   - whether the "should compress / should not compress" expectation held
 *   - compression latency (median of repeated runs)
 *
 * It also reports how far the heuristic tokenizer is from o200k_base.
 *
 * IMPORTANT: none of this proves the compressed prompt produces an equally
 * good model answer. That needs output-level evaluation (see docs/EVALUATION.md).
 *
 * Outputs:
 *   eval/results/eval_results.json           full results (synthetic prompts)
 *   eval/results/eval_report.md              side-by-side review sheet
 *   ../data/extension/prompt_eval_results.json  aggregates for the dashboard (no prompt text)
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { optimize } = require('../src/engine/compressor.js');
const features = require('../src/engine/features.js');
const tokenizer = require('../src/engine/tokenizer.js');

let exactEncoder = null;
try {
  const { getEncoding } = require('js-tiktoken');
  exactEncoder = getEncoding('o200k_base');
} catch (err) {
  console.warn('js-tiktoken not installed: exact o200k_base counts will be skipped (run npm install).');
}
const exactCount = (s) => (exactEncoder ? exactEncoder.encode(s).length : null);

const ROOT = __dirname;
const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts.json'), 'utf8'));
const LEVELS = ['conservative', 'balanced'];
const LATENCY_RUNS = 25;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x, d = 2) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

function lostTerms(original, optimized) {
  const a = features.extract(original);
  const b = features.extract(optimized);
  const lost = [];
  for (const c of ['numbers', 'negations', 'constraints']) {
    for (const term of a[c].keys()) {
      // "whether or not" -> "whether" is the one documented negation drop.
      if (c === 'negations' && term === 'not' && /whether or not/i.test(original) && !b[c].has('not')) continue;
      if (!b[c].has(term)) lost.push(`${c}:${term}`);
    }
  }
  return lost;
}

function evaluate(item, level) {
  // warm-up then timed runs
  optimize(item.prompt, { level });
  const latencies = [];
  let r;
  for (let i = 0; i < LATENCY_RUNS; i++) {
    r = optimize(item.prompt, { level });
    latencies.push(r.latencyMs);
  }
  // Case-insensitive: a rewrite may capitalise the first word of a new sentence.
  const lower = r.optimized.toLowerCase();
  const missing = (item.mustPreserve || []).filter((s) => !lower.includes(s.toLowerCase()));
  // allowedLoss records a human judgement that a term only appeared in filler
  // (e.g. "any" in "Any help would be appreciated").
  const lost = lostTerms(item.prompt, r.optimized).filter((t) => !(item.allowedLoss || []).includes(t));
  const expectationMet =
    item.expect === 'either' ||
    (item.expect === 'compress' && r.changed) ||
    (item.expect === 'unchanged' && !r.changed);
  const exactOriginal = exactCount(item.prompt);
  const exactOptimized = exactCount(r.optimized);
  return {
    id: item.id,
    category: item.category,
    level,
    expect: item.expect,
    changed: r.changed,
    reason: r.reason,
    expectationMet,
    preservedAll: missing.length === 0,
    missing,
    termsPreserved: lost.length === 0,
    lostTerms: lost,
    heuristic: {
      original: r.originalTokens,
      optimized: r.optimizedTokens,
      saved: r.tokensSaved,
      reductionPct: round(r.reductionPct),
    },
    exactO200k: exactEncoder
      ? {
          original: exactOriginal,
          optimized: exactOptimized,
          saved: exactOriginal - exactOptimized,
          reductionPct: round(tokenizer.reductionPercent(exactOriginal, exactOptimized)),
        }
      : null,
    latencyMsMedian: round(median(latencies), 3),
    transformations: r.transformations.map((t) => ({ ruleId: t.ruleId, count: t.count })),
    original: item.prompt,
    optimized: r.optimized,
  };
}

function summarize(rows) {
  const changed = rows.filter((r) => r.changed);
  const exactRows = rows.filter((r) => r.exactO200k);
  const totalExactOrig = exactRows.reduce((a, r) => a + r.exactO200k.original, 0);
  const totalExactSaved = exactRows.reduce((a, r) => a + r.exactO200k.saved, 0);
  const shouldNot = rows.filter((r) => r.expect === 'unchanged');
  return {
    prompts: rows.length,
    changed: changed.length,
    unchanged: rows.length - changed.length,
    expectationAccuracy: round(mean(rows.map((r) => (r.expectationMet ? 1 : 0))) * 100, 1),
    mustPreserveRate: round(mean(rows.map((r) => (r.preservedAll ? 1 : 0))) * 100, 1),
    termPreservationRate: round(mean(rows.map((r) => (r.termsPreserved ? 1 : 0))) * 100, 1),
    falseCompressions: shouldNot.filter((r) => r.changed).length,
    shouldNotCompressCases: shouldNot.length,
    meanReductionPctChangedOnly: round(mean(changed.map((r) => r.exactO200k ? r.exactO200k.reductionPct : r.heuristic.reductionPct)), 1),
    meanReductionPctAllPrompts: round(mean(rows.map((r) => r.exactO200k ? r.exactO200k.reductionPct : r.heuristic.reductionPct)), 1),
    aggregateReductionPctExact: totalExactOrig ? round((100 * totalExactSaved) / totalExactOrig, 1) : null,
    latencyMsMedian: round(median(rows.map((r) => r.latencyMsMedian)), 3),
    latencyMsMax: round(Math.max(...rows.map((r) => r.latencyMsMedian)), 3),
  };
}

function calibration(rows) {
  if (!exactEncoder) return null;
  const texts = [];
  for (const r of rows) texts.push(r.original, r.optimized);
  const errs = texts.map((t) => {
    const e = exactCount(t);
    const h = tokenizer.estimateTokens(t);
    return { pct: e ? (100 * (h - e)) / e : 0 };
  });
  return {
    reference: 'o200k_base (js-tiktoken)',
    samples: texts.length,
    meanAbsPctError: round(mean(errs.map((e) => Math.abs(e.pct))), 1),
    meanSignedPctError: round(mean(errs.map((e) => e.pct)), 1),
    within10Pct: round(mean(errs.map((e) => (Math.abs(e.pct) <= 10 ? 1 : 0))) * 100, 1),
  };
}

function byCategory(rows) {
  const cats = {};
  for (const r of rows) {
    const c = (cats[r.category] = cats[r.category] || []);
    c.push(r);
  }
  return Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, summarize(v)]));
}

function markdownReport(results) {
  const lines = [
    '# AquaGuard compressor evaluation',
    '',
    `Generated: ${results.generatedAt} · engine ${results.engineVersion} · ${results.dataset.prompts} synthetic prompts`,
    '',
    '> Automated checks verify that required phrases, numbers, negations and constraints survive.',
    '> They do **not** prove that a model would answer the compressed prompt equally well.',
    '> Use the "Human review" column to record your own judgement.',
    '',
  ];
  for (const level of LEVELS) {
    const s = results.summary[level];
    lines.push(`## Level: ${level}`, '');
    lines.push('| Metric | Value |', '|---|---|');
    for (const [k, v] of Object.entries(s)) lines.push(`| ${k} | ${v} |`);
    lines.push('');
  }
  if (results.calibration) {
    lines.push('## Heuristic tokenizer vs o200k_base', '');
    for (const [k, v] of Object.entries(results.calibration)) lines.push(`- ${k}: ${v}`);
    lines.push('');
  }
  lines.push('## Side-by-side (conservative)', '');
  lines.push('| id | expect | changed | o200k tokens | checks | Human review |', '|---|---|---|---|---|---|');
  for (const r of results.rows.filter((x) => x.level === 'conservative')) {
    const tok = r.exactO200k ? `${r.exactO200k.original} → ${r.exactO200k.optimized} (${r.exactO200k.reductionPct}%)` : '';
    const checks = [r.expectationMet ? '' : 'EXPECTATION', r.preservedAll ? '' : 'MISSING', r.termsPreserved ? '' : 'TERMS']
      .filter(Boolean)
      .join(' ') || 'ok';
    lines.push(`| ${r.id} | ${r.expect} | ${r.changed} | ${tok} | ${checks} | |`);
  }
  lines.push('');
  for (const r of results.rows.filter((x) => x.level === 'conservative' && x.changed)) {
    lines.push(`### ${r.id}`, '', '**Original**', '', '```text', r.original, '```', '', '**Optimized**', '', '```text', r.optimized, '```', '');
  }
  return lines.join('\n');
}

function main() {
  const rows = [];
  for (const level of LEVELS) for (const item of dataset.prompts) rows.push(evaluate(item, level));

  const summary = {};
  const categories = {};
  for (const level of LEVELS) {
    const levelRows = rows.filter((r) => r.level === level);
    summary[level] = summarize(levelRows);
    categories[level] = byCategory(levelRows);
  }
  const results = {
    schema: 'aquaguard.prompt-optimizer.eval',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    engineVersion: require('../src/engine/compressor.js').VERSION,
    tokenizer: tokenizer.heuristic.id,
    dataset: { file: 'extension/eval/prompts.json', prompts: dataset.prompts.length, synthetic: true },
    summary,
    categories,
    calibration: calibration(rows.filter((r) => r.level === 'conservative')),
    rows,
  };

  const outDir = path.join(ROOT, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'eval_results.json'), JSON.stringify(results, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'eval_report.md'), markdownReport(results) + '\n');

  // Dashboard copy without prompt text.
  const dashboard = {
    ...results,
    rows: rows.map(({ original, optimized, missing, ...rest }) => ({ ...rest, missingCount: missing.length })),
  };
  const dashDir = path.join(ROOT, '..', '..', 'data', 'extension');
  fs.mkdirSync(dashDir, { recursive: true });
  fs.writeFileSync(path.join(dashDir, 'prompt_eval_results.json'), JSON.stringify(dashboard, null, 2) + '\n');

  for (const level of LEVELS) {
    console.log(`\n== ${level} ==`);
    console.table(summary[level]);
  }
  if (results.calibration) {
    console.log('\nHeuristic tokenizer vs o200k_base:');
    console.table(results.calibration);
  }
  const failures = rows.filter((r) => !r.preservedAll || !r.termsPreserved || !r.expectationMet);
  if (failures.length) {
    console.log('\nCases needing attention:');
    for (const f of failures) {
      console.log(`- [${f.level}] ${f.id}: expectation=${f.expectationMet} missing=${JSON.stringify(f.missing)} lost=${JSON.stringify(f.lostTerms)}`);
      console.log(`    ${JSON.stringify(f.optimized)}`);
    }
  }
  console.log(`\nWrote ${path.relative(process.cwd(), outDir)} and data/extension/prompt_eval_results.json`);
  process.exitCode = rows.some((r) => !r.preservedAll || !r.termsPreserved) ? 1 : 0;
}

main();
