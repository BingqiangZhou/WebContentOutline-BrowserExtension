(() => {
  'use strict';

  const { msg = (key) => key, setBadgePosByHost } = window.TOC_UTILS || {};

  const UNLOCK_AFTER_MS = 1000;
  const SCROLL_STOP_MS = 500;
  const PANEL_WIDTH = 280;
  const PANEL_HEIGHT = 400;

  function renderFloatingPanel(side, items, onCollapse, onRefresh, onPick, onSiteConfig, getNavLock, setNavLock, getPendingRebuild, setPendingRebuild, panelPos, tocMeta) {
    // Remove any existing panel to prevent duplicates
    try {
      document.querySelectorAll('.toc-floating').forEach(el => el.remove());
    } catch (_) {}

    const panel = document.createElement('div');
    let unlockTimer = null;
    let scrollStopTimer = null;
    let intersectionObserver = null;
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
          }, 100);
        }

        setTimeout(() => {
          items.forEach(it => {
            it._userSelected = false;
          });
        }, 200);
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

    window.addEventListener('scroll', onScroll, { passive: true });
    const cleanupLock = () => {
      window.removeEventListener('scroll', onScroll);
      if (unlockTimer) clearTimeout(unlockTimer);
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
      }
    };

    panel.className = `toc-floating toc-floating-${side === 'left' ? 'left' : 'right'} toc-floating-expand`;

    const header = document.createElement('div');
    header.className = 'toc-header';

    const headerRow = document.createElement('div');
    headerRow.className = 'toc-header-row';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'toc-title';
    titleSpan.textContent = msg('tocTitle');

    const btnCollapse = document.createElement('button');
    btnCollapse.className = 'toc-btn';
    btnCollapse.textContent = msg('buttonCollapse');
    btnCollapse.title = msg('buttonCollapseTitle');
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
    btnPick.setAttribute('aria-pressed', 'false');
    btnPick.addEventListener('click', () => onPick && onPick());

    const btnManage = document.createElement('button');
    btnManage.className = 'toc-btn';
    btnManage.textContent = msg('buttonSiteConfig');
    btnManage.title = msg('buttonSiteConfigTitle');
    btnManage.addEventListener('click', () => onSiteConfig && onSiteConfig());

    const actionsRight = document.createElement('div');
    actionsRight.className = 'toc-actions-right';

    const btnRefresh = document.createElement('button');
    btnRefresh.className = 'toc-btn';
    btnRefresh.textContent = msg('buttonRefresh');
    btnRefresh.title = msg('buttonRefreshTitle');
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

    if (tocMeta && tocMeta.truncated) {
      const note = document.createElement('div');
      note.className = 'toc-empty';
      const max = tocMeta.maxItems || 400;
      const msgText = msg('truncatedNotice');
      note.textContent = msgText && msgText !== 'truncatedNotice'
        ? msgText
        : `For performance, TOC shows at most ${max} items. Refine selectors to narrow results.`;
      list.appendChild(note);
    }

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
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
          }
        });

        item._userSelected = true;
        node.classList.add('active');

        try {
          item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        const key = e.key;
        if (key !== 'Enter' && key !== ' ') return;
        const node = e.target.closest('.toc-item');
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
      setTimeout(() => {
        panel.classList.remove('toc-floating-expand', 'toc-expanded');
      }, 300);
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
        const maxLeft = window.innerWidth - pw - 4;
        const maxTop = window.innerHeight - ph - 4;

        left = Math.max(4, Math.min(maxLeft, left));
        top = Math.max(4, Math.min(maxTop, top));

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
      cleanupLock();
      window.removeEventListener(pickerStartEvent, onPickerStart);
      window.removeEventListener(pickerEndEvent, onPickerEnd);
      dragController && dragController.destroy && dragController.destroy();
      origRemove();
    };

    // Active highlight via IntersectionObserver
    if (items.length && 'IntersectionObserver' in window) {
      const map = new Map();
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
            active = userSelected;
          }
          return;
        }

        entries.forEach(entry => {
          const it = map.get(entry.target);
          if (!it || !it._node) return;
          if (entry.isIntersecting) intersecting.add(it);
          else intersecting.delete(it);
        });

        const visibleItems = Array.from(intersecting).filter(it => it.el && document.contains(it.el));
        visibleItems.sort((a, b) => {
          try {
            return a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top;
          } catch (_) {
            return 0;
          }
        });

        if (visibleItems.length > 0) {
          const newActive = visibleItems[0];
          if (active !== newActive) {
            clearAllActive();
            newActive._node.classList.add('active');
            active = newActive;
          }
        }
      }, { root: null, rootMargin: '0px 0px -65% 0px', threshold: 0.1 });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (intersectionObserver) {
            items.forEach(it => {
              if (it.el && document.contains(it.el)) {
                intersectionObserver.observe(it.el);
              }
            });
          }
        });
      });
    }

    return {
      remove() { panel.remove(); }
    };
  }

  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.renderFloatingPanel = renderFloatingPanel;
})();
