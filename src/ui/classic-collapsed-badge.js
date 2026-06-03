'use strict';

import {
  msg,
  getBadgePosByHost,
  setBadgePosByHost,
  cleanupOwnedElements
} from '../utils/toc-utils.js';
import { createDragController } from '../utils/drag-helper.js';

var CFG = {
  BADGE_WIDTH: 80,
  BADGE_HEIGHT: 32,
  DRAG_MARGIN_PX: 4,
  DEFAULT_RIGHT: 16,
  DEFAULT_TOP_MIN: 120
};

export function renderClassicCollapsedBadge(side, onExpand, centerPos) {
  if (cleanupOwnedElements) cleanupOwnedElements('.toc-collapsed-badge[data-toc-owner="web-toc-assistant"]');

  var badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'toc-collapsed-badge ' + (side === 'left' ? 'left' : 'right');
  badge.setAttribute('data-toc-owner', 'web-toc-assistant');
  badge.textContent = msg('tocTitle');
  badge.title = msg('badgeTitle');
  badge.setAttribute('aria-label', msg('badgeTitle') || msg('tocTitle'));
  badge.style.setProperty('visibility', 'hidden', 'important');
  badge.style.setProperty('top', Math.max(CFG.DEFAULT_TOP_MIN, window.innerHeight / 4) + 'px', 'important');
  badge.style.setProperty('right', CFG.DEFAULT_RIGHT + 'px', 'important');
  badge.style.setProperty('left', 'auto', 'important');
  badge.style.setProperty('bottom', 'auto', 'important');
  document.documentElement.appendChild(badge);

  var destroyed = false;
  var userMoved = false;
  var resizeRaf = null;

  function applyPosition(pos) {
    if (destroyed || !badge.isConnected) return;
    if (!userMoved && pos && Number.isFinite(pos.x)) {
      var width = badge.offsetWidth || CFG.BADGE_WIDTH;
      var height = badge.offsetHeight || CFG.BADGE_HEIGHT;
      var left = Math.max(CFG.DRAG_MARGIN_PX, Math.min(window.innerWidth - width - CFG.DRAG_MARGIN_PX, pos.x - width / 2));
      var top = Math.max(CFG.DRAG_MARGIN_PX, Math.min(window.innerHeight - height - CFG.DRAG_MARGIN_PX, (Number.isFinite(pos.y) ? pos.y : CFG.DEFAULT_TOP_MIN) - height / 2));
      badge.style.setProperty('left', left + 'px', 'important');
      badge.style.setProperty('top', top + 'px', 'important');
      badge.style.setProperty('right', 'auto', 'important');
      badge.style.setProperty('bottom', 'auto', 'important');
    }
    badge.style.removeProperty('visibility');
  }

  if (centerPos) {
    applyPosition(centerPos);
  } else if (getBadgePosByHost) {
    (async function() {
      try {
        var pos = await getBadgePosByHost(location.host);
        applyPosition(pos);
      } catch (_) {
        applyPosition(null);
      }
    })();
  } else {
    applyPosition(null);
  }

  function persistPosition() {
    if (!setBadgePosByHost || destroyed || !badge.isConnected) return;
    var rect = badge.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    setBadgePosByHost(location.host, {
      x: x,
      y: y,
      anchorX: x > window.innerWidth / 2 ? 'right' : 'left'
    });
  }

  var dragController = createDragController ? createDragController({
    element: badge,
    shouldStart: function(e) { return e.target === badge; },
    onStart: function() {
      userMoved = true;
      badge.style.cursor = 'grabbing';
      badge.style.userSelect = 'none';
    },
    onMove: function(drag, e) {
      var width = badge.offsetWidth || CFG.BADGE_WIDTH;
      var height = badge.offsetHeight || CFG.BADGE_HEIGHT;
      var left = Math.max(CFG.DRAG_MARGIN_PX, Math.min(window.innerWidth - width - CFG.DRAG_MARGIN_PX, e.clientX - drag.offsetX));
      var top = Math.max(CFG.DRAG_MARGIN_PX, Math.min(window.innerHeight - height - CFG.DRAG_MARGIN_PX, e.clientY - drag.offsetY));
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
        onExpand && onExpand();
        return;
      }
      persistPosition();
    }
  }) : null;

  function onKeydown(e) {
    if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onExpand && onExpand();
  }

  function onResize() {
    if (resizeRaf != null) return;
    resizeRaf = requestAnimationFrame(function() {
      resizeRaf = null;
      if (destroyed || !badge.isConnected) return;
      var rect = badge.getBoundingClientRect();
      var width = badge.offsetWidth || CFG.BADGE_WIDTH;
      var height = badge.offsetHeight || CFG.BADGE_HEIGHT;
      var left = Math.max(CFG.DRAG_MARGIN_PX, Math.min(window.innerWidth - width - CFG.DRAG_MARGIN_PX, rect.left));
      var top = Math.max(CFG.DRAG_MARGIN_PX, Math.min(window.innerHeight - height - CFG.DRAG_MARGIN_PX, rect.top));
      badge.style.setProperty('left', left + 'px', 'important');
      badge.style.setProperty('top', top + 'px', 'important');
      badge.style.setProperty('right', 'auto', 'important');
      badge.style.setProperty('bottom', 'auto', 'important');
      persistPosition();
    });
  }

  badge.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize, { passive: true });

  function cleanup(opts) {
    opts = opts || {};
    if (destroyed) return;
    destroyed = true;
    try { dragController && dragController.destroy && dragController.destroy(); } catch (_) {}
    try { badge.removeEventListener('keydown', onKeydown); } catch (_) {}
    try { window.removeEventListener('resize', onResize); } catch (_) {}
    if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    if (!opts.removedExternally) {
      try { badge.remove(); } catch (_) {}
    }
  }

  badge.__TOC_CLEANUP__ = function() { cleanup({ removedExternally: true }); };
  return { remove: function() { cleanup({ removedExternally: false }); } };
}
