
import { STORAGE_KEYS, SELECTOR_EXPR_MAX_LENGTH, MAP_MAX_KEYS } from './constants.js';
// Note: PANEL_STATE_MAP ('tocPanelExpandedMap') is a legacy key from the removed Classic UI.
// It is kept in STORAGE_KEYS only to silently clean up storage reads; no active code writes to it.
import {
  isPlainObject,
  isExtensionContextInvalidated,
  isContextInvalidatedError,
  validateSelectorExpression
} from './core-utils.js';
import { serializedWrite, pruneObjectToLimit, normalizeSide } from '../shared/primitives.js';

function normalizeSelectorEntry(entry: any) {
    if (!entry || typeof entry !== 'object') return null;
    var type = entry.type === 'css' || entry.type === 'xpath' ? entry.type : null;
    if (!type) return null;
    var expr = String(entry.expr || '').trim();
    if (!expr) return null;
    if (expr.length > SELECTOR_EXPR_MAX_LENGTH) return null;
    try {
      if (!validateSelectorExpression(type, expr)) return null;
    } catch (_) {
      return null;
    }
    return Object.assign({}, entry, { type: type, expr: expr });
  }



function normalizeTocConfigs(value: unknown) {
    var list: any[] = Array.isArray(value) ? value : [];
    var maxSites = 200;
    var maxSelectorsPerSite = 50;

    var normalized: any[] = [];
    var seen = new Set<string>();
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      if (!raw || typeof raw !== 'object') continue;
      var urlPattern = String(raw.urlPattern || '').trim();
      if (!urlPattern) continue;
      // Deduplicate by urlPattern
      if (seen.has(urlPattern)) continue;
      seen.add(urlPattern);

      var side = normalizeSide(raw.side);
      var selectorsRaw: any[] = Array.isArray(raw.selectors) ? raw.selectors : [];
      var selectors: any[] = [];
      var selSeen = new Set<string>();
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
      delete cfg.collapsedDefault; // legacy Classic UI field cleanup
      normalized.push(cfg);
      if (normalized.length >= maxSites) break;
    }

    return normalized;
  }

function validateStorageValue(key: string, value: unknown) {
    if (key === STORAGE_KEYS.TOC_CONFIGS) return Array.isArray(value);
    if (key === STORAGE_KEYS.SITE_ENABLE_MAP) return isPlainObject(value);
    if (key === STORAGE_KEYS.BADGE_POS_MAP) return isPlainObject(value);

    return true;
  }

function normalizeStorageValue(key: string, value: unknown) {
    if (key === STORAGE_KEYS.TOC_CONFIGS) return normalizeTocConfigs(value);

    if (key === STORAGE_KEYS.SITE_ENABLE_MAP || key === STORAGE_KEYS.BADGE_POS_MAP) {
      var map = isPlainObject(value) ? Object.assign({}, value) : {};
      return pruneObjectToLimit(map as Record<string, unknown>, MAP_MAX_KEYS);
    }
    return value;
  }

  /**
   * Read a value from chrome.storage.local with fallback.
   */
async function getStorage<T>(key: string, fallback: T): Promise<T> {
    if (isExtensionContextInvalidated()) return fallback;
    try {
      var res = await chrome.storage.local.get([key]);
      var value = res[key];
      if (value !== undefined && validateStorageValue(key, value)) {
        return normalizeStorageValue(key, value) as T;
      }
      return fallback;
    } catch (e) {
      if (isContextInvalidatedError(e)) return fallback;
      return fallback;
    }
  }

  /**
   * Write a value to chrome.storage.local.
   */
async function setStorage(key: string, value: unknown): Promise<boolean> {
    if (isExtensionContextInvalidated()) return false;
    var normalized = normalizeStorageValue(key, value);
    try {
      var obj: Record<string, unknown> = {};
      obj[key] = normalized;
      await chrome.storage.local.set(obj);
      return true;
    } catch (e) {
      if (isContextInvalidatedError(e)) return false;
      console.warn('[toc] storage write failed:', key, e);
      return false;
    }
  }

  // Convenience accessors

export function getConfigs() {
    return getStorage<Array<{ urlPattern?: string; selectors?: Array<{ type: string; expr: string }>; side?: string }>>(STORAGE_KEYS.TOC_CONFIGS, []);
  }

export function getEnabledMap() {
    return getStorage<Record<string, boolean>>(STORAGE_KEYS.SITE_ENABLE_MAP, {});
  }

export function getBadgePosMap() {
    return getStorage(STORAGE_KEYS.BADGE_POS_MAP, {});
  }

export function saveBadgePosMap(map: Record<string, unknown>) {
    return setStorage(STORAGE_KEYS.BADGE_POS_MAP, map);
  }

