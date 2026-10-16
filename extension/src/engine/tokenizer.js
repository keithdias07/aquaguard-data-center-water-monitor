/*
 * AquaGuard tokenizer abstraction.
 *
 * Every tokenizer exposes the same shape:
 *   { id, label, exact, count(text) -> number }
 *
 * `exact: false` means the count is an ESTIMATE. The UI must say so.
 *
 * The default tokenizer is a heuristic that mimics how modern byte-pair
 * encoders (e.g. OpenAI's o200k_base) split text: words, digit groups of up to
 * three, punctuation runs and whitespace runs. It was calibrated against
 * o200k_base on the evaluation dataset (see extension/eval/). Real provider
 * tokenizers differ from each other (Claude, Gemini and GPT models all use
 * different vocabularies), so no single local count is "the" token count.
 *
 * Why not ship an exact tokenizer? An exact BPE vocabulary is ~2 MB and must
 * be parsed in every tab that runs the content script. That costs memory and
 * startup time on every page load, and it would still only be exact for one
 * provider. The interface below lets an exact tokenizer be registered later.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AquaGuard = root.AquaGuard || {};
    root.AquaGuard.tokenizer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Rough pre-tokenizer modelled on GPT-style regexes.
  const PRETOKEN =
    /'(?:s|t|re|ve|m|ll|d)\b|[ ]?\p{L}+|\p{N}{1,3}|[ ]?[^\s\p{L}\p{N}]+|\s+/gu;
  // Scripts where BPE vocabularies typically spend ~1 token per character.
  const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

  // Calibrated against o200k_base (docs/EVALUATION.md): about 4% mean absolute
  // error on the evaluation prompts and about 9% on source code. Rare or very
  // long words are UNDER-counted (up to ~30%), because large vocabularies hold
  // most common words up to ~10 letters as a single token.
  const CONFIG = {
    shortWordMax: 10, // words up to this many letters are usually one token
    lettersPerExtraToken: 4.5,
    punctPerToken: 3,
    whitespacePerToken: 24,
  };

  function wordTokens(word) {
    if (DENSE_SCRIPT.test(word)) {
      // Count dense-script characters individually, Latin remainder as a word.
      let dense = 0;
      let rest = '';
      for (const ch of word) {
        if (DENSE_SCRIPT.test(ch)) dense += 1;
        else rest += ch;
      }
      return dense + (rest ? wordTokens(rest) : 0);
    }
    // camelCase / PascalCase identifiers split at case humps.
    const humps = word.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\p{L}+/gu) || [word];
    let total = 0;
    for (const part of humps) {
      const n = [...part].length;
      if (n <= CONFIG.shortWordMax) total += 1;
      else total += 1 + Math.ceil((n - CONFIG.shortWordMax) / CONFIG.lettersPerExtraToken);
    }
    // Capitalised or ALL-CAPS words are rarer in vocabularies than lowercase ones.
    if (humps.length === 1 && /^[A-Z]{2,}$/.test(word) && word.length > 3) total += 1;
    return total;
  }

  function estimateTokens(text) {
    if (typeof text !== 'string' || text.length === 0) return 0;
    let count = 0;
    const pieces = text.match(PRETOKEN) || [];
    for (const piece of pieces) {
      const core = piece.replace(/^ /, '');
      if (core.length === 0) {
        count += 1; // a lone space
      } else if (/^\s+$/.test(core)) {
        count += Math.max(1, Math.ceil(core.length / CONFIG.whitespacePerToken));
      } else if (/^\p{L}/u.test(core)) {
        count += wordTokens(core);
      } else if (/^\p{N}/u.test(core)) {
        count += 1; // PRETOKEN already splits digits into groups of <= 3
      } else {
        count += Math.max(1, Math.ceil([...core].length / CONFIG.punctPerToken));
      }
    }
    return count;
  }

  const heuristic = Object.freeze({
    id: 'heuristic-bpe-v1',
    label: 'heuristic, calibrated against o200k_base',
    exact: false,
    count: estimateTokens,
  });

  const registry = new Map([[heuristic.id, heuristic]]);

  function register(tokenizer) {
    if (!tokenizer || typeof tokenizer.count !== 'function' || !tokenizer.id) {
      throw new TypeError('Tokenizer must have an id and a count(text) function');
    }
    registry.set(tokenizer.id, Object.freeze({ exact: false, label: tokenizer.id, ...tokenizer }));
  }

  function get(id) {
    return registry.get(id) || heuristic;
  }

  /** 100 × (original − optimized) / original, with zero-token inputs handled. */
  function reductionPercent(originalTokens, optimizedTokens) {
    if (!Number.isFinite(originalTokens) || originalTokens <= 0) return 0;
    if (!Number.isFinite(optimizedTokens) || optimizedTokens < 0) return 0;
    return (100 * (originalTokens - optimizedTokens)) / originalTokens;
  }

  return { CONFIG, estimateTokens, heuristic, register, get, reductionPercent };
});
