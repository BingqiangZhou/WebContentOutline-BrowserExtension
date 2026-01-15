// 浮动面板组件
(() => {
  'use strict';

  /**
   * 获取本地化消息
   */
  function msg(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  /**
   * 渲染浮动面板
   */
  function renderFloatingPanel(side, items, onCollapse, onRefresh, onPick, onManageSave, getNavLock, setNavLock, getPendingRebuild, setPendingRebuild) {
    const panel = document.createElement('div');
    let unlockTimer = null;
    let scrollStopTimer = null;
    const UNLOCK_AFTER_MS = 1000;
    const SCROLL_STOP_MS = 500;

    const unlockLater = () => {
      if (unlockTimer) clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => {
        setNavLock(false);
        // 检查是否有待处理的重建请求
        if (getPendingRebuild && getPendingRebuild()) {
          setTimeout(async () => {
            if (getPendingRebuild && getPendingRebuild()) {
              setPendingRebuild && setPendingRebuild(false);
              try {
                await onRefresh();
              } catch (e) {}
            }
          }, 100);
        }
        // 延迟清除用户选择标记，确保IntersectionObserver不会立即覆盖
        setTimeout(() => {
          items.forEach(it => it._userSelected = false);
        }, 200); // 200ms后清除用户选择标记
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
    };

    panel.className = `toc-floating ${side === 'left' ? 'left' : 'right'}`;

    const header = document.createElement('div');
    header.className = 'toc-header';

    // 创建标题行容器（包含标题和收起按钮）
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

    // 创建操作按钮容器（包含左右两部分）
    const actions = document.createElement('div');
    actions.className = 'toc-actions';

    // 左侧按钮组
    const actionsLeft = document.createElement('div');
    actionsLeft.className = 'toc-actions-left';

    const btnPick = document.createElement('button');
    btnPick.className = 'toc-btn';
    btnPick.textContent = msg('buttonPickElement');
    btnPick.title = msg('buttonPickElementTitle');
    btnPick.addEventListener('click', () => onPick && onPick());

    const btnManage = document.createElement('button');
    btnManage.className = 'toc-btn';
    btnManage.textContent = msg('buttonManageSave');
    btnManage.title = msg('buttonManageSaveTitle');
    btnManage.addEventListener('click', () => onManageSave && onManageSave());

    // 右侧按钮组
    const actionsRight = document.createElement('div');
    actionsRight.className = 'toc-actions-right';

    const btnRefresh = document.createElement('button');
    btnRefresh.className = 'toc-btn';
    btnRefresh.textContent = msg('buttonRefresh');
    btnRefresh.title = msg('buttonRefreshTitle');
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
      empty.textContent = msg('emptyTocMessage');
      list.appendChild(empty);
    } else {
      // 初始化时确保所有项目都没有active状态和用户选择标记
      items.forEach(item => {
        item._userSelected = false;
      });

      for (const item of items) {
        const a = document.createElement('a');
        a.className = 'toc-item';
        a.textContent = item.text;
        a.href = 'javascript:void(0)';
        a.addEventListener('click', (e) => {
          e.preventDefault();

          // 立即锁定导航，防止IntersectionObserver干扰
          setNavLock(true);

          // 先清除所有项的选中状态和active样式
          items.forEach(it => {
            it._userSelected = false;
            if (it._node) {
              it._node.classList.remove('active');
            }
          });

          // 标记当前项为用户选择并设置active样式
          item._userSelected = true;
          a.classList.add('active');

          // 平滑滚动
          try {
            item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch {
            const { scrollToElement } = window.TOC_UTILS || {};
            if (scrollToElement) scrollToElement(item.el);
          }

          // 设置延迟解锁
          unlockLater();
        });
        item._node = a;
        list.appendChild(a);
      }
    }

    panel.appendChild(header);
    panel.appendChild(list);
    document.documentElement.appendChild(panel);

    // 清理钩子
    const origRemove = panel.remove.bind(panel);
    panel.remove = () => { cleanupLock(); origRemove(); };

    // Active highlight via IntersectionObserver
    if (items.length && 'IntersectionObserver' in window) {
      const map = new Map(items.map(it => [it.el, it]));
      let active;

      // 初始化时清除所有active状态，避免重复
      const clearAllActive = () => {
        items.forEach(item => {
          if (item._node) {
            item._node.classList.remove('active');
          }
        });
        active = null;
      };

      const io = new IntersectionObserver((entries) => {
        // 如果导航被锁定，完全跳过处理
        if (getNavLock()) return;

        // 检查是否有用户手动选择的项目
        const userSelected = items.find(it => it._userSelected);
        if (userSelected) {
          // 如果有用户选择的项目，先清除所有active状态，然后只设置用户选择的项目
          clearAllActive();
          if (userSelected._node && !userSelected._node.classList.contains('active')) {
            userSelected._node.classList.add('active');
            active = userSelected;
          }
          return;
        }

        // 找到当前可见的项目
        const visibleItems = [];
        entries.forEach(entry => {
          const it = map.get(entry.target);
          if (it && it._node && entry.isIntersecting) {
            visibleItems.push(it);
          }
        });

        // 如果有可见项目，选择第一个作为active
        if (visibleItems.length > 0) {
          const newActive = visibleItems[0];

          // 只有当新的active与当前active不同时才更新
          if (active !== newActive) {
            // 清除所有active状态
            clearAllActive();
            // 设置新的active状态
            newActive._node.classList.add('active');
            active = newActive;
          }
        }
      }, { root: null, rootMargin: '0px 0px -65% 0px', threshold: 0.1 });

      // 延迟启动IntersectionObserver，避免与初始状态恢复冲突
      setTimeout(() => {
        items.forEach(it => io.observe(it.el));
      }, 100);
    }

    return {
      remove() { panel.remove(); }
    };
  }

  // 导出到全局
  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.renderFloatingPanel = renderFloatingPanel;
})();
