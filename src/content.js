// TOC内容脚本 - 重构版本
(() => {
  'use strict';

  const { getConfigs, findMatchingConfig } = window.TOC_UTILS || {};
  const { initForConfig } = window.TOC_APP || {};

  if (!getConfigs || !initForConfig) {
    console.error('[目录助手] 缺少必要的依赖模块');
    return;
  }

  /**
   * 主函数
   */
  function main() {
    console.debug('[目录助手] 内容脚本启动于', location.href);
    
    getConfigs().then((configs) => {
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
      
      setTimeout(() => initForConfig(cfg), 0);
    }).catch(err => {
      console.error('[目录助手] 读取配置失败', err);
      // 兜底也初始化
      const cfg = { 
        urlPattern: `${location.protocol}//${location.host}/*`, 
        side: 'right', 
        selectors: [], 
        collapsedDefault: false 
      };
      setTimeout(() => initForConfig(cfg), 0);
    });
  }

  // 启动应用
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main, { once: true });
  } else {
    main();
  }
})();