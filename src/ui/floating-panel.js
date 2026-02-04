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
      document.querySelectorAll('.toc-floating').forEach(el => el.remove());
    } catch (_) {}

    const panel = document.createElement('div');
    const listenersController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const listenerSignal = listenersController ? listenersController.signal : null;
    const addWindowListener = (type, handler, options) => {
      try {
        if (listenerSignal) {
          window.addEventListener(type, handler, { ...(options || {}), signal: listenerSignal });
          return;
        }
      } catch (_) {}
      window.addEventListener(type, handler, options);
    };

    let resolveShown = null;
    const whenShown = new Promise((resolve) => { resolveShown = resolve; });
    let unlockTimer = null;
    let scrollStopTimer = null;
    let intersectionObserver = null;
    let observeRaf = null;
    const pickerStartEvent = 'toc-picker-start';
    const pickerEndEvent = 'toc-picker-end';

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
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        constrainCurrentPosition();
      });
    };
    const RESIZE_LISTENER_OPTS = { passive: true };
    const SCROLL_LISTENER_OPTS = { passive: true };
    addWindowListener('resize', onResize, RESIZE_LISTENER_OPTS);

    const unlockLater = () => {
      if (unlockTimer) clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => {
        setNavLock(false);

        if (getPendingRebuild && getPendingRebuild()) {
          setTimeout(async () => {
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

        setTimeout(() => {
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

    addWindowListener('scroll', onScroll, SCROLL_LISTENER_OPTS);
    const cleanupLock = () => {
      try { window.removeEventListener('scroll', onScroll, SCROLL_LISTENER_OPTS); } catch (_) {}
      if (unlockTimer) clearTimeout(unlockTimer);
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
      }
      if (typeof observeRaf === 'number') {
        try { cancelAnimationFrame(observeRaf); } catch (_) {}
      }
      observeRaf = null;
    };

    panel.className = `toc-floating toc-floating-${side === 'left' ? 'left' : 'right'} toc-floating-expand`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.addEventListener('keydown', (e) => {
      if (!e) return;
      if (e.key === 'Escape') {
        try { e.preventDefault(); } catch (_) {}
        onCollapse && onCollapse();
      }
    }, true);

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
    btnCollapse.addEventListener('click', () => onCollapse());

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
    btnPick.addEventListener('click', () => onPick && onPick());

    const btnManage = document.createElement('button');
    btnManage.className = 'toc-btn';
    btnManage.textContent = msg('buttonSiteConfig');
    btnManage.title = msg('buttonSiteConfigTitle');
    btnManage.setAttribute('aria-label', msg('buttonSiteConfigTitle') || msg('buttonSiteConfig'));
    btnManage.addEventListener('click', () => onSiteConfig && onSiteConfig());

    const actionsRight = document.createElement('div');
    actionsRight.className = 'toc-actions-right';

    const btnRefresh = document.createElement('button');
    btnRefresh.className = 'toc-btn';
    btnRefresh.textContent = msg('buttonRefresh');
    btnRefresh.title = msg('buttonRefreshTitle');
    btnRefresh.setAttribute('aria-label', msg('buttonRefreshTitle') || msg('buttonRefresh'));
    let refreshing = false;
    btnRefresh.addEventListener('click', async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        if (onRefresh) await onRefresh();
      } finally {
        refreshing = false;
      }
    });

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

      list.addEventListener('click', (e) => {
        const node = e.target.closest('.toc-item');
        if (!node || !list.contains(node)) return;
        const idx = parseInt(node.dataset.index, 10);
        const item = items[idx];
        if (!item) return;
        handleItemClick(item, node, e);
      });

      list.addEventListener('keydown', (e) => {
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
      });
    }

    panel.appendChild(header);
    panel.appendChild(list);
    document.documentElement.appendChild(panel);

    // Show panel and trigger expand animation
    requestAnimationFrame(() => {
      panel.style.visibility = '';
      panel.classList.add('toc-expanded');
      try { resolveShown && resolveShown(); } catch (_) {}
      setTimeout(() => {
        panel.classList.remove('toc-floating-expand', 'toc-expanded');
      }, EXPAND_ANIM_MS);
    });

    // Make header draggable
    const { createDragController } = window.TOC_DRAG || {};
    const dragController = createDragController ? createDragController({
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
    window.addEventListener(pickerStartEvent, onPickerStart);
    window.addEventListener(pickerEndEvent, onPickerEnd);

    panel.remove = () => {
      try { resolveShown && resolveShown(); } catch (_) {}
      try { listenersController && listenersController.abort && listenersController.abort(); } catch (_) {}
      cleanupLock();
      try { window.removeEventListener('resize', onResize, RESIZE_LISTENER_OPTS); } catch (_) {}
      try {
        if (typeof resizeRaf === 'number') cancelAnimationFrame(resizeRaf);
      } catch (_) {}
      resizeRaf = null;
      window.removeEventListener(pickerStartEvent, onPickerStart);
      window.removeEventListener(pickerEndEvent, onPickerEnd);
      dragController && dragController.destroy && dragController.destroy();
      origRemove();
    };

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
