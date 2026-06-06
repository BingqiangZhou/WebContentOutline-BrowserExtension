
import {
  msg,
  getConfigs,
  findMatchingConfig,
  getSiteEnabledByOrigin,
  getPanelExpandedByOrigin,
  getUiMode,
  saveUiMode,
  normalizeUiMode,
  isContextInvalidatedError,
  cleanupOwnedElements,
  STORAGE_KEYS
} from './utils/toc-utils.js';
import { initForConfig } from './core/toc-app.js';
import { renderStandbyDock } from './ui/standby-dock.js';

interface TocAppInstance {
  destroy?: () => void;
  expand?: (opts?: any) => Promise<void>;
  collapse?: () => void;
  refreshConfig?: () => Promise<void>;
}

interface StandbyDockInstance {
  destroy?: () => void;
  getSide?: () => string;
}

export function startTocContent(ctx: any) {
  void ctx;
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

  var appInstance: TocAppInstance | null = null;
  var standbyInstance: StandbyDockInstance | null = null;
  var currentEnabled = false;
  var currentUiMode = 'edge-dock';
  var disposed = false;
  var listenersAttached = false;

  var messageListener: ((msgObj: any, sender: any, sendResponse: (response?: any) => void) => boolean | void) | null = null;
  var storageListener: ((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void) | null = null;

  function detachListeners() {
    if (!listenersAttached) return;
    listenersAttached = false;
    try {
      if (messageListener && hasChrome && chrome.runtime?.onMessage?.removeListener) {
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    } catch (_) {}
    try {
      if (storageListener && hasChrome && chrome.storage?.onChanged?.removeListener) {
        chrome.storage.onChanged.removeListener(storageListener);
      }
    } catch (_) {}
    messageListener = null;
    storageListener = null;
  }

  function dispose(opts?: { reason?: string }) {
    if (disposed) return;
    disposed = true;
    currentEnabled = false;
    detachListeners();
    try { if (appInstance?.destroy) appInstance.destroy(); } catch (_) {}
    appInstance = null;
    try { if (standbyInstance?.destroy) standbyInstance.destroy(); } catch (_) {}
    standbyInstance = null;
    if (cleanupOwnedElements) cleanupOwnedElements(undefined as any);
    window.__TOC_ASSISTANT_LOADED__ = false;
    window.__TOC_ASSISTANT_CLEANUP__ = undefined;
    if (opts?.reason) console.debug(msg('logPrefix') + ' disposed:', opts.reason);
  }

  // Expose a cleanup hook for dev reload / reinjection.
  window.__TOC_ASSISTANT_CLEANUP__ = dispose;

  function getDefaultConfig() {
    return {
      urlPattern: location.protocol + '//' + location.host + '/*',
      side: 'right',
      selectors: [] as Array<{ type: string; expr: string }>
    };
  }

  async function startApp() {
    try {
      if (disposed) return;
      var results = await Promise.all([getConfigs(), getUiMode ? getUiMode() : 'edge-dock']);
      var configs = results[0];
      currentUiMode = normalizeUiMode ? normalizeUiMode(results[1]) : 'edge-dock';
      if (disposed) return;
      var cfg = findMatchingConfig(configs, location.href);
      if (!cfg) {
        cfg = getDefaultConfig();
        console.debug(msg('logPrefix') + ' ' + msg('logNoConfigFound'));
      } else {
        console.debug(msg('logPrefix') + ' ' + msg('logConfigMatched'), cfg.urlPattern);
      }
      appInstance = initForConfig(cfg, {
        uiMode: currentUiMode,
        onSwitchUiMode: applyUiMode,
        onDeactivate: function() { toggleActive().catch(function() {}); }
      }) as TocAppInstance | null;
    } catch (err) {
      if (isContextInvalidatedError && isContextInvalidatedError(err)) {
        dispose({ reason: 'context-invalidated' });
        return;
      }
      console.error(msg('logPrefix') + ' ' + msg('logInitFailed'), err);
    }
  }

  function stopApp() {
    try { if (appInstance?.destroy) appInstance.destroy(); } catch (_) {}
    appInstance = null;
    if (cleanupOwnedElements) cleanupOwnedElements(undefined as any);
  }

  function destroyStandby() {
    try { if (standbyInstance?.destroy) standbyInstance.destroy(); } catch (_) {}
    standbyInstance = null;
  }

  function renderStandby() {
    var lastSide = 'right';
    try {
      if (standbyInstance?.getSide) lastSide = standbyInstance.getSide() || 'right';
    } catch (_) {}
    destroyStandby();
    standbyInstance = renderStandbyDock({
      side: lastSide,
      onActivate: function() { toggleActive().catch(function() {}); }
    });
  }

  var togglePromise: Promise<void> | null = null;

  async function toggleActive() {
    if (togglePromise) return togglePromise;
    togglePromise = (async () => {
      try {
        var nextEnabled = !currentEnabled;
        // Persist to storage via background
        try {
          if (hasChrome && chrome.runtime?.sendMessage) {
            await new Promise<void>(function(resolve) {
              chrome.runtime.sendMessage(
                { type: 'toc:persistActiveState', enabled: nextEnabled, origin: location.origin },
                function() { void chrome.runtime.lastError; resolve(); }
              );
            });
          }
        } catch (_) {}
        await applyEnabledState(nextEnabled);
      } finally {
        togglePromise = null;
      }
    })();
    return togglePromise;
  }

  async function applyUiMode(nextMode: string, opts?: { persist?: boolean }) {
    opts = opts || {};
    var normalized = normalizeUiMode ? normalizeUiMode(nextMode) : 'edge-dock';
    if (normalized === currentUiMode && appInstance) return;
    currentUiMode = normalized;
    if (opts.persist !== false && saveUiMode) await saveUiMode(normalized);
    if (!currentEnabled || disposed) return;
    try { if (appInstance?.destroy) appInstance.destroy(); } catch (_) {}
    appInstance = null;
    if (cleanupOwnedElements) cleanupOwnedElements(undefined as any);
    await startApp();
    await applyExpandState({});
  }

  async function applyExpandState(opts?: { expandPanel?: boolean }) {
    if (!appInstance) return;
    try {
      if (opts?.expandPanel) {
        if (appInstance.expand) await appInstance.expand({ autoCollapse: currentUiMode !== 'classic' });
      } else if (currentUiMode !== 'classic') {
        if (appInstance.collapse) appInstance.collapse();
      } else {
        var expanded = getPanelExpandedByOrigin ? await getPanelExpandedByOrigin(undefined as any) : false;
        if (expanded && appInstance.expand) await appInstance.expand();
        else if (appInstance.collapse) appInstance.collapse();
      }
    } catch (_) {}
  }

  async function applyEnabledState(want: boolean, opts?: { expandPanel?: boolean }) {
    if (want === currentEnabled) {
      if (want && opts?.expandPanel && appInstance) {
        await applyExpandState(opts);
      }
      return;
    }
    currentEnabled = want;
    if (!want) {
      // Transition to STANDBY: destroy TOC app, show standby dock
      stopApp();
      renderStandby();
      return;
    }
    // Transition to ACTIVE: destroy standby dock, start TOC app
    destroyStandby();
    await startApp();
    await applyExpandState(opts);
  }

  async function main() {
    if (disposed) return;
    console.debug(msg('logPrefix') + ' ' + msg('logContentScriptStarted'), location.href);
    try {
      await new Promise<void>(function(resolve) {
        try {
          chrome.runtime.sendMessage({ type: 'toc:ensureIcon' }, function() { void chrome.runtime.lastError; resolve(); });
        } catch (_) { resolve(); }
      });
      var enabled = await getSiteEnabledByOrigin(undefined as any);
      if (enabled) {
        await applyEnabledState(true, undefined as any);
      } else {
        // STANDBY mode: render the dim standby dock icon
        console.debug(msg('logPrefix') + ' ' + msg('logSiteDisabled'));
        renderStandby();
        currentEnabled = false;
      }
    } catch (e) {
      if (isContextInvalidatedError && isContextInvalidatedError(e)) {
        dispose({ reason: 'context-invalidated' });
        return;
      }
      console.warn(msg('logPrefix') + ' ' + msg('logReadEnabledFailed'), e);
      // Even on error, render standby dock
      renderStandby();
    }
  }

  function attachListeners() {
    if (listenersAttached || disposed) return;
    listenersAttached = true;

    try {
      messageListener = function(msgObj: any, sender: any, sendResponse: (response?: any) => void) {
        var responded = false;
        var respondOnce = function(payload: any) {
          if (responded) return;
          responded = true;
          try { sendResponse && sendResponse(payload); } catch (_) {}
        };
        try {
          if (!msgObj?.type) return;
          if (sender?.id && chrome.runtime?.id && sender.id !== chrome.runtime.id) {
            respondOnce({ ok: false, reason: 'bad-sender' });
            return;
          }
          if (msgObj.type === 'toc:ping') {
            respondOnce({ ok: !disposed });
            return;
          }
          if (disposed) { respondOnce({ ok: false, disposed: true }); return; }

          if (msgObj.type === 'toc:openPanel') {
            (async function() {
              try {
                await applyEnabledState(true, { expandPanel: true });
                respondOnce({ ok: true });
              } catch (err) {
                respondOnce({ ok: false, error: String(err) });
              }
            })();
            return true;
          }

          // Toolbar icon click or cross-tab sync toggles active state
          if (msgObj.type === 'toc:toggleActive') {
            (async function() {
              try {
                await toggleActive();
                respondOnce({ ok: true });
              } catch (err) {
                respondOnce({ ok: false, error: String(err) });
              }
            })();
            return true;
          }

          // Cross-tab sync: background tells us the new enabled state
          if (msgObj.type === 'toc:updateEnabled') {
            var enabled = !!msgObj.enabled;
            if (enabled === currentEnabled) { respondOnce({ ok: true, unchanged: true }); return; }
            (async function() {
              try {
                await applyEnabledState(enabled, undefined as any);
                respondOnce({ ok: true });
              } catch (err) {
                respondOnce({ ok: false, error: String(err) });
              }
            })();
            return true;
          }
        } catch (err) {
          respondOnce({ ok: false, error: String(err) });
          if (isContextInvalidatedError && isContextInvalidatedError(err)) dispose({ reason: 'context-invalidated' });
        }
      };
      if (hasChrome && chrome.runtime?.onMessage?.addListener) {
        chrome.runtime.onMessage.addListener(messageListener);
      }
    } catch (_) {}

    try {
      var UI_MODE_KEY = STORAGE_KEYS?.UI_MODE || 'tocUiMode';
      var TOC_CONFIGS_KEY = STORAGE_KEYS?.TOC_CONFIGS || 'tocConfigs';
      storageListener = function(changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) {
        if (disposed || areaName !== 'local') return;
        var uiModeChange = changes?.[UI_MODE_KEY];
        if (uiModeChange) applyUiMode(uiModeChange.newValue as any, { persist: false }).catch(function() {});
        var configChange = changes?.[TOC_CONFIGS_KEY];
        if (configChange && currentEnabled && appInstance?.refreshConfig) {
          Promise.resolve(appInstance.refreshConfig()).catch(function() {});
        }
      };
      if (hasChrome && chrome.storage?.onChanged?.addListener) {
        chrome.storage.onChanged.addListener(storageListener);
      }
    } catch (_) {}
  }

  attachListeners();

  // Wait for DOM to be stable before initializing TOC
  async function initWhenStable() {
    if (document.readyState === 'loading') {
      await new Promise<void>(function(r: () => void) { document.addEventListener('DOMContentLoaded', r, { once: true }); });
    }
    await new Promise<void>(function(r: () => void) { setTimeout(r, 50); });
    await main();
  }

  initWhenStable();
}
