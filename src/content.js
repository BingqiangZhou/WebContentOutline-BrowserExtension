(() => {
  'use strict';

  if (window.__TOC_ASSISTANT_LOADED__) return;
  window.__TOC_ASSISTANT_LOADED__ = true;

  const {
    msg = (key) => key,
    getConfigs,
    findMatchingConfig,
    getSiteEnabledByOrigin,
    getPanelExpandedByOrigin,
    getBadgePosByHost,
    setBadgePosByHost
  } = window.TOC_UTILS || {};
  const { initForConfig } = window.TOC_APP || {};

  if (!getConfigs || !initForConfig || !getSiteEnabledByOrigin) {
    console.error(msg('logPrefix') + ' ' + msg('logMissingDependencies'));
    return;
  }

  let appInstance = null;
  let currentEnabled = false;

  async function migrateLegacyBadgePos() {
    try {
      if (!setBadgePosByHost) return;
      const legacyKey = `tocBadgePos::${location.host}`;
      const raw = localStorage.getItem(legacyKey);
      if (!raw) return;
      const { safeJsonParse, isPlainObject, getFiniteNumber } = window.TOC_UTILS || {};
      const parsed = safeJsonParse ? safeJsonParse(raw) : null;
      const hasOwn = (obj, key) => !!(obj && Object.prototype.hasOwnProperty.call(obj, key));
      if (isPlainObject && isPlainObject(parsed) && hasOwn(parsed, 'left') && hasOwn(parsed, 'top')) {
        const left = getFiniteNumber ? getFiniteNumber(parsed.left) : (typeof parsed.left === 'number' ? parsed.left : null);
        const top = getFiniteNumber ? getFiniteNumber(parsed.top) : (typeof parsed.top === 'number' ? parsed.top : null);
        if (left === null || top === null) return;
        if (!getBadgePosByHost || !(await getBadgePosByHost(location.host))) {
          await setBadgePosByHost(location.host, { left, top });
        }
        localStorage.removeItem(legacyKey);
      }
    } catch (_) {}
  }

  async function startApp() {
    try {
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
      console.error(msg('logPrefix') + ' ' + msg('logInitFailed'), err);
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
      document.querySelectorAll('.toc-collapsed-badge, .toc-floating, .toc-overlay').forEach(n => n.remove());
    } catch (e) {
      console.warn(msg('logPrefix') + ' cleanup DOM failed:', e);
    }
  }

  async function main() {
    console.debug(msg('logPrefix') + ' ' + msg('logContentScriptStarted'), location.href);
    try {
      await migrateLegacyBadgePos();
      await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'toc:ensureIcon' }, () => { void chrome.runtime?.lastError; resolve(); });
        } catch (_) { resolve(); }
      });

      const enabled = await getSiteEnabledByOrigin();
      currentEnabled = !!enabled;
      if (currentEnabled) {
        await startApp();
        try {
          const expanded = getPanelExpandedByOrigin ? await getPanelExpandedByOrigin() : false;
          if (expanded && appInstance && appInstance.expand) {
            await appInstance.expand();
          }
        } catch (_) {}
      } else {
        console.debug(msg('logPrefix') + ' ' + msg('logSiteDisabled'));
      }
    } catch (e) {
      console.warn(msg('logPrefix') + ' ' + msg('logReadEnabledFailed'), e);
    }
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;

      if (msg.type === 'toc:ping') {
        sendResponse && sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'toc:openPanel') {
        (async () => {
          try {
            if (!appInstance) {
              await startApp();
            }
            if (appInstance && appInstance.expand) {
              await appInstance.expand();
            }
            sendResponse && sendResponse({ ok: true });
          } catch (err) {
            sendResponse && sendResponse({ ok: false, error: String(err) });
          }
        })();
        return true;
      }

      if (msg.type !== 'toc:updateEnabled') return;
      const enabled = !!msg.enabled;
      if (enabled === currentEnabled) {
        sendResponse && sendResponse({ ok: true, unchanged: true });
        return;
      }
      currentEnabled = enabled;
      if (enabled) {
        startApp().then(async () => {
          try {
            const expanded = getPanelExpandedByOrigin ? await getPanelExpandedByOrigin() : false;
            if (expanded && appInstance && appInstance.expand) {
              await appInstance.expand();
            }
            sendResponse && sendResponse({ ok: true });
          } catch (_) {
            sendResponse && sendResponse({ ok: true });
          }
        }).catch(() => sendResponse && sendResponse({ ok: false }));
        return true;
      }

      stopApp();
      sendResponse && sendResponse({ ok: true });
    });
  } catch (_) {}

  try {
    const KEY = (window.TOC_UTILS && window.TOC_UTILS.STORAGE_KEYS && window.TOC_UTILS.STORAGE_KEYS.SITE_ENABLE_MAP)
      ? window.TOC_UTILS.STORAGE_KEYS.SITE_ENABLE_MAP
      : 'tocSiteEnabledMap';
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      const ch = changes[KEY];
      if (!ch) return;
      try {
        const map = ch.newValue || {};
        const next = !!map[location.origin];
        if (next === currentEnabled) return;
        currentEnabled = next;
        if (next) {
          startApp().catch(err => console.warn(msg('logPrefix') + ' startApp failed:', err));
        } else {
          stopApp();
        }
      } catch (e) {
        console.warn(msg('logPrefix') + ' storage change failed:', e);
      }
    });
  } catch (e) {
    console.warn(msg('logPrefix') + ' storage listener failed:', e);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { main(); }, { once: true });
  } else {
    main();
  }
})();

