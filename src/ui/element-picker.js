'use strict';

import { msg, getFocusableWithin } from '../utils/toc-utils.js';
import { uiConst } from '../utils/constants.js';
import { createFocusTrap } from '../utils/focus-trap.js';

  var CFG = (function() {
    var get = function(name, fallback) { return (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback; };
    return {
      PICKER_TIMEOUT_MS: get('PICKER_TIMEOUT_MS', 20000),
      MAX_Z_INDEX: get('MAX_Z_INDEX', 2147483647),
    };
  })();

export function showPickerResult(selector, saveCb) {
    var prevFocus = document.activeElement;
    var existing = document.querySelector('.toc-overlay[data-toc-owner="web-toc-assistant"]');
    if (existing) {
      existing.remove();
    }

    var wrap = document.createElement('div');
    wrap.className = 'toc-overlay';
    wrap.setAttribute('data-toc-owner', 'web-toc-assistant');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.tabIndex = -1;

    var header = document.createElement('div');
    header.className = 'toc-overlay-header';
    header.textContent = msg('pickerResultTitle');
    header.id = 'toc-overlay-title-' + Math.random().toString(36).slice(2);
    wrap.setAttribute('aria-labelledby', header.id);

    var body = document.createElement('div');
    body.className = 'toc-overlay-body';
    var textarea = document.createElement('textarea');
    textarea.className = 'toc-overlay-textarea';
    textarea.readOnly = true;
    textarea.setAttribute('aria-readonly', 'true');
    textarea.setAttribute('aria-label', msg('pickerResultTitle') || 'CSS selector');
    textarea.textContent = selector;
    body.appendChild(textarea);

    var actions = document.createElement('div');
    actions.className = 'toc-overlay-actions';

    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'toc-btn toc-btn-primary';
    btnSave.dataset.act = 'save';
    btnSave.textContent = msg('buttonSaveAsConfig');
    btnSave.setAttribute('aria-label', msg('buttonSaveAsConfig'));

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'toc-btn';
    btnClose.dataset.act = 'close';
    btnClose.textContent = msg('buttonClose');
    btnClose.setAttribute('aria-label', msg('buttonClose'));

    actions.appendChild(btnSave);
    actions.appendChild(btnClose);

    wrap.appendChild(header);
    wrap.appendChild(body);
    wrap.appendChild(actions);

    var restoreFocus = function() {
      try {
        if (prevFocus && prevFocus.focus && document.contains(prevFocus)) {
          prevFocus.focus({ preventScroll: true });
        }
      } catch (_) {}
    };
    var focusRaf = null;
    var close = function() {
      if (removeFocusTrap) { removeFocusTrap(); removeFocusTrap = null; }
      if (focusRaf) {
        cancelAnimationFrame(focusRaf);
        focusRaf = null;
      }
      try { wrap.remove(); } catch (_) {}
      restoreFocus();
    };

    var removeFocusTrap = createFocusTrap ? createFocusTrap(wrap, { onClose: close, getFocusableWithin: getFocusableWithin }) : null;
    wrap.addEventListener('click', function(e) {
      var target = e && e.target;
      var btn = target && target.closest ? target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.dataset.act;
      if (act === 'close') close();
      if (act === 'save') { try { saveCb && saveCb(selector, close); } catch (e) { console.warn('[toc] saveCb error:', e); } }
    });
    document.documentElement.appendChild(wrap);
    try {
      focusRaf = requestAnimationFrame(function() {
        focusRaf = null;
        if (!wrap || !wrap.isConnected) return;
        try { btnSave.focus({ preventScroll: true }); } catch (_) {}
      });
    } catch (_) {}
    return { close: close };
  }

export function createElementPicker(onPicked, onCancel) {
    if (!document.body) {
      console.warn('[toc] DOM not ready, cannot start element picker');
      onCancel && onCancel();
      return { cleanup: function() {} };
    }

    var highlight = document.createElement('div');
    highlight.style.cssText = 'position:fixed;border:2px solid #2f6feb;background:rgba(47,111,235,0.08);pointer-events:none;z-index:' + CFG.MAX_Z_INDEX + ';left:0;top:0;width:0;height:0;';
    document.documentElement.appendChild(highlight);

    var prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';

    function getElementNode(node) {
      if (!node) return null;
      if (node.nodeType === Node.TEXT_NODE) {
        return node.parentElement;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        return node;
      }
      return null;
    }

    function isUiElement(el) {
      if (!el) return false;
      return el.closest && el.closest('[data-toc-owner="web-toc-assistant"]');
    }

    function box(el) {
      if (finished) return;
      if (!highlight) return;
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      try {
        var r = el.getBoundingClientRect();
        var left = r.left;
        var top = r.top;
        highlight.style.left = left + 'px';
        highlight.style.top = top + 'px';
        highlight.style.width = Math.max(0, r.width) + 'px';
        highlight.style.height = Math.max(0, r.height) + 'px';
      } catch (_) {}
    }

    var moveRaf = null;
    var pendingMove = null;
    var finished = false;
    var cancelPick = function() {
      if (finished) return;
      finished = true;
      try {
        cleanup();
      } catch (e) {
        console.warn('[toc] cleanup failed:', e);
      }
      try {
        onCancel && onCancel();
      } catch (e) {
        console.warn('[toc] onCancel failed:', e);
      }
    };

    function processMove(e) {
      if (finished) return;
      var el = getElementNode(e.target);
      if (isUiElement(el)) {
        try {
          el = getElementNode(document.elementFromPoint(e.clientX, e.clientY));
        } catch (_) {
          el = null;
        }
        if (isUiElement(el)) return;
      }
      if (el && el !== highlight) box(el);
    }

    function move(e) {
      if (finished) return;
      pendingMove = e;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(function() {
        var evt = pendingMove;
        pendingMove = null;
        moveRaf = null;
        if (!finished && evt) processMove(evt);
      });
    }

    function click(e) {
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation(); } catch (_) {}
      if (finished) return;
      var el = getElementNode(e.target);
      if (isUiElement(el)) {
        try {
          el = getElementNode(document.elementFromPoint(e.clientX, e.clientY));
        } catch (_) {
          el = null;
        }
        if (isUiElement(el)) return;
      }
      if (!el || el === highlight) {
        finished = true;
        cleanup();
        return;
      }
      finished = true;
      cleanup();
      if (onPicked) onPicked(el);
    }

    function key(e) {
      if (e.key === 'Escape' || e.key === 'Tab') {
        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}
        cancelPick();
      }
    }

    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    var onCtx = function(e) {
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation(); } catch (_) {}
      cancelPick();
    };
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', key, true);

    var onPageHide = function() { cancelPick(); };
    try { window.addEventListener('pagehide', onPageHide, true); } catch (_) {}

    var timeoutId = setTimeout(function() { cancelPick(); }, CFG.PICKER_TIMEOUT_MS);

    function cleanup() {
      finished = true;
      try { document.removeEventListener('mousemove', move, true); } catch (_) {}
      try { document.removeEventListener('click', click, true); } catch (_) {}
      try { document.removeEventListener('keydown', key, true); } catch (_) {}
      try { document.removeEventListener('contextmenu', onCtx, true); } catch (_) {}
      try { window.removeEventListener('pagehide', onPageHide, true); } catch (_) {}
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = null;
      }
      pendingMove = null;
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      var h = highlight;
      highlight = null;
      try {
        if (h) {
          if (h.parentNode && document.contains(h)) {
            h.parentNode.removeChild(h);
          }
        }
      } catch (_) {}
      try {
        if (document.body) document.body.style.cursor = prevCursor || '';
      } catch (_) {}
    }

    return { cleanup: cleanup };
  }
