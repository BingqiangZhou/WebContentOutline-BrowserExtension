// TOC内容脚本 - 重构版本（增加按站点启用/禁用）
(() => {
  'use strict';

  const { getConfigs, findMatchingConfig, getSiteEnabledByOrigin } = window.TOC_UTILS || {};
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
  }

  async function main() {
    console.debug('[目录助手] 内容脚本启动于', location.href);
    try {
      const enabled = await getSiteEnabledByOrigin();
      currentEnabled = !!enabled;
      if (currentEnabled) {
        await startApp();
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
      if (!msg || (msg.type !== 'toc:updateEnabled' && msg.type !== 'TOC_UPDATE_ENABLED')) return;
      const enabled = !!msg.enabled;
      if (enabled === currentEnabled) {
        sendResponse && sendResponse({ ok: true, unchanged: true });
        return;
      }
      currentEnabled = enabled;
      if (enabled) {
        startApp().then(() => sendResponse && sendResponse({ ok: true })).catch(() => sendResponse && sendResponse({ ok: false }));
        return true; // 异步响应
      } else {
        stopApp();
        sendResponse && sendResponse({ ok: true });
      }
    });
  } catch (e) {
    // ignore
  }

  // 启动应用（等待文档就绪）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { main(); }, { once: true });
  } else {
    main();
  }
})();