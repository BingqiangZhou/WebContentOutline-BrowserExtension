'use strict';

  /**
   * Creates a URL change monitor that detects popstate, hashchange events,
   * and polls URL changes as a fallback for SPA navigation.
   *
   * @param {object} opts
   * @param {function} [opts.checkAndReconnect] - Callback to reconnect DOM watcher
   * @param {boolean} [opts.mutationObserverAvailable] - Whether MutationObserver is active
   * @returns {object}
   */
export function createUrlMonitor(opts) {
    var checkAndReconnect = (opts && opts.checkAndReconnect) || null;

    // State
    var lastKnownUrl = '';
    var urlChangeTimer = null;
    var popstateHandler = null;
    var hashchangeHandler = null;

    // Polling fallback state
    var pollTimer = null;

    var isContextValid = true;
    var onChangeCallback = null;

    var POLL_INTERVAL_MS = 3000;

    function onUrlChange() {
      if (!isContextValid) return;
      var currentUrl = location.href;
      if (currentUrl === lastKnownUrl) return;
      lastKnownUrl = currentUrl;
      if (urlChangeTimer) clearTimeout(urlChangeTimer);
      urlChangeTimer = setTimeout(function() {
        urlChangeTimer = null;
        if (!isContextValid) return;
        if (location.href !== lastKnownUrl) {
          lastKnownUrl = location.href;
        }
        if (typeof onChangeCallback === 'function') {
          onChangeCallback(true); // immediate = true
        }
      }, 500);
    }

    function startPolling() {
      stopPolling();

      function poll() {
        if (!isContextValid) return;
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
        window.addEventListener('popstate', popstateHandler);
        window.addEventListener('hashchange', hashchangeHandler);
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
