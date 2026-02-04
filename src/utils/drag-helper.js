(() => {
  'use strict';

  if (globalThis.TOC_DRAG) return;

  function createDragController(options) {
    const {
      element,
      shouldStart,
      getRect,
      onStart,
      onMove,
      onEnd,
      thresholdPx
    } = options || {};

    const { uiConst } = globalThis.TOC_UTILS || {};
    const DEFAULT_THRESHOLD_PX = typeof uiConst === 'function' ? uiConst('DRAG_THRESHOLD_PX', 3) : 3;
    const threshold = Number.isFinite(thresholdPx) ? thresholdPx : DEFAULT_THRESHOLD_PX;

    if (!element) {
      return { destroy: () => {}, isActive: () => false };
    }

    const state = {
      active: false,
      destroyed: false,
      moved: false,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0
    };

    const resolveRect = () => {
      try {
        if (typeof getRect === 'function') {
          const r = getRect();
          if (r) return r;
        }
        return element.getBoundingClientRect();
      } catch (_) {
        return null;
      }
    };

    const canStart = (e) => {
      if (state.active) return false;
      if (typeof shouldStart === 'function') {
        try {
          return !!shouldStart(e);
        } catch (_) {
          return false;
        }
      }
      return true;
    };

    const removeDocumentListeners = () => {
      try { document.removeEventListener('mousemove', handleMouseMove, true); } catch (_) {}
      try { document.removeEventListener('mouseup', handleMouseUp, true); } catch (_) {}
    };

    const endDrag = (e, opts = {}) => {
      const prevent = !!(opts && opts.preventDefault);
      const stop = !!(opts && opts.stopPropagation);
      if (!state.active || state.destroyed) return;
      try {
        removeDocumentListeners();
      } finally {
        state.active = false;
      }
      try {
        onEnd && onEnd(state, e);
      } catch (_) {}
      if (prevent) {
        try { e && e.preventDefault && e.preventDefault(); } catch (_) {}
      }
      if (stop) {
        try { e && e.stopPropagation && e.stopPropagation(); } catch (_) {}
      }
    };

    function handleMouseMove(e) {
      if (!state.active || state.destroyed) return;
      if (!element || !element.isConnected) {
        endDrag(e, { preventDefault: false, stopPropagation: false });
        return;
      }
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (!state.moved && (Math.abs(dx) > threshold || Math.abs(dy) > threshold)) {
        state.moved = true;
      }
      try {
        onMove && onMove(state, e);
      } catch (_) {}
      try {
        e.preventDefault();
      } catch (_) {}
    }

    function handleMouseUp(e) {
      endDrag(e, { preventDefault: true, stopPropagation: true });
    }

    function handleMouseDown(e) {
      if (state.destroyed) return;
      if (!canStart(e)) return;
      const rect = resolveRect();
      if (!rect) return;

      state.active = true;
      state.moved = false;
      state.startX = e.clientX;
      state.startY = e.clientY;
      state.offsetX = e.clientX - rect.left;
      state.offsetY = e.clientY - rect.top;

      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('mouseup', handleMouseUp, true);

      try {
        onStart && onStart(state, e);
      } catch (_) {}

      try {
        e.preventDefault();
        e.stopPropagation();
      } catch (_) {}
    }

    element.addEventListener('mousedown', handleMouseDown, true);

    return {
      destroy() {
        if (state.destroyed) return;
        state.destroyed = true;
        element.removeEventListener('mousedown', handleMouseDown, true);
        state.active = false;
        removeDocumentListeners();
        state.moved = false;
        state.startX = 0;
        state.startY = 0;
        state.offsetX = 0;
        state.offsetY = 0;
      },
      isActive: () => state.active
    };
  }

  const ROOT = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
  ROOT.TOC_DRAG = {
    createDragController
  };
})();
