/*
 * AquaGuard content script (runs only on the sites listed in manifest.json).
 *
 * Interaction rules this file enforces:
 *   - It NEVER submits or sends a prompt. It dispatches no Enter key events and
 *     never clicks the site's send button.
 *   - Default is preview-first: suggestions are shown, the text is only
 *     replaced when the user clicks Apply.
 *   - Optimization runs only after typing pauses (debounce), never during IME
 *     composition, and never on text it just wrote itself (no input loops).
 *   - Auto-apply is opt-in, waits for the pause, and is always undoable.
 *   - The original prompt is kept in memory only, for Undo. It is never
 *     stored or transmitted.
 */
(function () {
  'use strict';
  if (window.top !== window) return; // top frame only
  if (globalThis.__aquaguardContentLoaded) return;
  globalThis.__aquaguardContentLoaded = true;

  const AG = globalThis.AquaGuard;
  const adapter = AG.adapters.match(location.hostname);
  if (!adapter) return; // unsupported site: do nothing at all

  const io = AG.fieldIO;
  const MODE_LABELS = {
    manual: 'Preview first · you choose when to apply',
    previewOnly: 'Preview only · text is never modified',
    autoApply: 'Automatic · replaces after you pause · Undo anytime',
  };

  const state = {
    settings: AG.settings.sanitizeSettings({}),
    field: null,
    timer: null,
    composing: false,
    applying: false,
    lastInputAt: 0,
    result: null, // latest optimization result (memory only)
    resultFor: null, // exact text the result was computed for
    lastRunText: null,
    lastAppliedText: null, // what we last wrote (to ignore our own echo)
    undo: null, // { original, optimized, tokensSaved }
    undoConfirm: false,
    undoneOriginal: null, // never auto-apply again to text the user restored
    status: 'idle',
    message: '',
    messageTone: null,
    runs: 0,
    session: null, // { applied, sawSuggestion }
    lastSeenText: '',
    watchTimer: null,
  };

  const ui = AG.overlay.create({
    onApply: () => apply(false),
    onUndo: () => undo(),
    onOptimize: () => runNow(true),
    onLayout: () => layout(),
    onChooseMode: (choice) => chooseMode(choice),
  });

  // One-time answer to "Shorten prompts automatically?". Stored in
  // chrome.storage.local, so every tab picks it up and it is never asked
  // again unless the user resets it.
  function chooseMode(choice) {
    const next = AG.settings.chooseMode(state.settings, choice);
    state.settings = next;
    try {
      chrome.storage.local.set({ settings: next });
    } catch (e) {
      /* extension reloaded */
    }
    if (choice === 'auto' && state.result && state.result.changed && currentText() === state.resultFor) {
      apply(true); // the user just agreed: optimize the current draft right away
    } else {
      render();
    }
  }

  // ------------------------------------------------------------ settings

  function isActive() {
    return state.settings.enabled && !state.settings.disabledSites.includes(adapter.id);
  }

  function loadSettings() {
    try {
      chrome.storage.local.get('settings', (data) => {
        if (chrome.runtime.lastError) return;
        state.settings = AG.settings.sanitizeSettings(data && data.settings);
        refreshActivation();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings) {
          state.settings = AG.settings.sanitizeSettings(changes.settings.newValue);
          refreshActivation();
        }
      });
    } catch (e) {
      // Extension context invalidated (e.g. extension reloaded): stay inert.
    }
  }

  function refreshActivation() {
    if (!isActive()) {
      clearTimeout(state.timer);
      stopWatching();
      state.result = null;
      state.resultFor = null;
      ui.setOpen(false);
      ui.destroy();
      return;
    }
    if (!state.field) state.field = AG.adapters.findField(adapter, document);
    if (state.field) {
      ui.attach();
      render();
      layout();
    }
  }

  // ----------------------------------------------------------- statistics

  function record(event) {
    if (!state.settings.collectStats) return;
    try {
      chrome.runtime.sendMessage({ type: 'AG_STATS_EVENT', event }, () => void chrome.runtime.lastError);
    } catch (e) {
      /* extension reloaded */
    }
  }

  function startSessionIfNeeded(text) {
    if (!state.session && text.trim()) state.session = { applied: false, sawSuggestion: false, analyzed: false };
  }

  function endSession() {
    const s = state.session;
    state.session = null;
    state.undo = null;
    state.undoConfirm = false;
    state.undoneOriginal = null;
    if (!s || !s.analyzed) return;
    record({ type: 'completed', outcome: s.applied ? 'optimized' : s.sawSuggestion ? 'declined' : 'unchanged' });
  }

  // ----------------------------------------------------------- core logic

  function currentText() {
    return state.field ? io.read(state.field) : '';
  }

  function onInput(e) {
    if (!isActive() || state.applying) return;
    const field = AG.adapters.resolveField(adapter, e.target);
    if (!field) return;
    state.field = field;
    ui.attach();
    state.lastInputAt = Date.now();
    state.undoConfirm = false;

    const text = currentText();
    state.lastSeenText = text;
    if (state.lastAppliedText !== null && text === state.lastAppliedText) return; // our own echo
    state.lastAppliedText = null;

    if (!text.trim()) {
      clearSuggestion('idle');
      endSession();
      return;
    }
    startSessionIfNeeded(text);
    if (e.isComposing || state.composing) return; // wait for compositionend
    schedule();
  }

  function schedule() {
    clearTimeout(state.timer);
    const text = currentText();
    if (state.result && text !== state.resultFor) {
      // The suggestion no longer matches what is in the box.
      state.result = null;
      state.resultFor = null;
    }
    if (!state.settings.autoOptimize) {
      state.status = 'manual';
      render();
      return;
    }
    if (text.length < state.settings.minPromptChars) {
      state.status = 'short';
      state.message = `Optimization starts at ${state.settings.minPromptChars} characters (change in Settings).`;
      render();
      return;
    }
    state.message = '';
    state.timer = setTimeout(() => runNow(false), state.settings.debounceMs);
  }

  function runNow(manual) {
    clearTimeout(state.timer);
    if (!isActive()) return;
    if (!state.field || !state.field.isConnected) state.field = AG.adapters.findField(adapter, document);
    if (!state.field) return;
    if (state.composing) return;
    ui.attach();

    const text = currentText();
    if (!text.trim()) {
      clearSuggestion('idle');
      state.message = 'Type a prompt first.';
      render();
      return;
    }
    if (!manual && text === state.lastRunText && state.result) return; // nothing new
    if (!manual && text.length < state.settings.minPromptChars) return;

    state.status = 'running';
    render();
    const result = AG.compressor.optimize(text, { level: state.settings.level });
    state.runs += 1;
    state.lastRunText = text;
    state.result = result;
    state.resultFor = text;
    state.message = '';
    state.messageTone = null;
    state.status = result.changed ? 'suggestion' : 'unchanged';
    startSessionIfNeeded(text);
    if (state.session) {
      state.session.analyzed = true;
      if (result.changed) state.session.sawSuggestion = true;
    }
    record({ type: 'run', changed: result.changed, latencyMs: result.latencyMs });
    render();
    startWatching();

    if (!manual && result.changed && AG.settings.autoApplyAllowed(state.settings, adapter.id)) maybeAutoApply(text, result);
  }

  /**
   * Automatic replacement happens only when ALL of these hold; otherwise the
   * suggestion simply stays available in the pill (nothing is lost):
   *   - the user consented to automatic mode and the site is not blocked
   *   - typing has paused for the configured delay and no IME composition is active
   *   - the prompt box (still) has focus in a focused window
   *   - the cursor is a plain caret at the end of the text (no selection)
   *   - the saving is meaningful (minimum tokens AND minimum percentage)
   *   - this is not text the user restored with Undo
   */
  function maybeAutoApply(text, result) {
    const s = state.settings;
    const pausedFor = Date.now() - state.lastInputAt;
    if (state.composing || pausedFor < s.debounceMs - 50) return;
    if (!document.hasFocus()) return;
    if (document.activeElement !== state.field && !state.field.contains(document.activeElement)) return;
    if (text === state.undoneOriginal) return; // the user already said no to this text
    if (state.session && state.session.autoPaused) return; // Undo pauses auto-apply for this draft
    if (result.tokensSaved < s.autoMinTokensSaved || result.reductionPct < s.autoMinReductionPct) {
      state.message = 'Saving too small to change your text automatically. Click Apply if you want it.';
      render();
      return;
    }
    if (!io.caretAtEnd(state.field)) {
      state.message = 'Not replaced automatically because your cursor is mid-text or text is selected. Click Apply to use it.';
      render();
      return;
    }
    apply(true);
  }

  // The editor on this site rejected an automatic replacement: keep the
  // user's text, and use preview mode on this site from now on.
  function blockAutoOnThisSite() {
    const next = AG.settings.sanitizeSettings({
      ...state.settings,
      autoBlockedSites: [...state.settings.autoBlockedSites, adapter.id],
    });
    state.settings = next;
    try {
      chrome.storage.local.set({ settings: next });
    } catch (e) {
      /* extension reloaded */
    }
  }

  function apply(auto) {
    const r = state.result;
    if (!r || !r.changed || state.applying || state.composing) return;
    if (state.settings.applyMode === 'previewOnly') {
      state.message = 'Preview-only mode is on: your text is never modified.';
      render();
      return;
    }
    const before = currentText();
    if (before !== state.resultFor) {
      state.message = 'Your text changed since this suggestion. Optimizing again\u2026';
      render();
      runNow(true);
      return;
    }

    state.applying = true;
    let ok = false;
    try {
      ok = io.write(state.field, r.optimized);
    } finally {
      state.applying = false;
    }
    const after = currentText();
    state.lastAppliedText = after;
    state.lastSeenText = after;

    if (!ok) {
      // Put the original back if the editor ended up in a mixed state.
      if (after !== before) {
        state.applying = true;
        try {
          io.write(state.field, before);
        } finally {
          state.applying = false;
        }
        state.lastAppliedText = currentText();
      }
      state.status = 'error';
      if (auto) {
        blockAutoOnThisSite();
        state.message =
          'This site’s editor did not accept an automatic change, so your text was kept as it was. ' +
          'AquaGuard will use preview mode on this site (you can retry from the toolbar popup).';
      } else {
        state.message = 'This editor did not accept the change. Use "Copy optimized" and paste it yourself.';
      }
      render();
      return;
    }

    state.undo = { original: before, optimized: after, tokensSaved: r.tokensSaved };
    state.undoConfirm = false;
    state.lastRunText = after;
    state.result = { ...r, original: before, optimized: after };
    state.resultFor = after;
    state.status = 'applied';
    state.message = auto
      ? 'Optimized automatically after you paused. Nothing was sent. Click Undo to restore your original text.'
      : 'Optimization applied. Nothing was sent. Review it, then send it yourself.';
    state.messageTone = 'ok';
    if (state.session) state.session.applied = true;
    record({
      type: 'applied',
      originalTokens: r.originalTokens,
      optimizedTokens: r.optimizedTokens,
      reductionPct: r.reductionPct,
      ruleIds: r.transformations.map((t) => t.ruleId),
      auto,
    });
    render();
  }

  function undo() {
    if (!state.undo || state.applying) return;
    const current = currentText();
    if (current !== state.undo.optimized && !state.undoConfirm) {
      state.undoConfirm = true;
      state.message = 'You edited the text after applying. Click Undo again to restore the original anyway.';
      state.messageTone = null;
      render();
      return;
    }
    const { original, tokensSaved } = state.undo;
    state.applying = true;
    let ok = false;
    try {
      ok = io.write(state.field, original);
    } finally {
      state.applying = false;
    }
    const after = currentText();
    state.lastAppliedText = after;
    state.lastSeenText = after;
    if (!ok) {
      state.status = 'error';
      state.message = 'Could not restore automatically. Press Ctrl+Z (Cmd+Z on Mac) in the prompt box.';
      render();
      return;
    }
    state.undo = null;
    state.undoConfirm = false;
    state.undoneOriginal = after;
    if (state.session) {
      state.session.applied = false;
      state.session.autoPaused = true; // don't re-shorten the draft the user just restored
    }
    record({ type: 'undone', tokensSaved });
    // Show the suggestion again for the restored text (never auto-applied).
    state.result = null;
    state.lastRunText = null;
    state.message = 'Original text restored.';
    state.messageTone = 'ok';
    runNow(true);
    state.message = 'Original text restored.';
    state.messageTone = 'ok';
    render();
  }

  function clearSuggestion(status) {
    clearTimeout(state.timer);
    state.result = null;
    state.resultFor = null;
    state.lastRunText = null;
    state.status = status;
    state.message = '';
    render();
    stopWatching();
  }

  // Detect changes made by the website itself (e.g. the box is cleared after
  // sending, or a draft is restored) which do not fire input events.
  function startWatching() {
    if (state.watchTimer) return;
    state.watchTimer = setInterval(() => {
      if (!isActive()) return stopWatching();
      if (!state.field || !state.field.isConnected) {
        const next = AG.adapters.findField(adapter, document);
        if (!next) {
          clearSuggestion('idle');
          endSession();
          return;
        }
        state.field = next;
      }
      const text = currentText();
      if (text === state.lastSeenText) return;
      state.lastSeenText = text;
      if (state.applying || text === state.lastAppliedText) return;
      if (!text.trim()) {
        clearSuggestion('idle');
        endSession();
      } else if (text !== state.resultFor) {
        schedule();
      }
      layout();
    }, 1000);
  }

  function stopWatching() {
    clearInterval(state.watchTimer);
    state.watchTimer = null;
  }

  // ------------------------------------------------------------------ UI

  function viewModel() {
    const r = state.result;
    const fresh = Boolean(r && state.resultFor === currentText());
    return {
      status: state.status,
      result: r,
      runs: state.runs,
      applyMode: state.settings.applyMode,
      modeLabel: MODE_LABELS[state.settings.applyMode],
      canApply: Boolean(fresh && r.changed && state.status !== 'applied' && state.settings.applyMode !== 'previewOnly'),
      canUndo: Boolean(state.undo),
      undoConfirm: state.undoConfirm,
      message: state.message,
      messageTone: state.messageTone,
      // Ask the one-time question only when there is a real suggestion to act on.
      showConsent: Boolean(!state.settings.modeChosen && fresh && r.changed && state.status === 'suggestion'),
    };
  }

  function render() {
    if (!isActive()) return;
    ui.render(viewModel());
  }

  let layoutQueued = false;
  function layout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      if (!isActive() || !state.field) return;
      const showPill = state.status !== 'idle' || document.activeElement === state.field || ui.isOpen();
      if (!showPill) return ui.setVisible(false);
      ui.position(state.field);
    });
  }

  // ------------------------------------------------------------- wiring

  document.addEventListener('input', onInput, true);
  document.addEventListener('compositionstart', () => (state.composing = true), true);
  document.addEventListener(
    'compositionend',
    (e) => {
      state.composing = false;
      onInput(e);
    },
    true
  );
  document.addEventListener(
    'focusin',
    (e) => {
      if (!isActive()) return;
      const field = AG.adapters.resolveField(adapter, e.target);
      if (!field) return;
      state.field = field;
      ui.attach();
      render();
      layout();
    },
    true
  );
  window.addEventListener('scroll', layout, true);
  window.addEventListener('resize', layout);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(layout);
    const observeField = () => state.field && ro.observe(state.field);
    document.addEventListener('focusin', observeField, true);
  }

  // Messages from the popup (same extension only).
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || sender.id !== chrome.runtime.id) return;
    switch (msg.type) {
      case 'AG_GET_STATE':
        break;
      case 'AG_OPTIMIZE_NOW':
        if (isActive()) runNow(true);
        break;
      case 'AG_APPLY':
        if (isActive()) apply(false);
        break;
      case 'AG_UNDO':
        if (isActive()) undo();
        break;
      case 'AG_SHOW_PANEL':
        if (isActive() && state.field) {
          ui.attach();
          ui.setOpen(true);
          layout();
        }
        break;
      default:
        return;
    }
    if (!state.field) state.field = AG.adapters.findField(adapter, document);
    sendResponse(publicState());
  });

  function publicState() {
    const r = state.result;
    const vm = viewModel();
    return {
      supported: true,
      site: { id: adapter.id, name: adapter.name, support: adapter.support, hostname: location.hostname },
      active: isActive(),
      fieldFound: Boolean(state.field),
      status: state.status,
      message: state.message,
      canApply: vm.canApply,
      canUndo: vm.canUndo,
      autoBlocked: state.settings.autoBlockedSites.includes(adapter.id),
      result: r
        ? {
            changed: r.changed,
            originalTokens: r.originalTokens,
            optimizedTokens: r.optimizedTokens,
            tokensSaved: r.tokensSaved,
            reductionPct: r.reductionPct,
            latencyMs: r.latencyMs,
            reason: r.reason,
            tokenizer: r.tokenizer,
            transformations: r.transformations.map((t) => ({ ruleId: t.ruleId, description: t.description, count: t.count })),
          }
        : null,
    };
  }

  loadSettings();
})();
