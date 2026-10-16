'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { optimize, optimizeAsync, registerCompressor, validateGeneric, REASONS, _internal } = require('../../src/engine/compressor.js');
const features = require('../../src/engine/features.js');

const opt = (text, o) => optimize(text, o);

test('empty and whitespace-only prompts are left unchanged with zero tokens', () => {
  for (const input of ['', '   ', '\n\n', null, undefined]) {
    const r = opt(input);
    assert.equal(r.changed, false);
    assert.equal(r.originalTokens >= 0, true);
    assert.equal(r.tokensSaved, 0);
    assert.equal(r.reductionPct, 0);
    assert.equal(r.reason, REASONS.empty);
  }
});

test('removes greeting, preamble and closing pleasantry', () => {
  const r = opt('Hi there! Could you please explain how binary search works? Thanks in advance!');
  assert.equal(r.optimized, 'Explain how binary search works.');
  assert.equal(r.changed, true);
  const ids = r.transformations.map((t) => t.ruleId);
  assert.deepEqual(ids.sort(), ['greeting', 'pleasantry', 'request-preamble'].sort());
});

test('never compresses below the original intent: short capability questions are untouched', () => {
  for (const q of ['Can you translate Japanese?', 'Can you browse the web?', 'Can you see images?']) {
    const r = opt(q);
    assert.equal(r.optimized, q, q);
    assert.equal(r.changed, false);
  }
});

test('"I would like you to" becomes an imperative', () => {
  const r = opt('I would like you to write a haiku about the ocean at night.');
  assert.equal(r.optimized, 'Write a haiku about the ocean at night.');
});

test('preserves negations and the word "only"', () => {
  const input = 'Please do not change the variable names. Only fix the bug on line 42.';
  const r = opt(input);
  assert.equal(r.optimized, 'Do not change the variable names. Only fix the bug on line 42.');
  assert.match(r.optimized, /\bnot\b/);
  assert.match(r.optimized, /\bOnly\b/);
  assert.match(r.optimized, /42/);
});

test('removes exact repeated instructions but keeps the first occurrence', () => {
  const input =
    'Write a sorting function in Rust. Do not use the standard library sort. Remember to not use the standard library sort.';
  const r = opt(input);
  assert.equal(r.optimized, 'Write a sorting function in Rust. Do not use the standard library sort.');
  assert.ok(r.transformations.some((t) => t.ruleId === 'duplicate-sentence'));
});

test('different instructions that look similar are NOT deduplicated', () => {
  const input = 'Never use global variables in the module. Never use variables in the module.';
  const r = opt(input);
  assert.equal(r.optimized, input);
});

test('fenced code blocks are preserved byte-for-byte', () => {
  const code = '```python\ndef f(x):\n    # in order to test\n    return x  *  2\n```';
  const input = `Could you please explain what this code does?\n\n${code}\n\nThank you so much!`;
  const r = opt(input);
  assert.ok(r.optimized.includes(code), r.optimized);
  assert.ok(r.optimized.startsWith('Explain what this code does.'));
});

test('inline code, URLs, quoted text and paths are protected', () => {
  const input =
    'In order to fix it, check `in order to` in "in order to keep" at https://example.com/in-order-to and src/in_order/to.py please.';
  const r = opt(input);
  for (const keep of ['`in order to`', '"in order to keep"', 'https://example.com/in-order-to', 'src/in_order/to.py']) {
    assert.ok(r.optimized.includes(keep), `${keep} missing from ${r.optimized}`);
  }
  assert.ok(r.optimized.startsWith('To fix it'));
});

test('numbers, units, dates and percentages survive', () => {
  const input =
    'Could you please summarize the report in order to compare 3.5 kWh, 120 mL and 15% growth between 2024-01-01 and March 5, 2026?';
  const r = opt(input);
  for (const keep of ['3.5 kWh', '120 mL', '15%', '2024-01-01', 'March 5, 2026']) {
    assert.ok(r.optimized.includes(keep), `${keep} missing`);
  }
  assert.equal(r.changed, true);
});

