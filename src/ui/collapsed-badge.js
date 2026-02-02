(() => {
  'use strict';

  const { msg, getBadgePosByHost, setBadgePosByHost } = window.TOC_UTILS || {};
  const safeMsg = msg || ((key) => {
    try { return chrome.i18n.getMessage(key) || key; } catch (_) { return key; }
  });

  function renderCollapsedBadge(side, onExpand) {
    const badge = document.createElement('div');
    badge.className = `toc-collapsed-badge ${side === 'left' ? 'left' : 'right'}`;
    badge.textContent = safeMsg('tocTitle');
    badge.title = safeMsg('badgeTitle');

    document.documentElement.appendChild(badge);

    const applySavedPos = (savedPos) => {
      if (!savedPos) return;
      const { left, top } = savedPos;
      if (typeof left === 'number' && typeof top === 'number') {
        requestAnimationFrame(() => {
          const bw = badge.offsetWidth || 80;
          const bh = badge.offsetHeight || 32;
          const maxLeft = window.innerWidth - bw - 4;
          const maxTop = window.innerHeight - bh - 4;
          if (left >= 4 && left <= maxLeft && top >= 4 && top <= maxTop) {
            badge.style.setProperty('left', left + 'px', 'important');
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
      try {
        if (getBadgePosByHost) {
          const savedPos = await getBadgePosByHost(location.host);
          if (savedPos) return applySavedPos(savedPos);
        }
        const legacyPos = readLegacyPos();
        if (legacyPos && setBadgePosByHost) {
          await setBadgePosByHost(location.host, legacyPos);
          applySavedPos(legacyPos);
        }
      } catch (_) {}
    };

    restoreSavedPos();

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
          const top = Math.max(4, Math.min(window.innerHeight - rect.height - 4, rect.top));
          if (setBadgePosByHost) {
            setBadgePosByHost(location.host, { left, top });
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

