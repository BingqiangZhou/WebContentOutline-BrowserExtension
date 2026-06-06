'use strict';

interface DragState {
  active: boolean;
  destroyed: boolean;
  moved: boolean;
  cancelled: boolean;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  pointerId: number | null;
}

interface DragControllerOptions {
  element: HTMLElement;
  shouldStart?: (e: PointerEvent) => boolean;
  getRect?: () => DOMRect | null;
  onStart?: (state: DragState, e: PointerEvent) => void;
  onMove?: (state: DragState, e: PointerEvent) => void;
  onEnd?: (state: DragState, e: PointerEvent) => void;
  thresholdPx?: number;
}

export function createDragController(options: DragControllerOptions) {
      var element = options && options.element;
      var shouldStart = options && options.shouldStart;
      var getRect = options && options.getRect;
      var onStart = options && options.onStart;
      var onMove = options && options.onMove;
      var onEnd = options && options.onEnd;
      var thresholdPx = options && options.thresholdPx;

      var threshold: number = Number.isFinite(thresholdPx) ? thresholdPx! : 3;

      if (!element) {
        return { destroy: function() {}, isActive: function() { return false; } };
      }

      var state: DragState = {
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

      function resolveRect() {
        try {
          if (typeof getRect === 'function') {
            var r = getRect();
            if (r) return r;
          }
          return element.getBoundingClientRect();
        } catch (_) {
          return null;
        }
      }

      function canStart(e: PointerEvent) {
        if (state.active) return false;
        if (typeof shouldStart === 'function') {
          try {
            return !!shouldStart(e);
          } catch (_) {
            return false;
          }
        }
        return true;
      }

      function removePointerListeners() {
        try { element.removeEventListener('pointermove', handlePointerMove, true); } catch (_) {}
        try { element.removeEventListener('pointerup', handlePointerUp, true); } catch (_) {}
        try { element.removeEventListener('pointercancel', handlePointerCancel, true); } catch (_) {}
        try { element.removeEventListener('lostpointercapture', handlePointerCancel, true); } catch (_) {}
        if (state.pointerId != null) {
          try { element.releasePointerCapture(state.pointerId); } catch (_) {}
        }
        state.pointerId = null;
      }

      function endDrag(e: PointerEvent, opts?: { preventDefault?: boolean; stopPropagation?: boolean }) {
        opts = opts || {};
        var prevent = !!opts.preventDefault;
        var stop = !!opts.stopPropagation;
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
      }

      function handlePointerMove(e: PointerEvent) {
        if (!state.active || state.destroyed) return;
        if (!element || !element.isConnected) {
          endDrag(e, { preventDefault: false, stopPropagation: false });
          return;
        }
        var dx = e.clientX - state.startX;
        var dy = e.clientY - state.startY;
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

      function handlePointerUp(e: PointerEvent) {
        endDrag(e, { preventDefault: true, stopPropagation: true });
      }

      function handlePointerCancel(e: PointerEvent) {
        state.cancelled = true;
        endDrag(e, { preventDefault: false, stopPropagation: false });
      }

      function handlePointerDown(e: PointerEvent) {
        if (state.destroyed) return;
        if (e.button !== 0) return;
        if (!canStart(e)) return;
        var rect = resolveRect();
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
        destroy: function() {
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
        isActive: function() { return state.active; }
      };
    }
