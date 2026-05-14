import { uiConst, STORAGE_KEYS } from './constants.js';
import {
  isPlainObject,
  isExtensionContextInvalidated,
  isContextInvalidatedError,
  validateSelectorExpression,
  msg
} from './core-utils.js';
import {
  serializedWrite,
  isQuotaExceededError,
  pruneObjectToLimit
} from '../shared/storage-primitives.js';
import { showToast } from './toast.js';

  var __storageErrorOnce = new Map();
export function trackOnce(onceKey, maxKeys) {
    try {
      if (__storageErrorOnce.has(onceKey)) return false;
      __storageErrorOnce.set(onceKey, Date.now());
      var limit = Number.isFinite(maxKeys) && maxKeys > 0 ? Math.max(1, Math.floor(maxKeys)) : 200;
      while (__storageErrorOnce.size > limit) {
        var first = __storageErrorOnce.keys().next().value;
        if (first === undefined) break;
        __storageErrorOnce.delete(first);
      }
      return true;
    } catch (_) {
      return true;
    }
  }

export function notifyStorageWriteError(key, err) {
    try {
      var kind = isQuotaExceededError(err) ? 'quota' : 'unknown';
      var onceKey = kind + ':' + String(key || '');
      // Prevent unbounded growth in long-lived pages.
      var maxKeys = uiConst('STORAGE_ERROR_ONCE_MAX_KEYS', 200);
      if (!trackOnce(onceKey, maxKeys)) return;
      var errStr = String(err && (err.message || err.toString && err.toString() || err) || '');
      console.warn('[toc] storage write failed: key="' + key + '", error="' + errStr + '"');
      if (typeof document !== 'undefined' && document.documentElement) {
        if (typeof showToast === 'function') {
          var messageKey = kind === 'quota' ? 'errorStorageQuotaExceeded' : 'errorStorageWriteFailed';
          var text = msg(messageKey);
          if (text && text !== messageKey) {
            showToast(text, { type: 'error' });
          }
        }
      }
    } catch (_) {}
  }

export function normalizeSelectorEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var type = entry.type === 'css' || entry.type === 'xpath' ? entry.type : null;
    if (!type) return null;
    var expr = String(entry.expr || '').trim();
    if (!expr) return null;
    if (type === 'css' && expr.length > uiConst('CSS_SELECTOR_MAX_LENGTH', 2000)) return null;
    if (type === 'xpath' && expr.length > uiConst('XPATH_MAX_LENGTH', 2000)) return null;
    try {
      if (typeof validateSelectorExpression === 'function' && !validateSelectorExpression(type, expr)) return null;
    } catch (_) {
      return null;
    }
    var result = Object.assign({}, entry, { type: type, expr: expr });
    return result;
  }

export function normalizeTocConfigs(value, opts) {
    if (!opts) opts = {};
    var list = Array.isArray(value) ? value : [];
    var maxSitesRaw = uiConst('STORAGE_MAX_SITES', 200);
    var maxSelectorsRaw = uiConst('STORAGE_MAX_SELECTORS_PER_SITE', 50);
    var maxSites = Number.isFinite(opts.maxSites) ? opts.maxSites : maxSitesRaw;
    var maxSelectorsPerSite = Number.isFinite(opts.maxSelectorsPerSite) ? opts.maxSelectorsPerSite : maxSelectorsRaw;
    var aggressive = !!opts.aggressive;
    var finalMaxSites = aggressive ? Math.max(20, Math.floor(maxSites * 0.6)) : maxSites;
    var finalMaxSelectors = aggressive ? Math.max(10, Math.floor(maxSelectorsPerSite * 0.6)) : maxSelectorsPerSite;

    var normalized = [];
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      if (!raw || typeof raw !== 'object') continue;
      var urlPattern = String(raw.urlPattern || '').trim();
      if (!urlPattern) continue;
      var side = raw.side === 'left' || raw.side === 'right' ? raw.side : 'right';

      var selectorsRaw = Array.isArray(raw.selectors) ? raw.selectors : [];
      var selectors = [];
      var seen = new Set();
      for (var si = 0; si < selectorsRaw.length; si++) {
        var s = selectorsRaw[si];
        var norm = normalizeSelectorEntry(s);
        if (!norm) continue;
        var dedupeKey = norm.type + ':' + norm.expr;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        selectors.push(norm);
        if (selectors.length >= finalMaxSelectors) break;
      }

      var updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
      normalized.push({
        rawIndex: i,
        cfg: Object.assign({}, raw, {
          urlPattern: urlPattern,
          side: side,
          selectors: selectors,
          collapsedDefault: !!raw.collapsedDefault,
          updatedAt: updatedAt
        })
      });
    }

    // Deduplicate by urlPattern, keep the most recently updated (or latest occurrence).
    var byPattern = new Map();
    for (var ni = 0; ni < normalized.length; ni++) {
      var item = normalized[ni];
      var key = item.cfg.urlPattern;
      var prev = byPattern.get(key);
      if (!prev) {
        byPattern.set(key, item);
        continue;
      }
      var prevAt = Number.isFinite(prev.cfg.updatedAt) ? prev.cfg.updatedAt : 0;
      var nextAt = Number.isFinite(item.cfg.updatedAt) ? item.cfg.updatedAt : 0;
      if (nextAt > prevAt || (nextAt === prevAt && item.rawIndex > prev.rawIndex)) {
        byPattern.set(key, item);
      }
    }

    var deduped = Array.from(byPattern.values());
    // Prefer recently updated, otherwise preserve recent insertion order.
    deduped.sort(function(a, b) {
      var at = Number.isFinite(a.cfg.updatedAt) ? a.cfg.updatedAt : 0;
      var bt = Number.isFinite(b.cfg.updatedAt) ? b.cfg.updatedAt : 0;
      if (at !== bt) return bt - at;
      return b.rawIndex - a.rawIndex;
    });

    return deduped.slice(0, finalMaxSites).map(function(x) { return x.cfg; });
  }

