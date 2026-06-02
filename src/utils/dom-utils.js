'use strict';

import { getEnabledMap, getPanelStateMap, savePanelStateMap } from './storage.js';
import { uiConst } from './constants.js';
import { serializedWrite, pruneObjectToLimit } from '../shared/storage-primitives.js';
import { isSafeXPathExpression, originFromUrl } from './core-utils.js';

    /**
     * Simple wildcard matcher: supports * as any chars
     * @param {string} pattern e.g., https://example.com/articles/* or *://*.example.com/*
     * @param {string} text URL to test
     */
export function matchWildcard(pattern, text) {
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
export function findMatchingConfig(configs, url) {
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
export function getSiteEnabledByOrigin(origin) {
      return getEnabledMap().then(function(map) {
        var key = origin || (typeof location !== 'undefined' ? location.origin : '');
        return !!(key && map[key]);
      });
    }

export function getPanelExpandedByOrigin(origin) {
      var doRead = function(map) {
        var key = origin || (typeof location !== 'undefined' ? location.origin : '');
        return !!(key && map && map[key]);
      };

      return getPanelStateMap().then(function(map) {
        return doRead(map);
      });
    }

export function setPanelExpandedByOrigin(origin, expanded) {
      var key = origin || (typeof location !== 'undefined' ? location.origin : '');
      if (!key) return Promise.resolve(false);
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          return new Promise(function(resolve) {
            chrome.runtime.sendMessage({
              type: 'toc:mutateUiState',
              operation: 'set-panel-expanded',
              key: key,
              value: !!expanded
            }, function(response) {
              if (chrome.runtime.lastError) { resolve(false); return; }
              resolve(!!(response && response.ok));
            });
          });
        }
      } catch (_) {}
      return serializedWrite('tocPanelExpandedMap', function() {
        return getPanelStateMap().then(function(map) {
          map = map || {};
          map[key] = !!expanded;
          pruneObjectToLimit(map, uiConst('STORAGE_MAX_MAP_KEYS', 400));
          return savePanelStateMap(map);
        });
      });
    }

    /**
     * Collect nodes by a selector config
     * @param {{type: 'css'|'xpath', expr: string}} selector
     * @returns {Element[]}
     */
export function collectBySelector(selector, maxCandidates) {
      if (!selector || !selector.expr) return [];
      var configuredLimit = uiConst('TOC_MAX_CANDIDATES', 1200);
      var limitOverride = Number.isFinite(maxCandidates) && maxCandidates > 0
        ? Math.max(1, Math.floor(maxCandidates))
        : configuredLimit;
      var finalLimit = Math.min(configuredLimit, limitOverride);
      if (selector.type === 'xpath') {
        if (!isSafeXPathExpression(selector.expr)) return [];
        try {
          var iterator = document.evaluate(selector.expr, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
          var nodes = [];
          for (var i = 0; i < finalLimit; i++) {
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
        var len = Math.min(nodeList.length, finalLimit);
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
export function uniqueInDocumentOrder(list) {
      var seen = new Set();
      var result = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el && !seen.has(el)) {
          seen.add(el);
          result.push(el);
        }
      }
      result.sort(function(a, b) {
        if (a === b || !a || !b || typeof a.compareDocumentPosition !== 'function') return 0;
        try {
          var pos = a.compareDocumentPosition(b);
          if (pos & 1) return 0;
          if (pos & 2) return 1;
          if (pos & 4) return -1;
        } catch (_) {}
        return 0;
      });
      return result;
    }

    /**
     * Smooth scroll to element
     * @param {Element} el
     */
export function scrollToElement(el) {
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

export function cleanupOwnedElements(selectorFallback) {
      var fallback = selectorFallback || '.toc-edge-dock[data-toc-owner="web-toc-assistant"], .toc-collapsed-badge[data-toc-owner="web-toc-assistant"], .toc-floating[data-toc-owner="web-toc-assistant"], .toc-overlay[data-toc-owner="web-toc-assistant"], .toc-toast-container[data-toc-owner="web-toc-assistant"]';
      var selector = selectorFallback || uiConst('CLEANUP_SELECTOR', fallback);
      try {
        document.querySelectorAll(selector).forEach(function(el) {
          try {
            var cleanup = el && el.__TOC_CLEANUP__;
            if (typeof cleanup === 'function') cleanup();
          } catch (_) {}
          try { el.remove(); } catch (_) {}
        });
      } catch (_) {}
    }
