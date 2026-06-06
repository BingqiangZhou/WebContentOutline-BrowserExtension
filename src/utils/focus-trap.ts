
// src/utils/focus-trap.ts - Shared keyboard focus trap utility

export function createFocusTrap(container: HTMLElement, opts?: { onClose?: () => void; getFocusableWithin?: (container: HTMLElement) => Element[] }): () => void {
  var onClose = opts && opts.onClose;
  var getFocusableWithinFn = opts && opts.getFocusableWithin;

  var getFocusable = function(): Element[] {
    try {
      if (typeof getFocusableWithinFn === 'function') return getFocusableWithinFn(container);
    } catch (_) {}
    return [];
  };

  var handleKeydown = function(e: KeyboardEvent) {
    if (!e) return;
    if (e.key === 'Tab') {
      var focusables = getFocusable();
      if (!focusables.length) {
        try { e.preventDefault(); } catch (_) {}
        try { container.focus({ preventScroll: true }); } catch (_) {}
        return;
      }
      var first = focusables[0] as HTMLElement;
      var last = focusables[focusables.length - 1] as HTMLElement;
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
