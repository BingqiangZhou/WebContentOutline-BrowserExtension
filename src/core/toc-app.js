'use strict';

import { buildTocItems } from '../utils/toc-builder.js';
import { renderEdgeDock } from '../ui/edge-dock.js';
import { renderClassicCollapsedBadge } from '../ui/classic-collapsed-badge.js';
import { renderClassicFloatingPanel } from '../ui/classic-floating-panel.js';
import { createElementPicker, showPickerResult } from '../ui/element-picker.js';
import { renderFloatingPanel } from '../ui/floating-panel.js';
import { siteConfig, saveSelector, updateConfigFromStorage } from './config-manager.js';
import { createRebuildScheduler } from './rebuild-scheduler.js';
import { createActiveItemTracker } from './active-item-tracker.js';
import {
  msg,
  showToast,
  cleanupOwnedElements,
  getBadgePosByHost,
  setBadgePosByHost,
  scrollToElement,
  setPanelExpandedByOrigin
} from '../utils/toc-utils.js';
import { uiConst } from '../utils/constants.js';
import { buildClassSelector, cssPathFor } from '../utils/css-selector.js';
import {
  isContextInvalidatedError,
  isExtensionContextInvalidated
} from '../utils/core-utils.js';
import * as NL from './nav-lock.js';
import { on } from './event-bus.js';

  // Event handler for config changes
  var _activeRebuild = null;
  try {
    if (on) {
      on('toc:config-changed', function() { if (_activeRebuild) _activeRebuild(); });
    }
  } catch (_) {}

  // Constants
  var CFG = (function() {
    var get = function(name, fallback) { return (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback; };
    return {
      REBUILD_MAX_LOOPS: get('REBUILD_MAX_LOOPS', 10),
      REBUILD_COOLDOWN_MS: get('REBUILD_COOLDOWN_MS', 5000),
    };
  })();

export function initForConfig(cfg, options) {
    options = options || {};
    var uiMode = options.uiMode === 'classic' ? 'classic' : 'edge-dock';
    var onSwitchUiMode = options.onSwitchUiMode;
    var side = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';

    // Clean up any existing TOC elements from previous instances (e.g., after extension restart)
    if (cleanupOwnedElements) cleanupOwnedElements('.toc-edge-dock[data-toc-owner], .toc-floating[data-toc-owner], .toc-collapsed-badge[data-toc-owner]');

    // Per-instance rebuild flag to prevent IntersectionObserver interference
    var isRebuilding = false;
    var rebuildClearTimer = null;
    var destroyed = false;
    var clearRebuildTimers = function() {
      if (rebuildClearTimer != null) {
        clearTimeout(rebuildClearTimer);
        rebuildClearTimer = null;
      }
    };

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
    var mutationObserver = null;
    var pickerInstance = null;
    var rebuildInFlight = null;
    var rebuildQueued = false;
    var consecutiveRebuildFailures = 0;
    var generation = 0;
    var failureCooldownTimer = null;
    var configDirty = true; // true on init so first rebuild reads from storage
    cfg.__markConfigDirty = function() { configDirty = true; };

    var getNavLock = function() { return NL.isLocked(); };

    var clearRebuildFlag = function() {
      clearRebuildTimers();
      isRebuilding = false;
    };

    var isContentIdentical = function(prevItems, nextItems) {
      if (!prevItems || !nextItems) return false;
      if (prevItems.length !== nextItems.length) return false;
      for (var i = 0; i < prevItems.length; i++) {
        if (prevItems[i].text !== nextItems[i].text || prevItems[i].el !== nextItems[i].el || prevItems[i].level !== nextItems[i].level) {
          return false;
        }
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
      if (destroyed) {
        isRebuilding = false;
        return false;
      }
      // Early exit: if extension context is invalidated, stop all rebuilds
      // and show notice once on existing panel (don't re-create panel).
      if (isExtensionContextInvalidated && isExtensionContextInvalidated()) {
        clearRebuildFlag();
        if (mutationObserver && mutationObserver.disconnect) {
          try { mutationObserver.disconnect(); } catch (_) {}
        }
        // Show notice on existing panel if not already present
        if (panelInstance && !document.querySelector('.toc-ctx-invalidated-notice')) {
          try {
            var noticeEl = document.createElement('div');
            noticeEl.className = 'toc-ctx-invalidated-notice';
            noticeEl.setAttribute('role', 'alert');
            noticeEl.setAttribute('aria-live', 'assertive');
            var noticeTextEl = document.createElement('span');
            noticeTextEl.textContent = msg('ctxInvalidatedNotice') || 'Extension updated. Please refresh the page.';
            noticeEl.appendChild(noticeTextEl);
            var refreshLinkEl = document.createElement('a');
            refreshLinkEl.className = 'toc-ctx-refresh-link';
            refreshLinkEl.href = '#';
            refreshLinkEl.textContent = msg('ctxInvalidatedRefresh') || 'Refresh';
            refreshLinkEl.addEventListener('click', function(e) {
              e.preventDefault();
              try { location.reload(); } catch (_) {}
            });
            noticeEl.appendChild(refreshLinkEl);
            var panelEl = document.querySelector('.toc-floating[data-toc-owner="web-toc-assistant"]');
            var listEl = panelEl && panelEl.querySelector('.toc-list');
            if (listEl && listEl.parentNode) listEl.parentNode.insertBefore(noticeEl, listEl);
          } catch (_) {}
        }
        return;
      }
      // Circuit breaker: skip rebuild if too many consecutive failures
      if (consecutiveRebuildFailures >= 5) {
        if (!failureCooldownTimer) {
          console.warn('[toc] rebuild circuit breaker active, pausing for 5s after 5 consecutive failures');
          try {
            failureCooldownTimer = setTimeout(function() {
              failureCooldownTimer = null;
              consecutiveRebuildFailures = 0;
            }, CFG.REBUILD_COOLDOWN_MS);
          } catch (_) {
            consecutiveRebuildFailures = 0;
          }
        }
        clearRebuildFlag();
        return false;
      }
      // Set rebuild flag to prevent IntersectionObserver interference
      isRebuilding = true;
      var myGen = generation;
      try {

        if (configDirty && updateConfigFromStorage) {
          await updateConfigFromStorage(cfg);
          configDirty = false;
        }
        if (destroyed || generation !== myGen) { clearRebuildFlag(); return; }

        var prevItems = items;
        var previousActiveIndex = activeIndex;
        var previousActiveItem = items[activeIndex] || null;
        var buildResult = buildNow();
        var newItems = buildResult.items;
        var newMeta = buildResult.meta;

        // Badge mode: update in-memory items so next expand is fresh, but skip UI rebuild.
        if (!panelInstance) {
          tocMeta = newMeta;
          if (isContentIdentical(prevItems, newItems)) {
            consecutiveRebuildFailures = 0;
            clearRebuildFlag();
            return;
          }
          items = newItems;
          syncItemViews(previousActiveItem, previousActiveIndex);
          consecutiveRebuildFailures = 0;
          clearRebuildFlag();
          return;
        }

        if (getNavLock()) {
          // Do NOT swap out the active panel's items while locked; existing event handlers
          // still reference the old items array. Defer applying changes to the next rebuild.
          // Reset flag when deferring rebuild
          clearRebuildFlag();
          return;
        }

        // Skip rebuild if content is identical
        if (isContentIdentical(prevItems, newItems)) {
          // Reset flag when content is identical
          clearRebuildFlag();
          return;
        }

        // Skip rebuild if both old and new are empty - no change needed
        if (prevItems.length === 0 && newItems.length === 0) {
          clearRebuildFlag();
          return;
        }

        items = newItems;
        tocMeta = newMeta;
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
          renderPanelCard(preservedPanelPos, preservedPanelSide);
        }

        syncItemViews(previousActiveItem, previousActiveIndex);
        consecutiveRebuildFailures = 0;
      } catch (e) {
        if (isContextInvalidatedError && isContextInvalidatedError(e)) {
          console.debug('[toc] Extension context invalidated, stop TOC operations');
          try { NL.unlock(); } catch (_) {}
          try {
            items.forEach(function(it) { it._userSelected = false; });
          } catch (_) {}
          if (mutationObserver && mutationObserver.disconnect) {
            try {
              mutationObserver.disconnect();
            } catch (_) {}
          }
          return;
        }
        console.warn('[toc] rebuild failed:', e);
        consecutiveRebuildFailures++;
      } finally {
        clearRebuildFlag();
      }
    };

    var rebuild = async function() {
      if (rebuildInFlight) {
        rebuildQueued = true;
        return rebuildInFlight;
      }
      rebuildInFlight = (async function() {
        var loops = Number.isFinite(CFG.REBUILD_MAX_LOOPS) ? Math.max(1, Math.floor(CFG.REBUILD_MAX_LOOPS)) : 10;
        for (var i = 0; i < loops; i++) {
          if (destroyed) break;
          rebuildQueued = false;
          try {
            await rebuildOnce();
          } catch (e) {
            console.warn('[toc] rebuildOnce threw:', e);
          }
          if (!rebuildQueued) break;
          try { await new Promise(function(r) { setTimeout(r, 16); }); } catch (_) {}
          if (i === loops - 1 && rebuildQueued) {
            console.warn('[toc] rebuild loop capped; deferring remaining rebuild requests');
            rebuildQueued = false;
          }
        }
      })();
      try {
        return await rebuildInFlight;
      } finally {
        rebuildInFlight = null;
      }
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
          getPendingRebuild: mutationObserver ? mutationObserver.getPendingRebuild : function() { return false; },
          setPendingRebuild: mutationObserver ? mutationObserver.setPendingRebuild : function() {},
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
        getPendingRebuild: mutationObserver ? mutationObserver.getPendingRebuild : function() { return false; },
        setPendingRebuild: mutationObserver ? mutationObserver.setPendingRebuild : function() {},
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
        if (!panelInstance) renderPanelCard();
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
      generation++;
      items = [];
      rebuildInFlight = null;
      rebuildQueued = false;
      clearRebuildTimers();
      NL.destroy();
      if (failureCooldownTimer) {
        clearTimeout(failureCooldownTimer);
        failureCooldownTimer = null;
      }
      consecutiveRebuildFailures = 0;
      isRebuilding = false;
      removePanelCard();
      removeClassicBadge();
      try { if (activeTracker && activeTracker.destroy) activeTracker.destroy(); } catch (_) {}
      activeTracker = null;
      try { if (dockInstance) dockInstance.destroy(); } catch (_) {}
      dockInstance = null;
      try { if (mutationObserver && mutationObserver.disconnect) mutationObserver.disconnect(); } catch (_) {}
      mutationObserver = null;
      try {
        if (pickerInstance && pickerInstance.cleanup) {
          pickerInstance.cleanup();
        }
      } catch (_) {}
      pickerInstance = null;
      // Clear event handler
      _activeRebuild = null;
    };

    try {
      if (createRebuildScheduler) {
        mutationObserver = createRebuildScheduler(rebuild);
        mutationObserver.start(cfg);
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
            if (!isRebuilding && !getNavLock()) syncActiveIndex(index);
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
