#!/usr/bin/env node
/*
 * Builds the Chrome Web Store images from the REAL extension running in
 * Chrome on a neutral demo chat page (no third-party branding).
 *
 *   cd extension && npm install      (once)
 *   node ../store/build_store_assets.js
 *
 * Output (store/images/):
 *   screenshot-1..5.png   1280x800   (store screenshots)
 *   promo-small-440x280.png          (required small promo tile)
 *   promo-marquee-1400x560.png       (optional marquee)
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const h = require('../extension/tests/e2e/harness.js');

const OUT = path.join(__dirname, 'images');
const EXT = path.join(__dirname, '..', 'extension');
const ORIGINAL = fs.readFileSync(path.join(EXT, 'eval', 'regression', 'ml_learning_prompt_original.txt'), 'utf8').trim();
const SHORT =
  'Hi there! I was wondering if you could explain how a hash map handles collisions in order to keep lookups fast. ' +
  'Please do not use any code longer than 10 lines. Remember to not use any code longer than 10 lines. Thanks in advance!';
const ICON = 'data:image/png;base64,' + fs.readFileSync(path.join(EXT, 'icons', 'icon128.png')).toString('base64');

async function demo(ctx, title, sub, rows = 9) {
  const page = await ctx.browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const q = new URLSearchParams({ title, sub, rows: String(rows) });
  await page.goto(`${ctx.base}/store-demo.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true);
  return page;
}

async function type(page, text) {
  await page.click('#field');
  await page.keyboard.type(text, { delay: 0 });
}

const shadowClick = (page, sel) =>
  page.evaluate((s) => document.getElementById('aquaguard-prompt-optimizer').shadowRoot.querySelector(s).click(), sel);

async function compose(ctx, file, width, height, html) {
  const page = await ctx.browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(OUT, file) });
  await page.close();
}

const BASE_CSS = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:radial-gradient(1200px 600px at 20% 0%,#0f3a63 0%,#071425 60%);color:#ecfeff;overflow:hidden}`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await h.launch();
  try {
    // 1. Automatic mode on the user's real test prompt.
    await h.resetStorage(ctx);
    await h.setSettings(ctx, { applyMode: 'autoApply', modeChosen: true });
    let page = await demo(ctx, 'Shorter prompts, same requirements', 'Pause typing and AquaGuard trims the filler. Every number, "not" and requirement stays. One-click Undo.');
    await type(page, ORIGINAL);
    await h.waitForStatus(page, 'applied', 8000);
    await h.sleep(300);
    await page.screenshot({ path: path.join(OUT, 'screenshot-1.png') });
    await page.close();

    // 2. Manual mode: review panel with the diff.
    await h.setSettings(ctx, { applyMode: 'manual', modeChosen: true });
    page = await demo(ctx, 'See exactly what changes', 'Red is removed, green is added, with token estimates and the reason for each change.', 3);
    await type(page, SHORT);
    await h.waitForStatus(page, 'suggestion', 8000);
    await shadowClick(page, '.pill');
    await h.sleep(300);
    await page.screenshot({ path: path.join(OUT, 'screenshot-2.png') });

    // 4. Popup (captured now, while this tab has a suggestion).
    await page.bringToFront();
    const tabId = await ctx.worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    const popup = await ctx.browser.newPage();
    await popup.setViewport({ width: 360, height: 760, deviceScaleFactor: 2 });
    await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html?tab=${tabId}`);
    await popup.waitForFunction(() => document.getElementById('m-saved').textContent !== '–');
    // The site card names the local test server (127.0.0.1); leave it out of store imagery.
    await popup.evaluate(() => document.getElementById('site-card').remove());
    const main = await popup.$('main');
    const popupPng = 'data:image/png;base64,' + (await main.screenshot({ encoding: 'base64' }));
    await popup.close();
    await page.close();

    // 3. First-use question.
    await h.resetStorage(ctx);
    page = await demo(ctx, 'You choose: automatic or manual', 'Asked once. Change it anytime from the toolbar. Nothing is ever sent for you.');
    await type(page, SHORT);
    await h.waitForStatus(page, 'suggestion', 8000);
    await h.sleep(300);
    await page.screenshot({ path: path.join(OUT, 'screenshot-3.png') });
    await page.close();

    await compose(ctx, 'screenshot-4.png', 1280, 800, `<style>${BASE_CSS}
      .wrap{display:flex;align-items:center;gap:70px;height:800px;padding:0 90px}
      .txt{flex:1}.txt img{width:64px}h1{font-size:40px;margin:14px 0 18px;line-height:1.1}
      li{font-size:20px;margin:12px 0;color:#cfeaff;list-style:none;padding-left:30px;position:relative}
      li:before{content:"\\2713";position:absolute;left:0;color:#22d3ee;font-weight:700}
      .shot{height:720px;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55)}</style>
      <div class="wrap"><div class="txt"><img src="${ICON}"><h1>Private by design</h1><ul>
      <li>Runs entirely in your browser</li><li>No prompts are sent or stored</li><li>Never sends a message for you</li>
      <li>Turn it off globally or per site</li><li>Optional local statistics, off by default</li></ul></div>
      <img class="shot" src="${popupPng}"></div>`);

    // 5. Settings page "Try it" sandbox.
    const opts = await ctx.browser.newPage();
    await opts.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await opts.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
    await opts.type('#try-input', SHORT);
    await opts.click('#try-run');
    await opts.evaluate(() => {
      document.getElementById('h-try').scrollIntoView();
      window.scrollBy(0, -16);
    });
    await h.sleep(200);
    await opts.screenshot({ path: path.join(OUT, 'screenshot-5.png') });
    await opts.close();

    // Promo tiles.
    const tile = (w, hgt, big) => `<style>${BASE_CSS}
      .t{height:${hgt}px;display:flex;align-items:center;gap:${big ? 40 : 22}px;padding:0 ${big ? 90 : 34}px}
      img{width:${big ? 150 : 92}px}h1{margin:0;font-size:${big ? 58 : 30}px;line-height:1.05;letter-spacing:-.01em}
      p{margin:${big ? 16 : 10}px 0 0;font-size:${big ? 26 : 15}px;color:#9fd8ef;line-height:1.3}</style>
      <div class="t"><img src="${ICON}"><div><h1>AquaGuard<br>Prompt Optimizer</h1><p>Shorter AI prompts, same requirements.${big ? '<br>Local, private, one-click Undo.' : ''}</p></div></div>`;
    await compose(ctx, 'promo-small-440x280.png', 440, 280, tile(440, 280, false));
    await compose(ctx, 'promo-marquee-1400x560.png', 1400, 560, tile(1400, 560, true));

    console.log(`Store images written to ${OUT}`);
  } finally {
    await h.close(ctx);
  }
})();
