(() => {
  const T = globalThis.TOC_UTILS;
  if (!T) return;

  const {
    uiConst,
    serializedWrite,
    getEnabledMap,
    getPanelStateMap,
    getStorage,
    STORAGE_KEYS,
    isContextInvalidatedError,
    isSafeXPathExpression
  } = T;

  // --- Module-private cache for panel expanded state ---
  let __panelStateCache = null;
  let __panelStateCacheReady = false;

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
   * Simple wildcard matcher: supports * as any chars
   * @param {string} pattern e.g., https://example.com/articles/* or *://*.example.com/*
   * @param {string} text URL to test
   */
  function matchWildcard(pattern, text) {
    if (typeof pattern !== 'string' || typeof text !== 'string') return false;
    if (pattern === '*') return true;
    const parts = pattern.split('*');
    if (parts.length === 1) return pattern === text;

    let startIndex = 0;
    let endLimit = text.length;

    if (!pattern.startsWith('*')) {
      const first = parts.shift() || '';
      if (!text.startsWith(first)) return false;
      startIndex = first.length;
    }

    if (!pattern.endsWith('*')) {
      const last = parts.pop() || '';
      if (!text.endsWith(last)) return false;
      endLimit = text.length - last.length;
    }

    const hay = text.slice(0, endLimit);
    for (const part of parts) {
      if (!part) continue;
      const idx = hay.indexOf(part, startIndex);
      if (idx < 0) return false;
      startIndex = idx + part.length;
    }
    return true;
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
    return serializedWrite('tocSiteEnabledMap', async () => {
    const map = await getEnabledMap();
    if (!origin) return false;
    T.touchObjectKey(map, origin, !!enabled);
    T.pruneObjectToLimit(map, uiConst('STORAGE_MAX_MAP_KEYS', 400));
    const ok = await T.saveEnabledMap(map);
    return ok ? !!map[origin] : false;
    });
  }

  /**
   * Toggle enabled state for an origin and return the new state
   * @param {string} origin
   * @returns {Promise<boolean>}
   */
  async function toggleSiteEnabledByOrigin(origin) {
    return serializedWrite('tocSiteEnabledMap', async () => {
    const map = await getEnabledMap();
    const prev = !!map[origin];
    const next = !prev;
    if (!origin) return prev;
    T.touchObjectKey(map, origin, next);
    T.pruneObjectToLimit(map, uiConst('STORAGE_MAX_MAP_KEYS', 400));
    const ok = await T.saveEnabledMap(map);
    return ok ? next : prev;
    });
  }

  async function getPanelExpandedByOrigin(origin) {
    if (!__panelStateCacheReady) {
      __panelStateCache = await getPanelStateMap();
      __panelStateCacheReady = true;
    }
    const key = origin || (typeof location !== 'undefined' ? location.origin : '');
    return !!(key && __panelStateCache && __panelStateCache[key]);
  }

  async function setPanelExpandedByOrigin(origin, expanded) {
    if (!__panelStateCacheReady) {
      try { __panelStateCache = await getPanelStateMap(); } catch (_) { __panelStateCache = {}; }
      __panelStateCacheReady = true;
    }
    const key = origin || (typeof location !== 'undefined' ? location.origin : '');
    if (!key) return false;
    __panelStateCache[key] = !!expanded;

    // Fire-and-forget the storage write
    return serializedWrite('tocPanelExpandedMap', async () => {
      const map = await getPanelStateMap();
      map[key] = !!expanded;
      T.pruneObjectToLimit(map, uiConst('STORAGE_MAX_MAP_KEYS', 400));
      return await T.savePanelStateMap(map);
    });
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
        const limit = uiConst('TOC_MAX_CANDIDATES', 1200);
        const iterator = document.evaluate(selector.expr, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
        const nodes = [];
        for (let i = 0; i < limit; i++) {
          const node = iterator.iterateNext();
          if (!node) break;
          if (node.nodeType === 1) nodes.push(node);
        }
        return nodes;
      } catch {
        return [];
      }
    }
    try {
        const nodeList = document.querySelectorAll(selector.expr);
        const limit = uiConst('TOC_MAX_CANDIDATES', 1200);
        const len = Math.min(nodeList.length, limit);
        const result = new Array(len);
        for (let i = 0; i < len; i++) result[i] = nodeList[i];
        return result;
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

  Object.assign(T, {
    originFromUrl,
    getSiteEnabledByOrigin,
    setSiteEnabledByOrigin,
    toggleSiteEnabledByOrigin,
    getPanelExpandedByOrigin,
    setPanelExpandedByOrigin,
    findMatchingConfig,
    collectBySelector,
    uniqueInDocumentOrder,
    scrollToElement
  });
})();
