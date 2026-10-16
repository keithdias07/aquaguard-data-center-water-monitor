/*
 * Meaning-preservation features.
 *
 * The compressor never trusts a rewrite blindly. For every change it compares
 * the "features" of the text before and after:
 *
 *   numbers      digits, decimals, dates, percentages, number words
 *   negations    not, never, no, without, don't, unless, except, avoid, ...
 *   constraints  must, only, always, exactly, at least, at most, ensure, ...
 *   protected    placeholders for code, URLs, quotes, paths (see compressor)
 *   content      every other word, lower-cased
 *
 * A rule may only add or remove `content` words that appear in its own
 * reviewed vocabulary, and may only drop numbers/negations/constraints when it
 * explicitly declares that (for example "whether or not" -> "whether").
 * Nothing may ever ADD a number, negation, constraint or placeholder.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AquaGuard = root.AquaGuard || {};
    root.AquaGuard.features = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CATEGORIES = ['numbers', 'negations', 'constraints', 'protected', 'content'];

  const NEGATIONS = new Set(
    ('not no never none nor neither without cannot nothing nobody nowhere except unless ' +
      'avoid avoiding avoids exclude excluding excludes prohibit prohibited forbid forbidden ' +
      'disallow disallowed refuse')
      .split(/\s+/)
  );

  const CONSTRAINTS = new Set(
    ('must only should shall always exactly precisely strictly required require requires ' +
      'requirement requirements mandatory ensure guarantee maximum minimum max min limit limits ' +
      'limited important importantly critical crucial essential warning caution careful carefully ' +
      'safety safe unsafe dangerous all every each any both either same entire whole verbatim exact ' +
      'keep preserve retain unchanged instead')
      .split(/\s+/)
  );

  // Multi-word constraints are matched first and removed from the word stream.
  const CONSTRAINT_PHRASES = [
    'at least', 'at most', 'no more than', 'no fewer than', 'no less than',
    'not more than', 'not less than', 'up to', 'or less', 'or fewer', 'or more',
  ];

  const NUMBER_WORDS = new Set(
    ('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen ' +
      'fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ' +
      'ninety hundred thousand million billion trillion once twice thrice half double triple ' +
      'quarter dozen first second third fourth fifth last single')
      .split(/\s+/)
  );

  const PLACEHOLDER_RE = /\uE000[\uE100-\uF8FF]\uE001/g;
  const NUMBER_RE = /[-+]?\d+(?:[.,:/-]\d+)*(?:%|\u00B0[CF]?)?/g;
  const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu;
  const PHRASE_RE = new RegExp(
    '\\b(' + CONSTRAINT_PHRASES.map((p) => p.replace(/ /g, '\\s+')).join('|') + ')\\b',
    'gi'
  );

  function emptyFeatures() {
    const f = {};
    for (const c of CATEGORIES) f[c] = new Map();
    return f;
  }

  function bump(map, key, by = 1) {
    const next = (map.get(key) || 0) + by;
    if (next === 0) map.delete(key);
    else map.set(key, next);
  }

  function normalizeApostrophes(text) {
    return text.replace(/[\u2018\u2019\u02BC]/g, "'");
  }

  /** Extract feature multisets from (masked) text. */
  function extract(text) {
    const f = emptyFeatures();
    if (!text) return f;
    let rest = normalizeApostrophes(String(text));

    rest = rest.replace(PLACEHOLDER_RE, (m) => {
      bump(f.protected, m);
      return ' ';
    });
    rest = rest.replace(NUMBER_RE, (m) => {
      bump(f.numbers, m.replace(/^\+/, ''));
      return ' ';
    });
    rest = rest.replace(PHRASE_RE, (m) => {
      bump(f.constraints, m.toLowerCase().replace(/\s+/g, ' '));
      return ' ';
    });

    const words = rest.match(WORD_RE) || [];
    for (const raw of words) {
      const w = raw.toLowerCase().replace(/^[-_']+|[-_']+$/g, '');
      if (!w) continue;
      if (NUMBER_WORDS.has(w)) bump(f.numbers, w);
      // "don't", "can't" and "cannot" all count as the negation "not".
      else if (/n't$/.test(w) || w === 'cannot') bump(f.negations, 'not');
      else if (NEGATIONS.has(w)) bump(f.negations, w);
      else if (CONSTRAINTS.has(w)) bump(f.constraints, w);
      else bump(f.content, w);
    }
    return f;
  }

  /** a − b, per category. Positive counts = present in a but not b. */
  function diff(a, b) {
    const out = emptyFeatures();
    for (const c of CATEGORIES) {
      for (const [k, v] of a[c]) bump(out[c], k, v);
      for (const [k, v] of b[c]) bump(out[c], k, -v);
    }
    return out;
  }

  function addInto(target, delta) {
    for (const c of CATEGORIES) {
      for (const [k, v] of delta[c]) bump(target[c], k, v);
    }
    return target;
  }

  function isEmpty(f) {
    return CATEGORIES.every((c) => f[c].size === 0);
  }

  /**
   * Check a single rewrite (before -> after) against a rule's permissions.
   * Returns { ok, delta, reason }.
   */
  function checkRewrite(before, after, rule) {
    const delta = diff(extract(before), extract(after));
    const allowDrop = new Set(rule.allowDrop || []);
    const anyContent = rule.vocabulary === '*';
    const vocab = anyContent ? null : rule.vocabulary || new Set();

    for (const c of CATEGORIES) {
      for (const [term, count] of delta[c]) {
        if (c === 'content') {
          if (count < 0 && anyContent) return { ok: false, delta, reason: `adds word "${term}"` };
          if (!anyContent && !vocab.has(term)) {
            return { ok: false, delta, reason: `${count > 0 ? 'removes' : 'adds'} word "${term}"` };
          }
          continue;
        }
        if (count < 0) return { ok: false, delta, reason: `adds ${c} "${term}"` };
        if (!allowDrop.has(c)) return { ok: false, delta, reason: `removes ${c} "${term}"` };
      }
    }
    return { ok: true, delta, reason: null };
  }

  /** Human-readable list of mismatches (for rejection messages). */
  function describe(f) {
    const parts = [];
    for (const c of CATEGORIES) {
      if (f[c].size) parts.push(`${c}: ${[...f[c].keys()].slice(0, 5).join(', ')}`);
    }
    return parts.join('; ');
  }

  return {
    CATEGORIES,
    NEGATIONS,
    CONSTRAINTS,
    NUMBER_WORDS,
    extract,
    diff,
    addInto,
    isEmpty,
    emptyFeatures,
    checkRewrite,
    describe,
    normalizeApostrophes,
  };
});
