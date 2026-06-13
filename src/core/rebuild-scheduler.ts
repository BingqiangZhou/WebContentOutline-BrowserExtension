
'use strict';

import { createDomWatcher } from './dom-watcher.js';
import { createUrlMonitor } from './url-monitor.js';
import { isContextInvalidatedError } from '../utils/core-utils.js';
import { invalidateChatbotCache, isStreaming, getChatbotContainerSelector } from '../utils/chatbot-detector.js';

  var DEBOUNCE_MS = 400;
  var STREAMING_DEBOUNCE_MS = 1200;
  var MAX_CONSECUTIVE_FAILURES = 5;
  // Once the breaker latches open it would stay open forever (the only reset
  // site, on a successful rebuild, is itself gated behind the breaker). A
  // half-open probe lets the page retry once per RECOVERY_MS so a transient
  // burst of failures doesn't permanently freeze the TOC on the same page.
  var BREAKER_RECOVERY_MS = 30000;
  // Maximum interval between the FIRST pending mutation and a rebuild. A pure
  // debounce resets on every mutation, so a continuous mutation stream (e.g. a
  // translate extension rewriting text nodes on a chatbot page, where the
  // injected sentinel selector has switched dom-watcher into broad mode) can
  // postpone rebuilds forever and freeze the TOC ("卡住"). The max-wait pins a
  // deadline to the first pending mutation so a rebuild always fires eventually.
  // Must exceed STREAMING_DEBOUNCE_MS so it only caps sustained storms.
  var MAX_REBUILD_WAIT_MS = 3000;

  /**
   * Get dynamic debounce interval: longer during streaming to reduce rebuild frequency.
   */
  function getDebounceMs() {
    if (isStreaming()) return STREAMING_DEBOUNCE_MS;
    return DEBOUNCE_MS;
  }

  /**
   * Creates a rebuild scheduler that coordinates DOM watching, URL monitoring,
   * and rebuild dispatch with simple debouncing and circuit breaker.
   *
   * @param {function} onRebuild - Async function called to perform a TOC rebuild.
   * @param {object} [opts] - Options.
   * @param {function} [opts.onConfigDirty] - Called when a URL change is detected.
   * @returns {object} handle with start(cfg), disconnect(), getPendingRebuild(), setPendingRebuild()
   */
