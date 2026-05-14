// src/utils/focus-trap.js - Shared keyboard focus trap utility

export function createFocusTrap(container, opts) {
  var onClose = opts && opts.onClose;
  var getFocusableWithin = opts && opts.getFocusableWithin;

  var getFocusable = function() {
    try {
      if (typeof getFocusableWithin === 'function') return getFocusableWithin(container);
    } catch (_) {}
    return [];
  };

  var handleKeydown = function(e) {
    if (!e) return;
    if (e.key === 'Tab') {
      var focusables = getFocusable();
      if (!focusables.length) {
        try { e.preventDefault(); } catch (_) {}
        try { container.focus({ preventScroll: true }); } catch (_) {}
        return;
      }
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      var active = document.activeElement;
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
      if (onClose) onClose();
    }
  };

  container.addEventListener('keydown', handleKeydown);
  return function() {
    try { container.removeEventListener('keydown', handleKeydown); } catch (_) {}
  };
}