export function validateStorageValue(key, value) {
    if (key === STORAGE_KEYS.TOC_CONFIGS) return Array.isArray(value);
    if (key === STORAGE_KEYS.SITE_ENABLE_MAP) return isPlainObject(value);
    if (key === STORAGE_KEYS.PANEL_STATE_MAP) return isPlainObject(value);
    if (key === STORAGE_KEYS.BADGE_POS_MAP) return isPlainObject(value);
    return true;
  }

export function normalizeStorageValue(key, value, opts) {
    if (!opts) opts = {};
    if (key === STORAGE_KEYS.TOC_CONFIGS) return normalizeTocConfigs(value, opts);
    if (key === STORAGE_KEYS.SITE_ENABLE_MAP || key === STORAGE_KEYS.PANEL_STATE_MAP || key === STORAGE_KEYS.BADGE_POS_MAP) {
      var map = isPlainObject(value) ? Object.assign({}, value) : {};
      if (key === STORAGE_KEYS.BADGE_POS_MAP) {
        // Back-compat: older versions stored {left, top}. Current code uses badge center {x, y}.
        var bw = uiConst('BADGE_WIDTH', 80);
        var bh = uiConst('BADGE_HEIGHT', 32);
        var hosts = Object.keys(map);
        for (var hi = 0; hi < hosts.length; hi++) {
          var host = hosts[hi];
          var pos = map[host];
          if (!isPlainObject(pos)) continue;
          if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) continue;
          if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
            map[host] = Object.assign({}, pos, { x: pos.left + bw / 2, y: pos.top + bh / 2 });
          }
        }
      }
      return pruneObjectToLimit(map, uiConst('STORAGE_MAX_MAP_KEYS', 400));
    }
    return value;
  }

  /**
   * Read a value from chrome.storage.local with fallback.
   * @param {string} key
   * @param {*} fallback
   * @returns {Promise<*>}
   */
export function getStorage(key, fallback) {
    // Check if extension context is invalidated before calling Chrome API
    if (isExtensionContextInvalidated()) {
      return Promise.resolve(fallback);
    }
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        return chrome.storage.local.get([key]).then(function(res) {
          var value = res[key];
          if (value !== undefined && validateStorageValue(key, value)) {
            return normalizeStorageValue(key, value);
          }
          return fallback;
        }).catch(function(e) {
          // Silently handle context invalidated errors
          if (isContextInvalidatedError(e)) {
            return fallback;
          }
          if (isQuotaExceededError(e)) {
            var onceKey = 'read-quota:' + String(key || '');
            if (trackOnce(onceKey, uiConst('WARN_ONCE_MAX_KEYS', 200))) {
              console.warn('[toc] storage read failed (quota):', { key: key, err: e });
            }
          }
          return fallback;
        });
      }
    } catch (e) {
      if (isContextInvalidatedError(e)) {
        return Promise.resolve(fallback);
      }
    }
    return Promise.resolve(fallback);
  }

  /**
   * Write a value to chrome.storage.local.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<boolean>}
   */
