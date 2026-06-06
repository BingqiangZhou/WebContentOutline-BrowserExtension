
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
export function createUrlMonitor(opts: { checkAndReconnect?: () => void; mutationObserverAvailable?: boolean }) {
    var checkAndReconnect: (() => void) | null = (opts && opts.checkAndReconnect) || null;

    // State
    var lastKnownUrl = '';
    var urlChangeTimer: ReturnType<typeof setTimeout> | null = null;
    var popstateHandler: ((this: Window, ev: PopStateEvent) => void) | null = null;
    var hashchangeHandler: ((this: Window, ev: HashChangeEvent) => void) | null = null;

    // Polling fallback state
    var pollTimer: ReturnType<typeof setTimeout> | null = null;
    var visibilityHandler: (() => void) | null = null;

    var isContextValid = true;
    var onChangeCallback: ((immediate: boolean) => void) | null = null;

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

      // Pause/resume polling based on tab visibility
      if (!visibilityHandler) {
        visibilityHandler = function() {
          if (document.hidden) { stopPolling(); }
          else { startPolling(); }
        };
      }
      document.addEventListener('visibilitychange', visibilityHandler);
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
        window.removeEventListener('popstate', popstateHandler);
        popstateHandler = null;
      }
      if (hashchangeHandler) {
        window.removeEventListener('hashchange', hashchangeHandler);
        hashchangeHandler = null;
      }
      if (urlChangeTimer) {
        clearTimeout(urlChangeTimer);
        urlChangeTimer = null;
      }
    }

    function start(cfg: unknown, onChange: (immediate: boolean) => void) {
      stop();
      isContextValid = true;
      onChangeCallback = onChange || null;
      setupUrlHooks();
      startPolling();
    }

    function stop() {
      teardownUrlHooks();
      stopPolling();
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
      }
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
