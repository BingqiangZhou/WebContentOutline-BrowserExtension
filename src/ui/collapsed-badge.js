define('collapsed-badge', ['toc-utils', 'drag-helper', 'toc-constants'], function(tocUtils, dragHelper, C) {
  'use strict';

  var msg = tocUtils.msg || function(key) { return key; };
  var getBadgePosByHost = tocUtils.getBadgePosByHost;
  var setBadgePosByHost = tocUtils.setBadgePosByHost;
  var uiConst = C.uiConst;
  var createDragController = dragHelper.createDragController;

  // Constants
  var CFG = (function() {
    var get = function(name, fallback) { return (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback; };
    return {
      BADGE_WIDTH: get('BADGE_WIDTH', 80),
      BADGE_HEIGHT: get('BADGE_HEIGHT', 32),
      DRAG_MARGIN_PX: get('DRAG_MARGIN_PX', 4),
      DEFAULT_RIGHT: get('BADGE_DEFAULT_RIGHT_PX', 16),
      DEFAULT_TOP_MIN: get('BADGE_DEFAULT_TOP_MIN_PX', 120),
    };
  })();

  function renderCollapsedBadge(side, onExpand, centerPos) {
    // Remove any existing badge to prevent duplicates
    try {
      document.querySelectorAll(uiConst('CLEANUP_SELECTOR', '.toc-collapsed-badge[data-toc-owner]')).forEach(function(el) {
        try {
          var cleanup = el && el.__TOC_CLEANUP__;
          if (typeof cleanup === 'function') cleanup();
        } catch (_) {}
        try { el.remove(); } catch (_) {}
      });
    } catch (_) {}

    var badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'toc-collapsed-badge ' + (side === 'left' ? 'left' : 'right');
    badge.setAttribute('data-toc-owner', 'web-toc-assistant');
    badge.textContent = msg('tocTitle');
    badge.title = msg('badgeTitle');
    badge.setAttribute('aria-label', msg('badgeTitle') || msg('tocTitle'));

    badge.style.setProperty('visibility', 'hidden', 'important');
    // Set initial default position BEFORE adding to DOM to prevent (0,0) flash
    badge.style.setProperty('top', Math.max(CFG.DEFAULT_TOP_MIN, window.innerHeight / 4) + 'px', 'important');
    badge.style.setProperty('right', CFG.DEFAULT_RIGHT + 'px', 'important');
    badge.style.setProperty('left', 'auto', 'important');
    badge.style.setProperty('bottom', 'auto', 'important');

    document.documentElement.appendChild(badge);

    var userMoved = false;
    var destroyed = false;
    var anchorX = (side === 'left') ? 'left' : 'right';
    var onKeydown = function(e) {
      if (destroyed || !e) return;
      if (e.key === 'Enter' || e.key === ' ') {
        try { e.preventDefault(); } catch (_) {}
        onExpand && onExpand();
      }
    };

    // Restore position: centerPos first, then from storage
    var restorePosition = function() {
      var pos = centerPos;
      if (!pos && getBadgePosByHost) {
        return getBadgePosByHost(location.host).then(function(stored) {
          if (destroyed || !badge || !badge.isConnected) {
            try { if (badge) badge.style.removeProperty('visibility'); } catch (_) {}
            return;
          }
          pos = stored;
          applyPosition(pos);
        }).catch(function() {
          applyPosition(null);
        });
      }
      applyPosition(pos);
    };

    function applyPosition(pos) {
      if (destroyed || !badge || !badge.isConnected) {
        try { if (badge) badge.style.removeProperty('visibility'); } catch (_) {}
        return;
      }
      if (userMoved) {
        badge.style.removeProperty('visibility');
        return;
      }

      var bw = badge.offsetWidth || CFG.BADGE_WIDTH;
      var bh = badge.offsetHeight || CFG.BADGE_HEIGHT;

      if (pos && Number.isFinite(pos.x)) {
        if (pos.anchorX === 'left' || pos.anchorX === 'right') {
          anchorX = pos.anchorX;
        }
        // Use saved position
        var left = pos.x - bw / 2;
        var top = (Number.isFinite(pos.y) ? pos.y : CFG.DEFAULT_TOP_MIN) - bh / 2;
        var maxLeft = window.innerWidth - bw - CFG.DRAG_MARGIN_PX;
        var maxTop = window.innerHeight - bh - CFG.DRAG_MARGIN_PX;
        badge.style.setProperty('left', Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxLeft, left)) + 'px', 'important');
        badge.style.setProperty('top', Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxTop, top)) + 'px', 'important');
        badge.style.setProperty('right', 'auto', 'important');
        badge.style.setProperty('bottom', 'auto', 'important');
      }

      // Show badge after position is set
      badge.style.removeProperty('visibility');
    }

    restorePosition();

    badge.addEventListener('keydown', onKeydown);

    var resizeRaf = null;
    var lastViewportW = window.innerWidth;
    var lastViewportH = window.innerHeight;
    var persistTimer = null;
    var pendingPersistCenter = null;
    var RESIZE_LISTENER_OPTS = { passive: true };
    var computeAnchoredScaledPosition = function() {
      if (destroyed || !badge || !badge.isConnected) return;
      try {
        var rect = badge.getBoundingClientRect();
        var bw = badge.offsetWidth || CFG.BADGE_WIDTH;
        var bh = badge.offsetHeight || CFG.BADGE_HEIGHT;

        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var prevW = Number.isFinite(lastViewportW) && lastViewportW > 0 ? lastViewportW : vw;
        var prevH = Number.isFinite(lastViewportH) && lastViewportH > 0 ? lastViewportH : vh;

        var centerX = rect.left + bw / 2;
        var centerY = rect.top + bh / 2;

        // Horizontal: snap to edge on resize (keep side, ignore interior offset).
        if (anchorX !== 'left' && anchorX !== 'right') {
          anchorX = centerX > (prevW / 2) ? 'right' : 'left';
        }
        var edgePad = Math.max(CFG.DRAG_MARGIN_PX, CFG.DEFAULT_RIGHT);
        var nextLeftEdge = (anchorX === 'right') ? (vw - bw - edgePad) : edgePad;

        // Vertical: scale reference point (badge center) by height ratio.
        var ratioH = prevH ? (vh / prevH) : 1;
        var nextCenterY = centerY * ratioH;

        var nextLeft = nextLeftEdge;
        var nextTop = nextCenterY - bh / 2;

        var maxLeft = vw - bw - CFG.DRAG_MARGIN_PX;
        var maxTop = vh - bh - CFG.DRAG_MARGIN_PX;
        var left = Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxLeft, nextLeft));
        var top = Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxTop, nextTop));
        badge.style.setProperty('left', left + 'px', 'important');
        badge.style.setProperty('top', top + 'px', 'important');
        badge.style.setProperty('right', 'auto', 'important');
        badge.style.setProperty('bottom', 'auto', 'important');

        lastViewportW = vw;
        lastViewportH = vh;

        // Persist the badge center so next expand aligns to the current viewport.
        pendingPersistCenter = { x: left + bw / 2, y: top + bh / 2, anchorX: anchorX };
      } catch (_) {}
    };
    var onResize = function() {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function() {
        resizeRaf = null;
        computeAnchoredScaledPosition();
        if (pendingPersistCenter && setBadgePosByHost) {
          if (persistTimer) clearTimeout(persistTimer);
          persistTimer = setTimeout(function() {
            persistTimer = null;
            var p = pendingPersistCenter;
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
    var onPageHide = function() {
      if (pendingPersistCenter && setBadgePosByHost) {
        clearTimeout(persistTimer);
        persistTimer = null;
        var p = pendingPersistCenter;
        pendingPersistCenter = null;
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          try { setBadgePosByHost(location.host, p); } catch (_) {}
        }
      }
    };
    try { window.addEventListener('pagehide', onPageHide, true); } catch (_) {}

    // Drag handling
    var dragController = createDragController ? createDragController({
      element: badge,
      shouldStart: function(e) { return e.target === badge; },
      onStart: function() {
        userMoved = true;
        badge.style.cursor = 'grabbing';
        badge.style.userSelect = 'none';
      },
      onMove: function(drag, e) {
        var bw = badge.offsetWidth || CFG.BADGE_WIDTH;
        var bh = badge.offsetHeight || CFG.BADGE_HEIGHT;
        var left = e.clientX - drag.offsetX;
        var top = e.clientY - drag.offsetY;
        left = Math.max(CFG.DRAG_MARGIN_PX, Math.min(window.innerWidth - bw - CFG.DRAG_MARGIN_PX, left));
        top = Math.max(CFG.DRAG_MARGIN_PX, Math.min(window.innerHeight - bh - CFG.DRAG_MARGIN_PX, top));
        badge.style.setProperty('left', left + 'px', 'important');
        badge.style.setProperty('top', top + 'px', 'important');
        badge.style.setProperty('right', 'auto', 'important');
        badge.style.setProperty('bottom', 'auto', 'important');
      },
      onEnd: function(drag) {
        badge.style.cursor = '';
        badge.style.userSelect = '';
        if (drag.cancelled) return;
        if (!drag.moved) {
          onExpand();
          return;
        }
        // Save badge center position
        var rect = badge.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        if (Number.isFinite(x) && Number.isFinite(y) && setBadgePosByHost) {
          anchorX = x > (window.innerWidth / 2) ? 'right' : 'left';
          setBadgePosByHost(location.host, { x: x, y: y, anchorX: anchorX });
        }
      }
    }) : null;

    var cleanup = function(opts) {
      opts = opts || {};
      destroyed = true;
      try { dragController && dragController.destroy && dragController.destroy(); } catch (_) {}
      try { window.removeEventListener('resize', onResize, RESIZE_LISTENER_OPTS); } catch (_) {}
      try { window.removeEventListener('pagehide', onPageHide, true); } catch (_) {}
      try { badge.removeEventListener('keydown', onKeydown); } catch (_) {}
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      try {
        if (typeof resizeRaf === 'number') cancelAnimationFrame(resizeRaf);
      } catch (_) {}
      resizeRaf = null;
      if (!opts.removedExternally) {
        try { badge.remove(); } catch (_) {}
      }
    };

    try {
      badge.__TOC_CLEANUP__ = function() { cleanup({ removedExternally: true }); };
    } catch (_) {}

    return {
      remove: function() {
        cleanup({ removedExternally: false });
      }
    };
  }

  var api = { renderCollapsedBadge: renderCollapsedBadge };
  try { window.TOC_UI = window.TOC_UI || {}; window.TOC_UI.renderCollapsedBadge = renderCollapsedBadge; } catch (_) {}
  return api;
});