export function setStorage(key, value) {
    // Check if extension context is invalidated before calling Chrome API
    if (isExtensionContextInvalidated()) {
      return Promise.resolve(false);
    }
    var normalized = normalizeStorageValue(key, value);
    var storageSet = function(val) {
      var obj = {};
      obj[key] = val;
      return chrome.storage.local.set(obj);
    };
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        return storageSet(normalized).then(function() {
          return true;
        }).catch(function(e) {
          // Silently handle context invalidated errors
          if (isContextInvalidatedError(e)) {
            return false;
          }
          if (isQuotaExceededError(e)) {
            try {
              var shrunk = normalizeStorageValue(key, value, { aggressive: true });
              var summarize = function(k, v) {
                try {
                  if (k === STORAGE_KEYS.TOC_CONFIGS && Array.isArray(v)) {
                    var selectors = 0;
                    for (var ci = 0; ci < v.length; ci++) {
                      var c = v[ci];
                      selectors += (c && Array.isArray(c.selectors)) ? c.selectors.length : 0;
                    }
                    return { kind: 'configs', sites: v.length, selectors: selectors };
                  }
                  if ((k === STORAGE_KEYS.SITE_ENABLE_MAP || k === STORAGE_KEYS.PANEL_STATE_MAP || k === STORAGE_KEYS.BADGE_POS_MAP) && isPlainObject(v)) {
                    return { kind: 'map', keys: Object.keys(v).length };
                  }
                } catch (_) {}
                return null;
              };
              var before = summarize(key, value);
              var after = summarize(key, shrunk);
              var shrunkConfigs = before && after && before.kind === 'configs' && after.kind === 'configs'
                && (after.sites < before.sites || after.selectors < before.selectors);
              var shrunkMap = before && after && before.kind === 'map' && after.kind === 'map' && (after.keys < before.keys);
              var wouldPrune = !!(shrunkConfigs || shrunkMap);

              if (wouldPrune) {
                var confirmTextKey = 'confirmStorageQuotaPrune';
                var confirmText = msg(confirmTextKey);
                var fallbackText = 'Storage quota reached. To save this change, older data must be removed. Continue?';
                var text = (confirmText && confirmText !== confirmTextKey) ? confirmText : fallbackText;
                var canConfirm = (typeof window !== 'undefined' && window && typeof window.confirm === 'function');
                if (!canConfirm) {
                  notifyStorageWriteError(key, e);
                  return false;
                }
                var ok = false;
                try { ok = window.confirm(text); } catch (_) { ok = false; }
                if (!ok) {
                  var warnKey = 'warningStorageQuotaNotSaved';
                  var warnText = msg(warnKey);
                  var fallbackWarn = 'Storage quota reached. Changes were not saved.';
                  if (typeof showToast === 'function') {
                    showToast((warnText && warnText !== warnKey) ? warnText : fallbackWarn, { type: 'warning', durationMs: 5000 });
                  }
                  return false;
                }
              }
              return storageSet(shrunk).then(function() {
                try {
                  if (wouldPrune && before && after) {
                    var onceKey = 'pruned:' + String(key || '');
                    var maxKeys = uiConst('STORAGE_ERROR_ONCE_MAX_KEYS', 200);
                    if (trackOnce(onceKey, maxKeys)) {
                      console.warn('[toc] storage quota reached, saved with pruning:', { key: key, before: before, after: after });
                      var wKey = 'warningStorageQuotaPruned';
                      var wText = msg(wKey);
                      var fText = 'Storage quota reached. Some older data was removed to save your changes.';
                      if (typeof showToast === 'function') {
                        showToast((wText && wText !== wKey) ? wText : fText, { type: 'warning', durationMs: 5000 });
                      }
                    }
                  }
                } catch (_) {}
                return true;
              }).catch(function() {
                return false;
              });
            } catch (_) {
              return false;
            }
          }
          // Other errors (including context invalidated) are silently ignored.
          // Context invalidated is expected when extension is reloaded without page refresh.
          return false;
        });
      }
    } catch (e) {
      if (isContextInvalidatedError(e)) {
        return Promise.resolve(false);
      }
    }
    return Promise.resolve(false);
  }

  /**
   * Get configs from chrome.storage.local
   * @returns {Promise<Array>}
   */
export function getConfigs() {
    return getStorage(STORAGE_KEYS.TOC_CONFIGS, []);
  }

  /**
   * Save configs to chrome.storage.local
   * @param {Array} configs
   * @returns {Promise<void>}
   */
export function saveConfigs(configs) {
    return serializedWrite(STORAGE_KEYS.TOC_CONFIGS, function() { return setStorage(STORAGE_KEYS.TOC_CONFIGS, configs); });
  }

  /**
   * Get site enabled map { origin: boolean } from chrome.storage.local
   * @returns {Promise<Record<string, boolean>>}
   */
export function getEnabledMap() {
    return getStorage(STORAGE_KEYS.SITE_ENABLE_MAP, {});
  }

  /**
   * Save site enabled map to chrome.storage.local
   * @param {Record<string, boolean>} map
   */
export function saveEnabledMap(map) {
    return setStorage(STORAGE_KEYS.SITE_ENABLE_MAP, map);
  }

  /**
   * Get panel expanded state map { origin: boolean } from chrome.storage.local
   */
export function getPanelStateMap() {
    return getStorage(STORAGE_KEYS.PANEL_STATE_MAP, {});
  }

  /**
   * Save panel expanded state map
   * @param {Record<string, boolean>} map
   */
export function savePanelStateMap(map) {
    return setStorage(STORAGE_KEYS.PANEL_STATE_MAP, map);
  }

  /**
   * Get badge position map { host: { x, y, vw?, vh?, anchorX?, marginX? } }
   */
export function getBadgePosMap() {
    return getStorage(STORAGE_KEYS.BADGE_POS_MAP, {});
  }

  /**
   * Save badge position map
   * @param {Record<string, any>} map
   */
export function saveBadgePosMap(map) {
    return setStorage(STORAGE_KEYS.BADGE_POS_MAP, map);
  }
