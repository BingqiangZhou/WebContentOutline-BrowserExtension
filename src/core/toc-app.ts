
'use strict';

import { buildTocItems } from '../utils/toc-builder.js';
import { renderEdgeDock } from '../ui/edge-dock.js';
import { renderClassicCollapsedBadge } from '../ui/classic-collapsed-badge.js';
import { renderClassicFloatingPanel } from '../ui/classic-floating-panel.js';
import { createElementPicker, showPickerResult } from '../ui/element-picker.js';
import { renderFloatingPanel } from '../ui/floating-panel.js';
import { siteConfig, saveSelector, updateConfigFromStorage, setOnConfigChanged, clearOnConfigChanged } from './config-manager.js';
import { createRebuildScheduler } from './rebuild-scheduler.js';
import { createActiveItemTracker } from './active-item-tracker.js';
import {
  msg,
  showToast,
  cleanupOwnedElements,
  getBadgePosByHost,
  setBadgePosByHost,
  scrollToElement,
  setPanelExpandedByOrigin,
  invalidateScrollCaches
} from '../utils/toc-utils.js';
import { buildClassSelector, cssPathFor } from '../utils/css-selector.js';
import {
  isContextInvalidatedError,
  isExtensionContextInvalidated
} from '../utils/core-utils.js';
import * as NL from './nav-lock.js';

  // Config change callback — wired when initForConfig runs
  var _activeRebuild = null;
  try {
    if (setOnConfigChanged) {
      setOnConfigChanged(function() { if (_activeRebuild) _activeRebuild(); });
    }
  } catch (_) {}

