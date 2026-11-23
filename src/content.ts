
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
  // 'ok' | 'fail' | 'halt' — toc-app's RebuildStatus contract (never rejects).
  refreshConfig?: () => Promise<'ok' | 'fail' | 'halt'>;
}

export function startTocContent(ctx: any) {
  'use strict';
  void ctx;

  // If the script is injected again (dev reload / reinjection), dispose the
  // previous instance first. A prior injection that died mid-init (after setting
  // the loaded guard but before registering the cleanup hook) would otherwise
  // deadlock reinjection forever — recover from that stuck state here.
  if (window.__TOC_ASSISTANT_LOADED__) {
    if (typeof window.__TOC_ASSISTANT_CLEANUP__ === 'function') {
      try { window.__TOC_ASSISTANT_CLEANUP__({ reason: 'reinjected' }); } catch (_) {}
      // dispose() resets the guard to false; if it somehow didn't, defer to the
      // live instance rather than double-initializing.
      if (window.__TOC_ASSISTANT_LOADED__) return;
    } else {
      // Stale guard with no cleanup hook — prior instance died mid-init. Reset
      // and re-initialize so the page isn't left without a working TOC.
      window.__TOC_ASSISTANT_LOADED__ = false;
    }
  }
  window.__TOC_ASSISTANT_LOADED__ = true;

  var appInstance: TocAppInstance | null = null;
  var currentEnabled = false;
  var disposed = false;
  var listenersAttached = false;
  // Bumped on every change of the enabled state. A boolean alone cannot tell
  // "still enabled" from "disabled and enabled again": an enable → disable →
  // enable burst (a fast triple-click on the toolbar icon) while startApp() is
  // parked in an await would run it twice and orphan the first app instance —
  // its observers outlive the disable.
  var enabledGeneration = 0;
  // How many UPDATE_ENABLED messages this tab has received. Each one supersedes
  // the bootstrap's own read of the enabled state (see main()).
  var stateNotices = 0;

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
    enabledGeneration++;
    detachListeners();
    stopApp();
    window.__TOC_ASSISTANT_LOADED__ = false;
    window.__TOC_ASSISTANT_CLEANUP__ = undefined;
    if (opts?.reason) debug(msg('logPrefix') + ' disposed:', opts.reason);
  }

  // Expose a cleanup hook for dev reload / reinjection.
  window.__TOC_ASSISTANT_CLEANUP__ = dispose;

  function getDefaultConfig() {
    return {
      urlPattern: buildSitePattern(),
      selectors: [] as Array<{ type: string; expr: string }>
    };
  }

  async function startApp() {
    try {
      if (disposed) return;
      // Whose enable is this? Any later state change (disable, or disable and
      // enable again) retires this start — see enabledGeneration above.
      var gen = enabledGeneration;
      var configs = await getConfigs();
      // Re-check state after EVERY await: an UPDATE_ENABLED(false) message can
      // arrive while we are suspended here. That message's stopApp() finds no
      // appInstance yet (initForConfig has not run), so without this guard
      // initialization would continue and leave a zombie TOC on a disabled site.
      if (disposed || !currentEnabled || gen !== enabledGeneration) return;
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
      if (disposed || !currentEnabled || gen !== enabledGeneration) return;
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
    // Take the shadow host down as well. It was the one trace of the extension
    // a disabled page kept (the dock and panel inside it were already gone), and
    // it stays reachable for page scripts to find. The next enable recreates it.
    disposeTocShadowRoot();
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
    var gen = ++enabledGeneration;
    if (!want) {
      // Disabled: destroy TOC app, clean up DOM
      stopApp();
      return;
    }
    // Enabled: start TOC app
    await startApp();
    // A disable or re-enable that landed while startApp() was running retired
    // that start (see enabledGeneration). The app that exists now — if any —
    // belongs to a newer request, and this call's panel state is not for it.
    if (disposed || gen !== enabledGeneration) return;
    await applyExpandState(opts);
  }

  async function main() {
    if (disposed) return;
    // Any UPDATE_ENABLED that lands while this bootstrap is suspended supersedes
    // the enabled state it reads below: the message listener has already applied
    // what the background wants. That holds even for a message that changes
    // nothing in this tab — e.g. the site is disabled while the script is still
    // starting, so "false" matches the not-yet-enabled state and looks like a
    // no-op, yet the pending read (an older "true") must not start the TOC.
    var noticesAtStart = stateNotices;
    debug(msg('logPrefix') + ' ' + msg('logContentScriptStarted'), location.href);
    try {
      await new Promise<void>(function(resolve) {
        try {
          chrome.runtime.sendMessage({ type: TOC_MESSAGE.ENSURE_ICON } satisfies TocRequest, function() { void chrome.runtime.lastError; resolve(); });
        } catch (_) { resolve(); }
      });
      var enabled = await getSiteEnabledByOrigin();
      if (disposed || noticesAtStart !== stateNotices) return;
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
            // Counted before the "unchanged" shortcut: even a message that
            // changes nothing here tells the bootstrap that its own read of the
            // enabled state is stale (see main()).
            stateNotices++;
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
    // Double-rAF: lets the first paint/layout pass settle (the old fixed
    // 50ms timeout delayed the first dock appearance on every enabled page).
    // Hidden tabs never run rAF (Chromium suspends it there), so fall back to
    // a timer — background-opened tabs still initialize (throttled) instead
    // of waiting for first visibility. Same fallback where rAF is
    // unavailable (locked-down host or a test sandbox).
    await new Promise<void>(function(r: () => void) {
      if (document.hidden || typeof (globalThis as any).requestAnimationFrame !== 'function') {
        setTimeout(r, 0);
        return;
      }
      requestAnimationFrame(function() { requestAnimationFrame(function() { r(); }); });
    });
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
