(() => {
  'use strict';

  const { msg = (key) => key, getConfigs, saveConfigs, showToast, validateSelectorExpression } = window.TOC_UTILS || {};

  let configsSaveLock = Promise.resolve();
  function queueConfigsWrite(task) {
    const run = async () => await task();
    const next = configsSaveLock.then(run, run);
    configsSaveLock = next.catch(() => {});
    return next;
  }

  async function siteConfig(cfg) {
    try {
      const prevFocus = document.activeElement;
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
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.tabIndex = -1;

      const header = document.createElement('div');
      header.className = 'toc-overlay-header';
      header.textContent = msg('configDialogTitle') + ' - ' + urlPattern;
      header.id = `toc-overlay-title-${Math.random().toString(36).slice(2)}`;
      box.setAttribute('aria-labelledby', header.id);
      box.appendChild(header);

      const body = document.createElement('div');
      body.className = 'toc-overlay-body';

      const countLabel = document.createElement('div');
      countLabel.className = 'toc-config-count';
      countLabel.textContent = msg('configSavedSelectors') + ' (' + (list ? list.length : 0) + ')';
      body.appendChild(countLabel);

      const listDiv = document.createElement('div');
      listDiv.className = 'toc-overlay-list';

      const refreshList = async (selectors) => {
        try {
          if (listDiv.replaceChildren) listDiv.replaceChildren();
          else listDiv.textContent = '';
        } catch (_) {
          listDiv.textContent = '';
        }
        if (selectors && selectors.length) {
          selectors.forEach((s, sIndex) => {
            const item = document.createElement('div');
            item.className = 'toc-selector-item';

            const textSpan = document.createElement('span');
            textSpan.className = 'toc-selector-text';
            textSpan.textContent = s.type + ':' + s.expr;
            item.appendChild(textSpan);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'toc-selector-delete';
            deleteBtn.textContent = msg('symbolClose');
            deleteBtn.title = msg('buttonDeleteSelector') || 'Delete selector';
            deleteBtn.setAttribute('aria-label', msg('buttonDeleteSelector') || 'Delete selector');
            deleteBtn.dataset.index = String(sIndex);

            deleteBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const indexToDelete = parseInt(deleteBtn.dataset.index, 10);
              if (isNaN(indexToDelete)) return;

              const updatedSelectors = await queueConfigsWrite(async () => {
                const configsNow = await getConfigs();
                const idxNow = configsNow.findIndex(c => c && c.urlPattern === urlPattern);
                if (idxNow < 0) return null;
                const existingNow = configsNow[idxNow] || {};
                const arr = Array.isArray(existingNow.selectors) ? existingNow.selectors.slice() : [];
                if (indexToDelete < 0 || indexToDelete >= arr.length) return null;
                arr.splice(indexToDelete, 1);
                configsNow[idxNow] = { ...existingNow, selectors: arr, updatedAt: Date.now() };
                const ok = await saveConfigs(configsNow);
                return ok ? arr : null;
              });

              if (!updatedSelectors) return;
              cfg.selectors = updatedSelectors;
              await refreshList(updatedSelectors);
              countLabel.textContent = msg('configSavedSelectors') + ' (' + updatedSelectors.length + ')';

              if (window.TOC_APP && window.TOC_APP.rebuild) {
                await window.TOC_APP.rebuild();
              }
            });

            item.appendChild(deleteBtn);
            listDiv.appendChild(item);
          });
        } else {
          listDiv.textContent = msg('configNoSelectors');
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
      btnClear.textContent = msg('buttonClearConfig');

      const btnClose = document.createElement('button');
      btnClose.className = 'toc-btn';
      btnClose.dataset.act = 'close';
      btnClose.textContent = msg('buttonClose');

      actions.appendChild(btnClear);
      actions.appendChild(btnClose);
      box.appendChild(actions);

      const restoreFocus = () => {
        try {
          if (prevFocus && prevFocus.focus && document.contains(prevFocus)) {
            prevFocus.focus({ preventScroll: true });
          }
        } catch (_) {}
      };
      const close = () => {
        try { box.remove(); } catch (_) {}
        restoreFocus();
      };

      const getFocusable = () => {
        try {
          const { getFocusableWithin } = window.TOC_UTILS || {};
          if (typeof getFocusableWithin === 'function') return getFocusableWithin(box);
        } catch (_) {
        }
        return [];
      };

      box.addEventListener('keydown', (e) => {
        if (!e) return;
        if (e.key === 'Tab') {
          const focusables = getFocusable();
          if (!focusables.length) {
            try { e.preventDefault(); } catch (_) {}
            return;
          }
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement;
          if (e.shiftKey && active === first) {
            try { e.preventDefault(); } catch (_) {}
            try { last.focus(); } catch (_) {}
            return;
          }
          if (!e.shiftKey && active === last) {
            try { e.preventDefault(); } catch (_) {}
            try { first.focus(); } catch (_) {}
            return;
          }
        }
        if (e.key === 'Escape') {
          try { e.preventDefault(); } catch (_) {}
          close();
        }
      });

      box.addEventListener('click', async (e) => {
        if (!e.target || e.target.nodeType !== Node.ELEMENT_NODE) return;
        const btn = e.target.closest('[data-act]');
        if (!btn || btn.nodeType !== Node.ELEMENT_NODE) return;
        const act = btn.dataset.act;
        if (act === 'close') close();
        if (act === 'clear') {
          const ok = await queueConfigsWrite(async () => {
            const configsNow = await getConfigs();
            const idxNow = configsNow.findIndex(c => c && c.urlPattern === urlPattern);
            if (idxNow < 0) return true;
            configsNow.splice(idxNow, 1);
            return await saveConfigs(configsNow);
          });
          if (!ok) return;
          cfg.selectors = [];
          await refreshList([]);
          countLabel.textContent = msg('configSavedSelectors') + ' (0)';
          if (window.TOC_APP && window.TOC_APP.rebuild) {
            await window.TOC_APP.rebuild();
          }
          close();
        }
      });

      document.documentElement.appendChild(box);
      try { requestAnimationFrame(() => btnClose.focus({ preventScroll: true })); } catch (_) {}
    } catch (e) {
      console.error(msg('logClearConfigFailed'), e);
      if (showToast) showToast(msg('errorOperationFailed'), { type: 'error' });
    }
  }

  async function saveSelector(selector, cfg) {
    try {
      const expr = String(selector || '').trim();
      if (!expr || (validateSelectorExpression && !validateSelectorExpression('css', expr))) {
        showToast && showToast(msg('errorInvalidSelector'), { type: 'error' });
        return false;
      }

      return await queueConfigsWrite(async () => {
        const configs = await getConfigs();
        const urlPattern = `${location.protocol}//${location.host}/*`;
        const entry = { type: 'css', expr };
        const idx = configs.findIndex(c => c && c.urlPattern === urlPattern);
        const sidePersist = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';
        const now = Date.now();

        if (idx >= 0) {
          const existing = configs[idx] || {};
          const arr = Array.isArray(existing.selectors) ? existing.selectors.slice() : [];
          if (!arr.some(s => s && s.type === 'css' && s.expr === expr)) {
            arr.unshift(entry);
          }
          configs[idx] = { ...existing, side: sidePersist, urlPattern, selectors: arr, updatedAt: now };
        } else {
          configs.push({ urlPattern, side: sidePersist, selectors: [entry], collapsedDefault: false, updatedAt: now });
        }

        const ok = await saveConfigs(configs);
        return !!ok;
      });
    } catch (e) {
      console.error(msg('logSaveConfigFailed'), e);
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
      console.warn(msg('logReadConfigFailed'), e);
    }
  }

  window.CONFIG_MANAGER = {
    siteConfig,
    saveSelector,
    updateConfigFromStorage
  };
})();
