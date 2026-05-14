define('url-monitor', [], function() {
  'use strict';

  /**
   * Creates a URL change monitor that detects pushState, replaceState,
   * popstate, and hashchange events. Also provides a polling fallback
   * that detects content changes via signature comparison.
   *
   * @param {object} opts
   * @param {function} opts.uiConst - UI constant getter
   * @param {function} [opts.checkAndReconnect] - Callback to reconnect DOM watcher
   * @param {function} opts.getLastRebuildTime - Returns timestamp of last rebuild
   * @returns {object}
   */
  function createUrlMonitor(opts) {
    var uiConst = opts && opts.uiConst;
    var checkAndReconnect = (opts && opts.checkAndReconnect) || null;
    var getLastRebuildTime = (opts && opts.getLastRebuildTime) || function() { return 0; };

    // State
    var originalPushState = null;
    var originalReplaceState = null;
    var lastKnownUrl = '';
    var urlChangeTimer = null;
    var popstateHandler = null;
    var hashchangeHandler = null;

    // Polling fallback state
    var pollTimer = null;
    var lastContentSignature = null;

    var isContextValid = true;
    var onChangeCallback = null;

    function computeContentSignature(cfg) {
      try {
        var selectors = cfg && cfg.selectors;
        if (!selectors || !selectors.length) return null;
        var exprs = selectors.map(function(s) { return s.expr; }).filter(Boolean);
        if (!exprs.length) return null;
        var selector = exprs.join(',');
        var els = document.querySelectorAll(selector);
        var hash = 0;
        var len = Math.min(els.length, 400);
        for (var i = 0; i < len; i++) {
          var el = els[i];
          var text = el.textContent || '';
          hash = ((hash << 5) - hash + text.length) | 0;
          hash = ((hash << 5) - hash + (el.offsetTop | 0)) | 0;
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

      function poll() {
        if (!isContextValid || document.hidden) {
          pollTimer = setTimeout(poll, POLL_INTERVAL_THROTTLED_MS);
          return;
        }
        if (typeof checkAndReconnect === 'function') {
          checkAndReconnect();
        }

        var sig = computeContentSignature(cfg);
        if (sig !== null && sig !== lastContentSignature) {
          lastContentSignature = sig;
          if (typeof onChangeCallback === 'function') {
            onChangeCallback(false); // not immediate, will go through debounce
          }
        }

        var timeSinceMoRebuild = Date.now() - getLastRebuildTime();
        var isBadgeMode = !document.querySelector('.toc-floating[data-toc-owner]');
        var interval = (timeSinceMoRebuild < POLL_INTERVAL_THROTTLED_MS || isBadgeMode)
          ? POLL_INTERVAL_THROTTLED_MS
          : POLL_INTERVAL_MS;
        pollTimer = setTimeout(poll, interval);
      }
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
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
        originalPushState = history.pushState;
        originalReplaceState = history.replaceState;
        lastKnownUrl = location.href;

        history.pushState = function wrappedPushState() {
          var result = originalPushState.apply(this, arguments);
          try { onUrlChange(); } catch (_) {}
          return result;
        };
        history.replaceState = function wrappedReplaceState() {
          var result = originalReplaceState.apply(this, arguments);
          try { onUrlChange(); } catch (_) {}
          return result;
        };

        popstateHandler = function() { try { onUrlChange(); } catch (_) {} };
        hashchangeHandler = function() { try { onUrlChange(); } catch (_) {} };
        window.addEventListener('popstate', popstateHandler);
        window.addEventListener('hashchange', hashchangeHandler);
      } catch (e) {
        console.warn('[toc] failed to set up URL change monitoring:', e);
      }
    }

    function teardownUrlHooks() {
      if (originalPushState !== null) {
        try { history.pushState = originalPushState; } catch (_) {}
        originalPushState = null;
      }
      if (originalReplaceState !== null) {
        try { history.replaceState = originalReplaceState; } catch (_) {}
        originalReplaceState = null;
      }
      if (popstateHandler) {
        try { window.removeEventListener('popstate', popstateHandler); } catch (_) {}
        popstateHandler = null;
      }
      if (hashchangeHandler) {
        try { window.removeEventListener('hashchange', hashchangeHandler); } catch (_) {}
        hashchangeHandler = null;
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
      lastContentSignature = computeContentSignature(cfg);
      setupUrlHooks();
      startPolling(cfg);
    }

    function stop() {
      teardownUrlHooks();
      stopPolling();
      onChangeCallback = null;
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

  return { createUrlMonitor: createUrlMonitor };
});
