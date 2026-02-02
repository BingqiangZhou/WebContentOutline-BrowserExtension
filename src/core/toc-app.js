(() => {
  'use strict';

  const { buildTocItems } = window.TOC_BUILDER || {};
  const { renderCollapsedBadge, renderFloatingPanel, createElementPicker, showPickerResult } = window.TOC_UI || {};
  const { buildClassSelector, cssPathFor } = window.CSS_SELECTOR || {};
  const { siteConfig, saveSelector, updateConfigFromStorage } = window.CONFIG_MANAGER || {};
  const { setPanelExpandedByOrigin, msg, getBadgePosByHost, setBadgePosByHost } = window.TOC_UTILS || {};
  const safeMsg = msg || ((key) => {
    try { return chrome.i18n.getMessage(key) || key; } catch (_) { return key; }
  });

  const { createMutationObserver } = window.MUTATION_OBSERVER || {};

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
      if (!snapshot || !snapshot.currentActiveItem || items.length === 0) return;

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
        };
        activeRestoreTimeout = requestAnimationFrame(restoreActive);
      }
    };

    const rebuild = async () => {
      try {
        if (updateConfigFromStorage) {
          await updateConfigFromStorage(cfg);
        }

        const newItems = buildTocItems ? buildTocItems(cfg, []) : [];

        if (panelInstance && getNavLock()) {
          items = newItems;
          if (mutationObserver && mutationObserver.setPendingRebuild) {
            mutationObserver.setPendingRebuild(true);
          }
          return;
        }

        if (panelInstance && isContentIdentical(items, newItems)) {
          return;
        }

        const activeSnapshot = getActiveSnapshot();
        cancelActiveRestore();

        items = newItems;
        if (panelInstance) {
          let panelPos = null;
          let rebuildSide = 'right';
          const currentPanelEl = document.querySelector('.toc-floating');
          if (currentPanelEl) {
            const rect = currentPanelEl.getBoundingClientRect();
            rebuildSide = rect.right > (window.innerWidth / 2) ? 'right' : 'left';
            panelPos = {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              width: rect.width
            };
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
        }
      } catch (e) {
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
        // Get collapse button center position to pass to badge
        let buttonCenter = null;
        const collapseBtn = document.querySelector('.toc-floating .toc-header-row .toc-btn:last-child');
        if (collapseBtn) {
          const btnRect = collapseBtn.getBoundingClientRect();
          buttonCenter = {
            x: btnRect.left + btnRect.width / 2,
            y: btnRect.top + btnRect.height / 2
          };
        }

        if (panelInstance) {
          panelInstance.remove();
          panelInstance = null;
        }

        if (!badgeInstance && renderCollapsedBadge) {
          badgeInstance = renderCollapsedBadge(side, expand, buttonCenter);
        }
        try { setPanelExpandedByOrigin && setPanelExpandedByOrigin(location.origin, false); } catch (_) {}
      } catch (e) {
        console.debug('[toc] collapse failed:', e);
      }
    }

    async function expand() {
      try {
        const panelWidth = 280;
        let expandSide = 'right';
        let panelPos = null;
        let savedPos = null;

        // Get saved badge center position
        if (getBadgePosByHost) {
          savedPos = await getBadgePosByHost(location.host);
          if (savedPos && savedPos.x !== undefined) {
            // Determine side based on badge position
            expandSide = savedPos.x > (window.innerWidth / 2) ? 'right' : 'left';

            // Calculate panel position to align collapse button center with badge center
            // The collapse button is positioned: header padding (10px) + button padding (6px) + half button width from panel edge
            // We use a reasonable offset for the button center from panel edge
            const buttonCenterFromEdge = 20; // Approximate offset: padding + half button width

            let panelLeft;
            if (expandSide === 'right') {
              // For right side: button center is left of panel right edge
              // panelRight = buttonCenter + buttonCenterFromEdge
              const panelRight = savedPos.x + buttonCenterFromEdge;
              panelLeft = panelRight - panelWidth;
            } else {
              // For left side: button center is right of panel left edge
              // panelLeft = buttonCenter - (panelWidth - buttonCenterFromEdge)
              panelLeft = savedPos.x - (panelWidth - buttonCenterFromEdge);
            }

            // Constrain panel position to screen bounds
            const maxLeft = window.innerWidth - panelWidth - 4;
            const maxTop = window.innerHeight - 400 - 4;  // Approx panel height
            panelLeft = Math.max(4, Math.min(maxLeft, panelLeft));
            const panelTop = Math.max(4, Math.min(maxTop, (savedPos.y ?? 120) - 12));

            panelPos = {
              left: panelLeft,
              top: panelTop,
              right: panelLeft + panelWidth,
              width: panelWidth
            };
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
            panelPos
          );
        }

        // After panel is rendered, fine-tune position to perfectly align button center with saved badge center
        if (panelPos && savedPos && savedPos.x !== undefined) {
          requestAnimationFrame(() => {
            const collapseBtn = document.querySelector('.toc-floating .toc-header-row .toc-btn:last-child');
            const panelEl = document.querySelector('.toc-floating');
            if (collapseBtn && panelEl) {
              const btnRect = collapseBtn.getBoundingClientRect();
              const currentBtnCenterX = btnRect.left + btnRect.width / 2;
              const targetBtnCenterX = savedPos.x;
              const offsetX = targetBtnCenterX - currentBtnCenterX;

              if (Math.abs(offsetX) > 1) {
                const currentLeft = parseFloat(panelEl.style.left) || panelEl.getBoundingClientRect().left;
                const newLeft = currentLeft + offsetX;
                panelEl.style.setProperty('left', newLeft + 'px', 'important');
                panelEl.style.setProperty('right', 'auto', 'important');
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

    if (createMutationObserver) {
      const observerFactory = createMutationObserver(rebuild, getNavLock);
      mutationObserver = observerFactory.start(cfg);
    }

    window.TOC_APP = window.TOC_APP || {};
    window.TOC_APP.rebuild = rebuild;

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
