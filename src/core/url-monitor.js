'use strict';

  /**
   * Creates a URL change monitor that detects pushState, replaceState,
   * popstate, and hashchange events. Also polls URL changes as a fallback
   * for environments where custom events are not reliably dispatched.
   *
   * @param {object} opts
   * @param {function} opts.uiConst - UI constant getter
   * @param {function} [opts.checkAndReconnect] - Callback to reconnect DOM watcher
   * @returns {object}
   */
export function createUrlMonitor(opts) {
    var uiConst = opts && opts.uiConst;
    var checkAndReconnect = (opts && opts.checkAndReconnect) || null;

    // State
    var lastKnownUrl = '';
    var urlChangeTimer = null;
    var popstateHandler = null;
    var hashchangeHandler = null;
    var pageUrlChangeHandler = null;

    // Polling fallback state
    var pollTimer = null;

    var isContextValid = true;
    var onChangeCallback = null;

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

    function startPolling() {
      stopPolling();
      var POLL_INTERVAL_MS = (typeof uiConst === 'function') ? uiConst('POLL_INTERVAL_THROTTLED_MS', 10000) : 10000;

      function poll() {
        if (!isContextValid) {
          pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }
        if (document.hidden) {
          pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }
        // Detect URL changes that may have been missed by event listeners
        if (location.href !== lastKnownUrl) {
          onUrlChange();
        }
        if (typeof checkAndReconnect === 'function') {
          checkAndReconnect();
        }

        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
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
      setupUrlHooks();
      startPolling();
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
