'use strict';

import {
  msg,
  setBadgePosByHost,
  cleanupOwnedElements,
  normalizeSide
} from '../utils/toc-utils.js';
import { createDragController } from '../utils/drag-helper.js';
import { renderFloatingPanel } from './floating-panel.js';

  /** Set element to a fixed position with !important. */
  function setFixedPosition(el: HTMLElement, left: number, top: number): void {
    el.style.setProperty('left', left + 'px', 'important');
    el.style.setProperty('top', top + 'px', 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
  }

  /** Clamp position to keep element within viewport bounds. */
  function clampPanelPosition(left: number, top: number, width: number, height: number, margin: number): { left: number; top: number } {
    var maxLeft = window.innerWidth - width - margin;
    var maxTop = window.innerHeight - height - margin;
    return {
      left: Math.max(margin, Math.min(maxLeft, left)),
      top: Math.max(margin, Math.min(maxTop, top))
    };
  }

var CFG = {
  PANEL_WIDTH: 280,
  PANEL_HEIGHT: 400,
  DRAG_MARGIN_PX: 4
};

interface ClassicPanelOptions {
  side?: string;
  panelPos?: { left: number; top: number };
  anchorPos?: { x: number; y: number };
  items?: any[];
  onCollapse?: () => void;
  onSwitchUiMode?: (mode: string) => void;
  onPick?: () => void;
  onSiteConfig?: () => void;
  onRefresh?: () => void;
  [key: string]: any;
}

export function renderClassicFloatingPanel(options: ClassicPanelOptions) {
  options = options || {};
  cleanupOwnedElements('.toc-floating[data-toc-owner="web-toc-assistant"]');

  var shell = document.createElement('div');
  shell.className = 'toc-floating toc-floating-classic toc-floating-' + normalizeSide(options.side);
  shell.setAttribute('data-toc-owner', 'web-toc-assistant');
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'false');
  shell.style.setProperty('visibility', 'hidden', 'important');

  if (options.panelPos && Number.isFinite(options.panelPos.left) && Number.isFinite(options.panelPos.top)) {
    var initial = clampPanelPosition(
      options.panelPos.left,
      options.panelPos.top,
      CFG.PANEL_WIDTH,
      CFG.PANEL_HEIGHT,
      CFG.DRAG_MARGIN_PX
    );
    setFixedPosition(shell, initial.left, initial.top);
  }

  var header = document.createElement('div');
  header.className = 'toc-header';
  var headerRow = document.createElement('div');
  headerRow.className = 'toc-header-row';
  var titleGroup = document.createElement('div');
  titleGroup.className = 'toc-title-group';
  var title = document.createElement('span');
  title.className = 'toc-title';
  title.textContent = msg('tocTitle');
  title.id = 'toc-classic-panel-title-' + Math.random().toString(36).slice(2);
  shell.setAttribute('aria-labelledby', title.id);

  var btnCollapse = createAction('buttonCollapse', 'buttonCollapseTitle', function() {
    if (options.onCollapse) options.onCollapse();
  });
  btnCollapse.setAttribute('data-role', 'collapse');
  var btnSwitchToModern = createAction('classicSwitchToModern', 'classicSwitchToModernTitle', function() {
    if (options.onSwitchUiMode) options.onSwitchUiMode('edge-dock');
  });
  btnSwitchToModern.classList.add('toc-classic-switch-mode');
  titleGroup.appendChild(title);
  titleGroup.appendChild(btnSwitchToModern);
  headerRow.appendChild(titleGroup);
  headerRow.appendChild(btnCollapse);

  var actions = document.createElement('div');
  actions.className = 'toc-actions';
  var actionsLeft = document.createElement('div');
  actionsLeft.className = 'toc-actions-left';
  var actionsRight = document.createElement('div');
  actionsRight.className = 'toc-actions-right';
  actionsLeft.appendChild(createAction('buttonPickElement', 'buttonPickElementTitle', options.onPick));
  actionsLeft.appendChild(createAction('buttonSiteConfig', 'buttonSiteConfigTitle', options.onSiteConfig));
  actionsRight.appendChild(createAction('buttonRefresh', 'buttonRefreshTitle', options.onRefresh));
  actions.appendChild(actionsLeft);
  actions.appendChild(actionsRight);
  header.appendChild(headerRow);
  header.appendChild(actions);
  shell.appendChild(header);

  var panel = renderFloatingPanel({
    ...options as any,
    mountTarget: shell,
    skipAnimation: true,
    embedded: true
  } as any);
  document.documentElement.appendChild(shell);
  alignToAnchor(options.anchorPos);
  shell.style.removeProperty('visibility');

  var destroyed = false;
  var resizeRaf: number | null = null;
  var dragController = createDragController({
    element: header,
    shouldStart: function(e: PointerEvent) { return !(e.target as Element).closest('button'); },
    getRect: function() { return shell.getBoundingClientRect(); },
    onStart: function() { header.style.cursor = 'grabbing'; },
    onMove: function(drag: { offsetX: number; offsetY: number }, e: PointerEvent) {
      var width = shell.offsetWidth || CFG.PANEL_WIDTH;
      var height = shell.offsetHeight || CFG.PANEL_HEIGHT;
      var pos = clampPanelPosition(e.clientX - drag.offsetX, e.clientY - drag.offsetY, width, height, CFG.DRAG_MARGIN_PX);
      setFixedPosition(shell, pos.left, pos.top);
    },
    onEnd: function(drag: { cancelled: boolean; moved: boolean }) {
      header.style.cursor = '';
      if (!drag.cancelled && drag.moved) {
        var center = getCollapseCenter();
        if (center) setBadgePosByHost(location.host, center);
      }
    }
  });

  function createAction(labelKey: string, titleKey: string, callback: (() => void) | undefined) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'toc-btn';
    button.textContent = msg(labelKey);
    button.title = msg(titleKey) || button.textContent;
    button.setAttribute('aria-label', button.title || button.textContent);
    button.addEventListener('click', function() {
      if (callback) callback();
    });
    return button;
  }

  function getCollapseCenter() {
    if (!shell.isConnected) return null;
    var rect = btnCollapse.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: x, y: y, anchorX: x > window.innerWidth / 2 ? 'right' : 'left' };
  }

  function alignToAnchor(anchorPos: { x: number; y: number } | undefined) {
    if (!anchorPos || !Number.isFinite(anchorPos.x) || !Number.isFinite(anchorPos.y)) return;
    var center = getCollapseCenter();
    if (!center) return;
    var rect = shell.getBoundingClientRect();
    var width = shell.offsetWidth || CFG.PANEL_WIDTH;
    var height = shell.offsetHeight || CFG.PANEL_HEIGHT;
    var pos = clampPanelPosition(
      rect.left + anchorPos.x - center.x,
      rect.top + anchorPos.y - center.y,
      width,
      height,
      CFG.DRAG_MARGIN_PX
    );
    setFixedPosition(shell, pos.left, pos.top);
  }

  function onResize() {
    if (resizeRaf != null) return;
    resizeRaf = requestAnimationFrame(function() {
      resizeRaf = null;
      if (destroyed || !shell.isConnected) return;
      var rect = shell.getBoundingClientRect();
      var pos = clampPanelPosition(
        rect.left,
        rect.top,
        shell.offsetWidth || CFG.PANEL_WIDTH,
        shell.offsetHeight || CFG.PANEL_HEIGHT,
        CFG.DRAG_MARGIN_PX
      );
      setFixedPosition(shell, pos.left, pos.top);
    });
  }

  window.addEventListener('resize', onResize, { passive: true });

  function remove() {
    if (destroyed) return;
    destroyed = true;
    dragController && dragController.destroy && dragController.destroy();
    window.removeEventListener('resize', onResize);
    if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    panel && panel.remove && panel.remove();
    shell.remove();
  }

  (shell as any).__TOC_CLEANUP__ = remove;
  return {
    getCollapseCenter: getCollapseCenter,
    remove: remove,
    setActiveIndex: function(index: number) { return panel && panel.setActiveIndex && panel.setActiveIndex(index); },
    updateItems: function(items: any[], tocMeta: any) { return panel && panel.updateItems && panel.updateItems(items, tocMeta); }
  };
}
