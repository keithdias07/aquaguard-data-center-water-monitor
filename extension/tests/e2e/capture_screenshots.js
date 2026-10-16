#!/usr/bin/env node
/*
 * Captures README screenshots of the real extension UI on the local fixture
 * page:  npm run screenshots   ->  docs/screenshots/*.png
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const h = require('./harness.js');

const OUT = path.resolve(__dirname, '..', '..', '..', 'docs', 'screenshots');
const PROMPT =
  'Hi there! I was wondering if you could explain how a hash map handles collisions in order to keep lookups fast. ' +
  'Please do not use any code longer than 10 lines. Remember to not use any code longer than 10 lines. Thanks in advance!';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await h.launch();
  try {
    const page = await h.openFixture(ctx, 'pm');
    await page.setViewport({ width: 1100, height: 760, deviceScaleFactor: 2 });
    await h.typeInto(page, PROMPT, 1);
    await h.waitForStatus(page, 'suggestion', 5000);
    await page.evaluate(() => document.getElementById('aquaguard-prompt-optimizer').shadowRoot.querySelector('.pill').click());
    await h.sleep(400);
    await page.screenshot({ path: path.join(OUT, 'overlay-preview.png') });

    const tabId = await ctx.worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    const popup = await ctx.browser.newPage();
    await popup.setViewport({ width: 360, height: 600, deviceScaleFactor: 2 });
    await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html?tab=${tabId}`);
    await popup.waitForFunction(() => document.getElementById('m-saved').textContent !== '–');
    const box = await popup.$eval('main', (m) => m.getBoundingClientRect().height);
    await popup.screenshot({ path: path.join(OUT, 'popup.png'), clip: { x: 0, y: 0, width: 360, height: Math.ceil(box) } });

    const opts = await ctx.browser.newPage();
    await opts.setViewport({ width: 1000, height: 900, deviceScaleFactor: 1.5 });
    await opts.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
    await opts.type('#try-input', PROMPT);
    await opts.click('#try-run');
    await opts.evaluate(() => document.getElementById('h-try').scrollIntoView());
    await h.sleep(200);
    await opts.screenshot({ path: path.join(OUT, 'options-try-it.png') });
    console.log(`Screenshots written to ${OUT}`);
  } finally {
    await h.close(ctx);
  }
})();
