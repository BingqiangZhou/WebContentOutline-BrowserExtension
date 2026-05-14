import { UI_CONSTANTS } from './constants.js';
import { msg } from './core-utils.js';

export function ensureToastContainer() {
    var existing = document.querySelector('.toc-toast-container');
    if (existing) return existing;
    var container = document.createElement('div');
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
export function showToast(text, opts) {
    if (!opts) opts = {};
    try {
      var type = opts.type || 'info';
      var durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : UI_CONSTANTS.TOAST_DURATION_MS;
      var container = ensureToastContainer();

      var toast = document.createElement('div');
      toast.className = 'toc-toast toc-toast-' + type;
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
      toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

      var message = document.createElement('div');
      message.className = 'toc-toast-message';
      message.textContent = String(text || '');

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'toc-toast-close';
      closeBtn.textContent = msg('symbolClose');
      closeBtn.setAttribute('aria-label', msg('buttonClose'));

      var timerId = null;
      var removed = false;
      var removeToast = function() {
        if (removed) return;
        removed = true;
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
        try { toast.remove(); } catch (_) {}
        try {
          if (container.childElementCount === 0) container.remove();
        } catch (_) {}
      };

      closeBtn.addEventListener('click', removeToast, { once: true });
      toast.addEventListener('click', function(e) {
        // Allow clicking toast body to dismiss, but ignore text selection drags.
        if (e && e.target && e.target.closest && e.target.closest('button')) return;
        try {
          var sel = window.getSelection && window.getSelection();
          if (sel && !sel.isCollapsed) {
            var a = sel.anchorNode;
            var f = sel.focusNode;
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
      return { close: function() {} };
    }
  }

var api = {
    ensureToastContainer: ensureToastContainer,
    showToast: showToast
  };
export default api;