test('named entities and technical terms are kept', () => {
  const input =
    'I would like you to compare PostgreSQL and MongoDB for a Django app deployed on AWS Lambda due to the fact that we need ACID transactions.';
  const r = opt(input);
  for (const keep of ['PostgreSQL', 'MongoDB', 'Django', 'AWS Lambda', 'ACID']) assert.ok(r.optimized.includes(keep));
  assert.match(r.optimized, /because we need ACID/);
});

test('JSON / Markdown output requirements are preserved', () => {
  const input =
    'Can you please list three European capitals? Respond only in JSON with the keys "city" and "country". Do not include any extra text.';
  const r = opt(input);
  assert.ok(r.optimized.includes('Respond only in JSON with the keys "city" and "country".'));
  assert.ok(r.optimized.includes('Do not include any extra text.'));
  assert.ok(r.optimized.startsWith('List three European capitals.'));
});

test('"whether or not" is the one place a negation may be dropped', () => {
  const r = opt('Tell me whether or not I should migrate the database this week.');
  assert.equal(r.optimized, 'Tell me whether I should migrate the database this week.');
});

test('"it is important to note that" keeps the emphasis', () => {
  const r = opt('It is important to note that the function must return null for empty input.');
  assert.equal(r.optimized, 'Important: the function must return null for empty input.');
});

test('prompts that are already concise are returned unchanged with a reason', () => {
  for (const q of ['What is 2+2?', 'Summarize this text in 3 bullet points.', 'Fix the off-by-one error in loop.ts']) {
    const r = opt(q);
    assert.equal(r.optimized, q);
    assert.equal(r.changed, false);
    assert.ok(r.reason);
  }
});

test('a prompt consisting only of a pleasantry is never emptied', () => {
  for (const q of ['Thanks!', 'Thank you so much!', 'Hi there!']) {
    const r = opt(q);
    assert.equal(r.optimized, q);
    assert.equal(r.changed, false);
  }
});

test('lists and line structure are kept', () => {
  const input = 'Please complete these tasks:\n- Could you please check the budget for Q3?\n- Verify the 12 milestones\n\n\n\nThanks!';
  const r = opt(input);
  assert.equal(r.optimized, 'Complete these tasks:\n- Check the budget for Q3.\n- Verify the 12 milestones');
});

test('material to proofread / review after a colon is kept verbatim', () => {
  const payload = 'Thank you so much for your help in order to finish the project prior to the deadline.';
  assert.equal(opt(`Proofread: ${payload}`).changed, false);
  const r = opt(`Could you please review the following paragraph in order to tighten it: ${payload}`);
  assert.ok(r.optimized.endsWith(payload), r.optimized);
  assert.ok(r.optimized.startsWith('Review the following paragraph to tighten it:'), r.optimized);
});

test('nested protected spans (quotes inside braces) are restored exactly', () => {
  const fmt = '{"name": string, "age": number}';
  const r = opt(`Can you please extract the names as JSON? Use the format ${fmt}. Thanks!`);
  assert.ok(r.optimized.includes(fmt), r.optimized);
  assert.equal(/[\uE000-\uF8FF]/.test(r.optimized), false);
});

test('repeated instructions containing quoted words are deduplicated', () => {
  const r = opt('Do not use the word "passionate". Keep it short. Again, do not use the word "passionate".');
  assert.equal(r.optimized, 'Do not use the word "passionate". Keep it short.');
});

test('"don\'t" and "do not" count as the same negation', () => {
  const r = opt("Please do not use any external libraries. Please don't use any external libraries.");
  assert.equal(r.optimized, 'Do not use any external libraries.');
});

test('abbreviations do not split sentences', () => {
  const s = _internal.splitSentences('Use a lib, e.g. Lodash. Then test it.');
  assert.deepEqual(s.map((x) => x.text), ['Use a lib, e.g. Lodash.', 'Then test it.']);
});

