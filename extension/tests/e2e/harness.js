'use strict';
/*
 * Browser test harness.
 *
 * - Serves fixture pages and editor libraries from 127.0.0.1 on a random port.
 * - Builds a TEST copy of the extension whose manifest also matches
 *   http://127.0.0.1/* (the shipped manifest never does).
 * - Launches Chrome (installed Chrome by default; set CHROME_PATH to override)
 *   and loads the unpacked extension through the DevTools protocol.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const SHIP_DIRS = ['src', 'popup', 'options', 'icons', 'ui'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to your Chrome/Chromium executable.');
  return found;
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file;
    if (url.pathname.startsWith('/node_modules/')) file = path.join(EXT_ROOT, url.pathname);
    else file = path.join(FIXTURES, url.pathname === '/' ? 'chat.html' : url.pathname);
    const resolved = path.resolve(file);
    if (!resolved.startsWith(EXT_ROOT) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(resolved)] || 'application/octet-stream' });
    fs.createReadStream(resolved).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function buildTestExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquaguard-ext-'));
  for (const d of SHIP_DIRS) fs.cpSync(path.join(EXT_ROOT, d), path.join(dir, d), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf8'));
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
  manifest.name += ' (TEST BUILD)';
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

async function launch() {
  const server = await startServer();
  const port = server.address().port;
  const extDir = buildTestExtension();
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: process.env.HEADFUL ? false : true,
    pipe: true,
    enableExtensions: true,
    args: ['--no-first-run', '--no-default-browser-check'],
    defaultViewport: { width: 1200, height: 900 },
  });
  const extensionId = await browser.installExtension(extDir);
  const workerTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extensionId}/`),
    { timeout: 15000 }
  );
  const worker = await workerTarget.worker();
  return { browser, server, port, extDir, extensionId, worker, base: `http://127.0.0.1:${port}` };
}

async function close(ctx) {
  if (!ctx) return;
  await ctx.browser.close().catch(() => {});
  ctx.server.close();
  fs.rmSync(ctx.extDir, { recursive: true, force: true });
}

/** Set extension settings through the service worker (same as the options page would). */
async function setSettings(ctx, patch) {
  await ctx.worker.evaluate(async (p) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings || {}), ...p } });
  }, patch);
}

async function getStorage(ctx) {
  return ctx.worker.evaluate(() => chrome.storage.local.get(null));
}

async function resetStorage(ctx) {
  await ctx.worker.evaluate(async () => {
    await chrome.storage.local.clear();
  });
}

async function openFixture(ctx, editor, { host = '127.0.0.1' } = {}) {
  const page = await ctx.browser.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`http://${host}:${ctx.port}/chat.html?editor=${editor}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
  page.__requests = requests;
  return page;
}

/** Reads state the overlay exposes on its host element (status + run counter). */
function overlayState(page) {
  return page.evaluate(() => {
    const host = document.getElementById('aquaguard-prompt-optimizer');
    if (!host) return { present: false, status: null, runs: 0 };
    return { present: true, status: host.dataset.status, runs: Number(host.dataset.runs || 0) };
  });
}

async function waitForStatus(page, status, timeout = 5000) {
  await page.waitForFunction(
    (s) => {
      const host = document.getElementById('aquaguard-prompt-optimizer');
      return host && host.dataset.status === s;
    },
    { timeout },
    status
  );
}

/** Click a button inside the overlay's shadow root by its visible label. */
async function clickOverlay(page, label) {
  const ok = await page.evaluate((text) => {
    const root = document.getElementById('aquaguard-prompt-optimizer').shadowRoot;
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
    if (!btn || btn.disabled || btn.hidden) return false;
    btn.click();
    return true;
  }, label);
  if (!ok) throw new Error(`Overlay button "${label}" not clickable`);
}

async function overlayButton(page, label) {
  return page.evaluate((text) => {
    const root = document.getElementById('aquaguard-prompt-optimizer').shadowRoot;
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
    return btn ? { disabled: btn.disabled, hidden: btn.hidden } : null;
  }, label);
}

async function typeInto(page, text, delay = 5) {
  await page.click('#field');
  await page.keyboard.type(text, { delay });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  launch,
  close,
  setSettings,
  getStorage,
  resetStorage,
  openFixture,
  overlayState,
  waitForStatus,
  clickOverlay,
  overlayButton,
  typeInto,
  sleep,
};
