/**
 * Storage keys
 */
const STORAGE_KEYS = {
  TOC_CONFIGS: 'tocConfigs',
  SITE_ENABLE_MAP: 'tocSiteEnabledMap',
  PANEL_STATE_MAP: 'tocPanelExpandedMap'
};

/**
 * Get configs from chrome.storage.local
 * @returns {Promise<Array>}
 */
async function getConfigs() {
  try {
    if (chrome?.storage?.local) {
      const res = await chrome.storage.local.get([STORAGE_KEYS.TOC_CONFIGS]);
      return res[STORAGE_KEYS.TOC_CONFIGS] || [];
    } else {
      const raw = localStorage.getItem(STORAGE_KEYS.TOC_CONFIGS);
      return raw ? JSON.parse(raw) : [];
    }
  } catch (e) {
    // Fallback to localStorage on error
    const raw = localStorage.getItem(STORAGE_KEYS.TOC_CONFIGS);
    return raw ? JSON.parse(raw) : [];
  }
}

/**
 * Save configs to chrome.storage.local
 * @param {Array} configs
 * @returns {Promise<void>}
 */
async function saveConfigs(configs) {
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEYS.TOC_CONFIGS]: configs });
    } else {
      localStorage.setItem(STORAGE_KEYS.TOC_CONFIGS, JSON.stringify(configs));
    }
  } catch (e) {
    // Fallback to localStorage on error
    localStorage.setItem(STORAGE_KEYS.TOC_CONFIGS, JSON.stringify(configs));
  }
}

/**
 * Get site enabled map { origin: boolean } from chrome.storage.local
 * @returns {Promise<Record<string, boolean>>}
 */
async function getEnabledMap() {
  try {
    if (chrome?.storage?.local) {
      const res = await chrome.storage.local.get([STORAGE_KEYS.SITE_ENABLE_MAP]);
      return res[STORAGE_KEYS.SITE_ENABLE_MAP] || {};
    } else {
      const raw = localStorage.getItem(STORAGE_KEYS.SITE_ENABLE_MAP);
      return raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    const raw = localStorage.getItem(STORAGE_KEYS.SITE_ENABLE_MAP);
    return raw ? JSON.parse(raw) : {};
  }
}

/**
 * Save site enabled map to chrome.storage.local
 * @param {Record<string, boolean>} map
 */
async function saveEnabledMap(map) {
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEYS.SITE_ENABLE_MAP]: map });
    } else {
      localStorage.setItem(STORAGE_KEYS.SITE_ENABLE_MAP, JSON.stringify(map));
    }
  } catch (e) {
    localStorage.setItem(STORAGE_KEYS.SITE_ENABLE_MAP, JSON.stringify(map));
  }
}

/**
 * Get panel expanded state map { origin: boolean } from chrome.storage.local
 */
async function getPanelStateMap() {
  try {
    if (chrome?.storage?.local) {
      const res = await chrome.storage.local.get([STORAGE_KEYS.PANEL_STATE_MAP]);
      return res[STORAGE_KEYS.PANEL_STATE_MAP] || {};
    } else {
      const raw = localStorage.getItem(STORAGE_KEYS.PANEL_STATE_MAP);
      return raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    const raw = localStorage.getItem(STORAGE_KEYS.PANEL_STATE_MAP);
    return raw ? JSON.parse(raw) : {};
  }
}

/**
 * Save panel expanded state map
 * @param {Record<string, boolean>} map
 */
async function savePanelStateMap(map) {
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEYS.PANEL_STATE_MAP]: map });
    } else {
      localStorage.setItem(STORAGE_KEYS.PANEL_STATE_MAP, JSON.stringify(map));
    }
  } catch (e) {
    localStorage.setItem(STORAGE_KEYS.PANEL_STATE_MAP, JSON.stringify(map));
  }
}

async function getPanelExpandedByOrigin(origin) {
  const map = await getPanelStateMap();
  const key = origin || (typeof location !== 'undefined' ? location.origin : '');
  return !!(key && map[key]);
}

async function setPanelExpandedByOrigin(origin, expanded) {
  const map = await getPanelStateMap();
  map[origin] = !!expanded;
  await savePanelStateMap(map);
  return !!map[origin];
}

/**
 * Get origin string from a URL
 * @param {string} url
 */