export function initForConfig(cfg, options) {
    options = options || {};
    var uiMode = options.uiMode === 'classic' ? 'classic' : 'edge-dock';
    var onSwitchUiMode = options.onSwitchUiMode;
    var side = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';

    // Clean up any existing TOC elements from previous instances (e.g., after extension restart)
    if (cleanupOwnedElements) cleanupOwnedElements('.toc-edge-dock[data-toc-owner="web-toc-assistant"], .toc-floating[data-toc-owner="web-toc-assistant"], .toc-collapsed-badge[data-toc-owner="web-toc-assistant"]');

    var destroyed = false;

    var buildNow = function() {
      try {
        var res = buildTocItems ? buildTocItems(cfg, []) : null;
        if (res && Array.isArray(res.items)) return res;
        if (Array.isArray(res)) return { items: res, meta: null };
      } catch (e) {
        console.warn('[toc] buildTocItems error:', e);
      }
      return { items: [], meta: null };
    };

    var buildResult = buildNow();
    var items = buildResult.items;
    var tocMeta = buildResult.meta;
    var dockInstance = null;
    var badgeInstance = null;
    var panelInstance = null;
    var activeTracker = null;
    var activeIndex = -1;
    var rebuildScheduler = null;
    var pickerInstance = null;
    var rebuildInFlight = null;
    var configDirty = true; // true on init so first rebuild reads from storage
    cfg.__markConfigDirty = function() { configDirty = true; };

    var getNavLock = function() { return NL.isLocked(); };

    var isContentIdentical = function(prevItems, nextItems) {
      if (!prevItems || !nextItems || prevItems.length !== nextItems.length) return false;
      for (var i = 0; i < prevItems.length; i++) {
        if (prevItems[i].text !== nextItems[i].text || prevItems[i].el !== nextItems[i].el) return false;
      }
      return true;
    };

    var findMatchingActiveIndex = function(nextItems, previousItem, fallbackIndex) {
      if (!nextItems || !nextItems.length || !previousItem) return -1;
      var byElement = nextItems.findIndex(function(item) { return item.el === previousItem.el; });
      if (byElement >= 0) return byElement;
      var byText = nextItems.findIndex(function(item) { return item.text === previousItem.text; });
      if (byText >= 0) return byText;
      return fallbackIndex >= 0 && fallbackIndex < nextItems.length ? fallbackIndex : -1;
    };

    var syncActiveIndex = function(nextIndex) {
      activeIndex = Number.isFinite(nextIndex) && nextIndex >= 0 && nextIndex < items.length ? nextIndex : -1;
      try { if (dockInstance && dockInstance.setActiveIndex) dockInstance.setActiveIndex(activeIndex); } catch (_) {}
      try { if (panelInstance && panelInstance.setActiveIndex) panelInstance.setActiveIndex(activeIndex); } catch (_) {}
    };

    var syncItemViews = function(previousItem, previousIndex) {
      var nextActiveIndex = findMatchingActiveIndex(items, previousItem, previousIndex);
      try { if (dockInstance && dockInstance.setItems) dockInstance.setItems(items); } catch (_) {}
      try { if (activeTracker && activeTracker.setItems) activeTracker.setItems(items); } catch (_) {}
      syncActiveIndex(nextActiveIndex);
    };

    var rebuildOnce = async function() {
      if (destroyed) return false;

      // Early exit: if extension context is invalidated, stop all rebuilds
      if (isExtensionContextInvalidated && isExtensionContextInvalidated()) {
        if (rebuildScheduler && rebuildScheduler.disconnect) {
          try { rebuildScheduler.disconnect(); } catch (_) {}
        }
        // Show notice on existing panel
        if (panelInstance && !document.querySelector('[data-toc-owner="web-toc-assistant"] .toc-ctx-invalidated-notice')) {
          try {
            var noticeEl = document.createElement('div');
            noticeEl.className = 'toc-ctx-invalidated-notice';
            noticeEl.setAttribute('role', 'alert');
            var noticeSpan = document.createElement('span');
            noticeSpan.textContent = msg('ctxInvalidatedNotice') || 'Extension updated. Please refresh the page.';

            var refreshLink = document.createElement('a');
            refreshLink.className = 'toc-ctx-refresh-link';
            refreshLink.href = '#';
            refreshLink.textContent = msg('ctxInvalidatedRefresh') || 'Refresh';
            refreshLink.addEventListener('click', function(ev) {
              try { ev.preventDefault(); } catch (_) {}
              try { location.reload(); } catch (_) {}
            });

            noticeEl.appendChild(noticeSpan);
            noticeEl.appendChild(document.createTextNode(' '));
            noticeEl.appendChild(refreshLink);
            var panelEl = document.querySelector('.toc-floating[data-toc-owner="web-toc-assistant"]');
            var listEl = panelEl && panelEl.querySelector('.toc-list');
            if (listEl && listEl.parentNode) listEl.parentNode.insertBefore(noticeEl, listEl);
          } catch (_) {}
        }
        return false;
      }

      try {
        if (configDirty && updateConfigFromStorage) {
          await updateConfigFromStorage(cfg);
          configDirty = false;
        }
        if (destroyed) return true;

        var prevItems = items;
        var previousActiveIndex = activeIndex;
        var previousActiveItem = items[activeIndex] || null;
        var buildResult = buildNow();
        var newItems = buildResult.items;
        var newMeta = buildResult.meta;

        // Skip rebuild if content is identical
        if (isContentIdentical(prevItems, newItems)) return true;

        items = newItems;
        tocMeta = newMeta;

        // Invalidate scroll caches since the DOM may have changed layout
        try { invalidateScrollCaches(); } catch (_) {}

        // Badge mode: update in-memory items so next expand is fresh, but skip full UI rebuild.
        if (!panelInstance) {
          syncItemViews(previousActiveItem, previousActiveIndex);
          return true;
        }

        var incrementalDone = false;

        if (panelInstance && panelInstance.updateItems) {
          try {
            incrementalDone = panelInstance.updateItems(items, tocMeta);
          } catch (_) {
            incrementalDone = false;
          }
        }

        if (!incrementalDone) {
          var preservedPanelPos = null;
          var preservedPanelSide = null;
          if (uiMode === 'classic') {
            var classicPanelEl = document.querySelector('.toc-floating-classic[data-toc-owner="web-toc-assistant"]');
            if (classicPanelEl) {
              var classicRect = classicPanelEl.getBoundingClientRect();
              preservedPanelPos = { left: classicRect.left, top: classicRect.top };
              preservedPanelSide = classicRect.right > window.innerWidth / 2 ? 'right' : 'left';
            }
          }
          panelInstance.remove();
          panelInstance = null;
          renderPanelCard(preservedPanelPos, preservedPanelSide, null);
        }

        syncItemViews(previousActiveItem, previousActiveIndex);
      } catch (e) {
        if (isContextInvalidatedError && isContextInvalidatedError(e)) {
          console.debug('[toc] Extension context invalidated, stop TOC operations');
          try { NL.unlock(); } catch (_) {}
          try {
            items.forEach(function(it) { it._userSelected = false; });
          } catch (_) {}
          if (rebuildScheduler && rebuildScheduler.disconnect) {
            try {
              rebuildScheduler.disconnect();
            } catch (_) {}
          }
          return false;
        }
        console.warn('[toc] rebuild failed:', e);
      }
    };

    var rebuild = async function() {
      if (rebuildInFlight) return rebuildInFlight;
      rebuildInFlight = rebuildOnce().catch(function(e) {
        console.warn('[toc] rebuildOnce threw:', e);
      }).finally(function() {
        rebuildInFlight = null;
      });
      return rebuildInFlight;
    };

    var refreshConfig = function() {
      if (destroyed) return Promise.resolve(false);
      configDirty = true;
      return rebuild();
    };

    // Set up event handler for config changes
    _activeRebuild = rebuild;

    function startPick() {
      var dispatchPickerEvent = function(type) {
        try {
          window.dispatchEvent(new CustomEvent(type));
        } catch (_) {}
      };
      try {
        if (!createElementPicker || !showPickerResult) return;

        if (pickerInstance && pickerInstance.cleanup) {
          pickerInstance.cleanup();
          dispatchPickerEvent('toc-picker-end');
        }

        dispatchPickerEvent('toc-picker-start');
        pickerInstance = createElementPicker(function(el) {
          dispatchPickerEvent('toc-picker-end');
          pickerInstance = null;
          var sel = '';
          var cls = buildClassSelector ? buildClassSelector(el) : '';
          if (cls && el && el.tagName) sel = String(el.tagName).toLowerCase() + cls;
          if (!sel && cssPathFor) sel = cssPathFor(el);

          showPickerResult(sel, async function(selector, onDone) {
            try {
              var success = await saveSelector(selector, cfg);
              if (success) {
                onDone && onDone();
                await rebuild();
              } else {
                showToast && showToast(msg('errorOperationFailed'), { type: 'error' });
              }
            } catch (e) {
              if (!isContextInvalidatedError || !isContextInvalidatedError(e)) {
                console.debug('[toc] save selector failed', e);
              }
            }
          });
        }, function() {
          // canceled
          dispatchPickerEvent('toc-picker-end');
          pickerInstance = null;
        });
      } catch (e) {
        dispatchPickerEvent('toc-picker-end');
        console.debug('[toc] start element picker failed:', e);
      }
    }

    function removePanelCard() {
      if (!panelInstance) return;
      try { panelInstance.remove(); } catch (_) {}
      panelInstance = null;
    }

    function removeClassicBadge() {
      if (!badgeInstance) return;
      try { badgeInstance.remove(); } catch (_) {}
      badgeInstance = null;
    }

    function renderPanelCard(panelPos, panelSide, anchorPos) {
      if (destroyed || panelInstance) return panelInstance;
      if (uiMode === 'classic') {
        if (!renderClassicFloatingPanel) return panelInstance;
        panelInstance = renderClassicFloatingPanel({
          side: panelSide || side,
          items: items,
          onCollapse: collapse,
          onRefresh: rebuild,
          onPick: startPick,
          onSiteConfig: function() { return siteConfig && siteConfig(cfg); },
          onSwitchUiMode: onSwitchUiMode,
          getPendingRebuild: rebuildScheduler ? rebuildScheduler.getPendingRebuild : function() { return false; },
          setPendingRebuild: rebuildScheduler ? rebuildScheduler.setPendingRebuild : function() {},
          panelPos: panelPos,
          anchorPos: anchorPos,
          tocMeta: tocMeta,
          activeIndex: activeIndex,
          onNavigate: function(_item, index) { syncActiveIndex(index); }
        });
        return panelInstance;
      }
      if (!dockInstance || !renderFloatingPanel) return panelInstance;
      var currentSide = dockInstance.getSide ? dockInstance.getSide() : side;
      panelInstance = renderFloatingPanel({
        side: currentSide,
        items: items,
        onCollapse: function() { collapse({ focus: true }); },
        onRefresh: rebuild,
        getPendingRebuild: rebuildScheduler ? rebuildScheduler.getPendingRebuild : function() { return false; },
        setPendingRebuild: rebuildScheduler ? rebuildScheduler.setPendingRebuild : function() {},
        mountTarget: dockInstance.getPanelHost(),
        tocMeta: tocMeta,
        activeIndex: activeIndex,
        onNavigate: function(_item, index) { syncActiveIndex(index); },
      });
      return panelInstance;
    }

    async function onDockModeChange(next, prev) {
      try {
        if (next === 'collapsed') {
          removePanelCard();
          return;
        }

        await rebuild();
        if (!dockInstance || dockInstance.getMode() === 'collapsed') return;
        if (!panelInstance) renderPanelCard(null, null, null);
      } catch (e) {
        if (!isContextInvalidatedError || !isContextInvalidatedError(e)) {
          console.debug('[toc] dock mode update failed:', e);
        }
      }
    }

    function collapse(opts) {
      try {
        if (uiMode === 'classic') {
          var buttonCenter = panelInstance && panelInstance.getCollapseCenter ? panelInstance.getCollapseCenter() : null;
          if (buttonCenter && setBadgePosByHost) {
            try { setBadgePosByHost(location.host, buttonCenter); } catch (_) {}
          }
          removePanelCard();
          if (!badgeInstance && renderClassicCollapsedBadge) {
            badgeInstance = renderClassicCollapsedBadge(side, expand, buttonCenter);
          }
          if ((!opts || opts.persist !== false) && setPanelExpandedByOrigin) {
            setPanelExpandedByOrigin(location.origin, false);
          }
          return;
        }
        if (dockInstance) dockInstance.collapse(opts || {});
        else removePanelCard();
      } catch (e) {
        console.debug('[toc] collapse failed:', e);
      }
    }

    async function expand(opts) {
      try {
        if (uiMode === 'classic') {
          var savedPos = null;
          var expandSide = side;
          var badgeEl = document.querySelector('.toc-collapsed-badge[data-toc-owner="web-toc-assistant"]');
          if (badgeEl) {
            var rect = badgeEl.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              savedPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
          if (!savedPos && getBadgePosByHost) savedPos = await getBadgePosByHost(location.host);
          if (savedPos && Number.isFinite(savedPos.x)) {
            expandSide = savedPos.x > window.innerWidth / 2 ? 'right' : 'left';
          }
          var panelPos = null;
          if (savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)) {
            panelPos = {
              left: expandSide === 'right' ? savedPos.x - 280 : savedPos.x,
              top: savedPos.y
            };
          }
          removeClassicBadge();
          await rebuild();
          if (!panelInstance) renderPanelCard(panelPos, expandSide, savedPos);
          if (setPanelExpandedByOrigin) setPanelExpandedByOrigin(location.origin, true);
          return;
        }
        if (dockInstance) dockInstance.peek(opts || {});
      } catch (e) {
        if (!isContextInvalidatedError || !isContextInvalidatedError(e)) {
          console.debug('[toc] expand failed:', e);
        }
      }
    }

    var destroy = function() {
      destroyed = true;
      items = [];
      rebuildInFlight = null;
      NL.destroy();
      removePanelCard();
      removeClassicBadge();
      try { if (activeTracker && activeTracker.destroy) activeTracker.destroy(); } catch (_) {}
      activeTracker = null;
      try { if (dockInstance) dockInstance.destroy(); } catch (_) {}
      dockInstance = null;
      try { if (rebuildScheduler && rebuildScheduler.disconnect) rebuildScheduler.disconnect(); } catch (_) {}
      rebuildScheduler = null;
      try {
        if (pickerInstance && pickerInstance.cleanup) {
          pickerInstance.cleanup();
        }
      } catch (_) {}
      pickerInstance = null;
      // Clear config change callback
      try { if (clearOnConfigChanged) clearOnConfigChanged(); } catch (_) {}
      // Clear event handler
      _activeRebuild = null;
    };

    try {
      if (createRebuildScheduler) {
        rebuildScheduler = createRebuildScheduler(rebuild, { onConfigDirty: function() { configDirty = true; } });
        rebuildScheduler.start(cfg);
      }
      if (uiMode === 'classic') {
        collapse({ persist: false });
      } else if (renderEdgeDock) {
        dockInstance = renderEdgeDock({
          side: side,
          initialMode: 'collapsed',
          items: items,
          onModeChange: onDockModeChange,
          onRefresh: rebuild,
          onPick: startPick,
          onSiteConfig: function() { return siteConfig && siteConfig(cfg); },
          onSwitchUiMode: onSwitchUiMode,
          onNavigate: function(item, index) {
            if (!item || !item.el) return;
            syncActiveIndex(index);
            try { NL.lock(1000); } catch (_) {}
            try {
              if (scrollToElement) scrollToElement(item.el);
              else item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (_) {
              try { item.el.scrollIntoView(true); } catch (_2) {}
            }
          },
          onSideChange: function(nextSide) {
            side = nextSide;
            cfg.side = nextSide;
            removePanelCard();
          }
        });
      }
      if (createActiveItemTracker) {
        activeTracker = createActiveItemTracker({
          items: items,
          onChange: function(_item, index) {
            if (!rebuildInFlight && !getNavLock()) syncActiveIndex(index);
          }
        });
      }
      syncActiveIndex(activeIndex);

      return {
        rebuild: rebuild,
        refreshConfig: refreshConfig,
        collapse: collapse,
        expand: expand,
        destroy: destroy
      };
    } catch (e) {
      try { destroy(); } catch (_) {}
      throw e;
    }
  }
