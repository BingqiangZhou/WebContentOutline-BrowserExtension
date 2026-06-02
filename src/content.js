import {
  msg,
  getConfigs,
  findMatchingConfig,
  getSiteEnabledByOrigin,
  getPanelExpandedByOrigin,
  getUiMode,
  saveUiMode,
  normalizeUiMode,
  getBadgePosByHost,
  setBadgePosByHost,
  isContextInvalidatedError,
  cleanupOwnedElements,
  safeJsonParse,
  isPlainObject,
  getFiniteNumber,
  uiConst,
  STORAGE_KEYS
} from './utils/toc-utils.js';
import { initForConfig } from './core/toc-app.js';

(function() {
  'use strict';

  // If the script is injected again (dev reload / reinjection), dispose the previous instance first.
  try {
    if (typeof window.__TOC_ASSISTANT_CLEANUP__ === 'function') {
      window.__TOC_ASSISTANT_CLEANUP__({ reason: 'reinjected' });
    }
  } catch (_) {}

  if (window.__TOC_ASSISTANT_LOADED__) return;
  window.__TOC_ASSISTANT_LOADED__ = true;

  if (!getConfigs || !initForConfig || !getSiteEnabledByOrigin) {
    console.error(msg('logPrefix') + ' ' + msg('logMissingDependencies'));
    return;
  }

  var hasChrome = (typeof chrome !== 'undefined');

  var appInstance = null;
  var currentEnabled = false;
  var desiredEnabled = false;
  var enabledTransition = Promise.resolve();
  var uiModeTransition = Promise.resolve();
  var currentUiMode = 'edge-dock';
  var startInFlight = null;
  var disposed = false;
  var listenersAttached = false;

  var messageListener = null;
  var storageListener = null;

  function detachListeners() {
    if (!listenersAttached) return;
    listenersAttached = false;
    try {
      if (messageListener && hasChrome && chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.removeListener) {
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    } catch (_) {}
    try {
      if (storageListener && hasChrome && chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.removeListener) {
        chrome.storage.onChanged.removeListener(storageListener);
      }
    } catch (_) {}
    messageListener = null;
    storageListener = null;

  }

  function dispose(opts) {
    opts = opts || {};
    if (disposed) return;
    disposed = true;

    // Cancel queued transitions and in-flight startup.
    enabledTransition = Promise.resolve();
    startInFlight = null;

    // Remove listeners first to prevent re-entry during teardown.
    detachListeners();

    // Ensure UI/app is fully removed.
    try {
      if (appInstance && appInstance.destroy) {
        appInstance.destroy();
      }
    } catch (_) {}
    appInstance = null;
    if (cleanupOwnedElements) cleanupOwnedElements();

    // Allow reinjection to reinitialize cleanly.
    try { window.__TOC_ASSISTANT_LOADED__ = false; } catch (_) {}
    try { window.__TOC_ASSISTANT_CLEANUP__ = null; } catch (_) {}
    try { delete window.__TOC_ASSISTANT_CLEANUP__; } catch (_) {}

    if (opts && opts.reason) {
      console.debug(msg('logPrefix') + ' disposed:', opts.reason);
    }
  }

  // Expose a best-effort cleanup hook (useful for dev reload / reinjection).
  try { window.__TOC_ASSISTANT_CLEANUP__ = dispose; } catch (_) {}

  async function migrateLegacyBadgePos() {
    try {
      if (!setBadgePosByHost) return;
      var legacyKey = 'tocBadgePos::' + location.host;
      var lockKey = legacyKey + '::migrating';
      var raw = localStorage.getItem(legacyKey);
      if (!raw) return;
      var parsed = safeJsonParse ? safeJsonParse(raw) : null;
      var hasOwn = function(obj, key) { return !!(obj && Object.prototype.hasOwnProperty.call(obj, key)); };
      if (isPlainObject && isPlainObject(parsed) && hasOwn(parsed, 'left') && hasOwn(parsed, 'top')) {
        var left = getFiniteNumber ? getFiniteNumber(parsed.left) : (typeof parsed.left === 'number' ? parsed.left : null);
        var top = getFiniteNumber ? getFiniteNumber(parsed.top) : (typeof parsed.top === 'number' ? parsed.top : null);
        if (left === null || top === null) return;

        // Best-effort cross-tab coordination to avoid two tabs migrating at the same time.
        var token = Date.now() + ':' + Math.random().toString(36).slice(2);
        var electedLeader = false;
        var storageLockAcquired = false;

        // Prefer BroadcastChannel election when available (reduces last-writer-wins races across tabs).
        if (typeof BroadcastChannel === 'function') {
          var bc = null;
          var isLeader = false;
          var channelName = 'tocBadgePosMigrate::' + location.host;
          var seen = new Set([token]);
          var onMsg = function(ev) {
            try {
              var data = ev && ev.data;
              if (!data || data.type !== 'claim' || !data.token) return;
              seen.add(String(data.token));
            } catch (_) {}
          };
          try {
            bc = new BroadcastChannel(channelName);
            bc.addEventListener('message', onMsg);
            try { bc.postMessage({ type: 'claim', token: token }); } catch (_) {}
            await new Promise(function(r) { setTimeout(r, 120); });
            var leader = Array.from(seen).sort()[0];
            isLeader = (leader === token);
          } catch (_) {}
          finally {
            if (bc) {
              try { bc.removeEventListener('message', onMsg); } catch (_) {}
              try { bc.close(); } catch (_) {}
            }
          }
          if (!isLeader) return;
          electedLeader = true;
        }

        // Fallback: localStorage lock with TTL.
        if (!electedLeader) {
          try {
            var lockRaw = localStorage.getItem(lockKey);
            var lock = safeJsonParse ? safeJsonParse(lockRaw || '') : null;
            var lockTs = lock && typeof lock.ts === 'number' ? lock.ts : 0;
            var stale = !lockTs || (Date.now() - lockTs) > 15000;
            if (!stale && lock && lock.token) return;
            localStorage.setItem(lockKey, JSON.stringify({ token: token, ts: Date.now() }));
            var confirm = safeJsonParse ? safeJsonParse(localStorage.getItem(lockKey) || '') : null;
            if (!confirm || confirm.token !== token) return;
            storageLockAcquired = true;
          } catch (_) {}
        }

        try {
          // Another tab may have migrated while we were electing/locking.
          try {
            var stillThere = localStorage.getItem(legacyKey);
            if (!stillThere) return;
          } catch (_) {}
          var existing = getBadgePosByHost ? await getBadgePosByHost(location.host) : null;
          if (existing && Number.isFinite(existing.x) && Number.isFinite(existing.y)) {
            localStorage.removeItem(legacyKey);
            return;
          }

          var bw = (typeof uiConst === 'function') ? uiConst('BADGE_WIDTH', 80) : 80;
          var bh = (typeof uiConst === 'function') ? uiConst('BADGE_HEIGHT', 32) : 32;
          var x = left + bw / 2;
          var y = top + bh / 2;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;

          var saved = await setBadgePosByHost(location.host, { x: x, y: y, updatedAt: Date.now() });
          if (saved) {
            try {
              var after = getBadgePosByHost ? await getBadgePosByHost(location.host) : null;
              if (after && Number.isFinite(after.x) && Number.isFinite(after.y)) {
                localStorage.removeItem(legacyKey);
              }
            } catch (_) {}
          }
        } finally {
          if (storageLockAcquired) {
            try { localStorage.removeItem(lockKey); } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }

  async function startApp() {
    try {
      if (disposed) return;
      var results = await Promise.all([
        getConfigs(),
        getUiMode ? getUiMode() : 'edge-dock'
      ]);
      var configs = results[0];
      currentUiMode = normalizeUiMode ? normalizeUiMode(results[1]) : (results[1] === 'classic' ? 'classic' : 'edge-dock');
      if (disposed) return;
      var cfg = findMatchingConfig(configs, location.href);
      if (!cfg) {
        cfg = {
          urlPattern: location.protocol + '//' + location.host + '/*',
          side: 'right',
          selectors: [],
          collapsedDefault: false
        };
        console.debug(msg('logPrefix') + ' ' + msg('logNoConfigFound'));
      } else {
        console.debug(msg('logPrefix') + ' ' + msg('logConfigMatched'), cfg.urlPattern);
      }
      appInstance = initForConfig(cfg, {
        uiMode: currentUiMode,
        onSwitchUiMode: requestUiMode
      });
    } catch (err) {
      if (isContextInvalidatedError && isContextInvalidatedError(err)) {
        dispose({ reason: 'context-invalidated' });
        return;
      }
      console.error(msg('logPrefix') + ' ' + msg('logInitFailed'), err);
    }
  }

  async function ensureStarted() {
    if (disposed) return;
    if (appInstance) return;
    if (startInFlight) {
      try { await startInFlight; } catch (_) {}
      return;
    }
    startInFlight = (async function() { await startApp(); })();
    try {
      await startInFlight;
    } finally {
      startInFlight = null;
    }
  }

  function stopApp() {
    try {
      if (appInstance && appInstance.destroy) {
        appInstance.destroy();
      }
    } catch (e) {
      console.warn(msg('logPrefix') + ' stop failed:', e);
    }
    appInstance = null;
    try {
      if (cleanupOwnedElements) cleanupOwnedElements();
    } catch (e) {
      console.warn(msg('logPrefix') + ' cleanup DOM failed:', e);
    }

    // Content script should stop reacting after app is stopped to avoid unexpected reinitialization.
    dispose({ reason: 'stopApp' });
  }

  function destroyCurrentApp() {
    try {
      if (appInstance && appInstance.destroy) appInstance.destroy();
    } catch (e) {
      console.warn(msg('logPrefix') + ' restart cleanup failed:', e);
    }
    appInstance = null;
    try { if (cleanupOwnedElements) cleanupOwnedElements(); } catch (_) {}
  }

  async function applyUiMode(nextMode, opts) {
    opts = opts || {};
    var normalized = normalizeUiMode ? normalizeUiMode(nextMode) : (nextMode === 'classic' ? 'classic' : 'edge-dock');
    if (normalized === currentUiMode && appInstance) return;
    currentUiMode = normalized;
    if (opts.persist !== false && saveUiMode) await saveUiMode(normalized);
    if (!currentEnabled || disposed) return;
    destroyCurrentApp();
    startInFlight = null;
    await ensureStarted();
    await applyExpandState({});
  }

  function requestUiMode(nextMode, opts) {
    if (disposed) return Promise.resolve();
    uiModeTransition = uiModeTransition
      .catch(function() {})
      .then(function() { return applyUiMode(nextMode, opts || {}); })
      .catch(function(e) {
        console.warn(msg('logPrefix') + ' ui mode transition failed:', e);
      });
    return uiModeTransition;
  }

  async function applyExpandState(opts) {
    if (!appInstance) return;
    try {
      if (opts && opts.expandPanel) {
        if (appInstance.expand) await appInstance.expand();
      } else {
        var expanded = getPanelExpandedByOrigin ? await getPanelExpandedByOrigin() : false;
        if (expanded && appInstance.expand) {
          await appInstance.expand();
        } else if (appInstance.collapse) {
          appInstance.collapse();
        }
      }
    } catch (_) {}
  }

  async function applyEnabledState(want, opts) {
      if (want === currentEnabled) {
        // Even when the enabled state doesn't change, callers may request an expand.
        if (want) {
          await ensureStarted();
          await applyExpandState(opts);
        }
        return;
      }

      currentEnabled = want;
      if (!want) {
        stopApp();
        return;
      }

      await ensureStarted();
      await applyExpandState(opts);
  }

  function requestEnabled(enabled, opts) {
    if (disposed) return Promise.resolve();
    desiredEnabled = !!enabled;
    enabledTransition = enabledTransition
      .catch(function() {})
      .then(function() {
        return applyEnabledState(desiredEnabled, opts || {});
      })
      .catch(function(e) {
        console.warn(msg('logPrefix') + ' enabled transition failed:', e);
      });
    return enabledTransition;
  }

  async function main() {
    if (disposed) return;
    console.debug(msg('logPrefix') + ' ' + msg('logContentScriptStarted'), location.href);
    try {
      await migrateLegacyBadgePos();
      await new Promise(function(resolve) {
        try {
          chrome.runtime.sendMessage({ type: 'toc:ensureIcon' }, function() { void chrome.runtime.lastError; resolve(); });
        } catch (_) { resolve(); }
      });

      var enabled = await getSiteEnabledByOrigin();
      if (!!enabled) {
        await requestEnabled(true);
      } else {
        console.debug(msg('logPrefix') + ' ' + msg('logSiteDisabled'));
      }
    } catch (e) {
      if (isContextInvalidatedError && isContextInvalidatedError(e)) {
        dispose({ reason: 'context-invalidated' });
        return;
      }
      console.warn(msg('logPrefix') + ' ' + msg('logReadEnabledFailed'), e);
    }
  }

  function attachListeners() {
    if (listenersAttached || disposed) return;
    listenersAttached = true;

    try {
      messageListener = function(msgObj, sender, sendResponse) {
        var responded = false;
        var respondOnce = function(payload) {
          if (responded) return;
          responded = true;
          try { sendResponse && sendResponse(payload); } catch (_) {}
        };
        try {
          if (!msgObj || !msgObj.type) return;

          // Only accept messages from this extension instance.
          if (sender && sender.id && chrome.runtime && chrome.runtime.id && sender.id !== chrome.runtime.id) {
            respondOnce({ ok: false, reason: 'bad-sender' });
            return;
          }

          if (msgObj.type === 'toc:ping') {
            respondOnce({ ok: !disposed });
            return;
          }

          if (disposed) {
            respondOnce({ ok: false, disposed: true });
            return;
          }

          if (msgObj.type === 'toc:openPanel') {
            Promise.resolve()
              .then(function() { return requestEnabled(true, { expandPanel: true }); })
              .then(function() { respondOnce({ ok: true }); })
              .catch(function(err) { respondOnce({ ok: false, error: String(err) }); });
            return true;
          }

          if (msgObj.type !== 'toc:updateEnabled') return;
          var enabled = !!msgObj.enabled;
          if (enabled === desiredEnabled) {
            respondOnce({ ok: true, unchanged: true });
            return;
          }
          Promise.resolve()
            .then(function() { return requestEnabled(enabled); })
            .then(function() { respondOnce({ ok: true }); })
            .catch(function(err) { respondOnce({ ok: false, error: String(err) }); });
          return true;
        } catch (err) {
          respondOnce({ ok: false, error: String(err) });
          if (isContextInvalidatedError && isContextInvalidatedError(err)) dispose({ reason: 'context-invalidated' });
        }
      };
      if (hasChrome && chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
        chrome.runtime.onMessage.addListener(messageListener);
      }
    } catch (_) {}

    try {
      var KEY = STORAGE_KEYS && STORAGE_KEYS.SITE_ENABLE_MAP ? STORAGE_KEYS.SITE_ENABLE_MAP : 'tocSiteEnabledMap';
      var UI_MODE_KEY = STORAGE_KEYS && STORAGE_KEYS.UI_MODE ? STORAGE_KEYS.UI_MODE : 'tocUiMode';
      var TOC_CONFIGS_KEY = STORAGE_KEYS && STORAGE_KEYS.TOC_CONFIGS ? STORAGE_KEYS.TOC_CONFIGS : 'tocConfigs';
      storageListener = function(changes, areaName) {
        if (disposed) return;
        if (areaName !== 'local') return;
        var uiModeChange = changes && changes[UI_MODE_KEY];
        if (uiModeChange) {
          requestUiMode(uiModeChange.newValue, { persist: false });
        }
        var configChange = changes && changes[TOC_CONFIGS_KEY];
        if (configChange && currentEnabled && appInstance && appInstance.refreshConfig) {
          Promise.resolve(appInstance.refreshConfig()).catch(function(e) {
            console.warn(msg('logPrefix') + ' config refresh failed:', e);
          });
        }
        var ch = changes && changes[KEY];
        if (!ch) return;
        try {
          var map = ch.newValue || {};
          var originKey = (typeof location !== 'undefined' && typeof location.origin === 'string' && location.origin && location.origin !== 'null')
            ? location.origin
            : null;
          if (!originKey) return;
          var next = !!map[originKey];
          if (next === desiredEnabled) return;
          requestEnabled(next);
        } catch (e) {
          if (isContextInvalidatedError && isContextInvalidatedError(e)) {
            dispose({ reason: 'context-invalidated' });
            return;
          }
          console.warn(msg('logPrefix') + ' storage change failed:', e);
        }
      };
      if (hasChrome && chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
        chrome.storage.onChanged.addListener(storageListener);
      }
    } catch (e) {
      if (isContextInvalidatedError && isContextInvalidatedError(e)) {
        dispose({ reason: 'context-invalidated' });
      } else {
        console.warn(msg('logPrefix') + ' storage listener failed:', e);
      }
    }
  }

  attachListeners();

  // Wait for DOM to be stable before initializing TOC
  // This helps prevent layout issues on first load
  async function initWhenStable() {
    // If DOM is not fully loaded, wait for DOMContentLoaded
    if (document.readyState === 'loading') {
      await new Promise(function(r) { document.addEventListener('DOMContentLoaded', r, { once: true }); });
    }

    // Short delay to let page rendering stabilize
    // This ensures CSS is applied and layout is computed
    await new Promise(function(r) { setTimeout(r, 50); });

    // Now initialize TOC
    await main();
  }

  initWhenStable();
})();
