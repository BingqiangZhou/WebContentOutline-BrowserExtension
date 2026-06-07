
'use strict';

import { buildTocItems } from '../utils/toc-builder.js';
import { renderEdgeDock } from '../ui/edge-dock.js';
import { createElementPicker, showPickerResult } from '../ui/element-picker.js';
import { renderFloatingPanel } from '../ui/floating-panel.js';
import { siteConfig, saveSelector, updateConfigFromStorage, setOnConfigChanged } from './config-manager.js';
import { createRebuildScheduler } from './rebuild-scheduler.js';
import { createActiveItemTracker } from './active-item-tracker.js';
import {
  msg,
  showToast,
  cleanupOwnedElements,
  scrollToElement,
  invalidateScrollCaches
} from '../utils/toc-utils.js';
import { buildClassSelector, cssPathFor } from '../utils/css-selector.js';
import {
  isContextInvalidatedError,
  isExtensionContextInvalidated,
  normalizeSide,
  isTocContentIdentical
} from '../utils/core-utils.js';
import { EXTENSION_OWNER } from '../utils/constants.js';

  /** Navigation lock: prevents IntersectionObserver interference during user scroll navigation. */
  interface NavLock {
    lock: (durationMs?: number) => void;
    unlock: () => void;
    isLocked: () => boolean;
    destroy: () => void;
  }

  function createNavLock(): NavLock {
    var _locked = false;
    var _timer: ReturnType<typeof setTimeout> | null = null;
    return {
      lock: function(durationMs?: number) {
        _locked = true;
        if (_timer != null) clearTimeout(_timer);
        _timer = setTimeout(function() { _timer = null; _locked = false; }, durationMs && durationMs > 0 ? durationMs : 3000);
      },
      unlock: function() {
        _locked = false;
        if (_timer != null) { clearTimeout(_timer); _timer = null; }
      },
      isLocked: function() { return _locked; },
      destroy: function() { _locked = false; if (_timer != null) { clearTimeout(_timer); _timer = null; } }
    };
  }

  // Config change callback — wired when initForConfig runs
  var _activeRebuild: (() => any) | null = null;
  setOnConfigChanged(function() { if (_activeRebuild) _activeRebuild(); });

