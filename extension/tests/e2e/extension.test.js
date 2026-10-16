'use strict';
/*
 * End-to-end tests in real Chrome with the unpacked extension loaded.
 * Run: npm run test:e2e   (HEADFUL=1 to watch, CHROME_PATH to pick a browser)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness.js');

const VERBOSE = 'Hi there! Could you please explain how binary search works in a sorted array? Thanks in advance!';
const OPTIMIZED = 'Explain how binary search works in a sorted array.';

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

async function pageCounters(page) {
  return page.evaluate(() => ({ submits: window.__submits, enters: window.__enterKeys, sendClicks: window.__sendClicks || 0 }));
}

async function noNetworkBeyondFixture(page) {
  const foreign = page.__requests.filter((u) => !u.startsWith(ctx.base) && !u.startsWith('data:'));
  assert.deepEqual(foreign, [], 'page made requests outside the local fixture server');
}

for (const editor of ['textarea', 'ce', 'pm', 'quill']) {
  test(`[${editor}] preview does not modify text; Apply replaces without sending; Undo restores`, async () => {
    const page = await h.openFixture(ctx, editor);
    await h.typeInto(page, VERBOSE);

    // Debounced: exactly one optimization run after typing stops.
    await h.waitForStatus(page, 'suggestion', 5000);
    let st = await h.overlayState(page);
    assert.equal(st.runs, 1, 'expected a single debounced run');

    // Preview-first: the prompt box still holds the original.
    assert.equal(await page.evaluate(() => window.__getText()), VERBOSE);

    await h.clickOverlay(page, 'Apply optimization');
    await h.waitForStatus(page, 'applied', 3000);
    assert.equal(await page.evaluate(() => window.__getText()), OPTIMIZED);

    // No loop: our own write must not trigger new runs.
    await h.sleep(1800);
    st = await h.overlayState(page);
    assert.equal(st.runs, 1, 'apply triggered another optimization run (loop)');
    assert.equal(st.status, 'applied');

    // Never sent.
    assert.deepEqual(await pageCounters(page), { submits: 0, enters: 0, sendClicks: 0 });

    await h.clickOverlay(page, 'Undo');
    await page.waitForFunction((t) => window.__getText() === t, { timeout: 3000 }, VERBOSE);
    assert.deepEqual(await pageCounters(page), { submits: 0, enters: 0, sendClicks: 0 });
    await noNetworkBeyondFixture(page);
    await page.close();
  });
}

test('rapid typing in bursts produces one run per pause, not per keystroke', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page, 'Could you please summarize the main causes of', 2);
  await h.sleep(150);
  await page.keyboard.type(' the 2008 financial crisis in exactly 3 bullet points?', { delay: 2 });
  await h.waitForStatus(page, 'suggestion', 5000);
  const st = await h.overlayState(page);
  assert.equal(st.runs, 1);
  await page.close();
});

test('IME composition: no optimization until composition ends', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  await page.click('#field');
  await page.evaluate(() => document.getElementById('field').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await page.keyboard.type(VERBOSE, { delay: 1 });
  await h.sleep(1500);
  assert.equal((await h.overlayState(page)).runs, 0, 'ran during composition');
  await page.evaluate(() => document.getElementById('field').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
  await h.waitForStatus(page, 'suggestion', 4000);
  await page.close();
});

test('short prompts are not optimized; clearing the box returns to idle', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page, 'Explain TCP.');
  await h.sleep(1300);
  let st = await h.overlayState(page);
  assert.equal(st.runs, 0);
  assert.equal(st.status, 'short');

  // Clear the field -> idle
  await page.click('#field', { clickCount: 3 });
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await h.sleep(300);
  st = await h.overlayState(page);
  assert.equal(st.status, 'idle');
  assert.equal(await page.evaluate(() => window.__getText()), '');
  await page.close();
});

test('already-concise prompt is left unchanged with a reason', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  const concise = 'List three causes of the 2008 financial crisis in exactly 3 bullet points.';
  await h.typeInto(page, concise);
  await h.waitForStatus(page, 'unchanged', 5000);
  assert.deepEqual(await h.overlayButton(page, 'Apply optimization'), { disabled: true, hidden: false });
  assert.equal(await page.evaluate(() => window.__getText()), concise);
  await page.close();
});

test('preview-only mode never modifies the text', async () => {
  await h.setSettings(ctx, { applyMode: 'previewOnly' });
  const page = await h.openFixture(ctx, 'pm');
  await h.typeInto(page, VERBOSE);
  await h.waitForStatus(page, 'suggestion', 5000);
  const apply = await h.overlayButton(page, 'Apply optimization');
  assert.equal(apply.hidden, true);
  await h.sleep(1500);
  assert.equal(await page.evaluate(() => window.__getText()), VERBOSE);
  await page.close();
});

test('auto-apply (opt-in) replaces after the pause, never sends, and Undo is respected', async () => {
  await h.setSettings(ctx, { applyMode: 'autoApply' });
  const page = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page, VERBOSE);
  await h.waitForStatus(page, 'applied', 5000);
  assert.equal(await page.evaluate(() => window.__getText()), OPTIMIZED);
  assert.deepEqual(await pageCounters(page), { submits: 0, enters: 0, sendClicks: 0 });

  await h.clickOverlay(page, 'Undo');
  await page.waitForFunction((t) => window.__getText() === t, { timeout: 3000 }, VERBOSE);
  await h.sleep(2000); // must not be re-applied to the text the user restored
  assert.equal(await page.evaluate(() => window.__getText()), VERBOSE);
  await page.close();
});

test('changes made by the website itself (box cleared after send) reset the suggestion', async () => {
  const page = await h.openFixture(ctx, 'pm');
  await h.typeInto(page, VERBOSE);
  await h.waitForStatus(page, 'suggestion', 5000);
  await page.click('#simulate-send');
  await h.waitForStatus(page, 'idle', 3000);
  await page.close();
});

test('normal typing and shortcuts reach the page untouched', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page, 'abc def', 5);
  await page.keyboard.down('Shift');
  await page.keyboard.press('Home');
  await page.keyboard.up('Shift');
  await page.keyboard.type('replaced');
  const out = await page.evaluate(() => ({ text: window.__getText(), keys: window.__keydowns }));
  assert.equal(out.text, 'replaced');
  assert.ok(out.keys >= 'abc def'.length + 'replaced'.length);
  await page.close();
});

async function openPopupFor(page) {
  await page.bringToFront();
  const tabId = await ctx.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab.id;
  });
  const popup = await ctx.browser.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html?tab=${tabId}`);
  await popup.waitForFunction(() => document.getElementById('site-detail').textContent !== 'Checking…');
  return popup;
}

test('popup: shows site + estimates, Apply/Undo work, global toggle disables the content script', async () => {
  const page = await h.openFixture(ctx, 'ce');
  await h.typeInto(page, VERBOSE);
  await h.waitForStatus(page, 'suggestion', 5000);

  const popup = await openPopupFor(page);
  await popup.waitForFunction(() => document.getElementById('m-saved').textContent !== '–');
  const info = await popup.evaluate(() => ({
    site: document.getElementById('site-name').textContent,
    badge: document.getElementById('status-badge').textContent,
    saved: Number(document.getElementById('m-saved').textContent.replace(/,/g, '')),
    pct: document.getElementById('m-pct').textContent,
    note: document.getElementById('m-note').textContent,
  }));
  assert.match(info.site, /Local test page/);
  assert.equal(info.badge, 'On');
  assert.ok(info.saved > 0);
  assert.match(info.pct, /%$/);
  assert.match(info.note, /Estimated/);

  await popup.click('#btn-apply');
  await page.waitForFunction((t) => window.__getText() === t, { timeout: 3000 }, OPTIMIZED);
  await popup.waitForFunction(() => !document.getElementById('btn-undo').disabled);
  await popup.click('#btn-undo');
  await page.waitForFunction((t) => window.__getText() === t, { timeout: 3000 }, VERBOSE);

  // Global toggle off -> overlay removed and no more runs.
  await popup.click('#toggle-enabled');
  await popup.waitForFunction(() => document.getElementById('status-badge').textContent === 'Off');
  const stored = await h.getStorage(ctx);
  assert.equal(stored.settings.enabled, false);
  await page.waitForFunction(() => !document.getElementById('aquaguard-prompt-optimizer'), { timeout: 3000 });
  await page.bringToFront();
  await page.click('#field');
  await page.keyboard.type(' Could you please also add an example?');
  await h.sleep(1500);
  assert.equal((await h.overlayState(page)).present, false);
  await popup.close();
  await page.close();
});

test('popup: per-site toggle disables only this site', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  const popup = await openPopupFor(page);
  await popup.click('#toggle-site');
  await popup.waitForFunction(() => document.getElementById('status-badge').textContent === 'Off here');
  const stored = await h.getStorage(ctx);
  assert.deepEqual(stored.settings.disabledSites, ['local-test']);
  assert.equal(stored.settings.enabled, true);
  await page.bringToFront();
  await h.typeInto(page, VERBOSE);
  await h.sleep(1500);
  assert.equal((await h.overlayState(page)).present, false);
  await popup.close();
  await page.close();
});

test('unsupported site: no content script, popup says so', async () => {
  // "localhost" is not in the test manifest's matches, so this is an unsupported site.
  const page = await h.openFixture(ctx, 'textarea', { host: 'localhost' });
  await h.typeInto(page, VERBOSE);
  await h.sleep(1500);
  assert.equal((await h.overlayState(page)).present, false);
  assert.equal(await page.evaluate(() => window.__getText()), VERBOSE);
  const popup = await openPopupFor(page);
  const name = await popup.$eval('#site-name', (e) => e.textContent);
  assert.equal(name, 'Not a supported site');
  assert.equal(await popup.$eval('#result-card', (e) => e.hidden), true);
  await popup.close();
  await page.close();
});

test('privacy: no statistics by default; opt-in stats contain no prompt text', async () => {
  const page = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page, VERBOSE);
  await h.waitForStatus(page, 'suggestion', 5000);
  await h.clickOverlay(page, 'Apply optimization');
  await h.waitForStatus(page, 'applied');
  await h.sleep(300);
  let stored = await h.getStorage(ctx);
  assert.equal(stored.stats, undefined, 'stats were stored without opt-in');
  for (const value of Object.values(stored)) {
    assert.equal(JSON.stringify(value).includes('binary search'), false, 'prompt text found in storage');
  }
  await page.close();

  await h.setSettings(ctx, { collectStats: true });
  const page2 = await h.openFixture(ctx, 'textarea');
  await h.typeInto(page2, VERBOSE);
  await h.waitForStatus(page2, 'suggestion', 5000);
  await h.clickOverlay(page2, 'Apply optimization');
  await h.waitForStatus(page2, 'applied');
  await page2.click('#simulate-send'); // prompt "sent" -> completed outcome recorded
  await h.waitForStatus(page2, 'idle', 3000);
  await h.sleep(500);
  stored = await h.getStorage(ctx);
  assert.ok(stored.stats, 'stats missing after opt-in');
  assert.equal(stored.stats.totals.applyActions, 1);
  assert.equal(stored.stats.totals.promptsOptimized, 1);
  assert.ok(stored.stats.totals.tokensSaved > 0);
  const json = JSON.stringify(stored);
  for (const fragment of ['binary search', 'sorted array', 'Thanks in advance', '127.0.0.1']) {
    assert.equal(json.includes(fragment), false, `"${fragment}" leaked into storage`);
  }
  await noNetworkBeyondFixture(page2);
  await page2.close();
});

test('options page: sandbox optimizes, impact is unavailable by default, reset clears data', async () => {
  await h.setSettings(ctx, { collectStats: true });
  const page = await ctx.browser.newPage();
  await page.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
  await page.type('#try-input', VERBOSE);
  await page.click('#try-run');
  const stats = await page.$eval('#try-stats', (e) => e.textContent);
  assert.match(stats, /estimated tokens/);
  const diffText = await page.$eval('#try-diff', (e) => e.textContent);
  assert.ok(diffText.includes('binary search'));

  const impact = await page.$eval('#impact-result', (e) => e.textContent);
  assert.match(impact, /unavailable/);

  page.on('dialog', (d) => d.accept());
  await page.click('#reset-all');
  await page.waitForFunction(() => document.getElementById('saved').textContent === 'Everything reset');
  const stored = await h.getStorage(ctx);
  assert.equal(stored.stats, undefined);
  assert.equal(stored.settings.collectStats, false);
  await page.close();
});
