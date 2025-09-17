// TOC内容脚本 - 重构版本（增加按站点启用/禁用）
(() => {
  'use strict';

  const { getConfigs, findMatchingConfig, getSiteEnabledByOrigin, getPanelExpandedByOrigin } = window.TOC_UTILS || {};
  const { initForConfig } = window.TOC_APP || {};

  if (!getConfigs || !initForConfig || !getSiteEnabledByOrigin) {
    console.error('[目录助手] 缺少必要的依赖模块');
    return;
  }

  let appInstance = null;
  let currentEnabled = false;

  async function startApp() {
    try {
      const configs = await getConfigs();
      let cfg = findMatchingConfig(configs, location.href);
      if (!cfg) {
        cfg = {
          urlPattern: `${location.protocol}//${location.host}/*`,
          side: 'right',
          selectors: [],
          collapsedDefault: false
        };
        console.debug('[目录助手] 未找到配置，使用默认空配置启动面板');
      } else {
        console.debug('[目录助手] 命中配置', cfg.urlPattern);
      }
      // 直接初始化并保存实例，供后续销毁
      appInstance = initForConfig(cfg);
    } catch (err) {
      console.error('[目录助手] 初始化失败', err);
    }
  }

  function stopApp() {
    try {
      if (appInstance && appInstance.destroy) {
        appInstance.destroy();
      }
    } catch (e) {}
    appInstance = null;
    // 强力清理兜底：移除任何遗留的目录 UI 节点
    try {
      document.querySelectorAll('.toc-collapsed-badge, .toc-floating, .toc-overlay').forEach(n => n.remove());
    } catch (_) {}
  }

  async function main() {
    console.debug('[目录助手] 内容脚本启动于', location.href);
    try {
      // 先请求后台根据站点状态同步一次图标，再决定是否渲染目录
      await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'toc:ensureIcon' }, () => { void chrome.runtime?.lastError; resolve(); });
        } catch (_) { resolve(); }
      });

      const enabled = await getSiteEnabledByOrigin();
      currentEnabled = !!enabled;
      if (currentEnabled) {
        await startApp();
        try {
          const expanded = await getPanelExpandedByOrigin();
          if (expanded && appInstance && appInstance.expand) {
            await appInstance.expand();
          }
        } catch (_) {}
      } else {
        console.debug('[目录助手] 当前站点处于禁用状态，未初始化面板');
      }
    } catch (e) {
      console.warn('[目录助手] 读取启用状态失败，默认禁用', e);
    }
  }

  // 监听后台切换事件
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;

      // 请求直接打开目录面板
      if (msg.type === 'toc:openPanel') {
        (async () => {
          try {
            if (!appInstance) {
              await startApp();
            }
            if (appInstance && appInstance.expand) {
              await appInstance.expand();
            }
            sendResponse && sendResponse({ ok: true });
          } catch (err) {
            sendResponse && sendResponse({ ok: false, error: String(err) });
          }
        })();
        return true; // 异步响应
      }

      // 启用状态切换
      if (msg.type !== 'toc:updateEnabled' && msg.type !== 'TOC_UPDATE_ENABLED') return;
      const enabled = !!msg.enabled;
      if (enabled === currentEnabled) {
        sendResponse && sendResponse({ ok: true, unchanged: true });
        return;
      }
      currentEnabled = enabled;
      if (enabled) {
        startApp().then(async () => {
          try {
            const expanded = await getPanelExpandedByOrigin();
            if (expanded && appInstance && appInstance.expand) {
              await appInstance.expand();
            }
            sendResponse && sendResponse({ ok: true });
          } catch (_) {
            sendResponse && sendResponse({ ok: true });
          }
        }).catch(() => sendResponse && sendResponse({ ok: false }));
        return true; // 异步响应
      } else {
        stopApp();
        sendResponse && sendResponse({ ok: true });
      }
    });
  } catch (e) {
    // ignore
  }

  // 监听 storage 变化，作为消息丢失时的兜底同步（本扩展使用 chrome.storage.local）
  try {
    const KEY = (window.TOC_UTILS && window.TOC_UTILS.STORAGE_KEYS && window.TOC_UTILS.STORAGE_KEYS.SITE_ENABLE_MAP)
      ? window.TOC_UTILS.STORAGE_KEYS.SITE_ENABLE_MAP
      : 'tocSiteEnabledMap';
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      const ch = changes[KEY];
      if (!ch) return;
      try {
        const map = ch.newValue || {};
        const next = !!map[location.origin];
        if (next === currentEnabled) return;
        currentEnabled = next;
        if (next) {
          startApp();
        } else {
          stopApp();
        }
      } catch (_) {}
    });
  } catch (_) {}

  // 启动应用（等待文档就绪）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { main(); }, { once: true });
  } else {
    main();
  }
})();