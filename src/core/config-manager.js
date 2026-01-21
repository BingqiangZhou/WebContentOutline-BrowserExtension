// 配置管理模块
(() => {
  'use strict';

  /**
   * 获取本地化消息
   */
  function msg(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  const { getConfigs, saveConfigs } = window.TOC_UTILS || {};

  /**
   * 管理站点配置
   */
  async function siteConfig(cfg) {
    try {
      // 如果对话框已存在，将其聚焦并返回
      const existing = document.querySelector('.toc-overlay');
      if (existing) {
        // 闪烁效果提示用户对话框已存在
        existing.style.transition = 'box-shadow 0.15s ease';
        existing.style.setProperty('box-shadow', '0 0 0 4px rgba(47, 111, 235, 0.4), 0 8px 24px rgba(0,0,0,0.15)', 'important');
        setTimeout(() => {
          existing.style.setProperty('box-shadow', '0 8px 24px rgba(0,0,0,0.15)', 'important');
        }, 200);
        return;
      }

      const configs = await getConfigs();
      const urlPattern = `${location.protocol}//${location.host}/*`;
      const idx = configs.findIndex(c => c && c.urlPattern === urlPattern);
      const list = idx >= 0 && Array.isArray(configs[idx].selectors) ? configs[idx].selectors : [];

      const box = document.createElement('div');
      box.className = 'toc-overlay';

      const savedListHtml = (list && list.length ? list.map(s => s.type + ':' + s.expr).join('<br>') : msg('configNoSelectors'));
      box.innerHTML =
        '<div class="toc-overlay-header">' + msg('configDialogTitle') + ' - ' + urlPattern + '</div>' +
        '<div class="toc-overlay-body">' +
        '  <div style="font-size:13px;margin-bottom:6px">' + msg('configSavedSelectors') + ' (' + (list ? list.length : 0) + ')</div>' +
        '  <div class="toc-overlay-list">' + savedListHtml + '</div>' +
        '</div>' +
        '<div class="toc-overlay-actions">' +
        '  <button class="toc-btn toc-btn-danger" data-act="clear">' + msg('buttonClearConfig') + '</button>' +
        '  <button class="toc-btn" data-act="close">' + msg('buttonClose') + '</button>' +
        '</div>';

      const close = () => box.remove();

      box.addEventListener('click', async (e) => {
        // 检查 e.target 是否存在且是元素节点
        if (!e.target || e.target.nodeType !== Node.ELEMENT_NODE) return;
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'close') close();
        if (act === 'clear') {
          if (idx >= 0) {
            configs.splice(idx, 1);
            await saveConfigs(configs);
            cfg.selectors = [];
            // 触发重建
            if (window.TOC_APP && window.TOC_APP.rebuild) {
              await window.TOC_APP.rebuild();
            }
          }
          close();
        }
      });

      document.documentElement.appendChild(box);
    } catch (e) {
      console.error(msg('logClearConfigFailed'), e);
      alert(msg('errorOperationFailed'));
    }
  }

  /**
   * 保存选择器到配置
   */
  async function saveSelector(selector, cfg) {
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
      return true;
    } catch (e) {
      console.error(msg('logSaveConfigFailed'), e);
      return false;
    }
  }

  /**
   * 更新配置从存储
   */
  async function updateConfigFromStorage(cfg) {
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
      console.warn(msg('logReadConfigFailed'), e);
    }
  }

  // 导出到全局
  window.CONFIG_MANAGER = {
    siteConfig,
    saveSelector,
    updateConfigFromStorage
  };
})();
