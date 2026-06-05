// @ts-nocheck
'use strict';

import { msg, getBadgePosByHost, setBadgePosByHost, cleanupOwnedElements } from '../utils/toc-utils.js';
import { createDragController } from '../utils/drag-helper.js';

var SVG_NS = 'http://www.w3.org/2000/svg';

var CFG = {
  CLOSE_DELAY_MS: 250,
  PROGRAMMATIC_CLOSE_DELAY_MS: 1800,
  SAFE_MARGIN_PX: 12,
  DEFAULT_TOP_MIN: 120,
  DEFAULT_HEIGHT: 104
};

function normalizeMode(mode) {
  return mode === 'peek' ? mode : 'collapsed';
}

function clampDockTop(top, viewportHeight, dockHeight, safeMargin) {
  var max = Math.max(safeMargin, viewportHeight - dockHeight - safeMargin);
  return Math.max(safeMargin, Math.min(max, top));
}

function resolveDockSide(pos, viewportWidth, fallbackSide) {
  if (pos && (pos.anchorX === 'left' || pos.anchorX === 'right')) return pos.anchorX;
  if (pos && Number.isFinite(pos.x)) return pos.x <= viewportWidth / 2 ? 'left' : 'right';
  return fallbackSide === 'left' ? 'left' : 'right';
}

function getPreviewLineMetrics(level) {
  var metrics = [
    { width: 26, inset: 0 },
    { width: 23, inset: 2 },
    { width: 20, inset: 4 },
    { width: 17, inset: 6 },
    { width: 14, inset: 8 },
    { width: 11, inset: 10 }
  ];
  var safeLevel = Math.max(1, Math.min(6, Number(level) || 2));
  return metrics[safeLevel - 1];
}

function selectPreviewItems(items, activeIndex, limit) {
  var list = Array.isArray(items) ? items : [];
  var size = Math.max(1, limit || 12);
  if (list.length <= size) return list.slice();
  var safeIndex = Number.isFinite(activeIndex) && activeIndex >= 0 ? activeIndex : 0;
  var start = Math.max(0, Math.min(list.length - size, safeIndex - Math.floor(size / 2)));
  return list.slice(start, start + size);
}

