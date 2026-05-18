'use strict';

import { createFocusTrap } from '../utils/focus-trap.js';
import { emit } from './event-bus.js';
import {
  showToast,
  getConfigs,
  saveConfigs,
  findMatchingConfig,
  getFocusableWithin,
  msg,
  validateSelectorExpression
} from '../utils/toc-utils.js';

  function notifyConfigChanged() {
    if (emit) emit('toc:config-changed');
  }

export async function siteConfig(cfg) {
    try {
      var prevFocus = document.activeElement;
      var existing = document.querySelector('.toc-overlay');
      if (existing) {
        existing.remove();
      }

      var configs = await getConfigs();
      var urlPattern = location.protocol + '//' + location.host + '/*';
      var idx = configs.findIndex(function(c) { return c && c.urlPattern === urlPattern; });
      var list = idx >= 0 && Array.isArray(configs[idx].selectors) ? configs[idx].selectors : [];

      var box = document.createElement('div');
      box.className = 'toc-overlay';
      box.setAttribute('data-toc-owner', 'web-toc-assistant');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.tabIndex = -1;

      var header = document.createElement('div');
      header.className = 'toc-overlay-header';
      header.textContent = msg('configDialogTitle') + ' - ' + urlPattern;
      header.id = 'toc-overlay-title-' + Math.random().toString(36).slice(2);
      box.setAttribute('aria-labelledby', header.id);
      box.appendChild(header);

      var body = document.createElement('div');
      body.className = 'toc-overlay-body';

      var countLabel = document.createElement('div');
      countLabel.className = 'toc-config-count';
      countLabel.textContent = msg('configSavedSelectors') + ' (' + (list ? list.length : 0) + ')';
      body.appendChild(countLabel);

      var listDiv = document.createElement('div');
      listDiv.className = 'toc-overlay-list';

      var mutateConfigsWithRetry = async function(opts) {
        var mutate = opts.mutate;
        var verify = opts.verify;
        var maxAttempts = opts.maxAttempts;
        var attempts = Number.isFinite(maxAttempts) ? Math.max(1, Math.floor(maxAttempts)) : 3;
        var verifyFn = (typeof verify === 'function') ? verify : null;

        for (var i = 0; i < attempts; i++) {
          var configsNow = await getConfigs();

          // Avoid a write when the desired state is already present (also reduces multi-tab overwrite risk).
          if (verifyFn) {
            try {
              if (verifyFn(configsNow)) return true;
            } catch (_) {}
          }

          var nextConfigs = mutate(configsNow);
          var ok = await saveConfigs(nextConfigs);
          if (!ok) return false;

          // In multi-tab scenarios another writer may update storage between our write and a read-back verify.
          // Treat the write as successful once the post-condition holds for what we wrote.
          if (!verifyFn) return true;
          try {
            if (verifyFn(nextConfigs)) return true;
          } catch (_) {}

          // Yield a tick before retrying to reduce tight-loop contention across tabs.
          try { await new Promise(function(r) { setTimeout(r, 0); }); } catch (_) {}
        }

        // Best-effort final check against current storage.
        if (verifyFn) {
          try {
            var finalNow = await getConfigs();
            if (verifyFn(finalNow)) return true;
          } catch (_) {}
        }
        return false;
      };

      var refreshList = async function(selectors) {
        try {
          if (listDiv.replaceChildren) listDiv.replaceChildren();
          else listDiv.textContent = '';
        } catch (_) {
          listDiv.textContent = '';
        }
        if (selectors && selectors.length) {
          selectors.forEach(function(s, sIndex) {
            var item = document.createElement('div');
            item.className = 'toc-selector-item';

            var textSpan = document.createElement('span');
            textSpan.className = 'toc-selector-text';
            textSpan.textContent = s.type + ':' + s.expr;
            item.appendChild(textSpan);

            var deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'toc-selector-delete';
            deleteBtn.textContent = msg('symbolClose');
            deleteBtn.title = msg('buttonDeleteSelector') || 'Delete selector';
            deleteBtn.setAttribute('aria-label', msg('buttonDeleteSelector') || 'Delete selector');
            deleteBtn.dataset.selType = String(s.type || '');
            deleteBtn.dataset.selExpr = String(s.expr || '');

            deleteBtn.addEventListener('click', async function(e) {
              try {
                e.stopPropagation();
                var selType = String(deleteBtn.dataset.selType || '').trim();
                var selExpr = String(deleteBtn.dataset.selExpr || '').trim();
                if (!selType || !selExpr) return;

                var ok = await mutateConfigsWithRetry({
                  mutate: function(configsNow) {
                    var idxNow = configsNow.findIndex(function(c) { return c && c.urlPattern === urlPattern; });
                    if (idxNow < 0) return configsNow;
                    var existingNow = configsNow[idxNow] || {};
                    var arr = Array.isArray(existingNow.selectors) ? existingNow.selectors.slice() : [];
                    var nextArr = arr.filter(function(s2) { return !(s2 && s2.type === selType && s2.expr === selExpr); });
                    if (nextArr.length === arr.length) return configsNow;
                    var next = configsNow.slice();
                    next[idxNow] = { side: existingNow.side, urlPattern: existingNow.urlPattern, selectors: nextArr, updatedAt: Date.now() };
                    return next;
                  },
                  verify: function(after) {
                    var idx = after.findIndex(function(c) { return c && c.urlPattern === urlPattern; });
                    if (idx < 0) return true;
                    var arr = Array.isArray(after[idx].selectors) ? after[idx].selectors : [];
                    return !arr.some(function(s2) { return s2 && s2.type === selType && s2.expr === selExpr; });
                  }
                });

                if (!ok) {
                  showToast && showToast(msg('errorOperationFailed'), { type: 'error' });
                  return;
                }

                var configsLatest = await getConfigs();
                var latest = configsLatest.find(function(c) { return c && c.urlPattern === urlPattern; }) || null;
                var updatedSelectors = latest && Array.isArray(latest.selectors) ? latest.selectors : [];
                cfg.selectors = updatedSelectors;
                if (cfg && cfg.__markConfigDirty) cfg.__markConfigDirty();
                await refreshList(updatedSelectors);
                countLabel.textContent = msg('configSavedSelectors') + ' (' + updatedSelectors.length + ')';

                notifyConfigChanged();
              } catch (e2) {
                console.warn(msg('logClearConfigFailed'), e2);
                showToast && showToast(msg('errorOperationFailed'), { type: 'error' });
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

      var actions = document.createElement('div');
      actions.className = 'toc-overlay-actions';

      var btnClear = document.createElement('button');
      btnClear.type = 'button';
      btnClear.className = 'toc-btn toc-btn-danger';
      btnClear.dataset.act = 'clear';
      btnClear.textContent = msg('buttonClearConfig');

      var btnClose = document.createElement('button');
      btnClose.type = 'button';
      btnClose.className = 'toc-btn';
      btnClose.dataset.act = 'close';
      btnClose.textContent = msg('buttonClose');

      actions.appendChild(btnClear);
      actions.appendChild(btnClose);
      box.appendChild(actions);

      var restoreFocus = function() {
        try {
          if (prevFocus && prevFocus.focus && document.contains(prevFocus)) {
            prevFocus.focus({ preventScroll: true });
          }
        } catch (_) {}
      };
      var focusRaf = null;
      var close = function() {
        if (removeFocusTrap) { removeFocusTrap(); removeFocusTrap = null; }
        if (focusRaf) {
          cancelAnimationFrame(focusRaf);
          focusRaf = null;
        }
        try { box.remove(); } catch (_) {}
        restoreFocus();
      };

      var getFocusable = function() {
        try {
          if (typeof getFocusableWithin === 'function') return getFocusableWithin(box);
        } catch (_) {}
        return [];
      };

      var removeFocusTrap = createFocusTrap ? createFocusTrap(box, { onClose: close, getFocusableWithin: getFocusable }) : null;

      box.addEventListener('click', async function(e) {
        try {
          if (!e.target || e.target.nodeType !== Node.ELEMENT_NODE) return;
          var btn = e.target.closest('[data-act]');
          if (!btn || btn.nodeType !== Node.ELEMENT_NODE) return;
          var act = btn.dataset.act;
          if (act === 'close') { close(); return; }
          if (act === 'clear') {
            var ok = await mutateConfigsWithRetry({
              mutate: function(configsNow) {
                var idxNow = configsNow.findIndex(function(c) { return c && c.urlPattern === urlPattern; });
                if (idxNow < 0) return configsNow;
                var next = configsNow.slice();
                next.splice(idxNow, 1);
                return next;
              },
              verify: function(after) {
                var idx = after.findIndex(function(c) { return c && c.urlPattern === urlPattern; });
                return idx < 0;
              }
            });
            if (!ok) {
              showToast && showToast(msg('errorOperationFailed'), { type: 'error' });
              return;
            }
            cfg.selectors = [];
            if (cfg && cfg.__markConfigDirty) cfg.__markConfigDirty();
            await refreshList([]);
            countLabel.textContent = msg('configSavedSelectors') + ' (0)';

            notifyConfigChanged();
            close();
          }
        } catch (e2) {
          console.error(msg('logClearConfigFailed'), e2);
          if (showToast) showToast(msg('errorOperationFailed'), { type: 'error' });
        }
      });

      document.documentElement.appendChild(box);
      try {
        focusRaf = requestAnimationFrame(function() {
          focusRaf = null;
          if (!box || !box.isConnected) return;
          try { btnClose.focus({ preventScroll: true }); } catch (_) {}
        });
      } catch (_) {}
    } catch (e) {
      console.error(msg('logClearConfigFailed'), e);
      if (showToast) showToast(msg('errorOperationFailed'), { type: 'error' });
    }
  }

export async function saveSelector(selector, cfg) {
    try {
      if (!cfg) {
        showToast && showToast(msg('errorOperationFailed') || 'No config found', { type: 'error' });
        return false;
      }
      var expr = String(selector || '').trim();
      if (!expr || (validateSelectorExpression && !validateSelectorExpression('css', expr))) {
        showToast && showToast(msg('errorInvalidSelector'), { type: 'error' });
        return false;
      }

      var configsNow = await getConfigs();
      var configs = Array.isArray(configsNow) ? configsNow.slice() : [];
      var urlPattern = location.protocol + '//' + location.host + '/*';
      var entry = { type: 'css', expr: expr };
      var idx = configs.findIndex(function(c) { return c && c.urlPattern === urlPattern; });
      var sidePersist = (cfg.side === 'left' || cfg.side === 'right') ? cfg.side : 'right';
      var now = Date.now();

      if (idx >= 0) {
        var existing = configs[idx] || {};
        var arr = Array.isArray(existing.selectors) ? existing.selectors.slice() : [];
        if (!arr.some(function(s) { return s && s.type === 'css' && s.expr === expr; })) {
          arr.unshift(entry);
        }
        configs[idx] = { side: existing.side, urlPattern: urlPattern, selectors: arr, collapsedDefault: existing.collapsedDefault || false, updatedAt: now };
      } else {
        configs.push({ urlPattern: urlPattern, side: sidePersist, selectors: [entry], collapsedDefault: false, updatedAt: now });
      }

      var ok = await saveConfigs(configs);
      if (ok && cfg && cfg.__markConfigDirty) cfg.__markConfigDirty();
      return !!ok;
    } catch (e) {
      console.error(msg('logSaveConfigFailed'), e);
      return false;
    }
  }

export async function updateConfigFromStorage(cfg) {
    try {
      var configs = await getConfigs();
      var urlPattern = location.protocol + '//' + location.host + '/*';
      var latest = findMatchingConfig(configs, location.href);
      if (!latest) {
        latest = configs.find(function(c) { return c && c.urlPattern === urlPattern; }) || null;
      }

      if (latest) {
        cfg.selectors = Array.isArray(latest.selectors) ? latest.selectors.slice() : [];
        cfg.side = (latest.side === 'left' || latest.side === 'right') ? latest.side : cfg.side;
      } else {
        cfg.selectors = [];
      }
    } catch (e) {
      console.warn(msg('logReadConfigFailed'), e);
    }
  }
