'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tokenizer = require('../../src/engine/tokenizer.js');
const impact = require('../../src/engine/impact.js');
const { wordDiff } = require('../../src/engine/diff.js');

test('reductionPercent follows 100 × (orig − opt) / orig', () => {
  assert.equal(tokenizer.reductionPercent(100, 75), 25);
  assert.equal(tokenizer.reductionPercent(8, 6), 25);
  assert.equal(tokenizer.reductionPercent(10, 10), 0);
  assert.equal(tokenizer.reductionPercent(10, 12), -20);
});

test('reductionPercent handles zero, negative and invalid inputs', () => {
  assert.equal(tokenizer.reductionPercent(0, 0), 0);
  assert.equal(tokenizer.reductionPercent(0, 5), 0);
  assert.equal(tokenizer.reductionPercent(-1, 0), 0);
  assert.equal(tokenizer.reductionPercent(NaN, 1), 0);
  assert.equal(tokenizer.reductionPercent(10, NaN), 0);
});

test('heuristic tokenizer: basic properties', () => {
  const t = tokenizer.heuristic;
  assert.equal(t.exact, false);
  assert.equal(t.count(''), 0);
  assert.equal(t.count(null), 0);
  assert.equal(t.count('hello'), 1);
  assert.equal(t.count('hello world'), 2);
  assert.ok(t.count('internationalization') >= 3);
  assert.equal(t.count('1234567'), 3); // digit groups of up to 3
  assert.ok(t.count('日本語のテキスト') >= 6);
  // longer text never counts fewer tokens than a prefix of it
  const s = 'The quick brown fox jumps over the lazy dog. '.repeat(5);
  assert.ok(t.count(s) > t.count(s.slice(0, 40)));
});

test('custom tokenizers can be registered and fall back safely', () => {
  tokenizer.register({ id: 'chars', label: 'chars', exact: true, count: (s) => s.length });
  assert.equal(tokenizer.get('chars').count('abc'), 3);
  assert.equal(tokenizer.get('does-not-exist').id, tokenizer.heuristic.id);
  assert.throws(() => tokenizer.register({ id: 'x' }));
});

test('impact is unavailable by default (no invented liters-per-token)', () => {
  const r = impact.estimateImpact(1000);
  assert.equal(r.available, false);
  assert.equal(r.status, 'unavailable');
  assert.equal(r.energyWh, undefined);
  assert.equal(r.waterMl, undefined);
});

test('illustrative impact requires complete, ordered assumptions', () => {
  assert.equal(impact.estimateImpact(1000, { mode: 'illustrative' }).available, false);
  const bad = {
    mode: 'illustrative',
    energyWhPer1kTokensLow: 2,
    energyWhPer1kTokensHigh: 1,
    waterLitersPerKwhLow: 1,
    waterLitersPerKwhHigh: 2,
  };
  assert.equal(impact.estimateImpact(1000, bad).available, false);
  assert.equal(impact.estimateImpact(1000, { ...bad, energyWhPer1kTokensLow: -1 }).available, false);
});

test('illustrative impact arithmetic', () => {
  const r = impact.estimateImpact(2000, {
    mode: 'illustrative',
    energyWhPer1kTokensLow: 0.1,
    energyWhPer1kTokensHigh: 0.5,
    waterLitersPerKwhLow: 0.5,
    waterLitersPerKwhHigh: 2,
  });
  assert.equal(r.available, true);
  assert.equal(r.status, 'illustrative');
  assert.ok(Math.abs(r.energyWh.low - 0.2) < 1e-12);
  assert.ok(Math.abs(r.energyWh.high - 1.0) < 1e-12);
  // 0.2 Wh = 0.0002 kWh × 0.5 L/kWh = 0.0001 L = 0.1 mL
  assert.ok(Math.abs(r.waterMl.low - 0.1) < 1e-12);
  assert.ok(Math.abs(r.waterMl.high - 2.0) < 1e-12);
  assert.match(r.disclaimer, /Not a measurement/);
});

test('wordDiff marks removed and added runs and reconstructs both sides', () => {
  const a = 'Could you please explain recursion in Python?';
  const b = 'Explain recursion in Python.';
  const ops = wordDiff(a, b);
  const left = ops.filter((o) => o.type !== 'added').map((o) => o.text).join('');
  const right = ops.filter((o) => o.type !== 'removed').map((o) => o.text).join('');
  assert.equal(left, a);
  assert.equal(right, b);
  assert.ok(ops.some((o) => o.type === 'removed' && /please/.test(o.text)));
});

test('wordDiff returns null for inputs too large to diff cheaply', () => {
  const big = 'word '.repeat(3000);
  assert.equal(wordDiff(big, big + 'x'), null);
});
