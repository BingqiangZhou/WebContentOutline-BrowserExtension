
'use strict';

import { buildTocItems } from '../utils/toc-builder.js';
import { renderEdgeDock } from '../ui/edge-dock.js';
import { createElementPicker, showPickerResult } from '../ui/element-picker.js';
import { renderFloatingPanel } from '../ui/floating-panel.js';
import { siteConfig, saveSelector, updateConfigFromStorage, setOnConfigChanged } from './config-manager.js';
import { createRebuildScheduler } from './rebuild-scheduler.js';
import { createActiveItemTracker } from './active-item-tracker.js';
import { createNavLock, NAV_LOCK_MS } from './nav-lock.js';
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
  isTocContentIdentical,
  debug
} from '../utils/core-utils.js';
import { EXTENSION_OWNER } from '../utils/constants.js';
import { getTocShadowRootSync } from '../ui/shadow-root.js';

  /** Navigation lock: prevents IntersectionObserver interference during user scroll navigation. */
  // (createNavLock + NavLock interface now live in ./nav-lock.js)

  // --- Orchestrator types ---

  /** A TOC heading item. `el` is the source heading; the rest is derived state.
   *  Components (dock/panel/tracker) consume subsets of these fields. */
  interface TocItem {
    id: string;
    el: Element;
    text: string;
    level: number;
    source?: string;
    _userSelected?: boolean;
  }

  interface TocMeta { truncated: boolean; maxItems: number; totalCandidates: number; }

  /** Per-site config handed to the orchestrator. `selectors` is normalized to an
   *  array by the time it arrives, but typed optional to match the upstream
   *  config-manager / findMatchingConfig contracts. */
  interface TocAppConfig {
    selectors?: Array<{ type: string; expr: string }>;
    __markConfigDirty?: () => void;
  }

  interface TocAppOptions { onDeactivate?: () => void; }

  // Live rebuild callbacks for all active instances. A single module-level
  // fan-out callback is registered once; each initForConfig adds its own
  // config refresh and destroy() removes it. This survives any destroy/reinit
  // interleaving (e.g. a rapid disable → re-enable, or a reinject racing the
  // prior destroy) without one instance clobbering another's hook.
  var liveRebuilds = new Set<() => unknown>();
  setOnConfigChanged(function() { liveRebuilds.forEach(function(fn) { try { fn(); } catch (_) {} }); });

  // Where the dock sits before it has restored its saved position. The side is
  // a per-host preference the dock itself saves (tocBadgePosMap.anchorX) and
  // restores when it is created — it is not part of the site config.
  const DEFAULT_DOCK_SIDE = 'right';

