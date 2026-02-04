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

    const { UI_CONSTANTS } = globalThis.TOC_UTILS || {};
    const CONSTS = UI_CONSTANTS || {};
    const DEFAULT_THRESHOLD_PX = Number.isFinite(CONSTS.DRAG_THRESHOLD_PX) ? CONSTS.DRAG_THRESHOLD_PX : 3;
    const threshold = Number.isFinite(thresholdPx) ? thresholdPx : DEFAULT_THRESHOLD_PX;

    if (!element) {
      return { destroy: () => {}, isActive: () => false };
    }

    const state = {
      active: false,
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

    function handleMouseMove(e) {
      if (!state.active) return;
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
      if (!state.active) return;
      state.active = false;
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('mouseup', handleMouseUp, true);
      try {
        onEnd && onEnd(state, e);
      } catch (_) {}
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch (_) {}
    }

    function handleMouseDown(e) {
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
        element.removeEventListener('mousedown', handleMouseDown, true);
        if (state.active) {
          state.active = false;
          document.removeEventListener('mousemove', handleMouseMove, true);
          document.removeEventListener('mouseup', handleMouseUp, true);
        }
      },
      isActive: () => state.active
    };
  }

  const ROOT = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
  ROOT.TOC_DRAG = {
    createDragController
  };
})();
