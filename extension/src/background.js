/*
 * Background service worker.
 *
 * Responsibilities (deliberately small):
 *   - write default settings on install
 *   - serialize aggregate-statistics writes from all tabs (opt-in only)
 *   - show an "OFF" badge on the toolbar icon when optimization is disabled
 *
 * It makes no network requests.
 */
importScripts('engine/impact.js', 'shared/settings.js');

const S = self.AquaGuard.settings;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return S.sanitizeSettings(settings);
}

async function updateBadge(settings) {
  const s = settings || (await getSettings());
  await chrome.action.setBadgeBackgroundColor({ color: '#475569' });
  await chrome.action.setBadgeText({ text: s.enabled ? '' : 'OFF' });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  const clean = S.sanitizeSettings(settings);
  await chrome.storage.local.set({ settings: clean });
  await updateBadge(clean);
});

chrome.runtime.onStartup.addListener(() => updateBadge());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) updateBadge(S.sanitizeSettings(changes.settings.newValue));
});

// One write at a time, so events from several tabs never overwrite each other.
let queue = Promise.resolve();

function recordStat(event) {
  queue = queue
    .then(async () => {
      const settings = await getSettings();
      if (!settings.collectStats) return; // opt-in is checked here, the source of truth
      const { stats } = await chrome.storage.local.get('stats');
      await chrome.storage.local.set({ stats: S.recordEvent(stats, event) });
    })
    .catch((err) => console.warn('AquaGuard: could not record statistics', err));
  return queue;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== chrome.runtime.id) return;
  if (msg.type === 'AG_STATS_EVENT') {
    recordStat(msg.event).then(() => sendResponse({ ok: true }));
    return true; // async response
  }
});
