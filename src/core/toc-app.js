'use strict';

import { buildTocItems } from '../utils/toc-builder.js';
import { renderEdgeDock } from '../ui/edge-dock.js';
import { createElementPicker, showPickerResult } from '../ui/element-picker.js';
import { renderFloatingPanel } from '../ui/floating-panel.js';
import { siteConfig, saveSelector, updateConfigFromStorage } from './config-manager.js';
import { createRebuildScheduler } from './rebuild-scheduler.js';
import {
  msg,
  showToast,
  cleanupOwnedElements,
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

export function initForConfig(cfg) {
    var side = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';

    // Clean up any existing TOC elements from previous instances (e.g., after extension restart)
    if (cleanupOwnedElements) cleanupOwnedElements('.toc-edge-dock[data-toc-owner], .toc-floating[data-toc-owner]');

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
    var panelInstance = null;
    var mutationObserver = null;
    var pickerInstance = null;
    var activeRestoreTimeout = null;
    var rebuildInFlight = null;
    var rebuildQueued = false;
    var consecutiveRebuildFailures = 0;
    var generation = 0;
    var failureCooldownTimer = null;
    var configDirty = true; // true on init so first rebuild reads from storage
    cfg.__markConfigDirty = function() { configDirty = true; };

    var getNavLock = function() { return NL.isLocked(); };
    var setNavLock = function(v) { if (v) NL.lock(); else NL.unlock(); };
    var cancelActiveRestore = function() {
      if (typeof activeRestoreTimeout !== 'number') return;
      cancelAnimationFrame(activeRestoreTimeout);
      activeRestoreTimeout = null;
    };

    var clearRebuildFlag = function() {
      clearRebuildTimers();
      isRebuilding = false;
    };

    var armRebuildFailsafe = function() {
      clearRebuildTimers();
      try {
        rebuildClearTimer = setTimeout(function() { isRebuilding = false; rebuildClearTimer = null; }, 1500);
      } catch (_) {
        rebuildClearTimer = null;
      }
    };

    var isContentIdentical = function(prevItems, nextItems) {
      if (!prevItems || !nextItems) return false;
      if (prevItems.length !== nextItems.length || prevItems.length === 0) return false;
      for (var i = 0; i < prevItems.length; i++) {
        if (prevItems[i].text !== nextItems[i].text || prevItems[i].el !== nextItems[i].el) {
          return false;
        }
      }
      return true;
    };

    var getActiveSnapshot = function() {
      if (!panelInstance || items.length === 0) return null;
      var currentActiveItem = items.find(function(item) {
        if (!item || !item._node) return false;
        try {
          return item._node.classList && item._node.classList.contains('active');
        } catch (_) {
          return false;
        }
      });
      var activeItemIndex = currentActiveItem ? items.indexOf(currentActiveItem) : -1;
      return { currentActiveItem: currentActiveItem, activeItemIndex: activeItemIndex, wasLocked: getNavLock() };
    };

    var restoreActiveSnapshot = function(snapshot) {
      // Always cancel any pending restoration rAF from a previous rebuild.
      cancelActiveRestore();
      if (!snapshot || !snapshot.currentActiveItem || items.length === 0) {
        // Clear rebuild flag even if no restore happens
        clearRebuildFlag();
        return;
      }

      items.forEach(function(item) {
        if (item._node) {
          item._node.classList.remove('active');
          item._userSelected = false;
        }
      });

      var matchingItem = null;
      if (snapshot.activeItemIndex >= 0 && snapshot.activeItemIndex < items.length) {
        matchingItem = items[snapshot.activeItemIndex];
      }
      if (!matchingItem && snapshot.currentActiveItem.el) {
        matchingItem = items.find(function(item) { return item.el === snapshot.currentActiveItem.el; });
      }
      if (!matchingItem) {
        matchingItem = items.find(function(item) { return item.text === snapshot.currentActiveItem.text; });
      }
      if (!matchingItem && snapshot.activeItemIndex >= 0 && snapshot.activeItemIndex < items.length) {
        matchingItem = items[snapshot.activeItemIndex];
      }

      if (matchingItem && matchingItem._node) {
        var restoreActive = function() {
          try {
            if (matchingItem._node && document.contains(matchingItem._node)) {
              matchingItem._node.classList.add('active');
              if (snapshot.wasLocked) {
                matchingItem._userSelected = true;
                setNavLock(true);
              }
            }
          } catch (_) {}
          activeRestoreTimeout = null;
          // Clear rebuild flag directly — do not use clearRebuildFlag here
          // because it would cancel the failsafe timer that the finally block armed.
          isRebuilding = false;
        };
        activeRestoreTimeout = requestAnimationFrame(restoreActive);
      } else {
        // No matching item found, clear flag
        clearRebuildFlag();
      }
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
            if (panelEl) panelEl.insertBefore(noticeEl, panelEl.querySelector('.toc-list'));
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
        var buildResult = buildNow();
        var newItems = buildResult.items;
        var newMeta = buildResult.meta;

        // Badge mode: update in-memory items so next expand is fresh, but skip UI rebuild.
        if (!panelInstance) {
          items = newItems;
          tocMeta = newMeta;
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

        var activeSnapshot = getActiveSnapshot();
        cancelActiveRestore();

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
          panelInstance.remove();
          panelInstance = null;
          renderPanelCard();
        }

        restoreActiveSnapshot(activeSnapshot);
        consecutiveRebuildFailures = 0;
      } catch (e) {
        if (isContextInvalidatedError && isContextInvalidatedError(e)) {
          console.debug('[toc] Extension context invalidated, stop TOC operations');
          try { setNavLock(false); } catch (_) {}
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
        // If a restore is pending, arm a failsafe timer. Otherwise clear immediately.
        if (typeof activeRestoreTimeout === 'number') {
          armRebuildFailsafe();
        } else {
          clearRebuildFlag();
        }
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

    function renderPanelCard() {
      if (destroyed || panelInstance || !dockInstance || !renderFloatingPanel) return panelInstance;
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
        getIsRebuilding: function() { return isRebuilding; }
      });
      return panelInstance;
    }

    async function onDockModeChange(next, prev) {
      try {
        if (next === 'collapsed') {
          removePanelCard();
          if (prev === 'pinned' && setPanelExpandedByOrigin) {
            setPanelExpandedByOrigin(location.origin, false);
          }
          return;
        }

        await rebuild();
        if (!dockInstance || dockInstance.getMode() === 'collapsed') return;
        if (!panelInstance) renderPanelCard();
        if (next === 'pinned' && setPanelExpandedByOrigin) {
          setPanelExpandedByOrigin(location.origin, true);
        }
      } catch (e) {
        if (!isContextInvalidatedError || !isContextInvalidatedError(e)) {
          console.debug('[toc] dock mode update failed:', e);
        }
      }
    }

    function collapse(opts) {
      try {
        if (dockInstance) dockInstance.collapse(opts || {});
        else removePanelCard();
      } catch (e) {
        console.debug('[toc] collapse failed:', e);
      }
    }

    async function expand() {
      try {
        if (dockInstance) dockInstance.pin();
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
      cancelActiveRestore();
      removePanelCard();
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
      if (renderEdgeDock) {
        dockInstance = renderEdgeDock({
          side: side,
          initialMode: 'collapsed',
          onModeChange: onDockModeChange,
          onRefresh: rebuild,
          onPick: startPick,
          onSiteConfig: function() { return siteConfig && siteConfig(cfg); },
          onSideChange: function(nextSide) {
            side = nextSide;
            cfg.side = nextSide;
            removePanelCard();
          }
        });
      }

      return {
        rebuild: rebuild,
        collapse: collapse,
        expand: expand,
        destroy: destroy
      };
    } catch (e) {
      try { destroy(); } catch (_) {}
      throw e;
    }
  }
