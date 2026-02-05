(() => {
  'use strict';

  // Prevent multiple initialization
  if (window.__TOC_APP_LOADED__) return;
  window.__TOC_APP_LOADED__ = true;

  const TOC_APP = window.TOC_APP || (window.TOC_APP = {});

  const { buildTocItems } = window.TOC_BUILDER || {};
  const { renderCollapsedBadge, renderFloatingPanel, createElementPicker, showPickerResult } = window.TOC_UI || {};
  const { buildClassSelector, cssPathFor } = window.CSS_SELECTOR || {};
  const { siteConfig, saveSelector, updateConfigFromStorage } = window.CONFIG_MANAGER || {};
  const {
    setPanelExpandedByOrigin,
    msg = (key) => key,
    getBadgePosByHost,
    setBadgePosByHost,
    showToast,
    uiConst,
    isContextInvalidatedError: isContextInvalidatedErrorUtil
  } = window.TOC_UTILS || {};

  const { createMutationObserver } = window.MUTATION_OBSERVER || {};

  // Constants
  const PANEL_WIDTH = typeof uiConst === 'function' ? uiConst('PANEL_WIDTH', 280) : 280;
  const PANEL_HEIGHT = typeof uiConst === 'function' ? uiConst('PANEL_HEIGHT', 400) : 400;
  const BUTTON_OFFSET = typeof uiConst === 'function' ? uiConst('BUTTON_OFFSET', 20) : 20;
  const DRAG_MARGIN_PX = typeof uiConst === 'function' ? uiConst('DRAG_MARGIN_PX', 4) : 4;
  const NAV_LOCK_FAILSAFE_MS = typeof uiConst === 'function' ? uiConst('NAV_LOCK_FAILSAFE_MS', 8000) : 8000;

  const isContextInvalidatedError = (typeof isContextInvalidatedErrorUtil === 'function')
    ? isContextInvalidatedErrorUtil
    : (e) => {
      return !!(e && (
        (e.message && (
          e.message.includes('Extension context invalidated') ||
          e.message.includes('context invalidated') ||
          e.message.includes('Extension context')
        )) ||
        (e.toString && e.toString().includes('Extension context invalidated'))
      ));
    };

  function initForConfig(cfg) {
    const side = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';

    // Clean up any existing TOC elements from previous instances (e.g., after extension restart)
    try {
      document.querySelectorAll('.toc-collapsed-badge, .toc-floating').forEach(el => {
        try {
          const cleanup = el && el.__TOC_CLEANUP__;
          if (typeof cleanup === 'function') cleanup();
        } catch (_) {}
        try { el.remove(); } catch (_) {}
      });
    } catch (_) {}

    // Per-instance rebuild flag to prevent IntersectionObserver interference
    let isRebuilding = false;
    let rebuildClearTimer = null;
    let destroyed = false;
    const pendingRafs = new Set();
    const scheduleRaf = (cb) => {
      try {
        const id = requestAnimationFrame(() => {
          try { pendingRafs.delete(id); } catch (_) {}
          if (destroyed) return;
          try { cb && cb(); } catch (_) {}
        });
        pendingRafs.add(id);
        return id;
      } catch (_) {
        try { cb && cb(); } catch (_) {}
        return null;
      }
    };
    const cancelPendingRafs = () => {
      try {
        pendingRafs.forEach((id) => {
          try { cancelAnimationFrame(id); } catch (_) {}
        });
      } catch (_) {
        // ignore
      } finally {
        try { pendingRafs.clear(); } catch (_) {}
      }
    };

    const clearRebuildTimers = () => {
      if (rebuildClearTimer != null) {
        try { clearTimeout(rebuildClearTimer); } catch (_) {}
        rebuildClearTimer = null;
      }
    };

    const buildNow = () => {
      try {
        const res = buildTocItems ? buildTocItems(cfg, []) : null;
        if (res && Array.isArray(res.items)) return res;
        if (Array.isArray(res)) return { items: res, meta: null };
      } catch (_) {}
      return { items: [], meta: null };
    };

    let { items, meta: tocMeta } = buildNow();
    let badgeInstance = null;
    let panelInstance = null;
    let mutationObserver = null;
    let pickerInstance = null;
    let activeRestoreTimeout = null;
    let rebuildInFlight = null;
    let rebuildQueued = false;

    let navLock = false;
    let navLockSetAt = 0;
    let navLockFailsafeTimer = null;
    const clearNavLockFailsafe = () => {
      if (navLockFailsafeTimer == null) return;
      try { clearTimeout(navLockFailsafeTimer); } catch (_) {}
      navLockFailsafeTimer = null;
    };
    const armNavLockFailsafe = () => {
      clearNavLockFailsafe();
      const ms = (Number.isFinite(NAV_LOCK_FAILSAFE_MS) && NAV_LOCK_FAILSAFE_MS > 0) ? NAV_LOCK_FAILSAFE_MS : 0;
      if (!ms) return;
      try {
        navLockFailsafeTimer = setTimeout(() => {
          navLockFailsafeTimer = null;
          if (destroyed) return;
          if (!navLock) return;
          const waitedMs = navLockSetAt ? (Date.now() - navLockSetAt) : ms;
          console.warn('[toc] nav lock stuck; forcing unlock after', waitedMs, 'ms');
          try {
            navLock = false;
            navLockSetAt = 0;
          } catch (_) {}
          try { items.forEach(it => { it._userSelected = false; }); } catch (_) {}
        }, ms);
      } catch (_) {
        navLockFailsafeTimer = null;
      }
    };
    const getNavLock = () => navLock;
    const setNavLock = (v) => {
      navLock = !!v;
      if (navLock) {
        navLockSetAt = Date.now();
        armNavLockFailsafe();
      } else {
        navLockSetAt = 0;
        clearNavLockFailsafe();
      }
    };
    const cancelActiveRestore = () => {
      if (typeof activeRestoreTimeout !== 'number') return;
      try { cancelAnimationFrame(activeRestoreTimeout); } catch (_) {}
      activeRestoreTimeout = null;
    };

    // Helper to constrain position to screen bounds
    const constrainPosition = (left, top, width = PANEL_WIDTH, height = PANEL_HEIGHT) => {
      const maxLeft = window.innerWidth - width - DRAG_MARGIN_PX;
      const maxTop = window.innerHeight - height - DRAG_MARGIN_PX;
      return {
        left: Math.max(DRAG_MARGIN_PX, Math.min(maxLeft, left)),
        top: Math.max(DRAG_MARGIN_PX, Math.min(maxTop, top))
      };
    };

    const clearRebuildFlag = () => {
      // Prefer clearing on next paint, but include a timer fallback in case rAF is throttled.
      clearRebuildTimers();
      try {
        rebuildClearTimer = setTimeout(() => { isRebuilding = false; rebuildClearTimer = null; }, 1500);
      } catch (_) {
        rebuildClearTimer = null;
      }
      try {
        scheduleRaf(() => {
          isRebuilding = false;
          clearRebuildTimers();
        });
      } catch (_) {
        isRebuilding = false;
        clearRebuildTimers();
      }
    };

    const isContentIdentical = (prevItems, nextItems) => {
      if (!prevItems || !nextItems) return false;
      if (prevItems.length !== nextItems.length || prevItems.length === 0) return false;
      for (let i = 0; i < prevItems.length; i++) {
        if (prevItems[i].text !== nextItems[i].text || prevItems[i].el !== nextItems[i].el) {
          return false;
        }
      }
      return true;
    };

    const getActiveSnapshot = () => {
      if (!panelInstance || items.length === 0) return null;
      let currentActiveItem = items.find(item => {
        if (!item || !item._node) return false;
        try {
          return item._node.classList && item._node.classList.contains('active');
        } catch (_) {
          return false;
        }
      });
      const activeItemIndex = currentActiveItem ? items.indexOf(currentActiveItem) : -1;
      return { currentActiveItem, activeItemIndex, wasLocked: getNavLock() };
    };

    const restoreActiveSnapshot = (snapshot) => {
      // Always cancel any pending restoration rAF from a previous rebuild.
      cancelActiveRestore();
      if (!snapshot || !snapshot.currentActiveItem || items.length === 0) {
        // Clear rebuild flag even if no restore happens
        clearRebuildFlag();
        return;
      }

      items.forEach(item => {
        if (item._node) {
          item._node.classList.remove('active');
          item._userSelected = false;
        }
      });

      let matchingItem = null;
      if (snapshot.activeItemIndex >= 0 && snapshot.activeItemIndex < items.length) {
        matchingItem = items[snapshot.activeItemIndex];
      }
      if (!matchingItem && snapshot.currentActiveItem.el) {
        matchingItem = items.find(item => item.el === snapshot.currentActiveItem.el);
      }
      if (!matchingItem) {
        matchingItem = items.find(item => item.text === snapshot.currentActiveItem.text);
      }

      if (matchingItem && matchingItem._node) {
        const restoreActive = () => {
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
          // Clear rebuild flag after restoration is complete
          clearRebuildFlag();
        };
        activeRestoreTimeout = requestAnimationFrame(restoreActive);
      } else {
        // No matching item found, clear flag
        clearRebuildFlag();
      }
    };

    const rebuildOnce = async () => {
      // Set rebuild flag to prevent IntersectionObserver interference
      isRebuilding = true;
      try {

        if (updateConfigFromStorage) {
          await updateConfigFromStorage(cfg);
        }

        const prevItems = items;
        const { items: newItems, meta: newMeta } = buildNow();

        // Badge mode: update in-memory items so next expand is fresh, but skip UI rebuild.
        if (!panelInstance) {
          items = newItems;
          tocMeta = newMeta;
          clearRebuildFlag();
          return;
        }

        if (getNavLock()) {
          // Do NOT swap out the active panel's items while locked; existing event handlers
          // still reference the old items array. Defer applying changes to the next rebuild.
          if (mutationObserver && mutationObserver.setPendingRebuild) {
            mutationObserver.setPendingRebuild(true);
          }
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

        const activeSnapshot = getActiveSnapshot();
        cancelActiveRestore();

        items = newItems;
        tocMeta = newMeta;
        let panelPos = null;
        let rebuildSide = 'right';
        const currentPanelEl = document.querySelector('.toc-floating');
        if (currentPanelEl) {
          const rect = currentPanelEl.getBoundingClientRect();
          rebuildSide = rect.right > (window.innerWidth / 2) ? 'right' : 'left';
          panelPos = { left: rect.left, top: rect.top };
        }

        panelInstance.remove();
        panelInstance = renderFloatingPanel ? renderFloatingPanel(
          rebuildSide, items, collapse, rebuild, startPick,
          () => siteConfig && siteConfig(cfg), getNavLock, setNavLock,
          mutationObserver ? mutationObserver.getPendingRebuild : () => false,
          mutationObserver ? mutationObserver.setPendingRebuild : () => {},
          panelPos,
          tocMeta
        ) : null;

        restoreActiveSnapshot(activeSnapshot);
      } catch (e) {
        if (isContextInvalidatedError(e)) {
          console.debug('[toc] Extension context invalidated, stop TOC operations');
          try { setNavLock(false); } catch (_) {}
          try {
            items.forEach(it => { it._userSelected = false; });
          } catch (_) {}
          if (mutationObserver && mutationObserver.disconnect) {
            try {
              mutationObserver.disconnect();
            } catch (_) {}
          }
          return;
        }
        console.debug('[toc] rebuild failed:', e);
      } finally {
        // Failsafe: if restoration never cleared the flag, clear it soon.
        if (typeof activeRestoreTimeout === 'number') {
          scheduleRaf(() => {
            scheduleRaf(() => {
              if (isRebuilding) isRebuilding = false;
            });
          });
        } else {
          clearRebuildFlag();
        }
      }
    };

    const rebuild = async () => {
      if (rebuildInFlight) {
        rebuildQueued = true;
        return rebuildInFlight;
      }
      rebuildInFlight = (async () => {
        const maxLoops = (typeof uiConst === 'function') ? uiConst('REBUILD_MAX_LOOPS', 10) : 10;
        const loops = Number.isFinite(maxLoops) ? Math.max(1, Math.floor(maxLoops)) : 10;
        for (let i = 0; i < loops; i++) {
          rebuildQueued = false;
          try {
            await rebuildOnce();
          } catch (e) {
            console.debug('[toc] rebuildOnce threw:', e);
          }
          if (!rebuildQueued) break;
          // Yield to avoid starving the main thread on rapid-fire mutations.
          try { await new Promise((r) => setTimeout(r, 0)); } catch (_) {}
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

    function startPick() {
      const dispatchPickerEvent = (type) => {
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
        pickerInstance = createElementPicker((el) => {
          dispatchPickerEvent('toc-picker-end');
          pickerInstance = null;
          let sel = '';
          const cls = buildClassSelector ? buildClassSelector(el) : '';
          if (cls && el && el.tagName) sel = `${String(el.tagName).toLowerCase()}${cls}`;
          if (!sel && cssPathFor) sel = cssPathFor(el);

          showPickerResult(sel, async (selector, onDone) => {
            try {
              const success = await saveSelector(selector, cfg);
              if (success) {
                onDone && onDone();
                await rebuild();
              } else {
                showToast && showToast(msg('errorOperationFailed'), { type: 'error' });
              }
            } catch (e) {
              if (!isContextInvalidatedError(e)) {
                console.debug('[toc] save selector failed', e);
              }
            }
          });
        }, () => {
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
        let buttonCenter = null;
        const collapseBtn = document.querySelector('.toc-floating .toc-header-row .toc-btn:last-child');
        if (collapseBtn) {
          const rect = collapseBtn.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          if (Number.isFinite(x) && Number.isFinite(y)) {
            buttonCenter = { x, y };
            setBadgePosByHost && setBadgePosByHost(location.host, buttonCenter);
          }
        }

        if (panelInstance) {
          panelInstance.remove();
          panelInstance = null;
        }

        if (!badgeInstance && renderCollapsedBadge) {
          badgeInstance = renderCollapsedBadge(side, expand, buttonCenter);
        }
        setPanelExpandedByOrigin && setPanelExpandedByOrigin(location.origin, false);
      } catch (e) {
        console.debug('[toc] collapse failed:', e);
      }
    }

    async function expand() {
      try {
        let expandSide = 'right';
        let savedPos = null;
        let panelPos = null;

        // Prefer the live badge position if present (avoids stale storage during/after resize).
        try {
          const badgeEl = document.querySelector('.toc-collapsed-badge');
          if (badgeEl) {
            const r = badgeEl.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
              const x = r.left + r.width / 2;
              const y = r.top + r.height / 2;
              if (Number.isFinite(x) && Number.isFinite(y)) {
                savedPos = { x, y };
                expandSide = x > (window.innerWidth / 2) ? 'right' : 'left';
                try { setBadgePosByHost && setBadgePosByHost(location.host, { x, y }); } catch (_) {}
              }
            }
          }
        } catch (_) {}

        // Get saved badge center position
        if (getBadgePosByHost) {
          if (!savedPos || !Number.isFinite(savedPos.x) || !Number.isFinite(savedPos.y)) {
            savedPos = await getBadgePosByHost(location.host);
          }
          if (savedPos && Number.isFinite(savedPos.x)) {
            expandSide = savedPos.x > (window.innerWidth / 2) ? 'right' : 'left';

            // Calculate panel position to align button center with saved badge center
            let panelLeft;
            if (expandSide === 'right') {
              panelLeft = savedPos.x + BUTTON_OFFSET - PANEL_WIDTH;
            } else {
              panelLeft = savedPos.x - BUTTON_OFFSET;
            }

            // Constrain to screen bounds
            const constrained = constrainPosition(panelLeft, (Number.isFinite(savedPos.y) ? savedPos.y : 120) - BUTTON_OFFSET);
            panelPos = { left: constrained.left, top: constrained.top };
          }
        }

        // Remove badge
        if (badgeInstance) {
          badgeInstance.remove();
          badgeInstance = null;
        }

        await rebuild();

        if (renderFloatingPanel) {
          if (panelInstance) {
            panelInstance.remove();
            panelInstance = null;
          }
          panelInstance = renderFloatingPanel(
            expandSide, items, collapse, rebuild, startPick,
            () => siteConfig && siteConfig(cfg), getNavLock, setNavLock,
            mutationObserver ? mutationObserver.getPendingRebuild : () => false,
            mutationObserver ? mutationObserver.setPendingRebuild : () => {},
            panelPos,  // Pass calculated position to avoid flicker
            tocMeta
          );
        }

        // Fine-tune after render for perfect alignment
        if (savedPos && panelPos && (Number.isFinite(savedPos.x) || Number.isFinite(savedPos.y))) {
          try {
            if (panelInstance && panelInstance.whenShown) {
              await panelInstance.whenShown;
            }
          } catch (_) {}
          scheduleRaf(() => {
            const panelEl = document.querySelector('.toc-floating');
            const collapseBtn = panelEl ? panelEl.querySelector('.toc-header-row .toc-btn:last-child') : null;
            if (collapseBtn && panelEl && collapseBtn.getBoundingClientRect().width > 0) {
              const btnRect = collapseBtn.getBoundingClientRect();
              const offsetX = Number.isFinite(savedPos.x) ? (savedPos.x - (btnRect.left + btnRect.width / 2)) : 0;
              const offsetY = Number.isFinite(savedPos.y) ? (savedPos.y - (btnRect.top + btnRect.height / 2)) : 0;

              if (Math.abs(offsetX) > 1 || Math.abs(offsetY) > 1) {
                const rect = panelEl.getBoundingClientRect();
                const pw = panelEl.offsetWidth || PANEL_WIDTH;
                const ph = panelEl.offsetHeight || PANEL_HEIGHT;
                const constrained = constrainPosition(rect.left + offsetX, rect.top + offsetY, pw, ph);

                panelEl.style.setProperty('left', constrained.left + 'px', 'important');
                panelEl.style.setProperty('top', constrained.top + 'px', 'important');
                panelEl.style.setProperty('right', 'auto', 'important');
                panelEl.style.setProperty('bottom', 'auto', 'important');
              }
            }
          });
        }

        try { setPanelExpandedByOrigin && setPanelExpandedByOrigin(location.origin, true); } catch (_) {}
      } catch (e) {
        if (!isContextInvalidatedError(e)) {
          console.debug('[toc] expand failed:', e);
        }
      }
    }

    const isRebuildingFn = () => isRebuilding;

    const destroy = () => {
      destroyed = true;
      cancelPendingRafs();
      clearRebuildTimers();
      clearNavLockFailsafe();
      isRebuilding = false;
      try {
        if (typeof activeRestoreTimeout === 'number') {
          cancelAnimationFrame(activeRestoreTimeout);
        }
      } catch (_) {}
      activeRestoreTimeout = null;
      try { if (badgeInstance) badgeInstance.remove(); } catch (_) {}
      badgeInstance = null;
      try { if (panelInstance) panelInstance.remove(); } catch (_) {}
      panelInstance = null;
      try { if (mutationObserver && mutationObserver.disconnect) mutationObserver.disconnect(); } catch (_) {}
      mutationObserver = null;
      try {
        if (pickerInstance && pickerInstance.cleanup) {
          pickerInstance.cleanup();
        }
      } catch (_) {}
      pickerInstance = null;
      try {
        if (TOC_APP.rebuild === rebuild) TOC_APP.rebuild = null;
        if (TOC_APP.isRebuilding === isRebuildingFn) TOC_APP.isRebuilding = null;
      } catch (_) {}
    };

    try {
      if (createMutationObserver) {
        const observerFactory = createMutationObserver(rebuild, getNavLock);
        mutationObserver = observerFactory.start(cfg);
      }

      TOC_APP.rebuild = rebuild;
      TOC_APP.isRebuilding = isRebuildingFn;

      collapse();

      return {
        rebuild,
        collapse,
        expand,
        destroy
      };
    } catch (e) {
      try { destroy(); } catch (_) {}
      throw e;
    }
  }

  TOC_APP.initForConfig = initForConfig;
})();
