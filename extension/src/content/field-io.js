/*
 * Reading and writing the prompt field.
 *
 * Writes go through the browser's own editing pipeline (a synthetic paste for
 * rich editors, execCommand('insertText') otherwise) so that the website's
 * editor framework (React, ProseMirror, Quill) sees a normal user edit and the
 * browser's native undo stack keeps working. Nothing here ever submits.
 */
(function (root, factory) {
  const api = factory();
  root.AquaGuard = root.AquaGuard || {};
  root.AquaGuard.fieldIO = api;
})(globalThis, function () {
  'use strict';

  const NBSP = new RegExp(String.fromCharCode(160), 'g');
  const BLOCK_TAGS = /^(?:P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|UL|OL|TR|SECTION|ARTICLE|HEADER|FOOTER|TABLE|TBODY)$/;

  function isTextControl(el) {
    return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text');
  }

  /** Block-aware text extraction mirroring how editors store lines. */
  function readEditable(rootEl) {
    let out = '';
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.data;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName;
          if (tag === 'BR') {
            const placeholder =
              child.classList.contains('ProseMirror-trailingBreak') ||
              (child === child.parentNode.lastChild && child.parentNode !== rootEl && BLOCK_TAGS.test(child.parentNode.tagName));
            if (!placeholder) out += '\n';
            continue;
          }
          if (BLOCK_TAGS.test(tag)) {
            if (out && !out.endsWith('\n')) out += '\n';
            const start = out.length;
            walk(child);
            if (out.length === start || !out.endsWith('\n')) out += '\n';
          } else {
            walk(child);
          }
        }
      }
    };
    walk(rootEl);
    return out.replace(/\n$/, '').replace(NBSP, ' ');
  }

  function read(el) {
    if (!el) return '';
    return isTextControl(el) ? el.value : readEditable(el);
  }

  /** Comparison that tolerates editors merging blank lines. */
  function sameText(a, b) {
    const norm = (s) => s.replace(NBSP, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n+/g, '\n').trim();
    return norm(a) === norm(b);
  }

  function selectAllIn(el) {
    const sel = el.ownerDocument.getSelection();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }

  function writeTextControl(el, text) {
    el.focus({ preventScroll: true });
    el.select();
    let ok = false;
    try {
      ok = el.ownerDocument.execCommand('insertText', false, text);
    } catch (e) {
      ok = false;
    }
    if (!ok || el.value !== text) {
      setNativeValue(el, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
    }
    return el.value === text;
  }

  function writeEditable(el, text) {
    el.focus({ preventScroll: true });
    selectAllIn(el);
    // 1) Rich editors (ProseMirror, Quill) parse pasted plain text into lines.
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const paste = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(paste);
      if (paste.defaultPrevented && sameText(read(el), text)) return true;
    } catch (e) {
      /* fall through */
    }
    // 2) Plain contenteditable: browser-native insertText.
    selectAllIn(el);
    try {
      el.ownerDocument.execCommand('insertText', false, text);
    } catch (e) {
      /* verified below */
    }
    return sameText(read(el), text);
  }

  /** Replace the whole field content. Returns true if the field now holds `text`. */
  function write(el, text) {
    if (!el || !el.isConnected) return false;
    return isTextControl(el) ? writeTextControl(el, text) : writeEditable(el, text);
  }

  return { read, write, sameText, isTextControl, readEditable };
});
