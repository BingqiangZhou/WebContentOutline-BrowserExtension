// TOC应用主逻辑
(() => {
  'use strict';

  const { buildTocItems } = window.TOC_BUILDER || {};
  const { renderCollapsedBadge, renderFloatingPanel, createElementPicker, showPickerResult } = window.TOC_UI || {};
  const { buildClassSelector, cssPathFor } = window.CSS_SELECTOR || {};
  const { siteConfig, saveSelector, updateConfigFromStorage } = window.CONFIG_MANAGER || {};
  const { setPanelExpandedByOrigin } = window.TOC_UTILS || {};

  const { createMutationObserver } = window.MUTATION_OBSERVER || {};

  /**
   * 初始化TOC应用
   */
  function initForConfig(cfg) {
    const side = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';

    let items = buildTocItems ? buildTocItems(cfg, []) : [];
    let badgeInstance = null;
    let panelInstance = null;
    let mutationObserver = null;
    let pickerInstance = null;
    let activeRestoreTimeout = null;  // 用于取消过期的恢复定时器

    let navLock = false;
    const getNavLock = () => navLock;
    const setNavLock = (v) => { navLock = !!v; };

    /**
     * 重建TOC
     */
    const rebuild = async () => {
      // 更新配置
      await updateConfigFromStorage(cfg);
      
      const newItems = buildTocItems ? buildTocItems(cfg, []) : [];
      
      // 检查是否需要重建：只有在用户交互锁定期间才跳过重建
      if (panelInstance && getNavLock()) {
        // 在锁定期间，保存新的items但不立即重建，并设置pending标志
        items = newItems;
        if (mutationObserver && mutationObserver.setPendingRebuild) {
          mutationObserver.setPendingRebuild(true);
        }
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
      let activeItemIndex = -1;  // 保存活跃项的索引
      let wasLocked = getNavLock();
      if (panelInstance && items.length > 0) {
        // 更安全的查找方式：先检查_node存在性，再检查classList
        currentActiveItem = items.find(item => {
          if (!item || !item._node) return false;
          try {
            return item._node.classList && item._node.classList.contains('active');
          } catch (e) {
            return false;
          }
        });
        // 保存活跃项在数组中的索引位置
        if (currentActiveItem) {
          activeItemIndex = items.indexOf(currentActiveItem);
        }
      }

      // 取消之前的恢复定时器，防止过期回调执行
      if (activeRestoreTimeout) {
        // 根据ID类型选择正确的清理方法（setTimeout或requestAnimationFrame）
        try {
          if (typeof activeRestoreTimeout === 'number') {
            cancelAnimationFrame(activeRestoreTimeout);
          }
        } catch (e) {
          // 忽略清理失败
        }
        activeRestoreTimeout = null;
      }

      items = newItems;
      if (panelInstance) {
        panelInstance.remove();
        panelInstance = renderFloatingPanel ? renderFloatingPanel(
          side, items, collapse, rebuild, startPick,
          () => siteConfig(cfg), getNavLock, setNavLock,
          mutationObserver ? mutationObserver.getPendingRebuild : () => false,
          mutationObserver ? mutationObserver.setPendingRebuild : () => {}
        ) : null;

        // 恢复之前的活跃状态
        if (currentActiveItem && items.length > 0) {
          // 先清除所有可能的active状态，避免重复
          items.forEach(item => {
            if (item._node) {
              item._node.classList.remove('active');
              item._userSelected = false;
            }
          });

          // 优先使用索引匹配，其次使用元素引用匹配，最后使用文本匹配
          let matchingItem = null;

          // 1. 尝试使用索引匹配（最准确）
          if (activeItemIndex >= 0 && activeItemIndex < items.length) {
            matchingItem = items[activeItemIndex];
          }

          // 2. 如果索引匹配失败，尝试使用元素引用匹配
          if (!matchingItem && currentActiveItem.el) {
            matchingItem = items.find(item => item.el === currentActiveItem.el);
          }

          // 3. 如果元素引用匹配失败，使用文本匹配（可能不准确）
          if (!matchingItem) {
            matchingItem = items.find(item => item.text === currentActiveItem.text);
          }

          if (matchingItem && matchingItem._node) {
            // 简化的恢复逻辑：使用requestAnimationFrame确保DOM已完全渲染
            const restoreActive = () => {
              // 检查节点是否仍然有效（未被移除）
              try {
                if (matchingItem._node && document.contains(matchingItem._node)) {
                  matchingItem._node.classList.add('active');
                  if (wasLocked) {
                    matchingItem._userSelected = true;
                    setNavLock(true);
                  }
                }
              } catch (e) {
                // 忽略设置失败
              }
              activeRestoreTimeout = null;
            };
            // 使用requestAnimationFrame确保下一帧渲染后执行
            activeRestoreTimeout = requestAnimationFrame(restoreActive);
          }
        }
      }
    };

    /**
     * 开始元素拾取
     */
    function startPick() {
      if (!createElementPicker || !showPickerResult) return;
      
      // 如果已有正在拾取的实例，先清理，避免鼠标状态残留
      try {
        if (pickerInstance && pickerInstance.cleanup) {
          pickerInstance.cleanup();
        }
      } catch (_) {}
      
      pickerInstance = createElementPicker((el) => {
        // 优先 class 选择器，不足时生成路径
        let sel = '';
        const cls = buildClassSelector ? buildClassSelector(el) : '';
        if (cls) sel = `${el.tagName.toLowerCase()}${cls}`;
        if (!sel && cssPathFor) sel = cssPathFor(el);
        
        showPickerResult(sel, async (selector, onDone) => {
          const success = await saveSelector(selector, cfg);
          if (success) {
            onDone && onDone();
            // 保存后直接重建（仅基于持久配置）
            await rebuild();
          } else {
            alert('保存失败，请查看控制台。');
          }
        });
        // 拾取完成，清理实例引用
        pickerInstance = null;
      }, () => {
        // canceled
        pickerInstance = null;
      });
    }

    /**
     * 折叠面板
     */
    function collapse() {
      if (panelInstance) { 
        panelInstance.remove(); 
        panelInstance = null; 
      }
      // 若正在拾取，折叠时强制取消
      try { if (pickerInstance && pickerInstance.cleanup) { pickerInstance.cleanup(); pickerInstance = null; } } catch (_) {}
      if (!badgeInstance && renderCollapsedBadge) {
        console.debug('[目录助手] 折叠模式初始化，准备渲染按钮');
        badgeInstance = renderCollapsedBadge(side, expand);
      }
      // persist state: collapsed=false (expanded flag false)
      try { setPanelExpandedByOrigin && setPanelExpandedByOrigin(location.origin, false); } catch (_) {}
    }

    /**
     * 展开面板
     */
    async function expand() {
      if (badgeInstance) { 
        badgeInstance.remove(); 
        badgeInstance = null; 
      }
      // 展开前先确保 items 基于最新存储
      await rebuild();
      if (!panelInstance && renderFloatingPanel) {
        panelInstance = renderFloatingPanel(
          side, items, collapse, rebuild, startPick,
          () => siteConfig(cfg), getNavLock, setNavLock,
          mutationObserver ? mutationObserver.getPendingRebuild : () => false,
          mutationObserver ? mutationObserver.setPendingRebuild : () => {}
        );
      }
      // persist state: expanded=true
      try { setPanelExpandedByOrigin && setPanelExpandedByOrigin(location.origin, true); } catch (_) {}
    }

    // 启动变化监听器
    if (createMutationObserver) {
      const observerFactory = createMutationObserver(rebuild, getNavLock);
      mutationObserver = observerFactory.start(cfg);
    }

    // 导出rebuild方法供外部调用（必须在return之前）
    window.TOC_APP = window.TOC_APP || {};
    window.TOC_APP.rebuild = rebuild;

    // 总是先折叠为右侧"目录"按钮，用户点击后再展开
    collapse();

      return {
        rebuild,
        collapse,
        expand,
        destroy() {
          // 清理恢复定时器
          if (activeRestoreTimeout) {
            try {
              if (typeof activeRestoreTimeout === 'number') {
                cancelAnimationFrame(activeRestoreTimeout);
              }
            } catch (e) {
              // 忽略清理失败
            }
            activeRestoreTimeout = null;
          }
          if (badgeInstance) badgeInstance.remove();
          if (panelInstance) panelInstance.remove();
          if (mutationObserver) mutationObserver.disconnect();
          try { if (pickerInstance && pickerInstance.cleanup) { pickerInstance.cleanup(); pickerInstance = null; } } catch (_) {}
        }
      };
  }

  // 导出到全局
  window.TOC_APP = window.TOC_APP || {};
  window.TOC_APP.initForConfig = initForConfig;
})();