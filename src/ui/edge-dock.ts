
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

function normalizeMode(mode: string): string {
  return mode === 'peek' ? mode : 'collapsed';
}

function clampDockTop(top: number, viewportHeight: number, dockHeight: number, safeMargin: number): number {
  var max = Math.max(safeMargin, viewportHeight - dockHeight - safeMargin);
  return Math.max(safeMargin, Math.min(max, top));
}

interface BadgePos {
  x: number;
  y: number;
  anchorX?: string;
}

function resolveDockSide(pos: BadgePos | null, viewportWidth: number, fallbackSide: string): string {
  if (pos && (pos.anchorX === 'left' || pos.anchorX === 'right')) return pos.anchorX;
  if (pos && Number.isFinite(pos.x)) return pos.x <= viewportWidth / 2 ? 'left' : 'right';
  return fallbackSide === 'left' ? 'left' : 'right';
}

function getPreviewLineMetrics(level: number): { width: number; inset: number } {
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

interface DockItem {
  text: string;
  level: number;
}

function selectPreviewItems(items: DockItem[], activeIndex: number, limit: number): DockItem[] {
  var list = Array.isArray(items) ? items : [];
  var size = Math.max(1, limit || 12);
  if (list.length <= size) return list.slice();
  var safeIndex = Number.isFinite(activeIndex) && activeIndex >= 0 ? activeIndex : 0;
  var start = Math.max(0, Math.min(list.length - size, safeIndex - Math.floor(size / 2)));
  return list.slice(start, start + size);
}

interface DockStateControllerOptions {
  initialMode?: string;
  closeDelayMs?: number;
  onChange?: (next: string, prev: string) => void;
}

function createDockStateController(options: DockStateControllerOptions) {
  options = options || {};
  var mode = normalizeMode(options.initialMode || '');
  var closeDelayMs = Number.isFinite(options.closeDelayMs) ? options.closeDelayMs : CFG.CLOSE_DELAY_MS;
  var onChange = options.onChange;
  var closeTimer: ReturnType<typeof setTimeout> | null = null;
  var destroyed = false;

  function cancelCollapse() {
    if (closeTimer != null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function setMode(next: string): string {
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

  function scheduleCollapse(delayMs?: number): void {
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

function createSvgIcon(paths: string[]): SVGSVGElement {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  paths.forEach(function(d: string) {
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg as SVGSVGElement;
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

function createButton(className: string, titleKey: string, fallbackText: string, iconPaths: string[] | undefined): HTMLButtonElement {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  var title = msg(titleKey);
  button.title = (title && title !== titleKey) ? title : fallbackText;
  button.setAttribute('aria-label', button.title);
  button.appendChild(createSvgIcon(iconPaths || []));
  return button;
}

interface EdgeDockOptions {
  side?: string;
  items?: DockItem[];
  initialMode?: string;
  closeDelayMs?: number;
  onNavigate?: (item: DockItem, index: number) => void;
  onRefresh?: () => void;
  onPick?: () => void;
  onSiteConfig?: () => void;
  onSwitchUiMode?: (mode: string) => void;
  onSideChange?: (side: string) => void;
  onModeChange?: (next: string, prev: string) => void;
}

interface DragState {
  active: boolean;
  destroyed: boolean;
  moved: boolean;
  cancelled: boolean;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  pointerId: number | null;
}

export function renderEdgeDock(options: EdgeDockOptions) {
  options = options || {};
  if (cleanupOwnedElements) cleanupOwnedElements('.toc-edge-dock[data-toc-owner="web-toc-assistant"]');

  var side: string = options.side === 'left' ? 'left' : 'right';
  var destroyed = false;
  var lastPointerType: string = 'mouse';
  var suppressClick = false;
  var persistTimer: ReturnType<typeof setTimeout> | null = null;
  var resizeRaf: number | null = null;
  var menuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  var dockItems: DockItem[] = Array.isArray(options.items) ? options.items : [];
  var activeIndex = -1;

  var root = document.createElement('aside');
  var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
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

  // Track the current preview window to enable incremental active-class updates
  var previewWindowStart = -1;
  var previewWindowSize = 0;

  function renderPreview() {
    // Use replaceChildren() for efficient clear
    if (typeof preview.replaceChildren === 'function') {
      preview.replaceChildren();
    } else {
      while (preview.firstChild) preview.removeChild(preview.firstChild);
    }
    var subset = selectPreviewItems(dockItems, activeIndex, 12);
    // Track the window range for incremental updates
    if (subset.length > 0 && subset.length < dockItems.length) {
      previewWindowStart = dockItems.indexOf(subset[0]);
      previewWindowSize = subset.length;
    } else {
      previewWindowStart = 0;
      previewWindowSize = subset.length;
    }
    for (var i = 0; i < subset.length; i++) {
      var item = subset[i];
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
    }
  }

  /**
   * Update the active highlight without re-rendering the entire preview.
   * Falls back to full render if the window needs to slide.
   */
  function updatePreviewActive(nextIndex: number): void {
    if (previewWindowStart < 0 || !preview.children.length) {
      renderPreview();
      return;
    }
    // Check if the new active index is within the current window
    var inWindow = nextIndex >= previewWindowStart && nextIndex < previewWindowStart + previewWindowSize;
    if (!inWindow) {
      renderPreview();
      return;
    }
    // Toggle active class on old and new items — no DOM rebuild
    var children = preview.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i] as HTMLElement;
      var idx = parseInt(child.dataset.index || '-1', 10);
      if (idx === nextIndex) {
        child.classList.add('toc-edge-dock-preview-line-active');
      } else {
        child.classList.remove('toc-edge-dock-preview-line-active');
      }
    }
  }
  renderPreview();

  function navigatePreviewItem(index: number): void {
    var item = dockItems[index];
    if (!item) return;
    try { options.onNavigate && options.onNavigate(item, index); } catch (_) {}
  }

  function onPreviewClick(e: MouseEvent): void {
    var line = e && e.target && (e.target as HTMLElement).closest ? (e.target as HTMLElement).closest('.toc-edge-dock-preview-line') : null;
    if (!line || !preview.contains(line)) return;
    e.preventDefault();
    e.stopPropagation();
    navigatePreviewItem(parseInt((line as HTMLElement).dataset.index || '0', 10));
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

  function runMenuAction(callback: (() => void) | undefined): void {
    closeMenu();
    try { callback && callback(); } catch (_) {}
  }

  function createMenuButton(labelKey: string, fallbackText: string, callback: (() => void) | undefined): HTMLButtonElement {
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
    onChange: function(next: string, prev: string): void {
      root.setAttribute('data-mode', next);
      tocButton.setAttribute('aria-expanded', next === 'collapsed' ? 'false' : 'true');
      panelHost.hidden = next === 'collapsed';
      try { options.onModeChange && options.onModeChange(next, prev); } catch (_) {}
    }
  });
  root.setAttribute('data-mode', controller.getMode());
  tocButton.setAttribute('aria-expanded', controller.getMode() === 'collapsed' ? 'false' : 'true');
  panelHost.hidden = controller.getMode() === 'collapsed';

  function updateSide(nextSide: string, persist: boolean): void {
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

  function clampTop(top: number): number {
    return clampDockTop(top, window.innerHeight, dockHeight(), CFG.SAFE_MARGIN_PX);
  }

  function setTop(top: number): void {
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
    shouldStart: function(e: PointerEvent): boolean {
      var t = e && (e.target as HTMLElement);
      return !!(
        t &&
        t.closest &&
        t.closest('.toc-edge-dock-button') &&
        !t.closest('.toc-edge-dock-preview-line')
      );
    },
    getRect: function() { return toolbar.getBoundingClientRect(); },
    onStart: function() {
      toolbar.classList.add('toc-edge-dock-dragging');
    },
    onMove: function(drag: DragState, e: PointerEvent): void {
      setTop(e.clientY - drag.offsetY);
    },
    onEnd: function(drag: DragState): void {
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

  function onRootPointerLeave(e: PointerEvent): void {
    if (e && e.relatedTarget && root.contains(e.relatedTarget as Node)) return;
    if (lastPointerType !== 'touch') controller.scheduleCollapse(undefined!);
    scheduleMenuClose();
  }

  function onTocPointerEnter(e: PointerEvent): void {
    lastPointerType = (e && e.pointerType) || 'mouse';
    if (lastPointerType !== 'touch') {
      closeMenu();
      controller.peek();
    }
  }

  function onTocPointerDown(e: PointerEvent): void {
    lastPointerType = (e && e.pointerType) || 'mouse';
  }

  function onSettingsPointerEnter(e: PointerEvent): void {
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

  function onRootFocusIn(e: FocusEvent): void {
    controller.cancelCollapse();
    cancelMenuClose();
    var t = e && (e.target as HTMLElement | null);
    if (t === settingsButton) {
      openMenu();
    } else if (
      t &&
      (
        t === tocButton ||
        (t.closest && t.closest('.toc-edge-dock-preview-line'))
      )
    ) {
      closeMenu();
      controller.peek();
    }
  }

  function onRootFocusOut(e: FocusEvent): void {
    if (e && e.relatedTarget && root.contains(e.relatedTarget as Node)) return;
    controller.scheduleCollapse(undefined!);
    scheduleMenuClose();
  }

  function onRootKeydown(e: KeyboardEvent): void {
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

  function onDocumentPointerDown(e: PointerEvent): void {
    var t = e && (e.target as Node | null);
    if (!quickMenu.hidden && e && t && !root.contains(t)) closeMenu();
    if (
      lastPointerType === 'touch' &&
      controller.getMode() === 'peek' &&
      e &&
      t &&
      !root.contains(t)
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

  root.addEventListener('pointerenter', onRootPointerEnter, ac ? { signal: ac.signal } : undefined);
  root.addEventListener('pointerleave', onRootPointerLeave, ac ? { signal: ac.signal } : undefined);
  root.addEventListener('focusin', onRootFocusIn, ac ? { signal: ac.signal } : undefined);
  root.addEventListener('focusout', onRootFocusOut, ac ? { signal: ac.signal } : undefined);
  root.addEventListener('keydown', onRootKeydown, ac ? { signal: ac.signal } : undefined);
  tocButton.addEventListener('pointerenter', onTocPointerEnter, ac ? { signal: ac.signal } : undefined);
  tocButton.addEventListener('pointerdown', onTocPointerDown, ac ? { signal: ac.signal } : undefined);
  tocButton.addEventListener('click', onTocClick, ac ? { signal: ac.signal } : undefined);
  preview.addEventListener('click', onPreviewClick, ac ? { signal: ac.signal } : undefined);
  settingsButton.addEventListener('pointerenter', onSettingsPointerEnter, ac ? { signal: ac.signal } : undefined);
  settingsButton.addEventListener('click', onSettingsClick, ac ? { signal: ac.signal } : undefined);
  document.addEventListener('pointerdown', onDocumentPointerDown, ac ? { capture: true, signal: ac.signal } : true);
  window.addEventListener('resize', onResize, ac ? { passive: true, signal: ac.signal } : { passive: true });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    controller.destroy();
    try { dragController && dragController.destroy && dragController.destroy(); } catch (_) {}
    if (persistTimer) clearTimeout(persistTimer);
    cancelMenuClose();
    if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    try { ac && ac.abort && ac.abort(); } catch (_) {}
    try { root.remove(); } catch (_) {}
  }

  root.__TOC_CLEANUP__ = destroy;

  return {
    collapse: function(opts?: { focus?: boolean }) {
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
    peek: function(opts?: { autoCollapse?: boolean }) {
      closeMenu();
      controller.peek();
      if (opts && opts.autoCollapse) controller.scheduleCollapse(CFG.PROGRAMMATIC_CLOSE_DELAY_MS);
    },
    setActiveIndex: function(nextIndex: number) {
      activeIndex = Number.isFinite(nextIndex) ? nextIndex : -1;
      updatePreviewActive(activeIndex);
    },
    setItems: function(nextItems: DockItem[]) {
      dockItems = Array.isArray(nextItems) ? nextItems : [];
      if (activeIndex >= dockItems.length) activeIndex = -1;
      renderPreview();
    },
    setSide: function(nextSide: string) { updateSide(nextSide, true); }
  };
}
