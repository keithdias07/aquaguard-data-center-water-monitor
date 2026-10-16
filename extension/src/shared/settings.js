/*
 * Settings and aggregate statistics: defaults, validation and pure reducers.
 *
 * Storage layout (chrome.storage.local, never synced to the cloud):
 *   settings  user preferences (see DEFAULT_SETTINGS)
 *   stats     aggregate counters, only written when settings.collectStats is
 *             true. Contains NO prompt text, URLs or page content.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const impact = isNode ? require('../engine/impact.js') : root.AquaGuard.impact;
  const api = factory(impact);
  if (isNode) {
    module.exports = api;
  } else {
    root.AquaGuard = root.AquaGuard || {};
    root.AquaGuard.settings = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (impact) {
  'use strict';

  const APPLY_MODES = ['manual', 'previewOnly', 'autoApply'];
  const LEVELS = ['conservative', 'balanced'];

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    autoOptimize: true, // compute a suggestion after typing pauses
    applyMode: 'manual', // preview first; user clicks Apply
    modeChosen: false, // false until the user answers the one-time Automatic/Manual question
    debounceMs: 1000,
    minPromptChars: 40,
    level: 'balanced',
    autoMinTokensSaved: 3, // automatic mode only replaces text when savings are meaningful
    autoMinReductionPct: 3,
    disabledSites: [], // adapter ids, e.g. "claude"
    autoBlockedSites: [], // sites whose editor rejected an automatic replacement -> preview there
    collectStats: false, // opt-in aggregate statistics
    impact: impact.DEFAULT_ASSUMPTIONS,
  });

  const LIMITS = {
    debounceMs: [300, 3000],
    minPromptChars: [0, 2000],
    autoMinTokensSaved: [1, 500],
    autoMinReductionPct: [0, 90],
  };

  const siteList = (v) =>
    Array.isArray(v) ? [...new Set(v.filter((s) => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s)))] : [];

  function clampInt(value, [lo, hi], fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  /** Return a complete, valid settings object from any (possibly stale) input. */
  function sanitizeSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_SETTINGS;
    const imp = r.impact && typeof r.impact === 'object' ? r.impact : {};
    return {
      enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
      autoOptimize: typeof r.autoOptimize === 'boolean' ? r.autoOptimize : d.autoOptimize,
      applyMode: APPLY_MODES.includes(r.applyMode) ? r.applyMode : d.applyMode,
      modeChosen: typeof r.modeChosen === 'boolean' ? r.modeChosen : d.modeChosen,
      debounceMs: clampInt(r.debounceMs, LIMITS.debounceMs, d.debounceMs),
      minPromptChars: clampInt(r.minPromptChars, LIMITS.minPromptChars, d.minPromptChars),
      level: LEVELS.includes(r.level) ? r.level : d.level,
      autoMinTokensSaved: clampInt(r.autoMinTokensSaved, LIMITS.autoMinTokensSaved, d.autoMinTokensSaved),
      autoMinReductionPct: clampInt(r.autoMinReductionPct, LIMITS.autoMinReductionPct, d.autoMinReductionPct),
      disabledSites: siteList(r.disabledSites),
      autoBlockedSites: siteList(r.autoBlockedSites),
      collectStats: typeof r.collectStats === 'boolean' ? r.collectStats : d.collectStats,
      impact: {
        mode: imp.mode === 'illustrative' ? 'illustrative' : 'off',
        energyWhPer1kTokensLow: optionalNumber(imp.energyWhPer1kTokensLow),
        energyWhPer1kTokensHigh: optionalNumber(imp.energyWhPer1kTokensHigh),
        waterLitersPerKwhLow: optionalNumber(imp.waterLitersPerKwhLow),
        waterLitersPerKwhHigh: optionalNumber(imp.waterLitersPerKwhHigh),
      },
    };
  }

  // ------------------------------------------------------------------ stats

  const STATS_SCHEMA = 'aquaguard.prompt-optimizer.stats';
  const STATS_VERSION = 1;
  const MAX_DAYS = 400;

  function emptyTotals() {
    return {
      optimizationRuns: 0, // background analyses after typing pauses / manual clicks
      runsWithSuggestion: 0,
      runsUnchanged: 0, // no safe optimization found
      latencyMsTotal: 0,
      promptsCompleted: 0, // prompts that were sent or cleared after analysis
      promptsOptimized: 0, // completed with an applied optimization
      promptsLeftUnchanged: 0, // completed with no safe optimization available
      promptsDeclined: 0, // completed with a suggestion the user did not apply
      applyActions: 0,
      autoApplied: 0,
      undoActions: 0,
      originalTokensApplied: 0,
      optimizedTokensApplied: 0,
      tokensSaved: 0, // estimated, at the moment Apply was clicked
      tokensSavedUndone: 0,
      reductionPctSum: 0,
    };
  }

  function emptyStats() {
    return {
      schema: STATS_SCHEMA,
      schemaVersion: STATS_VERSION,
      firstRecordedOn: null,
      totals: emptyTotals(),
      daily: {}, // "YYYY-MM-DD" -> subset of totals
      transformations: {}, // ruleId -> count (applied optimizations only)
    };
  }

  function sanitizeStats(raw) {
    const s = emptyStats();
    if (!raw || typeof raw !== 'object' || raw.schema !== STATS_SCHEMA) return s;
    for (const k of Object.keys(s.totals)) {
      const v = Number(raw.totals && raw.totals[k]);
      s.totals[k] = Number.isFinite(v) && v >= 0 ? v : 0;
    }
    if (raw.daily && typeof raw.daily === 'object') {
      for (const [day, v] of Object.entries(raw.daily)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && v && typeof v === 'object') s.daily[day] = { ...emptyDay(), ...pickNumbers(v) };
      }
    }
    if (raw.transformations && typeof raw.transformations === 'object') {
      for (const [k, v] of Object.entries(raw.transformations)) {
        if (/^[a-z0-9-]{1,40}$/.test(k) && Number.isFinite(Number(v))) s.transformations[k] = Number(v);
      }
    }
    s.firstRecordedOn = typeof raw.firstRecordedOn === 'string' ? raw.firstRecordedOn.slice(0, 10) : null;
    return s;
  }

  function emptyDay() {
    return { optimizationRuns: 0, runsUnchanged: 0, promptsOptimized: 0, promptsLeftUnchanged: 0, promptsDeclined: 0, tokensSaved: 0, tokensSavedUndone: 0 };
  }

  function pickNumbers(o) {
    const out = {};
    for (const k of Object.keys(emptyDay())) {
      const v = Number(o[k]);
      out[k] = Number.isFinite(v) && v >= 0 ? v : 0;
    }
    return out;
  }

  function localDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const num = (x) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : 0);

  /**
   * Pure reducer: returns a new stats object with the event applied.
   * Events carry numbers and rule ids only, never text.
   *
   *   { type: 'run', changed, latencyMs }
   *   { type: 'applied', originalTokens, optimizedTokens, reductionPct, ruleIds, auto }
   *   { type: 'undone', tokensSaved }
   *   { type: 'completed', outcome: 'optimized' | 'unchanged' | 'declined' }
   */
  function recordEvent(stats, event, now = new Date()) {
    const s = sanitizeStats(stats);
    const t = s.totals;
    const day = localDate(now);
    const d = (s.daily[day] = s.daily[day] || emptyDay());
    if (!s.firstRecordedOn) s.firstRecordedOn = day;

    switch (event && event.type) {
      case 'run':
        t.optimizationRuns += 1;
        d.optimizationRuns += 1;
        if (event.changed) t.runsWithSuggestion += 1;
        else {
          t.runsUnchanged += 1;
          d.runsUnchanged += 1;
        }
        t.latencyMsTotal += Math.min(num(event.latencyMs), 10000);
        break;
      case 'applied': {
        const o = num(event.originalTokens);
        const p = Math.min(num(event.optimizedTokens), o);
        t.applyActions += 1;
        if (event.auto) t.autoApplied += 1;
        t.originalTokensApplied += o;
        t.optimizedTokensApplied += p;
        t.tokensSaved += o - p;
        d.tokensSaved += o - p;
        t.reductionPctSum += o > 0 ? (100 * (o - p)) / o : 0;
        for (const id of Array.isArray(event.ruleIds) ? event.ruleIds : []) {
          if (typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)) s.transformations[id] = (s.transformations[id] || 0) + 1;
        }
        break;
      }
      case 'undone':
        t.undoActions += 1;
        t.tokensSavedUndone += num(event.tokensSaved);
        d.tokensSavedUndone += num(event.tokensSaved);
        break;
      case 'completed':
        t.promptsCompleted += 1;
        if (event.outcome === 'optimized') {
          t.promptsOptimized += 1;
          d.promptsOptimized += 1;
        } else if (event.outcome === 'declined') {
          t.promptsDeclined += 1;
          d.promptsDeclined += 1;
        } else {
          t.promptsLeftUnchanged += 1;
          d.promptsLeftUnchanged += 1;
        }
        break;
      default:
        return s;
    }

    const days = Object.keys(s.daily).sort();
    while (days.length > MAX_DAYS) delete s.daily[days.shift()];
    return s;
  }

  /** Derived metrics shown in the UI. */
  function summarizeStats(stats) {
    const t = sanitizeStats(stats).totals;
    const appliedNet = Math.max(0, t.applyActions - t.undoActions);
    return {
      promptsOptimized: t.promptsOptimized,
      promptsLeftUnchanged: t.promptsLeftUnchanged,
      promptsDeclined: t.promptsDeclined,
      netTokensSaved: Math.max(0, t.tokensSaved - t.tokensSavedUndone),
      averageReductionPct: t.applyActions ? t.reductionPctSum / t.applyActions : 0,
      averageLatencyMs: t.optimizationRuns ? t.latencyMsTotal / t.optimizationRuns : 0,
      optimizationRuns: t.optimizationRuns,
      applyActions: t.applyActions,
      undoActions: t.undoActions,
      appliedNet,
    };
  }

  /** Export format documented in docs/EXTENSION_STATS_SCHEMA.md. */
  function exportStats(stats, meta = {}) {
    const s = sanitizeStats(stats);
    return {
      schema: STATS_SCHEMA,
      schemaVersion: STATS_VERSION,
      exportedAt: (meta.now || new Date()).toISOString(),
      extensionVersion: meta.extensionVersion || null,
      tokenizer: meta.tokenizer || { id: 'heuristic-bpe-v1', exact: false },
      firstRecordedOn: s.firstRecordedOn,
      totals: s.totals,
      summary: summarizeStats(s),
      daily: Object.keys(s.daily)
        .sort()
        .map((date) => ({ date, ...s.daily[date] })),
      transformations: s.transformations,
      containsPromptText: false,
    };
  }

  /** Settings after the user answers the one-time question ('auto' | 'manual'). */
  function chooseMode(settings, choice) {
    return sanitizeSettings({
      ...settings,
      modeChosen: true,
      applyMode: choice === 'auto' ? 'autoApply' : 'manual',
    });
  }

  /** True when automatic replacement is allowed on this site. */
  function autoApplyAllowed(settings, siteId) {
    return (
      settings.enabled &&
      settings.modeChosen &&
      settings.applyMode === 'autoApply' &&
      !settings.disabledSites.includes(siteId) &&
      !settings.autoBlockedSites.includes(siteId)
    );
  }

  return {
    chooseMode,
    autoApplyAllowed,
    APPLY_MODES,
    LEVELS,
    DEFAULT_SETTINGS,
    LIMITS,
    sanitizeSettings,
    STATS_SCHEMA,
    STATS_VERSION,
    emptyStats,
    sanitizeStats,
    recordEvent,
    summarizeStats,
    exportStats,
  };
});
