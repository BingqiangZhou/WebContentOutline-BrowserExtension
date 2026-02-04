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
      document.querySelectorAll('.toc-collapsed-badge').forEach(el => el.remove());
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

    // Restore position: centerPos first, then from storage
    const restorePosition = async () => {
      let pos = centerPos;
      if (!pos && getBadgePosByHost) {
        pos = await getBadgePosByHost(location.host);
      }

      const bw = badge.offsetWidth || BADGE_WIDTH;
      const bh = badge.offsetHeight || BADGE_HEIGHT;

      if (pos && Number.isFinite(pos.x)) {
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

    badge.addEventListener('keydown', (e) => {
      if (!e) return;
      if (e.key === 'Enter' || e.key === ' ') {
        try { e.preventDefault(); } catch (_) {}
        onExpand && onExpand();
      }
    });

    let resizeRaf = null;
    const constrainCurrentPosition = () => {
      try {
        const rect = badge.getBoundingClientRect();
        const bw = badge.offsetWidth || BADGE_WIDTH;
        const bh = badge.offsetHeight || BADGE_HEIGHT;
        const maxLeft = window.innerWidth - bw - DRAG_MARGIN_PX;
        const maxTop = window.innerHeight - bh - DRAG_MARGIN_PX;
        const left = Math.max(DRAG_MARGIN_PX, Math.min(maxLeft, rect.left));
        const top = Math.max(DRAG_MARGIN_PX, Math.min(maxTop, rect.top));
        badge.style.setProperty('left', left + 'px', 'important');
        badge.style.setProperty('top', top + 'px', 'important');
        badge.style.setProperty('right', 'auto', 'important');
        badge.style.setProperty('bottom', 'auto', 'important');
      } catch (_) {}
    };
    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        constrainCurrentPosition();
      });
    };
    window.addEventListener('resize', onResize, { passive: true });

    // Drag handling
    const { createDragController } = window.TOC_DRAG || {};
    const dragController = createDragController ? createDragController({
      element: badge,
      shouldStart: (e) => e.target === badge,
      onStart: () => {
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
          setBadgePosByHost(location.host, { x, y });
        }
      }
    }) : null;

    return {
      remove() {
        dragController && dragController.destroy && dragController.destroy();
        try { window.removeEventListener('resize', onResize); } catch (_) {}
        try {
          if (typeof resizeRaf === 'number') cancelAnimationFrame(resizeRaf);
        } catch (_) {}
        resizeRaf = null;
        badge.remove();
      }
    };
  }

  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.renderCollapsedBadge = renderCollapsedBadge;
})();
