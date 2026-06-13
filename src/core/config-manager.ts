
'use strict';

import { createFocusTrap } from '../utils/focus-trap.js';
import {
  showToast,
  getConfigs,
  findMatchingConfig,
  getFocusableWithin,
  msg,
  validateSelectorExpression,
  normalizeSide,
  buildSitePattern
} from '../utils/toc-utils.js';
import { EXTENSION_OWNER } from '../utils/constants.js';
import { TOC_MESSAGE } from '../shared/messages.js';

  interface StoredConfig {
    urlPattern?: string;
    selectors?: Array<{ type: string; expr: string }>;
    side?: string;
  }

  // Callback set by toc-app.js via setOnConfigChanged()
  var _onConfigChanged: (() => void) | null = null;

  export function setOnConfigChanged(fn: (() => void) | null) {
    _onConfigChanged = typeof fn === 'function' ? fn : null;
  }

  export function clearOnConfigChanged() {
    _onConfigChanged = null;
  }

  function notifyConfigChanged() {
    if (_onConfigChanged) _onConfigChanged();
  }

  function requestConfigMutation(mutation: Record<string, unknown>): Promise<{ ok: boolean; reason?: string; config?: { selectors?: Array<{ type: string; expr: string }> } }> {
    return new Promise(function(resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          resolve({ ok: false, reason: 'runtime-unavailable' });
          return;
        }
        chrome.runtime.sendMessage(Object.assign({ type: TOC_MESSAGE.MUTATE_CONFIG }, mutation), function(response) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, reason: chrome.runtime.lastError.message || 'runtime-error' });
            return;
          }
          resolve(response && typeof response === 'object' ? response : { ok: false, reason: 'empty-response' });
        });
      } catch (e) {
        resolve({ ok: false, reason: String((e as Error).message || e) });
      }
    });
  }

  function selectorsFromMutationResult(result: { ok: boolean; reason?: string; config?: { selectors?: Array<{ type: string; expr: string }> } }) {
    var entry = result && result.config;
    return entry && Array.isArray(entry.selectors) ? entry.selectors.slice() : [];
  }

