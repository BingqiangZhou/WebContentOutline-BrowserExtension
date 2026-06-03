import { STORAGE_KEYS } from './constants.js';
import {
  isPlainObject,
  isExtensionContextInvalidated,
  isContextInvalidatedError,
  validateSelectorExpression
} from './core-utils.js';
import { serializedWrite, pruneObjectToLimit } from '../shared/primitives.js';

export function normalizeSelectorEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var type = entry.type === 'css' || entry.type === 'xpath' ? entry.type : null;
    if (!type) return null;
    var expr = String(entry.expr || '').trim();
    if (!expr) return null;
    if (type === 'css' && expr.length > 2000) return null;
    if (type === 'xpath' && expr.length > 2000) return null;
    try {
      if (typeof validateSelectorExpression === 'function' && !validateSelectorExpression(type, expr)) return null;
    } catch (_) {
      return null;
    }
    return Object.assign({}, entry, { type: type, expr: expr });
  }

export function normalizeUiMode(mode) {
    return mode === 'classic' ? 'classic' : 'edge-dock';
  }

export function normalizeTocConfigs(value) {
    var list = Array.isArray(value) ? value : [];
    var maxSites = 200;
    var maxSelectorsPerSite = 50;

    var normalized = [];
    var seen = new Set();
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      if (!raw || typeof raw !== 'object') continue;
      var urlPattern = String(raw.urlPattern || '').trim();
      if (!urlPattern) continue;
      // Deduplicate by urlPattern
      if (seen.has(urlPattern)) continue;
      seen.add(urlPattern);

      var side = raw.side === 'left' || raw.side === 'right' ? raw.side : 'right';
      var selectorsRaw = Array.isArray(raw.selectors) ? raw.selectors : [];
      var selectors = [];
      var selSeen = new Set();
      for (var si = 0; si < selectorsRaw.length; si++) {
        var norm = normalizeSelectorEntry(selectorsRaw[si]);
        if (!norm) continue;
        var dedupeKey = norm.type + ':' + norm.expr;
        if (selSeen.has(dedupeKey)) continue;
        selSeen.add(dedupeKey);
        selectors.push(norm);
        if (selectors.length >= maxSelectorsPerSite) break;
      }

      var cfg = Object.assign({}, raw, { urlPattern: urlPattern, side: side, selectors: selectors });
      delete cfg.collapsedDefault;
      normalized.push(cfg);
      if (normalized.length >= maxSites) break;
    }

    return normalized;
  }

export function validateStorageValue(key, value) {
    if (key === STORAGE_KEYS.TOC_CONFIGS) return Array.isArray(value);
    if (key === STORAGE_KEYS.SITE_ENABLE_MAP) return isPlainObject(value);
    if (key === STORAGE_KEYS.PANEL_STATE_MAP) return isPlainObject(value);
    if (key === STORAGE_KEYS.BADGE_POS_MAP) return isPlainObject(value);
    if (key === STORAGE_KEYS.UI_MODE) return typeof value === 'string';
    return true;
  }

export function normalizeStorageValue(key, value) {
    if (key === STORAGE_KEYS.TOC_CONFIGS) return normalizeTocConfigs(value);
    if (key === STORAGE_KEYS.UI_MODE) return normalizeUiMode(value);
    if (key === STORAGE_KEYS.SITE_ENABLE_MAP || key === STORAGE_KEYS.PANEL_STATE_MAP || key === STORAGE_KEYS.BADGE_POS_MAP) {
      var map = isPlainObject(value) ? Object.assign({}, value) : {};
      if (key === STORAGE_KEYS.BADGE_POS_MAP) {
        // Back-compat: older versions stored {left, top}. Current code uses badge center {x, y}.
        var hosts = Object.keys(map);
        for (var hi = 0; hi < hosts.length; hi++) {
          var pos = map[hosts[hi]];
          if (!isPlainObject(pos)) continue;
          if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) continue;
          if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
            map[hosts[hi]] = Object.assign({}, pos, { x: pos.left + 40, y: pos.top + 16 });
          }
        }
      }
      return pruneObjectToLimit(map, 400);
    }
    return value;
  }

  /**
   * Read a value from chrome.storage.local with fallback.
   */
export function getStorage(key, fallback) {
    if (isExtensionContextInvalidated()) return Promise.resolve(fallback);
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        return chrome.storage.local.get([key]).then(function(res) {
          var value = res[key];
          if (value !== undefined && validateStorageValue(key, value)) {
            return normalizeStorageValue(key, value);
          }
          return fallback;
        }).catch(function(e) {
          if (isContextInvalidatedError(e)) return fallback;
          return fallback;
        });
      }
    } catch (e) {
      if (isContextInvalidatedError(e)) return Promise.resolve(fallback);
    }
    return Promise.resolve(fallback);
  }

  /**
   * Write a value to chrome.storage.local.
   */
export function setStorage(key, value) {
    if (isExtensionContextInvalidated()) return Promise.resolve(false);
    var normalized = normalizeStorageValue(key, value);
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        var obj = {};
        obj[key] = normalized;
        return chrome.storage.local.set(obj).then(function() {
          return true;
        }).catch(function(e) {
          if (isContextInvalidatedError(e)) return false;
          console.warn('[toc] storage write failed:', key, e);
          return false;
        });
      }
    } catch (e) {
      if (isContextInvalidatedError(e)) return Promise.resolve(false);
    }
    return Promise.resolve(false);
  }

  // Convenience accessors

export function getConfigs() {
    return getStorage(STORAGE_KEYS.TOC_CONFIGS, []);
  }

export function saveConfigs(configs) {
    return serializedWrite(STORAGE_KEYS.TOC_CONFIGS, function() { return setStorage(STORAGE_KEYS.TOC_CONFIGS, configs); });
  }

export function getEnabledMap() {
    return getStorage(STORAGE_KEYS.SITE_ENABLE_MAP, {});
  }

export function saveEnabledMap(map) {
    return setStorage(STORAGE_KEYS.SITE_ENABLE_MAP, map);
  }

export function getPanelStateMap() {
    return getStorage(STORAGE_KEYS.PANEL_STATE_MAP, {});
  }

export function savePanelStateMap(map) {
    return setStorage(STORAGE_KEYS.PANEL_STATE_MAP, map);
  }

export function getBadgePosMap() {
    return getStorage(STORAGE_KEYS.BADGE_POS_MAP, {});
  }

export function saveBadgePosMap(map) {
    return setStorage(STORAGE_KEYS.BADGE_POS_MAP, map);
  }

export function getUiMode() {
    return getStorage(STORAGE_KEYS.UI_MODE, 'edge-dock');
  }

export function saveUiMode(mode) {
    return setStorage(STORAGE_KEYS.UI_MODE, normalizeUiMode(mode));
  }
