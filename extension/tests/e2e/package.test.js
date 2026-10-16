'use strict';
/*
 * Loads the packaged ZIP (dist/aquaguard-prompt-optimizer-<version>.zip) into
 * Chrome to prove the release artifact itself is installable.
 * Build it first:  python scripts/package_extension.py
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const puppeteer = require('puppeteer-core');

const REPO = path.resolve(__dirname, '..', '..', '..');
const version = JSON.parse(fs.readFileSync(path.join(REPO, 'extension', 'manifest.json'), 'utf8')).version;
const ZIP = path.join(REPO, 'dist', `aquaguard-prompt-optimizer-${version}.zip`);

function chromePath() {
  return [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    .filter(Boolean)
    .find((p) => fs.existsSync(p));
}

/** Minimal ZIP extractor (stored/deflate entries) using the central directory. */
function unzip(zip, dest) {
  const buf = fs.readFileSync(zip);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    const out = path.join(dest, name);
    assert.ok(path.resolve(out).startsWith(path.resolve(dest)), `unsafe path in zip: ${name}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
}

test('packaged ZIP installs in Chrome and its pages load', { skip: !fs.existsSync(ZIP) && 'build the ZIP first' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquaguard-zip-'));
  unzip(ZIP, dir);
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, pipe: true, enableExtensions: true });
  try {
    const id = await browser.installExtension(dir);
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${id}/`), { timeout: 15000 });
    const worker = await sw.worker();
    // onInstalled writes defaults asynchronously; poll briefly.
    const settings = await worker.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        const { settings } = await chrome.storage.local.get('settings');
        if (settings) return settings;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    });
    assert.ok(settings, 'defaults were not written on install');
    assert.equal(settings.enabled, true);
    assert.equal(settings.collectStats, false);

    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/popup/popup.html`);
    await page.waitForFunction(() => document.getElementById('site-detail').textContent !== 'Checking\u2026');
    assert.equal(await page.$eval('#site-name', (e) => e.textContent), 'Not a supported site');
    await page.goto(`chrome-extension://${id}/options/options.html`);
    await page.waitForFunction(() => document.getElementById('version').textContent.length > 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
