/* Settings page: preferences, sites, sandbox, statistics, impact, reset. */
(function () {
  'use strict';
  const AG = globalThis.AquaGuard;
  const S = AG.settings;
  const $ = (id) => document.getElementById(id);

  let settings = S.sanitizeSettings({});
  let stats = S.emptyStats();

  const fmtInt = (n) => Math.round(n).toLocaleString();
  const fmtNum = (n, d = 2) => (n === 0 ? '0' : n < 0.01 ? n.toExponential(2) : n.toFixed(d));

  function flashSaved(text = 'Saved') {
    $('saved').textContent = text;
    clearTimeout(flashSaved.t);
    flashSaved.t = setTimeout(() => ($('saved').textContent = ''), 1500);
  }

  async function save(patch) {
    settings = S.sanitizeSettings({ ...settings, ...patch });
    await chrome.storage.local.set({ settings });
    render();
    flashSaved();
  }

  // ------------------------------------------------------------- render

  function render() {
    $('enabled').checked = settings.enabled;
    $('autoOptimize').checked = settings.autoOptimize;
    for (const r of document.querySelectorAll('input[name="applyMode"]')) r.checked = r.value === settings.applyMode;
    $('debounceMs').value = settings.debounceMs;
    $('minPromptChars').value = settings.minPromptChars;
    $('level').value = settings.level;
    $('autoMinTokensSaved').value = settings.autoMinTokensSaved;
    $('autoMinReductionPct').value = settings.autoMinReductionPct;
    const blocked = settings.autoBlockedSites
      .map((id) => (AG.adapters.byId(id) || { name: id }).name)
      .join(', ');
    $('mode-choice-note').textContent =
      (settings.modeChosen ? 'You have chosen a mode.' : 'You have not chosen yet: AquaGuard will ask on your first long prompt.') +
      (blocked ? ` Automatic mode is paused (preview instead) on: ${blocked}.` : '');
    $('reset-blocked').disabled = !blocked;
    $('collectStats').checked = settings.collectStats;
    renderSites();
    renderStats();
    renderImpact();
  }

  function renderSites() {
    const box = $('sites');
    box.textContent = '';
    for (const a of AG.adapters.ADAPTERS.filter((x) => x.support !== 'test')) {
      const row = document.createElement('div');
      row.className = 'site';
      const label = document.createElement('label');
      label.htmlFor = `site-${a.id}`;
      label.innerHTML = '<strong></strong><br><span class="muted small"></span>';
      label.querySelector('strong').textContent = a.name;
      label.querySelector('span').textContent = `${a.hosts.join(', ')} · ${a.support === 'primary' ? 'supported' : 'experimental'} · ${a.editor} editor`;
      const sw = document.createElement('span');
      sw.className = 'switch';
      sw.innerHTML = '<input type="checkbox" role="switch"><span class="track"></span>';
      const input = sw.querySelector('input');
      input.id = `site-${a.id}`;
      input.checked = !settings.disabledSites.includes(a.id);
      input.addEventListener('change', () => {
        const set = new Set(settings.disabledSites);
        if (input.checked) set.delete(a.id);
        else set.add(a.id);
        save({ disabledSites: [...set] });
      });
      row.append(label, sw);
      box.appendChild(row);
    }
  }

  function metric(label, value, good) {
    const d = document.createElement('div');
    d.className = 'metric' + (good ? ' good' : '');
    const b = document.createElement('b');
    b.textContent = value;
    const s = document.createElement('span');
    s.textContent = label;
    d.append(b, s);
    return d;
  }

  function renderStats() {
    const box = $('stats-metrics');
    box.textContent = '';
    const sum = S.summarizeStats(stats);
    box.append(
      metric('Prompts optimized', fmtInt(sum.promptsOptimized), true),
      metric('Est. tokens saved (net)', fmtInt(sum.netTokensSaved), true),
      metric('Avg. reduction (applied)', `${sum.averageReductionPct.toFixed(1)}%`),
      metric('Avg. latency', `${sum.averageLatencyMs.toFixed(2)} ms`),
      metric('Left unchanged', fmtInt(sum.promptsLeftUnchanged)),
      metric('Suggestions not applied', fmtInt(sum.promptsDeclined))
    );
    $('stats-note').textContent = settings.collectStats
      ? `Recording since ${stats.firstRecordedOn || 'now'}. "Tokens saved" uses local estimates at the moment you clicked Apply; AquaGuard cannot see what you finally sent.`
      : 'Statistics are off. Nothing is being recorded.';
  }

  function renderImpact() {
    const a = settings.impact;
    $('impact-mode').checked = a.mode === 'illustrative';
    const map = { eLow: 'energyWhPer1kTokensLow', eHigh: 'energyWhPer1kTokensHigh', wLow: 'waterLitersPerKwhLow', wHigh: 'waterLitersPerKwhHigh' };
    for (const [id, key] of Object.entries(map)) {
      $(id).value = a[key] === null ? '' : a[key];
      $(id).disabled = a.mode !== 'illustrative';
    }
    const sum = S.summarizeStats(stats);
    const r = AG.impact.estimateImpact(sum.netTokensSaved, a);
    const out = $('impact-result');
    if (!r.available) {
      out.textContent = `Environmental impact: unavailable. ${r.reason} Observed (estimated) tokens saved: ${fmtInt(sum.netTokensSaved)}.`;
    } else {
      out.textContent =
        `Illustrative scenario for ${fmtInt(r.tokensSaved)} estimated tokens saved: ` +
        `${fmtNum(r.energyWh.low, 3)}–${fmtNum(r.energyWh.high, 3)} Wh and ` +
        `${fmtNum(r.waterMl.low, 3)}–${fmtNum(r.waterMl.high, 3)} mL of water. ${r.disclaimer}`;
    }
    const refs = $('impact-refs');
    refs.textContent = '';
    for (const ref of AG.impact.REFERENCES) {
      const li = document.createElement('li');
      li.textContent = `${ref.citation} ${ref.note}`;
      refs.appendChild(li);
    }
  }

  // ------------------------------------------------------------ sandbox

  function runSandbox() {
    const text = $('try-input').value;
    const r = AG.compressor.optimize(text, { level: settings.level });
    const diff = $('try-diff');
    diff.textContent = '';
    const ops = r.changed ? AG.diff.wordDiff(r.original, r.optimized) : null;
    if (ops) {
      for (const op of ops) {
        const tag = op.type === 'removed' ? 'del' : op.type === 'added' ? 'ins' : 'span';
        const n = document.createElement(tag);
        n.textContent = op.text;
        diff.appendChild(n);
      }
    } else if (text.trim()) {
      diff.textContent = r.optimized;
    }
    $('try-stats').textContent = text.trim()
      ? `~${r.originalTokens} → ~${r.optimizedTokens} estimated tokens (${r.reductionPct.toFixed(1)}% fewer) · ${r.latencyMs.toFixed(2)} ms` +
        (r.changed ? '' : ` · unchanged: ${r.reason}`)
      : '';
    const chips = $('try-chips');
    chips.textContent = '';
    for (const t of r.transformations) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = `${t.description}${t.count > 1 ? ` ×${t.count}` : ''}`;
      chips.appendChild(c);
    }
  }

  // ------------------------------------------------------------- export

  function exportStats() {
    const data = S.exportStats(stats, { extensionVersion: chrome.runtime.getManifest().version });
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aquaguard_extension_stats_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --------------------------------------------------------------- init

  async function init() {
    $('version').textContent = chrome.runtime.getManifest().version;
    const data = await chrome.storage.local.get(['settings', 'stats']);
    settings = S.sanitizeSettings(data.settings);
    stats = S.sanitizeStats(data.stats);
    render();

    for (const id of ['enabled', 'autoOptimize', 'collectStats']) {
      $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
    }
    for (const r of document.querySelectorAll('input[name="applyMode"]')) {
      r.addEventListener('change', () => save({ applyMode: r.value, modeChosen: true }));
    }
    $('autoMinTokensSaved').addEventListener('change', (e) => save({ autoMinTokensSaved: e.target.value }));
    $('autoMinReductionPct').addEventListener('change', (e) => save({ autoMinReductionPct: e.target.value }));
    $('reset-choice').addEventListener('click', () => save({ modeChosen: false, applyMode: 'manual' }));
    $('reset-blocked').addEventListener('click', () => save({ autoBlockedSites: [] }));
    $('debounceMs').addEventListener('change', (e) => save({ debounceMs: e.target.value }));
    $('minPromptChars').addEventListener('change', (e) => save({ minPromptChars: e.target.value }));
    $('level').addEventListener('change', (e) => save({ level: e.target.value }));

    $('impact-mode').addEventListener('change', (e) => save({ impact: { ...settings.impact, mode: e.target.checked ? 'illustrative' : 'off' } }));
    const impactKeys = { eLow: 'energyWhPer1kTokensLow', eHigh: 'energyWhPer1kTokensHigh', wLow: 'waterLitersPerKwhLow', wHigh: 'waterLitersPerKwhHigh' };
    for (const [id, key] of Object.entries(impactKeys)) {
      $(id).addEventListener('change', (e) => save({ impact: { ...settings.impact, [key]: e.target.value } }));
    }

    $('try-run').addEventListener('click', runSandbox);
    $('export').addEventListener('click', exportStats);
    $('reset-stats').addEventListener('click', async () => {
      if (!confirm('Delete all AquaGuard usage statistics stored on this computer?')) return;
      await chrome.storage.local.remove('stats');
      stats = S.emptyStats();
      render();
      flashSaved('Statistics reset');
    });
    $('reset-all').addEventListener('click', async () => {
      if (!confirm('Reset all AquaGuard settings and delete all statistics?')) return;
      await chrome.storage.local.clear();
      settings = S.sanitizeSettings({});
      stats = S.emptyStats();
      await chrome.storage.local.set({ settings });
      render();
      flashSaved('Everything reset');
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.stats) stats = S.sanitizeStats(changes.stats.newValue);
      if (changes.settings) settings = S.sanitizeSettings(changes.settings.newValue);
      render();
    });
  }

  init();
})();
