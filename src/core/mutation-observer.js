// 页面变化监听模块
(() => {
  'use strict';

  /**
   * 创建页面变化监听器
   */
  function createMutationObserver(onRebuild, getNavLock) {
    const DEBOUNCE_MS = 500;
    let shouldRebuildAt = 0;
    let pendingRebuild = false;
    let tickTimer = null;

    /**
     * 检查是否有有意义的变化
     */
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

    /**
     * 确保定时器运行
     */
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
            await onRebuild();
          } catch (e) {}
        }
        // 处理解锁后的待处理重建
        if (pendingRebuild && !getNavLock()) {
          pendingRebuild = false;
          try {
            await onRebuild();
          } catch (e) {}
        }
      }, 200); // 轮询粒度200ms，轻量
    }

    /**
     * 检查是否有有效的选择器
     */
    function hasValidSelectors(cfg) {
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

    /**
     * 启动监听器
     */
    function start(cfg) {
      // 防止多次调用导致定时器泄漏：先清理旧定时器
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      shouldRebuildAt = 0;
      pendingRebuild = false;

      // 只有在有有效选择器的情况下才启动观察器
      if (typeof MutationObserver !== 'undefined' && hasValidSelectors(cfg)) {
        console.debug('[目录助手] 检测到有效选择器，启动页面变化监听');

        const observer = new MutationObserver((mutations) => {
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

        return {
          disconnect() {
            observer.disconnect();
            if (tickTimer) {
              clearInterval(tickTimer);
              tickTimer = null;
            }
          },
          getPendingRebuild: () => pendingRebuild,
          setPendingRebuild: (val) => { pendingRebuild = val; }
        };
      } else {
        console.debug('[目录助手] 没有有效的元素选择器，跳过页面变化监听');
        return {
          disconnect() {},
          getPendingRebuild: () => false,
          setPendingRebuild: () => {}
        };
      }
    }

    return { start };
  }

  // 导出到全局
  window.MUTATION_OBSERVER = {
    createMutationObserver
  };
})();