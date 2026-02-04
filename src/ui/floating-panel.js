(() => {
  'use strict';

  const { msg = (key) => key, setBadgePosByHost, uiConst } = window.TOC_UTILS || {};

  const UNLOCK_AFTER_MS = typeof uiConst === 'function' ? uiConst('UNLOCK_AFTER_MS', 1000) : 1000;
  const SCROLL_STOP_MS = typeof uiConst === 'function' ? uiConst('SCROLL_STOP_MS', 500) : 500;
  const PANEL_WIDTH = typeof uiConst === 'function' ? uiConst('PANEL_WIDTH', 280) : 280;
  const PANEL_HEIGHT = typeof uiConst === 'function' ? uiConst('PANEL_HEIGHT', 400) : 400;
  const DRAG_MARGIN_PX = typeof uiConst === 'function' ? uiConst('DRAG_MARGIN_PX', 4) : 4;
  const EXPAND_ANIM_MS = typeof uiConst === 'function' ? uiConst('EXPAND_ANIM_MS', 300) : 300;
  const PENDING_REBUILD_RECHECK_MS = typeof uiConst === 'function' ? uiConst('PENDING_REBUILD_RECHECK_MS', 100) : 100;
  const CLEAR_USER_SELECTED_DELAY_MS = typeof uiConst === 'function' ? uiConst('CLEAR_USER_SELECTED_DELAY_MS', 200) : 200;

  function renderFloatingPanel(side, items, onCollapse, onRefresh, onPick, onSiteConfig, getNavLock, setNavLock, getPendingRebuild, setPendingRebuild, panelPos, tocMeta) {
    // Remove any existing panel to prevent duplicates
    try {
      document.querySelectorAll('.toc-floating').forEach(el => {
        try {
          const cleanup = el && el.__TOC_CLEANUP__;
          if (typeof cleanup === 'function') cleanup();
        } catch (_) {}
        try { el.remove(); } catch (_) {}
      });
    } catch (_) {}

    const panel = document.createElement('div');
    const listenersController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const listenerSignal = listenersController ? listenersController.signal : null;
    const addWindowListener = (type, handler, options) => {
      const capture = (typeof options === 'boolean') ? options : !!(options && options.capture);
      try {
        if (listenerSignal) {
          window.addEventListener(type, handler, { ...(options || {}), signal: listenerSignal });
          return () => {
            try { window.removeEventListener(type, handler, capture); } catch (_) {}
          };
        }
      } catch (_) {}
      window.addEventListener(type, handler, options);
      return () => {
        try { window.removeEventListener(type, handler, capture); } catch (_) {}
      };
    };

    let resolveShown = null;
    const whenShown = new Promise((resolve) => { resolveShown = resolve; });
    let unlockTimer = null;
    let scrollStopTimer = null;
    let pendingRebuildRecheckTimer = null;
    let clearUserSelectedTimer = null;
    let expandAnimTimer = null;
    let intersectionObserver = null;
    let showRaf = null;
    let observeRaf = null;
    let removalObserver = null;
    let removalTimer = null;
    let cleanedUp = false;
    const pickerStartEvent = 'toc-picker-start';
    const pickerEndEvent = 'toc-picker-end';
    let onPanelKeydown = null;
    let onListClick = null;
    let onListKeydown = null;
    let onBtnCollapseClick = null;
    let onBtnPickClick = null;
    let onBtnManageClick = null;
    let onBtnRefreshClick = null;

    panel.style.visibility = 'hidden';

    // Apply saved position
    if (panelPos && Number.isFinite(panelPos.top) && Number.isFinite(panelPos.left)) {
      panel.style.setProperty('top', panelPos.top + 'px', 'important');
      panel.style.setProperty('left', panelPos.left + 'px', 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('bottom', 'auto', 'important');
    }

    let resizeRaf = null;
    const constrainCurrentPosition = () => {
      try {
        const rect = panel.getBoundingClientRect();
        const pw = panel.offsetWidth || PANEL_WIDTH;
        const ph = panel.offsetHeight || PANEL_HEIGHT;
        const maxLeft = window.innerWidth - pw - DRAG_MARGIN_PX;
        const maxTop = window.innerHeight - ph - DRAG_MARGIN_PX;
        const left = Math.max(DRAG_MARGIN_PX, Math.min(maxLeft, rect.left));
        const top = Math.max(DRAG_MARGIN_PX, Math.min(maxTop, rect.top));
        panel.style.setProperty('left', left + 'px', 'important');
        panel.style.setProperty('top', top + 'px', 'important');
        panel.style.setProperty('right', 'auto', 'important');
        panel.style.setProperty('bottom', 'auto', 'important');
      } catch (_) {}
    };
    const onResize = () => {
      if (cleanedUp) return;
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        if (cleanedUp) return;
        if (!panel || !panel.isConnected) return;
        constrainCurrentPosition();
      });
    };
    const RESIZE_LISTENER_OPTS = { passive: true };
    const SCROLL_LISTENER_OPTS = { passive: true };
    const removeResizeListener = addWindowListener('resize', onResize, RESIZE_LISTENER_OPTS);

    const unlockLater = () => {
      if (unlockTimer) clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => {
        setNavLock(false);

        if (getPendingRebuild && getPendingRebuild()) {
          if (pendingRebuildRecheckTimer) clearTimeout(pendingRebuildRecheckTimer);
          pendingRebuildRecheckTimer = setTimeout(async () => {
            if (getPendingRebuild && getPendingRebuild()) {
              setPendingRebuild && setPendingRebuild(false);
              try {
                await onRefresh();
              } catch (e) {
                console.warn('[toc] refresh after unlock failed', e);
              }
            }
          }, PENDING_REBUILD_RECHECK_MS);
        }

        if (clearUserSelectedTimer) clearTimeout(clearUserSelectedTimer);
        clearUserSelectedTimer = setTimeout(() => {
          items.forEach(it => {
            it._userSelected = false;
          });
        }, CLEAR_USER_SELECTED_DELAY_MS);
      }, UNLOCK_AFTER_MS);
    };

    const onScroll = () => {
      if (!getNavLock()) return;
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(() => {
        setNavLock(false);
        items.forEach(it => it._userSelected = false);
      }, SCROLL_STOP_MS);
    };

    const removeScrollListener = addWindowListener('scroll', onScroll, SCROLL_LISTENER_OPTS);
    const cleanupLock = () => {
      try { setNavLock && setNavLock(false); } catch (_) {}
      if (unlockTimer) clearTimeout(unlockTimer);
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      if (pendingRebuildRecheckTimer) clearTimeout(pendingRebuildRecheckTimer);
      if (clearUserSelectedTimer) clearTimeout(clearUserSelectedTimer);
      if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
      }
      if (observeRaf != null) {
        try { cancelAnimationFrame(observeRaf); } catch (_) {}
      }
      observeRaf = null;
    };

    panel.className = `toc-floating toc-floating-${side === 'left' ? 'left' : 'right'} toc-floating-expand`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    onPanelKeydown = (e) => {
      if (!e) return;
      if (e.key === 'Escape') {
        try { e.preventDefault(); } catch (_) {}
        onCollapse && onCollapse();
      }
    };
    panel.addEventListener('keydown', onPanelKeydown, true);

    const header = document.createElement('div');
    header.className = 'toc-header';

    const headerRow = document.createElement('div');
    headerRow.className = 'toc-header-row';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'toc-title';
    titleSpan.textContent = msg('tocTitle');
    titleSpan.id = `toc-panel-title-${Math.random().toString(36).slice(2)}`;
    panel.setAttribute('aria-labelledby', titleSpan.id);

    const btnCollapse = document.createElement('button');
    btnCollapse.className = 'toc-btn';
    btnCollapse.textContent = msg('buttonCollapse');
    btnCollapse.title = msg('buttonCollapseTitle');
    btnCollapse.setAttribute('aria-label', msg('buttonCollapseTitle') || msg('buttonCollapse'));
    onBtnCollapseClick = () => { try { onCollapse && onCollapse(); } catch (_) {} };
    btnCollapse.addEventListener('click', onBtnCollapseClick);

    headerRow.appendChild(titleSpan);
    headerRow.appendChild(btnCollapse);

    const actions = document.createElement('div');
    actions.className = 'toc-actions';

    const actionsLeft = document.createElement('div');
    actionsLeft.className = 'toc-actions-left';

    const btnPick = document.createElement('button');
    btnPick.className = 'toc-btn';
    btnPick.textContent = msg('buttonPickElement');
    btnPick.title = msg('buttonPickElementTitle');
    btnPick.setAttribute('aria-label', msg('buttonPickElementTitle') || msg('buttonPickElement'));
    btnPick.setAttribute('aria-pressed', 'false');
    onBtnPickClick = () => { try { onPick && onPick(); } catch (_) {} };
    btnPick.addEventListener('click', onBtnPickClick);

    const btnManage = document.createElement('button');
    btnManage.className = 'toc-btn';
    btnManage.textContent = msg('buttonSiteConfig');
    btnManage.title = msg('buttonSiteConfigTitle');
    btnManage.setAttribute('aria-label', msg('buttonSiteConfigTitle') || msg('buttonSiteConfig'));
    onBtnManageClick = () => { try { onSiteConfig && onSiteConfig(); } catch (_) {} };
    btnManage.addEventListener('click', onBtnManageClick);

    const actionsRight = document.createElement('div');
    actionsRight.className = 'toc-actions-right';

    const btnRefresh = document.createElement('button');
    btnRefresh.className = 'toc-btn';
    btnRefresh.textContent = msg('buttonRefresh');
    btnRefresh.title = msg('buttonRefreshTitle');
    btnRefresh.setAttribute('aria-label', msg('buttonRefreshTitle') || msg('buttonRefresh'));
    let refreshing = false;
    onBtnRefreshClick = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        if (onRefresh) await onRefresh();
      } catch (e) {
        console.warn('[toc] refresh failed:', e);
      } finally {
        refreshing = false;
      }
    };
    btnRefresh.addEventListener('click', onBtnRefreshClick);

    actionsLeft.appendChild(btnPick);
    actionsLeft.appendChild(btnManage);
    actionsRight.appendChild(btnRefresh);

    actions.appendChild(actionsLeft);
    actions.appendChild(actionsRight);

    header.appendChild(headerRow);
    header.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'toc-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-orientation', 'vertical');
    list.setAttribute('aria-label', msg('tocTitle'));

    if (tocMeta && tocMeta.truncated) {
      const note = document.createElement('div');
      note.className = 'toc-empty';
      note.setAttribute('role', 'note');
      note.setAttribute('aria-live', 'polite');
      const max = tocMeta.maxItems || 400;
      const msgWithMax = msg('truncatedNoticeWithMax', String(max));
      if (msgWithMax && msgWithMax !== 'truncatedNoticeWithMax') {
        note.textContent = msgWithMax;
      } else {
        const msgText = msg('truncatedNotice');
        note.textContent = (msgText && msgText !== 'truncatedNotice') ? msgText : '';
      }
      list.appendChild(note);
    }

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.setAttribute('role', 'status');
      empty.textContent = msg('emptyTocMessage');
      list.appendChild(empty);
    } else {
      items.forEach(item => {
        item._userSelected = false;
      });

      const handleItemClick = (item, node, e) => {
        if (e && e.preventDefault) e.preventDefault();

        setNavLock(true);

        items.forEach(it => {
          it._userSelected = false;
          if (it._node) {
            it._node.classList.remove('active');
            try { it._node.removeAttribute('aria-current'); } catch (_) {}
            try { it._node.tabIndex = -1; } catch (_) {}
          }
        });

        item._userSelected = true;
        node.classList.add('active');
        try { node.setAttribute('aria-current', 'location'); } catch (_) {}
        try { node.tabIndex = 0; } catch (_) {}

        try {
          const { scrollToElement } = window.TOC_UTILS || {};
          if (scrollToElement) {
            scrollToElement(item.el);
          } else {
            item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } catch {
          const { scrollToElement } = window.TOC_UTILS || {};
          if (scrollToElement) scrollToElement(item.el);
        }

        unlockLater();
      };

      items.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toc-item';
        btn.setAttribute('role', 'menuitem');
        btn.tabIndex = index === 0 ? 0 : -1;
        btn.textContent = item.text;
        btn.dataset.index = String(index);
        item._node = btn;
        list.appendChild(btn);
      });

      onListClick = (e) => {
        const node = e.target.closest('.toc-item');
        if (!node || !list.contains(node)) return;
        const idx = parseInt(node.dataset.index, 10);
        const item = items[idx];
        if (!item) return;
        handleItemClick(item, node, e);
      };
      list.addEventListener('click', onListClick);

      onListKeydown = (e) => {
        if (!e) return;
        const key = e.key;
        const node = e.target && e.target.closest ? e.target.closest('.toc-item') : null;
        const nodes = Array.from(list.querySelectorAll('.toc-item'));
        const currentIndex = node ? nodes.indexOf(node) : -1;

        if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
          if (!nodes.length) return;
          e.preventDefault();
          let nextIndex = currentIndex >= 0 ? currentIndex : 0;
          if (key === 'ArrowDown') nextIndex = Math.min(nodes.length - 1, nextIndex + 1);
          if (key === 'ArrowUp') nextIndex = Math.max(0, nextIndex - 1);
          if (key === 'Home') nextIndex = 0;
          if (key === 'End') nextIndex = nodes.length - 1;
          try {
            nodes.forEach((n, idx) => { n.tabIndex = idx === nextIndex ? 0 : -1; });
          } catch (_) {}
          try { nodes[nextIndex].focus({ preventScroll: false }); } catch (_) { nodes[nextIndex].focus(); }
          return;
        }

        if (key !== 'Enter' && key !== ' ') return;
        if (!node || !list.contains(node)) return;
        const idx = parseInt(node.dataset.index, 10);
        const item = items[idx];
        if (!item) return;
        e.preventDefault();
        handleItemClick(item, node, e);
      };
      list.addEventListener('keydown', onListKeydown);
    }

    panel.appendChild(header);
    panel.appendChild(list);
    document.documentElement.appendChild(panel);

    // Show panel and trigger expand animation
    showRaf = requestAnimationFrame(() => {
      showRaf = null;
      if (cleanedUp) return;
      if (!panel || !panel.isConnected) return;
      panel.style.visibility = '';
      panel.classList.add('toc-expanded');
      try { resolveShown && resolveShown(); } catch (_) {}
      if (expandAnimTimer) clearTimeout(expandAnimTimer);
      expandAnimTimer = setTimeout(() => {
        if (cleanedUp) return;
        if (!panel || !panel.isConnected) return;
        panel.classList.remove('toc-floating-expand', 'toc-expanded');
      }, EXPAND_ANIM_MS);
    });

    // Make header draggable
    const { createDragController } = window.TOC_DRAG || {};
    let dragController = createDragController ? createDragController({
      element: panel,
      shouldStart: (e) => !!(e && e.target && e.target.closest && e.target.closest('.toc-header')),
      getRect: () => panel.getBoundingClientRect(),
      onStart: () => {
        panel.style.cursor = 'grabbing';
        panel.style.userSelect = 'none';
      },
      onMove: (drag, e) => {
        let left = e.clientX - drag.offsetX;
        let top = e.clientY - drag.offsetY;

        const pw = panel.offsetWidth || PANEL_WIDTH;
        const ph = panel.offsetHeight || PANEL_HEIGHT;
        const maxLeft = window.innerWidth - pw - DRAG_MARGIN_PX;
        const maxTop = window.innerHeight - ph - DRAG_MARGIN_PX;

        left = Math.max(DRAG_MARGIN_PX, Math.min(maxLeft, left));
        top = Math.max(DRAG_MARGIN_PX, Math.min(maxTop, top));

        panel.style.setProperty('left', left + 'px', 'important');
        panel.style.setProperty('top', top + 'px', 'important');
        panel.style.setProperty('right', 'auto', 'important');
        panel.style.setProperty('bottom', 'auto', 'important');
      },
      onEnd: (drag) => {
        panel.style.cursor = '';
        panel.style.userSelect = '';

        if (!drag.moved) return;
        // Save collapse button center position
        try {
          const collapseBtn = panel.querySelector('.toc-header-row .toc-btn:last-child');
          if (collapseBtn && setBadgePosByHost) {
            const btnRect = collapseBtn.getBoundingClientRect();
            const x = btnRect.left + btnRect.width / 2;
            const y = btnRect.top + btnRect.height / 2;
            if (Number.isFinite(x) && Number.isFinite(y)) {
              setBadgePosByHost(location.host, { x, y });
            }
          }
        } catch (_) {}
      }
    }) : null;

    const origRemove = panel.remove.bind(panel);
    const onPickerStart = () => {
      btnPick.classList.add('toc-btn-active');
      btnPick.setAttribute('aria-pressed', 'true');
    };
    const onPickerEnd = () => {
      btnPick.classList.remove('toc-btn-active');
      btnPick.setAttribute('aria-pressed', 'false');
      if (document.activeElement === btnPick) {
        btnPick.blur();
      }
    };

    const removePickerStartListener = addWindowListener(pickerStartEvent, onPickerStart);
    const removePickerEndListener = addWindowListener(pickerEndEvent, onPickerEnd);

    const stopRemovalWatch = () => {
      if (removalObserver) {
        try { removalObserver.disconnect(); } catch (_) {}
        removalObserver = null;
      }
      if (removalTimer != null) {
        try { clearTimeout(removalTimer); } catch (_) {}
        removalTimer = null;
      }
    };

    const cleanup = ({ removedExternally } = {}) => {
      if (cleanedUp) return;
      cleanedUp = true;
      stopRemovalWatch();
      try { if (onListClick) list.removeEventListener('click', onListClick); } catch (_) {}
      try { if (onListKeydown) list.removeEventListener('keydown', onListKeydown); } catch (_) {}
      onListClick = null;
      onListKeydown = null;
      try { if (onBtnCollapseClick) btnCollapse.removeEventListener('click', onBtnCollapseClick); } catch (_) {}
      try { if (onBtnPickClick) btnPick.removeEventListener('click', onBtnPickClick); } catch (_) {}
      try { if (onBtnManageClick) btnManage.removeEventListener('click', onBtnManageClick); } catch (_) {}
      try { if (onBtnRefreshClick) btnRefresh.removeEventListener('click', onBtnRefreshClick); } catch (_) {}
      onBtnCollapseClick = null;
      onBtnPickClick = null;
      onBtnManageClick = null;
      onBtnRefreshClick = null;
      try { if (onPanelKeydown) panel.removeEventListener('keydown', onPanelKeydown, true); } catch (_) {}
      onPanelKeydown = null;
      try { resolveShown && resolveShown(); } catch (_) {}
      try { removeResizeListener && removeResizeListener(); } catch (_) {}
      try { removeScrollListener && removeScrollListener(); } catch (_) {}
      try { removePickerStartListener && removePickerStartListener(); } catch (_) {}
      try { removePickerEndListener && removePickerEndListener(); } catch (_) {}
      try { listenersController && listenersController.abort && listenersController.abort(); } catch (_) {}
      cleanupLock();
      if (expandAnimTimer) clearTimeout(expandAnimTimer);
      expandAnimTimer = null;
      try {
        if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      } catch (_) {}
      resizeRaf = null;
      try {
        if (showRaf != null) cancelAnimationFrame(showRaf);
      } catch (_) {}
      showRaf = null;
      dragController && dragController.destroy && dragController.destroy();
      dragController = null;

      if (!removedExternally) {
        try {
          if (panel && panel.isConnected) origRemove();
        } catch (_) {}
      }
    };

    try {
      panel.__TOC_CLEANUP__ = () => cleanup({ removedExternally: true });
    } catch (_) {}

    const startRemovalWatch = () => {
      stopRemovalWatch();
      if (typeof MutationObserver !== 'undefined' && document && document.documentElement) {
        try {
          removalObserver = new MutationObserver(() => {
            if (cleanedUp) return;
            if (panel && panel.isConnected) return;
            cleanup({ removedExternally: true });
          });
          removalObserver.observe(document.documentElement, { childList: true, subtree: true });
          return;
        } catch (_) {
          removalObserver = null;
        }
      }

      const tick = () => {
        removalTimer = null;
        if (cleanedUp) return;
        if (panel && panel.isConnected) {
          // MutationObserver isn't available; poll at a low frequency to avoid per-frame CPU use.
          try { removalTimer = setTimeout(tick, 1000); } catch (_) {}
          return;
        }
        cleanup({ removedExternally: true });
      };
      try { removalTimer = setTimeout(tick, 1000); } catch (_) {}
    };

    startRemovalWatch();

    panel.remove = () => cleanup({ removedExternally: false });

    // Active highlight via IntersectionObserver
    if (items.length && 'IntersectionObserver' in window) {
      const map = new Map();
      const topByEl = new Map();
      items.forEach(it => {
        if (it.el) {
          map.set(it.el, it);
        }
      });
      let active;
      const intersecting = new Set();

      const clearAllActive = () => {
        items.forEach(item => {
          if (item._node) {
            item._node.classList.remove('active');
            try { item._node.removeAttribute('aria-current'); } catch (_) {}
          }
        });
        active = null;
      };

      intersectionObserver = new IntersectionObserver((entries) => {
        if (cleanedUp) return;
        if (!panel || !panel.isConnected) {
          try { intersectionObserver && intersectionObserver.disconnect(); } catch (_) {}
          intersectionObserver = null;
          return;
        }
        // Skip updates during rebuild to prevent page jumps
        if (getNavLock()) return;
        const { isRebuilding } = window.TOC_APP || {};
        if (isRebuilding && isRebuilding()) return;

        const userSelected = items.find(it => it._userSelected);
        if (userSelected) {
          clearAllActive();
          if (userSelected._node && !userSelected._node.classList.contains('active')) {
            userSelected._node.classList.add('active');
            try { userSelected._node.setAttribute('aria-current', 'location'); } catch (_) {}
            active = userSelected;
          }
          return;
        }

        entries.forEach(entry => {
          try {
            if (entry && entry.target && !document.contains(entry.target)) {
              intersectionObserver && intersectionObserver.unobserve && intersectionObserver.unobserve(entry.target);
              const it = map.get(entry.target);
              if (it) {
                intersecting.delete(it);
                try { topByEl.delete(it.el); } catch (_) {}
              }
              return;
            }
          } catch (_) {}
          const it = map.get(entry.target);
          if (!it || !it._node) return;
          if (entry.isIntersecting) {
            intersecting.add(it);
            try {
              if (entry.boundingClientRect && Number.isFinite(entry.boundingClientRect.top)) {
                topByEl.set(it.el, entry.boundingClientRect.top);
              }
            } catch (_) {}
          } else {
            intersecting.delete(it);
            try { topByEl.delete(it.el); } catch (_) {}
          }
        });

        const visibleItems = Array.from(intersecting).filter(it => it.el && document.contains(it.el));
        visibleItems.sort((a, b) => {
          const ta = topByEl.has(a.el) ? topByEl.get(a.el) : 0;
          const tb = topByEl.has(b.el) ? topByEl.get(b.el) : 0;
          return ta - tb;
        });

        if (visibleItems.length > 0) {
          const newActive = visibleItems[0];
          if (active !== newActive) {
            clearAllActive();
            newActive._node.classList.add('active');
            try { newActive._node.setAttribute('aria-current', 'location'); } catch (_) {}
            active = newActive;
          }
        }
      }, { root: null, rootMargin: '0px 0px -65% 0px', threshold: 0.1 });

      observeRaf = requestAnimationFrame(() => {
        observeRaf = null;
        if (cleanedUp) return;
        if (!panel || !panel.isConnected) return;
        if (!intersectionObserver) return;
        items.forEach(it => {
          if (it.el && document.contains(it.el)) {
            intersectionObserver.observe(it.el);
          }
        });
      });
    }

    return {
      remove() { panel.remove(); },
      whenShown
    };
  }

  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.renderFloatingPanel = renderFloatingPanel;
})();
