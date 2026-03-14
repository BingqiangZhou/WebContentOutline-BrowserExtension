(() => {
  'use strict';

  let isExtensionContextValid = true;

  function createMutationObserver(onRebuild, getNavLock) {
    const { uiConst } = window.TOC_UTILS || {};
    const DEBOUNCE_MS = typeof uiConst === 'function' ? uiConst('MUTATION_DEBOUNCE_MS', 500) : 500;
    const UNLOCK_POLL_MS = typeof uiConst === 'function' ? uiConst('MUTATION_UNLOCK_POLL_MS', 200) : 200;
    const REBUILD_RETRY_MS = typeof uiConst === 'function' ? uiConst('MUTATION_REBUILD_RETRY_MS', 1000) : 1000;
    const MAX_DYNAMIC_DEBOUNCE_MS = 2000; // Maximum debounce time
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
    let pendingRebuild = false;
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
      unlockPollStartTs = 0;
      unlockWarned = false;
    };

    const safeRebuild = async () => {
      if (!isExtensionContextValid) return;
      try {
        await onRebuild();
        return true;
      } catch (e) {
        const { isContextInvalidatedError } = window.TOC_UTILS || {};
        const invalidated = (typeof isContextInvalidatedError === 'function')
          ? isContextInvalidatedError(e)
          : !!(e && e.message && e.message.includes('Extension context invalidated'));
        if (invalidated) {
          isExtensionContextValid = false;
          pendingRebuild = false;
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
      if (!pendingRebuild) return;
      if (retryTimer) return;
      const ms = (Number.isFinite(REBUILD_RETRY_MS) && REBUILD_RETRY_MS > 0) ? REBUILD_RETRY_MS : 1000;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!isExtensionContextValid) return;
        if (!pendingRebuild) return;
        attemptRebuild();
      }, ms);
    };

    const attemptRebuild = () => {
      if (!isExtensionContextValid) return Promise.resolve(false);
      if (rebuildInFlight) {
        pendingRebuild = true;
        return rebuildInFlight;
      }
      if (getNavLock()) {
        pendingRebuild = true;
        waitForUnlock();
        return Promise.resolve(false);
      }
      if (!pendingRebuild) return Promise.resolve(true);

      rebuildInFlight = (async () => {
        pendingRebuild = false;
        const ok = await safeRebuild();
        if (!ok && isExtensionContextValid) {
          pendingRebuild = true;
          scheduleRetry();
        }
        return !!ok;
      })().finally(() => {
        rebuildInFlight = null;
        if (!isExtensionContextValid) return;
        if (!pendingRebuild) return;
        if (postFlightTimer) return;
        try {
          postFlightTimer = setTimeout(() => {
            postFlightTimer = null;
            if (!isExtensionContextValid) return;
            if (!pendingRebuild) return;
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
      const MAX_POLL_MS = typeof uiConst === 'function' ? uiConst('MUTATION_UNLOCK_POLL_MAX_MS', 30000) : 30000;
      const check = () => {
        unlockTimer = null;
        if (!isExtensionContextValid) return;
        if (!getNavLock()) {
          unlockPollStartTs = 0;
          unlockWarned = false;
          if (pendingRebuild) {
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
        const nextPollMs = unlockWarned ? Math.max(UNLOCK_POLL_MS, 1000) : UNLOCK_POLL_MS;
        unlockTimer = setTimeout(check, nextPollMs);
      };
      unlockTimer = setTimeout(check, UNLOCK_POLL_MS);
    }

    function scheduleRebuild() {
      if (!isExtensionContextValid) return;
      const now = Date.now();
      const timeSinceLast = now - lastMutationTime;

      // Dynamic debounce: increase debounce time for frequent changes
      if (timeSinceLast < 1000) {
        consecutiveMutations++;
      } else {
        consecutiveMutations = 0;
      }
      lastMutationTime = now;

      const dynamicDebounce = Math.min(
        DEBOUNCE_MS * Math.pow(1.5, Math.min(consecutiveMutations, 5)),
        MAX_DYNAMIC_DEBOUNCE_MS
      );

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        pendingRebuild = true;
        attemptRebuild();
      }, dynamicDebounce);
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
      }
      return false;
    }

    function hasValidSelectors(cfg) {
      const selectors = cfg && Array.isArray(cfg.selectors) ? cfg.selectors : [];
      if (selectors.length > 0) {
        const { validateSelectorExpression } = window.TOC_UTILS || {};
        for (const s of selectors) {
          if (!s || typeof s !== 'object') continue;
          const type = s.type === 'css' || s.type === 'xpath' ? s.type : null;
          const expr = typeof s.expr === 'string' ? s.expr : '';
          if (!type || !expr.trim()) continue;
          if (typeof validateSelectorExpression === 'function') {
            try {
              if (validateSelectorExpression(type, expr)) return true;
            } catch (_) {}
          } else {
            return true;
          }
        }
      }

      const commonSelectors = [
        'h1, h2, h3, h4, h5, h6',
        '[id*="title"], [class*="title"]',
        '[id*="heading"], [class*="heading"]'
      ];

      for (let selector of commonSelectors) {
        try {
          if (document.querySelector(selector)) {
            return true;
          }
        } catch (_) {}
      }

      return false;
    }

    function start(cfg) {
      stopTimers();
      pendingRebuild = false;
      disconnectObserver();

      if (typeof MutationObserver !== 'undefined' && hasValidSelectors(cfg)) {
        const resolveObserveRoot = () => {
          try {
            return document.querySelector('main') || document.querySelector('article') || document.body || document.documentElement;
          } catch (_) {
            return document.body || document.documentElement;
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
          return document.body || document.documentElement || null;
        })();

        if (!root) {
          // Extremely rare edge case (e.g. detached document). Avoid observing null.
          observerRef = null;
          try { observer.disconnect(); } catch (_) {}
          stopTimers();
          return {
            disconnect() { stopTimers(); },
            getPendingRebuild: () => false,
            setPendingRebuild: () => {}
          };
        }

        try {
          observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: false,
            attributes: true,
            attributeFilter: OBSERVED_ATTRIBUTES
          });
        } catch (_) {
          observerRef = null;
          try { observer.disconnect(); } catch (_) {}
          stopTimers();
          return {
            disconnect() { stopTimers(); },
            getPendingRebuild: () => false,
            setPendingRebuild: () => {}
          };
        }

        return {
          disconnect() {
            observerRef = null;
            try {
              observer.disconnect();
            } catch (_) {
              // ignore
            } finally {
              stopTimers();
            }
          },
          getPendingRebuild: () => pendingRebuild,
          setPendingRebuild: (val) => {
            pendingRebuild = !!val;
            if (!pendingRebuild) {
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
        disconnect() { stopTimers(); },
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

