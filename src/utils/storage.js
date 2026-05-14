(() => {
  const T = globalThis.TOC_UTILS;
  if (!T) return;

  const {
    uiConst,
    isPlainObject,
    isExtensionContextInvalidated,
    isContextInvalidatedError,
    msg,
    showToast,
    STORAGE_KEYS
  } = T;

  const __writeQueues = {};
  function serializedWrite(key, asyncFn) {
    const prev = __writeQueues[key] || Promise.resolve();
    const run = () => asyncFn();
    const next = prev.then(run, run);
    __writeQueues[key] = next.catch(() => {});
    return next;
  }

  function touchObjectKey(map, key, value) {
    try {
      if (!map || !key) return;
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        try { delete map[key]; } catch (_) {}
      }
      map[key] = value;
    } catch (_) {}
  }

  function pruneObjectToLimit(map, maxKeys) {
    try {
      if (!isPlainObject(map)) return map;
      const limit = Number.isFinite(maxKeys) ? Math.max(1, Math.floor(maxKeys)) : uiConst('STORAGE_MAX_MAP_KEYS', 400);
      const keys = Object.keys(map);
      if (keys.length <= limit) return map;
      const removeCount = keys.length - limit;
      for (let i = 0; i < removeCount; i++) {
        try { delete map[keys[i]]; } catch (_) {}
      }
      return map;
    } catch (_) {
      return map;
    }
  }

  const __storageErrorOnce = new Map();
  function trackOnce(onceKey, maxKeys) {
    try {
      if (__storageErrorOnce.has(onceKey)) return false;
      __storageErrorOnce.set(onceKey, Date.now());
      const limit = Number.isFinite(maxKeys) && maxKeys > 0 ? Math.max(1, Math.floor(maxKeys)) : 200;
      while (__storageErrorOnce.size > limit) {
        const first = __storageErrorOnce.keys().next().value;
        if (first === undefined) break;
        __storageErrorOnce.delete(first);
      }
      return true;
    } catch (_) {
      return true;
    }
  }

  function isQuotaExceededError(err) {
    try {
      if (!err) return false;
      if (err.name === 'QuotaExceededError') return true;
      const text = String(err && (err.message || err.toString && err.toString() || err) || '');
      return /quota/i.test(text) || /QUOTA_BYTES/i.test(text) || /MAX_WRITE_OPERATIONS/i.test(text);
    } catch (_) {
      return false;
    }
  }

  function notifyStorageWriteError(key, err) {
    try {
      const kind = isQuotaExceededError(err) ? 'quota' : 'unknown';
      const onceKey = `${kind}:${String(key || '')}`;
      // Prevent unbounded growth in long-lived pages.
      const maxKeys = uiConst('STORAGE_ERROR_ONCE_MAX_KEYS', 200);
      if (!trackOnce(onceKey, maxKeys)) return;
      const errStr = String(err && (err.message || err.toString && err.toString() || err) || '');
      console.warn(`[toc] storage write failed: key="${key}", error="${errStr}"`);
      if (typeof document !== 'undefined' && document.documentElement && typeof showToast === 'function') {
        const messageKey = kind === 'quota' ? 'errorStorageQuotaExceeded' : 'errorStorageWriteFailed';
        const text = msg(messageKey);
        if (text && text !== messageKey) {
          showToast(text, { type: 'error' });
        }
      }
    } catch (_) {}
  }

  function normalizeSelectorEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const type = entry.type === 'css' || entry.type === 'xpath' ? entry.type : null;
    if (!type) return null;
    const expr = String(entry.expr || '').trim();
    if (!expr) return null;
    if (type === 'css' && expr.length > uiConst('CSS_SELECTOR_MAX_LENGTH', 2000)) return null;
    if (type === 'xpath' && expr.length > uiConst('XPATH_MAX_LENGTH', 2000)) return null;
    try {
      const validateSelectorExpression = T.validateSelectorExpression;
      if (typeof validateSelectorExpression === 'function' && !validateSelectorExpression(type, expr)) return null;
    } catch (_) {
      return null;
    }
    return { ...entry, type, expr };
  }

  function normalizeTocConfigs(value, opts = {}) {
    const list = Array.isArray(value) ? value : [];
    const maxSitesRaw = uiConst('STORAGE_MAX_SITES', 200);
    const maxSelectorsRaw = uiConst('STORAGE_MAX_SELECTORS_PER_SITE', 50);
    const maxSites = Number.isFinite(opts.maxSites) ? opts.maxSites : maxSitesRaw;
    const maxSelectorsPerSite = Number.isFinite(opts.maxSelectorsPerSite) ? opts.maxSelectorsPerSite : maxSelectorsRaw;
    const aggressive = !!opts.aggressive;
    const finalMaxSites = aggressive ? Math.max(20, Math.floor(maxSites * 0.6)) : maxSites;
    const finalMaxSelectors = aggressive ? Math.max(10, Math.floor(maxSelectorsPerSite * 0.6)) : maxSelectorsPerSite;

    const normalized = [];
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (!raw || typeof raw !== 'object') continue;
      const urlPattern = String(raw.urlPattern || '').trim();
      if (!urlPattern) continue;
      const side = raw.side === 'left' || raw.side === 'right' ? raw.side : 'right';

      const selectorsRaw = Array.isArray(raw.selectors) ? raw.selectors : [];
      const selectors = [];
      const seen = new Set();
      for (const s of selectorsRaw) {
        const norm = normalizeSelectorEntry(s);
        if (!norm) continue;
        const dedupeKey = `${norm.type}:${norm.expr}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        selectors.push(norm);
        if (selectors.length >= finalMaxSelectors) break;
      }

      const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
      normalized.push({
        rawIndex: i,
        cfg: {
          ...raw,
          urlPattern,
          side,
          selectors,
          collapsedDefault: !!raw.collapsedDefault,
          updatedAt
        }
      });
    }

    // Deduplicate by urlPattern, keep the most recently updated (or latest occurrence).
    const byPattern = new Map();
    for (const item of normalized) {
      const key = item.cfg.urlPattern;
      const prev = byPattern.get(key);
      if (!prev) {
        byPattern.set(key, item);
        continue;
      }
      const prevAt = Number.isFinite(prev.cfg.updatedAt) ? prev.cfg.updatedAt : 0;
      const nextAt = Number.isFinite(item.cfg.updatedAt) ? item.cfg.updatedAt : 0;
      if (nextAt > prevAt || (nextAt === prevAt && item.rawIndex > prev.rawIndex)) {
        byPattern.set(key, item);
      }
    }

    const deduped = Array.from(byPattern.values());
    // Prefer recently updated, otherwise preserve recent insertion order.
    deduped.sort((a, b) => {
      const at = Number.isFinite(a.cfg.updatedAt) ? a.cfg.updatedAt : 0;
      const bt = Number.isFinite(b.cfg.updatedAt) ? b.cfg.updatedAt : 0;
      if (at !== bt) return bt - at;
      return b.rawIndex - a.rawIndex;
    });

    return deduped.slice(0, finalMaxSites).map(x => x.cfg);
  }

  function validateStorageValue(key, value) {
    if (key === STORAGE_KEYS.TOC_CONFIGS) return Array.isArray(value);
    if (key === STORAGE_KEYS.SITE_ENABLE_MAP) return isPlainObject(value);
    if (key === STORAGE_KEYS.PANEL_STATE_MAP) return isPlainObject(value);
    if (key === STORAGE_KEYS.BADGE_POS_MAP) return isPlainObject(value);
    return true;
  }

  function normalizeStorageValue(key, value, opts = {}) {
    if (key === STORAGE_KEYS.TOC_CONFIGS) return normalizeTocConfigs(value, opts);
    if (key === STORAGE_KEYS.SITE_ENABLE_MAP || key === STORAGE_KEYS.PANEL_STATE_MAP || key === STORAGE_KEYS.BADGE_POS_MAP) {
      const map = isPlainObject(value) ? { ...value } : {};
      if (key === STORAGE_KEYS.BADGE_POS_MAP) {
        // Back-compat: older versions stored {left, top}. Current code uses badge center {x, y}.
        const bw = uiConst('BADGE_WIDTH', 80);
        const bh = uiConst('BADGE_HEIGHT', 32);
        for (const host of Object.keys(map)) {
          const pos = map[host];
          if (!isPlainObject(pos)) continue;
          if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) continue;
          if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
            map[host] = { ...pos, x: pos.left + bw / 2, y: pos.top + bh / 2 };
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
  async function getStorage(key, fallback) {
    // Check if extension context is invalidated before calling Chrome API
    if (isExtensionContextInvalidated()) {
      return fallback;
    }
    try {
      if (chrome?.storage?.local) {
        const res = await chrome.storage.local.get([key]);
        const value = res[key];
        if (value !== undefined && validateStorageValue(key, value)) {
          return normalizeStorageValue(key, value);
        }
        return fallback;
      }
    } catch (e) {
      // Silently handle context invalidated errors
      if (isContextInvalidatedError(e)) {
        return fallback;
      }
      if (isQuotaExceededError(e)) {
        const onceKey = `read-quota:${String(key || '')}`;
        if (trackOnce(onceKey, uiConst('WARN_ONCE_MAX_KEYS', 200))) {
          console.warn('[toc] storage read failed (quota):', { key, err: e });
        }
      }
    }
    return fallback;
  }

  /**
   * Write a value to chrome.storage.local.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<boolean>}
   */
  async function setStorage(key, value) {
    // Check if extension context is invalidated before calling Chrome API
    if (isExtensionContextInvalidated()) {
      return false;
    }
    const normalized = normalizeStorageValue(key, value);
    try {
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ [key]: normalized });
      }
      return true;
    } catch (e) {
      // Silently handle context invalidated errors
      if (isContextInvalidatedError(e)) {
        return false;
      }
      if (isQuotaExceededError(e)) {
        try {
          const shrunk = normalizeStorageValue(key, value, { aggressive: true });
          const summarize = (k, v) => {
            try {
              if (k === STORAGE_KEYS.TOC_CONFIGS && Array.isArray(v)) {
                let selectors = 0;
                for (const c of v) selectors += (c && Array.isArray(c.selectors)) ? c.selectors.length : 0;
                return { kind: 'configs', sites: v.length, selectors };
              }
              if ((k === STORAGE_KEYS.SITE_ENABLE_MAP || k === STORAGE_KEYS.PANEL_STATE_MAP || k === STORAGE_KEYS.BADGE_POS_MAP) && isPlainObject(v)) {
                return { kind: 'map', keys: Object.keys(v).length };
              }
            } catch (_) {}
            return null;
          };
          const before = summarize(key, value);
          const after = summarize(key, shrunk);
          const shrunkConfigs = before && after && before.kind === 'configs' && after.kind === 'configs'
            && (after.sites < before.sites || after.selectors < before.selectors);
          const shrunkMap = before && after && before.kind === 'map' && after.kind === 'map' && (after.keys < before.keys);
          const wouldPrune = !!(shrunkConfigs || shrunkMap);

          if (wouldPrune) {
            const confirmTextKey = 'confirmStorageQuotaPrune';
            const confirmText = msg(confirmTextKey);
            const fallbackText = 'Storage quota reached. To save this change, older data must be removed. Continue?';
            const text = (confirmText && confirmText !== confirmTextKey) ? confirmText : fallbackText;
            const canConfirm = (typeof window !== 'undefined' && window && typeof window.confirm === 'function');
            if (!canConfirm) {
              notifyStorageWriteError(key, e);
              return false;
            }
            let ok = false;
            try { ok = window.confirm(text); } catch (_) { ok = false; }
            if (!ok) {
              const warnKey = 'warningStorageQuotaNotSaved';
              const warnText = msg(warnKey);
              const fallbackWarn = 'Storage quota reached. Changes were not saved.';
              if (typeof showToast === 'function') {
                showToast((warnText && warnText !== warnKey) ? warnText : fallbackWarn, { type: 'warning', durationMs: 5000 });
              }
              return false;
            }
          }
          if (chrome?.storage?.local) {
            await chrome.storage.local.set({ [key]: shrunk });
            try {
              if (wouldPrune && before && after) {
                const onceKey = `pruned:${String(key || '')}`;
                const maxKeys = uiConst('STORAGE_ERROR_ONCE_MAX_KEYS', 200);
                if (trackOnce(onceKey, maxKeys)) {
                  console.warn('[toc] storage quota reached, saved with pruning:', { key, before, after });
                  const warnKey = 'warningStorageQuotaPruned';
                  const warnText = msg(warnKey);
                  const fallbackText = 'Storage quota reached. Some older data was removed to save your changes.';
                  if (typeof showToast === 'function') {
                    showToast((warnText && warnText !== warnKey) ? warnText : fallbackText, { type: 'warning', durationMs: 5000 });
                  }
                }
              }
            } catch (_) {}
            return true;
          }
        } catch (_) {}
      }
      // Other errors (including context invalidated) are silently ignored.
      // Context invalidated is expected when extension is reloaded without page refresh.
      return false;
    }
  }

  /**
   * Get configs from chrome.storage.local
   * @returns {Promise<Array>}
   */
  async function getConfigs() {
    return await getStorage(STORAGE_KEYS.TOC_CONFIGS, []);
  }

  /**
   * Save configs to chrome.storage.local
   * @param {Array} configs
   * @returns {Promise<void>}
   */
  async function saveConfigs(configs) {
    return await serializedWrite(STORAGE_KEYS.TOC_CONFIGS, () => setStorage(STORAGE_KEYS.TOC_CONFIGS, configs));
  }

  /**
   * Get site enabled map { origin: boolean } from chrome.storage.local
   * @returns {Promise<Record<string, boolean>>}
   */
  async function getEnabledMap() {
    return await getStorage(STORAGE_KEYS.SITE_ENABLE_MAP, {});
  }

  /**
   * Save site enabled map to chrome.storage.local
   * @param {Record<string, boolean>} map
   */
  async function saveEnabledMap(map) {
    return await setStorage(STORAGE_KEYS.SITE_ENABLE_MAP, map);
  }

  /**
   * Get panel expanded state map { origin: boolean } from chrome.storage.local
   */
  async function getPanelStateMap() {
    return await getStorage(STORAGE_KEYS.PANEL_STATE_MAP, {});
  }

  /**
   * Save panel expanded state map
   * @param {Record<string, boolean>} map
   */
  async function savePanelStateMap(map) {
    return await setStorage(STORAGE_KEYS.PANEL_STATE_MAP, map);
  }

  /**
   * Get badge position map { host: { x, y, vw?, vh?, anchorX?, marginX? } }
   */
  async function getBadgePosMap() {
    return await getStorage(STORAGE_KEYS.BADGE_POS_MAP, {});
  }

  /**
   * Save badge position map
   * @param {Record<string, any>} map
   */
  async function saveBadgePosMap(map) {
    return await setStorage(STORAGE_KEYS.BADGE_POS_MAP, map);
  }

  Object.assign(T, {
    serializedWrite,
    touchObjectKey,
    pruneObjectToLimit,
    trackOnce,
    isQuotaExceededError,
    notifyStorageWriteError,
    normalizeSelectorEntry,
    normalizeTocConfigs,
    validateStorageValue,
    normalizeStorageValue,
    getStorage,
    setStorage,
    getConfigs,
    saveConfigs,
    getEnabledMap,
    saveEnabledMap,
    getPanelStateMap,
    savePanelStateMap,
    getBadgePosMap,
    saveBadgePosMap
  });
})();
