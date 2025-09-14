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
    const combined = (Array.isArray(extraSelectors) ? extraSelectors : []).concat(base);
    return buildTocItemsFromSelectors(combined, cfg);
  }

  function renderCollapsedBadge(side, onExpand) {
    const badge = document.createElement('div');
    // 基本类名，保证样式；再内联兜底样式避免外部CSS异常时不可见
    badge.className = `toc-collapsed-badge ${side === 'left' ? 'left' : 'right'}`;
    badge.textContent = '目录';
    badge.title = '展开目录';
    badge.style.cssText += ';min-width:44px;text-align:center;';

    // 读取保存位置（每个域名记忆）
    const posKey = `tocBadgePos::${location.host}`;
    try {
      const saved = localStorage.getItem(posKey);
      if (saved) {
        const { left, top } = JSON.parse(saved);
        if (typeof left === 'number' && typeof top === 'number') {
          badge.style.left = left + 'px';
          badge.style.top = top + 'px';
          // 移除侧位类，避免left/right样式覆盖
          badge.classList.remove('left', 'right');
        }
      }
    } catch {}

    // 拖拽支持
    let drag = { active: false, startX: 0, startY: 0, baseLeft: 0, baseTop: 0, moved: false };
    function onMouseDown(e) {
      drag.active = true;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      const rect = badge.getBoundingClientRect();
      drag.baseLeft = rect.left + window.scrollX;
      drag.baseTop = rect.top + window.scrollY;
      drag.moved = false;
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mouseup', onMouseUp, true);
      e.preventDefault();
      e.stopPropagation();
    }
    function onMouseMove(e) {
      if (!drag.active) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      let left = drag.baseLeft + dx;
      let top = drag.baseTop + dy;
      // 限制在窗口内
      const bw = badge.offsetWidth || 80;
      const bh = badge.offsetHeight || 32;
      const maxLeft = window.scrollX + window.innerWidth - bw - 4;
      const maxTop = window.scrollY + window.innerHeight - bh - 4;
      left = Math.max(window.scrollX + 4, Math.min(maxLeft, left));
      top = Math.max(window.scrollY + 4, Math.min(maxTop, top));
      badge.style.left = left + 'px';
      badge.style.top = top + 'px';
      // 移除侧位类，使用绝对位置
      badge.classList.remove('left', 'right');
      badge.style.right = 'auto';
    }
    function onMouseUp(e) {
      if (!drag.active) return;
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      drag.active = false;
      // 点击展开阈值
      if (!drag.moved) {
        onExpand();
      } else {
        // 保存位置
        try {
          const rect = badge.getBoundingClientRect();
          const left = rect.left + window.scrollX;
          const top = rect.top + window.scrollY;
          localStorage.setItem(posKey, JSON.stringify({ left, top }));
        } catch {}
      }
    }
    badge.addEventListener('mousedown', onMouseDown, true);

    document.documentElement.appendChild(badge);
    // 可见性自检与兜底定位
    try {
      const w = badge.offsetWidth || 0;
      const h = badge.offsetHeight || 0;
      if (w === 0 || h === 0) {
        // 强制兜底位置与样式
        if (!badge.style.top) badge.style.top = '120px';
        if (!badge.style.left && !badge.style.right) {
          badge.style.right = '16px';
        }
        badge.style.padding = badge.style.padding || '8px 10px';
        badge.style.background = badge.style.background || '#2f6feb';
        badge.style.color = badge.style.color || '#fff';
        badge.style.borderRadius = badge.style.borderRadius || '20px';
        badge.style.zIndex = '2147483647';
      }
    } catch {}

    // 附加安全兜底：若仍无可见尺寸，强制宽高和背景
    if (!badge.offsetWidth || !badge.offsetHeight) {
      badge.style.padding = '8px 10px';
      badge.style.background = '#2f6feb';
      badge.style.color = '#fff';
      badge.style.borderRadius = '20px';
      badge.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
      badge.style.zIndex = '2147483647';
      if (!badge.style.top) badge.style.top = '120px';
      if (!badge.style.right && !badge.style.left) {
        if (side === 'left') badge.style.left = '16px';
        else badge.style.right = '16px';
      }
    }

    return {
      remove() { badge.remove(); }
    };
  }

  function renderFloatingPanel(side, items, onCollapse, onRefresh, onPick, onManageSave, getNavLock, setNavLock) {
    const panel = document.createElement('div');
    // 用户导航锁定由外层维护，这里仅触发解锁时机
    let unlockTimer = null;
    let scrollStopTimer = null;
    const UNLOCK_AFTER_MS = 500;
    const SCROLL_STOP_MS = 300;
    const unlockLater = () => {
      if (unlockTimer) clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => { setNavLock(false); }, UNLOCK_AFTER_MS);
    };
    const onScroll = () => {
      if (!getNavLock()) return;
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(() => { setNavLock(false); }, SCROLL_STOP_MS);
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

    // 临时数量标记


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
      empty.textContent = '未找到目录项，可尝试点击右上角“刷新”。';
      list.appendChild(empty);
    } else {
      for (const item of items) {
        const a = document.createElement('a');
        a.className = 'toc-item';
        a.textContent = item.text;
        a.href = 'javascript:void(0)';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          // 用户点击时，先锁定active，避免IO抢占导致闪烁
          setNavLock(true);
          // 清除旧active
          items.forEach(it => it._node && it._node.classList.remove('active'));
          a.classList.add('active');
          // 平滑滚动
          try {
            item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch {
            scrollToElement(item.el);
          }
          // 设置延迟解锁，或等待滚动停止后解锁
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
        if (getNavLock()) return; // 用户导航锁定期间不更新active，避免闪烁
        entries.forEach(entry => {
          const it = map.get(entry.target);
          if (!it || !it._node) return;
          if (entry.isIntersecting) {
            if (active && active._node) active._node.classList.remove('active');
            it._node.classList.add('active');
            active = it;
          }
        });
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
      <div style="font-size:13px;margin-bottom:6px">已生成选择器：</div>
      <textarea style="width:420px;max-width:58vw;height:68px;font-size:12px;border-radius:6px;border:0;padding:8px;">${selector}</textarea>
      <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">
        <button data-act="save" style="padding:6px 10px;border-radius:6px;border:0;background:#059669;color:#fff;">保存为站点配置</button>
        <button data-act="close" style="padding:6px 10px;border-radius:6px;border:1px solid #444;background:#222;color:#fff;">关闭</button>
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
    const collapsedDefault = !!cfg.collapsedDefault;

    // 取消临时选择器，直接基于已保存配置构建
    // let tempSelectors = [];

    let items = buildTocItems(cfg, []);
    let badgeInstance = null;
    let panelInstance = null;

    // 导航锁状态（供面板与观察器共享）
    let navLock = false;
    const getNavLock = () => navLock;
    const setNavLock = (v) => { navLock = !!v; };

    async function manageSave() {
      try {
        const configs = await getConfigs();
        const urlPattern = `${location.protocol}//${location.host}/*`;
        const idx = configs.findIndex(c => c && c.urlPattern === urlPattern);
        const list = idx >= 0 && Array.isArray(configs[idx].selectors) ? configs[idx].selectors : [];
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;background:#111;color:#fff;padding:10px;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.3);max-width:60vw;';
        var _savedListHtml = (list && list.length ? list.map(function(s){ return (s.type + ':' + s.expr); }).join('<br>') : '（无）');
        box.innerHTML =
          '<div style="font-size:13px;margin-bottom:6px">当前站点（' + urlPattern + '）已保存选择器：' + (list ? list.length : 0) + '</div>' +
          '<div style="max-height:180px;overflow:auto;font-size:12px;background:#1e1e1e;border-radius:6px;padding:6px;margin-bottom:8px;">' + _savedListHtml + '</div>' +
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
      items = buildTocItems(cfg, []);
      if (panelInstance) {
        panelInstance.remove();
        panelInstance = renderFloatingPanel(side, items, collapse, rebuild, startPick, manageSave, getNavLock, setNavLock);
      }
    };

    // 清理临时逻辑已移除

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
        panelInstance = renderFloatingPanel(side, items, collapse, rebuild, startPick, manageSave, getNavLock, setNavLock);
      }
    }

    // Observe & Debounce: 稳健版（标志+轮询tick，避免丢计时器）
    let observer = null;
    const DEBOUNCE_MS = 500;
    let shouldRebuildAt = 0;      // 时间戳：最早重建时间
    let pendingRebuild = false;   // 锁定期积攒一次重建
    let tickTimer = null;

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
            await rebuild();
          } catch (e) {}
        }
      }, 200); // 轮询粒度200ms，轻量
    }

    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver((mutations) => {
        if (!hasMeaningfulChange(mutations)) return;
        // 每次变化推迟到当前时间+DEBOUNCE_MS
        shouldRebuildAt = Date.now() + DEBOUNCE_MS;
        ensureTick();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });
    }

    // 总是先折叠为右侧“目录”按钮，用户点击后再展开
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