function originFromUrl(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    try {
      return location.origin;
    } catch (_) {
      return '';
    }
  }
}

/**
 * Whether current origin (or provided origin) is enabled. Default: disabled (false)
 * @param {string} [origin]
 * @returns {Promise<boolean>}
 */
async function getSiteEnabledByOrigin(origin) {
  const map = await getEnabledMap();
  const key = origin || (typeof location !== 'undefined' ? location.origin : '');
  return !!(key && map[key]);
}

/**
 * Set enabled state for an origin
 * @param {string} origin
 * @param {boolean} enabled
 */
async function setSiteEnabledByOrigin(origin, enabled) {
  const map = await getEnabledMap();
  map[origin] = !!enabled;
  await saveEnabledMap(map);
  return !!map[origin];
}

/**
 * Toggle enabled state for an origin and return the new state
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
async function toggleSiteEnabledByOrigin(origin) {
  const map = await getEnabledMap();
  const next = !map[origin];
  map[origin] = next;
  await saveEnabledMap(map);
  return next;
}

/**
 * Simple wildcard matcher: supports * as any chars
 * @param {string} pattern e.g., https://example.com/articles/* or *://*.example.com/*
 * @param {string} text URL to test
 */
function matchWildcard(pattern, text) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp('^' + escaped + '$');
  return re.test(text);
}

/**
 * Find the first matching site config for current URL
 * @param {Array} configs
 * @param {string} url
 */
function findMatchingConfig(configs, url) {
  return configs.find(cfg => {
    if (!cfg || !cfg.urlPattern) return false;
    return matchWildcard(cfg.urlPattern, url);
  }) || null;
}

/**
 * Collect nodes by a selector config
 * @param {{type: 'css'|'xpath', expr: string}} selector
 * @returns {Element[]}
 */
function collectBySelector(selector) {
  if (!selector || !selector.expr) return [];
  if (selector.type === 'xpath') {
    try {
      const snapshot = document.evaluate(selector.expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const nodes = [];
      for (let i = 0; i < snapshot.snapshotLength; i++) {
        const node = snapshot.snapshotItem(i);
        if (node && node.nodeType === 1) nodes.push(node);
      }
      return nodes;
    } catch {
      return [];
    }
  }
  try {
    return Array.from(document.querySelectorAll(selector.expr));
  } catch {
    return [];
  }
}

/**
 * Deduplicate elements preserving DOM order
 * @param {Element[]} list
 */
function uniqueInDocumentOrder(list) {
  const set = new Set();
  // 使用数组记录元素及其原始索引，以便在排序失败时保持原始顺序
  const arrWithIndex = [];
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (!el) continue;
    if (set.has(el)) continue;
    set.add(el);
    arrWithIndex.push({ el, originalIndex: i });
  }

  arrWithIndex.sort((a, b) => {
    if (a.el === b.el) return 0;
    // 检查元素是否在同一文档中
    if (!a.el.isConnected || !b.el.isConnected) {
      // 如果有元素不在文档中，保持原始顺序
      return a.originalIndex - b.originalIndex;
    }
    try {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      if (pos & Node.DOCUMENT_POSITION_CONTAINS) return -1;
      if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) return 1;
      // 如果无法确定位置，保持原始顺序
      return a.originalIndex - b.originalIndex;
    } catch (e) {
      // compareDocumentPosition可能失败，保持原始顺序
      console.warn('[目录助手] compareDocumentPosition失败:', e);
      return a.originalIndex - b.originalIndex;
    }
  });

  return arrWithIndex.map(item => item.el);
}

/**
 * Smooth scroll to element
 * @param {Element} el
 */
function scrollToElement(el) {
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  } catch {
    el.scrollIntoView(true);
  }
}

window.TOC_UTILS = {
  STORAGE_KEYS,
  getConfigs,
  saveConfigs,
  getEnabledMap,
  saveEnabledMap,
  originFromUrl,
  getSiteEnabledByOrigin,
  setSiteEnabledByOrigin,
  toggleSiteEnabledByOrigin,
  getPanelStateMap,
  savePanelStateMap,
  getPanelExpandedByOrigin,
  setPanelExpandedByOrigin,
  findMatchingConfig,
  collectBySelector,
  uniqueInDocumentOrder,
  scrollToElement
};