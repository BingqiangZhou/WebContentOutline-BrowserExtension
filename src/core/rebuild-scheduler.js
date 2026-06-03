'use strict';

import { createDomWatcher } from './dom-watcher.js';
import { createUrlMonitor } from './url-monitor.js';
import * as NL from './nav-lock.js';
import { isContextInvalidatedError } from '../utils/core-utils.js';

  var DEBOUNCE_MS = 400;

  /**
   * Creates a rebuild scheduler that coordinates DOM watching, URL monitoring,
   * and rebuild dispatch with simple debouncing.
   *
   * @param {function} onRebuild - Async function called to perform a TOC rebuild.
   * @returns {object} handle with start(cfg), disconnect(), getPendingRebuild(), setPendingRebuild()
   */
export function createRebuildScheduler(onRebuild) {
    var isExtensionContextValid = true;
    var hasPendingRebuild = false;
    var rebuildInFlight = null;
    var debounceTimer = null;

    // Sub-components
    var domWatcher = null;
    var urlMonitor = null;
    var activeCfg = null;

    var safeRebuild = function() {
      if (!isExtensionContextValid) return Promise.resolve(false);
      return onRebuild().then(function() {
        return true;
      }).catch(function(e) {
        if (isContextInvalidatedError(e)) {
          isExtensionContextValid = false;
          hasPendingRebuild = false;
          if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
          if (domWatcher) domWatcher.invalidate();
          if (urlMonitor) urlMonitor.invalidate();
          return false;
        }
        console.warn('[toc] rebuild failed:', e);
        return false;
      });
    };

    var attemptRebuild = function() {
      if (!isExtensionContextValid) return Promise.resolve(false);
      if (rebuildInFlight) {
        hasPendingRebuild = true;
        return rebuildInFlight;
      }
      if (NL.isLocked()) {
        hasPendingRebuild = true;
        return Promise.resolve(false);
      }
      if (!hasPendingRebuild) return Promise.resolve(true);

      hasPendingRebuild = false;
      rebuildInFlight = safeRebuild().then(function(ok) {
        rebuildInFlight = null;
        if (!ok && isExtensionContextValid) {
          hasPendingRebuild = true;
        }
        return !!ok;
      }, function() {
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
      if (activeCfg && typeof activeCfg.__markConfigDirty === 'function') activeCfg.__markConfigDirty();
      scheduleRebuild(immediate);
    };

    function start(cfg) {
      // Stop any previous instance
      handle.disconnect();
      hasPendingRebuild = false;
      isExtensionContextValid = true;
      activeCfg = cfg || null;

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

      return handle;
    }

    var handle = {
      start: start,
      disconnect: function() {
        if (domWatcher) { domWatcher.stop(); domWatcher = null; }
        if (urlMonitor) { urlMonitor.stop(); urlMonitor = null; }
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        hasPendingRebuild = false;
        rebuildInFlight = null;
        isExtensionContextValid = false;
        activeCfg = null;
      },
      getPendingRebuild: function() { return hasPendingRebuild; },
      setPendingRebuild: function(val) {
        hasPendingRebuild = !!val;
        if (hasPendingRebuild) attemptRebuild();
      }
    };

    return handle;
  }
