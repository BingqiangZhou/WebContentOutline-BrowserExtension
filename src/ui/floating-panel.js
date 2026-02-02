
(() => {
  'use strict';

  
  const { msg } = window.TOC_UTILS || {};
  const safeMsg = msg || ((key) => {
    try { return chrome.i18n.getMessage(key) || key; } catch (_) { return key; }
  });

  
  function renderFloatingPanel(side, items, onCollapse, onRefresh, onPick, onSiteConfig, getNavLock, setNavLock, getPendingRebuild, setPendingRebuild) {
    const panel = document.createElement('div');
    let unlockTimer = null;
    let scrollStopTimer = null;
        let intersectionObserver = null;
    const pickerStartEvent = 'toc-picker-start';
    const pickerEndEvent = 'toc-picker-end';
    const UNLOCK_AFTER_MS = 1000;
    const SCROLL_STOP_MS = 500;

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

    panel.className = `toc-floating ${side === 'left' ? 'left' : 'right'}`;

    const header = document.createElement('div');
    header.className = 'toc-header';

    const headerRow = document.createElement('div');
    headerRow.className = 'toc-header-row';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'toc-title';
    titleSpan.textContent = safeMsg('tocTitle');

    const btnCollapse = document.createElement('button');
    btnCollapse.className = 'toc-btn';
    btnCollapse.textContent = safeMsg('buttonCollapse');
    btnCollapse.title = safeMsg('buttonCollapseTitle');
    btnCollapse.addEventListener('click', () => onCollapse());

    headerRow.appendChild(titleSpan);
    headerRow.appendChild(btnCollapse);

    const actions = document.createElement('div');
    actions.className = 'toc-actions';

    const actionsLeft = document.createElement('div');
    actionsLeft.className = 'toc-actions-left';

    const btnPick = document.createElement('button');
    btnPick.className = 'toc-btn';
    btnPick.textContent = safeMsg('buttonPickElement');
    btnPick.title = safeMsg('buttonPickElementTitle');
    btnPick.setAttribute('aria-pressed', 'false');
    btnPick.addEventListener('click', () => onPick && onPick());

    const btnManage = document.createElement('button');
    btnManage.className = 'toc-btn';
    btnManage.textContent = safeMsg('buttonSiteConfig');
    btnManage.title = safeMsg('buttonSiteConfigTitle');
    btnManage.addEventListener('click', () => onSiteConfig && onSiteConfig());

    const actionsRight = document.createElement('div');
    actionsRight.className = 'toc-actions-right';

    const btnRefresh = document.createElement('button');
    btnRefresh.className = 'toc-btn';
    btnRefresh.textContent = safeMsg('buttonRefresh');
    btnRefresh.title = safeMsg('buttonRefreshTitle');
    {
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
    }

    actionsLeft.appendChild(btnPick);
    actionsLeft.appendChild(btnManage);
    actionsRight.appendChild(btnRefresh);

    actions.appendChild(actionsLeft);
    actions.appendChild(actionsRight);

    header.appendChild(headerRow);
    header.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'toc-list';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = safeMsg('emptyTocMessage');
      list.appendChild(empty);
    } else {

      items.forEach(item => {
        item._userSelected = false;
      });

      const handleItemClick = (item, node, e) => {
        e.preventDefault();

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
        const a = document.createElement('a');
        a.className = 'toc-item';
        a.textContent = item.text;
        a.href = 'javascript:void(0)';
        a.dataset.index = String(index);
        item._node = a;
        list.appendChild(a);
      });

      list.addEventListener('click', (e) => {
        const node = e.target.closest('.toc-item');
        if (!node || !list.contains(node)) return;
        const idx = parseInt(node.dataset.index, 10);
        const item = items[idx];
        if (!item) return;
        handleItemClick(item, node, e);
      });
    }

    panel.appendChild(header);
    panel.appendChild(list);
    document.documentElement.appendChild(panel);

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
      origRemove();
    };

    // Active highlight via IntersectionObserver
    if (items.length && 'IntersectionObserver' in window) {
      const map = new Map(items.map(it => [it.el, it]));
      let active;

      const clearAllActive = () => {
        items.forEach(item => {
          if (item._node) {
            item._node.classList.remove('active');
          }
        });
        active = null;
      };

      intersectionObserver = new IntersectionObserver((entries) => {

        if (getNavLock()) return;

        const userSelected = items.find(it => it._userSelected);
        if (userSelected) {

          clearAllActive();
          if (userSelected._node && !userSelected._node.classList.contains('active')) {
            userSelected._node.classList.add('active');
            active = userSelected;
          }
          return;
        }

        const visibleItems = [];
        entries.forEach(entry => {
          const it = map.get(entry.target);
          if (it && it._node && entry.isIntersecting) {
            visibleItems.push(it);
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
          items.forEach(it => intersectionObserver.observe(it.el));
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




