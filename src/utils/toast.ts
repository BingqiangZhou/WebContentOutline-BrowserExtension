import { msg } from './core-utils.js';
import { EXTENSION_OWNER } from './constants.js';
import { getTocShadowHost } from '../ui/shadow-root.js';

  var TOAST_DURATION_MS = 3000;

function ensureToastContainer() {
    var existing = (getTocShadowHost()?.shadowRoot ?? document).querySelector('.toc-toast-container[data-toc-owner="' + EXTENSION_OWNER + '"]');
    if (existing) return existing;
    var container = document.createElement('div');
    container.className = 'toc-toast-container';
    container.setAttribute('data-toc-owner', EXTENSION_OWNER);
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', msg('toastRegionLabel'));
    (getTocShadowHost()?.shadowRoot ?? document.documentElement).appendChild(container);
    return container;
  }

  /**
   * Show a small non-blocking toast message.
   * @param {string} text
   * @param {{type?: 'info'|'success'|'warning'|'error', durationMs?: number}} [opts]
   */
export function showToast(text: string, opts?: { type?: 'info'|'success'|'warning'|'error'; durationMs?: number }) {
    if (!opts) opts = {};
    try {
      var type = opts.type || 'info';
      var durationMs: number = Number.isFinite(opts.durationMs) ? opts.durationMs! : TOAST_DURATION_MS;
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

      var timerId: ReturnType<typeof setTimeout> | null = null;
      var removed = false;
      var removeToast = function() {
        if (removed) return;
        removed = true;
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
        toast.remove();
        if (container.childElementCount === 0) container.remove();
      };

      closeBtn.addEventListener('click', removeToast, { once: true });
      toast.addEventListener('click', function(e: MouseEvent) {
        // Allow clicking toast body to dismiss, but ignore text selection drags.
        if ((e.target as HTMLElement).closest && (e.target as HTMLElement).closest('button')) return;
        var sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          var a = sel.anchorNode;
          var f = sel.focusNode;
          if ((a && toast.contains(a)) || (f && toast.contains(f))) return;
        }
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
