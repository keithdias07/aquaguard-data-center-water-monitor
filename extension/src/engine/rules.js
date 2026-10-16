/*
 * Reviewed compression rules.
 *
 * Each rule is plain data plus a small function, so it can be read, tested and
 * reasoned about on its own. Rules never do synonym swaps on technical words;
 * they only remove social filler, rewrite request preambles into imperatives,
 * shorten well-known verbose phrases, and drop exact repeats.
 *
 * Rule shape:
 *   id, category, level ('conservative' | 'balanced'), phase, description,
 *   vocabulary  Set of lower-case words the rule may add/remove (or '*')
 *   allowDrop   feature categories the rule may remove (see features.js)
 *
 * phase 'sentence': transform(sentence, ctx) -> new sentence ('' drops it)
 * phase 'text':     pattern (global RegExp) + replace(match, ...groups)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AquaGuard = root.AquaGuard || {};
    root.AquaGuard.rules = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const words = (s) => new Set(s.toLowerCase().split(/\s+/).filter(Boolean));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const APOS = "['\u2019]";

  // Verbs that, after "Can you ...", almost always signal a request rather
  // than a question about the assistant's abilities. Capability-style verbs
  // (browse, access, see, run, use, read, code, do, remember) are excluded.
  const REQUEST_VERBS = (
    'explain write help tell show give provide create generate summarize summarise list describe ' +
    'rewrite rephrase translate review fix debug refactor convert draft outline compare analyze analyse ' +
    'suggest recommend make build implement check find calculate compute design edit improve optimize ' +
    'optimise clarify define answer solve add remove update format proofread correct simplify shorten ' +
    'expand elaborate evaluate assess identify extract classify rank sort plan prepare propose ' +
    'brainstorm teach walk guide go produce compose test validate verify parse estimate interpret break ' +
    'look take write include cover mention discuss highlight'
  ).split(/\s+/);
  const VERBS = REQUEST_VERBS.join('|');

  const IMPERATIVE_STARTERS =
    VERBS + `|do|don${APOS}t|never|make|ensure|note|keep|be|avoid|include|respond|reply|return|output|` +
    'try|consider|assume|ignore|focus|limit|only|remember|stick|act|stop|start|always|use|read|run|' +
    'complete|follow|finish|choose|pick|select|name|state|mention|cite|copy|send|share|save|set|put|get|let|think|wait|hold|reply';

  // ---------------------------------------------------------------- sentence

  const greeting = {
    id: 'greeting',
    category: 'social-filler',
    level: 'conservative',
    phase: 'sentence',
    description: 'Removed an opening greeting',
    vocabulary: words(
      'hi hello hey greetings good morning afternoon evening there team everyone all again ' +
        'chatgpt claude gemini copilot assistant ai friend folks guys'
    ),
    allowDrop: ['constraints'],
    pattern: new RegExp(
      '^(?:hi|hello|hey|greetings|good\\s+(?:morning|afternoon|evening))' +
        '(?:\\s+(?:there|team|everyone|all|again|chatgpt|claude|gemini|copilot|assistant|ai|friend|folks|guys))?' +
        '\\s*[,!.:;\u2014-]+\\s*',
      'i'
    ),
    transform(sentence, ctx) {
      if (!ctx.isFirstSentence) return sentence;
      const m = sentence.match(this.pattern);
      if (!m) return sentence;
      const rest = sentence.slice(m[0].length);
      return rest ? cap(rest) : '';
    },
  };

  const FULL_DROP = [
    new RegExp(`^(?:i\\s+)?hope\\s+(?:you${APOS}re|you\\s+are|this\\s+(?:message\\s+|email\\s+)?finds\\s+you|all\\s+is)\\s+(?:doing\\s+)?(?:well|good|great|fine)(?:\\s+today)?\\s*[.!]*$`, 'i'),
    /^(?:thanks|thank\s+you|thx|ty)(?:\s+(?:so|very)\s+much|\s+a\s+(?:lot|ton)|\s+again)?(?:\s+(?:in\s+advance|for\s+(?:your|the|any)\s+(?:help|time|assistance|support)))*\s*[.!]*\s*[:;]?-?[)D]?\s*[\u{1F642}\u{1F60A}\u{1F64F}]*$/iu,
    /^(?:any|all)\s+(?:help|assistance|advice|input|feedback|suggestions?)(?:\s+on\s+this)?\s+(?:would\s+be|is|will\s+be)\s+(?:greatly\s+|much\s+|really\s+|very\s+much\s+|highly\s+)?appreciated\s*[.!]*$/i,
    /^i\s+(?:really\s+|greatly\s+|truly\s+)?appreciate\s+(?:your|the|any)\s+(?:help|time|assistance)\s*[.!]*$/i,
    new RegExp(`^(?:i\\s+have|here${APOS}s|here\\s+is)\\s+a\\s+(?:quick\\s+|small\\s+|simple\\s+)?question\\s*[.!:]*$`, 'i'),
    /^(?:can|could|would)\s+you\s+(?:please\s+)?help\s+me(?:\s+(?:out|with\s+(?:something|this)))?\s*\?$/i,
    new RegExp(`^i\\s+(?:need|would\\s+like|${APOS}d\\s+like)\\s+(?:your|some)\\s+help(?:\\s+with\\s+(?:something|this))?\\s*[.!]*$`, 'i'),
    /^hope\s+(?:this|that)\s+makes\s+sense\s*[.!]*$/i,
    /^(?:cheers|best|regards|best\s+regards|kind\s+regards|many\s+thanks)\s*[.!,]*$/i,
  ];

  const pleasantry = {
    id: 'pleasantry',
    category: 'social-filler',
    level: 'conservative',
    phase: 'sentence',
    description: 'Removed a pleasantry sentence (thanks, hope you are well, sign-off)',
    vocabulary: words(
      "i hope you you're are this message email finds all is doing well good great fine today thanks thank " +
        'thx ty so very much a lot ton again in advance for your the any help time assistance support ' +
        'advice input feedback suggestion suggestions on would be will greatly much really highly ' +
        "appreciated appreciate truly have here's here quick small simple question can could please me " +
        "out with something need like i'd some that makes sense cheers best regards kind many d"
    ),
    allowDrop: ['constraints'],
    transform(sentence) {
      const s = sentence.trim();
      return FULL_DROP.some((re) => re.test(s)) ? '' : sentence;
    },
  };

  const CAN_YOU_RE = new RegExp(
    `^((?:please[,\\s]+)?(?:could|can|would|will)\\s+you(?:\\s+(?:please|kindly|possibly|maybe|perhaps|also|just))*)\\s+(${VERBS})\\b(.*)$`,
    'is'
  );

  function endQuestionAsStatement(text) {
    return text.replace(/\?(\s*)$/, '.$1');
  }

  function wordCount(text) {
    return (text.match(/[\p{L}\p{N}\uE000]+/gu) || []).length;
  }

  const canYou = {
    id: 'request-preamble',
    category: 'politeness-preamble',
    level: 'conservative',
    phase: 'sentence',
    description: 'Rewrote "Could you please ..." as a direct instruction',
    vocabulary: words('could can would will you please kindly possibly maybe perhaps also just'),
    prefixAware: true,
    transform(sentence) {
      const m = sentence.match(CAN_YOU_RE);
      if (!m) return sentence;
      const [, preamble, verb, rest] = m;
      // Without "please", require an object of 2+ words so short capability
      // questions ("Can you translate Japanese?") are left alone.
      if (!/please|kindly/i.test(preamble) && wordCount(rest) < 2) return sentence;
      return endQuestionAsStatement(cap(verb) + rest);
    },
  };

  const WANT_RE = new RegExp(
    `^(?:i(?:${APOS}d|\\s+would)\\s+(?:really\\s+)?like\\s+you\\s+to|i\\s+(?:want|need)\\s+you\\s+to|` +
      `i\\s+(?:was|am|${APOS}m)\\s+(?:wondering|hoping)\\s+(?:if|whether)\\s+you\\s+(?:could|can|would)|` +
      `i${APOS}m\\s+(?:wondering|hoping)\\s+(?:if|whether)\\s+you\\s+(?:could|can|would)|` +
      `is\\s+it\\s+possible\\s+(?:for\\s+you\\s+)?to|would\\s+it\\s+be\\s+possible\\s+(?:for\\s+you\\s+)?to|` +
      `it\\s+would\\s+be\\s+(?:great|helpful|nice|useful|awesome|ideal)\\s+if\\s+you\\s+(?:could|can|would)|` +
      `i(?:${APOS}d|\\s+would)\\s+(?:really\\s+|greatly\\s+)?appreciate\\s+it\\s+if\\s+you\\s+(?:could|can|would)|` +
      `what\\s+i\\s+(?:want|need)\\s+you\\s+to\\s+do\\s+is(?:\\s+to)?|your\\s+task\\s+is\\s+to)` +
      `\\s+(?:please\\s+)?(${VERBS})\\b(.*)$`,
    'is'
  );

  const wantYou = {
    id: 'want-preamble',
    category: 'politeness-preamble',
    level: 'conservative',
    phase: 'sentence',
    description: 'Rewrote "I would like you to ..." as a direct instruction',
    vocabulary: words(
      "i i'd i'm d m would really like you to want need was am wondering hoping if whether could can " +
        'is it possible for be please great helpful nice useful awesome ideal appreciate greatly what do your task'
    ),
    prefixAware: true,
    transform(sentence) {
      const m = sentence.match(WANT_RE);
      if (!m) return sentence;
      return endQuestionAsStatement(cap(m[1]) + m[2]);
    },
  };

  const PLEASE_RE = new RegExp(`^please[,]?\\s+(?=(?:${IMPERATIVE_STARTERS})\\b)`, 'i');

  const pleasePrefix = {
    id: 'please-prefix',
    category: 'politeness-preamble',
    level: 'conservative',
    phase: 'sentence',
    description: 'Removed a leading "please" from an instruction',
    vocabulary: words('please'),
    prefixAware: true,
    transform(sentence) {
      if (!PLEASE_RE.test(sentence)) return sentence;
      return cap(sentence.replace(PLEASE_RE, ''));
    },
  };

  const PLEASE_SUFFIX_RE = /,?\s+please(?=\s*[?.!]*\s*$)/i;

  const pleaseSuffix = {
    id: 'please-suffix',
    category: 'politeness-preamble',
    level: 'conservative',
    phase: 'sentence',
    description: 'Removed a trailing "please"',
    vocabulary: words('please'),
    transform(sentence) {
      return sentence.replace(PLEASE_SUFFIX_RE, '');
    },
  };

  const HELP_ME_RE = new RegExp(`^help\\s+me\\s+(?:to\\s+)?(${VERBS})\\b`, 'i');

  const helpMe = {
    id: 'help-me',
    category: 'politeness-preamble',
    level: 'balanced',
    phase: 'sentence',
    description: 'Shortened "Help me write ..." to "Write ..."',
    vocabulary: words('help me to'),
    prefixAware: true,
    transform(sentence) {
      const m = sentence.match(HELP_ME_RE);
      if (!m) return sentence;
      return cap(m[1]) + sentence.slice(m[0].length);
    },
  };

  const HEDGE_RE = /^(?:(?:so|well|ok|okay|alright|basically|honestly|actually|anyway|anyways)\s*,\s*)+(?=\S)/i;

  const hedgeIntro = {
    id: 'hedge-intro',
    category: 'filler-word',
    level: 'balanced',
    phase: 'sentence',
    description: 'Removed a conversational opener ("So,", "Basically,")',
    vocabulary: words('so well ok okay alright basically honestly actually anyway anyways'),
    transform(sentence) {
      if (!HEDGE_RE.test(sentence)) return sentence;
      return cap(sentence.replace(HEDGE_RE, ''));
    },
  };

  // Additive transitions carry no instruction. Order words ("After that",
  // "Then", "Finally", "First") are deliberately NOT removed: they can define
  // the order of the requested answer.
  const CONNECTIVE_RE = new RegExp(
    '^(?:also|additionally|furthermore|moreover|in\\s+addition|besides|on\\s+top\\s+of\\s+that|plus)' +
      `(?:\\s*,\\s*|\\s+(?=(?:please|can|could|would|will|i|make|remember|note|keep|do|don${APOS}t|never|ensure|include|add|avoid)\\b))`,
    'i'
  );

  const connective = {
    id: 'transition',
    category: 'transition',
    level: 'conservative',
    phase: 'sentence',
    description: 'Removed an additive transition ("Also,", "Additionally,")',
    vocabulary: words('also additionally furthermore moreover in addition besides on top of that plus'),
    transform(sentence) {
      if (!CONNECTIVE_RE.test(sentence)) return sentence;
      return cap(sentence.replace(CONNECTIVE_RE, ''));
    },
  };

  const NOTE_PREFIX_RE = new RegExp(
    '^(?:please\\s+)?(?:keep\\s+in\\s+mind|bear\\s+in\\s+mind|remember|note|be\\s+aware|be\\s+advised)\\s+that\\s+(?=\\S)',
    'i'
  );

  const notePrefix = {
    id: 'note-prefix',
    category: 'redundant-intro',
    level: 'conservative',
    phase: 'sentence',
    description: 'Removed "Keep in mind that" / "Note that" before a requirement',
    vocabulary: words('please keep-in-mind bear-in-mind remember note be aware advised that'),
    transform(sentence) {
      if (!NOTE_PREFIX_RE.test(sentence)) return sentence;
      return cap(sentence.replace(NOTE_PREFIX_RE, ''));
    },
  };

  const AS_MENTIONED_RE = new RegExp(
    `^(?:as\\s+i\\s+(?:said|mentioned|noted)|like\\s+i\\s+said|as\\s+(?:mentioned|noted|stated))(?:\\s+(?:before|earlier|above|previously))?\\s*,\\s*(?=\\S)`,
    'i'
  );

  const asMentioned = {
    id: 'as-mentioned',
    category: 'redundant-intro',
    level: 'conservative',
    phase: 'sentence',
    description: 'Removed "As I mentioned," before a sentence',
    vocabulary: words('as i said mentioned noted like stated before earlier above previously'),
    transform(sentence) {
      if (!AS_MENTIONED_RE.test(sentence)) return sentence;
      return cap(sentence.replace(AS_MENTIONED_RE, ''));
    },
  };

  // "I would really like it if X" -> "Ideally, X" keeps it a preference
  // (it does not turn a wish into a hard requirement).
  const LIKE_IT_IF_RE = new RegExp(
    `^i(?:${APOS}d|\\s+would)\\s+(?:really\\s+|much\\s+)?(?:like|prefer|love)\\s+it\\s+if\\s+(?=\\S)`,
    'i'
  );

  const likeItIf = {
    id: 'preference-preamble',
    category: 'politeness-preamble',
    level: 'conservative',
    phase: 'sentence',
    description: 'Shortened "I would really like it if ..." to "Ideally, ..."',
    vocabulary: words("i i'd d would really much like prefer love it if ideally"),
    prefixAware: true,
    transform(sentence) {
      if (!LIKE_IT_IF_RE.test(sentence)) return sentence;
      return 'Ideally, ' + sentence.replace(LIKE_IT_IF_RE, '');
    },
  };

  // "I would like to know how X" -> "Tell me how X"; "... to understand" -> "Explain".
  const KNOW_RE = new RegExp(
    `^i(?:${APOS}d\\s+like|\\s+would\\s+like|\\s+want|\\s+need)\\s+to\\s+(know|understand)\\s+(?=(?:what|how|why|when|where|which|who|whether|if)\\b)`,
    'i'
  );

  const wantToKnow = {
    id: 'know-preamble',
    category: 'politeness-preamble',
    level: 'conservative',
    phase: 'sentence',
    description: 'Rewrote "I would like to know how ..." as "Tell me how ..."',
    vocabulary: words("i i'd d would like want need to know understand tell me explain"),
    prefixAware: true,
    transform(sentence) {
      const m = sentence.match(KNOW_RE);
      if (!m) return sentence;
      const lead = m[1].toLowerCase() === 'know' ? 'Tell me ' : 'Explain ';
      return endQuestionAsStatement(lead + sentence.slice(m[0].length));
    },
  };

  // -------------------------------------------------------------------- text

  // [verbose phrase, concise replacement, level, extra options]
  const PHRASES = [
    ['in order to', 'to'],
    ['so as to', 'to'],
    ['due to the fact that', 'because'],
    ['owing to the fact that', 'because'],
    ['in light of the fact that', 'because'],
    ['on account of the fact that', 'because'],
    ['despite the fact that', 'although'],
    ['in spite of the fact that', 'although'],
    ['for the purpose of', 'for'],
    ['in the event that', 'if'],
    ['at this point in time', 'now'],
    ['at the present time', 'now'],
    ['at this moment in time', 'now'],
    ['in the near future', 'soon'],
    ['a large number of', 'many'],
    ['a great number of', 'many'],
    ['a significant number of', 'many'],
    ['the vast majority of', 'most'],
    ['the majority of', 'most'],
    ['has the ability to', 'can'],
    ['have the ability to', 'can'],
    ['is able to', 'can'],
    ['are able to', 'can'],
    ['prior to', 'before'],
    ['subsequent to', 'after'],
    ['in close proximity to', 'near'],
    ['on a daily basis', 'daily'],
    ['on a weekly basis', 'weekly'],
    ['on a monthly basis', 'monthly'],
    ['on a regular basis', 'regularly'],
    ['first and foremost', 'first'],
    ['make use of', 'use'],
    ['makes use of', 'uses'],
    ['take into consideration', 'consider'],
    ['give consideration to', 'consider'],
    ['come to a conclusion', 'conclude'],
    ['make a decision', 'decide'],
    ['until such time as', 'until'],
    ['it is important to note that', 'important:'],
    ['it should be noted that', 'note that'],
    ['it is worth noting that', 'note that'],
    ['whether or not', 'whether', 'conservative', { allowDrop: ['negations'] }],
    ['provide an explanation of', 'explain'],
    ['give an explanation of', 'explain'],
    ['provide a summary of', 'summarize'],
    ['give a summary of', 'summarize'],
    ['give me a summary of', 'summarize'],
    ['provide a description of', 'describe'],
    ['perform an analysis of', 'analyze'],
    ['conduct an analysis of', 'analyze'],
    ['make a comparison between', 'compare'],
    ['in a timely manner', 'promptly'],
    ['utilize', 'use'],
    ['utilizes', 'uses'],
    ['utilizing', 'using'],
    ['utilized', 'used'],
    ['in the process of', '', 'conservative', { lookahead: '\\s+\\w+ing\\b' }],
    ['as a matter of fact', 'in fact', 'balanced'],
    ['very unique', 'unique', 'balanced'],
    ['simple and easy-to-understand', 'simple'],
    ['simple and easy to understand', 'simple'],
    ['easy-to-understand and simple', 'simple'],
    ['simple and easy', 'simple'],
    ['clear and easy-to-understand', 'clear'],
    ['explain to me', 'explain'],
    ['describe to me', 'describe'],
    ['provide me with', 'provide'],
    ['present me with', 'present'],
    ['make sure that', 'make sure'],
    ['ensure that', 'ensure'],
    ['give me a list of', 'list'],
    ['provide a list of', 'list'],
    ['make a list of', 'list'],
    ['with regard to', 'about'],
    ['in regard to', 'about'],
    ['in regards to', 'about'],
    ['in a way that is easy to understand', 'in simple terms'],
    ['in a way that is easy to follow', 'in simple terms'],
    ['in a simple way', 'simply'],
    ['a little bit', 'a bit'],
  ];

  function phraseRule([from, to, level = 'conservative', opts = {}]) {
    const body = from.split(' ').join('\\s+');
    const tail = to === '' ? '\\s*' : '';
    const look = opts.lookahead ? `(?=${opts.lookahead.replace(/^\\s\+/, '')})` : '';
    return {
      id: 'verbose-phrase',
      category: 'verbose-phrase',
      level,
      phase: 'text',
      description: 'Shortened verbose phrases ("in order to" \u2192 "to")',
      vocabulary: words(`${from} ${to}`),
      allowDrop: opts.allowDrop || [],
      pattern: new RegExp(`\\b${body}\\b${tail}${look}`, 'gi'),
      replace(match) {
        if (to === '') return '';
        return /^[A-Z]/.test(match) ? cap(to) : to;
      },
    };
  }

  const kindly = {
    id: 'kindly',
    category: 'politeness-preamble',
    level: 'conservative',
    phase: 'text',
    description: 'Removed "kindly" before an instruction',
    vocabulary: words('kindly'),
    pattern: new RegExp(`(?<=\\w\\s+|^)kindly\\s+(?=(?:${VERBS})\\b)`, 'gim'),
    replace() {
      return '';
    },
  };

  const basically = {
    id: 'filler-word',
    category: 'filler-word',
    level: 'balanced',
    phase: 'text',
    description: 'Removed the filler word "basically"',
    vocabulary: words('basically'),
    pattern: /(?<=\w,?\s)basically,?\s+/gi,
    replace() {
      return '';
    },
  };

  const doubledWord = {
    id: 'doubled-word',
    category: 'typo',
    level: 'conservative',
    phase: 'text',
    description: 'Removed an accidentally doubled word ("the the")',
    vocabulary: words('the a an to of for with and or'),
    pattern: /\b(the|a|an|to|of|for|with|and|or)\s+\1\b/gi,
    replace(match, word) {
      return word;
    },
  };

  // "what machine learning actually is" -> "what machine learning is";
  // "I really want" -> "I want". Only before these verbs, where the word adds
  // emphasis but no information.
  const intensifier = {
    id: 'intensifier',
    category: 'filler-word',
    level: 'conservative',
    phase: 'text',
    description: 'Removed an empty intensifier ("actually is", "really want")',
    vocabulary: words('actually really'),
    pattern: /\b(?:actually|really)\s+(?=(?:is|are|was|were|like|want|need|appreciate|mean|means|works|work)\b)/gi,
    replace() {
      return '';
    },
  };

  // ", and please make sure ..." -> ", and make sure ..." (mid-sentence
  // politeness before an instruction verb; the verb and everything after stay).
  const pleaseMid = {
    id: 'please-mid',
    category: 'politeness-preamble',
    level: 'conservative',
    phase: 'text',
    description: 'Removed "please" before an instruction in the middle of a sentence',
    vocabulary: words('please'),
    pattern: new RegExp(`(?<=(?:,|\\band|\\bso|\\bthen|\\bbut)\\s+)please\\s+(?=(?:${IMPERATIVE_STARTERS})\\b)`, 'gi'),
    replace() {
      return '';
    },
  };

  // "Summarize this for me." -> "Summarize this."
  const forMe = {
    id: 'for-me',
    category: 'politeness-preamble',
    level: 'conservative',
    phase: 'text',
    description: 'Removed a trailing "for me"',
    vocabulary: words('for me'),
    pattern: /\s+for\s+me(?=\s*[.?!;:]|\s*$)/gim,
    replace() {
      return '';
    },
  };

  const SENTENCE_RULES = [
    greeting,
    hedgeIntro,
    connective,
    asMentioned,
    notePrefix,
    pleasantry,
    canYou,
    wantYou,
    wantToKnow,
    likeItIf,
    pleasePrefix,
    pleaseSuffix,
    helpMe,
  ];
  const TEXT_RULES = [...PHRASES.map(phraseRule), kindly, basically, doubledWord, intensifier, forMe, pleaseMid];

  // Discourse markers ignored when deciding whether two sentences repeat.
  const REPEAT_MARKERS = new RegExp(
    '^(?:again|also|plus|and|remember(?:\\s+that|\\s+to)?|as\\s+i\\s+(?:said|mentioned)(?:\\s+(?:before|earlier|above))?|' +
      'as\\s+mentioned(?:\\s+(?:before|earlier|above))?|once\\s+(?:again|more)|to\\s+reiterate|(?:just\\s+)?to\\s+be\\s+clear|please)' +
      '\\s*[,:]?\\s+',
    'i'
  );

  const duplicate = {
    id: 'duplicate-sentence',
    category: 'repetition',
    level: 'conservative',
    phase: 'dedupe',
    description: 'Removed a repeated instruction that already appears earlier',
    vocabulary: '*',
    allowDrop: ['numbers', 'negations', 'constraints', 'protected'],
  };

  function repeatKey(sentence) {
    let s = sentence.toLowerCase().replace(/[\u2018\u2019]/g, "'").trim();
    let prev;
    do {
      prev = s;
      s = s.replace(REPEAT_MARKERS, '');
    } while (s !== prev);
    s = s.replace(/\bplease\b/g, ' ');
    s = s.replace(/[^\p{L}\p{N}'\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    // "Do not X", "Don't X", "Remember to not X", "Remember not to X" repeat each other.
    s = s.replace(/^(?:do not|don't|to not|not to) /, 'not ');
    return s;
  }

  // Word-level normalisation for repeat detection. Deliberately tiny: only
  // pairs that mean the same thing inside a prompt instruction.
  const REPEAT_SYNONYMS = { mathematical: 'math', maths: 'math', use: 'include', add: 'include', uses: 'includes', using: 'including' };
  const REPEAT_DROP = new Set(['any', 'the', 'a', 'an']);

  /**
   * Keys for deciding whether a later sentence repeats an earlier one.
   *   full: the whole sentence, normalised
   *   main: the sentence without a trailing "because/since ..." rationale
   * A later sentence is a repeat when its `full` key equals an earlier
   * sentence's `full` or `main` key (exact equality, never a subset, so a
   * broader or narrower instruction is never treated as a duplicate).
   */
  function repeatKeys(sentence) {
    const words = repeatKey(sentence)
      .split(' ')
      .filter((w) => w && !REPEAT_DROP.has(w))
      .map((w) => REPEAT_SYNONYMS[w] || w);
    const full = words.join(' ');
    const cut = words.findIndex((w) => w === 'because' || w === 'since');
    const main = cut > 0 ? words.slice(0, cut).join(' ') : full;
    return { full, main, length: words.length };
  }

  function forLevel(list, level) {
    return list.filter((r) => level === 'balanced' || r.level === 'conservative');
  }

  return {
    REQUEST_VERBS,
    SENTENCE_RULES,
    TEXT_RULES,
    duplicate,
    repeatKey,
    repeatKeys,
    forLevel,
    cap,
  };
});
