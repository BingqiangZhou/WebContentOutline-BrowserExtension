(() => {
  'use strict';

  const { msg = (key) => key, uiConst, getFocusableWithin } = window.TOC_UTILS || {};
  const PICKER_TIMEOUT_MS = typeof uiConst === 'function' ? uiConst('PICKER_TIMEOUT_MS', 20000) : 20000;
  const MAX_Z_INDEX = typeof uiConst === 'function' ? uiConst('MAX_Z_INDEX', 2147483647) : 2147483647;

  function showPickerResult(selector, saveCb) {
    const prevFocus = document.activeElement;
    const existing = document.querySelector('.toc-overlay');
    if (existing) {
      existing.remove();
    }

    const wrap = document.createElement('div');
    wrap.className = 'toc-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.tabIndex = -1;

    const header = document.createElement('div');
    header.className = 'toc-overlay-header';
    header.textContent = msg('pickerResultTitle');
    header.id = `toc-overlay-title-${Math.random().toString(36).slice(2)}`;
    wrap.setAttribute('aria-labelledby', header.id);

    const body = document.createElement('div');
    body.className = 'toc-overlay-body';
    const textarea = document.createElement('textarea');
    textarea.className = 'toc-overlay-textarea';
    textarea.readOnly = true;
    textarea.setAttribute('aria-readonly', 'true');
    textarea.setAttribute('aria-label', msg('pickerResultTitle') || 'CSS selector');
    textarea.textContent = selector;
    body.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'toc-overlay-actions';

    const btnSave = document.createElement('button');
    btnSave.className = 'toc-btn toc-btn-primary';
    btnSave.dataset.act = 'save';
    btnSave.textContent = msg('buttonSaveAsConfig');
    btnSave.setAttribute('aria-label', msg('buttonSaveAsConfig'));

    const btnClose = document.createElement('button');
    btnClose.className = 'toc-btn';
    btnClose.dataset.act = 'close';
    btnClose.textContent = msg('buttonClose');
    btnClose.setAttribute('aria-label', msg('buttonClose'));

    actions.appendChild(btnSave);
    actions.appendChild(btnClose);

    wrap.appendChild(header);
    wrap.appendChild(body);
    wrap.appendChild(actions);

    const restoreFocus = () => {
      try {
        if (prevFocus && prevFocus.focus && document.contains(prevFocus)) {
          prevFocus.focus({ preventScroll: true });
        }
      } catch (_) {}
    };
    const close = () => {
      try { wrap.remove(); } catch (_) {}
      restoreFocus();
    };

    const getFocusable = () => {
      try {
        if (typeof getFocusableWithin === 'function') return getFocusableWithin(wrap);
      } catch (_) {
      }
      return [];
    };
    const onKeydown = (e) => {
      if (!e) return;
      if (e.key === 'Tab') {
        const focusables = getFocusable();
        if (!focusables.length) {
          try { e.preventDefault(); } catch (_) {}
          try { wrap.focus({ preventScroll: true }); } catch (_) {}
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          try { e.preventDefault(); } catch (_) {}
          try { last.focus(); } catch (_) {}
          return;
        }
        if (!e.shiftKey && active === last) {
          try { e.preventDefault(); } catch (_) {}
          try { first.focus(); } catch (_) {}
          return;
        }
      }
      if (e.key === 'Escape') {
        try { e.preventDefault(); } catch (_) {}
        close();
      }
    };
    wrap.addEventListener('keydown', onKeydown);
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'close') close();
      if (act === 'save') saveCb && saveCb(selector, close);
    });
    document.documentElement.appendChild(wrap);
    try { requestAnimationFrame(() => btnSave.focus({ preventScroll: true })); } catch (_) {}
    return { close };
  }

  function createElementPicker(onPicked, onCancel) {
    if (!document.body) {
      console.warn('[toc] DOM not ready, cannot start element picker');
      onCancel && onCancel();
      return { cleanup: () => {} };
    }

    const highlight = document.createElement('div');
    highlight.style.cssText = `position:absolute;border:2px solid #2f6feb;background:rgba(47,111,235,0.08);pointer-events:none;z-index:${MAX_Z_INDEX};left:0;top:0;width:0;height:0;`;
    document.documentElement.appendChild(highlight);

    const prevCursor = document.body.style.cursor;
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
      return el.closest && (el.closest('.toc-floating') || el.closest('.toc-collapsed-badge'));
    }

    function box(el) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = r.left + window.scrollX;
      const top = r.top + window.scrollY;
      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${Math.max(0, r.width)}px`;
      highlight.style.height = `${Math.max(0, r.height)}px`;
    }

    let moveRaf = null;
    let pendingMove = null;
    let finished = false;

    function processMove(e) {
      if (finished) return;
      let el = getElementNode(e.target);
      if (isUiElement(el)) {
        el = getElementNode(document.elementFromPoint(e.clientX, e.clientY));
        if (isUiElement(el)) return;
      }
      if (el && el !== highlight) box(el);
    }

    function move(e) {
      if (finished) return;
      pendingMove = e;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        const evt = pendingMove;
        pendingMove = null;
        moveRaf = null;
        if (evt) processMove(evt);
      });
    }

    function click(e) {
      e.preventDefault();
      if (finished) return;
      let el = getElementNode(e.target);
      if (isUiElement(el)) {
        el = getElementNode(document.elementFromPoint(e.clientX, e.clientY));
        if (isUiElement(el)) {
          return;
        }
      }
      finished = true;
      cleanup();
      if (el && onPicked) onPicked(el);
    }

    function key(e) {
      if (e.key === 'Escape' || e.key === 'Tab') {
        if (finished) return;
        finished = true;
        cleanup();
        onCancel && onCancel();
      }
    }

    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    const onCtx = (e) => {
      e.preventDefault();
      if (finished) return;
      finished = true;
      cleanup();
      onCancel && onCancel();
    };
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', key, true);

    let timeoutId = setTimeout(() => {
      try {
        if (finished) return;
        finished = true;
        cleanup();
      } catch (e) {
        console.warn('[toc] cleanup failed:', e);
      } finally {
        try {
          onCancel && onCancel();
        } catch (e) {
          console.warn('[toc] onCancel failed:', e);
        }
      }
    }, PICKER_TIMEOUT_MS);

    function cleanup() {
      finished = true;
      try { document.removeEventListener('mousemove', move, true); } catch (_) {}
      try { document.removeEventListener('click', click, true); } catch (_) {}
      try { document.removeEventListener('keydown', key, true); } catch (_) {}
      try { document.removeEventListener('contextmenu', onCtx, true); } catch (_) {}
      if (moveRaf) {
        try { cancelAnimationFrame(moveRaf); } catch (_) {}
        moveRaf = null;
      }
      pendingMove = null;
      if (timeoutId) { try { clearTimeout(timeoutId); } catch (_) {} timeoutId = null; }
      if (highlight) {
        try {
          if (highlight.parentNode && document.contains(highlight)) {
            highlight.parentNode.removeChild(highlight);
          }
        } catch (_) {}
        highlight = null;
      }
      try {
        if (document.body) {
          document.body.style.cursor = prevCursor || '';
        }
      } catch (_) {}
    }

    return { cleanup };
  }

  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.showPickerResult = showPickerResult;
  window.TOC_UI.createElementPicker = createElementPicker;
})();

