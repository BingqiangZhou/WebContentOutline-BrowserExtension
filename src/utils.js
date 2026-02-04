(() => {
  if (globalThis.TOC_UTILS) return;

 /**
  * Storage keys
  */
  const STORAGE_KEYS = {
    TOC_CONFIGS: 'tocConfigs',
    SITE_ENABLE_MAP: 'tocSiteEnabledMap',
    PANEL_STATE_MAP: 'tocPanelExpandedMap',
    BADGE_POS_MAP: 'tocBadgePosMap'
  };

 /**
  * UI constants shared across modules.
  */
 const UI_CONSTANTS = {
   // Builder
   TOC_TEXT_MAX_LEN: 200,
   TOC_MAX_ITEMS: 400,
   TOC_MAX_CANDIDATES: 1200,

   // Badge defaults
   BADGE_DEFAULT_RIGHT_PX: 16,
   BADGE_DEFAULT_TOP_MIN_PX: 120,

   PANEL_WIDTH: 280,
   PANEL_HEIGHT: 400,
   BADGE_WIDTH: 80,
   BADGE_HEIGHT: 32,
   BUTTON_OFFSET: 20,
   DRAG_THRESHOLD_PX: 3,
   UNLOCK_AFTER_MS: 1000,
   SCROLL_STOP_MS: 500,
   PENDING_REBUILD_RECHECK_MS: 100,
   CLEAR_USER_SELECTED_DELAY_MS: 200,
   PICKER_TIMEOUT_MS: 20000,
   EXPAND_ANIM_MS: 300,
   MUTATION_DEBOUNCE_MS: 500,
   MUTATION_UNLOCK_POLL_MS: 200,
   CSS_SELECTOR_MAX_LENGTH: 2000,
   XPATH_MAX_LENGTH: 2000,
   MAX_Z_INDEX: 2147483647,
   TOAST_DURATION_MS: 3000,
   DRAG_MARGIN_PX: 4
 };

 function uiConst(name, fallback) {
   try {
     if (!name) return fallback;
     const hasOwn = Object.prototype.hasOwnProperty.call(UI_CONSTANTS, name);
     const value = hasOwn ? UI_CONSTANTS[name] : undefined;
     if (typeof fallback === 'number') {
       return Number.isFinite(value) ? value : fallback;
     }
     return (value !== undefined && value !== null) ? value : fallback;
   } catch (_) {
     return fallback;
   }
 }

/**
 * Get i18n message safely.
 * @param {string} key
 * @returns {string}
 */
function msg(key, substitutions) {
  try {
    return chrome.i18n.getMessage(key, substitutions) || key;
  } catch (_) {
    return key;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

 function safeJsonParse(raw) {
   if (typeof raw !== 'string') return null;
   if (raw.length > 20000) return null;
   try {
     return JSON.parse(raw);
   } catch {
     return null;
   }
 }

 function isSafeXPathExpression(expr) {
   if (typeof expr !== 'string') return false;
   const trimmed = expr.trim();
   if (!trimmed) return false;
   if (trimmed.length > uiConst('XPATH_MAX_LENGTH', 2000)) return false;

   // Disallow control characters.
   for (let i = 0; i < trimmed.length; i++) {
     const code = trimmed.charCodeAt(i);
     if ((code >= 0x0000 && code <= 0x001F) || code === 0x007F) return false;
   }

   // Basic structural checks: balanced quotes/brackets/parentheses, and avoid extreme nesting.
   let inSingle = false;
   let inDouble = false;
   let parenDepth = 0;
   let bracketDepth = 0;
   const MAX_NESTING = 64;
   for (let i = 0; i < trimmed.length; i++) {
     const ch = trimmed[i];
     if (!inDouble && ch === "'") {
       inSingle = !inSingle;
       continue;
     }
     if (!inSingle && ch === '"') {
       inDouble = !inDouble;
       continue;
     }
     if (inSingle || inDouble) continue;
     if (ch === '(') parenDepth++;
     if (ch === ')') parenDepth--;
     if (ch === '[') bracketDepth++;
     if (ch === ']') bracketDepth--;
     if (parenDepth < 0 || bracketDepth < 0) return false;
     if (parenDepth > MAX_NESTING || bracketDepth > MAX_NESTING) return false;
   }
   if (inSingle || inDouble) return false;
   if (parenDepth !== 0 || bracketDepth !== 0) return false;

   // In browser XPath 1.0, most "dangerous" functions (e.g. document()) are not available,
   // but reject common external-document/function patterns anyway.
   const forbiddenFn = /(^|[^A-Za-z0-9_-])(document|doc|collection)\s*\(/i;
   if (forbiddenFn.test(trimmed)) return false;

   return true;
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

 const __storageErrorOnce = new Set();
 function notifyStorageWriteError(key, err) {
   try {
     const kind = isQuotaExceededError(err) ? 'quota' : 'unknown';
     const onceKey = `${kind}:${String(key || '')}`;
     if (__storageErrorOnce.has(onceKey)) return;
     __storageErrorOnce.add(onceKey);
     console.warn('[toc] storage write failed:', { key, err });
     if (typeof document !== 'undefined' && document.documentElement && typeof showToast === 'function') {
       const messageKey = kind === 'quota' ? 'errorStorageQuotaExceeded' : 'errorStorageWriteFailed';
       const text = msg(messageKey);
       if (text && text !== messageKey) {
         showToast(text, { type: 'error' });
       }
     }
   } catch (_) {}
 }

 function isValidCssSelector(expr) {
   if (typeof expr !== 'string') return false;
   const trimmed = expr.trim();
   if (!trimmed) return false;
   // Disallow control chars
   for (let i = 0; i < trimmed.length; i++) {
     const code = trimmed.charCodeAt(i);
     if ((code >= 0x0000 && code <= 0x001F) || code === 0x007F) return false;
   }
   const maxLen = uiConst('CSS_SELECTOR_MAX_LENGTH', 2000);
   if (trimmed.length > maxLen) return false;
   try {
     // Syntax validation. This may query the DOM once, which is acceptable on user actions.
     document.querySelector(trimmed);
     return true;
   } catch (_) {
     return false;
   }
 }

 function validateSelectorExpression(type, expr) {
   if (type === 'xpath') return isSafeXPathExpression(expr);
   if (type === 'css') return isValidCssSelector(expr);
   return false;
 }

function getFiniteNumber(value) {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function ensureToastContainer() {
  const existing = document.querySelector('.toc-toast-container');
  if (existing) return existing;
  const container = document.createElement('div');
  container.className = 'toc-toast-container';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', msg('toastRegionLabel'));
  document.documentElement.appendChild(container);
  return container;
}

/**
 * Show a small non-blocking toast message.
 * @param {string} text
 * @param {{type?: 'info'|'success'|'warning'|'error', durationMs?: number}} [opts]
 */
function showToast(text, opts = {}) {
  try {
    const type = opts.type || 'info';
    const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : UI_CONSTANTS.TOAST_DURATION_MS;
    const container = ensureToastContainer();

    const toast = document.createElement('div');
    toast.className = `toc-toast toc-toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    const message = document.createElement('div');
    message.className = 'toc-toast-message';
    message.textContent = String(text || '');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toc-toast-close';
    closeBtn.textContent = msg('symbolClose');
    closeBtn.setAttribute('aria-label', msg('buttonClose'));

    const removeToast = () => {
      try { toast.remove(); } catch (_) {}
      try {
        if (container.childElementCount === 0) container.remove();
      } catch (_) {}
    };

    closeBtn.addEventListener('click', removeToast, { once: true });
    toast.addEventListener('click', (e) => {
      // Allow clicking toast body to dismiss, but ignore text selection drags.
      if (e && e.target && e.target.closest && e.target.closest('button')) return;
      removeToast();
    });

    toast.appendChild(message);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    if (durationMs > 0) {
      setTimeout(removeToast, durationMs);
    }

    return { close: removeToast };
  } catch (_) {
    return { close: () => {} };
  }
}

/**
 * Read a value from chrome.storage.local with fallback.
 * @param {string} key
 * @param {*} fallback
 * @returns {Promise<*>}
 */
 async function getStorage(key, fallback) {
   try {
     if (chrome?.storage?.local) {
       const res = await chrome.storage.local.get([key]);
       return res[key] ?? fallback;
     }
   } catch (_) {}
   return fallback;
 }

 /**
  * Write a value to chrome.storage.local.
  * @param {string} key
  * @param {*} value
  * @returns {Promise<boolean>}
  */
 async function setStorage(key, value) {
   try {
     if (chrome?.storage?.local) {
       await chrome.storage.local.set({ [key]: value });
     }
     return true;
   } catch (e) {
     notifyStorageWriteError(key, e);
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
   return await setStorage(STORAGE_KEYS.TOC_CONFIGS, configs);
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
 * Get badge position map { host: { left, top } }
 */
async function getBadgePosMap() {
  return await getStorage(STORAGE_KEYS.BADGE_POS_MAP, {});
}

/**
 * Save badge position map
 * @param {Record<string, {left:number, top:number}>} map
 */
 async function saveBadgePosMap(map) {
   return await setStorage(STORAGE_KEYS.BADGE_POS_MAP, map);
 }

async function getBadgePosByHost(host) {
  const map = await getBadgePosMap();
  return map[host] || null;
}

async function setBadgePosByHost(host, pos) {
  const map = await getBadgePosMap();
  map[host] = pos;
  await saveBadgePosMap(map);
  return map[host];
}

async function getPanelExpandedByOrigin(origin) {
  const map = await getPanelStateMap();
  const key = origin || (typeof location !== 'undefined' ? location.origin : '');
  return !!(key && map[key]);
}

async function setPanelExpandedByOrigin(origin, expanded) {
  const map = await getPanelStateMap();
  map[origin] = !!expanded;
  const ok = await savePanelStateMap(map);
  return ok ? !!map[origin] : false;
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
  const ok = await saveEnabledMap(map);
  return ok ? !!map[origin] : false;
}

/**
 * Toggle enabled state for an origin and return the new state
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
async function toggleSiteEnabledByOrigin(origin) {
  const map = await getEnabledMap();
  const prev = !!map[origin];
  const next = !prev;
  map[origin] = next;
  const ok = await saveEnabledMap(map);
  return ok ? next : prev;
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
    if (!isSafeXPathExpression(selector.expr)) return [];
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
  // Track original index to keep stable order when sorting is ambiguous.
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
    // If elements are not connected, preserve original order.
    if (!a.el.isConnected || !b.el.isConnected) {
      return a.originalIndex - b.originalIndex;
    }
    try {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      if (pos & Node.DOCUMENT_POSITION_CONTAINS) return -1;
      if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) return 1;
      // If position cannot be determined, preserve original order.
      return a.originalIndex - b.originalIndex;
    } catch (e) {
      // compareDocumentPosition can fail; preserve original order.
      console.warn('[toc] compareDocumentPosition failed:', e);
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
    const reduceMotion = (() => {
      try {
        return !!(window && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (_) {
        return false;
      }
    })();
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start', inline: 'nearest' });
  } catch {
    el.scrollIntoView(true);
  }
}

const ROOT = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);

 ROOT.TOC_UTILS = {
   STORAGE_KEYS,
   UI_CONSTANTS,
   uiConst,
   msg,
   isPlainObject,
   safeJsonParse,
   isSafeXPathExpression,
   validateSelectorExpression,
   getFiniteNumber,
   showToast,
   getStorage,
   setStorage,
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
   getBadgePosMap,
   saveBadgePosMap,
   getBadgePosByHost,
   setBadgePosByHost,
   findMatchingConfig,
   collectBySelector,
   uniqueInDocumentOrder,
   scrollToElement
 };
})();

