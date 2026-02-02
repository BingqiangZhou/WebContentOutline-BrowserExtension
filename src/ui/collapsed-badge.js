(() => {
  'use strict';

  const { msg, getBadgePosByHost, setBadgePosByHost } = window.TOC_UTILS || {};
  const safeMsg = msg || ((key) => {
    try { return chrome.i18n.getMessage(key) || key; } catch (_) { return key; }
  });

  function renderCollapsedBadge(side, onExpand, centerPos) {
    const badge = document.createElement('div');
    badge.className = 'toc-collapsed-badge';
    badge.textContent = safeMsg('tocTitle');
    badge.title = safeMsg('badgeTitle');

    badge.style.visibility = 'hidden';
    document.documentElement.appendChild(badge);

    const applySavedPos = (pos) => {
      if (!pos || !pos.x) return;

      const badgeWidth = badge.offsetWidth || 80;
      const badgeHeight = badge.offsetHeight || 32;
      const badgeLeft = pos.x - badgeWidth / 2;
      // Use center y position, convert to top (subtract half height)
      const badgeTop = (pos.y ?? 120) - badgeHeight / 2;

      requestAnimationFrame(() => {
        const maxLeft = window.innerWidth - badgeWidth - 4;
        const maxTop = window.innerHeight - badgeHeight - 4;
        badge.style.setProperty('top', Math.max(4, Math.min(maxTop, badgeTop)) + 'px', 'important');
        badge.style.setProperty('left', Math.max(4, Math.min(maxLeft, badgeLeft)) + 'px', 'important');
        badge.style.visibility = '';
      });
    };

    const restoreSavedPos = async () => {
      try {
        // Use provided center position first
        if (centerPos) {
          applySavedPos(centerPos);
          return true;
        }
        // Try to get from storage
        if (getBadgePosByHost) {
          const savedPos = await getBadgePosByHost(location.host);
          if (savedPos) {
            applySavedPos(savedPos);
            return true;
          }
        }
      } catch (_) {}
      return false;
    };

    // Restore position then show badge
    restoreSavedPos().finally(() => {
      // Show badge after position restoration completes
      requestAnimationFrame(() => {
        badge.style.visibility = '';
      });
    });

    let drag = { active: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0, moved: false };

    function onMouseDown(e) {
      if (e.target !== badge) return;

      drag.active = true;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.moved = false;

      const rect = badge.getBoundingClientRect();
      drag.offsetX = e.clientX - rect.left;
      drag.offsetY = e.clientY - rect.top;

      badge.style.cursor = 'grabbing';
      badge.style.userSelect = 'none';

      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mouseup', onMouseUp, true);

      e.preventDefault();
      e.stopPropagation();
    }

    function onMouseMove(e) {
      if (!drag.active) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        drag.moved = true;
      }

      let left = e.clientX - drag.offsetX;
      let top = e.clientY - drag.offsetY;

      const bw = badge.offsetWidth || 80;
      const bh = badge.offsetHeight || 32;

      const minLeft = 4;
      const minTop = 4;
      const maxLeft = window.innerWidth - bw - 4;
      const maxTop = window.innerHeight - bh - 4;

      left = Math.max(minLeft, Math.min(maxLeft, left));
      top = Math.max(minTop, Math.min(maxTop, top));

      badge.style.setProperty('left', left + 'px', 'important');
      badge.style.setProperty('top', top + 'px', 'important');
      badge.style.setProperty('right', 'auto', 'important');
      badge.style.setProperty('bottom', 'auto', 'important');

      e.preventDefault();
    }

    function onMouseUp(e) {
      if (!drag.active) return;

      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);

      badge.style.cursor = 'pointer';
      badge.style.userSelect = '';

      drag.active = false;

      if (!drag.moved) {
        onExpand();
      } else {
        // Save badge position
        // The panel will be positioned so its collapse button center aligns with the badge center
        try {
          const rect = badge.getBoundingClientRect();
          const badgeCenterX = rect.left + rect.width / 2;
          const badgeCenterY = rect.top + rect.height / 2;

          if (setBadgePosByHost) {
            setBadgePosByHost(location.host, {
              x: badgeCenterX,
              y: badgeCenterY
            });
          }
        } catch (err) {
          console.warn(safeMsg('logSavePositionFailed'), err);
        }
      }

      e.preventDefault();
      e.stopPropagation();
    }

    badge.addEventListener('mousedown', onMouseDown, true);

    function cleanup() {
      badge.removeEventListener('mousedown', onMouseDown, true);
      if (drag.active) {
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseup', onMouseUp, true);
      }
    }

    return {
      remove() {
        cleanup();
        badge.remove();
      }
    };
  }

  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.renderCollapsedBadge = renderCollapsedBadge;
})();

