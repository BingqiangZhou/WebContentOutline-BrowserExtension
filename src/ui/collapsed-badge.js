(() => {
  'use strict';

  const { msg, getBadgePosByHost, setBadgePosByHost, setPanelPosByHost } = window.TOC_UTILS || {};
  const safeMsg = msg || ((key) => {
    try { return chrome.i18n.getMessage(key) || key; } catch (_) { return key; }
  });

  function renderCollapsedBadge(side, onExpand, panelPos) {
    const badge = document.createElement('div');
    badge.className = `toc-collapsed-badge ${side === 'left' ? 'left' : 'right'}`;
    badge.textContent = safeMsg('tocTitle');
    badge.title = safeMsg('badgeTitle');

    // Initially hide to prevent flicker at default position
    badge.style.visibility = 'hidden';

    document.documentElement.appendChild(badge);

    const applySavedPos = (savedPos) => {
      if (!savedPos) return;
      const { left, right, top } = savedPos;

      // Determine if should use right positioning
      // If right is provided and element is on right side of screen, use right
      const screenCenter = window.innerWidth / 2;
      const useRight = typeof right === 'number' && right > screenCenter;

      if (useRight) {
        // Use right positioning
        if (typeof right === 'number' && typeof top === 'number') {
          requestAnimationFrame(() => {
            const bw = badge.offsetWidth || 80;
            const bh = badge.offsetHeight || 32;
            const maxTop = window.innerHeight - bh - 4;
            const minRight = 4;
            const maxRight = window.innerWidth - 4;
            const rightDist = window.innerWidth - right;
            if (rightDist >= minRight && rightDist <= maxRight && top >= 4 && top <= maxTop) {
              badge.style.setProperty('right', rightDist + 'px', 'important');
              badge.style.setProperty('left', 'auto', 'important');
              badge.style.setProperty('top', top + 'px', 'important');
              badge.classList.remove('left', 'right');
            }
          });
        }
      } else if (typeof left === 'number' && typeof top === 'number') {
        // Use left positioning
        requestAnimationFrame(() => {
          const bw = badge.offsetWidth || 80;
          const bh = badge.offsetHeight || 32;
          const maxLeft = window.innerWidth - bw - 4;
          const maxTop = window.innerHeight - bh - 4;
          if (left >= 4 && left <= maxLeft && top >= 4 && top <= maxTop) {
            badge.style.setProperty('left', left + 'px', 'important');
            badge.style.setProperty('right', 'auto', 'important');
            badge.style.setProperty('top', top + 'px', 'important');
            badge.classList.remove('left', 'right');
          }
        });
      }
    };

    const readLegacyPos = () => {
      const legacyKey = `tocBadgePos::${location.host}`;
      try {
        const raw = localStorage.getItem(legacyKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.left === 'number' && typeof parsed.top === 'number') {
          localStorage.removeItem(legacyKey);
          return parsed;
        }
      } catch (_) {}
      return null;
    };

    const restoreSavedPos = async () => {
      let applied = false;
      try {
        // Use provided panel position first (from collapse)
        if (panelPos) {
          applySavedPos(panelPos);
          applied = true;
        }
        // Otherwise try to get from storage
        if (!applied && getBadgePosByHost) {
          const savedPos = await getBadgePosByHost(location.host);
          if (savedPos) {
            applySavedPos(savedPos);
            applied = true;
          }
        }
        if (!applied) {
          const legacyPos = readLegacyPos();
          if (legacyPos && setBadgePosByHost) {
            await setBadgePosByHost(location.host, legacyPos);
            applySavedPos(legacyPos);
            applied = true;
          }
        }
      } catch (_) {}
      return applied;
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

      badge.classList.remove('left', 'right');

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
        try {
          const rect = badge.getBoundingClientRect();
          const left = Math.max(4, Math.min(window.innerWidth - rect.width - 4, rect.left));
          const right = rect.right;
          const top = Math.max(4, Math.min(window.innerHeight - rect.height - 4, rect.top));

          // Sync both badge and panel positions
          if (setBadgePosByHost) {
            setBadgePosByHost(location.host, { left, top, right });
          }
          // Panel should be at the same horizontal position, same vertical position
          if (setPanelPosByHost) {
            setPanelPosByHost(location.host, { left, top, right });
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

