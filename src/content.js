(() => {
  'use strict';

  // If the script is injected again (dev reload / reinjection), dispose the previous instance first.
  try {
    if (typeof window.__TOC_ASSISTANT_CLEANUP__ === 'function') {
      window.__TOC_ASSISTANT_CLEANUP__({ reason: 'reinjected' });
    }
  } catch (_) {}

  if (window.__TOC_ASSISTANT_LOADED__) return;
  window.__TOC_ASSISTANT_LOADED__ = true;

  const {
    msg = (key) => key,
    getConfigs,
    findMatchingConfig,
    getSiteEnabledByOrigin,
    getPanelExpandedByOrigin,
    getBadgePosByHost,
    setBadgePosByHost,
    isContextInvalidatedError: isContextInvalidatedErrorUtil
  } = window.TOC_UTILS || {};
  const { initForConfig } = window.TOC_APP || {};

  if (!getConfigs || !initForConfig || !getSiteEnabledByOrigin) {
    console.error(msg('logPrefix') + ' ' + msg('logMissingDependencies'));
    return;
  }

  const hasChrome = (typeof chrome !== 'undefined');

  const isContextInvalidatedError = (typeof isContextInvalidatedErrorUtil === 'function')
    ? isContextInvalidatedErrorUtil
    : (e) => {
      try {
        if (!e) return false;
        const text = String(e && (e.message || (e.toString && e.toString()) || e) || '');
        const lowered = text.toLowerCase();
        return lowered.includes('extension context invalidated') || lowered.includes('context invalidated');
      } catch (_) {
        return false;
      }
    };

  let appInstance = null;
  let currentEnabled = false;
  let desiredEnabled = false;
  let transitionId = 0;
  let transitionChain = Promise.resolve();
  let transitionQueueId = 0;
  let startInFlight = null;
  let disposed = false;
  let listenersAttached = false;
  let domReadyHandler = null;
  let messageListener = null;
  let storageListener = null;

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

    try {
      if (domReadyHandler) {
        document.removeEventListener('DOMContentLoaded', domReadyHandler);
      }
    } catch (_) {}
    domReadyHandler = null;
  }

  function dispose(opts = {}) {
    if (disposed) return;
    disposed = true;

    // Cancel queued transitions and in-flight startup.
    try { transitionId++; } catch (_) {}
    try { transitionQueueId++; } catch (_) {}
    transitionChain = Promise.resolve();
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
    try {
      document.querySelectorAll('.toc-collapsed-badge, .toc-floating').forEach(n => {
        try {
          const cleanup = n && n.__TOC_CLEANUP__;
          if (typeof cleanup === 'function') cleanup();
        } catch (_) {}
        try { n.remove(); } catch (_) {}
      });
      document.querySelectorAll('.toc-overlay, .toc-toast-container').forEach(n => {
        try { n.remove(); } catch (_) {}
      });
    } catch (_) {}

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
      const legacyKey = `tocBadgePos::${location.host}`;
      const lockKey = `${legacyKey}::migrating`;
      const raw = localStorage.getItem(legacyKey);
      if (!raw) return;
      const { safeJsonParse, isPlainObject, getFiniteNumber, uiConst } = window.TOC_UTILS || {};
      const parsed = safeJsonParse ? safeJsonParse(raw) : null;
      const hasOwn = (obj, key) => !!(obj && Object.prototype.hasOwnProperty.call(obj, key));
      if (isPlainObject && isPlainObject(parsed) && hasOwn(parsed, 'left') && hasOwn(parsed, 'top')) {
        const left = getFiniteNumber ? getFiniteNumber(parsed.left) : (typeof parsed.left === 'number' ? parsed.left : null);
        const top = getFiniteNumber ? getFiniteNumber(parsed.top) : (typeof parsed.top === 'number' ? parsed.top : null);
        if (left === null || top === null) return;

        // Best-effort cross-tab coordination to avoid two tabs migrating at the same time.
        const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
        let electedLeader = false;
        let storageLockAcquired = false;

        // Prefer BroadcastChannel election when available (reduces last-writer-wins races across tabs).
        if (typeof BroadcastChannel === 'function') {
          let bc = null;
          let isLeader = false;
          const channelName = `tocBadgePosMigrate::${location.host}`;
          const seen = new Set([token]);
          const onMsg = (ev) => {
            try {
              const data = ev && ev.data;
              if (!data || data.type !== 'claim' || !data.token) return;
              seen.add(String(data.token));
            } catch (_) {}
          };
          try {
            bc = new BroadcastChannel(channelName);
            bc.addEventListener('message', onMsg);
            try { bc.postMessage({ type: 'claim', token }); } catch (_) {}
            await new Promise((r) => setTimeout(r, 120));
            const leader = Array.from(seen).sort()[0];
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
            const lockRaw = localStorage.getItem(lockKey);
            const lock = safeJsonParse ? safeJsonParse(lockRaw || '') : null;
            const lockTs = lock && typeof lock.ts === 'number' ? lock.ts : 0;
            const stale = !lockTs || (Date.now() - lockTs) > 15000;
            if (!stale && lock && lock.token) return;
            localStorage.setItem(lockKey, JSON.stringify({ token, ts: Date.now() }));
            const confirm = safeJsonParse ? safeJsonParse(localStorage.getItem(lockKey) || '') : null;
            if (!confirm || confirm.token !== token) return;
            storageLockAcquired = true;
          } catch (_) {}
        }

        try {
          // Another tab may have migrated while we were electing/locking.
          try {
            const stillThere = localStorage.getItem(legacyKey);
            if (!stillThere) return;
          } catch (_) {}
          const existing = getBadgePosByHost ? await getBadgePosByHost(location.host) : null;
          if (existing && Number.isFinite(existing.x) && Number.isFinite(existing.y)) {
            localStorage.removeItem(legacyKey);
            return;
          }

          const bw = (typeof uiConst === 'function') ? uiConst('BADGE_WIDTH', 80) : 80;
          const bh = (typeof uiConst === 'function') ? uiConst('BADGE_HEIGHT', 32) : 32;
          const x = left + bw / 2;
          const y = top + bh / 2;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;

          const saved = await setBadgePosByHost(location.host, { x, y, updatedAt: Date.now() });
          if (saved) {
            try {
              const after = getBadgePosByHost ? await getBadgePosByHost(location.host) : null;
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
      const configs = await getConfigs();
      let cfg = findMatchingConfig(configs, location.href);
      if (!cfg) {
        cfg = {
          urlPattern: `${location.protocol}//${location.host}/*`,
          side: 'right',
          selectors: [],
          collapsedDefault: false
        };
        console.debug(msg('logPrefix') + ' ' + msg('logNoConfigFound'));
      } else {
        console.debug(msg('logPrefix') + ' ' + msg('logConfigMatched'), cfg.urlPattern);
      }
      appInstance = initForConfig(cfg);
    } catch (err) {
      if (isContextInvalidatedError(err)) {
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
    startInFlight = (async () => { await startApp(); })();
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
      document.querySelectorAll('.toc-collapsed-badge, .toc-floating, .toc-overlay, .toc-toast-container').forEach(n => n.remove());
    } catch (e) {
      console.warn(msg('logPrefix') + ' cleanup DOM failed:', e);
    }

    // Content script should stop reacting after app is stopped to avoid unexpected reinitialization.
    dispose({ reason: 'stopApp' });
  }

  function enqueueEnabledTransition(nextEnabled, opts = {}) {
    if (disposed) return Promise.resolve();
    const want = !!nextEnabled;
    const myId = ++transitionId;
    const myQueueId = ++transitionQueueId;
    const next = transitionChain.then(async () => {
      if (myId !== transitionId) return;
      if (want === currentEnabled) {
        // Even when the enabled state doesn't change, callers may request an expand.
        if (want) {
          await ensureStarted();
          if (opts && opts.expandPanel) {
            try {
              if (appInstance && appInstance.expand) {
                await appInstance.expand();
              }
            } catch (_) {}
          } else {
            try {
              const expanded = getPanelExpandedByOrigin ? await getPanelExpandedByOrigin() : false;
              if (expanded && appInstance && appInstance.expand) {
                await appInstance.expand();
              }
            } catch (_) {}
          }
        }
        return;
      }

      currentEnabled = want;
      if (!want) {
        stopApp();
        return;
      }

      await ensureStarted();
      if (opts && opts.expandPanel) {
        try {
          if (appInstance && appInstance.expand) {
            await appInstance.expand();
          }
        } catch (_) {}
      } else {
        try {
          const expanded = getPanelExpandedByOrigin ? await getPanelExpandedByOrigin() : false;
          if (expanded && appInstance && appInstance.expand) {
            await appInstance.expand();
          }
        } catch (_) {}
      }
    });
    const safe = next.catch((e) => {
      console.warn(msg('logPrefix') + ' enabled transition failed:', e);
    });
    transitionChain = safe;
    safe.finally(() => {
      if (transitionQueueId === myQueueId) {
        transitionChain = Promise.resolve();
      }
    });
    return safe;
  }

  function requestEnabled(enabled, opts) {
    if (disposed) return Promise.resolve();
    desiredEnabled = !!enabled;
    return enqueueEnabledTransition(desiredEnabled, opts);
  }

  async function main() {
    if (disposed) return;
    console.debug(msg('logPrefix') + ' ' + msg('logContentScriptStarted'), location.href);
    try {
      await migrateLegacyBadgePos();
      await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'toc:ensureIcon' }, () => { void chrome.runtime?.lastError; resolve(); });
        } catch (_) { resolve(); }
      });

      const enabled = await getSiteEnabledByOrigin();
      if (!!enabled) {
        await requestEnabled(true);
      } else {
        console.debug(msg('logPrefix') + ' ' + msg('logSiteDisabled'));
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
      messageListener = (msgObj, sender, sendResponse) => {
        let responded = false;
        const respondOnce = (payload) => {
          if (responded) return;
          responded = true;
          try { sendResponse && sendResponse(payload); } catch (_) {}
        };
        try {
          if (!msgObj || !msgObj.type) return;

          // Only accept messages from this extension instance.
          if (sender && sender.id && chrome?.runtime?.id && sender.id !== chrome.runtime.id) {
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
              .then(() => requestEnabled(true, { expandPanel: true }))
              .then(() => respondOnce({ ok: true }))
              .catch((err) => respondOnce({ ok: false, error: String(err) }));
            return true;
          }

          if (msgObj.type !== 'toc:updateEnabled') return;
          const enabled = !!msgObj.enabled;
          if (enabled === desiredEnabled) {
            respondOnce({ ok: true, unchanged: true });
            return;
          }
          Promise.resolve()
            .then(() => requestEnabled(enabled))
            .then(() => respondOnce({ ok: true }))
            .catch((err) => respondOnce({ ok: false, error: String(err) }));
          return true;
        } catch (err) {
          respondOnce({ ok: false, error: String(err) });
          if (isContextInvalidatedError(err)) dispose({ reason: 'context-invalidated' });
        }
      };
      if (hasChrome && chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
        chrome.runtime.onMessage.addListener(messageListener);
      }
    } catch (_) {}

    try {
      const KEY = (window.TOC_UTILS && window.TOC_UTILS.STORAGE_KEYS && window.TOC_UTILS.STORAGE_KEYS.SITE_ENABLE_MAP)
        ? window.TOC_UTILS.STORAGE_KEYS.SITE_ENABLE_MAP
        : 'tocSiteEnabledMap';
      storageListener = (changes, areaName) => {
        if (disposed) return;
        if (areaName !== 'local') return;
        const ch = changes && changes[KEY];
        if (!ch) return;
        try {
          const map = ch.newValue || {};
          const originKey = (typeof location !== 'undefined' && typeof location.origin === 'string' && location.origin && location.origin !== 'null')
            ? location.origin
            : null;
          if (!originKey) return;
          const next = !!map[originKey];
          if (next === desiredEnabled) return;
          requestEnabled(next);
        } catch (e) {
          if (isContextInvalidatedError(e)) {
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
      if (isContextInvalidatedError(e)) {
        dispose({ reason: 'context-invalidated' });
      } else {
        console.warn(msg('logPrefix') + ' storage listener failed:', e);
      }
    }
  }

  attachListeners();

  if (document.readyState === 'loading') {
    domReadyHandler = () => { main(); };
    document.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
  } else {
    main();
  }
})();