export async function siteConfig(cfg: { selectors?: Array<{ type: string; expr: string }>; side?: string; __markConfigDirty?: () => void }) {
    var box: HTMLDivElement | undefined;
    try {
      var prevFocus = document.activeElement as HTMLElement | null;
      var existing = document.querySelector('.toc-overlay[data-toc-owner="' + EXTENSION_OWNER + '"]');
      if (existing) {
        existing.remove();
      }

      var configs = await getConfigs() as StoredConfig[];
      var urlPattern = buildSitePattern();
      var idx = configs.findIndex(function(c) { return c && c.urlPattern === urlPattern; });
      var list: Array<{ type: string; expr: string }> = (idx >= 0 && Array.isArray(configs[idx].selectors) ? configs[idx].selectors : null) || [];

      box = document.createElement('div');
      box.className = 'toc-overlay';
      box.setAttribute('data-toc-owner', EXTENSION_OWNER);
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

      var refreshList = async function(selectors: Array<{ type: string; expr: string }>) {
        listDiv.replaceChildren();
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

                var result = await requestConfigMutation({
                  operation: 'remove-selector',
                  urlPattern: urlPattern,
                  selector: { type: selType, expr: selExpr }
                });

                if (!result || !result.ok) {
                  showToast(msg('errorOperationFailed'), { type: 'error' });
                  return;
                }

                var updatedSelectors = selectorsFromMutationResult(result);
                cfg.selectors = updatedSelectors;
                if (cfg.__markConfigDirty) cfg.__markConfigDirty();
                await refreshList(updatedSelectors);
                countLabel.textContent = msg('configSavedSelectors') + ' (' + updatedSelectors.length + ')';

                notifyConfigChanged();
              } catch (e2) {
                console.warn(msg('logClearConfigFailed'), e2);
                showToast(msg('errorOperationFailed'), { type: 'error' });
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
        if (prevFocus && prevFocus.focus && document.contains(prevFocus)) {
          prevFocus.focus({ preventScroll: true });
        }
      };
      var focusRaf: number | null = null;
      var close = function() {
        removeFocusTrap();
        removeFocusTrap = function() {};
        if (focusRaf) {
          cancelAnimationFrame(focusRaf);
          focusRaf = null;
        }
        if (box) box.remove();
        restoreFocus();
      };

      var getFocusable = function(): Element[] {
        try {
          if (box) return getFocusableWithin(box);
        } catch (_) {}
        return [];
      };

      var removeFocusTrap: (() => void) = createFocusTrap(box, { onClose: close, getFocusableWithin: getFocusable });

      box.addEventListener('click', async function(e) {
        try {
          if (!e.target || (e.target as Node).nodeType !== Node.ELEMENT_NODE) return;
          var btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
          if (!btn || btn.nodeType !== Node.ELEMENT_NODE) return;
          var act = btn.dataset.act;
          if (act === 'close') { close(); return; }
          if (act === 'clear') {
            var result = await requestConfigMutation({
              operation: 'clear-site',
              urlPattern: urlPattern
            });
            if (!result || !result.ok) {
              showToast(msg('errorOperationFailed'), { type: 'error' });
              return;
            }
            cfg.selectors = [];
            if (cfg.__markConfigDirty) cfg.__markConfigDirty();
            await refreshList([]);
            countLabel.textContent = msg('configSavedSelectors') + ' (0)';

            notifyConfigChanged();
            close();
          }
        } catch (e2) {
          console.error(msg('logClearConfigFailed'), e2);
          showToast(msg('errorOperationFailed'), { type: 'error' });
        }
      });

      document.documentElement.appendChild(box);
      focusRaf = requestAnimationFrame(function() {
        focusRaf = null;
        if (!box || !box.isConnected) return;
        btnClose.focus({ preventScroll: true });
      });
    } catch (e) {
      if (box && box.isConnected) box.remove();
      console.error(msg('logClearConfigFailed'), e);
      showToast(msg('errorOperationFailed'), { type: 'error' });
    }
  }

export async function saveSelector(selector: string, cfg: { selectors?: Array<{ type: string; expr: string }>; side?: string; __markConfigDirty?: () => void }) {
    try {
      if (!cfg) {
        showToast(msg('errorOperationFailed') || 'No config found', { type: 'error' });
        return false;
      }
      var expr = String(selector || '').trim();
      if (!expr || !validateSelectorExpression('css', expr)) {
        showToast(msg('errorInvalidSelector'), { type: 'error' });
        return false;
      }

      var urlPattern = buildSitePattern();
      var entry = { type: 'css', expr: expr };
      var sidePersist = normalizeSide(cfg.side);

      var result = await requestConfigMutation({
        operation: 'add-selector',
        urlPattern: urlPattern,
        selector: entry,
        side: sidePersist
      });
      if (result && result.ok) {
        cfg.selectors = selectorsFromMutationResult(result);
        if (cfg.__markConfigDirty) cfg.__markConfigDirty();
      }
      return !!(result && result.ok);
    } catch (e) {
      console.error(msg('logSaveConfigFailed'), e);
      return false;
    }
  }

export async function updateConfigFromStorage(cfg: { selectors?: Array<{ type: string; expr: string }>; side?: string; __markConfigDirty?: () => void }) {
    try {
      var configs = await getConfigs() as StoredConfig[];
      var urlPattern = buildSitePattern();
      var latest = findMatchingConfig(configs, location.href) as StoredConfig | null;
      if (!latest) {
        latest = configs.find(function(c) { return c && c.urlPattern === urlPattern; }) || null;
      }

      if (latest) {
        cfg.selectors = Array.isArray(latest.selectors) ? latest.selectors.slice() : [];
        cfg.side = latest.side === 'left' || latest.side === 'right' ? latest.side : cfg.side;
      } else {
        cfg.selectors = [];
      }
    } catch (e) {
      console.warn(msg('logReadConfigFailed'), e);
    }
  }
