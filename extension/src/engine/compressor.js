/*
 * AquaGuard prompt compressor.
 *
 * Pipeline for the built-in deterministic compressor ("rules-v1"):
 *
 *   1. protect   mask code blocks, inline code, URLs, quotes, paths, tables
 *   2. normalize collapse redundant whitespace
 *   3. sentence  per-sentence rules (greetings, pleasantries, preambles)
 *   4. dedupe    drop exact repeats of an earlier instruction
 *   5. text      phrase-level rules ("in order to" -> "to")
 *   6. restore   unmask protected spans
 *   7. validate  global feature check; any mismatch -> return the original
 *   8. measure   token estimates, reduction %, latency
 *
 * Compressor interface (for future semantic / LLM compressors):
 *
 *   {
 *     id, label, local: boolean,
 *     compress(text, options) -> { text, transformations, validation: { ok, reason } }
 *                                (may return a Promise; use optimizeAsync then)
 *   }
 *
 * A compressor MUST validate its own output. `validateGeneric` is provided for
 * compressors that cannot track per-rule feature changes.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const deps = isNode
    ? {
        tokenizer: require('./tokenizer.js'),
        features: require('./features.js'),
        rules: require('./rules.js'),
      }
    : root.AquaGuard;
  const api = factory(deps.tokenizer, deps.features, deps.rules);
  if (isNode) {
    module.exports = api;
  } else {
    root.AquaGuard.compressor = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (tokenizer, features, rules) {
  'use strict';

  const VERSION = '1.0.0';
  const PH_OPEN = '\uE000';
  const PH_CLOSE = '\uE001';
  const PH_BASE = 0xe100;
  const PH_MAX = 0xf8ff - PH_BASE;
  const PH_RE = /\uE000([\uE100-\uF8FF])\uE001/g;
  const PRIVATE_USE_RE = /[\uE000-\uF8FF]/;

  const now = () =>
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

  // ------------------------------------------------------------- protection

  const CODE_LINE_RE = new RegExp(
    '^\\s*(?:[{}\\[\\]<]|//|/\\*|\\*/|#include|#!|def\\s|class\\s+\\w+[:(]|import\\s|from\\s+\\S+\\s+import|' +
      'function\\s|const\\s|let\\s|var\\s|return\\b|if\\s*\\(|for\\s*\\(|while\\s*\\(|\\$\\s|>>>|' +
      '(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\\s)'
  );

  function looksLikeCodeLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\|.*\|$/.test(trimmed) || /^\|?\s*:?-{3,}:?\s*\|/.test(trimmed)) return true; // Markdown table row
    if (/^( {4,}|\t)/.test(line) && !/^\s*(?:[-*+\u2022]|\d+[.)])\s/.test(line)) return true;
    if (CODE_LINE_RE.test(line)) return true;
    if (/[;{}]\s*$/.test(trimmed) && !/[.!?]["')]?\s*[;{}]\s*$/.test(trimmed)) return true;
    const symbols = (trimmed.match(/[^\p{L}\p{N}\s.,!?'"()\-:]/gu) || []).length;
    return trimmed.length >= 8 && symbols / trimmed.length > 0.3;
  }

  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/g;

  const INLINE_PATTERNS = [
    /`[^`\n]+`/g, // inline code
    /\|[^|\n]*(?:\|[^|\n]*)+\|/g, // inline table header like | a | b |
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, // email addresses
    /"[^"\n]{1,400}"|\u201C[^\u201D\n]{1,400}\u201D/g, // quoted text stays verbatim
    /\{\{[^{}\n]{1,80}\}\}|\$\{[^{}\n]{1,80}\}|\{[^{}\n]{1,80}\}/g, // template placeholders
    /<\/?[A-Za-z][^<>\n]{0,80}>/g, // tags
    /(?:[A-Za-z]:)?(?:[\w.-]+[\\/])+[\w.-]+/g, // file paths
    /\b[\w-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx|json|md|csv|txt|html|css|scss|ya?ml|toml|sh|ps1|java|kt|c|cc|cpp|h|hpp|go|rs|rb|php|sql|ipynb|xml|env|lock|cfg|ini)\b/g,
    /\b\w+(?:_\w+)+\b/g, // snake_case identifiers
    /\b[A-Za-z_]\w*\(\)/g, // calls like useState()
  ];

  // Words that signal "the text after this colon is material to work on",
  // e.g. "Proofread: ...", "Review the following paragraph: ...". That
  // material must reach the model verbatim, so everything after the colon is
  // protected.
  const PAYLOAD_CUE_RE = new RegExp(
    '\\b(?:proofread|translate|rewrite|rephrase|paraphrase|edit|correct|polish|summari[sz]e|shorten|' +
      'review|critique|grade|classify|analy[sz]e|respond\\s+to|reply\\s+to|text|paragraph|e-?mail|essay|' +
      'message|sentence|passage|article|letter|post|document|draft|input|content|transcript|quote|' +
      'excerpt|story|poem|lyrics|tweet|abstract|following|below)\\b',
    'i'
  );

  function protectPayload(text, mask) {
    const re = /:/g;
    let m;
    while ((m = re.exec(text))) {
      const i = m.index;
      if (/\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')) continue; // 10:30
      const rest = text.slice(i + 1);
      if (!rest.trim()) return text;
      const head = text.slice(0, i);
      const sentenceStart = Math.max(head.lastIndexOf('\n'), head.search(/[.!?]\s+[^.!?]*$/));
      const sentence = head.slice(sentenceStart + 1);
      if (PAYLOAD_CUE_RE.test(sentence)) {
        const lead = rest.match(/^\s*/)[0];
        return text.slice(0, i + 1) + lead + mask(rest.slice(lead.length));
      }
    }
    return text;
  }

  function protect(text) {
    const spans = [];
    const mask = (s) => {
      if (spans.length > PH_MAX) throw new Error('too-many-protected-spans');
      // Store fully restored text so nested placeholders never leak out.
      spans.push(restore(s, spans));
      return PH_OPEN + String.fromCharCode(PH_BASE + spans.length - 1) + PH_CLOSE;
    };

    let out = text.replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, mask);
    out = out.replace(URL_RE, mask);
    out = protectPayload(out, mask);
    out = out
      .split('\n')
      .map((line) => (looksLikeCodeLine(line) ? mask(line) : line))
      .join('\n');
    for (const re of INLINE_PATTERNS) out = out.replace(re, mask);
    return { masked: out, spans };
  }

  function restore(masked, spans) {
    return masked.replace(PH_RE, (_, ch) => spans[ch.charCodeAt(0) - PH_BASE]);
  }

  // ---------------------------------------------------------- segmentation

  const ABBREVIATIONS = new Set(
    'e.g i.e etc vs mr mrs ms dr prof sr jr st no fig approx inc ltd co cf al'.split(' ')
  );
  const LINE_PREFIX_RE = /^(\s*(?:(?:[-*+\u2022>]|\d+[.)]|#{1,6})\s+)?)/;

  function splitSentences(body) {
    const out = [];
    let start = 0;
    const re = /[.!?]+["'\u201D\u2019)\]]*(\s+)/g;
    let m;
    while ((m = re.exec(body))) {
      const end = m.index + m[0].length;
      const next = body[end];
      if (next === undefined) break;
      if (!/[\p{Lu}\p{N}"'\u201C\u2018(\[\uE000]/u.test(next)) continue;
      if (body[m.index] === '.') {
        const lastWord = (body.slice(start, m.index).match(/([\p{L}.]+)$/u) || ['', ''])[1];
        if (ABBREVIATIONS.has(lastWord.toLowerCase().replace(/\.$/, ''))) continue;
      }
      out.push({ text: body.slice(start, end - m[1].length), trail: m[1] });
      start = end;
    }
    out.push({ text: body.slice(start), trail: '' });
    return out;
  }

  function parseDocument(masked) {
    return masked.split('\n').map((line) => {
      const onlyProtected = line.replace(PH_RE, '').trim() === '';
      if (!line.trim() || onlyProtected) return { raw: line, prefix: '', sentences: null };
      const prefix = line.match(LINE_PREFIX_RE)[1];
      return { raw: line, prefix, sentences: splitSentences(line.slice(prefix.length)) };
    });
  }

  function renderDocument(lines) {
    const out = [];
    for (const line of lines) {
      if (!line.sentences) {
        out.push(line.raw);
        continue;
      }
      const kept = line.sentences.filter((s) => s.text !== '');
      if (kept.length === 0) continue; // every sentence on this line was dropped
      const body = kept.map((s, i) => s.text + (i < kept.length - 1 ? s.trail || ' ' : '')).join('');
      out.push(line.prefix + body);
    }
    return out.join('\n');
  }

  // ------------------------------------------------------------- whitespace

  function tidyWhitespace(text) {
    return text
      .replace(/[ \t]+$/gm, '')
      .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s*\n/, '')
      .trimEnd();
  }

  // ------------------------------------------------------------ the engine

  function createRun(level) {
    return {
      level,
      allowance: features.emptyFeatures(),
      applied: [], // { rule, before, after }
      skipped: [], // { ruleId, reason }
    };
  }

  function tryRewrite(run, rule, before, after) {
    if (after === before) return before;
    const check = features.checkRewrite(before, after, rule);
    if (!check.ok) {
      run.skipped.push({ ruleId: rule.id, reason: check.reason });
      return before;
    }
    features.addInto(run.allowance, check.delta);
    run.applied.push({ rule, before, after });
    return after;
  }

  const WHITESPACE_RULE = {
    id: 'whitespace',
    category: 'formatting',
    description: 'Collapsed redundant spaces and blank lines',
    vocabulary: new Set(),
  };

  function compressRules(text, options = {}) {
    const level = options.level === 'balanced' ? 'balanced' : 'conservative';
    const run = createRun(level);

    if (PRIVATE_USE_RE.test(text)) {
      return {
        text,
        transformations: [],
        validation: { ok: false, reason: 'Prompt contains private-use characters; left unchanged.' },
      };
    }

    let protectedDoc;
    try {
      protectedDoc = protect(text);
    } catch (err) {
      return { text, transformations: [], validation: { ok: false, reason: 'Too many protected spans.' } };
    }
    const { masked: maskedOriginal, spans } = protectedDoc;

    let work = tidyWhitespace(maskedOriginal);
    if (work !== maskedOriginal) {
      run.applied.push({ rule: WHITESPACE_RULE, before: '', after: '' });
    }

    // Sentence rules + de-duplication operate on a parsed document.
    const lines = parseDocument(work);
    const sentenceRules = rules.forLevel(rules.SENTENCE_RULES, level);
    let isFirstSentence = true;
    for (const line of lines) {
      if (!line.sentences) continue;
      for (const s of line.sentences) {
        if (!s.text.trim()) continue;
        const ctx = { isFirstSentence };
        isFirstSentence = false;
        for (const rule of sentenceRules) {
          s.text = tryRewrite(run, rule, s.text, rule.transform(s.text, ctx));
          if (s.text === '') break;
        }
      }
    }

    const seen = new Set();
    for (const line of lines) {
      if (!line.sentences) continue;
      for (const s of line.sentences) {
        if (!s.text) continue;
        // Compare with protected spans restored, so two sentences quoting the
        // same word ("passionate") are recognised as the same instruction.
        const key = rules.repeatKey(restore(s.text, spans));
        if (key.split(' ').length < 3) continue;
        if (seen.has(key)) s.text = tryRewrite(run, rules.duplicate, s.text, '');
        else seen.add(key);
      }
    }
    work = renderDocument(lines);

    // Phrase-level rules.
    for (const rule of rules.forLevel(rules.TEXT_RULES, level)) {
      rule.pattern.lastIndex = 0;
      work = work.replace(rule.pattern, (...args) => {
        const match = args[0];
        const groups = args.slice(1, -2).filter((g) => typeof g === 'string');
        return tryRewrite(run, rule, match, rule.replace(match, ...groups));
      });
    }

    const maskedOutput = tidyWhitespace(work);

    // Global check: original − everything rules were allowed to drop == output.
    const expected = features.diff(features.extract(maskedOriginal), run.allowance);
    const mismatch = features.diff(expected, features.extract(maskedOutput));
    if (!features.isEmpty(mismatch)) {
      return {
        text,
        transformations: [],
        validation: { ok: false, reason: `Validation failed (${features.describe(mismatch)}).` },
        skipped: run.skipped,
      };
    }
    const output = restore(maskedOutput, spans);
    if (PRIVATE_USE_RE.test(output)) {
      // A placeholder leaked: never show the user a corrupted prompt.
      return { text, transformations: [], validation: { ok: false, reason: 'Internal placeholder check failed.' } };
    }
    if (!/[\p{L}\p{N}]/u.test(output)) {
      return {
        text,
        transformations: [],
        validation: { ok: false, reason: 'Optimization would remove the entire prompt.' },
      };
    }

    return {
      text: output,
      transformations: summarize(run.applied),
      validation: { ok: true, reason: null },
      skipped: run.skipped,
    };
  }

  function summarize(applied) {
    const byId = new Map();
    for (const { rule, before, after } of applied) {
      let entry = byId.get(rule.id);
      if (!entry) {
        entry = {
          ruleId: rule.id,
          category: rule.category,
          description: rule.description,
          count: 0,
          examples: [],
        };
        byId.set(rule.id, entry);
      }
      entry.count += 1;
      if (entry.examples.length < 2 && (before || after)) {
        entry.examples.push({
          before: restoreForDisplay(before),
          after: restoreForDisplay(after),
        });
      }
    }
    return [...byId.values()];
  }

  // Examples are shown in the page UI only; protected spans are elided.
  function restoreForDisplay(s) {
    const clean = s.replace(PH_RE, '\u2026').trim();
    return clean.length > 120 ? clean.slice(0, 117) + '\u2026' : clean;
  }

  /**
   * Validation helper for compressors that cannot track per-rule changes.
   * Requires numbers, negations, constraints and protected spans to survive.
   */
  function validateGeneric(original, output) {
    const a = features.extract(original);
    const b = features.extract(output);
    for (const c of ['numbers', 'negations', 'constraints']) {
      for (const [term, count] of a[c]) {
        if ((b[c].get(term) || 0) < count) {
          return { ok: false, reason: `Output lost ${c.slice(0, -1)} "${term}".` };
        }
      }
    }
    for (const span of protect(original).spans) {
      if (!output.includes(span)) return { ok: false, reason: 'Output changed protected content.' };
    }
    return { ok: true, reason: null };
  }

  const rulesCompressor = Object.freeze({
    id: 'rules-v1',
    label: 'Deterministic rules (runs locally)',
    local: true,
    compress: compressRules,
  });

  const compressors = new Map([[rulesCompressor.id, rulesCompressor]]);

  function registerCompressor(c) {
    if (!c || !c.id || typeof c.compress !== 'function') {
      throw new TypeError('Compressor must have an id and a compress(text, options) function');
    }
    compressors.set(c.id, c);
  }

  // --------------------------------------------------------------- results

  const DEFAULTS = {
    level: 'conservative',
    compressorId: 'rules-v1',
    tokenizerId: 'heuristic-bpe-v1',
    minTokensSaved: 1,
    maxChars: 50000,
    maxReductionRatio: 0.7, // reject if >70% of a long prompt disappears
  };

  const REASONS = {
    empty: 'Prompt is empty.',
    tooLong: 'Prompt is too long for live optimization.',
    noChange: 'Already concise: no safe optimization found.',
    notShorter: 'The safe rewrite was not shorter, so the original is kept.',
    belowThreshold: 'Savings were too small to be worth changing your text.',
    tooAggressive: 'Rewrite removed too much text; rejected to protect meaning.',
  };

  function baseResult(original, opts, tok) {
    const originalTokens = tok.count(original);
    return {
      original,
      optimized: original,
      changed: false,
      originalTokens,
      optimizedTokens: originalTokens,
      tokensSaved: 0,
      reductionPct: 0,
      latencyMs: 0,
      reason: null,
      transformations: [],
      tokenizer: { id: tok.id, label: tok.label, exact: tok.exact },
      compressor: opts.compressorId,
      level: opts.level,
      engineVersion: VERSION,
    };
  }

  function finish(result, compressed, tok, opts, started) {
    if (!compressed.validation || !compressed.validation.ok) {
      result.reason = (compressed.validation && compressed.validation.reason) || REASONS.noChange;
      result.rejected = true;
    } else if (compressed.text === result.original) {
      result.reason = REASONS.noChange;
    } else {
      const optimizedTokens = tok.count(compressed.text);
      const saved = result.originalTokens - optimizedTokens;
      if (saved <= 0) {
        result.reason = REASONS.notShorter;
      } else if (saved < opts.minTokensSaved) {
        result.reason = REASONS.belowThreshold;
      } else if (result.originalTokens > 30 && saved / result.originalTokens > opts.maxReductionRatio) {
        result.reason = REASONS.tooAggressive;
        result.rejected = true;
      } else {
        result.optimized = compressed.text;
        result.changed = true;
        result.optimizedTokens = optimizedTokens;
        result.tokensSaved = saved;
        result.reductionPct = tokenizer.reductionPercent(result.originalTokens, optimizedTokens);
        result.transformations = compressed.transformations || [];
      }
    }
    result.latencyMs = Math.max(0, now() - started);
    return result;
  }

  function prepare(text, options) {
    const opts = { ...DEFAULTS, ...(options || {}) };
    const original = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
    const tok = tokenizer.get(opts.tokenizerId);
    const result = baseResult(original, opts, tok);
    if (!original.trim()) result.reason = REASONS.empty;
    else if (original.length > opts.maxChars) result.reason = REASONS.tooLong;
    return { opts, original, tok, result, skip: Boolean(result.reason) };
  }

  /** Synchronous optimization (built-in local compressors). */
  function optimize(text, options) {
    const started = now();
    const { opts, original, tok, result, skip } = prepare(text, options);
    if (skip) return result;
    const compressor = compressors.get(opts.compressorId) || rulesCompressor;
    const compressed = compressor.compress(original, opts);
    if (compressed && typeof compressed.then === 'function') {
      throw new Error(`Compressor ${compressor.id} is async; use optimizeAsync().`);
    }
    return finish(result, compressed, tok, opts, started);
  }

  /** Async variant for compressors that return a Promise. */
  async function optimizeAsync(text, options) {
    const started = now();
    const { opts, original, tok, result, skip } = prepare(text, options);
    if (skip) return result;
    const compressor = compressors.get(opts.compressorId) || rulesCompressor;
    const compressed = await compressor.compress(original, opts);
    return finish(result, compressed, tok, opts, started);
  }

  return {
    VERSION,
    DEFAULTS,
    REASONS,
    optimize,
    optimizeAsync,
    registerCompressor,
    validateGeneric,
    // exported for tests
    _internal: { protect, restore, splitSentences, tidyWhitespace, looksLikeCodeLine },
  };
});
