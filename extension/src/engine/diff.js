/*
 * Word-level diff used for the original-vs-optimized preview.
 * Classic longest-common-subsequence over word/space/punctuation tokens.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AquaGuard = root.AquaGuard || {};
    root.AquaGuard.diff = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TOKEN_RE = /\s+|[\p{L}\p{N}_'\u2019-]+|[^\s\p{L}\p{N}_]/gu;
  const MAX_CELLS = 4_000_000; // keeps worst-case memory around 16 MB

  function tokenize(text) {
    return text.match(TOKEN_RE) || [];
  }

  /**
   * Returns [{ type: 'same' | 'removed' | 'added', text }], merged into runs.
   * Returns null when the inputs are too large to diff cheaply.
   */
  function wordDiff(a, b) {
    const x = tokenize(a);
    const y = tokenize(b);
    const n = x.length;
    const m = y.length;
    if ((n + 1) * (m + 1) > MAX_CELLS) return null;

    // lcs[i][j] = LCS length of x[i..] and y[j..], stored row-major.
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          x[i] === y[j]
            ? lcs[(i + 1) * w + j + 1] + 1
            : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }

    const ops = [];
    const push = (type, text) => {
      const last = ops[ops.length - 1];
      if (last && last.type === type) last.text += text;
      else ops.push({ type, text });
    };
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        push('same', x[i]);
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
        push('removed', x[i++]);
      } else {
        push('added', y[j++]);
      }
    }
    while (i < n) push('removed', x[i++]);
    while (j < m) push('added', y[j++]);
    return ops;
  }

  return { wordDiff, tokenize };
});
