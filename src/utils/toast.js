(() => {
  const T = globalThis.TOC_UTILS;
  if (!T) return;

  const { msg, UI_CONSTANTS } = T;

  function ensureToastContainer() {
    const existing = document.querySelector('.toc-toast-container');
    if (existing) return existing;
    const container = document.createElement('div');
    container.className = 'toc-toast-container';
    container.setAttribute('data-toc-owner', 'web-toc-assistant');
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', msg('toastRegionLabel'));
    document.documentElement.appendChild(container);
    return container;
  }

  /**
   * Show a small non-blocking toast message.
   * @param {string} text
   * @param {{type?: 'info'|'success'|'warning'|'error', durationMs?: number}} [opts]
   */
  function showToast(text, opts = {}) {
    try {
      const type = opts.type || 'info';
      const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : UI_CONSTANTS.TOAST_DURATION_MS;
      const container = ensureToastContainer();

      const toast = document.createElement('div');
      toast.className = `toc-toast toc-toast-${type}`;
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
      toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

      const message = document.createElement('div');
      message.className = 'toc-toast-message';
      message.textContent = String(text || '');

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'toc-toast-close';
      closeBtn.textContent = msg('symbolClose');
      closeBtn.setAttribute('aria-label', msg('buttonClose'));

      let timerId = null;
      let removed = false;
      const removeToast = () => {
        if (removed) return;
        removed = true;
        if (timerId) {
          try { clearTimeout(timerId); } catch (_) {}
          timerId = null;
        }
        try { toast.remove(); } catch (_) {}
        try {
          if (container.childElementCount === 0) container.remove();
        } catch (_) {}
      };

      closeBtn.addEventListener('click', removeToast, { once: true });
      toast.addEventListener('click', (e) => {
        // Allow clicking toast body to dismiss, but ignore text selection drags.
        if (e && e.target && e.target.closest && e.target.closest('button')) return;
        try {
          const sel = window.getSelection && window.getSelection();
          if (sel && !sel.isCollapsed) {
            const a = sel.anchorNode;
            const f = sel.focusNode;
            if ((a && toast.contains(a)) || (f && toast.contains(f))) return;
          }
        } catch (_) {}
        removeToast();
      });

      toast.appendChild(message);
      toast.appendChild(closeBtn);
      container.appendChild(toast);

      if (durationMs > 0) {
        timerId = setTimeout(removeToast, durationMs);
      }

      return { close: removeToast };
    } catch (_) {
      return { close: () => {} };
    }
  }

  Object.assign(T, {
    ensureToastContainer,
    showToast
  });
})();
