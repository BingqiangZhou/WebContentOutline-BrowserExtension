
'use strict';

import { createDomWatcher } from './dom-watcher.js';
import { createUrlMonitor } from './url-monitor.js';
import { isContextInvalidatedError } from '../utils/core-utils.js';
import { invalidateChatbotCache, isStreaming, getChatbotContainerSelector } from '../utils/chatbot-detector.js';

  var DEBOUNCE_MS = 400;
  var STREAMING_DEBOUNCE_MS = 1200;
  var MAX_CONSECUTIVE_FAILURES = 5;

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
export function createRebuildScheduler(onRebuild: () => Promise<boolean>, opts: { onConfigDirty?: () => void; navLock?: { isLocked: () => boolean } }) {
    opts = opts || {};
    var onConfigDirty: (() => void) | null = typeof opts.onConfigDirty === 'function' ? opts.onConfigDirty : null;
    var navLock = opts.navLock;
    var isExtensionContextValid = true;
    var hasPendingRebuild = false;
    var rebuildInFlight: Promise<boolean | void> | null = null;
    var debounceTimer: ReturnType<typeof setTimeout> | null = null;
    var consecutiveFailures = 0;
    var visibilityHandler: (() => void) | null = null;

    // Sub-components
    var domWatcher: ReturnType<typeof createDomWatcher> | null = null;
    var urlMonitor: ReturnType<typeof createUrlMonitor> | null = null;

    var safeRebuild = async function(): Promise<boolean> {
      if (!isExtensionContextValid) return false;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return false;
      try {
        await onRebuild();
        consecutiveFailures = 0;
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

    var scheduleRebuild = function(immediate?: boolean) {
      if (!isExtensionContextValid) return;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
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
      }, getDebounceMs());
    };

    var onMutation = function() {
      scheduleRebuild(false);
    };

    var onUrlChange = function(immediate: boolean) {
      if (onConfigDirty) onConfigDirty();
      // Invalidate chatbot detection cache on URL change so new pages get re-detected
      invalidateChatbotCache();
      scheduleRebuild(immediate);
    };

    function start(cfg: { selectors?: Array<{ type: string; expr: string }> }) {
      // Stop any previous instance
      handle.disconnect();
      hasPendingRebuild = false;
      isExtensionContextValid = true;
      consecutiveFailures = 0;

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
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        hasPendingRebuild = false;
        rebuildInFlight = null;
        isExtensionContextValid = false;
        consecutiveFailures = 0;
      },
      getPendingRebuild: function() { return hasPendingRebuild; },
      setPendingRebuild: function(val: boolean) {
        hasPendingRebuild = !!val;
        if (hasPendingRebuild) attemptRebuild();
      }
    };

    return handle;
  }
