(() => {
  const { getConfigs, findMatchingConfig, collectBySelector, uniqueInDocumentOrder, scrollToElement, saveConfigs } = window.TOC_UTILS || {};
  if (!getConfigs) return;

  function buildTocItemsFromSelectors(selectors, cfg) {
    const elements = [];
    const list = Array.isArray(selectors) ? selectors : [];
    for (const sel of list) {
      try {
        const nodes = collectBySelector(sel);
        for (const node of nodes) {
          elements.push(node);
        }
      } catch (e) {
        // ignore selector error
      }
    }
    const keepEmpty = !!(cfg && cfg.keepEmptyText);
    const uniq = uniqueInDocumentOrder(elements)
      .map((el, i) => ({
        id: 'toc-item-' + i,
        el,
        text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ')
      }))
      .filter(item => keepEmpty ? true : (item.text && item.text.length > 0));
    return uniq;
  }

  // backward-compatible wrapper
  function buildTocItems(cfg, extraSelectors = []) {
    const base = Array.isArray(cfg.selectors) ? cfg.selectors : [];
    let combined = (Array.isArray(extraSelectors) ? extraSelectors : []).concat(base);
    
    // 如果没有任何选择器，使用默认的标题选择器
    if (combined.length === 0) {
      combined = [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6' }];
    }
    
    return buildTocItemsFromSelectors(combined, cfg);
  }

  function renderCollapsedBadge(side, onExpand) {
    const badge = document.createElement('div');
    badge.className = `toc-collapsed-badge ${side === 'left' ? 'left' : 'right'}`;
    badge.textContent = '目录';
    badge.title = '展开目录';

    // 读取保存位置（每个域名记忆）
    const posKey = `tocBadgePos::${location.host}`;
    try {
      const saved = localStorage.getItem(posKey);
      if (saved) {
        const { left, top } = JSON.parse(saved);
        if (typeof left === 'number' && typeof top === 'number') {
          // 检查保存的位置是否在当前屏幕范围内
          const bw = 80; // 预估badge宽度
          const bh = 32; // 预估badge高度
          const maxLeft = window.innerWidth - bw - 4;
          const maxTop = window.innerHeight - bh - 4;
          const docLeft = left - window.scrollX;
          const docTop = top - window.scrollY;
          
          // 如果位置在屏幕范围内，则使用保存的位置
          if (docLeft >= 4 && docLeft <= maxLeft && docTop >= 4 && docTop <= maxTop) {
            badge.style.left = left + 'px';
            badge.style.top = top + 'px';
            badge.classList.remove('left', 'right');
          }
          // 否则使用默认位置（不设置left/top，保持CSS中的默认位置）
        }
      }
    } catch {}

    // 拖拽支持
    let drag = { active: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0, moved: false };
    
    function onMouseDown(e) {
      // 防止在其他元素上触发拖拽
      if (e.target !== badge) return;
      
      drag.active = true;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.moved = false;
      
      // 计算鼠标相对于badge的偏移
      const rect = badge.getBoundingClientRect();
      drag.offsetX = e.clientX - rect.left;
      drag.offsetY = e.clientY - rect.top;
      
      // 添加拖拽样式
      badge.style.cursor = 'grabbing';
      badge.style.userSelect = 'none';
      
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mouseup', onMouseUp, true);
      
      e.preventDefault();
      e.stopPropagation();
    }
    
    function onMouseMove(e) {
      if (!drag.active) return;
      
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      
      // 检测是否开始拖拽（移动超过阈值）
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        drag.moved = true;
      }
      
      // 计算新位置（相对于视口）
      let left = e.clientX - drag.offsetX;
      let top = e.clientY - drag.offsetY;
      
      // 获取badge尺寸
      const bw = badge.offsetWidth || 80;
      const bh = badge.offsetHeight || 32;
      
      // 限制在视口内（考虑滚动）
      const minLeft = 4;
      const minTop = 4;
      const maxLeft = window.innerWidth - bw - 4;
      const maxTop = window.innerHeight - bh - 4;
      
      left = Math.max(minLeft, Math.min(maxLeft, left));
      top = Math.max(minTop, Math.min(maxTop, top));
      
      // 转换为文档坐标
      const docLeft = left + window.scrollX;
      const docTop = top + window.scrollY;
      
      badge.style.left = docLeft + 'px';
      badge.style.top = docTop + 'px';
      badge.style.right = 'auto';
      badge.style.bottom = 'auto';
      
      // 移除侧位类，使用绝对定位
      badge.classList.remove('left', 'right');
      
      e.preventDefault();
    }
    
    function onMouseUp(e) {
      if (!drag.active) return;
      
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      
      // 恢复样式
      badge.style.cursor = 'pointer';
      badge.style.userSelect = '';
      
      drag.active = false;
      
      // 如果没有拖拽，则执行点击展开
      if (!drag.moved) {
        onExpand();
      } else {
        // 保存位置（使用文档坐标）
        try {
          const rect = badge.getBoundingClientRect();
          const left = rect.left + window.scrollX;
          const top = rect.top + window.scrollY;
          localStorage.setItem(posKey, JSON.stringify({ left, top }));
        } catch (err) {
          console.warn('[目录助手] 保存位置失败:', err);
        }
      }
      
      e.preventDefault();
      e.stopPropagation();
    }
    badge.addEventListener('mousedown', onMouseDown, true);

    document.documentElement.appendChild(badge);

    return {
      remove() { badge.remove(); }
    };
  }

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
    header.innerHTML = `<span>目录</span>`;
    const actions = document.createElement('div');
    actions.className = 'toc-actions';

    const btnCollapse = document.createElement('button');
    btnCollapse.className = 'toc-btn';
    btnCollapse.textContent = '收起';
    btnCollapse.title = '收起为浮动按钮';
    btnCollapse.addEventListener('click', () => onCollapse());

    const btnRefresh = document.createElement('button');
    btnRefresh.className = 'toc-btn';
    btnRefresh.textContent = '刷新';
    btnRefresh.title = '重新扫描页面生成目录';
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

    const btnPick = document.createElement('button');
    btnPick.className = 'toc-btn';
    btnPick.textContent = '拾取元素';
    btnPick.title = '点击后在页面上选择一个元素以生成选择器';
    btnPick.addEventListener('click', () => onPick && onPick());

    const btnManage = document.createElement('button');
    btnManage.className = 'toc-btn';
    btnManage.textContent = '保存管理';
    btnManage.title = '查看/清空当前站点已保存的选择器';
    btnManage.addEventListener('click', () => onManageSave && onManageSave());

    actions.appendChild(btnPick);
    actions.appendChild(btnRefresh);
    actions.appendChild(btnManage);
    actions.appendChild(btnCollapse);
    header.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'toc-list';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = '未找到目录项，可尝试点击右上角"刷新"。';
      list.appendChild(empty);
    } else {
      for (const item of items) {
        const a = document.createElement('a');
        a.className = 'toc-item';
        a.textContent = item.text;
        a.href = 'javascript:void(0)';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          
          // 立即锁定导航，防止IntersectionObserver干扰
          setNavLock(true);
          
          // 先标记当前项为用户选择，防止被其他逻辑覆盖
          item._userSelected = true;
          
          // 清除其他项的选中状态和active样式
          items.forEach(it => {
            if (it !== item) {
              it._userSelected = false;
              if (it._node) {
                it._node.classList.remove('active');
              }
            }
          });
          
          // 设置当前项的active样式（避免重复添加）
          if (!a.classList.contains('active')) {
            a.classList.add('active');
          }
          
          // 平滑滚动
          try {
            item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch {
            scrollToElement(item.el);
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
      const io = new IntersectionObserver((entries) => {
        // 如果导航被锁定，完全跳过处理
        if (getNavLock()) return;
        
        // 检查是否有用户手动选择的项目
        const userSelected = items.find(it => it._userSelected);
        if (userSelected) {
          // 如果有用户选择的项目，确保其保持active状态，跳过其他处理
          if (userSelected._node && !userSelected._node.classList.contains('active')) {
            userSelected._node.classList.add('active');
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
            // 清除旧的active状态
            if (active && active._node) {
              active._node.classList.remove('active');
            }
            // 设置新的active状态
            newActive._node.classList.add('active');
            active = newActive;
          }
        }
      }, { root: null, rootMargin: '0px 0px -65% 0px', threshold: 0.1 });

      items.forEach(it => io.observe(it.el));
    }

    return {
      remove() { panel.remove(); }
    };
  }

  // Utilities to build simple CSS selector for an element
  function buildClassSelector(el) {
    if (!el || !el.classList || el.classList.length === 0) return '';
    const classes = Array.from(el.classList).slice(0, 3); // limit to first 3
    return classes.length ? '.' + classes.join('.') : '';
  }
  function cssPathFor(el, maxDepth = 4) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && depth < maxDepth && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      const cls = buildClassSelector(cur);
      if (cls) {
        part = part + cls;
      } else {
        // use nth-of-type for uniqueness hint
        const parent = cur.parentElement;
        if (parent) {
          const tag = cur.tagName;
          const siblings = Array.from(parent.children).filter(c => c.tagName === tag);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            part = `${part}:nth-of-type(${idx})`;
          }
        }
      }
      parts.unshift(part);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function showPickerResult(selector, saveCb) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;background:#111;color:#fff;padding:10px;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.3);max-width:60vw;';
    wrap.innerHTML = `
      <div style="font-size:13px;margin-bottom:6px;color:#fff;">已生成选择器：</div>
      <textarea style="width:420px;max-width:58vw;height:68px;font-size:12px;border-radius:6px;border:1px solid #444;padding:8px;background:#fff;color:#222;resize:vertical;" readonly>${selector}</textarea>
      <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">
        <button data-act="save" style="padding:6px 10px;border-radius:6px;border:0;background:#059669;color:#fff;cursor:pointer;">保存为站点配置</button>
        <button data-act="close" style="padding:6px 10px;border-radius:6px;border:1px solid #444;background:#222;color:#fff;cursor:pointer;">关闭</button>
      </div>
    `;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.act === 'close') close();
      if (t.dataset.act === 'save') saveCb && saveCb(selector, close);
    });
    document.documentElement.appendChild(wrap);
    return { close };
  }

  function createElementPicker(onPicked, onCancel) {
    // highlighter box that never captures events
    const highlight = document.createElement('div');
    highlight.style.cssText = 'position:absolute;border:2px solid #2f6feb;background:rgba(47,111,235,0.08);pointer-events:none;z-index:2147483647;left:0;top:0;width:0;height:0;';
    document.documentElement.appendChild(highlight);

    // set cursor crosshair without overlay
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';

    function isUiElement(el) {
      // avoid highlighting our own panel or badge
      if (!el) return false;
      return el.closest && (el.closest('.toc-floating') || el.closest('.toc-collapsed-badge'));
    }

    function box(el) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      // account for scroll position
      const left = r.left + window.scrollX;
      const top = r.top + window.scrollY;
      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${Math.max(0, r.width)}px`;
      highlight.style.height = `${Math.max(0, r.height)}px`;
    }

    function move(e) {
      // Use target directly; if it's UI element, find underlying elementFromPoint ignoring our highlight (pointer-events:none)
      let el = e.target;
      if (isUiElement(el)) {
        el = document.elementFromPoint(e.clientX, e.clientY);
        if (isUiElement(el)) return; // still UI, skip
      }
      if (el && el !== highlight) box(el);
    }

    function click(e) {
      e.preventDefault();
      let el = e.target;
      if (isUiElement(el)) {
        el = document.elementFromPoint(e.clientX, e.clientY);
        if (isUiElement(el)) {
          // click on UI; ignore
          return;
        }
      }
      cleanup();
      if (el && onPicked) onPicked(el);
    }

    function key(e) {
      if (e.key === 'Escape') {
        cleanup();
        onCancel && onCancel();
      }
    }

    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    // 右键取消拾取
    const onCtx = (e) => { e.preventDefault(); cleanup(); onCancel && onCancel(); };
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', key, true);

    // 20s 超时自动取消，避免遗留状态
    let timeoutId = setTimeout(() => { cleanup(); onCancel && onCancel(); }, 20000);
    function cleanup() {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('contextmenu', onCtx, true);
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      if (highlight && highlight.parentNode) highlight.parentNode.removeChild(highlight);
      document.body.style.cursor = prevCursor || '';
    }
    return { cleanup };
  }

  function initForConfig(cfg) {
    const side = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';

    let items = buildTocItems(cfg, []);
    let badgeInstance = null;
    let panelInstance = null;

    let navLock = false;
    const getNavLock = () => navLock;
    const setNavLock = (v) => { navLock = !!v; };

    // MutationObserver相关变量
    let observer = null;
    const DEBOUNCE_MS = 500;
    let shouldRebuildAt = 0;
    let pendingRebuild = false;
    let tickTimer = null;

    async function manageSave() {
      try {
        const configs = await getConfigs();
        const urlPattern = `${location.protocol}//${location.host}/*`;
        const idx = configs.findIndex(c => c && c.urlPattern === urlPattern);
        const list = idx >= 0 && Array.isArray(configs[idx].selectors) ? configs[idx].selectors : [];
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;background:#111;color:#fff;padding:10px;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.3);max-width:60vw;';
        const savedListHtml = (list && list.length ? list.map(s => s.type + ':' + s.expr).join('<br>') : '（无）');
        box.innerHTML =
          '<div style="font-size:13px;margin-bottom:6px">当前站点（' + urlPattern + '）已保存选择器：' + (list ? list.length : 0) + '</div>' +
          '<div style="max-height:180px;overflow:auto;font-size:12px;background:#1e1e1e;border-radius:6px;padding:6px;margin-bottom:8px;">' + savedListHtml + '</div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          '  <button data-act="clear" style="padding:6px 10px;border-radius:6px;border:0;background:#b42318;color:#fff;">清空站点配置</button>' +
          '  <button data-act="close" style="padding:6px 10px;border-radius:6px;border:1px solid #444;background:#222;color:#fff;">关闭</button>' +
          '</div>';
        const close = () => box.remove();
        box.addEventListener('click', async (e) => {
          const t = e.target;
          if (!t || !t.dataset) return;
          if (t.dataset.act === 'close') close();
          if (t.dataset.act === 'clear') {
            if (idx >= 0) {
              configs.splice(idx, 1);
              await saveConfigs(configs);
              cfg.selectors = [];
              await rebuild();
            }
            close();
          }
        });
        document.documentElement.appendChild(box);
      } catch (e) {
        console.error('读取/清空站点配置失败', e);
        alert('操作失败，请查看控制台。');
      }
    }

    const rebuild = async () => {
      try {
        const configs = await getConfigs();
        const urlPattern = `${location.protocol}//${location.host}/*`;
        const idxNow = configs.findIndex(c => c && c.urlPattern === urlPattern);
        if (idxNow >= 0) {
          const latest = configs[idxNow];
          cfg.selectors = Array.isArray(latest.selectors) ? latest.selectors.slice() : [];
          cfg.side = (latest.side === 'left' || latest.side === 'right') ? latest.side : cfg.side;
        } else {
          cfg.selectors = [];
        }
      } catch (e) {
        console.warn('[目录助手] 读取最新配置失败，使用内存状态', e);
      }
      
      const newItems = buildTocItems(cfg, []);
      
      // 检查是否需要重建：只有在用户交互锁定期间才跳过重建
      if (panelInstance && getNavLock()) {
        // 在锁定期间，保存新的items但不立即重建
        items = newItems;
        return;
      }
      
      // 如果内容完全相同，避免不必要的重建（仅在非锁定状态下检查）
      if (panelInstance && items.length === newItems.length && items.length > 0) {
        let contentIdentical = true;
        for (let i = 0; i < items.length; i++) {
          if (items[i].text !== newItems[i].text || items[i].el !== newItems[i].el) {
            contentIdentical = false;
            break;
          }
        }
        
        if (contentIdentical) {
          // 内容完全相同，不需要重建
          return;
        }
      }
      
      // 保存当前活跃项的状态
      let currentActiveItem = null;
      let wasLocked = getNavLock();
      if (panelInstance && items.length > 0) {
        currentActiveItem = items.find(item => item._node && item._node.classList.contains('active'));
      }
      
      items = newItems;
      if (panelInstance) {
        panelInstance.remove();
        panelInstance = renderFloatingPanel(side, items, collapse, rebuild, startPick, manageSave, getNavLock, setNavLock, () => pendingRebuild, (val) => { pendingRebuild = val; });
        
        // 恢复之前的活跃状态
        if (currentActiveItem && items.length > 0) {
          // 尝试找到相同文本的项目来恢复状态
          const matchingItem = items.find(item => item.text === currentActiveItem.text);
          if (matchingItem && matchingItem._node) {
            matchingItem._node.classList.add('active');
            if (wasLocked) {
              matchingItem._userSelected = true;
              setNavLock(true);
            }
          }
        }
      }
    };

    function startPick() {
      const picker = createElementPicker((el) => {
        // 优先 class 选择器，不足时生成路径
        let sel = '';
        const cls = buildClassSelector(el);
        if (cls) sel = `${el.tagName.toLowerCase()}${cls}`;
        if (!sel) sel = cssPathFor(el);
        showPickerResult(sel, async (selector, onDone) => {
          try {
            const configs = await getConfigs();
            const urlPattern = `${location.protocol}//${location.host}/*`;
            const entry = { type: 'css', expr: selector };
            const idx = configs.findIndex(c => c && c.urlPattern === urlPattern);
            const sidePersist = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';
            if (idx >= 0) {
              const existing = configs[idx];
              const arr = Array.isArray(existing.selectors) ? existing.selectors.slice() : [];
              if (!arr.some(s => s.type === 'css' && s.expr === selector)) {
                arr.unshift(entry);
              }
              configs[idx] = { ...existing, side: sidePersist, urlPattern, selectors: arr };
            } else {
              configs.push({ urlPattern, side: sidePersist, selectors: [entry], collapsedDefault: false });
            }
            await saveConfigs(configs);
            onDone && onDone();
            // 保存后直接重建（仅基于持久配置）
            await rebuild();
          } catch (e) {
            console.error('保存站点配置失败', e);
            alert('保存失败，请查看控制台。');
          }
        });
      }, () => {
        // canceled
      });
    }

    function collapse() {
      if (panelInstance) { panelInstance.remove(); panelInstance = null; }
      if (!badgeInstance) {
        console.debug('[目录助手] 折叠模式初始化，准备渲染按钮');
        badgeInstance = renderCollapsedBadge(side, expand);
      }
    }
    async function expand() {
      if (badgeInstance) { badgeInstance.remove(); badgeInstance = null; }
      // 展开前先确保 items 基于最新存储
      await rebuild();
      if (!panelInstance) {
        panelInstance = renderFloatingPanel(side, items, collapse, rebuild, startPick, manageSave, getNavLock, setNavLock, () => pendingRebuild, (val) => { pendingRebuild = val; });
      }
    }

    // 检查是否有有效的元素选择器
    function hasValidSelectors() {
      if (cfg.selectors && cfg.selectors.length > 0) {
        return true;
      }
      
      const commonSelectors = [
        'h1, h2, h3, h4, h5, h6',
        '[id*="title"], [class*="title"]',
        '[id*="heading"], [class*="heading"]'
      ];
      
      for (let selector of commonSelectors) {
        try {
          if (document.querySelector(selector)) {
            return true;
          }
        } catch (e) {
          console.warn('[目录助手] 选择器错误:', selector, e);
        }
      }
      
      return false;
    }

    // Observe & Debounce: 稳健版（标志+轮询tick，避免丢计时器）

    function hasMeaningfulChange(mutations) {
      for (const m of mutations) {
        if (m.type === 'childList') {
          if ((m.addedNodes && m.addedNodes.length) || (m.removedNodes && m.removedNodes.length)) return true;
        }
        if (m.type === 'characterData') return true;
        if (m.type === 'attributes') {
          const name = m.attributeName || '';
          if (name === 'hidden' || name.startsWith('data-') || name.startsWith('aria-')) return true;
        }
      }
      return false;
    }

    function ensureTick() {
      if (tickTimer) return;
      tickTimer = setInterval(async () => {
        const now = Date.now();
        if (getNavLock()) {
          // 锁定期间仅置位，等解锁后一次性执行
          if (shouldRebuildAt > 0) pendingRebuild = true;
          return;
        }
        if (shouldRebuildAt > 0 && now >= shouldRebuildAt) {
          shouldRebuildAt = 0;
          pendingRebuild = false;
          try {
            // 页面内容变化时总是执行重建
            await rebuild();
          } catch (e) {}
        }
        // 处理解锁后的待处理重建
        if (pendingRebuild && !getNavLock()) {
          pendingRebuild = false;
          try {
            await rebuild();
          } catch (e) {}
        }
      }, 200); // 轮询粒度200ms，轻量
    }

    // 只有在有有效选择器的情况下才启动观察器
    if (typeof MutationObserver !== 'undefined' && hasValidSelectors()) {
      console.debug('[目录助手] 检测到有效选择器，启动页面变化监听');
      observer = new MutationObserver((mutations) => {
        if (!hasMeaningfulChange(mutations)) return;
        // 每次变化推迟到当前时间+DEBOUNCE_MS (500ms)
        shouldRebuildAt = Date.now() + DEBOUNCE_MS;
        ensureTick();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });
    } else {
      console.debug('[目录助手] 没有有效的元素选择器，跳过页面变化监听');
    }

    // 总是先折叠为右侧"目录"按钮，用户点击后再展开
    collapse();
  }

  function main() {
    console.debug('[目录助手] 内容脚本启动于', location.href);
    getConfigs().then((configs) => {
      let cfg = findMatchingConfig(configs, location.href);
      if (!cfg) {
        cfg = { urlPattern: `${location.protocol}//${location.host}/*`, side: 'right', selectors: [], collapsedDefault: false };
        console.debug('[目录助手] 未找到配置，使用默认空配置启动面板');
      } else {
        console.debug('[目录助手] 命中配置', cfg.urlPattern);
      }
      setTimeout(() => initForConfig(cfg), 0);
    }).catch(err => {
      console.error('[目录助手] 读取配置失败', err);
      // 兜底也初始化
      const cfg = { urlPattern: `${location.protocol}//${location.host}/*`, side: 'right', selectors: [], collapsedDefault: false };
      setTimeout(() => initForConfig(cfg), 0);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main, { once: true });
  } else {
    main();
  }
})();