define('dom-utils', ['toc-storage', 'core-utils', 'storage-primitives', 'toc-constants'],
  function(storage, coreUtils, storagePrimitives, constants) {
    'use strict';

    var getEnabledMap = storage.getEnabledMap;
    var saveEnabledMap = storage.saveEnabledMap;
    var getPanelStateMap = storage.getPanelStateMap;
    var savePanelStateMap = storage.savePanelStateMap;
    var uiConst = constants.uiConst;
    var serializedWrite = storagePrimitives.serializedWrite;
    var touchObjectKey = storagePrimitives.touchObjectKey;
    var pruneObjectToLimit = storagePrimitives.pruneObjectToLimit;
    var isSafeXPathExpression = coreUtils.isSafeXPathExpression;
    var originFromUrl = coreUtils.originFromUrl;

    // --- Module-private cache for panel expanded state ---
    var __panelStateCache = null;
    var __panelStateCacheReady = false;

    // Listen for storage changes to invalidate cache
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      try {
        chrome.storage.onChanged.addListener(function(changes, area) {
          if (area === 'local' && changes.tocPanelExpandedMap) {
            __panelStateCache = null;
            __panelStateCacheReady = false;
          }
        });
      } catch (_) {}
    }

    /**
     * Simple wildcard matcher: supports * as any chars
     * @param {string} pattern e.g., https://example.com/articles/* or *://*.example.com/*
     * @param {string} text URL to test
     */
    function matchWildcard(pattern, text) {
      if (typeof pattern !== 'string' || typeof text !== 'string') return false;
      if (pattern === '*') return true;
      var parts = pattern.split('*');
      if (parts.length === 1) return pattern === text;

      var startIndex = 0;
      var endLimit = text.length;

      if (!pattern.startsWith('*')) {
        var first = parts.shift() || '';
        if (!text.startsWith(first)) return false;
        startIndex = first.length;
      }

      if (!pattern.endsWith('*')) {
        var last = parts.pop() || '';
        if (!text.endsWith(last)) return false;
        endLimit = text.length - last.length;
      }

      var hay = text.slice(0, endLimit);
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part) continue;
        var idx = hay.indexOf(part, startIndex);
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
      return configs.find(function(cfg) {
        if (!cfg || !cfg.urlPattern) return false;
        return matchWildcard(cfg.urlPattern, url);
      }) || null;
    }

    /**
     * Whether current origin (or provided origin) is enabled. Default: disabled (false)
     * @param {string} [origin]
     * @returns {Promise<boolean>}
     */
    function getSiteEnabledByOrigin(origin) {
      return getEnabledMap().then(function(map) {
        var key = origin || (typeof location !== 'undefined' ? location.origin : '');
        return !!(key && map[key]);
      });
    }

    /**
     * Set enabled state for an origin
     * @param {string} origin
     * @param {boolean} enabled
     */
    function setSiteEnabledByOrigin(origin, enabled) {
      return serializedWrite('tocSiteEnabledMap', function() {
        return getEnabledMap().then(function(map) {
          if (!origin) return false;
          touchObjectKey(map, origin, !!enabled);
          pruneObjectToLimit(map, uiConst('STORAGE_MAX_MAP_KEYS', 400));
          return saveEnabledMap(map).then(function(ok) {
            return ok ? !!map[origin] : false;
          });
        });
      });
    }

    /**
     * Toggle enabled state for an origin and return the new state
     * @param {string} origin
     * @returns {Promise<boolean>}
     */
    function toggleSiteEnabledByOrigin(origin) {
      return serializedWrite('tocSiteEnabledMap', function() {
        return getEnabledMap().then(function(map) {
          var prev = !!map[origin];
          var next = !prev;
          if (!origin) return prev;
          touchObjectKey(map, origin, next);
          pruneObjectToLimit(map, uiConst('STORAGE_MAX_MAP_KEYS', 400));
          return saveEnabledMap(map).then(function(ok) {
            return ok ? next : prev;
          });
        });
      });
    }

    function getPanelExpandedByOrigin(origin) {
      var doRead = function(map) {
        var key = origin || (typeof location !== 'undefined' ? location.origin : '');
        return !!(key && map && map[key]);
      };

      if (!__panelStateCacheReady) {
        return getPanelStateMap().then(function(map) {
          __panelStateCache = map;
          __panelStateCacheReady = true;
          return doRead(__panelStateCache);
        });
      }
      return Promise.resolve(doRead(__panelStateCache));
    }

    function setPanelExpandedByOrigin(origin, expanded) {
      var doWrite = function() {
        var key = origin || (typeof location !== 'undefined' ? location.origin : '');
        if (!key) return Promise.resolve(false);
        __panelStateCache[key] = !!expanded;

        // Fire-and-forget the storage write
        return serializedWrite('tocPanelExpandedMap', function() {
          return getPanelStateMap().then(function(map) {
            map[key] = !!expanded;
            pruneObjectToLimit(map, uiConst('STORAGE_MAX_MAP_KEYS', 400));
            return savePanelStateMap(map);
          });
        });
      };

      if (!__panelStateCacheReady) {
        return getPanelStateMap().then(function(map) {
          __panelStateCache = map || {};
          __panelStateCacheReady = true;
          return doWrite();
        }).catch(function() {
          __panelStateCache = {};
          __panelStateCacheReady = true;
          return doWrite();
        });
      }
      return doWrite();
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
          var limit = uiConst('TOC_MAX_CANDIDATES', 1200);
          var iterator = document.evaluate(selector.expr, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
          var nodes = [];
          for (var i = 0; i < limit; i++) {
            var node = iterator.iterateNext();
            if (!node) break;
            if (node.nodeType === 1) nodes.push(node);
          }
          return nodes;
        } catch (e) {
          return [];
        }
      }
      try {
        var nodeList = document.querySelectorAll(selector.expr);
        var limit2 = uiConst('TOC_MAX_CANDIDATES', 1200);
        var len = Math.min(nodeList.length, limit2);
        var result = new Array(len);
        for (var j = 0; j < len; j++) result[j] = nodeList[j];
        return result;
      } catch (e) {
        return [];
      }
    }

    /**
     * Deduplicate elements preserving first-occurrence order
     * @param {Element[]} list
     */
    function uniqueInDocumentOrder(list) {
      var seen = new Set();
      var result = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el && !seen.has(el)) {
          seen.add(el);
          result.push(el);
        }
      }
      return result;
    }

    /**
     * Smooth scroll to element
     * @param {Element} el
     */
    function scrollToElement(el) {
      try {
        var reduceMotion = (function() {
          try {
            return !!(window && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
          } catch (_) {
            return false;
          }
        })();
        el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start', inline: 'nearest' });
      } catch (e) {
        el.scrollIntoView(true);
      }
    }

    var api = {
      originFromUrl: originFromUrl,
      matchWildcard: matchWildcard,
      findMatchingConfig: findMatchingConfig,
      getSiteEnabledByOrigin: getSiteEnabledByOrigin,
      setSiteEnabledByOrigin: setSiteEnabledByOrigin,
      toggleSiteEnabledByOrigin: toggleSiteEnabledByOrigin,
      getPanelExpandedByOrigin: getPanelExpandedByOrigin,
      setPanelExpandedByOrigin: setPanelExpandedByOrigin,
      collectBySelector: collectBySelector,
      uniqueInDocumentOrder: uniqueInDocumentOrder,
      scrollToElement: scrollToElement
    };

    try { Object.assign((globalThis.TOC_UTILS || {}), api); } catch (_) {}

    return api;
  }
);
