
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
    if (e.key === 'Tab') {
      var focusables = getFocusable();
      if (!focusables.length) {
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      var first = focusables[0] as HTMLElement;
      var last = focusables[focusables.length - 1] as HTMLElement;
      // Inside a shadow root, document.activeElement returns the shadow HOST;
      // read activeElement from the container's own root so Tab wrap-around works.
      var activeRoot: any = null;
      try { activeRoot = container.getRootNode(); } catch (_) {}
      var active = (activeRoot && activeRoot.activeElement) || document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
        return;
      }
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (onClose) onClose();
    }
  };

  container.addEventListener('keydown', handleKeydown);
  return function() {
    container.removeEventListener('keydown', handleKeydown);
  };
}
