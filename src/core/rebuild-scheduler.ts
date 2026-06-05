
'use strict';

import { createDomWatcher } from './dom-watcher.js';
import { createUrlMonitor } from './url-monitor.js';
import * as NL from './nav-lock.js';
import { isContextInvalidatedError } from '../utils/core-utils.js';

  var DEBOUNCE_MS = 400;
  var MAX_CONSECUTIVE_FAILURES = 5;
  var CIRCUIT_BREAKER_RESET_MS = 30000;

  /**
   * Creates a rebuild scheduler that coordinates DOM watching, URL monitoring,
   * and rebuild dispatch with simple debouncing and circuit breaker.
   *
   * @param {function} onRebuild - Async function called to perform a TOC rebuild.
   * @param {object} [opts] - Options.
   * @param {function} [opts.onConfigDirty] - Called when a URL change is detected.
   * @returns {object} handle with start(cfg), disconnect(), getPendingRebuild(), setPendingRebuild()
   */
export function createRebuildScheduler(onRebuild, opts) {
    opts = opts || {};
    var onConfigDirty = typeof opts.onConfigDirty === 'function' ? opts.onConfigDirty : null;
    var isExtensionContextValid = true;
    var hasPendingRebuild = false;
    var rebuildInFlight = null;
    var debounceTimer = null;
    var consecutiveFailures = 0;
    var lastFailureTime = 0;
    var visibilityHandler = null;

    // Sub-components
    var domWatcher = null;
    var urlMonitor = null;

    var safeRebuild = async function() {
      if (!isExtensionContextValid) return false;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        if (Date.now() - lastFailureTime >= CIRCUIT_BREAKER_RESET_MS) {
          consecutiveFailures = 0;
          lastFailureTime = 0;
        } else {
          return false;
        }
      }
      try {
        await onRebuild();
        consecutiveFailures = 0;
        lastFailureTime = 0;
        return true;
      } catch (e) {
        if (isContextInvalidatedError(e)) {
          isExtensionContextValid = false;
          hasPendingRebuild = false;
          consecutiveFailures = 0;
          if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
          if (domWatcher) domWatcher.invalidate();
          if (urlMonitor) urlMonitor.invalidate();
          return false;
        }
        console.warn('[toc] rebuild failed:', e);
        consecutiveFailures++;
        lastFailureTime = Date.now();
        return false;
      }
    };

    var attemptRebuild = async function() {
      if (!isExtensionContextValid) return false;
      if (rebuildInFlight) {
        hasPendingRebuild = true;
        return rebuildInFlight;
      }
      if (NL.isLocked()) {
        hasPendingRebuild = true;
        return false;
      }
      if (!hasPendingRebuild) return true;

      hasPendingRebuild = false;
      rebuildInFlight = (async () => {
        try {
          var ok = await safeRebuild();
          rebuildInFlight = null;
          if (!ok && isExtensionContextValid) {
            hasPendingRebuild = true;
          }
          return !!ok;
        } catch (_) {
          rebuildInFlight = null;
          return false;
        }
      })();

      return rebuildInFlight;
    };

    var scheduleRebuild = function(immediate) {
      if (!isExtensionContextValid) return;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        if (Date.now() - lastFailureTime >= CIRCUIT_BREAKER_RESET_MS) {
          consecutiveFailures = 0;
          lastFailureTime = 0;
        } else {
          return;
        }
      }
      if (document.hidden) { hasPendingRebuild = true; return; }
      if (immediate) {
        hasPendingRebuild = true;
        attemptRebuild();
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        debounceTimer = null;
        hasPendingRebuild = true;
        attemptRebuild();
      }, DEBOUNCE_MS);
    };

    var onMutation = function() {
      scheduleRebuild(false);
    };

    var onUrlChange = function(immediate) {
      if (onConfigDirty) onConfigDirty();
      scheduleRebuild(immediate);
    };

    function start(cfg) {
      // Stop any previous instance
      handle.disconnect();
      hasPendingRebuild = false;
      isExtensionContextValid = true;
      consecutiveFailures = 0;
      lastFailureTime = 0;

      // Create dom-watcher
      domWatcher = createDomWatcher(onMutation, cfg);
      var watcherOk = domWatcher.start();

      // Create url-monitor
      urlMonitor = createUrlMonitor({
        checkAndReconnect: (domWatcher && typeof domWatcher.checkAndReconnect === 'function')
          ? function() { domWatcher.checkAndReconnect(); }
          : null
      });
      urlMonitor.start(cfg, onUrlChange);

      // Register visibilitychange listener for pending rebuilds
      if (!visibilityHandler) {
        visibilityHandler = function() {
          if (!document.hidden && hasPendingRebuild) {
            attemptRebuild();
          }
        };
      }
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', visibilityHandler);
      }

      return handle;
    }

    var handle = {
      start: start,
      disconnect: function() {
        if (visibilityHandler) {
          if (typeof document !== 'undefined' && document.removeEventListener) {
            document.removeEventListener('visibilitychange', visibilityHandler);
          }
        }
        if (domWatcher) { domWatcher.stop(); domWatcher = null; }
        if (urlMonitor) { urlMonitor.stop(); urlMonitor = null; }
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        hasPendingRebuild = false;
        rebuildInFlight = null;
        isExtensionContextValid = false;
        consecutiveFailures = 0;
        lastFailureTime = 0;
      },
      getPendingRebuild: function() { return hasPendingRebuild; },
      setPendingRebuild: function(val) {
        hasPendingRebuild = !!val;
        if (hasPendingRebuild) attemptRebuild();
      },
      resetCircuitBreaker: function() {
        consecutiveFailures = 0;
        lastFailureTime = 0;
      }
    };

    return handle;
  }
