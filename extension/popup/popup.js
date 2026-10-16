/*
 * Popup: global on/off, mode, per-site toggle and the current tab's result.
 *
 * The popup talks only to the content script in the active tab. If no content
 * script answers, the tab is not a supported site. No "tabs" permission is
 * needed for this.
 */
(function () {
  'use strict';
  const AG = globalThis.AquaGuard;
  const $ = (id) => document.getElementById(id);

  const MODE_HELP = {
    manual: 'Shows a suggestion after you pause typing. Your text changes only when you click Apply.',
    previewOnly: 'Shows token estimates and the suggested rewrite but never changes your text.',
    autoApply: 'Replaces the text after you pause typing. Always undoable. Never sends the prompt.',
  };

  let settings = AG.settings.sanitizeSettings({});
  let tabId = null;
  let lastState = null;

  const fmtInt = (n) => Math.round(n).toLocaleString();

  async function loadSettings() {
    const data = await chrome.storage.local.get('settings');
    settings = AG.settings.sanitizeSettings(data.settings);
  }

  async function saveSettings(patch) {
    settings = AG.settings.sanitizeSettings({ ...settings, ...patch });
    await chrome.storage.local.set({ settings });
    renderSettings();
    refresh();
  }

  function renderSettings() {
    $('toggle-enabled').checked = settings.enabled;
    $('apply-mode').value = settings.applyMode;
    $('mode-help').textContent = MODE_HELP[settings.applyMode];
    $('enabled-help').textContent = settings.enabled ? 'Enabled on supported sites' : 'Disabled everywhere';
    renderBadge();
  }

  function renderBadge() {
    const badge = $('status-badge');
    const siteOff = lastState && lastState.supported && settings.disabledSites.includes(lastState.site.id);
    if (!settings.enabled) {
      badge.className = 'badge off';
      badge.textContent = 'Off';
    } else if (siteOff) {
      badge.className = 'badge warn';
      badge.textContent = 'Off here';
    } else {
      badge.className = 'badge on';
      badge.textContent = 'On';
    }
  }

  async function activeTabId() {
    const forced = new URLSearchParams(location.search).get('tab'); // used by automated tests
    if (forced) return Number(forced);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? tab.id : null;
  }

  function send(type) {
    return new Promise((resolve) => {
      if (tabId === null) return resolve(null);
      try {
        chrome.tabs.sendMessage(tabId, { type }, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function supportedList() {
    return AG.adapters.ADAPTERS.filter((a) => a.support !== 'test')
      .map((a) => (a.support === 'primary' ? a.name : `${a.name} (experimental)`))
      .join(', ');
  }

  function renderState(state) {
    lastState = state;
    renderBadge();
    const siteSwitch = $('site-switch-wrap');
    const card = $('result-card');
    if (!state || !state.supported) {
      $('site-name').textContent = 'Not a supported site';
      $('site-detail').textContent = `Works on: ${supportedList()}. If this is one of them, reload the tab.`;
      siteSwitch.hidden = true;
      card.hidden = true;
      return;
    }
    const siteEnabled = !settings.disabledSites.includes(state.site.id);
    $('site-name').textContent = `${state.site.name} · ${state.site.hostname}`;
    $('site-detail').textContent =
      (state.site.support === 'primary' ? 'Supported' : state.site.support === 'test' ? 'Local test page' : 'Experimental support') +
      (siteEnabled ? '' : ' · disabled on this site') +
      (state.fieldFound ? '' : ' · prompt box not found yet');
    siteSwitch.hidden = false;
    $('toggle-site').checked = siteEnabled;
    $('toggle-site').disabled = !settings.enabled;

    card.hidden = !state.active;
    const r = state.result;
    $('m-orig').textContent = r ? `~${fmtInt(r.originalTokens)}` : '–';
    $('m-opt').textContent = r ? `~${fmtInt(r.optimizedTokens)}` : '–';
    $('m-saved').textContent = r ? fmtInt(r.tokensSaved) : '–';
    $('m-pct').textContent = r ? `${r.reductionPct.toFixed(1)}%` : '–';
    $('m-note').textContent = r
      ? `Estimated counts (${r.tokenizer.label}) · ${r.latencyMs.toFixed(1)} ms${r.changed ? '' : ' · left unchanged'}`
      : 'Type a prompt on the page to see a suggestion. Counts are local estimates.';
    $('m-message').textContent = state.message || (r && !r.changed ? r.reason : '');
    $('btn-apply').hidden = settings.applyMode === 'previewOnly';
    $('btn-apply').disabled = !state.canApply;
    $('btn-undo').disabled = !state.canUndo;
    $('btn-optimize').disabled = !state.fieldFound;
  }

  async function refresh() {
    renderState(await send('AG_GET_STATE'));
  }

  async function act(type) {
    const state = await send(type);
    renderState(state);
  }

  async function init() {
    await loadSettings();
    renderSettings();
    tabId = await activeTabId();
    await refresh();

    $('toggle-enabled').addEventListener('change', (e) => saveSettings({ enabled: e.target.checked }));
    $('apply-mode').addEventListener('change', (e) => saveSettings({ applyMode: e.target.value }));
    $('toggle-site').addEventListener('change', (e) => {
      if (!lastState || !lastState.supported) return;
      const id = lastState.site.id;
      const set = new Set(settings.disabledSites);
      if (e.target.checked) set.delete(id);
      else set.add(id);
      saveSettings({ disabledSites: [...set] });
    });
    $('btn-optimize').addEventListener('click', () => act('AG_OPTIMIZE_NOW'));
    $('btn-apply').addEventListener('click', () => act('AG_APPLY'));
    $('btn-undo').addEventListener('click', () => act('AG_UNDO'));
    $('open-options').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    setInterval(refresh, 1000); // keep numbers in sync while the user types
  }

  init();
})();
