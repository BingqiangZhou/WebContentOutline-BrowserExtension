
import {
  msg,
  debug,
  getConfigs,
  findMatchingConfig,
  getSiteEnabledByOrigin,
  isContextInvalidatedError,
  cleanupOwnedElements,
  STORAGE_KEYS,
  buildSitePattern
} from './utils/toc-utils.js';
import { initForConfig } from './core/toc-app.js';
import { TOC_MESSAGE, type TocRequest } from './shared/messages.js';
import { getTocShadowRoot, disposeTocShadowRoot } from './ui/shadow-root.js';

interface TocAppInstance {
  destroy?: () => void;
  expand?: (opts?: any) => Promise<void>;
  collapse?: () => void;
  refreshConfig?: () => Promise<void>;
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

  var appInstance: TocAppInstance | null = null;
  var currentEnabled = false;
  var disposed = false;
  var listenersAttached = false;

  var messageListener: ((msgObj: TocRequest, sender: any, sendResponse: (response?: any) => void) => boolean | void) | null = null;
  var storageListener: ((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void) | null = null;

  function detachListeners() {
    if (!listenersAttached) return;
    listenersAttached = false;
    try {
      if (messageListener && chrome.runtime?.onMessage?.removeListener) {
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    } catch (_) {}
    try {
      if (storageListener && chrome.storage?.onChanged?.removeListener) {
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
    if (appInstance?.destroy) appInstance.destroy();
    appInstance = null;
    cleanupOwnedElements();
    disposeTocShadowRoot();
    window.__TOC_ASSISTANT_LOADED__ = false;
    window.__TOC_ASSISTANT_CLEANUP__ = undefined;
    if (opts?.reason) debug(msg('logPrefix') + ' disposed:', opts.reason);
  }

  // Expose a cleanup hook for dev reload / reinjection.
  window.__TOC_ASSISTANT_CLEANUP__ = dispose;

  function getDefaultConfig() {
    return {
      urlPattern: buildSitePattern(),
      side: 'right',
      selectors: [] as Array<{ type: string; expr: string }>
    };
  }

  async function startApp() {
    try {
      if (disposed) return;
      var configs = await getConfigs();
      if (disposed) return;
      var cfg = findMatchingConfig(configs, location.href);
      if (!cfg) {
        cfg = getDefaultConfig();
        debug(msg('logPrefix') + ' ' + msg('logNoConfigFound'));
      } else {
        debug(msg('logPrefix') + ' ' + msg('logConfigMatched'), cfg.urlPattern);
      }
      // Ensure the shared shadow root (host + CSS) exists before any UI renders,
      // so the dock/panel mount into the shadow and are style-isolated from the
      // host page. Failure is non-fatal (UI falls back to the host document).
      await getTocShadowRoot();
      appInstance = initForConfig(cfg, {
        onDeactivate: function() {
          // Page-side "Close TOC" → persist disabled state to background, then self-disable
          try {
            if (chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage(
                { type: TOC_MESSAGE.PERSIST_ACTIVE_STATE, enabled: false, origin: location.origin } satisfies TocRequest,
                function() { void chrome.runtime.lastError; }
              );
            }
          } catch (_) {}
          applyEnabledState(false).catch(function() {});
        }
      }) as TocAppInstance | null;
    } catch (err) {
      if (isContextInvalidatedError(err)) {
        dispose({ reason: 'context-invalidated' });
        return;
      }
      console.error(msg('logPrefix') + ' ' + msg('logInitFailed'), err);
    }
  }

  function stopApp() {
    if (appInstance?.destroy) appInstance.destroy();
    appInstance = null;
    cleanupOwnedElements();
  }

  async function applyExpandState(opts?: { expandPanel?: boolean }) {
    if (!appInstance) return;
    try {
      if (opts?.expandPanel) {
        if (appInstance.expand) await appInstance.expand({ autoCollapse: true });
      } else {
        if (appInstance.collapse) appInstance.collapse();
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
      // Disabled: destroy TOC app, clean up DOM
      stopApp();
      return;
    }
    // Enabled: start TOC app
    await startApp();
    await applyExpandState(opts);
  }

  async function main() {
    if (disposed) return;
    debug(msg('logPrefix') + ' ' + msg('logContentScriptStarted'), location.href);
    try {
      await new Promise<void>(function(resolve) {
        try {
          chrome.runtime.sendMessage({ type: TOC_MESSAGE.ENSURE_ICON } satisfies TocRequest, function() { void chrome.runtime.lastError; resolve(); });
        } catch (_) { resolve(); }
      });
      var enabled = await getSiteEnabledByOrigin();
      if (enabled) {
        await applyEnabledState(true);
      } else {
        debug(msg('logPrefix') + ' ' + msg('logSiteDisabled'));
      }
    } catch (e) {
      if (isContextInvalidatedError(e)) {
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
      messageListener = function(msgObj: TocRequest, sender: any, sendResponse: (response?: any) => void) {
        var responded = false;
        var respondOnce = function(payload: any) {
          if (responded) return;
          responded = true;
          try { sendResponse(payload); } catch (_) {}
        };
        try {
          if (!msgObj?.type) return;
          if (sender?.id && chrome.runtime?.id && sender.id !== chrome.runtime.id) {
            respondOnce({ ok: false, reason: 'bad-sender' });
            return;
          }
          if (msgObj.type === TOC_MESSAGE.PING) {
            respondOnce({ ok: !disposed });
            return;
          }
          if (disposed) { respondOnce({ ok: false, disposed: true }); return; }

          if (msgObj.type === TOC_MESSAGE.OPEN_PANEL) {
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

          // Cross-tab sync: background tells us the new enabled state
          if (msgObj.type === TOC_MESSAGE.UPDATE_ENABLED) {
            var enabled = !!msgObj.enabled;
            if (enabled === currentEnabled) { respondOnce({ ok: true, unchanged: true }); return; }
            (async function() {
              try {
                await applyEnabledState(enabled);
                respondOnce({ ok: true });
              } catch (err) {
                respondOnce({ ok: false, error: String(err) });
              }
            })();
            return true;
          }
        } catch (err) {
          respondOnce({ ok: false, error: String(err) });
          if (isContextInvalidatedError(err)) dispose({ reason: 'context-invalidated' });
        }
      };
      if (chrome.runtime?.onMessage?.addListener) {
        chrome.runtime.onMessage.addListener(messageListener);
      }
    } catch (_) {}

    try {
      var TOC_CONFIGS_KEY = STORAGE_KEYS?.TOC_CONFIGS || 'tocConfigs';
      storageListener = function(changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) {
        if (disposed || areaName !== 'local') return;
        var configChange = changes?.[TOC_CONFIGS_KEY];
        if (configChange && currentEnabled && appInstance?.refreshConfig) {
          Promise.resolve(appInstance.refreshConfig()).catch(function() {});
        }
      };
      if (chrome.storage?.onChanged?.addListener) {
        chrome.storage.onChanged.addListener(storageListener);
      }
    } catch (_) {}
  }

  try {
    attachListeners();
  } catch (e) {
    // Sync throw during listener setup — never let it escape uncaught into the host page.
    try {
      if (isContextInvalidatedError(e)) { dispose({ reason: 'context-invalidated' }); return; }
      console.warn(msg('logPrefix') + ' ' + msg('logInitFailed'), e);
    } catch (_) {}
  }

  // Wait for DOM to be stable before initializing TOC
  async function initWhenStable() {
    if (document.readyState === 'loading') {
      await new Promise<void>(function(r: () => void) { document.addEventListener('DOMContentLoaded', r, { once: true }); });
    }
    await new Promise<void>(function(r: () => void) { setTimeout(r, 50); });
    await main();
  }

  initWhenStable().catch(function(e) {
    // Async bootstrap rejection — never surface as an unhandled promise rejection.
    try {
      if (isContextInvalidatedError(e)) { dispose({ reason: 'context-invalidated' }); return; }
      console.warn(msg('logPrefix') + ' ' + msg('logInitFailed'), e);
    } catch (_) {}
  });
}
