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

      // 创建头部
      const header = document.createElement('div');
      header.className = 'toc-overlay-header';
      header.textContent = msg('configDialogTitle') + ' - ' + urlPattern;
      box.appendChild(header);

      // 创建主体
      const body = document.createElement('div');
      body.className = 'toc-overlay-body';

      // 创建计数标签
      const countLabel = document.createElement('div');
      countLabel.style.cssText = 'font-size:13px;margin-bottom:6px';
      countLabel.textContent = msg('configSavedSelectors') + ' (' + (list ? list.length : 0) + ')';
      body.appendChild(countLabel);

      // 创建选择器列表（使用DOM避免XSS）
      const listDiv = document.createElement('div');
      listDiv.className = 'toc-overlay-list';
      if (list && list.length) {
        list.forEach(s => {
          const item = document.createElement('div');
          // 使用textContent安全地插入内容
          item.textContent = s.type + ':' + s.expr;
          listDiv.appendChild(item);
        });
      } else {
        listDiv.textContent = msg('configNoSelectors');
      }
      body.appendChild(listDiv);
      box.appendChild(body);

      // 创建操作按钮区
      const actions = document.createElement('div');
      actions.className = 'toc-overlay-actions';

      const btnClear = document.createElement('button');
      btnClear.className = 'toc-btn toc-btn-danger';
      btnClear.dataset.act = 'clear';
      btnClear.textContent = msg('buttonClearConfig');

      const btnClose = document.createElement('button');
      btnClose.className = 'toc-btn';
      btnClose.dataset.act = 'close';
      btnClose.textContent = msg('buttonClose');

      actions.appendChild(btnClear);
      actions.appendChild(btnClose);
      box.appendChild(actions);

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