test('balanced level removes conversational openers and "help me"', () => {
  const input = 'So, basically, can you help me write a haiku about rain please?';
  // Conservative only drops the trailing "please"; openers are balanced-only.
  assert.equal(opt(input).optimized, 'So, basically, can you help me write a haiku about rain?');
  assert.equal(opt(input, { level: 'balanced' }).optimized, 'Write a haiku about rain.');
});

test('doubled articles are fixed but legitimate repeats are not', () => {
  assert.equal(opt('Explain the the difference between TCP and UDP.').optimized, 'Explain the difference between TCP and UDP.');
  const legit = 'I think that that approach had had problems before.';
  assert.equal(opt(legit).optimized, legit);
});

test('result is deterministic and idempotent', () => {
  const input = 'Hello! Could you please rewrite this paragraph in order to make it shorter? Thanks!';
  const a = opt(input);
  const b = opt(input);
  assert.equal(a.optimized, b.optimized);
  const again = opt(a.optimized);
  assert.equal(again.optimized, a.optimized);
  assert.equal(again.changed, false);
});

test('token fields are consistent and reduction uses the documented formula', () => {
  const r = opt('Hi! Could you please explain in detail how the TCP three-way handshake works? Thanks!');
  assert.equal(r.tokensSaved, r.originalTokens - r.optimizedTokens);
  const expected = (100 * (r.originalTokens - r.optimizedTokens)) / r.originalTokens;
  assert.ok(Math.abs(r.reductionPct - expected) < 1e-9);
  assert.equal(r.tokenizer.exact, false);
  assert.ok(r.latencyMs >= 0);
});

test('prompts above maxChars are skipped', () => {
  const r = opt('Could you please explain this. '.repeat(10), { maxChars: 50 });
  assert.equal(r.changed, false);
  assert.equal(r.reason, REASONS.tooLong);
});

test('text that already contains private-use characters is left alone', () => {
  const r = opt('Could you please explain \uE000 this symbol to me today?');
  assert.equal(r.changed, false);
});

test('a failing compressor validation returns the original text', () => {
  registerCompressor({
    id: 'broken-test',
    label: 'test',
    local: true,
    compress: (text) => ({ text: text.replace(/not /g, ''), transformations: [], validation: validateGeneric(text, text.replace(/not /g, '')) }),
  });
  const input = 'Do not delete the production database under any circumstances.';
  const r = opt(input, { compressorId: 'broken-test' });
  assert.equal(r.optimized, input);
  assert.equal(r.changed, false);
  assert.equal(r.rejected, true);
});

test('async compressors work through optimizeAsync', async () => {
  registerCompressor({
    id: 'async-test',
    label: 'test',
    local: true,
    compress: async (text) => ({ text: text.replace('Kindly ', ''), transformations: [], validation: { ok: true } }),
  });
  const r = await optimizeAsync('Kindly summarize the meeting notes from Monday for the whole team.', { compressorId: 'async-test' });
  assert.equal(r.changed, true);
  assert.throws(() => optimize('Kindly summarize the notes for everyone today.', { compressorId: 'async-test' }));
});

test('feature guard rejects a rewrite that adds or removes protected meaning', () => {
  const rule = { id: 't', vocabulary: new Set(['in', 'order']), allowDrop: [] };
  assert.equal(features.checkRewrite('in order to', 'to', rule).ok, true);
  assert.equal(features.checkRewrite('do not run', 'do run', rule).ok, false);
  assert.equal(features.checkRewrite('run 5 times', 'run times', rule).ok, false);
  assert.equal(features.checkRewrite('run it', 'always run it', rule).ok, false);
  assert.equal(features.checkRewrite('delete logs', 'delete', rule).ok, false);
});

test('code-like lines are detected', () => {
  assert.equal(_internal.looksLikeCodeLine('const x = foo(bar);'), true);
  assert.equal(_internal.looksLikeCodeLine('| a | b |'), true);
  assert.equal(_internal.looksLikeCodeLine('SELECT * FROM users WHERE id = 1'), true);
  assert.equal(_internal.looksLikeCodeLine('Please explain closures in JavaScript.'), false);
});
