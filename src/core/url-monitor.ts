
'use strict';

  /**
   * Creates a URL change monitor that detects popstate, hashchange events,
   * and polls URL changes as a fallback for SPA navigation.
   *
   * @param {object} opts
   * @param {function} [opts.checkAndReconnect] - Callback to reconnect DOM watcher
   * @returns {object}
   */
export function createUrlMonitor(opts: { checkAndReconnect?: () => void }) {
    var checkAndReconnect: (() => void) | null = opts.checkAndReconnect || null;

    // State
    var lastKnownUrl = '';
    var urlChangeTimer: ReturnType<typeof setTimeout> | null = null;
    var popstateHandler: ((this: Window, ev: PopStateEvent) => void) | null = null;
    var hashchangeHandler: ((this: Window, ev: HashChangeEvent) => void) | null = null;

    // History interception state. SPA routers (React Router, Next <Link>, Vue
    // history mode) navigate via history.pushState/replaceState, which fire
    // neither popstate nor hashchange — we wrap them to detect such navigations
    // immediately instead of up to POLL_INTERVAL_MS later via the poll.
    var origPushState: ((...args: any[]) => void) | null = null;
    var origReplaceState: ((...args: any[]) => void) | null = null;
    var wrappedPushState: ((...args: any[]) => void) | null = null;
    var wrappedReplaceState: ((...args: any[]) => void) | null = null;
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
          // Debounced (not immediate): an immediate rebuild right after the URL
          // change often reads a pre-swap DOM (stale/empty TOC on SPAs) and can
          // race the 3s checkAndReconnect poll. Letting it go through the normal
          // debounce gives the SPA a moment to render and coalesces with any
          // concurrent mutation-driven rebuild.
          onChangeCallback(false);
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

        // Wrap history.pushState/replaceState. Guarded so a re-setup (which
        // already calls teardownUrlHooks first) never double-wraps. Capture the
        // DIRECT reference (not a bound copy) so teardown restores
        // reference-equality and so a page that re-wraps after us is detectable.
        // onUrlChange no-ops when the URL is unchanged, so state-only calls
        // don't trigger a rebuild.
        if (!origPushState) {
          origPushState = history.pushState as unknown as ((...args: any[]) => void);
          wrappedPushState = function () {
            // Delegate to the original bound to history (native methods throw
            // "Illegal invocation" if called unbound). If it throws, the URL did
            // not change, so skip onUrlChange.
            if (origPushState) (origPushState as any).apply(history, arguments as any);
            try { onUrlChange(); } catch (_) {}
          };
          (history as any).pushState = wrappedPushState;
        }
        if (!origReplaceState) {
          origReplaceState = history.replaceState as unknown as ((...args: any[]) => void);
          wrappedReplaceState = function () {
            if (origReplaceState) (origReplaceState as any).apply(history, arguments as any);
            try { onUrlChange(); } catch (_) {}
          };
          (history as any).replaceState = wrappedReplaceState;
        }
      } catch (e) {
        console.warn('[toc] failed to set up URL change monitoring:', e);
      }
    }

    function teardownUrlHooks() {
      // Restore the original history methods so we never leave our wrappers in
      // place after teardown — but ONLY if our wrapper is still installed. If
      // the page replaced history.pushState/replaceState after us, leave its
      // version in place (don't clobber the page's own History API usage).
      if (wrappedPushState && history.pushState === wrappedPushState) {
        try { (history as any).pushState = origPushState; } catch (_) {}
      }
      origPushState = null;
      wrappedPushState = null;
      if (wrappedReplaceState && history.replaceState === wrappedReplaceState) {
        try { (history as any).replaceState = origReplaceState; } catch (_) {}
      }
      origReplaceState = null;
      wrappedReplaceState = null;
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
