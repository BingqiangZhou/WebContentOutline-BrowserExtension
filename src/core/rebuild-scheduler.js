define('rebuild-scheduler', ['dom-watcher', 'url-monitor', 'toc-constants'], function(domWatcherMod, urlMonitorMod, C) {
  'use strict';

  var uiConst = C.uiConst;

  // Timing constants
  var DEBOUNCE_MS = uiConst('MUTATION_DEBOUNCE_MS', 500);
  var MAX_DYNAMIC_DEBOUNCE_MS = 1000;
  var REBUILD_RETRY_MS = 1000;
  var MUTATION_UNLOCK_POLL_MAX_MS = 30000;

  /**
   * Creates a rebuild scheduler that coordinates DOM watching, URL monitoring,
   * and rebuild dispatch with dynamic debouncing, burst detection, and nav-lock waiting.
   *
   * @param {function} onRebuild - Async function called to perform a TOC rebuild.
   * @returns {object} handle with start(cfg), disconnect(), getPendingRebuild(), setPendingRebuild()
   */
  function createRebuildScheduler(onRebuild) {
    var NL = globalThis.NAV_LOCK;

    var isExtensionContextValid = true;
    var hasPendingRebuild = false;
    var rebuildInFlight = null;
    var lastRebuildFromMo = 0;

    // Timer references
    var debounceTimer = null;
    var unlockFailsafeTimer = null;
    var retryTimer = null;
    var postFlightTimer = null;

    // Dynamic debounce tracking
    var consecutiveMutations = 0;
    var lastMutationTime = 0;

    // Nav-lock wait state
    var unlockWaitActive = false;

    // Sub-components
    var domWatcher = null;
    var urlMonitor = null;

    var stopSchedulerTimers = function() {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      if (unlockFailsafeTimer) { clearTimeout(unlockFailsafeTimer); unlockFailsafeTimer = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (postFlightTimer) { clearTimeout(postFlightTimer); postFlightTimer = null; }
      unlockWaitActive = false;
    };

    // Forward declaration for mutual recursion
    var attemptRebuild;

    var safeRebuild = function() {
      if (!isExtensionContextValid) return Promise.resolve(false);
      return onRebuild().then(function(ok) {
        lastRebuildFromMo = Date.now();
        return true;
      }).catch(function(e) {
        var coreUtils = (typeof require === 'function') ? require('core-utils') : null;
        var checkFn = (coreUtils && typeof coreUtils.isContextInvalidatedError === 'function')
          ? coreUtils.isContextInvalidatedError
          : function(err) {
              return !!(err && err.message && err.message.includes('Extension context invalidated'));
            };
        var invalidated = checkFn(e);
        if (invalidated) {
          isExtensionContextValid = false;
          hasPendingRebuild = false;
          stopSchedulerTimers();
          if (domWatcher) domWatcher.invalidate();
          if (urlMonitor) urlMonitor.invalidate();
          return false;
        }
        console.warn('[toc] rebuild failed from MutationObserver:', e);
        return false;
      });
    };

    var scheduleRetry = function() {
      if (!isExtensionContextValid) return;
      if (!hasPendingRebuild) return;
      if (retryTimer) return;
      var ms = (Number.isFinite(REBUILD_RETRY_MS) && REBUILD_RETRY_MS > 0) ? REBUILD_RETRY_MS : 1000;
      retryTimer = setTimeout(function() {
        retryTimer = null;
        if (!isExtensionContextValid) return;
        if (!hasPendingRebuild) return;
        attemptRebuild();
      }, ms);
    };

    var waitForUnlock = function() {
      if (unlockWaitActive) return;
      unlockWaitActive = true;

      NL.onUnlock(function() {
        unlockWaitActive = false;
        if (hasPendingRebuild) {
          attemptRebuild();
        }
      });

      // Failsafe: if NAV_LOCK failsafe doesn't fire, force check after MUTATION_UNLOCK_POLL_MAX_MS
      unlockFailsafeTimer = setTimeout(function() {
        unlockFailsafeTimer = null;
        if (unlockWaitActive) {
          unlockWaitActive = false;
          if (hasPendingRebuild) attemptRebuild();
        }
      }, MUTATION_UNLOCK_POLL_MAX_MS);
    };

    attemptRebuild = function() {
      if (!isExtensionContextValid) return Promise.resolve(false);
      if (rebuildInFlight) {
        hasPendingRebuild = true;
        return rebuildInFlight;
      }
      if (NL.isLocked()) {
        hasPendingRebuild = true;
        waitForUnlock();
        return Promise.resolve(false);
      }
      if (!hasPendingRebuild) return Promise.resolve(true);

      rebuildInFlight = (function() {
        hasPendingRebuild = false;
        return safeRebuild().then(function(ok) {
          if (!ok && isExtensionContextValid) {
            hasPendingRebuild = true;
            scheduleRetry();
          }
          return !!ok;
        });
      })().then(function(result) {
        rebuildInFlight = null;
        if (!isExtensionContextValid) return result;
        if (!hasPendingRebuild) return result;
        if (postFlightTimer) return result;
        try {
          postFlightTimer = setTimeout(function() {
            postFlightTimer = null;
            if (!isExtensionContextValid) return;
            if (!hasPendingRebuild) return;
            attemptRebuild();
          }, 0);
        } catch (_) {
          postFlightTimer = null;
        }
        return result;
      }, function(err) {
        rebuildInFlight = null;
        return false;
      });

      return rebuildInFlight;
    };

    var scheduleRebuild = function(immediate) {
      if (!isExtensionContextValid) return;
      if (immediate) {
        hasPendingRebuild = true;
        attemptRebuild();
        return;
      }
      var now = Date.now();
      var timeSinceLast = now - lastMutationTime;

      if (timeSinceLast < 1000) {
        consecutiveMutations++;
      } else {
        consecutiveMutations = 0;
      }
      lastMutationTime = now;

      var dynamicDebounce = Math.min(
        DEBOUNCE_MS * Math.pow(1.3, Math.min(consecutiveMutations, 6)),
        MAX_DYNAMIC_DEBOUNCE_MS
      );

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        debounceTimer = null;
        hasPendingRebuild = true;
        attemptRebuild();
      }, dynamicDebounce);
    };

    var onMutation = function() {
      scheduleRebuild(false);
    };

    var onUrlChange = function(immediate) {
      scheduleRebuild(immediate);
    };

    function start(cfg) {
      // Stop any previous instance
      handle.disconnect();
      hasPendingRebuild = false;
      consecutiveMutations = 0;
      lastMutationTime = 0;
      isExtensionContextValid = true;

      // Create dom-watcher
      domWatcher = domWatcherMod.createDomWatcher(onMutation);
      var watcherOk = domWatcher.start();

      // Create url-monitor, passing dom-watcher's checkAndReconnect as callback
      urlMonitor = urlMonitorMod.createUrlMonitor({
        uiConst: uiConst,
        checkAndReconnect: (domWatcher && typeof domWatcher.checkAndReconnect === 'function')
          ? function() { domWatcher.checkAndReconnect(); }
          : null,
        getLastRebuildTime: function() { return lastRebuildFromMo; }
      });
      urlMonitor.start(cfg, onUrlChange);

      // If MutationObserver failed to start, polling is the only fallback
      // (url-monitor's polling is always running)
      return handle;
    }

    var handle = {
      start: start,
      disconnect: function() {
        if (domWatcher) { domWatcher.stop(); domWatcher = null; }
        if (urlMonitor) { urlMonitor.stop(); urlMonitor = null; }
        stopSchedulerTimers();
        hasPendingRebuild = false;
        rebuildInFlight = null;
        isExtensionContextValid = false;
      },
      getPendingRebuild: function() { return hasPendingRebuild; },
      setPendingRebuild: function(val) {
        if (val) {
          hasPendingRebuild = true;
        } else {
          hasPendingRebuild = false;
        }
        if (!hasPendingRebuild) {
          if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
          return;
        }
        attemptRebuild();
      }
    };

    return handle;
  }

  return { createRebuildScheduler: createRebuildScheduler };
});
