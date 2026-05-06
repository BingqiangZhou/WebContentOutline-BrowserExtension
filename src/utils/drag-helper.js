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
    const CFG = (() => {
      const get = (name, fallback) => (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback;
      return { DRAG_THRESHOLD_PX: get('DRAG_THRESHOLD_PX', 3) };
    })();
    const threshold = Number.isFinite(thresholdPx) ? thresholdPx : CFG.DRAG_THRESHOLD_PX;

    if (!element) {
      return { destroy: () => {}, isActive: () => false };
    }

    const state = {
      active: false,
      destroyed: false,
      moved: false,
      cancelled: false,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      pointerId: null
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

    const removePointerListeners = () => {
      try { element.removeEventListener('pointermove', handlePointerMove, true); } catch (_) {}
      try { element.removeEventListener('pointerup', handlePointerUp, true); } catch (_) {}
      try { element.removeEventListener('pointercancel', handlePointerCancel, true); } catch (_) {}
      try { element.removeEventListener('lostpointercapture', handlePointerCancel, true); } catch (_) {}
      if (state.pointerId != null) {
        try { element.releasePointerCapture(state.pointerId); } catch (_) {}
      }
      state.pointerId = null;
    };

    const endDrag = (e, opts = {}) => {
      const prevent = !!(opts && opts.preventDefault);
      const stop = !!(opts && opts.stopPropagation);
      if (!state.active || state.destroyed) return;
      try {
        removePointerListeners();
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

    function handlePointerMove(e) {
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

    function handlePointerUp(e) {
      endDrag(e, { preventDefault: true, stopPropagation: true });
    }

    function handlePointerCancel(e) {
      state.cancelled = true;
      endDrag(e, { preventDefault: false, stopPropagation: false });
    }

    function handlePointerDown(e) {
      if (state.destroyed) return;
      if (e.button !== 0) return;
      if (!canStart(e)) return;
      const rect = resolveRect();
      if (!rect) return;

      state.active = true;
      state.moved = false;
      state.startX = e.clientX;
      state.startY = e.clientY;
      state.offsetX = e.clientX - rect.left;
      state.offsetY = e.clientY - rect.top;
      state.pointerId = e.pointerId;

      try { element.setPointerCapture(e.pointerId); } catch (_) {}
      element.addEventListener('pointermove', handlePointerMove, true);
      element.addEventListener('pointerup', handlePointerUp, true);
      element.addEventListener('pointercancel', handlePointerCancel, true);
      element.addEventListener('lostpointercapture', handlePointerCancel, true);

      try {
        onStart && onStart(state, e);
      } catch (_) {}

      try {
        e.preventDefault();
        e.stopPropagation();
      } catch (_) {}
    }

    element.addEventListener('pointerdown', handlePointerDown, true);

    return {
      destroy() {
        if (state.destroyed) return;
        state.destroyed = true;
        element.removeEventListener('pointerdown', handlePointerDown, true);
        state.active = false;
        removePointerListeners();
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
