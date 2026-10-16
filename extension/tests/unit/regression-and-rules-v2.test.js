'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { optimize } = require('../../src/engine/compressor.js');
const S = require('../../src/shared/settings.js');

const ML_PROMPT = fs.readFileSync(path.join(__dirname, '..', '..', 'eval', 'regression', 'ml_learning_prompt.txt'), 'utf8').trim();

// Every requirement in the machine-learning regression prompt, as a check on the output.
const ML_REQUIREMENTS = [
  ['exactly three real-world examples', /exactly three real-world examples/i],
  ['a healthcare example', /healthcare/i],
  ['a cybersecurity example', /cybersecurity/i],
  ['exactly five numbered Python-learning steps', /step-by-step plan for learning machine learning with Python[\s\S]*exactly five numbered steps/i],
  ['no advanced mathematical equations', /do not include any advanced mathematical equations/i],
  ['maximum 500 words', /should not be longer than 500 words/i],
  ['small Python code example at the end', /at the end of your answer, include a small Python code example/i],
  ['beginner-friendly language', /beginner-friendly language/i],
  ['second-year computer engineering student', /I am a second-year computer engineering student/i],
  ['explain what machine learning is', /explain what machine learning is/i],
];

test('regression: ML learning prompt keeps every requirement and shrinks substantially', () => {
  for (const level of ['balanced', 'conservative']) {
    const r = optimize(ML_PROMPT, { level });
    assert.equal(r.changed, true);
    for (const [name, re] of ML_REQUIREMENTS) assert.match(r.optimized, re, `[${level}] lost requirement: ${name}`);
    // the repeated "do not use advanced math equations" appears only once now
    assert.equal((r.optimized.match(/equations/g) || []).length, 1, `[${level}] duplicate not removed`);
    assert.ok(r.reductionPct >= 25, `[${level}] expected >= 25% estimated reduction, got ${r.reductionPct.toFixed(1)}%`);
    assert.equal(r.tokenizer.exact, false);
  }
});

test('lead-ins are kept while the request after them is shortened', () => {
  assert.equal(
    optimize('After that, could you also provide me with a short summary of the main risks?').optimized,
    'After that, provide a short summary of the main risks.'
  );
  assert.equal(
    optimize('At the end of your answer, I would like you to include a small code example in Go.').optimized,
    'At the end of your answer, include a small code example in Go.'
  );
});

test('order words are never removed; additive transitions are', () => {
  const r = optimize('First, could you please list the risks? Then, could you please rank them by severity? Finally, keep it under 100 words.');
  assert.equal(r.optimized, 'First, list the risks. Then, rank them by severity. Finally, keep it under 100 words.');
  assert.equal(
    optimize('Also, please do not change the public API of the payment module.').optimized,
    'Do not change the public API of the payment module.'
  );
});

test('"keep in mind that" is dropped but the constraint "keep" is not', () => {
  const r = optimize('Please keep in mind that the report must stay under 2 pages. Also, please keep the original section headings.');
  assert.equal(r.optimized, 'The report must stay under 2 pages. Keep the original section headings.');
});

test('"I would really like it if" stays a preference ("Ideally,")', () => {
  assert.equal(
    optimize('I would really like it if one of the examples is from agriculture and one is from finance.').optimized,
    'Ideally, one of the examples is from agriculture and one is from finance.'
  );
});

test('"I would like to know how" becomes "Tell me how"', () => {
  assert.equal(
    optimize('I would like to know how DNS resolution works when a browser opens a website for the first time.').optimized,
    'Tell me how DNS resolution works when a browser opens a website for the first time.'
  );
});

test('reworded repeat of a requirement is removed; a narrower or broader variant is not', () => {
  const dup = optimize('Do not include any advanced mathematical equations, because I am new to this. Remember, please do not use advanced math equations.');
  assert.equal(dup.optimized, 'Do not include any advanced mathematical equations, because I am new to this.');
  const narrower = 'Never use global variables in the module. Never use mutable global variables in the module.';
  assert.equal(optimize(narrower).optimized, narrower);
  const differentNumber = 'Keep the answer under 200 words for the summary section. Keep the answer under 300 words for the summary section.';
  assert.equal(optimize(differentNumber).optimized, differentNumber);
});

test('a re-stated description of the user is removed only if the prompt already states it', () => {
  const stated = optimize(
    'I am a first-year biology student. Explain photosynthesis in plain language that a first-year biology student like me can easily understand.'
  );
  assert.equal(stated.optimized, 'I am a first-year biology student. Explain photosynthesis in plain language.');
  const notStated = 'Explain photosynthesis in plain language that a first-year biology student like me can easily understand.';
  assert.equal(optimize(notStated).optimized, notStated);
});

test('intensifiers and "explain to me" / "provide me with" are shortened', () => {
  assert.equal(
    optimize('Can you please explain to me what a mutex actually is and provide me with a short example in C?').optimized,
    'Explain what a mutex is and provide a short example in C.'
  );
});

test('settings: one-time mode choice and automatic-mode guards', () => {
  const d = S.sanitizeSettings({});
  assert.equal(d.modeChosen, false);
  assert.equal(d.applyMode, 'manual');
  assert.ok(d.debounceMs >= 800 && d.debounceMs <= 1200);
  assert.equal(S.autoApplyAllowed(d, 'chatgpt'), false, 'never automatic before consent');

  const auto = S.chooseMode(d, 'auto');
  assert.deepEqual([auto.modeChosen, auto.applyMode], [true, 'autoApply']);
  assert.equal(S.autoApplyAllowed(auto, 'chatgpt'), true);
  assert.equal(S.autoApplyAllowed({ ...auto, autoBlockedSites: ['chatgpt'] }, 'chatgpt'), false);
  assert.equal(S.autoApplyAllowed({ ...auto, disabledSites: ['chatgpt'] }, 'chatgpt'), false);
  assert.equal(S.autoApplyAllowed({ ...auto, enabled: false }, 'chatgpt'), false);
  // An old settings object (from before this version) asks again.
  assert.equal(S.sanitizeSettings({ applyMode: 'autoApply' }).modeChosen, false);
  assert.equal(S.autoApplyAllowed(S.sanitizeSettings({ applyMode: 'autoApply' }), 'chatgpt'), false);

  const manual = S.chooseMode(d, 'manual');
  assert.deepEqual([manual.modeChosen, manual.applyMode], [true, 'manual']);
  const clamped = S.sanitizeSettings({ autoMinTokensSaved: 0, autoMinReductionPct: 500, autoBlockedSites: ['ok', 'BAD!'] });
  assert.deepEqual([clamped.autoMinTokensSaved, clamped.autoMinReductionPct, clamped.autoBlockedSites], [1, 90, ['ok']]);
});
