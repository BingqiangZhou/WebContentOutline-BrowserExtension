
'use strict';

import { msg } from '../utils/toc-utils.js';
import { EXTENSION_OWNER } from '../utils/constants.js';
import { createOverlayDialog } from './overlay-dialog.js';

  var CFG = {
    PICKER_TIMEOUT_MS: 20000,
    MAX_Z_INDEX: 2147483647,
  };

export function showPickerResult(selector: string, saveCb: ((selector: string, close: () => void) => void) | undefined) {
    var dlg = createOverlayDialog({ owner: EXTENSION_OWNER, title: msg('pickerResultTitle') });
    var wrap = dlg.wrap;
    var body = dlg.body;
    var actions = dlg.actions;
    var close = dlg.close;

    var textarea = document.createElement('textarea');
    textarea.className = 'toc-overlay-textarea';
    textarea.readOnly = true;
    textarea.setAttribute('aria-readonly', 'true');
    textarea.setAttribute('aria-label', msg('pickerResultTitle') || 'CSS selector');
    textarea.textContent = selector;
    body.appendChild(textarea);

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

    wrap.addEventListener('click', function(e) {
      var target = e && e.target;
      var btn = target && (target as HTMLElement).closest ? (target as HTMLElement).closest('[data-act]') : null;
      if (!btn) return;
      var act = (btn as HTMLElement).dataset.act;
      if (act === 'close') close();
      if (act === 'save') { try { saveCb && saveCb(selector, close); } catch (e) { console.warn('[toc] saveCb error:', e); } }
    });
    dlg.mount(btnSave);
    return { close: close };
  }

export function createElementPicker(onPicked: ((el: HTMLElement) => void) | undefined, onCancel: (() => void) | undefined) {
    if (!document.body) {
      console.warn('[toc] DOM not ready, cannot start element picker');
      onCancel && onCancel();
      return { cleanup: function() {} };
    }

    var highlight: HTMLDivElement | null = document.createElement('div');
    highlight.style.cssText = 'position:fixed;border:2px solid #2f6feb;background:rgba(47,111,235,0.08);pointer-events:none;z-index:' + CFG.MAX_Z_INDEX + ';left:0;top:0;width:0;height:0;';
    document.documentElement.appendChild(highlight);

    var prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';

    function getElementNode(node: Node | null): HTMLElement | null {
      if (!node) return null;
      if (node.nodeType === Node.TEXT_NODE) {
        return node.parentElement as HTMLElement | null;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        return node as HTMLElement;
      }
      return null;
    }

    function isUiElement(el: HTMLElement | null): boolean {
      if (!el) return false;
      return !!(el.closest && el.closest('[data-toc-owner="' + EXTENSION_OWNER + '"]'));
    }

    function resolveNonUiElement(el: HTMLElement | null, x: number, y: number): HTMLElement | null {
      if (!isUiElement(el)) return el;
      // The pointer landed on (or was retargeted to) the extension's own UI.
      // elementFromPoint returns only the topmost element — our shadow host — so
      // walk the full paint stack via elementsFromPoint to find the first real
      // page element beneath it. This lets users pick elements visually occluded
      // by the dock/panel instead of being blocked by them.
      try {
        var stackFn = (document as any).elementsFromPoint;
        var stack: Element[] = typeof stackFn === 'function'
          ? stackFn.call(document, x, y)
          : [document.elementFromPoint(x, y)];
        for (var i = 0; i < stack.length; i++) {
          var node = getElementNode(stack[i] as Node);
          if (node && !isUiElement(node) && node !== highlight) return node;
        }
      } catch (_) {}
      return null;
    }

    function box(el: HTMLElement): void {
      if (finished) return;
      if (!highlight) return;
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      var r = el.getBoundingClientRect();
      var left = r.left;
      var top = r.top;
      highlight.style.left = left + 'px';
      highlight.style.top = top + 'px';
      highlight.style.width = Math.max(0, r.width) + 'px';
      highlight.style.height = Math.max(0, r.height) + 'px';
    }

    var moveRaf: number | null = null;
    var pendingMove: MouseEvent | null = null;
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

    function processMove(e: MouseEvent): void {
      if (finished) return;
      var el = resolveNonUiElement(getElementNode(e.target as Node), e.clientX, e.clientY);
      if (el && el !== highlight) box(el);
    }

    function move(e: MouseEvent): void {
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

    function click(e: MouseEvent): void {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (finished) return;
      var el = resolveNonUiElement(getElementNode(e.target as Node), e.clientX, e.clientY);
      finished = true;
      cleanup();
      if (el && el !== highlight && onPicked) onPicked(el);
    }

    function key(e: KeyboardEvent): void {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        cancelPick();
      }
    }

    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    var onCtx = function(e: MouseEvent): void {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      cancelPick();
    };
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', key, true);

    var onPageHide = function() { cancelPick(); };
    window.addEventListener('pagehide', onPageHide, true);

    var timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(function() { cancelPick(); }, CFG.PICKER_TIMEOUT_MS);

    function cleanup() {
      finished = true;
      // Restore cursor first, before removing listeners that might reference it
      document.body.style.cursor = prevCursor || '';
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('contextmenu', onCtx, true);
      window.removeEventListener('pagehide', onPageHide, true);
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = null;
      }
      pendingMove = null;
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      var h = highlight;
      highlight = null;
      if (h && h.parentNode && document.contains(h)) {
        h.parentNode.removeChild(h);
      }
    }

    return { cleanup: cleanup };
  }