function createDockStateController(options) {
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

  function activate() {
    return mode === 'peek' ? collapse() : peek();
  }

  function scheduleCollapse(delayMs) {
    cancelCollapse();
    if (destroyed || mode !== 'peek') return;
    var finalDelayMs = Number.isFinite(delayMs) ? delayMs : closeDelayMs;
    closeTimer = setTimeout(function() {
      closeTimer = null;
      if (!destroyed && mode === 'peek') collapse();
    }, finalDelayMs);
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
    scheduleCollapse: scheduleCollapse,
    setMode: setMode
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

function createSettingsIcon() {
  var icon = document.createElement('span');
  icon.className = 'toc-edge-dock-settings-icon';
  icon.setAttribute('aria-hidden', 'true');

  for (var i = 0; i < 3; i++) {
    var row = document.createElement('span');
    row.className = 'toc-edge-dock-settings-row';
    var bullet = document.createElement('span');
    bullet.className = 'toc-edge-dock-settings-bullet';
    var line = document.createElement('span');
    line.className = 'toc-edge-dock-settings-line';
    row.appendChild(bullet);
    row.appendChild(line);
    icon.appendChild(row);
  }

  return icon;
}

function createButton(className, titleKey, fallbackText, iconPaths) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  var title = msg(titleKey);
  button.title = (title && title !== titleKey) ? title : fallbackText;
  button.setAttribute('aria-label', button.title);
  button.appendChild(createSvgIcon(iconPaths || []));
  return button;
}

export function renderEdgeDock(options) {
  options = options || {};
  if (cleanupOwnedElements) cleanupOwnedElements('.toc-edge-dock[data-toc-owner="web-toc-assistant"]');

  var side = options.side === 'left' ? 'left' : 'right';
  var destroyed = false;
  var lastPointerType = 'mouse';
  var suppressClick = false;
  var persistTimer = null;
  var resizeRaf = null;
  var menuCloseTimer = null;
  var dockItems = Array.isArray(options.items) ? options.items : [];
  var activeIndex = -1;

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
    []
  );
  settingsButton.replaceChildren(createSettingsIcon());
  settingsButton.setAttribute('aria-haspopup', 'menu');
  settingsButton.setAttribute('aria-expanded', 'false');

  var tocButton = document.createElement('div');
  tocButton.className = 'toc-edge-dock-button toc-edge-dock-toc';
  tocButton.tabIndex = 0;
  tocButton.setAttribute('role', 'group');
  tocButton.setAttribute('aria-label', msg('badgeTitle') || 'Expand TOC');
  var preview = document.createElement('span');
  preview.className = 'toc-edge-dock-preview';
  preview.setAttribute('role', 'group');
  preview.setAttribute('aria-label', msg('tocTitle') || 'TOC');
  tocButton.replaceChildren(preview);
  tocButton.setAttribute('aria-controls', panelHost.id);
  tocButton.setAttribute('aria-expanded', 'false');

  function renderPreview() {
    while (preview.firstChild) preview.removeChild(preview.firstChild);
    selectPreviewItems(dockItems, activeIndex, 12).forEach(function(item) {
      var index = dockItems.indexOf(item);
      var metrics = getPreviewLineMetrics(item && item.level);
      var line = document.createElement('button');
      line.type = 'button';
      line.className = 'toc-edge-dock-preview-line';
      line.dataset.index = String(index);
      line.setAttribute('aria-label', item && item.text ? item.text : 'TOC item');
      if (index === activeIndex) line.classList.add('toc-edge-dock-preview-line-active');
      line.dataset.level = String(Math.max(1, Math.min(6, Number(item && item.level) || 2)));
      line.style.setProperty('width', metrics.width + 'px', 'important');
      line.style.setProperty('margin-left', metrics.inset + 'px', 'important');
      preview.appendChild(line);
    });
  }
  renderPreview();

  function navigatePreviewItem(index) {
    var item = dockItems[index];
    if (!item) return;
    try { options.onNavigate && options.onNavigate(item, index); } catch (_) {}
  }

  function onPreviewClick(e) {
    var line = e && e.target && e.target.closest ? e.target.closest('.toc-edge-dock-preview-line') : null;
    if (!line || !preview.contains(line)) return;
    e.preventDefault();
    e.stopPropagation();
    navigatePreviewItem(parseInt(line.dataset.index, 10));
  }

  toolbar.appendChild(settingsButton);
  toolbar.appendChild(tocButton);
  root.appendChild(panelHost);
  root.appendChild(quickMenu);
  root.appendChild(toolbar);
  document.documentElement.appendChild(root);

  function closeMenu() {
    cancelMenuClose();
    quickMenu.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
  }

  function cancelMenuClose() {
    if (menuCloseTimer != null) {
      clearTimeout(menuCloseTimer);
      menuCloseTimer = null;
    }
  }

  function scheduleMenuClose() {
    cancelMenuClose();
    if (quickMenu.hidden) return;
    menuCloseTimer = setTimeout(closeMenu, CFG.CLOSE_DELAY_MS);
  }

  function openMenu() {
    cancelMenuClose();
    controller.collapse();
    quickMenu.hidden = false;
    settingsButton.setAttribute('aria-expanded', 'true');
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
  createMenuButton('dockSwitchToClassic', 'Switch to classic mode', function() {
    try {
      options.onSwitchUiMode && options.onSwitchUiMode('classic');
    } catch (_) {}
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

  async function restorePosition() {
    var fallbackTop = Math.max(CFG.DEFAULT_TOP_MIN, window.innerHeight / 4);
    setTop(fallbackTop);
    if (!getBadgePosByHost) {
      root.style.removeProperty('visibility');
      return;
    }
    try {
      var pos = await getBadgePosByHost(location.host);
      if (destroyed || !root.isConnected) return;
      updateSide(resolveDockSide(pos, window.innerWidth, side), false);
      if (pos && Number.isFinite(pos.y)) setTop(pos.y - dockHeight() / 2);
      root.style.removeProperty('visibility');
    } catch (_) {
      if (!destroyed && root.isConnected) root.style.removeProperty('visibility');
    }
  }

  updateSide(side, false);
  restorePosition();

  var dragController = createDragController ? createDragController({
    element: toolbar,
    shouldStart: function(e) {
      return !!(
        e &&
        e.target &&
        e.target.closest &&
        e.target.closest('.toc-edge-dock-button') &&
        !e.target.closest('.toc-edge-dock-preview-line')
      );
    },
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
    cancelMenuClose();
  }

  function onRootPointerLeave(e) {
    if (e && e.relatedTarget && root.contains(e.relatedTarget)) return;
    if (lastPointerType !== 'touch') controller.scheduleCollapse();
    scheduleMenuClose();
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

  function onSettingsPointerEnter(e) {
    lastPointerType = (e && e.pointerType) || 'mouse';
    if (lastPointerType !== 'touch') openMenu();
  }

  function onTocClick() {
    if (suppressClick || lastPointerType !== 'touch') return;
    closeMenu();
    controller.activate();
  }

  function onSettingsClick() {
    if (suppressClick) return;
    openMenu();
  }

  function onRootFocusIn(e) {
    controller.cancelCollapse();
    cancelMenuClose();
    if (e && e.target === settingsButton) {
      openMenu();
    } else if (
      e &&
      (
        e.target === tocButton ||
        (e.target.closest && e.target.closest('.toc-edge-dock-preview-line'))
      )
    ) {
      closeMenu();
      controller.peek();
    }
  }

  function onRootFocusOut(e) {
    if (e && e.relatedTarget && root.contains(e.relatedTarget)) return;
    controller.scheduleCollapse();
    scheduleMenuClose();
  }

  function onRootKeydown(e) {
    if (e && (e.key === 'Enter' || e.key === ' ') && e.target === tocButton) {
      e.preventDefault();
      onTocClick();
      return;
    }
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
    if (
      lastPointerType === 'touch' &&
      controller.getMode() === 'peek' &&
      e &&
      !root.contains(e.target)
    ) {
      controller.collapse();
    }
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
  preview.addEventListener('click', onPreviewClick);
  settingsButton.addEventListener('pointerenter', onSettingsPointerEnter);
  settingsButton.addEventListener('click', onSettingsClick);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('resize', onResize, { passive: true });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    controller.destroy();
    try { dragController && dragController.destroy && dragController.destroy(); } catch (_) {}
    if (persistTimer) clearTimeout(persistTimer);
    cancelMenuClose();
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
    peek: function(opts) {
      closeMenu();
      controller.peek();
      if (opts && opts.autoCollapse) controller.scheduleCollapse(CFG.PROGRAMMATIC_CLOSE_DELAY_MS);
    },
    setActiveIndex: function(nextIndex) {
      activeIndex = Number.isFinite(nextIndex) ? nextIndex : -1;
      renderPreview();
    },
    setItems: function(nextItems) {
      dockItems = Array.isArray(nextItems) ? nextItems : [];
      if (activeIndex >= dockItems.length) activeIndex = -1;
      renderPreview();
    },
    setSide: function(nextSide) { updateSide(nextSide, true); }
  };
}
