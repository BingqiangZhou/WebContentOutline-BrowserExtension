(() => {
  'use strict';

  // Prevent multiple initialization
  if (window.__TOC_APP_LOADED__) return;
  window.__TOC_APP_LOADED__ = true;

  const { buildTocItems } = window.TOC_BUILDER || {};
  const { renderCollapsedBadge, renderFloatingPanel, createElementPicker, showPickerResult } = window.TOC_UI || {};
  const { buildClassSelector, cssPathFor } = window.CSS_SELECTOR || {};
  const { siteConfig, saveSelector, updateConfigFromStorage } = window.CONFIG_MANAGER || {};
  const { setPanelExpandedByOrigin, msg, getBadgePosByHost, setBadgePosByHost } = window.TOC_UTILS || {};
  const safeMsg = msg || ((key) => {
    try { return chrome.i18n.getMessage(key) || key; } catch (_) { return key; }
  });

  const { createMutationObserver } = window.MUTATION_OBSERVER || {};

  // Global rebuild flag to prevent IntersectionObserver interference
  let isRebuilding = false;

  // Constants
  const PANEL_WIDTH = 280;
  const PANEL_HEIGHT = 400;
  const BUTTON_OFFSET = 20;

  const isContextInvalidatedError = (e) => {
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
      document.querySelectorAll('.toc-collapsed-badge, .toc-floating').forEach(el => el.remove());
    } catch (_) {}

    let items = buildTocItems ? buildTocItems(cfg, []) : [];
    let badgeInstance = null;
    let panelInstance = null;
    let mutationObserver = null;
    let pickerInstance = null;
    let activeRestoreTimeout = null;

    let navLock = false;
    const getNavLock = () => navLock;
    const setNavLock = (v) => { navLock = !!v; };
    const cancelActiveRestore = () => {
      if (activeRestoreTimeout) {
        try {
          if (typeof activeRestoreTimeout === 'number') {
            cancelAnimationFrame(activeRestoreTimeout);
          }
        } catch (_) {}
        activeRestoreTimeout = null;
      }
    };

    // Helper to constrain position to screen bounds
    const constrainPosition = (left, top, width = PANEL_WIDTH, height = PANEL_HEIGHT) => {
      const maxLeft = window.innerWidth - width - 4;
      const maxTop = window.innerHeight - height - 4;
      return {
        left: Math.max(4, Math.min(maxLeft, left)),
        top: Math.max(4, Math.min(maxTop, top))
      };
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
      if (!snapshot || !snapshot.currentActiveItem || items.length === 0) {
        // Clear rebuild flag even if no restore happens
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            isRebuilding = false;
          });
        });
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
          requestAnimationFrame(() => {
            isRebuilding = false;
          });
        };
        activeRestoreTimeout = requestAnimationFrame(restoreActive);
      } else {
        // No matching item found, clear flag
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            isRebuilding = false;
          });
        });
      }
    };

    const rebuild = async () => {
      try {
        // Set rebuild flag to prevent IntersectionObserver interference
        isRebuilding = true;

        if (updateConfigFromStorage) {
          await updateConfigFromStorage(cfg);
        }

        const prevItems = items;
        const newItems = buildTocItems ? buildTocItems(cfg, []) : [];

        // Badge mode: update in-memory items so next expand is fresh, but skip UI rebuild.
        if (!panelInstance) {
          items = newItems;
          requestAnimationFrame(() => {
            isRebuilding = false;
          });
          return;
        }

        if (getNavLock()) {
          items = newItems;
          if (mutationObserver && mutationObserver.setPendingRebuild) {
            mutationObserver.setPendingRebuild(true);
          }
          // Reset flag when deferring rebuild
          requestAnimationFrame(() => {
            isRebuilding = false;
          });
          return;
        }

        // Skip rebuild if content is identical
        if (isContentIdentical(prevItems, newItems)) {
          // Reset flag when content is identical
          requestAnimationFrame(() => {
            isRebuilding = false;
          });
          return;
        }

        // Skip rebuild if both old and new are empty - no change needed
        if (prevItems.length === 0 && newItems.length === 0) {
          requestAnimationFrame(() => {
            isRebuilding = false;
          });
          return;
        }

        const activeSnapshot = getActiveSnapshot();
        cancelActiveRestore();

        items = newItems;
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
          panelPos
        ) : null;

        restoreActiveSnapshot(activeSnapshot);
      } catch (e) {
        // Reset flag on error
        requestAnimationFrame(() => {
          isRebuilding = false;
        });
        if (isContextInvalidatedError(e)) {
          console.debug('[toc] Extension context invalidated, stop TOC operations');
          if (mutationObserver && mutationObserver.disconnect) {
            try {
              mutationObserver.disconnect();
            } catch (_) {}
          }
          return;
        }
        console.debug('[toc] rebuild failed:', e);
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
          let sel = '';
          const cls = buildClassSelector ? buildClassSelector(el) : '';
          if (cls) sel = `${el.tagName.toLowerCase()}${cls}`;
          if (!sel && cssPathFor) sel = cssPathFor(el);

          showPickerResult(sel, async (selector, onDone) => {
            try {
              const success = await saveSelector(selector, cfg);
              if (success) {
                onDone && onDone();
                await rebuild();
              } else {
                alert(safeMsg('errorOperationFailed'));
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

        // Get saved badge center position
        if (getBadgePosByHost) {
          savedPos = await getBadgePosByHost(location.host);
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
            panelPos  // Pass calculated position to avoid flicker
          );
        }

        // Fine-tune after render for perfect alignment
        if (savedPos && panelPos && (Number.isFinite(savedPos.x) || Number.isFinite(savedPos.y))) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const collapseBtn = document.querySelector('.toc-floating .toc-header-row .toc-btn:last-child');
              const panelEl = document.querySelector('.toc-floating');
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
          });
        }

        try { setPanelExpandedByOrigin && setPanelExpandedByOrigin(location.origin, true); } catch (_) {}
      } catch (e) {
        if (!isContextInvalidatedError(e)) {
          console.debug('[toc] expand failed:', e);
        }
      }
    }

    if (createMutationObserver) {
      const observerFactory = createMutationObserver(rebuild, getNavLock);
      mutationObserver = observerFactory.start(cfg);
    }

    window.TOC_APP = window.TOC_APP || {};
    window.TOC_APP.rebuild = rebuild;
    window.TOC_APP.isRebuilding = () => isRebuilding;

    collapse();

    return {
      rebuild,
      collapse,
      expand,
      destroy() {
        try {
          if (typeof activeRestoreTimeout === 'number') {
            cancelAnimationFrame(activeRestoreTimeout);
          }
        } catch (_) {}
        activeRestoreTimeout = null;
        if (badgeInstance) badgeInstance.remove();
        if (panelInstance) panelInstance.remove();
        if (mutationObserver && mutationObserver.disconnect) mutationObserver.disconnect();
        try {
          if (pickerInstance && pickerInstance.cleanup) {
            pickerInstance.cleanup();
            pickerInstance = null;
          }
        } catch (_) {}
      }
    };
  }

  window.TOC_APP = window.TOC_APP || {};
  window.TOC_APP.initForConfig = initForConfig;
})();
