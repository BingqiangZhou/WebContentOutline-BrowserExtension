(() => {
  'use strict';

  if (!window.TOC_UTILS) {
    console.error('[toc] mutation-observer.js not loaded — missing dependencies: TOC_UTILS');
    return;
  }

  let isExtensionContextValid = true;

  function createMutationObserver(onRebuild, getNavLock) {
    const { uiConst } = window.TOC_UTILS || {};
    const CFG = (() => {
      const get = (name, fallback) => (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback;
      return {
        DEBOUNCE_MS: get('MUTATION_DEBOUNCE_MS', 500),
        UNLOCK_POLL_MS: get('MUTATION_UNLOCK_POLL_MS', 200),
        REBUILD_RETRY_MS: get('MUTATION_REBUILD_RETRY_MS', 1000),
        MUTATION_UNLOCK_POLL_MAX_MS: get('MUTATION_UNLOCK_POLL_MAX_MS', 30000),
        MAX_DYNAMIC_DEBOUNCE_MS: 1000,
      };
    })();
    const OBSERVED_ATTRIBUTES = [
      'hidden',
      'style',
      'class',
      'id',
      'aria-hidden',
      'aria-expanded',
      'open'
    ];
    const OBSERVED_ATTR_SET = new Set(OBSERVED_ATTRIBUTES);
    let debounceTimer = null;
    let hasPendingRebuild = false;
    let unlockTimer = null;
    let unlockPollStartTs = 0;
    let unlockWarned = false;
    let retryTimer = null;
    let postFlightTimer = null;
    let observerRef = null;
    let rebuildInFlight = null;

    // Dynamic debounce tracking
    let consecutiveMutations = 0;
    let lastMutationTime = 0;

    // URL change monitoring state
    let originalPushState = null;
    let originalReplaceState = null;
    let lastKnownUrl = '';
    let urlChangeTimer = null;
    let popstateHandler = null;
    let hashchangeHandler = null;

    // Polling fallback state
    let pollTimer = null;
    let lastContentSignature = null;
    let lastRebuildFromMo = 0;

    const disconnectObserver = () => {
      const obs = observerRef;
      observerRef = null;
      if (obs && typeof obs.disconnect === 'function') {
        try { obs.disconnect(); } catch (_) {}
      }
    };

    const stopTimers = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (unlockTimer) {
        clearTimeout(unlockTimer);
        unlockTimer = null;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (postFlightTimer) {
        clearTimeout(postFlightTimer);
        postFlightTimer = null;
      }
      if (urlChangeTimer) {
        clearTimeout(urlChangeTimer);
        urlChangeTimer = null;
      }
      stopPolling();
      unlockPollStartTs = 0;
      unlockWarned = false;
    };

    const safeRebuild = async () => {
      if (!isExtensionContextValid) return;
      try {
        await onRebuild();
        lastRebuildFromMo = Date.now();
        return true;
      } catch (e) {
        const { isContextInvalidatedError } = window.TOC_UTILS || {};
        const invalidated = (typeof isContextInvalidatedError === 'function')
          ? isContextInvalidatedError(e)
          : !!(e && e.message && e.message.includes('Extension context invalidated'));
        if (invalidated) {
          isExtensionContextValid = false;
          hasPendingRebuild = false;
          stopTimers();
          try { observerRef && observerRef.disconnect && observerRef.disconnect(); } catch (_) {}
          observerRef = null;
          return false;
        }
        console.warn('[toc] rebuild failed from MutationObserver:', e);
        return false;
      }
    };

    const scheduleRetry = () => {
      if (!isExtensionContextValid) return;
      if (!hasPendingRebuild) return;
      if (retryTimer) return;
      const ms = (Number.isFinite(CFG.REBUILD_RETRY_MS) && CFG.REBUILD_RETRY_MS > 0) ? CFG.REBUILD_RETRY_MS : 1000;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!isExtensionContextValid) return;
        if (!hasPendingRebuild) return;
        attemptRebuild();
      }, ms);
    };

    const attemptRebuild = () => {
      if (!isExtensionContextValid) return Promise.resolve(false);
      if (rebuildInFlight) {
        hasPendingRebuild = true;
        return rebuildInFlight;
      }
      if (getNavLock()) {
        hasPendingRebuild = true;
        waitForUnlock();
        return Promise.resolve(false);
      }
      if (!hasPendingRebuild) return Promise.resolve(true);

      rebuildInFlight = (async () => {
        hasPendingRebuild = false;
        const ok = await safeRebuild();
        if (!ok && isExtensionContextValid) {
          hasPendingRebuild = true;
          scheduleRetry();
        }
        return !!ok;
      })().finally(() => {
        rebuildInFlight = null;
        if (!isExtensionContextValid) return;
        if (!hasPendingRebuild) return;
        if (postFlightTimer) return;
        try {
          postFlightTimer = setTimeout(() => {
            postFlightTimer = null;
            if (!isExtensionContextValid) return;
            if (!hasPendingRebuild) return;
            attemptRebuild();
          }, 0);
        } catch (_) {
          postFlightTimer = null;
        }
      });

      return rebuildInFlight;
    };

    function waitForUnlock() {
      if (unlockTimer) return;
      if (!unlockPollStartTs) unlockPollStartTs = Date.now();
      const MAX_POLL_MS = CFG.MUTATION_UNLOCK_POLL_MAX_MS;
      const check = () => {
        unlockTimer = null;
        if (!isExtensionContextValid) return;
        if (!getNavLock()) {
          unlockPollStartTs = 0;
          unlockWarned = false;
          if (hasPendingRebuild) {
            attemptRebuild();
          }
          return;
        }
        if (Number.isFinite(MAX_POLL_MS) && MAX_POLL_MS > 0 && (Date.now() - unlockPollStartTs) > MAX_POLL_MS) {
          if (!unlockWarned) {
            unlockWarned = true;
            console.warn('[toc] nav lock stuck; will keep polling at a lower frequency');
          }
        }
        const nextPollMs = unlockWarned ? Math.max(CFG.UNLOCK_POLL_MS, 1000) : CFG.UNLOCK_POLL_MS;
        unlockTimer = setTimeout(check, nextPollMs);
      };
      unlockTimer = setTimeout(check, CFG.UNLOCK_POLL_MS);
    }

    function scheduleRebuild(immediate) {
      if (!isExtensionContextValid) return;
      if (immediate) {
        hasPendingRebuild = true;
        attemptRebuild();
        return;
      }
      const now = Date.now();
      const timeSinceLast = now - lastMutationTime;

      if (timeSinceLast < 1000) {
        consecutiveMutations++;
      } else {
        consecutiveMutations = 0;
      }
      lastMutationTime = now;

      const dynamicDebounce = Math.min(
        CFG.DEBOUNCE_MS * Math.pow(1.3, Math.min(consecutiveMutations, 6)),
        CFG.MAX_DYNAMIC_DEBOUNCE_MS
      );

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        hasPendingRebuild = true;
        attemptRebuild();
      }, dynamicDebounce);
    }

    const onUrlChange = () => {
      if (!isExtensionContextValid) return;
      const currentUrl = location.href;
      if (currentUrl === lastKnownUrl) return;
      lastKnownUrl = currentUrl;
      if (urlChangeTimer) clearTimeout(urlChangeTimer);
      urlChangeTimer = setTimeout(() => {
        urlChangeTimer = null;
        if (!isExtensionContextValid) return;
        if (location.href !== lastKnownUrl) {
          lastKnownUrl = location.href;
        }
        scheduleRebuild(true);
      }, uiConst('URL_CHANGE_DEDUP_MS', 500));
    };

    function computeContentSignature(cfg) {
      try {
        const selectors = cfg && cfg.selectors;
        if (!selectors || !selectors.length) return null;
        const exprs = selectors.map(s => s.expr).filter(Boolean);
        if (!exprs.length) return null;
        const selector = exprs.join(',');
        const els = document.querySelectorAll(selector);
        let hash = 0;
        const len = Math.min(els.length, 400);
        for (let i = 0; i < len; i++) {
          const el = els[i];
          const text = el.textContent || '';
          hash = ((hash << 5) - hash + text.length) | 0;
          hash = ((hash << 5) - hash + (el.offsetTop | 0)) | 0;
        }
        return els.length + ':' + hash;
      } catch (_) {
        return null;
      }
    }

    function checkAndReconnectObserver() {
      if (!observerRef) return;
      try {
        const root = document.documentElement || document.body;
        if (!root) return;
        observerRef.takeRecords();
      } catch (_) {
        try {
          observerRef.disconnect();
          observerRef.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: OBSERVED_ATTRIBUTES
          });
          console.debug('[toc] reconnected MutationObserver');
        } catch (e) {
          console.warn('[toc] failed to reconnect MutationObserver:', e);
        }
      }
    }

    function startPolling(cfg) {
      stopPolling();
      const POLL_INTERVAL_MS = uiConst('POLL_INTERVAL_MS', 3000);
      const POLL_INTERVAL_THROTTLED_MS = uiConst('POLL_INTERVAL_THROTTLED_MS', 10000);
      const poll = () => {
        if (!isExtensionContextValid || document.hidden) {
          pollTimer = setTimeout(poll, POLL_INTERVAL_THROTTLED_MS);
          return;
        }
        checkAndReconnectObserver();

        const sig = computeContentSignature(cfg);
        if (sig !== null && sig !== lastContentSignature) {
          lastContentSignature = sig;
          hasPendingRebuild = true;
          attemptRebuild();
        }
        const timeSinceMoRebuild = Date.now() - lastRebuildFromMo;
        const isBadgeMode = !document.querySelector('.toc-floating[data-toc-owner]');
        const interval = (timeSinceMoRebuild < POLL_INTERVAL_THROTTLED_MS || isBadgeMode)
          ? POLL_INTERVAL_THROTTLED_MS
          : POLL_INTERVAL_MS;
        pollTimer = setTimeout(poll, interval);
      };
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    function hasMeaningfulChange(mutations) {
      for (const m of mutations) {
        try {
          const t = m.target;
          if (t && t.nodeType === 1 && t.closest) {
            if (t.closest('.toc-floating, .toc-collapsed-badge, .toc-overlay, .toc-toast-container')) {
              continue;
            }
          }
          // Filter characterData: ignore text changes inside extension-owned elements
          if (m.type === 'characterData' && t && t.nodeType === 3 && t.parentElement) {
            const parent = t.parentElement;
            if (parent.closest && parent.closest('.toc-floating, .toc-collapsed-badge, .toc-overlay, .toc-toast-container')) {
              continue;
            }
          }
        } catch (_) {}

        if (m.type === 'childList') {
          if ((m.addedNodes && m.addedNodes.length) || (m.removedNodes && m.removedNodes.length)) return true;
        }
        if (m.type === 'attributes') {
          const name = m.attributeName || '';
          if (OBSERVED_ATTR_SET.has(name)) {
            return true;
          }
        }
        if (m.type === 'characterData') {
          return true;
        }
      }
      return false;
    }

    function start(cfg) {
      stopTimers();
      hasPendingRebuild = false;
      consecutiveMutations = 0;
      lastMutationTime = 0;
      disconnectObserver();

      // --- URL change monitoring setup ---
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

      try {
        originalPushState = history.pushState;
        originalReplaceState = history.replaceState;
        lastKnownUrl = location.href;

        history.pushState = function wrappedPushState() {
          const result = originalPushState.apply(this, arguments);
          try { onUrlChange(); } catch (_) {}
          return result;
        };
        history.replaceState = function wrappedReplaceState() {
          const result = originalReplaceState.apply(this, arguments);
          try { onUrlChange(); } catch (_) {}
          return result;
        };

        popstateHandler = () => { try { onUrlChange(); } catch (_) {} };
        hashchangeHandler = () => { try { onUrlChange(); } catch (_) {} };
        window.addEventListener('popstate', popstateHandler);
        window.addEventListener('hashchange', hashchangeHandler);
      } catch (e) {
        console.warn('[toc] failed to set up URL change monitoring:', e);
      }
      // --- end URL change monitoring setup ---

      if (typeof MutationObserver !== 'undefined') {
        const resolveObserveRoot = () => {
          try {
            return document.documentElement || document.body;
          } catch (_) {
            return document.documentElement;
          }
        };
        const observer = new MutationObserver((mutations) => {
          if (!isExtensionContextValid) {
            observer.disconnect();
            return;
          }
          if (!hasMeaningfulChange(mutations)) return;
          scheduleRebuild();
        });
        observerRef = observer;

        const root = (() => {
          const r = resolveObserveRoot();
          if (r && r.nodeType === Node.ELEMENT_NODE) return r;
          return document.documentElement || document.body || null;
        })();

        if (!root) {
          // Extremely rare edge case (e.g. detached document). Avoid observing null.
          observerRef = null;
          try { observer.disconnect(); } catch (_) {}
          stopTimers();
          return {
            disconnect() { stopPolling(); stopTimers(); },
            getPendingRebuild: () => false,
            setPendingRebuild: () => {}
          };
        }

        try {
          observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: OBSERVED_ATTRIBUTES
          });
        } catch (_) {
          observerRef = null;
          try { observer.disconnect(); } catch (_) {}
          stopTimers();
          return {
            disconnect() { stopPolling(); stopTimers(); },
            getPendingRebuild: () => false,
            setPendingRebuild: () => {}
          };
        }

        // Start polling fallback
        lastContentSignature = computeContentSignature(cfg);
        startPolling(cfg);

        return {
          disconnect() {
            observerRef = null;
            try {
              observer.disconnect();
            } catch (_) {
              // ignore
            } finally {
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
              stopPolling();
              stopTimers();
            }
          },
          getPendingRebuild: () => hasPendingRebuild,
          setPendingRebuild: (val) => {
            if (val) {
              hasPendingRebuild = true;
            } else {
              hasPendingRebuild = false;
            }
            if (!hasPendingRebuild) {
              if (retryTimer) {
                try { clearTimeout(retryTimer); } catch (_) {}
                retryTimer = null;
              }
              return;
            }
            attemptRebuild();
          }
        };
      }

      return {
        disconnect() {
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
          stopPolling();
          stopTimers();
        },
        getPendingRebuild: () => false,
        setPendingRebuild: () => {}
      };
    }

    return { start };
  }

  window.MUTATION_OBSERVER = {
    createMutationObserver
  };
})();

