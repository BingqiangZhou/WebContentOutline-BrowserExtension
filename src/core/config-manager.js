// 配置管理模块
(() => {
  'use strict';

  const { getConfigs, saveConfigs } = window.TOC_UTILS || {};

  /**
   * 管理保存的配置
   */
  async function manageSave(cfg) {
    try {
      const configs = await getConfigs();
      const urlPattern = `${location.protocol}//${location.host}/*`;
      const idx = configs.findIndex(c => c && c.urlPattern === urlPattern);
      const list = idx >= 0 && Array.isArray(configs[idx].selectors) ? configs[idx].selectors : [];
      
      const box = document.createElement('div');
      box.className = 'toc-overlay';
      
      const savedListHtml = (list && list.length ? list.map(s => s.type + ':' + s.expr).join('<br>') : '（无）');
      box.innerHTML =
        '<div class="toc-overlay-header">站点配置 - ' + urlPattern + '</div>' +
        '<div class="toc-overlay-body">' +
        '  <div style="font-size:13px;margin-bottom:6px">已保存选择器（' + (list ? list.length : 0) + '）</div>' +
        '  <div class="toc-overlay-list">' + savedListHtml + '</div>' +
        '</div>' +
        '<div class="toc-overlay-actions">' +
        '  <button class="toc-btn toc-btn-danger" data-act="clear">清空站点配置</button>' +
        '  <button class="toc-btn" data-act="close">关闭</button>' +
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
      console.error('读取/清空站点配置失败', e);
      alert('操作失败，请查看控制台。');
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
      console.error('保存站点配置失败', e);
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
      console.warn('[目录助手] 读取最新配置失败，使用内存状态', e);
    }
  }

  // 导出到全局
  window.CONFIG_MANAGER = {
    manageSave,
    saveSelector,
    updateConfigFromStorage
  };
})();