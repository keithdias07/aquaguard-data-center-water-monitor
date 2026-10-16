'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../src/shared/settings.js');
const adapters = require('../../src/content/adapters.js');

test('defaults are privacy-preserving and preview-first', () => {
  const s = S.sanitizeSettings(undefined);
  assert.equal(s.enabled, true);
  assert.equal(s.applyMode, 'manual');
  assert.equal(s.collectStats, false);
  assert.equal(s.impact.mode, 'off');
  assert.ok(s.debounceMs >= 700 && s.debounceMs <= 1000);
});

test('sanitizeSettings clamps and rejects invalid values', () => {
  const s = S.sanitizeSettings({
    enabled: 'yes',
    applyMode: 'sendForMe',
    debounceMs: 5,
    minPromptChars: 1e9,
    level: 'extreme',
    disabledSites: ['claude', 'claude', 'BAD SITE!', 42],
    impact: { mode: 'illustrative', energyWhPer1kTokensLow: '-3', waterLitersPerKwhHigh: '1.5' },
  });
  assert.equal(s.enabled, true);
  assert.equal(s.applyMode, 'manual');
  assert.equal(s.debounceMs, 300);
  assert.equal(s.minPromptChars, 2000);
  assert.equal(s.level, 'balanced'); // invalid value falls back to the default
  assert.deepEqual(s.disabledSites, ['claude']);
  assert.equal(s.impact.mode, 'illustrative');
  assert.equal(s.impact.energyWhPer1kTokensLow, null);
  assert.equal(s.impact.waterLitersPerKwhHigh, 1.5);
});

test('recordEvent accumulates aggregate counters only', () => {
  const day = new Date(2026, 9, 17, 12);
  let st = S.emptyStats();
  st = S.recordEvent(st, { type: 'run', changed: true, latencyMs: 2 }, day);
  st = S.recordEvent(st, { type: 'run', changed: false, latencyMs: 4 }, day);
  st = S.recordEvent(st, { type: 'applied', originalTokens: 40, optimizedTokens: 30, ruleIds: ['greeting', 'pleasantry'] }, day);
  st = S.recordEvent(st, { type: 'completed', outcome: 'optimized' }, day);
  st = S.recordEvent(st, { type: 'completed', outcome: 'unchanged' }, day);
  st = S.recordEvent(st, { type: 'applied', originalTokens: 20, optimizedTokens: 15, ruleIds: ['greeting'] }, day);
  st = S.recordEvent(st, { type: 'undone', tokensSaved: 5 }, day);
  st = S.recordEvent(st, { type: 'completed', outcome: 'declined' }, day);

  const sum = S.summarizeStats(st);
  assert.equal(sum.promptsOptimized, 1);
  assert.equal(sum.promptsLeftUnchanged, 1);
  assert.equal(sum.promptsDeclined, 1);
  assert.equal(sum.netTokensSaved, 10); // 10 + 5 saved, 5 undone
  assert.equal(sum.averageReductionPct, 25); // (25% + 25%) / 2
  assert.equal(sum.averageLatencyMs, 3);
  assert.deepEqual(st.transformations, { greeting: 2, pleasantry: 1 });
  assert.equal(st.daily['2026-10-17'].tokensSaved, 15);
  assert.equal(st.firstRecordedOn, '2026-10-17');
});

test('recordEvent ignores junk and never stores strings from events', () => {
  let st = S.emptyStats();
  st = S.recordEvent(st, { type: 'applied', originalTokens: 'lots', optimizedTokens: -4, ruleIds: ['ok-rule', 'Bad Rule <script>'], prompt: 'SECRET PROMPT' });
  st = S.recordEvent(st, { type: 'nonsense', text: 'SECRET PROMPT' });
  const json = JSON.stringify(S.exportStats(st));
  assert.equal(json.includes('SECRET'), false);
  assert.equal(json.includes('script'), false);
  assert.equal(st.totals.tokensSaved, 0);
});

test('export format matches the documented schema and sample file', () => {
  let st = S.recordEvent(S.emptyStats(), { type: 'run', changed: true, latencyMs: 1 }, new Date(2026, 0, 2));
  const out = S.exportStats(st, { extensionVersion: '0.1.0', now: new Date('2026-01-03T00:00:00Z') });
  assert.equal(out.schema, 'aquaguard.prompt-optimizer.stats');
  assert.equal(out.schemaVersion, 1);
  assert.equal(out.containsPromptText, false);
  assert.deepEqual(out.daily.map((d) => d.date), ['2026-01-02']);

  const samplePath = path.join(__dirname, '..', '..', '..', 'data', 'extension', 'extension_stats_sample.json');
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  assert.deepEqual(Object.keys(sample.totals).sort(), Object.keys(out.totals).sort());
  assert.deepEqual(Object.keys(sample.daily[0]).sort(), Object.keys(out.daily[0]).sort());
  assert.equal(sample.schema, out.schema);
});

test('sanitizeStats rejects foreign data', () => {
  assert.deepEqual(S.sanitizeStats({ schema: 'other', totals: { tokensSaved: 99 } }).totals.tokensSaved, 0);
  assert.equal(S.sanitizeStats(null).schemaVersion, 1);
});

test('site adapters match only their hosts', () => {
  assert.equal(adapters.match('chatgpt.com').id, 'chatgpt');
  assert.equal(adapters.match('CHATGPT.COM').id, 'chatgpt');
  assert.equal(adapters.match('claude.ai').id, 'claude');
  assert.equal(adapters.match('gemini.google.com').id, 'gemini');
  assert.equal(adapters.match('evilchatgpt.com'), null);
  assert.equal(adapters.match('google.com'), null);
  assert.equal(adapters.match('example.org'), null);
  assert.equal(adapters.match(undefined), null);
});

test('manifest requests minimal permissions and matches the adapters', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.host_permissions, undefined);
  const matches = manifest.content_scripts[0].matches;
  for (const a of adapters.ADAPTERS.filter((x) => x.support !== 'test')) {
    for (const host of a.hosts) assert.ok(matches.includes(`https://${host}/*`), `${host} missing from manifest`);
  }
  assert.ok(matches.every((m) => m.startsWith('https://')), 'only https sites');
  // every referenced file exists
  const root = path.join(__dirname, '..', '..');
  const files = [...manifest.content_scripts[0].js, manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, ...Object.values(manifest.icons)];
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `${f} missing`);
});
