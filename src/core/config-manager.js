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
      // 如果已有对话框，先关闭它（互斥机制：只显示一个对话框）
      const existing = document.querySelector('.toc-overlay');
      if (existing) {
        existing.remove();
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
      countLabel.className = 'toc-config-count';
      countLabel.textContent = msg('configSavedSelectors') + ' (' + (list ? list.length : 0) + ')';
      body.appendChild(countLabel);

      // 创建选择器列表（每个选择器可单独删除）
      const listDiv = document.createElement('div');
      listDiv.className = 'toc-overlay-list';

      // 刷新列表的函数
      const refreshList = async (selectors) => {
        listDiv.innerHTML = '';
        if (selectors && selectors.length) {
          selectors.forEach((s, sIndex) => {
            const item = document.createElement('div');
            item.className = 'toc-selector-item';

            // 选择器文本
            const textSpan = document.createElement('span');
            textSpan.className = 'toc-selector-text';
            textSpan.textContent = s.type + ':' + s.expr;
            item.appendChild(textSpan);

            // 删除按钮
            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'toc-selector-delete';
            deleteBtn.textContent = '✕';
            deleteBtn.title = msg('buttonDeleteSelector') || '删除此选择器';
            deleteBtn.dataset.index = sIndex;

            // 点击删除按钮
            deleteBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const indexToDelete = parseInt(deleteBtn.dataset.index, 10);
              if (!isNaN(indexToDelete) && idx >= 0) {
                // 从配置中删除
                const updatedSelectors = [...configs[idx].selectors];
                updatedSelectors.splice(indexToDelete, 1);
                configs[idx].selectors = updatedSelectors;
                await saveConfigs(configs);
                cfg.selectors = updatedSelectors;

                // 刷新列表
                await refreshList(updatedSelectors);

                // 更新计数
                countLabel.textContent = msg('configSavedSelectors') + ' (' + updatedSelectors.length + ')';

                // 触发重建
                if (window.TOC_APP && window.TOC_APP.rebuild) {
                  await window.TOC_APP.rebuild();
                }
              }
            });

            item.appendChild(deleteBtn);
            listDiv.appendChild(item);
          });
        } else {
          listDiv.textContent = msg('configNoSelectors');
        }
      };

      // 初始渲染列表
      await refreshList(list);

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
        // 安全地使用closest，确保当前目标是元素节点
        const btn = e.target.closest('[data-act]');
        if (!btn || btn.nodeType !== Node.ELEMENT_NODE) return;
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
