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
function getConfigs() {
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get([STORAGE_KEYS.TOC_CONFIGS], (res) => {
          resolve(res[STORAGE_KEYS.TOC_CONFIGS] || []);
        });
      } else {
        const raw = localStorage.getItem(STORAGE_KEYS.TOC_CONFIGS);
        resolve(raw ? JSON.parse(raw) : []);
      }
    } catch (e) {
      // Fallback for non-extension context
      const raw = localStorage.getItem(STORAGE_KEYS.TOC_CONFIGS);
      resolve(raw ? JSON.parse(raw) : []);
    }
  });
}

/**
 * Save configs to chrome.storage.local
 * @param {Array} configs
 * @returns {Promise<void>}
 */
function saveConfigs(configs) {
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ [STORAGE_KEYS.TOC_CONFIGS]: configs }, () => resolve());
      } else {
        localStorage.setItem(STORAGE_KEYS.TOC_CONFIGS, JSON.stringify(configs));
        resolve();
      }
    } catch (e) {
      localStorage.setItem(STORAGE_KEYS.TOC_CONFIGS, JSON.stringify(configs));
      resolve();
    }
  });
}

/**
 * Get site enabled map { origin: boolean } from chrome.storage.local
 * @returns {Promise<Record<string, boolean>>}
 */
function getEnabledMap() {
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get([STORAGE_KEYS.SITE_ENABLE_MAP], (res) => {
          resolve(res[STORAGE_KEYS.SITE_ENABLE_MAP] || {});
        });
      } else {
        const raw = localStorage.getItem(STORAGE_KEYS.SITE_ENABLE_MAP);
        resolve(raw ? JSON.parse(raw) : {});
      }
    } catch (e) {
      const raw = localStorage.getItem(STORAGE_KEYS.SITE_ENABLE_MAP);
      resolve(raw ? JSON.parse(raw) : {});
    }
  });
}

/**
 * Save site enabled map to chrome.storage.local
 * @param {Record<string, boolean>} map
 */
function saveEnabledMap(map) {
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ [STORAGE_KEYS.SITE_ENABLE_MAP]: map }, () => resolve());
      } else {
        localStorage.setItem(STORAGE_KEYS.SITE_ENABLE_MAP, JSON.stringify(map));
        resolve();
      }
    } catch (e) {
      localStorage.setItem(STORAGE_KEYS.SITE_ENABLE_MAP, JSON.stringify(map));
      resolve();
    }
  });
}

/**
 * Get panel expanded state map { origin: boolean } from chrome.storage.local
 */
function getPanelStateMap() {
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get([STORAGE_KEYS.PANEL_STATE_MAP], (res) => {
          resolve(res[STORAGE_KEYS.PANEL_STATE_MAP] || {});
        });
      } else {
        const raw = localStorage.getItem(STORAGE_KEYS.PANEL_STATE_MAP);
        resolve(raw ? JSON.parse(raw) : {});
      }
    } catch (e) {
      const raw = localStorage.getItem(STORAGE_KEYS.PANEL_STATE_MAP);
      resolve(raw ? JSON.parse(raw) : {});
    }
  });
}

/**
 * Save panel expanded state map
 * @param {Record<string, boolean>} map
 */
function savePanelStateMap(map) {
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ [STORAGE_KEYS.PANEL_STATE_MAP]: map }, () => resolve());
      } else {
        localStorage.setItem(STORAGE_KEYS.PANEL_STATE_MAP, JSON.stringify(map));
        resolve();
      }
    } catch (e) {
      localStorage.setItem(STORAGE_KEYS.PANEL_STATE_MAP, JSON.stringify(map));
      resolve();
    }
  });
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
  const arr = [];
  for (const el of list) {
    if (!el) continue;
    if (set.has(el)) continue;
    set.add(el);
    arr.push(el);
  }
  arr.sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return arr;
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