export function createRebuildScheduler(onRebuild: () => Promise<boolean | void>, opts: { onConfigDirty?: () => void; navLock?: { isLocked: () => boolean } }) {
    opts = opts || {};
    var onConfigDirty: (() => void) | null = typeof opts.onConfigDirty === 'function' ? opts.onConfigDirty : null;
    var navLock = opts.navLock;
    var isExtensionContextValid = true;
    var hasPendingRebuild = false;
    var rebuildInFlight: Promise<boolean | void> | null = null;
    var debounceTimer: ReturnType<typeof setTimeout> | null = null;
    // Pinned max-wait timer (lodash maxWait semantics): armed on the first
    // pending mutation and NOT reset by later mutations, so a sustained mutation
    // burst still produces a rebuild within MAX_REBUILD_WAIT_MS.
    var maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
    var consecutiveFailures = 0;
    var lastTripAt = 0;
    var recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    var visibilityHandler: (() => void) | null = null;

    // Breaker is "tripped" only while latched open AND inside the recovery
    // window. Outside the window a probe is allowed through (safeRebuild resets
    // the counter on success, or refreshes the window on another failure).
    function isBreakerTripped() {
      if (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) return false;
      return Date.now() - lastTripAt < BREAKER_RECOVERY_MS;
    }

    // Clear the active recovery probe timer (called whenever the breaker resets
    // or the scheduler tears down).
    function clearRecoveryTimer() {
      if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
    }

    // Arm a one-shot recovery probe so a page that goes quiet after a transient
    // failure burst still retries — without depending on an external mutation
    // or navigation arriving.
    function armRecoveryProbeIfTripped() {
      if (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) return;
      if (recoveryTimer) return;
      recoveryTimer = setTimeout(function() {
        recoveryTimer = null;
        if (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) return;
        hasPendingRebuild = true;
        attemptRebuild();
      }, BREAKER_RECOVERY_MS);
    }

    // Sub-components
    var domWatcher: ReturnType<typeof createDomWatcher> | null = null;
    var urlMonitor: ReturnType<typeof createUrlMonitor> | null = null;

    var safeRebuild = async function(): Promise<boolean> {
      if (!isExtensionContextValid) return false;
      if (isBreakerTripped()) return false;
      try {
        await onRebuild();
        consecutiveFailures = 0;
        clearRecoveryTimer();
        return true;
      } catch (e) {
        if (isContextInvalidatedError(e)) {
          isExtensionContextValid = false;
          hasPendingRebuild = false;
          consecutiveFailures = 0;
          lastTripAt = 0;
          clearRecoveryTimer();
          clearScheduledTimers();
          if (domWatcher) domWatcher.invalidate();
          if (urlMonitor) urlMonitor.invalidate();
          return false;
        }
        console.warn('[toc] rebuild failed:', e);
        consecutiveFailures++;
        // Start/refresh the recovery window so a half-open probe is allowed
        // through BREAKER_RECOVERY_MS later.
        lastTripAt = Date.now();
        armRecoveryProbeIfTripped();
        return false;
      }
    };

    var attemptRebuild = async function(): Promise<boolean | void> {
      if (!isExtensionContextValid) return false;
      if (rebuildInFlight) {
        hasPendingRebuild = true;
        return rebuildInFlight;
      }
      if (navLock && navLock.isLocked()) {
        hasPendingRebuild = true;
        return false;
      }
      if (!hasPendingRebuild) return true;

      hasPendingRebuild = false;
      rebuildInFlight = (async (): Promise<boolean> => {
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

    // Clear both the debounce and the pinned max-wait timers.
    function clearScheduledTimers() {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }
    }

    // Shared body for the debounce/max-wait timers: clear any sibling timer,
    // mark a rebuild pending, and dispatch it.
    function runScheduledRebuild() {
      clearScheduledTimers();
      hasPendingRebuild = true;
      attemptRebuild();
    }

    var scheduleRebuild = function(immediate?: boolean) {
      if (!isExtensionContextValid) return;
      if (isBreakerTripped()) return;
      if (document.hidden) { hasPendingRebuild = true; return; }
      if (immediate) {
        clearScheduledTimers();
        hasPendingRebuild = true;
        attemptRebuild();
        return;
      }
      // Coalesce a mutation burst: reset the debounce on each mutation so a
      // burst that settles fires a single rebuild.
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        debounceTimer = null;
        runScheduledRebuild();
      }, getDebounceMs());
      // Pin a max-wait deadline to the FIRST pending mutation. Without this a
      // continuous mutation stream resets the debounce forever and the TOC
      // freezes on its last-rendered state. Only arm when not already armed so
      // the deadline does not slide with later mutations.
      if (!maxWaitTimer) {
        maxWaitTimer = setTimeout(function() {
          maxWaitTimer = null;
          runScheduledRebuild();
        }, MAX_REBUILD_WAIT_MS);
      }
    };

    var onMutation = function() {
      scheduleRebuild(false);
    };

    var onUrlChange = function(immediate: boolean) {
      if (onConfigDirty) onConfigDirty();
      // Invalidate chatbot detection cache on URL change so new pages get re-detected
      invalidateChatbotCache();
      // The page may have switched between chatbot and non-chatbot contexts;
      // recompute the watcher scope so mutations aren't filtered by a stale
      // chatbot container selector (or left unscoped after leaving a chat page).
      try {
        var nextScope = getChatbotContainerSelector() || null;
        if (domWatcher && domWatcher.updateScope) domWatcher.updateScope(nextScope);
      } catch (_) {}
      // A navigation is a fresh page context — give the breaker an immediate
      // chance to recover instead of staying latched from the previous route.
      consecutiveFailures = 0;
      lastTripAt = 0;
      clearRecoveryTimer();
      scheduleRebuild(immediate);
    };

    function start(cfg: { selectors?: Array<{ type: string; expr: string }> }) {
      // Stop any previous instance
      handle.disconnect();
      hasPendingRebuild = false;
      isExtensionContextValid = true;
      consecutiveFailures = 0;
      lastTripAt = 0;
      clearRecoveryTimer();

      // Create dom-watcher with optional scope selector for chatbot pages
      var scopeSelector: string | null = getChatbotContainerSelector() || null;
      domWatcher = createDomWatcher(onMutation, {
        selectors: cfg.selectors,
        scopeSelector: scopeSelector,
      });
      var watcherOk = domWatcher.start();

      // Create url-monitor
      var capturedDomWatcher = domWatcher;
      urlMonitor = createUrlMonitor({
        checkAndReconnect: capturedDomWatcher
          ? function() { capturedDomWatcher.checkAndReconnect(); }
          : undefined
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
      document.addEventListener('visibilitychange', visibilityHandler);

      return handle;
    }

    var handle = {
      start: start,
      disconnect: function() {
        if (visibilityHandler) {
          document.removeEventListener('visibilitychange', visibilityHandler);
        }
        if (domWatcher) { domWatcher.stop(); domWatcher = null; }
        if (urlMonitor) { urlMonitor.stop(); urlMonitor = null; }
        clearScheduledTimers();
        clearRecoveryTimer();
        hasPendingRebuild = false;
        rebuildInFlight = null;
        isExtensionContextValid = false;
        consecutiveFailures = 0;
        lastTripAt = 0;
      },
      getPendingRebuild: function() { return hasPendingRebuild; },
      setPendingRebuild: function(val: boolean) {
        hasPendingRebuild = !!val;
        if (hasPendingRebuild) attemptRebuild();
      }
    };

    return handle;
  }
