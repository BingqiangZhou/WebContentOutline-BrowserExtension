(() => {
  'use strict';

  const { msg, getConfigs, saveConfigs } = window.TOC_UTILS || {};
  const safeMsg = msg || ((key) => {
    try { return chrome.i18n.getMessage(key) || key; } catch (_) { return key; }
  });

  async function siteConfig(cfg) {
    try {
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

      const header = document.createElement('div');
      header.className = 'toc-overlay-header';
      header.textContent = safeMsg('configDialogTitle') + ' - ' + urlPattern;
      box.appendChild(header);

      const body = document.createElement('div');
      body.className = 'toc-overlay-body';

      const countLabel = document.createElement('div');
      countLabel.className = 'toc-config-count';
      countLabel.textContent = safeMsg('configSavedSelectors') + ' (' + (list ? list.length : 0) + ')';
      body.appendChild(countLabel);

      const listDiv = document.createElement('div');
      listDiv.className = 'toc-overlay-list';

      const refreshList = async (selectors) => {
        listDiv.innerHTML = '';
        if (selectors && selectors.length) {
          selectors.forEach((s, sIndex) => {
            const item = document.createElement('div');
            item.className = 'toc-selector-item';

            const textSpan = document.createElement('span');
            textSpan.className = 'toc-selector-text';
            textSpan.textContent = s.type + ':' + s.expr;
            item.appendChild(textSpan);

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'toc-selector-delete';
            deleteBtn.textContent = 'x';
            deleteBtn.title = safeMsg('buttonDeleteSelector') || 'Delete selector';
            deleteBtn.dataset.index = String(sIndex);

            deleteBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const indexToDelete = parseInt(deleteBtn.dataset.index, 10);
              if (!isNaN(indexToDelete) && idx >= 0) {
                const updatedSelectors = [...configs[idx].selectors];
                updatedSelectors.splice(indexToDelete, 1);
                configs[idx].selectors = updatedSelectors;
                await saveConfigs(configs);
                cfg.selectors = updatedSelectors;

                await refreshList(updatedSelectors);
                countLabel.textContent = safeMsg('configSavedSelectors') + ' (' + updatedSelectors.length + ')';

                if (window.TOC_APP && window.TOC_APP.rebuild) {
                  await window.TOC_APP.rebuild();
                }
              }
            });

            item.appendChild(deleteBtn);
            listDiv.appendChild(item);
          });
        } else {
          listDiv.textContent = safeMsg('configNoSelectors');
        }
      };

      await refreshList(list);

      body.appendChild(listDiv);
      box.appendChild(body);

      const actions = document.createElement('div');
      actions.className = 'toc-overlay-actions';

      const btnClear = document.createElement('button');
      btnClear.className = 'toc-btn toc-btn-danger';
      btnClear.dataset.act = 'clear';
      btnClear.textContent = safeMsg('buttonClearConfig');

      const btnClose = document.createElement('button');
      btnClose.className = 'toc-btn';
      btnClose.dataset.act = 'close';
      btnClose.textContent = safeMsg('buttonClose');

      actions.appendChild(btnClear);
      actions.appendChild(btnClose);
      box.appendChild(actions);

      const close = () => box.remove();

      box.addEventListener('click', async (e) => {
        if (!e.target || e.target.nodeType !== Node.ELEMENT_NODE) return;
        const btn = e.target.closest('[data-act]');
        if (!btn || btn.nodeType !== Node.ELEMENT_NODE) return;
        const act = btn.dataset.act;
        if (act === 'close') close();
        if (act === 'clear') {
          if (idx >= 0) {
            configs.splice(idx, 1);
            await saveConfigs(configs);
            cfg.selectors = [];
            if (window.TOC_APP && window.TOC_APP.rebuild) {
              await window.TOC_APP.rebuild();
            }
          }
          close();
        }
      });

      document.documentElement.appendChild(box);
    } catch (e) {
      console.error(safeMsg('logClearConfigFailed'), e);
      alert(safeMsg('errorOperationFailed'));
    }
  }

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
      console.error(safeMsg('logSaveConfigFailed'), e);
      return false;
    }
  }

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
      console.warn(safeMsg('logReadConfigFailed'), e);
    }
  }

  window.CONFIG_MANAGER = {
    siteConfig,
    saveSelector,
    updateConfigFromStorage
  };
})();
