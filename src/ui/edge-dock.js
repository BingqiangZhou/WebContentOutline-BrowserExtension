'use strict';

import { msg, getBadgePosByHost, setBadgePosByHost, cleanupOwnedElements } from '../utils/toc-utils.js';
import { uiConst } from '../utils/constants.js';
import { createDragController } from '../utils/drag-helper.js';

var SVG_NS = 'http://www.w3.org/2000/svg';

var CFG = (function() {
  var get = function(name, fallback) { return (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback; };
  return {
    CLOSE_DELAY_MS: get('DOCK_CLOSE_DELAY_MS', 250),
    SAFE_MARGIN_PX: get('DOCK_SAFE_MARGIN_PX', 12),
    DEFAULT_TOP_MIN: get('BADGE_DEFAULT_TOP_MIN_PX', 120),
    DEFAULT_HEIGHT: get('DOCK_DEFAULT_HEIGHT', 104)
  };
})();

function normalizeMode(mode) {
  return mode === 'peek' || mode === 'pinned' ? mode : 'collapsed';
}

export function clampDockTop(top, viewportHeight, dockHeight, safeMargin) {
  var max = Math.max(safeMargin, viewportHeight - dockHeight - safeMargin);
  return Math.max(safeMargin, Math.min(max, top));
}

export function resolveDockSide(pos, viewportWidth, fallbackSide) {
  if (pos && (pos.anchorX === 'left' || pos.anchorX === 'right')) return pos.anchorX;
  if (pos && Number.isFinite(pos.x)) return pos.x <= viewportWidth / 2 ? 'left' : 'right';
  return fallbackSide === 'left' ? 'left' : 'right';
}

export function createDockStateController(options) {
  options = options || {};
  var mode = normalizeMode(options.initialMode);
  var closeDelayMs = Number.isFinite(options.closeDelayMs) ? options.closeDelayMs : CFG.CLOSE_DELAY_MS;
  var onChange = options.onChange;
  var closeTimer = null;
  var destroyed = false;

  function cancelCollapse() {
    if (closeTimer != null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function setMode(next) {
    if (destroyed) return mode;
    next = normalizeMode(next);
    if (next !== 'peek') cancelCollapse();
    if (next === mode) return mode;
    var prev = mode;
    mode = next;
    try { onChange && onChange(next, prev); } catch (_) {}
    return mode;
  }

  function collapse() {
    return setMode('collapsed');
  }

  function peek() {
    if (mode === 'collapsed') return setMode('peek');
    return mode;
  }

  function pin() {
    return setMode('pinned');
  }

  function togglePinned() {
    return mode === 'pinned' ? collapse() : pin();
  }

  function activate() {
    return togglePinned();
  }

  function scheduleCollapse() {
    cancelCollapse();
    if (destroyed || mode !== 'peek') return;
    closeTimer = setTimeout(function() {
      closeTimer = null;
      if (!destroyed && mode === 'peek') collapse();
    }, closeDelayMs);
  }

  function destroy() {
    destroyed = true;
    cancelCollapse();
  }

  return {
    activate: activate,
    cancelCollapse: cancelCollapse,
    collapse: collapse,
    destroy: destroy,
    getMode: function() { return mode; },
    peek: peek,
    pin: pin,
    scheduleCollapse: scheduleCollapse,
    setMode: setMode,
    togglePinned: togglePinned
  };
}

function createSvgIcon(paths) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  paths.forEach(function(d) {
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg;
}

function createButton(className, titleKey, fallbackText, iconPaths) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  var title = msg(titleKey);
  button.title = (title && title !== titleKey) ? title : fallbackText;
  button.setAttribute('aria-label', button.title);
  button.appendChild(createSvgIcon(iconPaths));
  return button;
}

export function renderEdgeDock(options) {
  options = options || {};
  if (cleanupOwnedElements) cleanupOwnedElements('.toc-edge-dock[data-toc-owner]');

  var side = options.side === 'left' ? 'left' : 'right';
  var destroyed = false;
  var lastPointerType = 'mouse';
  var suppressClick = false;
  var persistTimer = null;
  var resizeRaf = null;

  var root = document.createElement('aside');
  root.className = 'toc-edge-dock toc-edge-dock-' + side;
  root.setAttribute('data-toc-owner', 'web-toc-assistant');
  root.setAttribute('aria-label', msg('dockLabel') || 'TOC tools');
  root.style.setProperty('visibility', 'hidden', 'important');

  var panelHost = document.createElement('div');
  panelHost.className = 'toc-edge-dock-panel-host';
  panelHost.id = 'toc-edge-dock-panel-' + Math.random().toString(36).slice(2);
  panelHost.hidden = true;

  var quickMenu = document.createElement('div');
  quickMenu.className = 'toc-edge-dock-menu';
  quickMenu.hidden = true;

  var toolbar = document.createElement('div');
  toolbar.className = 'toc-edge-dock-toolbar';
  toolbar.setAttribute('role', 'toolbar');

  var settingsButton = createButton(
    'toc-edge-dock-button toc-edge-dock-settings',
    'dockSettingsTitle',
    'TOC settings',
    ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M19.4 15a1.8 1.8 0 0 0 .36 1.98l.06.06-2.12 2.12-.06-.06a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.04 1.65V20.5h-3v-.11a1.8 1.8 0 0 0-1.04-1.65 1.8 1.8 0 0 0-1.98.36l-.06.06-2.12-2.12.06-.06A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.65-1.04H2.5v-3h.45A1.8 1.8 0 0 0 4.6 9a1.8 1.8 0 0 0-.36-1.98l-.06-.06 2.12-2.12.06.06A1.8 1.8 0 0 0 8.34 5.26 1.8 1.8 0 0 0 9.38 3.6V3.5h3v.11a1.8 1.8 0 0 0 1.04 1.65 1.8 1.8 0 0 0 1.98-.36l.06-.06 2.12 2.12-.06.06A1.8 1.8 0 0 0 17.16 9a1.8 1.8 0 0 0 1.65 1.04h.69v3h-.69A1.8 1.8 0 0 0 17.16 15Z']
  );
  settingsButton.setAttribute('aria-haspopup', 'menu');
  settingsButton.setAttribute('aria-expanded', 'false');

  var tocButton = createButton(
    'toc-edge-dock-button toc-edge-dock-toc',
    'badgeTitle',
    'Expand TOC',
    ['M5 6h14', 'M5 12h14', 'M5 18h14']
  );
  tocButton.setAttribute('aria-controls', panelHost.id);
  tocButton.setAttribute('aria-expanded', 'false');

  toolbar.appendChild(settingsButton);
  toolbar.appendChild(tocButton);
  root.appendChild(panelHost);
  root.appendChild(quickMenu);
  root.appendChild(toolbar);
  document.documentElement.appendChild(root);

  function closeMenu() {
    quickMenu.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
  }

  function runMenuAction(callback) {
    closeMenu();
    try { callback && callback(); } catch (_) {}
  }

  function createMenuButton(labelKey, fallbackText, callback) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'toc-edge-dock-menu-item';
    button.setAttribute('role', 'menuitem');
    var label = msg(labelKey);
    button.textContent = (label && label !== labelKey) ? label : fallbackText;
    button.addEventListener('click', function() { runMenuAction(callback); });
    quickMenu.appendChild(button);
    return button;
  }

  quickMenu.setAttribute('role', 'menu');
  createMenuButton('buttonRefresh', 'Refresh', options.onRefresh);
  createMenuButton('buttonPickElement', 'Pick element', options.onPick);
  createMenuButton('buttonSiteConfig', 'Site settings', options.onSiteConfig);
  var sideButton = createMenuButton('dockMoveToLeft', 'Move to left', function() {
    updateSide(side === 'left' ? 'right' : 'left', true);
  });

  var controller = createDockStateController({
    initialMode: options.initialMode,
    closeDelayMs: options.closeDelayMs,
    onChange: function(next, prev) {
      root.setAttribute('data-mode', next);
      tocButton.setAttribute('aria-expanded', next === 'collapsed' ? 'false' : 'true');
      panelHost.hidden = next === 'collapsed';
      try { options.onModeChange && options.onModeChange(next, prev); } catch (_) {}
    }
  });
  root.setAttribute('data-mode', controller.getMode());
  tocButton.setAttribute('aria-expanded', controller.getMode() === 'collapsed' ? 'false' : 'true');
  panelHost.hidden = controller.getMode() === 'collapsed';

  function updateSide(nextSide, persist) {
    side = nextSide === 'left' ? 'left' : 'right';
    root.classList.toggle('toc-edge-dock-left', side === 'left');
    root.classList.toggle('toc-edge-dock-right', side === 'right');
    var key = side === 'left' ? 'dockMoveToRight' : 'dockMoveToLeft';
    var fallback = side === 'left' ? 'Move to right' : 'Move to left';
    var text = msg(key);
    sideButton.textContent = (text && text !== key) ? text : fallback;
    if (persist) {
      persistPosition();
      try { options.onSideChange && options.onSideChange(side); } catch (_) {}
    }
  }

  function dockHeight() {
    return toolbar.offsetHeight || CFG.DEFAULT_HEIGHT;
  }

  function clampTop(top) {
    return clampDockTop(top, window.innerHeight, dockHeight(), CFG.SAFE_MARGIN_PX);
  }

  function setTop(top) {
    root.style.setProperty('top', clampTop(top) + 'px', 'important');
  }

  function centerY() {
    var rect = toolbar.getBoundingClientRect();
    return rect.top + rect.height / 2;
  }

  function persistPosition() {
    if (!setBadgePosByHost) return;
    var y = centerY();
    var x = side === 'left' ? 0 : window.innerWidth;
    try { setBadgePosByHost(location.host, { x: x, y: y, anchorX: side }); } catch (_) {}
  }

  function restorePosition() {
    var fallbackTop = Math.max(CFG.DEFAULT_TOP_MIN, window.innerHeight / 4);
    setTop(fallbackTop);
    if (!getBadgePosByHost) {
      root.style.removeProperty('visibility');
      return;
    }
    getBadgePosByHost(location.host).then(function(pos) {
      if (destroyed || !root.isConnected) return;
      updateSide(resolveDockSide(pos, window.innerWidth, side), false);
      if (pos && Number.isFinite(pos.y)) setTop(pos.y - dockHeight() / 2);
      root.style.removeProperty('visibility');
    }).catch(function() {
      if (!destroyed && root.isConnected) root.style.removeProperty('visibility');
    });
  }

  updateSide(side, false);
  restorePosition();

  var dragController = createDragController ? createDragController({
    element: toolbar,
    shouldStart: function(e) { return !!(e && e.target && e.target.closest && e.target.closest('.toc-edge-dock-button')); },
    getRect: function() { return toolbar.getBoundingClientRect(); },
    onStart: function() {
      toolbar.classList.add('toc-edge-dock-dragging');
    },
    onMove: function(drag, e) {
      setTop(e.clientY - drag.offsetY);
    },
    onEnd: function(drag) {
      toolbar.classList.remove('toc-edge-dock-dragging');
      if (!drag.moved || drag.cancelled) return;
      suppressClick = true;
      setTimeout(function() { suppressClick = false; }, 0);
      persistPosition();
    }
  }) : null;

  function onRootPointerEnter() {
    controller.cancelCollapse();
  }

  function onRootPointerLeave(e) {
    if (e && e.relatedTarget && root.contains(e.relatedTarget)) return;
    controller.scheduleCollapse();
  }

  function onTocPointerEnter(e) {
    lastPointerType = (e && e.pointerType) || 'mouse';
    if (lastPointerType !== 'touch') {
      closeMenu();
      controller.peek();
    }
  }

  function onTocPointerDown(e) {
    lastPointerType = (e && e.pointerType) || 'mouse';
  }

  function onTocClick() {
    if (suppressClick) return;
    closeMenu();
    controller.activate(lastPointerType);
  }

  function onSettingsClick() {
    if (suppressClick) return;
    controller.collapse();
    var open = quickMenu.hidden;
    quickMenu.hidden = !open;
    settingsButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function onRootFocusIn(e) {
    controller.cancelCollapse();
    if (e && e.target === tocButton) {
      closeMenu();
      controller.peek();
    }
  }

  function onRootFocusOut(e) {
    if (e && e.relatedTarget && root.contains(e.relatedTarget)) return;
    controller.scheduleCollapse();
  }

  function onRootKeydown(e) {
    if (!e || e.key !== 'Escape') return;
    if (!quickMenu.hidden) {
      closeMenu();
      try { settingsButton.focus(); } catch (_) {}
      return;
    }
    controller.collapse();
    try { tocButton.focus(); } catch (_) {}
  }

  function onDocumentPointerDown(e) {
    if (!quickMenu.hidden && e && !root.contains(e.target)) closeMenu();
  }

  function onResize() {
    if (resizeRaf != null) return;
    resizeRaf = requestAnimationFrame(function() {
      resizeRaf = null;
      if (destroyed || !root.isConnected) return;
      setTop(parseFloat(root.style.top) || CFG.DEFAULT_TOP_MIN);
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(function() {
        persistTimer = null;
        persistPosition();
      }, 160);
    });
  }

  root.addEventListener('pointerenter', onRootPointerEnter);
  root.addEventListener('pointerleave', onRootPointerLeave);
  root.addEventListener('focusin', onRootFocusIn);
  root.addEventListener('focusout', onRootFocusOut);
  root.addEventListener('keydown', onRootKeydown);
  tocButton.addEventListener('pointerenter', onTocPointerEnter);
  tocButton.addEventListener('pointerdown', onTocPointerDown);
  tocButton.addEventListener('click', onTocClick);
  settingsButton.addEventListener('click', onSettingsClick);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('resize', onResize, { passive: true });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    controller.destroy();
    try { dragController && dragController.destroy && dragController.destroy(); } catch (_) {}
    if (persistTimer) clearTimeout(persistTimer);
    if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    window.removeEventListener('resize', onResize);
    try { root.remove(); } catch (_) {}
  }

  root.__TOC_CLEANUP__ = destroy;

  return {
    collapse: function(opts) {
      closeMenu();
      controller.collapse();
      if (opts && opts.focus) {
        try { tocButton.focus(); } catch (_) {}
      }
    },
    destroy: destroy,
    getMode: controller.getMode,
    getPanelHost: function() { return panelHost; },
    getSide: function() { return side; },
    pin: function() { closeMenu(); controller.pin(); },
    setSide: function(nextSide) { updateSide(nextSide, true); }
  };
}
