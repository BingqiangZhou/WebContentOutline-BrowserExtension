(() => {
  'use strict';

  let isExtensionContextValid = true;

  function createMutationObserver(onRebuild, getNavLock) {
    const DEBOUNCE_MS = 500;
    let debounceTimer = null;
    let pendingRebuild = false;
    let unlockTimer = null;

    const stopTimers = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (unlockTimer) {
        clearTimeout(unlockTimer);
        unlockTimer = null;
      }
    };

    const safeRebuild = async () => {
      if (!isExtensionContextValid) return;
      try {
        await onRebuild();
      } catch (e) {
        if (e && e.message && e.message.includes('Extension context invalidated')) {
          isExtensionContextValid = false;
          stopTimers();
          return;
        }
        throw e;
      }
    };

    function waitForUnlock() {
      if (unlockTimer) return;
      const check = () => {
        unlockTimer = null;
        if (!isExtensionContextValid) return;
        if (!getNavLock()) {
          if (pendingRebuild) {
            pendingRebuild = false;
            safeRebuild();
          }
          return;
        }
        unlockTimer = setTimeout(check, 200);
      };
      unlockTimer = setTimeout(check, 200);
    }

    function scheduleRebuild() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (getNavLock()) {
          pendingRebuild = true;
          waitForUnlock();
          return;
        }
        pendingRebuild = false;
        safeRebuild();
      }, DEBOUNCE_MS);
    }

    function hasMeaningfulChange(mutations) {
      for (const m of mutations) {
        if (m.type === 'childList') {
          if ((m.addedNodes && m.addedNodes.length) || (m.removedNodes && m.removedNodes.length)) return true;
        }
        if (m.type === 'characterData') return true;
        if (m.type === 'attributes') {
          const name = m.attributeName || '';
          if (name === 'hidden' || name === 'style' || name === 'class' || name === 'id' ||
              name === 'aria-hidden' || name === 'aria-expanded' || name === 'open') {
            return true;
          }
        }
      }
      return false;
    }

    function hasValidSelectors(cfg) {
      if (cfg.selectors && cfg.selectors.length > 0) {
        return true;
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

      if (typeof MutationObserver !== 'undefined' && hasValidSelectors(cfg)) {
        const observer = new MutationObserver((mutations) => {
          if (!isExtensionContextValid) {
            observer.disconnect();
            return;
          }
          if (!hasMeaningfulChange(mutations)) return;
          scheduleRebuild();
        });

        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true
        });

        return {
          disconnect() {
            observer.disconnect();
            stopTimers();
          },
          getPendingRebuild: () => pendingRebuild,
          setPendingRebuild: (val) => {
            pendingRebuild = !!val;
            if (pendingRebuild) waitForUnlock();
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

