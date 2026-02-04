(() => {
  'use strict';

  const { msg = (key) => key, getBadgePosByHost, setBadgePosByHost } = window.TOC_UTILS || {};

  // Constants
  const BADGE_WIDTH = 80;
  const BADGE_HEIGHT = 32;
  const DEFAULT_RIGHT = 16;
  const DEFAULT_TOP_MIN = 120;

  function renderCollapsedBadge(side, onExpand, centerPos) {
    // Remove any existing badge to prevent duplicates
    try {
      document.querySelectorAll('.toc-collapsed-badge').forEach(el => el.remove());
    } catch (_) {}

    const badge = document.createElement('div');
    badge.className = `toc-collapsed-badge ${side === 'left' ? 'left' : 'right'}`;
    badge.textContent = msg('tocTitle');
    badge.title = msg('badgeTitle');

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
        const maxLeft = window.innerWidth - bw - 4;
        const maxTop = window.innerHeight - bh - 4;
        badge.style.setProperty('left', Math.max(4, Math.min(maxLeft, left)) + 'px', 'important');
        badge.style.setProperty('top', Math.max(4, Math.min(maxTop, top)) + 'px', 'important');
        badge.style.setProperty('right', 'auto', 'important');
        badge.style.setProperty('bottom', 'auto', 'important');
      }

      // Show badge after position is set
      badge.style.visibility = '';
    };

    restorePosition();

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
        left = Math.max(4, Math.min(window.innerWidth - bw - 4, left));
        top = Math.max(4, Math.min(window.innerHeight - bh - 4, top));
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
        badge.remove();
      }
    };
  }

  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.renderCollapsedBadge = renderCollapsedBadge;
})();