export function initForConfig(cfg: TocAppConfig, options: TocAppOptions) {
    options = options || {};
    var onDeactivate = options.onDeactivate;

    // Clean up any existing TOC elements from previous instances (e.g., after extension restart)
    cleanupOwnedElements('.toc-edge-dock[data-toc-owner="' + EXTENSION_OWNER + '"], .toc-floating[data-toc-owner="' + EXTENSION_OWNER + '"]');

    var destroyed = false;

    /** Rebuild outcome, consumed by the rebuild scheduler's circuit breaker:
     *  'ok' — completed (including no-op/aborted/skipped-identical builds)
     *  'fail' — a build error was caught and logged (breaker counts these)
     *  'halt' — instance torn down or extension context invalidated (never
     *  counted as a failure; the scheduler is disconnected by these paths) */
    type RebuildStatus = 'ok' | 'fail' | 'halt';

    // AbortController for the in-flight build: a newer build or dispose aborts
    // the previous chunked build so stale results are never rendered (e.g. a
    // build started on page A doesn't finish and render after navigating to B).
    var buildAbort: AbortController | null = null;
    var buildNow = async function (): Promise<{ items: TocItem[]; meta: TocMeta | null } | { aborted: true }> {
      if (buildAbort) { try { buildAbort.abort(); } catch (_) {} }
      var ac = new AbortController();
      buildAbort = ac;
      try {
        var res = await buildTocItems(cfg, ac.signal);
        if (res && (res as any).aborted) return { aborted: true };
        if (res && Array.isArray((res as any).items)) return res as { items: TocItem[]; meta: TocMeta | null };
        if (Array.isArray(res)) return { items: res as TocItem[], meta: null };
      } catch (e) {
        console.warn('[toc] buildTocItems error:', e);
      } finally {
        if (buildAbort === ac) buildAbort = null;
      }
      return { items: [], meta: null };
    };

    // Seed empty: the first (async, chunked) build is triggered below once the
    // dock and observers are wired. A collapsed empty dock briefly shows before
    // items land — the same state as a page with no headings.
    var items: TocItem[] = [];
    var tocMeta: TocMeta | null = null;
    var dockInstance: ReturnType<typeof renderEdgeDock> | null = null;
    var panelInstance: ReturnType<typeof renderFloatingPanel> | null = null;
    var activeTracker: ReturnType<typeof createActiveItemTracker> | null = null;
    var activeIndex = -1;
    var rebuildScheduler: ReturnType<typeof createRebuildScheduler> | null = null;
    var pickerInstance: ReturnType<typeof createElementPicker> | null = null;
    var rebuildInFlight: Promise<RebuildStatus> | null = null;
    var navLock = createNavLock({
      onUnlock: function() {
        // When the nav lock releases, retry a rebuild that was parked while the
        // user was navigating — so the TOC doesn't wait for the next external
        // mutation/event to refresh. Only flush when a rebuild is actually
        // pending (parked by attemptRebuild while the lock was held).
        // setPendingRebuild(true) is NOT a no-op — it forces attemptRebuild —
        // so without this guard every TOC-item click would trigger a full
        // rebuild ~1s later even when nothing changed.
        if (rebuildScheduler && rebuildScheduler.getPendingRebuild && rebuildScheduler.getPendingRebuild()) {
          rebuildScheduler.setPendingRebuild(true);
        }
      }
    });
    var configDirty = true; // true on init so first rebuild reads from storage
    cfg.__markConfigDirty = function() { configDirty = true; };

    // True when the user has explicitly configured selectors for this site.
    // Sites without custom selectors hide the dock entirely while the TOC is
    // empty (no headings) — video players, admin consoles, galleries. With
    // custom selectors the dock stays visible so picker/settings stay usable.
    var hasCustomSelectors = function() {
      var list = Array.isArray(cfg.selectors) ? cfg.selectors : [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].expr && !(list[i] as any)._tocSentinel) return true;
      }
      return false;
    };

    var syncEmptyDockState = function() {
      if (dockInstance && dockInstance.setEmptyHidden) {
        dockInstance.setEmptyHidden(!hasCustomSelectors());
      }
    };

    var findMatchingActiveIndex = function(nextItems: TocItem[], previousItem: TocItem | null, fallbackIndex: number) {
      if (!nextItems || !nextItems.length || !previousItem) return -1;
      var byElement = nextItems.findIndex(function(item) { return item.el === previousItem.el; });
      if (byElement >= 0) return byElement;
      var byText = nextItems.findIndex(function(item) { return item.text === previousItem.text; });
      if (byText >= 0) return byText;
      return fallbackIndex >= 0 && fallbackIndex < nextItems.length ? fallbackIndex : -1;
    };

    var syncActiveIndex = function(nextIndex: number) {
      activeIndex = Number.isFinite(nextIndex) && nextIndex >= 0 && nextIndex < items.length ? nextIndex : -1;
      if (dockInstance && dockInstance.setActiveIndex) dockInstance.setActiveIndex(activeIndex);
      if (panelInstance && panelInstance.setActiveIndex) panelInstance.setActiveIndex(activeIndex);
    };

    var syncItemViews = function(previousItem: TocItem | null, previousIndex: number) {
      var nextActiveIndex = findMatchingActiveIndex(items, previousItem, previousIndex);
      if (dockInstance && dockInstance.setItems) dockInstance.setItems(items);
      if (activeTracker && activeTracker.setItems) activeTracker.setItems(items);
      syncActiveIndex(nextActiveIndex);
    };

    var rebuildOnce = async function(): Promise<RebuildStatus> {
      if (destroyed) return 'halt';

      // Early exit: if extension context is invalidated, stop all rebuilds
      if (isExtensionContextInvalidated()) {
        if (rebuildScheduler && rebuildScheduler.disconnect) {
          rebuildScheduler.disconnect();
        }
        // Show notice on existing panel
        if (panelInstance && !(getTocShadowRootSync() ?? document).querySelector('[data-toc-owner="' + EXTENSION_OWNER + '"] .toc-ctx-invalidated-notice')) {
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
            }, { once: true });

            noticeEl.appendChild(noticeSpan);
            noticeEl.appendChild(document.createTextNode(' '));
            noticeEl.appendChild(refreshLink);
            var panelEl = (getTocShadowRootSync() ?? document).querySelector('.toc-floating[data-toc-owner="' + EXTENSION_OWNER + '"]');
            var listEl = panelEl && panelEl.querySelector('.toc-list');
            if (listEl && listEl.parentNode) listEl.parentNode.insertBefore(noticeEl, listEl);
          } catch (_) {}
        }
        return 'halt';
      }

      try {
        if (configDirty) {
          await updateConfigFromStorage(cfg);
          configDirty = false;
          // Selector set may have changed — recompute whether an empty TOC
          // should hide the dock.
          syncEmptyDockState();
        }
        if (destroyed) return 'ok';

        var prevItems = items;
        var previousActiveIndex = activeIndex;
        var previousActiveItem = items[activeIndex] || null;
        var buildResult = await buildNow();
        if (!buildResult || 'aborted' in buildResult) {
          // A newer build superseded this one — leave items untouched.
          return 'ok';
        }
        var newItems = buildResult.items;
        var newMeta = buildResult.meta;

        // Skip rebuild if content is identical
        if (isTocContentIdentical(prevItems, newItems)) return 'ok';

        items = newItems;
        tocMeta = newMeta;

        // Invalidate scroll caches since the DOM may have changed layout
        invalidateScrollCaches();

        // No panel yet: update in-memory items so next expand is fresh, but skip full UI rebuild.
        if (!panelInstance) {
          syncItemViews(previousActiveItem, previousActiveIndex);
          return 'ok';
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
        return 'ok';
      } catch (e) {
        if (isContextInvalidatedError(e)) {
          debug('[toc] Extension context invalidated, stop TOC operations');
          navLock.unlock();
          items.forEach(function(it) { it._userSelected = false; });
          if (rebuildScheduler && rebuildScheduler.disconnect) {
            rebuildScheduler.disconnect();
          }
          return 'halt';
        }
        console.warn('[toc] rebuild failed:', e);
        return 'fail';
      }
    };

    // Set when a config refresh lands while a rebuild is in flight: that rebuild
    // may have read the selectors before the change, so exactly one follow-up runs.
    var configRefreshQueued = false;

    var rebuild = function(): Promise<RebuildStatus> {
      if (rebuildInFlight) return rebuildInFlight;
      // Never reject: casual await sites abound. Failures resolve as 'fail'
      // so the rebuild scheduler's circuit breaker can count them — a
      // rejected promise here is what silently killed the breaker before.
      rebuildInFlight = rebuildOnce().catch(function(e): RebuildStatus {
        console.warn('[toc] rebuildOnce threw:', e);
        return 'fail';
      }).then(function(status): RebuildStatus {
        rebuildInFlight = null;
        // Tell the scheduler this rebuild is over: a request that arrived while
        // it ran (a panel flush after a navigation) could only be parked, since
        // this is not a rebuild the scheduler started itself.
        if (rebuildScheduler && rebuildScheduler.notifySettled) rebuildScheduler.notifySettled(status !== 'fail');
        if (!configRefreshQueued) return status;
        configRefreshQueued = false;
        if (destroyed) return status;
        // The rebuild that just finished cleared configDirty AFTER the refresh
        // set it, and may have built on the stale selectors it read before the
        // change — the follow-up has to read the config again.
        configDirty = true;
        // Deferred, so the follow-up never starts inside this continuation.
        Promise.resolve().then(function() { rebuild(); });
        return status;
      });
      return rebuildInFlight;
    };

    var refreshConfig = function() {
      if (destroyed) return Promise.resolve('halt' as RebuildStatus);
      configDirty = true;
      // Joining the in-flight rebuild alone would lose the change: it may already
      // be past its config read. Queue one follow-up for when it finishes.
      if (rebuildInFlight) configRefreshQueued = true;
      return rebuild();
    };

    // Register this instance's config refresh with the module-level config-change
    // fan-out. refreshConfig, not rebuild: the fan-out IS a config change, and it
    // must not be lost by joining a rebuild that is already in flight.
    liveRebuilds.add(refreshConfig);

    function startPick() {
      try {
        if (pickerInstance && pickerInstance.cleanup) {
          pickerInstance.cleanup();
        }

        pickerInstance = createElementPicker(function(el) {
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
                debug('[toc] save selector failed', e);
              }
            }
          });
        }, function() {
          // canceled
          pickerInstance = null;
        });
      } catch (e) {
        debug('[toc] start element picker failed:', e);
      }
    }

    function removePanelCard() {
      if (!panelInstance) return;
      panelInstance.remove();
      panelInstance = null;
    }

    function renderPanelCard(panelOpts?: { focusOnOpen?: boolean }) {
      if (destroyed || panelInstance) return panelInstance;
      if (!dockInstance) return panelInstance;
      panelInstance = renderFloatingPanel({
        navLock: navLock,
        // The panel opens from wherever the dock is now.
        side: dockInstance.getSide(),
        items: items,
        onCollapse: function() { collapse({ focus: true }); },
        getPendingRebuild: rebuildScheduler ? rebuildScheduler.getPendingRebuild : function() { return false; },
        setPendingRebuild: rebuildScheduler ? rebuildScheduler.setPendingRebuild : function() {},
        mountTarget: dockInstance.getPanelHost(),
        tocMeta: tocMeta,
        activeIndex: activeIndex,
        onNavigate: function(_item, index) { syncActiveIndex(index); },
        focusOnOpen: !!(panelOpts && panelOpts.focusOnOpen),
      });
      return panelInstance;
    }

    async function onDockModeChange(next: string, prev: string, info?: { keyboard?: boolean }) {
      try {
        if (next === 'collapsed') {
          removePanelCard();
          return;
        }

        // When expanded via keyboard, move focus into the panel (a11y). The dock
        // only sets info.keyboard=true for keyboard-driven expansion, never hover.
        var focusOnOpen = !!(info && info.keyboard);
        await rebuild();
        if (!dockInstance || dockInstance.getMode() === 'collapsed') return;
        if (!panelInstance) renderPanelCard({ focusOnOpen: focusOnOpen });
      } catch (e) {
        if (!isContextInvalidatedError(e)) {
          debug('[toc] dock mode update failed:', e);
        }
      }
    }

    function collapse(opts?: { focus?: boolean }) {
      try {
        if (dockInstance) dockInstance.collapse(opts || {});
        else removePanelCard();
      } catch (e) {
        debug('[toc] collapse failed:', e);
      }
    }

    async function expand(opts?: { autoCollapse?: boolean }) {
      try {
        if (dockInstance) dockInstance.peek(opts || {});
      } catch (e) {
        if (!isContextInvalidatedError(e)) {
          debug('[toc] expand failed:', e);
        }
      }
    }

    var destroy = function() {
      destroyed = true;
      if (buildAbort) { try { buildAbort.abort(); } catch (_) {} buildAbort = null; }
      items = [];
      rebuildInFlight = null;
      configRefreshQueued = false;
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
      // Remove this instance's rebuild from the config-change fan-out. Other
      // live instances (if any) keep receiving notifications; reinit re-adds.
      liveRebuilds.delete(refreshConfig);
    };

    try {
      rebuildScheduler = createRebuildScheduler(rebuild, {
        onConfigDirty: function() { configDirty = true; },
        navLock: navLock,
        // Lets the scheduler park a request that lands during a rebuild this
        // instance started directly (hover-expand, Refresh, a config change).
        isRebuildInFlight: function() { return !!rebuildInFlight; }
      });
      rebuildScheduler.start(cfg);
      dockInstance = renderEdgeDock({
        side: DEFAULT_DOCK_SIDE,
        initialMode: 'collapsed',
        items: items,
        onModeChange: onDockModeChange,
        onRefresh: rebuild,
        onPick: startPick,
        onSiteConfig: function() { return siteConfig(cfg); },
        onDeactivate: onDeactivate,
        onNavigate: function(item, index) {
          if (!item || !item.el) return;
          syncActiveIndex(index);
          navLock.lock(NAV_LOCK_MS);
          scrollToElement(item.el);
        },
        onSideChange: function() {
          removePanelCard();
        }
      });
      activeTracker = createActiveItemTracker({
        items: items,
        onChange: function(_item, index) {
          if (!rebuildInFlight && !navLock.isLocked()) syncActiveIndex(index);
        }
      });
      syncActiveIndex(activeIndex);
      syncEmptyDockState();

      // Kick off the first (async, chunked) build now that the dock, scheduler
      // and active-item tracker are wired. rebuild() dedupes via rebuildInFlight.
      rebuild();

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
