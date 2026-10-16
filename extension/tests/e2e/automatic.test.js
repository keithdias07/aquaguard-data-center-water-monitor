'use strict';
/*
 * Automatic mode: one-time consent, replacement after a typing pause, the
 * compact Undo button, safety conditions, and the per-site fallback.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness.js');

const VERBOSE = 'Hi there! Could you please explain how binary search works in a sorted array? Thanks in advance!';
const OPTIMIZED = 'Explain how binary search works in a sorted array.';
const AUTO = { applyMode: 'autoApply', modeChosen: true };

let ctx;
test.before(async () => {
  ctx = await h.launch();
});
test.after(async () => {
  await h.close(ctx);
});
test.beforeEach(async () => {
  await h.resetStorage(ctx);
});

const counters = (page) =>
  page.evaluate(() => ({ submits: window.__submits, enters: window.__enterKeys, sendClicks: window.__sendClicks || 0 }));

function shadowState(page) {
  return page.evaluate(() => {
    const root = document.getElementById('aquaguard-prompt-optimizer').shadowRoot;
    return {
      consent: !root.querySelector('.consent').hidden,
      panel: !root.querySelector('#ag-panel').hidden,
      undoChip: !root.querySelector('.undo').hidden,
      pill: root.querySelector('.pill span').textContent,
    };
  });
}

test('first use: one-time question; "Automatic" optimizes right away and is remembered', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page, VERBOSE);
  await h.waitForStatus(page, 'suggestion', 5000);
  assert.equal((await shadowState(page)).consent, true, 'consent card should appear on first suggestion');
  assert.equal(await page.evaluate(() => window.__getText()), VERBOSE, 'nothing replaced before consent');

  await h.clickOverlay(page, 'Automatic');
  await h.waitForStatus(page, 'applied', 3000);
  assert.equal(await page.evaluate(() => window.__getText()), OPTIMIZED);
  const stored = (await h.getStorage(ctx)).settings;
  assert.equal(stored.modeChosen, true);
  assert.equal(stored.applyMode, 'autoApply');
  await page.close();

  // A new tab: no question, automatic replacement after the pause.
  const page2 = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page2, VERBOSE);
  await h.waitForStatus(page2, 'applied', 5000);
  const s = await shadowState(page2);
  assert.equal(s.consent, false);
  assert.equal(s.panel, false, 'automatic mode must not open the detail panel');
  assert.equal(s.undoChip, true);
  assert.match(s.pill, /tokens saved/);
  assert.deepEqual(await counters(page2), { submits: 0, enters: 0, sendClicks: 0 });
  await page2.close();
});

test('first use: "Manual" keeps the preview workflow and is remembered', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page, VERBOSE);
  await h.waitForStatus(page, 'suggestion', 5000);
  await h.clickOverlay(page, 'Manual');
  await h.sleep(500);
  assert.equal((await shadowState(page)).consent, false);
  assert.equal(await page.evaluate(() => window.__getText()), VERBOSE);
  const stored = (await h.getStorage(ctx)).settings;
  assert.deepEqual([stored.modeChosen, stored.applyMode], [true, 'manual']);
  await page.close();

  const page2 = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page2, VERBOSE);
  await h.waitForStatus(page2, 'suggestion', 5000);
  await h.sleep(1500);
  assert.equal(await page2.evaluate(() => window.__getText()), VERBOSE);
  assert.equal((await shadowState(page2)).consent, false, 'question must not be asked again');
  await page2.close();
});

for (const editor of ['textarea', 'react', 'pm', 'quill']) {
  test(`[${editor}] automatic: replaced after the pause; one-click Undo restores the exact original and keeps focus`, async () => {
    await h.setSettings(ctx, AUTO);
    const page = await h.openFixture(ctx, editor);
    await h.typeInto(page, VERBOSE);
    await h.waitForStatus(page, 'applied', 5000);
    assert.equal(await page.evaluate(() => window.__getText()), OPTIMIZED);
    assert.equal((await shadowState(page)).panel, false);

    // Real mouse click on the compact Undo button.
    const chip = await page.evaluateHandle(() =>
      document.getElementById('aquaguard-prompt-optimizer').shadowRoot.querySelector('.undo')
    );
    await chip.click();
    await page.waitForFunction((t) => window.__getText() === t, { timeout: 3000 }, VERBOSE);
    const focused = await page.evaluate(() => {
      const f = document.getElementById('field');
      return document.activeElement === f || f.contains(document.activeElement);
    });
    assert.equal(focused, true, 'Undo must not steal keyboard focus from the prompt box');

    // Undo pauses automatic mode for this draft: keep typing, nothing is re-shortened.
    await page.keyboard.type(' Also give one example.', { delay: 2 });
    await h.sleep(2200);
    const text = await page.evaluate(() => window.__getText());
    assert.ok(text.startsWith('Hi there! Could you please'), text);
    assert.deepEqual(await counters(page), { submits: 0, enters: 0, sendClicks: 0 });
    await page.close();
  });
}

test('automatic: not replaced while the cursor is mid-text', async () => {
  await h.setSettings(ctx, AUTO);
  const page = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page, VERBOSE);
  await page.keyboard.press('Home'); // move the caret to the start, as if editing
  await h.sleep(2200);
  assert.equal(await page.evaluate(() => window.__getText()), VERBOSE);
  assert.equal((await h.overlayState(page)).status, 'suggestion');
  await page.close();
});

test('automatic: tiny savings are not applied automatically', async () => {
  await h.setSettings(ctx, AUTO);
  const page = await h.openFixture(ctx, 'textarea');
  const prompt = 'Please summarize the attached quarterly report in three short bullet points for the leadership team.';
  await h.typeInto(page, prompt);
  await h.sleep(2200);
  assert.equal(await page.evaluate(() => window.__getText()), prompt);
  await page.close();
});

test('automatic: an editor that rejects changes keeps the original and falls back to preview on that site', async () => {
  await h.setSettings(ctx, AUTO);
  const page = await h.openFixture(ctx, 'stubborn');
  await h.typeInto(page, VERBOSE, 2);
  await h.waitForStatus(page, 'error', 5000);
  assert.equal(await page.evaluate(() => window.__getText()), VERBOSE, 'original text must be preserved');
  const stored = (await h.getStorage(ctx)).settings;
  assert.deepEqual(stored.autoBlockedSites, ['local-test']);

  // Next prompt on the same site: preview only, no replacement attempt.
  await page.keyboard.type(' Please also keep it short.', { delay: 2 });
  await h.waitForStatus(page, 'suggestion', 5000);
  assert.ok((await page.evaluate(() => window.__getText())).startsWith('Hi there!'));
  assert.deepEqual(await counters(page), { submits: 0, enters: 0, sendClicks: 0 });
  await page.close();
});

test('popup: asks the one-time question, shows the paused-site notice, and Retry clears it', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  await page.bringToFront();
  const tabId = await ctx.worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  const popup = await ctx.browser.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html?tab=${tabId}`);
  await popup.waitForFunction(() => document.getElementById('site-detail').textContent !== 'Checking…');
  assert.equal(await popup.$eval('#consent-card', (e) => e.hidden), false);
  await popup.click('#choose-auto');
  await popup.waitForFunction(() => document.getElementById('consent-card').hidden);
  let stored = (await h.getStorage(ctx)).settings;
  assert.deepEqual([stored.modeChosen, stored.applyMode], [true, 'autoApply']);
  assert.equal(await popup.$eval('#apply-mode', (e) => e.value), 'autoApply');

  await h.setSettings(ctx, { autoBlockedSites: ['local-test'] });
  await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('blocked-row').hidden);
  await popup.click('#retry-auto');
  await popup.waitForFunction(() => document.getElementById('blocked-row').hidden);
  stored = (await h.getStorage(ctx)).settings;
  assert.deepEqual(stored.autoBlockedSites, []);
  await popup.close();
  await page.close();
});
