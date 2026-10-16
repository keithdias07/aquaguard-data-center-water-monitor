/*
 * In-page UI: a small status pill next to the prompt box and an expandable
 * review panel (original vs optimized, token estimates, Apply / Undo).
 *
 * Rendered inside a Shadow DOM so site CSS cannot break it and our CSS cannot
 * leak into the site. Prompt text is only ever inserted with textContent.
 */
(function (root) {
  'use strict';
  const AG = (root.AquaGuard = root.AquaGuard || {});

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { position: fixed; z-index: 2147483646; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #e2f1ff; }
    .pill { position: fixed; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px 0 8px;
      border-radius: 13px; border: 1px solid #1f4a72; background: #0b1a2e; color: #cfeaff; cursor: pointer;
      font: 600 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,.35); white-space: nowrap; }
    .pill:hover { border-color: #22d3ee; }
    .pill:focus-visible, button:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
    .pill[data-status="suggestion"] { border-color: #22d3ee; color: #ecfeff; }
    .pill[data-status="applied"] { border-color: #34d399; }
    .pill[data-status="error"] { border-color: #f87171; }
    .drop { width: 12px; height: 14px; flex: none; }
    .panel { position: fixed; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px;
      background: #0b1a2e; border: 1px solid #1f4a72; box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: auto; }
    .panel[hidden] { display: none; }
    .head { display: flex; align-items: center; gap: 8px; }
    .title { font-weight: 700; font-size: 13px; color: #ecfeff; flex: 1; }
    .title small { display: block; font-weight: 500; font-size: 11px; color: #7fb4d9; }
    .x { background: none; border: 0; color: #7fb4d9; font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
    .x:hover { color: #fff; background: #12304f; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .metric { background: #0f2540; border: 1px solid #173a5e; border-radius: 8px; padding: 6px 8px; min-width: 0; }
    .metric b { display: block; font-size: 15px; color: #ecfeff; font-variant-numeric: tabular-nums; }
    .metric span { font-size: 10.5px; color: #8fbbdc; text-transform: uppercase; letter-spacing: .03em; }
    .metric.good b { color: #67e8f9; }
    .note { font-size: 11px; color: #8fbbdc; }
    .label { font-size: 11px; color: #8fbbdc; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
    .diff { max-height: 180px; overflow: auto; white-space: pre-wrap; word-break: break-word; background: #071425;
      border: 1px solid #173a5e; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; color: #cfe3f5; }
    .diff del { color: #fca5a5; background: rgba(248,113,113,.12); text-decoration: line-through; }
    .diff ins { color: #6ee7b7; background: rgba(52,211,153,.14); text-decoration: none; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { font-size: 11.5px; background: #12304f; border: 1px solid #1f4a72; border-radius: 999px; padding: 2px 8px; color: #cfeaff; }
    .msg { font-size: 12px; color: #fde68a; }
    .msg[data-tone="ok"] { color: #6ee7b7; }
    .msg:empty { display: none; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    button.btn { font: 600 12.5px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 8px 12px; border-radius: 8px;
      border: 1px solid #1f4a72; background: #12304f; color: #e2f1ff; cursor: pointer; }
    button.btn:hover:not(:disabled) { border-color: #22d3ee; }
    button.btn.primary { background: linear-gradient(135deg, #0891b2, #2563eb); border-color: transparent; color: #fff; }
    button.btn:disabled { opacity: .45; cursor: not-allowed; }
    @media (prefers-reduced-motion: no-preference) { .pill, button.btn { transition: border-color .15s ease; } }
  `;

  const DROP_SVG =
    '<svg class="drop" viewBox="0 0 24 28" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#67e8f9"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs>' +
    '<path d="M12 1C12 1 2 13 2 18.5A10 10 0 0 0 22 18.5C22 13 12 1 12 1Z" fill="url(#g)"/></svg>';

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) node.appendChild(c);
    return node;
  }

  const fmtInt = (n) => Math.round(n).toLocaleString();
  const fmtPct = (n) => `${n.toFixed(1)}%`;
  const fmtMs = (n) => (n < 10 ? `${n.toFixed(1)} ms` : `${Math.round(n)} ms`);

  function create(handlers) {
    const host = document.createElement('div');
    host.id = 'aquaguard-prompt-optimizer';
    host.setAttribute('data-aquaguard-ui', '');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const wrap = el('div', { class: 'wrap' });
    const pill = el('button', { class: 'pill', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ag-panel' });
    pill.innerHTML = DROP_SVG; // static markup only
    const pillText = el('span', { text: 'AquaGuard' });
    pill.appendChild(pillText);

    const panel = el('div', { class: 'panel', id: 'ag-panel', role: 'dialog', 'aria-label': 'AquaGuard prompt optimization', hidden: '' });
    const head = el('div', { class: 'head' });
    const logo = el('span');
    logo.innerHTML = DROP_SVG;
    const title = el('div', { class: 'title' }, [document.createTextNode('AquaGuard Prompt Optimizer')]);
    const subtitle = el('small', { text: '' });
    title.appendChild(subtitle);
    const close = el('button', { class: 'x', type: 'button', 'aria-label': 'Close panel', text: '×' });
    head.append(logo, title, close);

    const metricBox = (label) => {
      const b = el('b', { text: '–' });
      const box = el('div', { class: 'metric' }, [b, el('span', { text: label })]);
      return { box, b };
    };
    const mOrig = metricBox('Original');
    const mOpt = metricBox('Optimized');
    const mSaved = metricBox('Saved');
    const mLat = metricBox('Latency');
    mSaved.box.classList.add('good');
    const metrics = el('div', { class: 'metrics' }, [mOrig.box, mOpt.box, mSaved.box, mLat.box]);
    const estimateNote = el('div', { class: 'note', text: '' });

    const diffLabel = el('div', { class: 'label', text: 'Changes (red removed, green added)' });
    const diffBox = el('div', { class: 'diff', 'aria-label': 'Optimized prompt preview' });
    const chipsLabel = el('div', { class: 'label', text: 'What changed' });
    const chips = el('div', { class: 'chips' });
    const msg = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });

    const btnApply = el('button', { class: 'btn primary', type: 'button', text: 'Apply optimization' });
    const btnUndo = el('button', { class: 'btn', type: 'button', text: 'Undo / restore original' });
    const btnOptimize = el('button', { class: 'btn', type: 'button', text: 'Optimize now' });
    const btnCopy = el('button', { class: 'btn', type: 'button', text: 'Copy optimized' });
    const actions = el('div', { class: 'actions' }, [btnApply, btnUndo, btnOptimize, btnCopy]);

    panel.append(head, metrics, estimateNote, diffLabel, diffBox, chipsLabel, chips, msg, actions);
    wrap.append(pill, panel);
    shadow.appendChild(wrap);

    // Keep the caret in the prompt box when clicking our controls with a mouse.
    shadow.addEventListener('mousedown', (e) => {
      if (e.target.closest && e.target.closest('button')) e.preventDefault();
    });
    // Escape closes the panel only when focus is inside our UI.
    shadow.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) {
        e.stopPropagation();
        setOpen(false);
        pill.focus();
      }
    });

    let open = false;
    let lastView = null;
    function setOpen(v) {
      open = v;
      panel.hidden = !v;
      pill.setAttribute('aria-expanded', String(v));
      if (lastView) render(lastView);
      handlers.onLayout && handlers.onLayout();
    }

    pill.addEventListener('click', () => {
      if (!open && lastView && (lastView.status === 'manual' || lastView.status === 'idle' || lastView.status === 'short')) handlers.onOptimize();
      setOpen(!open);
    });
    close.addEventListener('click', () => setOpen(false));
    btnApply.addEventListener('click', () => handlers.onApply());
    btnUndo.addEventListener('click', () => handlers.onUndo());
    btnOptimize.addEventListener('click', () => handlers.onOptimize());
    btnCopy.addEventListener('click', async () => {
      const text = lastView && lastView.result && lastView.result.optimized;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showMessage('Optimized text copied to clipboard.', 'ok');
      } catch (e) {
        showMessage('Clipboard access was blocked by the page.');
      }
    });

    function showMessage(text, tone) {
      msg.textContent = text || '';
      if (tone) msg.setAttribute('data-tone', tone);
      else msg.removeAttribute('data-tone');
    }

    function pillLabel(view) {
      const r = view.result;
      switch (view.status) {
        case 'running':
          return 'Optimizing…';
        case 'suggestion':
          return `−${fmtPct(r.reductionPct)} · ${fmtInt(r.tokensSaved)} tokens`;
        case 'unchanged':
          return 'Already concise';
        case 'applied':
          return 'Applied · Undo available';
        case 'manual':
          return 'Optimize';
        case 'short':
          return 'AquaGuard';
        case 'error':
          return 'Needs attention';
        default:
          return 'AquaGuard';
      }
    }

    function renderDiff(result) {
      diffBox.textContent = '';
      if (!result) {
        diffBox.textContent = 'No suggestion yet.';
        return;
      }
      const ops = result.changed && AG.diff ? AG.diff.wordDiff(result.original, result.optimized) : null;
      if (!ops) {
        diffBox.textContent = result.optimized;
        return;
      }
      for (const op of ops) {
        const tag = op.type === 'removed' ? 'del' : op.type === 'added' ? 'ins' : 'span';
        diffBox.appendChild(el(tag, { text: op.text }));
      }
    }

    function render(view) {
      lastView = view;
      const r = view.result;
      pill.dataset.status = view.status;
      pillText.textContent = pillLabel(view);
      pill.setAttribute(
        'aria-label',
        `AquaGuard: ${pillLabel(view)}. ${open ? 'Hide' : 'Show'} optimization details.`
      );
      host.dataset.status = view.status;
      host.dataset.runs = String(view.runs || 0);

      subtitle.textContent = view.modeLabel || '';
      if (r) {
        mOrig.b.textContent = `~${fmtInt(r.originalTokens)}`;
        mOpt.b.textContent = `~${fmtInt(r.optimizedTokens)}`;
        mSaved.b.textContent = r.changed ? `${fmtInt(r.tokensSaved)} (${fmtPct(r.reductionPct)})` : '0';
        mLat.b.textContent = fmtMs(r.latencyMs);
        estimateNote.textContent = `${r.tokenizer.exact ? 'Exact' : 'Estimated'} token counts (${r.tokenizer.label}). ` +
          'Real counts differ by model provider.';
      } else {
        for (const m of [mOrig, mOpt, mSaved, mLat]) m.b.textContent = '–';
        estimateNote.textContent = 'Token counts are local estimates, not exact provider counts.';
      }
      renderDiff(r);

      chips.textContent = '';
      const list = (r && r.transformations) || [];
      chipsLabel.hidden = list.length === 0;
      for (const t of list) {
        chips.appendChild(el('span', { class: 'chip', title: t.examples && t.examples[0] ? `e.g. “${t.examples[0].before}”` : '', text: `${t.description}${t.count > 1 ? ` ×${t.count}` : ''}` }));
      }

      let message = view.message || '';
      if (!message && r && !r.changed && r.reason) message = r.reason;
      showMessage(message, view.messageTone);

      btnApply.hidden = view.applyMode === 'previewOnly';
      btnApply.disabled = !view.canApply;
      btnUndo.disabled = !view.canUndo;
      btnUndo.textContent = view.undoConfirm ? 'Click again to discard your edits' : 'Undo / restore original';
      btnCopy.disabled = !(r && r.changed);
    }

    function position(field) {
      if (!field || !field.isConnected) return setVisible(false);
      const rect = field.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return setVisible(false);
      setVisible(true);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pillH = 26;
      let pillTop = rect.top - pillH - 6;
      if (pillTop < 4) pillTop = Math.min(rect.bottom + 6, vh - pillH - 4);
      const right = Math.max(4, vw - rect.right);
      pill.style.top = `${Math.round(pillTop)}px`;
      pill.style.right = `${Math.round(right)}px`;

      const width = Math.min(560, Math.max(320, rect.width), vw - 8);
      panel.style.width = `${Math.round(width)}px`;
      panel.style.right = `${Math.round(Math.min(right, vw - width - 4))}px`;
      const above = pillTop > vh * 0.45;
      if (above) {
        panel.style.top = '';
        panel.style.bottom = `${Math.round(vh - pillTop + 6)}px`;
        panel.style.maxHeight = `${Math.max(160, Math.round(pillTop - 12))}px`;
      } else {
        panel.style.bottom = '';
        panel.style.top = `${Math.round(pillTop + pillH + 6)}px`;
        panel.style.maxHeight = `${Math.max(160, Math.round(vh - pillTop - pillH - 18))}px`;
      }
    }

    function setVisible(v) {
      wrap.style.display = v ? '' : 'none';
    }

    function attach() {
      if (!host.isConnected) document.documentElement.appendChild(host);
    }

    function destroy() {
      host.remove();
    }

    return { host, render, position, setVisible, setOpen, isOpen: () => open, attach, destroy, showMessage };
  }

  AG.overlay = { create };
})(globalThis);