export function initForConfig(cfg: any, options: any) {
    options = options || {};
    var onDeactivate = options.onDeactivate;
    var side: string = normalizeSide(cfg.side);

    // Clean up any existing TOC elements from previous instances (e.g., after extension restart)
    cleanupOwnedElements('.toc-edge-dock[data-toc-owner="' + EXTENSION_OWNER + '"], .toc-floating[data-toc-owner="' + EXTENSION_OWNER + '"]');

    var destroyed = false;

    var buildNow = function() {
      try {
        var res = buildTocItems(cfg, []);
        if (res && Array.isArray(res.items)) return res;
        if (Array.isArray(res)) return { items: res, meta: null };
      } catch (e) {
        console.warn('[toc] buildTocItems error:', e);
      }
      return { items: [], meta: null };
    };

    var buildResult = buildNow();
    var items: any[] = buildResult.items;
    var tocMeta: any = buildResult.meta;
    var dockInstance: any = null;
    var panelInstance: any = null;
    var activeTracker: any = null;
    var activeIndex = -1;
    var rebuildScheduler: any = null;
    var pickerInstance: any = null;
    var rebuildInFlight: Promise<any> | null = null;
    var navLock = createNavLock();
    var configDirty = true; // true on init so first rebuild reads from storage
    cfg.__markConfigDirty = function() { configDirty = true; };

    var findMatchingActiveIndex = function(nextItems: any[], previousItem: any, fallbackIndex: number) {
      if (!nextItems || !nextItems.length || !previousItem) return -1;
      var byElement = nextItems.findIndex(function(item: any) { return item.el === previousItem.el; });
      if (byElement >= 0) return byElement;
      var byText = nextItems.findIndex(function(item: any) { return item.text === previousItem.text; });
      if (byText >= 0) return byText;
      return fallbackIndex >= 0 && fallbackIndex < nextItems.length ? fallbackIndex : -1;
    };

    var syncActiveIndex = function(nextIndex: number) {
      activeIndex = Number.isFinite(nextIndex) && nextIndex >= 0 && nextIndex < items.length ? nextIndex : -1;
      if (dockInstance && dockInstance.setActiveIndex) dockInstance.setActiveIndex(activeIndex);
      if (panelInstance && panelInstance.setActiveIndex) panelInstance.setActiveIndex(activeIndex);
    };

    var syncItemViews = function(previousItem: any, previousIndex: number) {
      var nextActiveIndex = findMatchingActiveIndex(items, previousItem, previousIndex);
      if (dockInstance && dockInstance.setItems) dockInstance.setItems(items);
      if (activeTracker && activeTracker.setItems) activeTracker.setItems(items);
      syncActiveIndex(nextActiveIndex);
    };

    var rebuildOnce = async function() {
      if (destroyed) return false;

      // Early exit: if extension context is invalidated, stop all rebuilds
      if (isExtensionContextInvalidated()) {
        if (rebuildScheduler && rebuildScheduler.disconnect) {
          rebuildScheduler.disconnect();
        }
        // Show notice on existing panel
        if (panelInstance && !document.querySelector('[data-toc-owner="' + EXTENSION_OWNER + '"] .toc-ctx-invalidated-notice')) {
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
              ev.preventDefault();
              location.reload();
            });

            noticeEl.appendChild(noticeSpan);
            noticeEl.appendChild(document.createTextNode(' '));
            noticeEl.appendChild(refreshLink);
            var panelEl = document.querySelector('.toc-floating[data-toc-owner="' + EXTENSION_OWNER + '"]');
            var listEl = panelEl && panelEl.querySelector('.toc-list');
            if (listEl && listEl.parentNode) listEl.parentNode.insertBefore(noticeEl, listEl);
          } catch (_) {}
        }
        return false;
      }

      try {
        if (configDirty) {
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
        if (isTocContentIdentical(prevItems, newItems)) return true;

        items = newItems;
        tocMeta = newMeta;

        // Invalidate scroll caches since the DOM may have changed layout
        invalidateScrollCaches();

        // No panel yet: update in-memory items so next expand is fresh, but skip full UI rebuild.
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
          panelInstance.remove();
          panelInstance = null;
          renderPanelCard();
        }

        syncItemViews(previousActiveItem, previousActiveIndex);
      } catch (e) {
        if (isContextInvalidatedError(e)) {
          console.debug('[toc] Extension context invalidated, stop TOC operations');
          navLock.unlock();
          items.forEach(function(it: any) { it._userSelected = false; });
          if (rebuildScheduler && rebuildScheduler.disconnect) {
            rebuildScheduler.disconnect();
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
      var dispatchPickerEvent = function(type: string) {
        try {
          window.dispatchEvent(new CustomEvent(type));
        } catch (_) {}
      };
      try {
        if (pickerInstance && pickerInstance.cleanup) {
          pickerInstance.cleanup();
          dispatchPickerEvent('toc-picker-end');
        }

        dispatchPickerEvent('toc-picker-start');
        pickerInstance = createElementPicker(function(el: any) {
          dispatchPickerEvent('toc-picker-end');
          pickerInstance = null;
          var sel = '';
          var cls = buildClassSelector(el);
          if (cls && el && el.tagName) sel = String(el.tagName).toLowerCase() + cls;
          if (!sel) sel = cssPathFor(el);

          showPickerResult(sel, async function(selector: string, onDone?: () => void) {
            try {
              var success = await saveSelector(selector, cfg);
              if (success) {
                onDone && onDone();
                await rebuild();
              } else {
                showToast(msg('errorOperationFailed'), { type: 'error' });
              }
            } catch (e) {
              if (!isContextInvalidatedError(e)) {
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
      panelInstance.remove();
      panelInstance = null;
    }

    function renderPanelCard() {
      if (destroyed || panelInstance) return panelInstance;
      if (!dockInstance) return panelInstance;
      var currentSide = dockInstance.getSide ? dockInstance.getSide() : side;
      panelInstance = renderFloatingPanel({
        navLock: navLock,
        side: currentSide,
        items: items,
        onCollapse: function() { collapse({ focus: true }); },
        onRefresh: rebuild,
        getPendingRebuild: rebuildScheduler ? rebuildScheduler.getPendingRebuild : function() { return false; },
        setPendingRebuild: rebuildScheduler ? rebuildScheduler.setPendingRebuild : function() {},
        mountTarget: dockInstance.getPanelHost(),
        tocMeta: tocMeta,
        activeIndex: activeIndex,
        onNavigate: function(_item: any, index: number) { syncActiveIndex(index); },
      });
      return panelInstance;
    }

    async function onDockModeChange(next: string, prev: string) {
      try {
        if (next === 'collapsed') {
          removePanelCard();
          return;
        }

        await rebuild();
        if (!dockInstance || dockInstance.getMode() === 'collapsed') return;
        if (!panelInstance) renderPanelCard();
      } catch (e) {
        if (!isContextInvalidatedError(e)) {
          console.debug('[toc] dock mode update failed:', e);
        }
      }
    }

    function collapse(opts?: any) {
      try {
        if (dockInstance) dockInstance.collapse(opts || {});
        else removePanelCard();
      } catch (e) {
        console.debug('[toc] collapse failed:', e);
      }
    }

    async function expand(opts?: any) {
      try {
        if (dockInstance) dockInstance.peek(opts || {});
      } catch (e) {
        if (!isContextInvalidatedError(e)) {
          console.debug('[toc] expand failed:', e);
        }
      }
    }

    var destroy = function() {
      destroyed = true;
      items = [];
      rebuildInFlight = null;
      navLock.destroy();
      removePanelCard();
      if (activeTracker && activeTracker.destroy) activeTracker.destroy();
      activeTracker = null;
      if (dockInstance) dockInstance.destroy();
      dockInstance = null;
      if (rebuildScheduler && rebuildScheduler.disconnect) rebuildScheduler.disconnect();
      rebuildScheduler = null;
      if (pickerInstance && pickerInstance.cleanup) {
        pickerInstance.cleanup();
      }
      pickerInstance = null;
      // Do NOT call clearOnConfigChanged() here — the module-level callback
      // registered at line 55 guards with `if (_activeRebuild)`, and setting
      // _activeRebuild = null below makes it a safe no-op. Clearing would break
      // config change notifications after reinit (disable → re-enable cycle).
      // Clear event handler
      _activeRebuild = null;
    };

    try {
      rebuildScheduler = createRebuildScheduler(rebuild, { onConfigDirty: function() { configDirty = true; }, navLock: navLock });
      rebuildScheduler.start(cfg);
      dockInstance = renderEdgeDock({
        side: side,
        initialMode: 'collapsed',
        items: items,
        onModeChange: onDockModeChange,
        onRefresh: rebuild,
        onPick: startPick,
        onSiteConfig: function() { return siteConfig(cfg); },
        onDeactivate: onDeactivate,
        onNavigate: function(item: any, index: number) {
          if (!item || !item.el) return;
          syncActiveIndex(index);
          navLock.lock(1000);
          scrollToElement(item.el);
        },
        onSideChange: function(nextSide: string) {
          side = nextSide;
          cfg.side = nextSide;
          removePanelCard();
        }
      });
      activeTracker = createActiveItemTracker({
        items: items,
        onChange: function(_item: any, index: number) {
          if (!rebuildInFlight && !navLock.isLocked()) syncActiveIndex(index);
        }
      });
      syncActiveIndex(activeIndex);

      return {
        rebuild: rebuild,
        refreshConfig: refreshConfig,
        collapse: collapse,
        expand: expand,
        destroy: destroy
      };
    } catch (e) {
      destroy();
      throw e;
    }
  }
