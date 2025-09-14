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