'use strict';

import {
  msg,
  setBadgePosByHost,
  cleanupOwnedElements
} from '../utils/toc-utils.js';
import { uiConst } from '../utils/constants.js';
import { createDragController } from '../utils/drag-helper.js';
import { renderFloatingPanel } from './floating-panel.js';
import {
  setFixedPosition,
  clampPanelPosition
} from './floating-panel-helpers.js';

var CFG = (function() {
  var get = function(name, fallback) { return (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback; };
  return {
    PANEL_WIDTH: get('PANEL_WIDTH', 280),
    PANEL_HEIGHT: get('PANEL_HEIGHT', 400),
    DRAG_MARGIN_PX: get('DRAG_MARGIN_PX', 4)
  };
})();

export function renderClassicFloatingPanel(options) {
  options = options || {};
  if (cleanupOwnedElements) cleanupOwnedElements('.toc-floating[data-toc-owner="web-toc-assistant"]');

  var shell = document.createElement('div');
  shell.className = 'toc-floating toc-floating-classic toc-floating-' + (options.side === 'left' ? 'left' : 'right');
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
    try { options.onCollapse && options.onCollapse(); } catch (_) {}
  });
  btnCollapse.setAttribute('data-role', 'collapse');
  var btnSwitchToModern = createAction('classicSwitchToModern', 'classicSwitchToModernTitle', function() {
    try { options.onSwitchUiMode && options.onSwitchUiMode('edge-dock'); } catch (_) {}
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
    ...options,
    mountTarget: shell,
    skipAnimation: true,
    embedded: true
  });
  document.documentElement.appendChild(shell);
  alignToAnchor(options.anchorPos);
  shell.style.removeProperty('visibility');

  var destroyed = false;
  var resizeRaf = null;
  var dragController = createDragController ? createDragController({
    element: header,
    shouldStart: function(e) { return !e.target.closest('button'); },
    getRect: function() { return shell.getBoundingClientRect(); },
    onStart: function() { header.style.cursor = 'grabbing'; },
    onMove: function(drag, e) {
      var width = shell.offsetWidth || CFG.PANEL_WIDTH;
      var height = shell.offsetHeight || CFG.PANEL_HEIGHT;
      var pos = clampPanelPosition(e.clientX - drag.offsetX, e.clientY - drag.offsetY, width, height, CFG.DRAG_MARGIN_PX);
      setFixedPosition(shell, pos.left, pos.top);
    },
    onEnd: function(drag) {
      header.style.cursor = '';
      if (!drag.cancelled && drag.moved && setBadgePosByHost) {
        var center = getCollapseCenter();
        if (center) setBadgePosByHost(location.host, center);
      }
    }
  }) : null;

  function createAction(labelKey, titleKey, callback) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'toc-btn';
    button.textContent = msg(labelKey);
    button.title = msg(titleKey) || button.textContent;
    button.setAttribute('aria-label', button.title || button.textContent);
    button.addEventListener('click', function() {
      try { callback && callback(); } catch (_) {}
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

  function alignToAnchor(anchorPos) {
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
    try { dragController && dragController.destroy && dragController.destroy(); } catch (_) {}
    try { window.removeEventListener('resize', onResize); } catch (_) {}
    if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    try { panel && panel.remove && panel.remove(); } catch (_) {}
    try { shell.remove(); } catch (_) {}
  }

  shell.__TOC_CLEANUP__ = remove;
  return {
    getCollapseCenter: getCollapseCenter,
    remove: remove,
    setActiveIndex: function(index) { return panel && panel.setActiveIndex && panel.setActiveIndex(index); },
    updateItems: function(items, tocMeta) { return panel && panel.updateItems && panel.updateItems(items, tocMeta); },
    whenShown: panel && panel.whenShown
  };
}
