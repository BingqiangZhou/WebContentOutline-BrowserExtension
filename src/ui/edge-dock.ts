
'use strict';

import { msg, getBadgePosByHost, setBadgePosByHost, cleanupOwnedElements, normalizeSide } from '../utils/toc-utils.js';
import { createDragController, DragState } from '../utils/drag-helper.js';
import { EXTENSION_OWNER } from '../utils/constants.js';

var SVG_NS = 'http://www.w3.org/2000/svg';

var CFG = {
  CLOSE_DELAY_MS: 250,
  PROGRAMMATIC_CLOSE_DELAY_MS: 1800,
  SAFE_MARGIN_PX: 12,
  DEFAULT_TOP_MIN: 120,
  DEFAULT_HEIGHT: 75
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
  el?: Element;
  text: string;
  level: number;
  source?: string;
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
    if (onChange) onChange(next, prev);
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
  onSideChange?: (side: string) => void;
  onModeChange?: (next: string, prev: string, info?: { keyboard?: boolean }) => void;
  onDeactivate?: () => void;
}

export function renderEdgeDock(options: EdgeDockOptions) {
  options = options || {};
  cleanupOwnedElements('.toc-edge-dock[data-toc-owner="' + EXTENSION_OWNER + '"]');

  var side: string = normalizeSide(options.side);
  var destroyed = false;
  var lastPointerType: string = 'mouse';
  var suppressClick = false;
  var persistTimer: ReturnType<typeof setTimeout> | null = null;
  var resizeRaf: number | null = null;
  var menuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  var dockItems: DockItem[] = Array.isArray(options.items) ? options.items : [];
  var activeIndex = -1;
  // Tracks whether the most recent input was keyboard (vs pointer), so a
  // keyboard-driven expansion can move focus into the panel (a11y) without
  // stealing focus on hover.
  var lastInputWasKeyboard = false;

  var root = document.createElement('aside');
  var ac = new AbortController();
  root.className = 'toc-edge-dock toc-edge-dock-' + side;
  root.setAttribute('data-toc-owner', EXTENSION_OWNER);
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
  // This element toggles the TOC panel on Enter/Space and carries
  // aria-expanded/aria-controls, so role="button" is the correct semantics
  // (role="group" announced it as a passive container to AT).
  tocButton.setAttribute('role', 'button');
  tocButton.setAttribute('aria-label', msg('dockLabel') || 'TOC tools');
  var preview = document.createElement('span');
  preview.className = 'toc-edge-dock-preview';
  // The preview lines inside are the interactive bits; the wrapper is decorative.
  preview.setAttribute('role', 'presentation');
  tocButton.replaceChildren(preview);
  tocButton.setAttribute('aria-controls', panelHost.id);
  tocButton.setAttribute('aria-expanded', 'false');

  // Track the current preview window to enable incremental active-class updates
  var previewWindowStart = -1;
  var previewWindowSize = 0;

  function renderPreview() {
    preview.replaceChildren();
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
      if (index === activeIndex) {
        line.classList.add('toc-edge-dock-preview-line-active');
        line.setAttribute('aria-current', 'location');
      }
      line.dataset.level = String(Math.max(1, Math.min(6, Number(item && item.level) || 2)));
      if (item && item.source) line.dataset.source = item.source;
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
        child.setAttribute('aria-current', 'location');
      } else {
        child.classList.remove('toc-edge-dock-preview-line-active');
        child.removeAttribute('aria-current');
      }
    }
  }
  renderPreview();

  function navigatePreviewItem(index: number): void {
    var item = dockItems[index];
    if (!item) return;
    options.onNavigate && options.onNavigate(item, index);
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

  function openMenu(focusFirst?: boolean) {
    cancelMenuClose();
    controller.collapse();
    quickMenu.hidden = false;
    settingsButton.setAttribute('aria-expanded', 'true');
    if (focusFirst) {
      // Move focus to the first menu item when opened via keyboard or click
      // (the role="menu" contract) — NOT on hover, which would steal focus.
      try {
        var first = quickMenu.querySelector('[role="menuitem"]') as HTMLElement | null;
        if (first) first.focus();
      } catch (_) {}
    }
  }

  function runMenuAction(callback: (() => void) | undefined): void {
    closeMenu();
    if (callback) callback();
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
  createMenuButton('dockDeactivate', 'Close TOC', function() {
    options.onDeactivate && options.onDeactivate();
  });

  var controller = createDockStateController({
    initialMode: options.initialMode,
    closeDelayMs: options.closeDelayMs,
    onChange: function(next: string, prev: string): void {
      root.setAttribute('data-mode', next);
      tocButton.setAttribute('aria-expanded', next === 'collapsed' ? 'false' : 'true');
      panelHost.hidden = next === 'collapsed';
      // Signal whether this expansion was keyboard-driven so the app can move
      // focus into the panel. Only meaningful when expanding (peek).
      var info = next !== 'collapsed' ? { keyboard: lastInputWasKeyboard } : undefined;
      options.onModeChange && options.onModeChange(next, prev, info);
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
      options.onSideChange && options.onSideChange(side);
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
    var y = centerY();
    var x = side === 'left' ? 0 : window.innerWidth;
    setBadgePosByHost(location.host, { x: x, y: y, anchorX: side });
  }

  async function restorePosition() {
    var fallbackTop = Math.max(CFG.DEFAULT_TOP_MIN, window.innerHeight / 4);
    setTop(fallbackTop);
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

  var dragController = createDragController({
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
  });

  function onRootPointerEnter() {
    controller.cancelCollapse();
    cancelMenuClose();
  }

  function onRootPointerLeave(e: PointerEvent): void {
    if (e && e.relatedTarget && root.contains(e.relatedTarget as Node)) return;
    if (lastPointerType !== 'touch') controller.scheduleCollapse();
    scheduleMenuClose();
  }

  function onTocPointerEnter(e: PointerEvent): void {
    lastPointerType = (e && e.pointerType) || 'mouse';
    lastInputWasKeyboard = false;
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
    lastInputWasKeyboard = false;
    if (lastPointerType !== 'touch') openMenu();
  }

  function onTocClick() {
    if (suppressClick || lastPointerType !== 'touch') return;
    closeMenu();
    controller.activate();
  }

  function onSettingsClick() {
    if (suppressClick) return;
    openMenu(true);
  }

  function onRootFocusIn(e: FocusEvent): void {
    controller.cancelCollapse();
    cancelMenuClose();
    var t = e && (e.target as HTMLElement | null);
    if (t === settingsButton) {
      openMenu(true);
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
    controller.scheduleCollapse();
    scheduleMenuClose();
  }

  function onRootKeydown(e: KeyboardEvent): void {
    lastInputWasKeyboard = true;
    if (e && (e.key === 'Enter' || e.key === ' ') && e.target === tocButton) {
      e.preventDefault();
      onTocClick();
      return;
    }
    // role="menu" arrow-key navigation between items (the menu contract).
    if (e && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      var kt = e.target as HTMLElement | null;
      var menuItem = kt && kt.closest ? kt.closest('[role="menuitem"]') as HTMLElement | null : null;
      if (menuItem && quickMenu.contains(menuItem)) {
        e.preventDefault();
        var menuItems = Array.prototype.slice.call(quickMenu.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
        if (menuItems.length) {
          var cur = menuItems.indexOf(menuItem);
          var nextIdx = e.key === 'ArrowDown' ? (cur + 1) % menuItems.length : (cur - 1 + menuItems.length) % menuItems.length;
          menuItems[nextIdx].focus();
        }
        return;
      }
    }
    if (!e || e.key !== 'Escape') return;
    if (!quickMenu.hidden) {
      closeMenu();
      settingsButton.focus();
      return;
    }
    controller.collapse();
    tocButton.focus();
  }

  function onDocumentPointerDown(e: PointerEvent): void {
    lastInputWasKeyboard = false;
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

  root.addEventListener('pointerenter', onRootPointerEnter, { signal: ac.signal });
  root.addEventListener('pointerleave', onRootPointerLeave, { signal: ac.signal });
  root.addEventListener('focusin', onRootFocusIn, { signal: ac.signal });
  root.addEventListener('focusout', onRootFocusOut, { signal: ac.signal });
  root.addEventListener('keydown', onRootKeydown, { signal: ac.signal });
  tocButton.addEventListener('pointerenter', onTocPointerEnter, { signal: ac.signal });
  tocButton.addEventListener('pointerdown', onTocPointerDown, { signal: ac.signal });
  tocButton.addEventListener('click', onTocClick, { signal: ac.signal });
  preview.addEventListener('click', onPreviewClick, { signal: ac.signal });
  settingsButton.addEventListener('pointerenter', onSettingsPointerEnter, { signal: ac.signal });
  settingsButton.addEventListener('click', onSettingsClick, { signal: ac.signal });
  document.addEventListener('pointerdown', onDocumentPointerDown, { capture: true, signal: ac.signal });
  window.addEventListener('resize', onResize, { passive: true, signal: ac.signal });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    controller.destroy();
    dragController.destroy();
    if (persistTimer) clearTimeout(persistTimer);
    cancelMenuClose();
    if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    ac.abort();
    root.remove();
  }

  root.__TOC_CLEANUP__ = destroy;

  return {
    collapse: function(opts?: { focus?: boolean }) {
      closeMenu();
      controller.collapse();
      if (opts && opts.focus) {
        tocButton.focus();
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
