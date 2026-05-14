define('toc-app', ['toc-builder', 'collapsed-badge', 'element-picker', 'floating-panel', 'config-manager', 'rebuild-scheduler', 'toc-constants', 'css-selector'],
  function(tocBuilder, collapsedBadge, elementPickerMod, floatingPanel, configManager, schedulerMod, C, cssSelector) {
  'use strict';

  var buildTocItems = tocBuilder.buildTocItems;
  var renderCollapsedBadge = collapsedBadge.renderCollapsedBadge;
  var renderFloatingPanel = floatingPanel.renderFloatingPanel;
  var createElementPicker = elementPickerMod.createElementPicker;
  var showPickerResult = elementPickerMod.showPickerResult;
  var siteConfig = configManager.siteConfig;
  var saveSelector = configManager.saveSelector;
  var updateConfigFromStorage = configManager.updateConfigFromStorage;
  var createRebuildScheduler = schedulerMod.createRebuildScheduler;
  var buildClassSelector = cssSelector.buildClassSelector;
  var cssPathFor = cssSelector.cssPathFor;
  var uiConst = C.uiConst;

  // Event handler for config changes
  var _activeRebuild = null;
  try {
    var on = (typeof require === 'function') ? require('loader').on : null;
    if (on) {
      on('toc:config-changed', function() { if (_activeRebuild) _activeRebuild(); });
    }
  } catch (_) {}

  // Constants
  var CFG = (function() {
    var get = function(name, fallback) { return (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback; };
    return {
      PANEL_WIDTH: get('PANEL_WIDTH', 280),
      PANEL_HEIGHT: get('PANEL_HEIGHT', 400),
      BUTTON_OFFSET: get('BUTTON_OFFSET', 20),
      DRAG_MARGIN_PX: get('DRAG_MARGIN_PX', 4),
      NAV_LOCK_FAILSAFE_MS: get('NAV_LOCK_FAILSAFE_MS', 3000),
      REBUILD_MAX_LOOPS: get('REBUILD_MAX_LOOPS', 10),
      REBUILD_COOLDOWN_MS: get('REBUILD_COOLDOWN_MS', 5000),
    };
  })();

  var isContextInvalidatedError = null;
  try {
    var coreUtils = (typeof require === 'function') ? require('core-utils') : null;
    isContextInvalidatedError = coreUtils && coreUtils.isContextInvalidatedError;
  } catch (_) {}

  function initForConfig(cfg) {
    var side = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';

    // Clean up any existing TOC elements from previous instances (e.g., after extension restart)
    try {
      document.querySelectorAll('.toc-collapsed-badge[data-toc-owner], .toc-floating[data-toc-owner]').forEach(function(el) {
        try {
          var cleanup = el && el.__TOC_CLEANUP__;
          if (typeof cleanup === 'function') cleanup();
        } catch (_) {}
        try { el.remove(); } catch (_) {}
      });
    } catch (_) {}

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
    var badgeInstance = null;
    var panelInstance = null;
    var panelSide = null;
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

    var NL = (typeof require === 'function') ? require('nav-lock') : globalThis.NAV_LOCK;
    var getNavLock = function() { return NL.isLocked(); };
    var setNavLock = function(v) { if (v) NL.lock(); else NL.unlock(); };
    var cancelActiveRestore = function() {
      if (typeof activeRestoreTimeout !== 'number') return;
      cancelAnimationFrame(activeRestoreTimeout);
      activeRestoreTimeout = null;
    };

    // Helper to constrain position to screen bounds
    var constrainPosition = function(left, top, width, height) {
      width = width || CFG.PANEL_WIDTH;
      height = height || CFG.PANEL_HEIGHT;
      var maxLeft = window.innerWidth - width - CFG.DRAG_MARGIN_PX;
      var maxTop = window.innerHeight - height - CFG.DRAG_MARGIN_PX;
      return {
        left: Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxLeft, left)),
        top: Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxTop, top))
      };
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
        var panelPos = null;
        var rebuildSide = 'right';
        var currentPanelEl = document.querySelector('.toc-floating[data-toc-owner="web-toc-assistant"]');
        if (currentPanelEl) {
          var rect = currentPanelEl.getBoundingClientRect();
          rebuildSide = rect.right > (window.innerWidth / 2) ? 'right' : 'left';
          panelPos = { left: rect.left, top: rect.top };
        }

        // Use incremental update when panel exists and side hasn't changed.
        var sideUnchanged = panelSide === rebuildSide;
        var incrementalDone = false;

        if (panelInstance && panelInstance.updateItems && sideUnchanged) {
          try {
            incrementalDone = panelInstance.updateItems(items, tocMeta);
          } catch (_) {
            incrementalDone = false;
          }
        }

        if (!incrementalDone) {
          panelInstance.remove();
          panelInstance = renderFloatingPanel ? renderFloatingPanel({
            side: rebuildSide,
            items: items,
            onCollapse: collapse,
            onRefresh: rebuild,
            onPick: startPick,
            onSiteConfig: function() { return siteConfig && siteConfig(cfg); },
            getPendingRebuild: mutationObserver ? mutationObserver.getPendingRebuild : function() { return false; },
            setPendingRebuild: mutationObserver ? mutationObserver.setPendingRebuild : function() {},
            panelPos: panelPos,
            tocMeta: tocMeta,
            getIsRebuilding: function() { return isRebuilding; }
          }) : null;
          panelSide = rebuildSide;
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

    function collapse() {
      try {
        // Get collapse button center position
        var buttonCenter = null;
        var collapseBtn = document.querySelector('.toc-floating[data-toc-owner="web-toc-assistant"] [data-role="collapse"]');
        if (collapseBtn) {
          var rect = collapseBtn.getBoundingClientRect();
          var x = rect.left + rect.width / 2;
          var y = rect.top + rect.height / 2;
          if (Number.isFinite(x) && Number.isFinite(y)) {
            buttonCenter = { x: x, y: y };
            try {
              var setBadgePosByHost = (typeof require === 'function') ? require('toc-utils').setBadgePosByHost : null;
              if (setBadgePosByHost) setBadgePosByHost(location.host, buttonCenter);
            } catch (_) {}
          }
        }

        if (panelInstance) {
          panelInstance.remove();
          panelInstance = null;
          panelSide = null;
        }

        if (!badgeInstance && renderCollapsedBadge) {
          badgeInstance = renderCollapsedBadge(side, expand, buttonCenter);
        }
        try {
          var setPanelExpandedByOrigin = (typeof require === 'function') ? require('toc-utils').setPanelExpandedByOrigin : null;
          if (setPanelExpandedByOrigin) setPanelExpandedByOrigin(location.origin, false);
        } catch (_) {}
      } catch (e) {
        console.debug('[toc] collapse failed:', e);
      }
    }

    async function expand() {
      try {
        var expandSide = 'right';
        var savedPos = null;
        var panelPos = null;

        // Prefer the live badge position if present (avoids stale storage during/after resize).
        // Read-only: do NOT save to storage here to prevent cumulative drift from
        // viewport changes between save and restore (e.g. scrollbar toggling).
        try {
          var badgeEl = document.querySelector('.toc-collapsed-badge[data-toc-owner="web-toc-assistant"]');
          if (badgeEl) {
            var r = badgeEl.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
              var x = r.left + r.width / 2;
              var y = r.top + r.height / 2;
              if (Number.isFinite(x) && Number.isFinite(y)) {
                savedPos = { x: x, y: y };
                expandSide = x > (window.innerWidth / 2) ? 'right' : 'left';
              }
            }
          }
        } catch (_) {}

        // Get saved badge center position
        var getBadgePosByHost = null;
        try {
          getBadgePosByHost = (typeof require === 'function') ? require('toc-utils').getBadgePosByHost : null;
        } catch (_) {}

        if (getBadgePosByHost) {
          if (!savedPos || !Number.isFinite(savedPos.x) || !Number.isFinite(savedPos.y)) {
            savedPos = await getBadgePosByHost(location.host);
          }
          if (savedPos && Number.isFinite(savedPos.x)) {
            expandSide = savedPos.x > (window.innerWidth / 2) ? 'right' : 'left';

            // Estimate initial panel position (will be refined after measurement)
            var panelLeft;
            if (expandSide === 'right') {
              panelLeft = savedPos.x - CFG.PANEL_WIDTH;
            } else {
              panelLeft = savedPos.x;
            }
            var panelTop = Number.isFinite(savedPos.y) ? savedPos.y : 120;
            panelPos = { left: panelLeft, top: panelTop };
          }
        }

        // Remove badge
        if (badgeInstance) {
          badgeInstance.remove();
          badgeInstance = null;
        }

        await rebuild();

        if (renderFloatingPanel && !panelInstance) {
          panelInstance = renderFloatingPanel({
            side: expandSide,
            items: items,
            onCollapse: collapse,
            onRefresh: rebuild,
            onPick: startPick,
            onSiteConfig: function() { return siteConfig && siteConfig(cfg); },
            getPendingRebuild: mutationObserver ? mutationObserver.getPendingRebuild : function() { return false; },
            setPendingRebuild: mutationObserver ? mutationObserver.setPendingRebuild : function() {},
            panelPos: panelPos,
            tocMeta: tocMeta,
            skipAnimation: !!savedPos,
            getIsRebuilding: function() { return isRebuilding; }
          });
          panelSide = expandSide;
        }

        // Measure collapse button in the hidden panel and align it to saved badge center
        if (savedPos && panelInstance && panelInstance.measureCollapseButton) {
          try {
            var btnRect = panelInstance.measureCollapseButton();
            if (btnRect && Number.isFinite(btnRect.left)) {
              var btnCenterX = btnRect.left + btnRect.width / 2;
              var btnCenterY = btnRect.top + btnRect.height / 2;
              var offsetX = Number.isFinite(savedPos.x) ? (savedPos.x - btnCenterX) : 0;
              var offsetY = Number.isFinite(savedPos.y) ? (savedPos.y - btnCenterY) : 0;

              if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
                var panelEl = document.querySelector('.toc-floating[data-toc-owner="web-toc-assistant"]');
                if (panelEl) {
                  var rect = panelEl.getBoundingClientRect();
                  var pw = panelEl.offsetWidth || CFG.PANEL_WIDTH;
                  var ph = panelEl.offsetHeight || CFG.PANEL_HEIGHT;
                  var constrained = constrainPosition(rect.left + offsetX, rect.top + offsetY, pw, ph);

                  panelEl.style.setProperty('left', constrained.left + 'px', 'important');
                  panelEl.style.setProperty('top', constrained.top + 'px', 'important');
                  panelEl.style.setProperty('right', 'auto', 'important');
                  panelEl.style.setProperty('bottom', 'auto', 'important');
                }
              }
            }
          } catch (_) {}
        }

        try {
          var setPanelExpandedByOrigin = (typeof require === 'function') ? require('toc-utils').setPanelExpandedByOrigin : null;
          if (setPanelExpandedByOrigin) setPanelExpandedByOrigin(location.origin, true);
        } catch (_) {}
      } catch (e) {
        if (!isContextInvalidatedError || !isContextInvalidatedError(e)) {
          console.debug('[toc] expand failed:', e);
        }
      }
    }

    var isRebuildingFn = function() { return isRebuilding; };

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
      try { if (badgeInstance) badgeInstance.remove(); } catch (_) {}
      badgeInstance = null;
      try { if (panelInstance) panelInstance.remove(); } catch (_) {}
      panelInstance = null;
      panelSide = null;
      try { if (mutationObserver && mutationObserver.disconnect) mutationObserver.disconnect(); } catch (_) {}
      mutationObserver = null;
      try {
        if (pickerInstance && pickerInstance.cleanup) {
          pickerInstance.cleanup();
        }
      } catch (_) {}
      pickerInstance = null;
      try {
        var TOC_APP = window.TOC_APP;
        if (TOC_APP.rebuild === rebuild) TOC_APP.rebuild = null;
        if (TOC_APP.isRebuilding === isRebuildingFn) TOC_APP.isRebuilding = null;
      } catch (_) {}
      try { window.__TOC_APP_LOADED__ = false; } catch (_) {}

      // Clear event handler
      _activeRebuild = null;
    };

    try {
      if (createRebuildScheduler) {
        mutationObserver = createRebuildScheduler(rebuild);
        mutationObserver.start(cfg);
      }

      var TOC_APP = window.TOC_APP || (window.TOC_APP = {});
      TOC_APP.rebuild = rebuild;
      TOC_APP.isRebuilding = isRebuildingFn;

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

  var api = { initForConfig: initForConfig };
  try { window.TOC_APP = window.TOC_APP || {}; window.TOC_APP.initForConfig = initForConfig; } catch (_) {}
  return api;
});
