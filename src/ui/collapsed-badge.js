(() => {
  'use strict';

  const { msg = (key) => key, getBadgePosByHost, setBadgePosByHost, uiConst } = window.TOC_UTILS || {};

  // Constants
  const BADGE_WIDTH = typeof uiConst === 'function' ? uiConst('BADGE_WIDTH', 80) : 80;
  const BADGE_HEIGHT = typeof uiConst === 'function' ? uiConst('BADGE_HEIGHT', 32) : 32;
  const DRAG_MARGIN_PX = typeof uiConst === 'function' ? uiConst('DRAG_MARGIN_PX', 4) : 4;
  const DEFAULT_RIGHT = typeof uiConst === 'function' ? uiConst('BADGE_DEFAULT_RIGHT_PX', 16) : 16;
  const DEFAULT_TOP_MIN = typeof uiConst === 'function' ? uiConst('BADGE_DEFAULT_TOP_MIN_PX', 120) : 120;

  function renderCollapsedBadge(side, onExpand, centerPos) {
    // Remove any existing badge to prevent duplicates
    try {
      document.querySelectorAll('.toc-collapsed-badge').forEach(el => {
        try {
          const cleanup = el && el.__TOC_CLEANUP__;
          if (typeof cleanup === 'function') cleanup();
        } catch (_) {}
        try { el.remove(); } catch (_) {}
      });
    } catch (_) {}

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = `toc-collapsed-badge ${side === 'left' ? 'left' : 'right'}`;
    badge.textContent = msg('tocTitle');
    badge.title = msg('badgeTitle');
    badge.setAttribute('aria-label', msg('badgeTitle') || msg('tocTitle'));

    badge.style.visibility = 'hidden';
    // Set initial default position BEFORE adding to DOM to prevent (0,0) flash
    badge.style.setProperty('top', Math.max(DEFAULT_TOP_MIN, window.innerHeight / 4) + 'px', 'important');
    badge.style.setProperty('right', DEFAULT_RIGHT + 'px', 'important');
    badge.style.setProperty('left', 'auto', 'important');
    badge.style.setProperty('bottom', 'auto', 'important');

    document.documentElement.appendChild(badge);

    let userMoved = false;
    let destroyed = false;
    let anchorX = (side === 'left') ? 'left' : 'right';
    const onKeydown = (e) => {
      if (destroyed || !e) return;
      if (e.key === 'Enter' || e.key === ' ') {
        try { e.preventDefault(); } catch (_) {}
        onExpand && onExpand();
      }
    };

    // Restore position: centerPos first, then from storage
    const restorePosition = async () => {
      let pos = centerPos;
      if (!pos && getBadgePosByHost) {
        try {
          pos = await getBadgePosByHost(location.host);
        } catch (_) {
          pos = null;
        }
      }
      if (destroyed || !badge || !badge.isConnected) return;
      if (userMoved) {
        badge.style.visibility = '';
        return;
      }

      const bw = badge.offsetWidth || BADGE_WIDTH;
      const bh = badge.offsetHeight || BADGE_HEIGHT;

      if (pos && Number.isFinite(pos.x)) {
        if (pos.anchorX === 'left' || pos.anchorX === 'right') {
          anchorX = pos.anchorX;
        }
        // Use saved position
        const left = pos.x - bw / 2;
        const top = (Number.isFinite(pos.y) ? pos.y : DEFAULT_TOP_MIN) - bh / 2;
        const maxLeft = window.innerWidth - bw - DRAG_MARGIN_PX;
        const maxTop = window.innerHeight - bh - DRAG_MARGIN_PX;
        badge.style.setProperty('left', Math.max(DRAG_MARGIN_PX, Math.min(maxLeft, left)) + 'px', 'important');
        badge.style.setProperty('top', Math.max(DRAG_MARGIN_PX, Math.min(maxTop, top)) + 'px', 'important');
        badge.style.setProperty('right', 'auto', 'important');
        badge.style.setProperty('bottom', 'auto', 'important');
      }

      // Show badge after position is set
      badge.style.visibility = '';
    };

    restorePosition();

    badge.addEventListener('keydown', onKeydown);

    let resizeRaf = null;
    let lastViewportW = window.innerWidth;
    let lastViewportH = window.innerHeight;
    let persistTimer = null;
    let pendingPersistCenter = null;
    const RESIZE_LISTENER_OPTS = { passive: true };
    const computeAnchoredScaledPosition = () => {
      if (destroyed || !badge || !badge.isConnected) return;
      try {
        const rect = badge.getBoundingClientRect();
        const bw = badge.offsetWidth || BADGE_WIDTH;
        const bh = badge.offsetHeight || BADGE_HEIGHT;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const prevW = Number.isFinite(lastViewportW) && lastViewportW > 0 ? lastViewportW : vw;
        const prevH = Number.isFinite(lastViewportH) && lastViewportH > 0 ? lastViewportH : vh;

        const centerX = rect.left + bw / 2;
        const centerY = rect.top + bh / 2;

        // Horizontal: snap to edge on resize (keep side, ignore interior offset).
        if (anchorX !== 'left' && anchorX !== 'right') {
          anchorX = centerX > (prevW / 2) ? 'right' : 'left';
        }
        const edgePad = Math.max(DRAG_MARGIN_PX, DEFAULT_RIGHT);
        const nextLeftEdge = (anchorX === 'right') ? (vw - bw - edgePad) : edgePad;

        // Vertical: scale reference point (badge center) by height ratio.
        const ratioH = prevH ? (vh / prevH) : 1;
        const nextCenterY = centerY * ratioH;

        let nextLeft = nextLeftEdge;
        let nextTop = nextCenterY - bh / 2;

        const maxLeft = vw - bw - DRAG_MARGIN_PX;
        const maxTop = vh - bh - DRAG_MARGIN_PX;
        const left = Math.max(DRAG_MARGIN_PX, Math.min(maxLeft, nextLeft));
        const top = Math.max(DRAG_MARGIN_PX, Math.min(maxTop, nextTop));
        badge.style.setProperty('left', left + 'px', 'important');
        badge.style.setProperty('top', top + 'px', 'important');
        badge.style.setProperty('right', 'auto', 'important');
        badge.style.setProperty('bottom', 'auto', 'important');

        lastViewportW = vw;
        lastViewportH = vh;

        // Persist the badge center so next expand aligns to the current viewport.
        pendingPersistCenter = { x: left + bw / 2, y: top + bh / 2, anchorX };
      } catch (_) {}
    };
    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        computeAnchoredScaledPosition();
        if (pendingPersistCenter && setBadgePosByHost) {
          if (persistTimer) clearTimeout(persistTimer);
          persistTimer = setTimeout(() => {
            persistTimer = null;
            const p = pendingPersistCenter;
            pendingPersistCenter = null;
            try {
              if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
                setBadgePosByHost(location.host, p);
              }
            } catch (_) {}
          }, 160);
        }
      });
    };
    window.addEventListener('resize', onResize, RESIZE_LISTENER_OPTS);

    // Drag handling
    const { createDragController } = window.TOC_DRAG || {};
    const dragController = createDragController ? createDragController({
      element: badge,
      shouldStart: (e) => e.target === badge,
      onStart: () => {
        userMoved = true;
        badge.style.cursor = 'grabbing';
        badge.style.userSelect = 'none';
      },
      onMove: (drag, e) => {
        const bw = badge.offsetWidth || BADGE_WIDTH;
        const bh = badge.offsetHeight || BADGE_HEIGHT;
        let left = e.clientX - drag.offsetX;
        let top = e.clientY - drag.offsetY;
        left = Math.max(DRAG_MARGIN_PX, Math.min(window.innerWidth - bw - DRAG_MARGIN_PX, left));
        top = Math.max(DRAG_MARGIN_PX, Math.min(window.innerHeight - bh - DRAG_MARGIN_PX, top));
        badge.style.setProperty('left', left + 'px', 'important');
        badge.style.setProperty('top', top + 'px', 'important');
        badge.style.setProperty('right', 'auto', 'important');
        badge.style.setProperty('bottom', 'auto', 'important');
      },
      onEnd: (drag) => {
        badge.style.cursor = '';
        badge.style.userSelect = '';
        if (!drag.moved) {
          onExpand();
          return;
        }
        // Save badge center position
        const rect = badge.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (Number.isFinite(x) && Number.isFinite(y) && setBadgePosByHost) {
          anchorX = x > (window.innerWidth / 2) ? 'right' : 'left';
          setBadgePosByHost(location.host, { x, y, anchorX });
        }
      }
    }) : null;

    const cleanup = ({ removedExternally } = {}) => {
      destroyed = true;
      try { dragController && dragController.destroy && dragController.destroy(); } catch (_) {}
      try { window.removeEventListener('resize', onResize, RESIZE_LISTENER_OPTS); } catch (_) {}
      try { badge.removeEventListener('keydown', onKeydown); } catch (_) {}
      if (persistTimer) {
        try { clearTimeout(persistTimer); } catch (_) {}
        persistTimer = null;
      }
      try {
        if (typeof resizeRaf === 'number') cancelAnimationFrame(resizeRaf);
      } catch (_) {}
      resizeRaf = null;
      if (!removedExternally) {
        try { badge.remove(); } catch (_) {}
      }
    };

    try {
      badge.__TOC_CLEANUP__ = () => cleanup({ removedExternally: true });
    } catch (_) {}

    return {
      remove() {
        cleanup({ removedExternally: false });
      }
    };
  }

  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.renderCollapsedBadge = renderCollapsedBadge;
})();
