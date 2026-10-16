/*
 * Site adapters: where the prompt box lives on each supported website.
 *
 * Adding a site = adding one entry here + its URL pattern in manifest.json.
 * Selectors are ordered from most to least specific. Chat sites change their
 * markup often, so every adapter is best-effort and labelled honestly:
 *
 *   primary       the first target; selectors checked against the live site
 *   experimental  selectors based on the site's editor framework; may break
 *   test          local fixture pages only (not injected by the shipped manifest)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AquaGuard = root.AquaGuard || {};
    root.AquaGuard.adapters = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ADAPTERS = Object.freeze([
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      support: 'primary',
      editor: 'textarea / ProseMirror',
      // Checked 2026-10-17: the logged-out composer is a React textarea
      // (name="prompt", id="mobile-composer-prompt"). The signed-in composer
      // has historically been a ProseMirror div#prompt-textarea.
      selectors: [
        'textarea[name="prompt"]',
        'textarea#mobile-composer-prompt',
        '#prompt-textarea[contenteditable="true"]',
        'div#prompt-textarea',
        'textarea#prompt-textarea',
        'form .ProseMirror[contenteditable="true"]',
      ],
    },
    {
      id: 'claude',
      name: 'Claude',
      hosts: ['claude.ai'],
      support: 'experimental',
      editor: 'ProseMirror',
      selectors: [
        '[data-testid="chat-input"][contenteditable="true"]',
        'fieldset .ProseMirror[contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]',
      ],
    },
    {
      id: 'gemini',
      name: 'Gemini',
      hosts: ['gemini.google.com'],
      support: 'experimental',
      editor: 'Quill',
      selectors: ['rich-textarea .ql-editor[contenteditable="true"]', '.ql-editor[contenteditable="true"]'],
    },
    {
      id: 'local-test',
      name: 'Local test page',
      hosts: ['127.0.0.1', 'localhost'],
      support: 'test',
      editor: 'mixed',
      selectors: ['[data-aquaguard-field]'],
    },
  ]);

  function hostMatches(hostname, host) {
    return hostname === host || hostname.endsWith('.' + host);
  }

  function match(hostname) {
    if (typeof hostname !== 'string') return null;
    const h = hostname.toLowerCase();
    return ADAPTERS.find((a) => a.hosts.some((host) => hostMatches(h, host))) || null;
  }

  function byId(id) {
    return ADAPTERS.find((a) => a.id === id) || null;
  }

  /** Given an event target, return the adapter's prompt field that contains it. */
  function resolveField(adapter, target) {
    if (!adapter || !target || typeof target.closest !== 'function') return null;
    for (const sel of adapter.selectors) {
      const el = target.closest(sel);
      if (el) return el;
    }
    return null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** Find the prompt field on the page (first visible match). */
  function findField(adapter, doc) {
    if (!adapter) return null;
    for (const sel of adapter.selectors) {
      for (const el of doc.querySelectorAll(sel)) if (isVisible(el)) return el;
    }
    return null;
  }

  return { ADAPTERS, match, byId, resolveField, findField, isVisible };
});
