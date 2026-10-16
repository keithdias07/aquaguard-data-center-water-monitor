/*
 * Environmental impact estimation (transparent, assumption-driven).
 *
 * Three different things, never mixed up:
 *   1. Observed:     input tokens removed from the prompt (estimated count).
 *   2. Energy:       tokens × (Wh per 1,000 input tokens)          [assumption]
 *   3. Water:        energy × (litres per kWh, water intensity)     [assumption]
 *
 * There is no published, provider-verified "Wh per input token" coefficient
 * for the chat services this extension supports, so the default mode is
 * 'off': impact is reported as unavailable. A user can switch to
 * 'illustrative' mode and enter their own low/high assumptions; results are
 * then labelled as an illustrative scenario, never as measured savings.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AquaGuard = root.AquaGuard || {};
    root.AquaGuard.impact = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_ASSUMPTIONS = Object.freeze({
    mode: 'off', // 'off' | 'illustrative'
    energyWhPer1kTokensLow: null,
    energyWhPer1kTokensHigh: null,
    waterLitersPerKwhLow: null,
    waterLitersPerKwhHigh: null,
  });

  // Context for users choosing assumptions. These are NOT per-token factors.
  const REFERENCES = Object.freeze([
    {
      id: 'lbnl-2016',
      citation:
        'Shehabi et al. (2016), "United States Data Center Energy Usage Report", Lawrence Berkeley National Laboratory.',
      note: 'Reports average on-site data-center water use of roughly 1.8 L per kWh (US, mid-2010s). Site-specific values vary widely by cooling design and climate.',
    },
    {
      id: 'google-2025',
      citation:
        'Google (2025), "Measuring the environmental impact of delivering AI at Google Scale" (technical paper).',
      note: 'Reports a median Gemini Apps text prompt at about 0.24 Wh and 0.26 mL of water. That is per whole prompt (including output generation), not per input token, and is specific to Google\'s fleet.',
    },
  ]);

  const UNAVAILABLE_REASON =
    'No defensible per-token energy coefficient is configured, so only token savings are reported.';

  function isNonNegative(x) {
    return typeof x === 'number' && Number.isFinite(x) && x >= 0;
  }

  function validateAssumptions(a) {
    const s = { ...DEFAULT_ASSUMPTIONS, ...(a || {}) };
    if (s.mode !== 'illustrative') return { ok: false, reason: UNAVAILABLE_REASON, assumptions: s };
    const fields = [
      'energyWhPer1kTokensLow',
      'energyWhPer1kTokensHigh',
      'waterLitersPerKwhLow',
      'waterLitersPerKwhHigh',
    ];
    for (const f of fields) {
      if (!isNonNegative(s[f])) {
        return { ok: false, reason: 'Illustrative mode needs all four low/high assumptions (numbers ≥ 0).', assumptions: s };
      }
    }
    if (s.energyWhPer1kTokensLow > s.energyWhPer1kTokensHigh || s.waterLitersPerKwhLow > s.waterLitersPerKwhHigh) {
      return { ok: false, reason: 'Each low assumption must be ≤ its high assumption.', assumptions: s };
    }
    return { ok: true, reason: null, assumptions: s };
  }

  /**
   * @param {number} tokensSaved observed (estimated) input tokens removed
   * @param {object} assumptions see DEFAULT_ASSUMPTIONS
   */
  function estimateImpact(tokensSaved, assumptions) {
    const tokens = isNonNegative(tokensSaved) ? tokensSaved : 0;
    const v = validateAssumptions(assumptions);
    if (!v.ok) {
      return { available: false, status: 'unavailable', tokensSaved: tokens, reason: v.reason };
    }
    const a = v.assumptions;
    const energyWh = {
      low: (tokens / 1000) * a.energyWhPer1kTokensLow,
      high: (tokens / 1000) * a.energyWhPer1kTokensHigh,
    };
    const waterMl = {
      low: (energyWh.low / 1000) * a.waterLitersPerKwhLow * 1000,
      high: (energyWh.high / 1000) * a.waterLitersPerKwhHigh * 1000,
    };
    return {
      available: true,
      status: 'illustrative',
      tokensSaved: tokens,
      energyWh,
      waterMl,
      assumptions: a,
      disclaimer:
        'Illustrative scenario computed from your own assumptions. Not a measurement of energy or water saved.',
    };
  }

  return { DEFAULT_ASSUMPTIONS, REFERENCES, UNAVAILABLE_REASON, validateAssumptions, estimateImpact };
});
