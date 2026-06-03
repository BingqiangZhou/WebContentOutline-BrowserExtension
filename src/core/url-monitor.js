'use strict';

import { collectBySelector, uniqueInDocumentOrder } from '../utils/dom-utils.js';
import { getBoundedText } from '../utils/bounded-text.js';

  /**
   * Creates a URL change monitor that detects pushState, replaceState,
   * popstate, and hashchange events. Also provides a polling fallback
   * that detects content changes via signature comparison.
   *
   * @param {object} opts
   * @param {function} opts.uiConst - UI constant getter
   * @param {function} [opts.checkAndReconnect] - Callback to reconnect DOM watcher
   * @param {boolean} [opts.mutationObserverAvailable] - Whether MutationObserver is active
   * @returns {object}
   */
export function createUrlMonitor(opts) {
    var uiConst = opts && opts.uiConst;
    var checkAndReconnect = (opts && opts.checkAndReconnect) || null;
    var mutationObserverAvailable = !opts || opts.mutationObserverAvailable !== false;

    // State
    var lastKnownUrl = '';
    var urlChangeTimer = null;
    var popstateHandler = null;
    var hashchangeHandler = null;
    var pageUrlChangeHandler = null;

    // Polling fallback state
    var pollTimer = null;
    var lastContentSignature = null;
    var hasContentSignature = false;
    var elementIds = typeof WeakMap === 'function' ? new WeakMap() : null;
    var nextElementId = 1;

    var isContextValid = true;
    var onChangeCallback = null;

    function getElementId(el) {
      if (!el || !elementIds) return 0;
      var existing = elementIds.get(el);
      if (existing) return existing;
      var id = nextElementId++;
      elementIds.set(el, id);
      return id;
    }

    function appendToHash(hash, value) {
      var text = String(value || '');
      for (var i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
      }
      return hash;
    }

    function getPollingSelectors(cfg) {
      var selectors = cfg && Array.isArray(cfg.selectors) ? cfg.selectors.filter(function(selector) {
        return selector && (selector.type === 'css' || selector.type === 'xpath') && selector.expr;
      }) : [];
      return selectors.length ? selectors : [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6' }];
    }

    function computeContentSignature(cfg) {
      try {
        var selectors = getPollingSelectors(cfg);
        var candidates = [];
        var maxCandidates = 400;
        for (var i = 0; i < selectors.length && candidates.length < maxCandidates; i++) {
          var remaining = maxCandidates - candidates.length;
          var found = collectBySelector(selectors[i], remaining);
          for (var j = 0; j < found.length && candidates.length < maxCandidates; j++) {
            candidates.push(found[j]);
          }
        }
        var els = uniqueInDocumentOrder(candidates).slice(0, maxCandidates);
        var hash = 0;
        for (var k = 0; k < els.length; k++) {
          var el = els[k];
          hash = appendToHash(hash, getElementId(el));
          hash = appendToHash(hash, el.tagName || '');
          if (!mutationObserverAvailable) {
            var text = '';
            if (typeof getBoundedText === 'function') {
              text = getBoundedText(el, { maxChars: 200, maxNodes: 80, maxDepth: 6 });
            } else {
              try { text = String(el.textContent || '').slice(0, 200); } catch (_) { text = ''; }
            }
            hash = appendToHash(hash, text);
          }
        }
        return els.length + ':' + hash;
      } catch (_) {
        return null;
      }
    }

    function onUrlChange() {
      if (!isContextValid) return;
      var currentUrl = location.href;
      if (currentUrl === lastKnownUrl) return;
      lastKnownUrl = currentUrl;
      if (urlChangeTimer) clearTimeout(urlChangeTimer);
      var dedupMs = (typeof uiConst === 'function') ? uiConst('URL_CHANGE_DEDUP_MS', 500) : 500;
      urlChangeTimer = setTimeout(function() {
        urlChangeTimer = null;
        if (!isContextValid) return;
        if (location.href !== lastKnownUrl) {
          lastKnownUrl = location.href;
        }
        if (typeof onChangeCallback === 'function') {
          onChangeCallback(true); // immediate = true
        }
      }, dedupMs);
    }

    function startPolling(cfg) {
      stopPolling();
      var POLL_INTERVAL_MS = (typeof uiConst === 'function') ? uiConst('POLL_INTERVAL_MS', 3000) : 3000;
      var POLL_INTERVAL_THROTTLED_MS = (typeof uiConst === 'function') ? uiConst('POLL_INTERVAL_THROTTLED_MS', 10000) : 10000;
      var activeInterval = mutationObserverAvailable ? POLL_INTERVAL_THROTTLED_MS : POLL_INTERVAL_MS;

      function poll() {
        if (!isContextValid || document.hidden) {
          pollTimer = setTimeout(poll, POLL_INTERVAL_THROTTLED_MS);
          return;
        }
        if (location.href !== lastKnownUrl) {
          onUrlChange();
        }
        if (typeof checkAndReconnect === 'function') {
          checkAndReconnect();
        }

        var sig = computeContentSignature(cfg);
        if (sig !== null && !hasContentSignature) {
          lastContentSignature = sig;
          hasContentSignature = true;
        } else if (sig !== null && sig !== lastContentSignature) {
          lastContentSignature = sig;
          if (typeof onChangeCallback === 'function') {
            onChangeCallback(false); // not immediate, will go through debounce
          }
        }

        pollTimer = setTimeout(poll, activeInterval);
      }
      pollTimer = setTimeout(poll, activeInterval);
    }

    function stopPolling() {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    function setupUrlHooks() {
      // Clean up any previous hooks
      teardownUrlHooks();

      try {
        lastKnownUrl = location.href;

        popstateHandler = function() { try { onUrlChange(); } catch (_) {} };
        hashchangeHandler = function() { try { onUrlChange(); } catch (_) {} };
        pageUrlChangeHandler = function() { try { onUrlChange(); } catch (_) {} };
        window.addEventListener('popstate', popstateHandler);
        window.addEventListener('hashchange', hashchangeHandler);
        window.addEventListener('toc:urlchange', pageUrlChangeHandler);
      } catch (e) {
        console.warn('[toc] failed to set up URL change monitoring:', e);
      }
    }

    function teardownUrlHooks() {
      if (popstateHandler) {
        try { window.removeEventListener('popstate', popstateHandler); } catch (_) {}
        popstateHandler = null;
      }
      if (hashchangeHandler) {
        try { window.removeEventListener('hashchange', hashchangeHandler); } catch (_) {}
        hashchangeHandler = null;
      }
      if (pageUrlChangeHandler) {
        try { window.removeEventListener('toc:urlchange', pageUrlChangeHandler); } catch (_) {}
        pageUrlChangeHandler = null;
      }
      if (urlChangeTimer) {
        clearTimeout(urlChangeTimer);
        urlChangeTimer = null;
      }
    }

    function start(cfg, onChange) {
      stop();
      isContextValid = true;
      onChangeCallback = onChange || null;
      lastContentSignature = null;
      hasContentSignature = false;
      setupUrlHooks();
      startPolling(cfg);
    }

    function stop() {
      teardownUrlHooks();
      stopPolling();
      onChangeCallback = null;
      lastContentSignature = null;
      hasContentSignature = false;
    }

    function invalidate() {
      isContextValid = false;
      stop();
    }

    return {
      start: start,
      stop: stop,
      invalidate: invalidate
    };
  }
