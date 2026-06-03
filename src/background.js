// Background service worker for MV3 - per-site enable/disable, icon state, and dynamic injection

importScripts('shared/storage-primitives.js');
importScripts('shared/config-primitives.js');
importScripts('shared/ui-state-primitives.js');
const { serializedWrite, isQuotaExceededError, touchObjectKey, pruneObjectToLimit } = globalThis.__STORAGE_PRIMITIVES;
const { applyTocConfigMutation } = globalThis.__CONFIG_PRIMITIVES;
const { applyUiStateMutation, validateUiStateMutationSource } = globalThis.__UI_STATE_PRIMITIVES;

// Storage keys needed by background.js
const BG_STORAGE_KEYS = {
  SITE_ENABLE_MAP: 'tocSiteEnabledMap',
  TOC_CONFIGS: 'tocConfigs',
  PANEL_STATE_MAP: 'tocPanelExpandedMap',
  BADGE_POS_MAP: 'tocBadgePosMap'
};

// Duplicated from core-utils.js (service worker cannot use define/require module system)
function originFromUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

const CONTENT_SCRIPTS = ['src/content.js'];

const CONTENT_CSS = ['src/content.css'];
const MAIN_WORLD_SCRIPTS = ['src/page-url-hook.js'];
const SESSION_KEYS = {
  INJECTED_TABS: 'tocInjectedTabs'
};
const injectionInFlight = new Map();
const actionClickInFlightByOrigin = new Set();

function isHttpUrl(url) {
  return !!(url && /^https?:\/\//i.test(url));
}

const BG_MAX_MAP_KEYS = 400;
const BG_MAX_CONFIG_SITES = 200;
const BG_MAX_SELECTORS_PER_SITE = 50;

async function processInBatches(items, fn, batchSize = 5) {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.allSettled(items.slice(i, i + batchSize).map(fn));
  }
}

async function getEnabledMap() {
  const KEY = BG_STORAGE_KEYS.SITE_ENABLE_MAP;
  try {
    if (chrome?.storage?.local) {
      const res = await chrome.storage.local.get([KEY]);
      return res[KEY] || {};
    }
  } catch (e) {
    console.warn('[toc] getEnabledMap failed:', e);
  }
  return {};
}

async function saveEnabledMap(map) {
  const KEY = BG_STORAGE_KEYS.SITE_ENABLE_MAP;
  const attempt = async (candidate) => {
    await chrome.storage.local.set({ [KEY]: candidate });
    return { ok: true, pruned: false };
  };
  try {
    if (!chrome?.storage?.local) {
      return { ok: false, quota: false, error: new Error('chrome.storage.local unavailable') };
    }
    return await attempt(map);
  } catch (e) {
    const quota = isQuotaExceededError(e);
    if (quota) {
      try {
        const pruned = { ...map };
        pruneObjectToLimit(pruned, BG_MAX_MAP_KEYS);
        await chrome.storage.local.set({ [KEY]: pruned });
        return { ok: true, pruned: true };
      } catch (e2) {
        console.warn('[toc] saveEnabledMap failed after prune:', e2, { quota: isQuotaExceededError(e2) });
        return { ok: false, quota: isQuotaExceededError(e2), error: e2 };
      }
    }
    console.warn('[toc] saveEnabledMap failed:', e, { quota });
    return { ok: false, quota, error: e };
  }
}

async function getEnabledByOrigin(origin) {
  const map = await getEnabledMap();
  return !!(origin && map[origin]);
}

async function setEnabledByOrigin(origin, enabled) {
  if (!origin) return { ok: false, enabled: false, quota: false, error: null };
  return serializedWrite('tocSiteEnabledMap', async () => {
    const map = await getEnabledMap();
    const prev = !!map[origin];
    touchObjectKey(map, origin, !!enabled);
    pruneObjectToLimit(map, BG_MAX_MAP_KEYS);
    const res = await saveEnabledMap(map);
    if (!res || !res.ok) {
      return { ok: false, enabled: prev, quota: !!(res && res.quota), error: res && res.error };
    }
    return { ok: true, enabled: !!map[origin], quota: false, error: null };
  });
}

async function mutateTocConfigs(mutation) {
  const KEY = BG_STORAGE_KEYS.TOC_CONFIGS;
  return serializedWrite('tocConfigs', async () => {
    try {
      if (!chrome?.storage?.local) {
        return { ok: false, reason: 'storage-unavailable' };
      }
      const stored = await chrome.storage.local.get([KEY]);
      const result = applyTocConfigMutation(stored[KEY] || [], mutation, Date.now(), {
        maxSites: BG_MAX_CONFIG_SITES,
        maxSelectorsPerSite: BG_MAX_SELECTORS_PER_SITE
      });
      if (!result || !result.ok || !result.changed) {
        return result || { ok: false, reason: 'invalid-result' };
      }
      await chrome.storage.local.set({ [KEY]: result.configs });
      return result;
    } catch (e) {
      const quota = isQuotaExceededError(e);
      console.warn('[toc] mutateTocConfigs failed:', e, { quota });
      return { ok: false, reason: quota ? 'quota-exceeded' : 'storage-write-failed' };
    }
  });
}

async function mutateUiState(mutation) {
  const storageKey = mutation.operation === 'set-badge-position'
    ? BG_STORAGE_KEYS.BADGE_POS_MAP
    : mutation.operation === 'set-panel-expanded'
      ? BG_STORAGE_KEYS.PANEL_STATE_MAP
      : '';
  if (!storageKey) return { ok: false, reason: 'invalid-operation' };
  return serializedWrite(storageKey, async () => {
    try {
      if (!chrome?.storage?.local) return { ok: false, reason: 'storage-unavailable' };
      const stored = await chrome.storage.local.get([storageKey]);
      const result = applyUiStateMutation(stored[storageKey] || {}, mutation, BG_MAX_MAP_KEYS);
      if (!result || !result.ok) return result || { ok: false, reason: 'invalid-result' };
      await chrome.storage.local.set({ [storageKey]: result.map });
      return result;
    } catch (e) {
      const quota = isQuotaExceededError(e);
      console.warn('[toc] mutateUiState failed:', e, { quota, storageKey });
      return { ok: false, reason: quota ? 'quota-exceeded' : 'storage-write-failed' };
    }
  });
}

function sitePatternFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return `${parsed.origin}/*`;
  } catch {
    return '';
  }
}

function getIconPathMap(enabled) {
  const base = enabled ? 'icons/png/toc-enabled' : 'icons/png/toc-disabled';
  return {
    "16": `/${base}-16.png`,
    "32": `/${base}-32.png`,
    "48": `/${base}-48.png`,
    "128": `/${base}-128.png`
  };
}

function makeAbsoluteIconPathMap(pathMap) {
  const out = {};
  for (const [size, iconPath] of Object.entries(pathMap || {})) {
    out[size] = chrome.runtime.getURL(String(iconPath).replace(/^\/+/, ''));
  }
  return out;
}

async function setActionIconAsync(details) {
  try {
    await chrome.action.setIcon(details);
    return true;
  } catch (e) {
    try {
      if (details && details.path && typeof details.path === 'object') {
        await chrome.action.setIcon({ ...details, path: makeAbsoluteIconPathMap(details.path) });
        return true;
      }
    } catch (fallbackErr) {
      console.error('[toc] setIcon error:', fallbackErr.message || fallbackErr);
      return false;
    }
    console.error('[toc] setIcon error:', e.message || e);
    return false;
  }
}

async function setActionTitleAsync(details) {
  try {
    await chrome.action.setTitle(details);
    return true;
  } catch (e) {
    console.warn('[toc] setTitle error:', e.message, details);
    return false;
  }
}

async function setGlobalDefaultIconDisabled() {
  try {
    const path = getIconPathMap(false);
    await setActionIconAsync({ path });
    const title = chrome.i18n.getMessage('titleDisabled') || 'Web TOC: Disabled';
    await setActionTitleAsync({ title });
  } catch (e) { console.warn('[toc] setGlobalDefaultIconDisabled failed:', e); }
}

async function updateIconForTab(tabId, url) {
  if (!tabId) return;
  let finalUrl = url;
  if (!finalUrl || !isHttpUrl(finalUrl)) {
    try {
      const t = await chrome.tabs.get(tabId);
      finalUrl = t?.url || '';
    } catch (_) {}
  }

  if (!finalUrl || !isHttpUrl(finalUrl)) {
    const fallbackPath = getIconPathMap(false);
    await setActionIconAsync({ tabId, path: fallbackPath });
    const fallbackTitle = chrome.i18n.getMessage('titleDisabledFallback') || 'Web TOC: Disabled';
    await setActionTitleAsync({ tabId, title: fallbackTitle });
    return;
  }

  const origin = originFromUrl(finalUrl);
  const enabled = await getEnabledByOrigin(origin);
  try {
    const path = getIconPathMap(enabled);
    await setActionIconAsync({ tabId, path });
    const titleKey = enabled ? 'titleEnabled' : 'titleDisabled';
    const title = chrome.i18n.getMessage(titleKey) || (enabled ? 'Web TOC: Enabled' : 'Web TOC: Disabled');
    await setActionTitleAsync({ tabId, title });
  } catch (e) { console.warn('[toc] updateIconForTab failed:', e); }
}

// Avoid concurrent icon updates per-tab (prevents flicker on rapid events).
const __iconUpdateState = new Map();
function queueIconUpdate(tabId, url) {
  if (!tabId) return Promise.resolve();
  const state = __iconUpdateState.get(tabId) || { inFlight: null, queued: false, lastUrl: null };
  state.lastUrl = url || state.lastUrl;
  if (state.inFlight) {
    state.queued = true;
    __iconUpdateState.set(tabId, state);
    return state.inFlight;
  }
  const run = async () => {
    do {
      state.queued = false;
      const u = state.lastUrl;
      await updateIconForTab(tabId, u);
    } while (state.queued);
  };
  state.inFlight = run().catch((e) => {
    console.warn('[toc] queueIconUpdate failed:', e, { tabId });
  }).finally(() => {
    state.inFlight = null;
    if (!state.queued) __iconUpdateState.delete(tabId);
  });
  __iconUpdateState.set(tabId, state);
  return state.inFlight;
}

async function updateIconsForOrigin(origin) {
  try {
    const tabs = await getTabsByOrigin(origin);
    await processInBatches(tabs.filter(t => t.id), async (t) => {
      await queueIconUpdate(t.id, t.url);
    }, 5);
  } catch (e) {
    console.warn('[toc] updateIconsForOrigin failed:', e, { origin });
  }
}

function pingContentScript(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'toc:ping' }, (res) => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(!!(res && res.ok));
        }
      });
    } catch (_) {
      resolve(false);
    }
  });
}

async function getSessionMap(key) {
  try {
    if (chrome?.storage?.session) {
      const res = await chrome.storage.session.get([key]);
      const value = res[key];
      return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    }
  } catch (e) {
    console.warn('[toc] getSessionMap failed:', e);
  }
  return {};
}

async function setSessionMap(key, map) {
  try {
    if (chrome?.storage?.session) {
      await chrome.storage.session.set({ [key]: map });
      return;
    }
  } catch (e) {
    console.warn('[toc] setSessionMap failed:', e);
  }
}

async function getInjectedState(tabId) {
  const map = await getSessionMap(SESSION_KEYS.INJECTED_TABS);
  return map[String(tabId)] || null;
}

async function setInjectedState(tabId, state) {
  return serializedWrite('tocInjectedTabs', async () => {
    const map = await getSessionMap(SESSION_KEYS.INJECTED_TABS);
    if (state) {
      map[String(tabId)] = state;
    } else {
      delete map[String(tabId)];
    }
    await setSessionMap(SESSION_KEYS.INJECTED_TABS, map);
  });
}

async function setInjectionBadge(tabId, failed) {
  if (!tabId) return;
  try {
    if (failed) {
      await chrome.action.setBadgeText({ tabId, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
      const title = chrome.i18n.getMessage('titleInjectionFailed')
        || 'Web TOC Assistant: Injection failed (click to retry)';
      await setActionTitleAsync({ tabId, title });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await queueIconUpdate(tabId);
    }
  } catch (e) {
    console.warn('[toc] setInjectionBadge failed:', e);
  }
}

async function insertInjectedCss(tabId) {
  try {
    if (CONTENT_CSS.length) {
      // Dynamic CSS is not automatically tied to the content-script lifecycle.
      // Remove a prior identical insertion first so repeated enable/reinject cycles stay idempotent.
      try {
        await chrome.scripting.removeCSS({ target: { tabId }, files: CONTENT_CSS });
      } catch (_) {}
      await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
      return { ok: true, inserted: true };
    }
  } catch (e) {
    return { ok: false, step: 'css', error: e };
  }
  return { ok: true, inserted: false };
}

async function injectIntoTab(tabId) {
  // First, inject CSS before JS to ensure styles are available
  const cssResult = await insertInjectedCss(tabId);
  if (!cssResult.ok) {
    console.warn('[toc] injectIntoTab failed (css):', cssResult.error, { tabId });
    return cssResult;
  }

  if (MAIN_WORLD_SCRIPTS.length) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: MAIN_WORLD_SCRIPTS,
        world: 'MAIN'
      });
    } catch (e) {
      console.warn('[toc] injectIntoTab failed (main world hook):', e, { tabId });
    }
  }

  try {
    if (CONTENT_SCRIPTS.length) {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
    }
  } catch (e) {
    console.warn('[toc] injectIntoTab failed (js):', e, { tabId });
    // Best-effort CSS cleanup on failure
    try {
      await chrome.scripting.removeCSS({ target: { tabId }, files: CONTENT_CSS });
    } catch (_) {}
    return { ok: false, step: 'js', error: e };
  }

  return { ok: true };
}

async function removeInjectedCss(tabId) {
  if (!tabId) return;
  try {
    if (CONTENT_CSS.length) {
      await chrome.scripting.removeCSS({ target: { tabId }, files: CONTENT_CSS });
    }
  } catch (_) {}
  try { await setInjectedState(tabId, null); } catch (_) {}
}

async function ensureContentScript(tabId, url) {
  if (!tabId) return false;
  if (!isHttpUrl(url)) return false;

  const inFlight = injectionInFlight.get(tabId);
  if (inFlight) return await inFlight;

  const injectPromise = (async () => {
    const pingOk = await pingContentScript(tabId);
    if (pingOk) {
      // Script already running; just re-inject CSS if needed and update state
      const state = await getInjectedState(tabId);
      if (!state || state.url !== url) {
        const cssResult = await insertInjectedCss(tabId);
        if (!cssResult.ok) {
          console.warn('[toc] ensureContentScript failed (css):', cssResult.error, { tabId });
          await setInjectionBadge(tabId, true);
          return false;
        }
      }
      await setInjectedState(tabId, { url, ts: Date.now() });
      await setInjectionBadge(tabId, false);
      return true;
    }

    // Need fresh injection
    const result = await injectIntoTab(tabId);
    if (result.ok) {
      await setInjectedState(tabId, { url, ts: Date.now() });
      await setInjectionBadge(tabId, false);
      return true;
    }
    await setInjectionBadge(tabId, true);
    return false;
  })();

  injectionInFlight.set(tabId, injectPromise);
  try {
    return await injectPromise;
  } finally {
    injectionInFlight.delete(tabId);
  }
}

async function maybeAutoInject(tabId, url) {
  if (!isHttpUrl(url)) return;
  const origin = originFromUrl(url);
  const enabled = await getEnabledByOrigin(origin);
  if (!enabled) return;
  await ensureContentScript(tabId, url);
}

async function broadcastEnabledToOrigin(origin, enabled, exceptTabId) {
  try {
    const tabs = await getTabsByOrigin(origin);
    await processInBatches(tabs.filter(t => t.id && (!exceptTabId || t.id !== exceptTabId)), async (t) => {
      if (enabled) {
        await ensureContentScript(t.id, t.url);
      }
      try {
        chrome.tabs.sendMessage(t.id, { type: 'toc:updateEnabled', enabled }, () => { void chrome.runtime.lastError; });
      } catch (e) {
        console.warn('[toc] sendMessage to tab failed:', e, { tabId: t.id, url: t.url });
      }
      if (!enabled) await removeInjectedCss(t.id);
    }, 5);
  } catch (e) {
    console.warn('[toc] broadcastEnabledToOrigin failed:', e, { origin, enabled });
  }
}

function sendEnabledToTab(tabId, enabled) {
  try {
    chrome.tabs.sendMessage(tabId, { type: 'toc:updateEnabled', enabled }, () => { void chrome.runtime.lastError; });
  } catch (e) {
    console.warn('[toc] sendMessage to current tab failed:', e, { tabId, enabled });
  }
}

async function requestOpenPanel(tabId) {
  try {
    chrome.tabs.sendMessage(tabId, { type: 'toc:openPanel' }, () => { void chrome.runtime.lastError; });
  } catch (e) {
    console.warn('[toc] requestOpenPanel failed:', e, { tabId });
  }
}

async function handleActionClick(tab) {
  if (!tab || !tab.id || !tab.url) return;
  const url = tab.url;
  if (!isHttpUrl(url)) return;
  const origin = originFromUrl(url);
  if (!origin) return;
  if (actionClickInFlightByOrigin.has(origin)) return;
  actionClickInFlightByOrigin.add(origin);
  try {
    const currentlyEnabled = await getEnabledByOrigin(origin);
    const nextEnabled = !currentlyEnabled;
    const saved = await setEnabledByOrigin(origin, nextEnabled);
    if (!saved || !saved.ok) {
      // Keep UI consistent with persisted state.
      await updateIconsForOrigin(origin);
      try {
        await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
        await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#d93025' });
        const titleKey = saved && saved.quota ? 'titleStorageQuotaExceeded' : 'titleStorageWriteFailed';
        const fallback = saved && saved.quota
          ? 'Web TOC: Storage quota exceeded (changes not saved)'
          : 'Web TOC: Storage error (changes not saved)';
        const title = chrome.i18n.getMessage(titleKey) || fallback;
        await setActionTitleAsync({ tabId: tab.id, title });
      } catch (e) {
        console.warn('[toc] failed to set storage failure badge/title:', e);
      }
      // Best-effort: if content script is running, keep it consistent too.
      sendEnabledToTab(tab.id, currentlyEnabled);
      return;
    }

    try { await chrome.action.setBadgeText({ tabId: tab.id, text: '' }); } catch (_) {}

    if (saved.enabled) {
      await ensureContentScript(tab.id, tab.url);
      await updateIconsForOrigin(origin);
      await broadcastEnabledToOrigin(origin, true, tab.id);
      sendEnabledToTab(tab.id, true);
      await requestOpenPanel(tab.id);
      return;
    }

    await updateIconsForOrigin(origin);
    await broadcastEnabledToOrigin(origin, false, tab.id);
    sendEnabledToTab(tab.id, false);
    await removeInjectedCss(tab.id);
  } finally {
    actionClickInFlightByOrigin.delete(origin);
  }
}

chrome.action.onClicked.addListener(handleActionClick);

chrome.tabs.onActivated.addListener((activeInfo) => {
  queueIconUpdate(activeInfo.tabId).catch(e => {
    console.warn('[toc] onActivated: updateIconForTab failed:', e);
  });
  chrome.tabs.get(activeInfo.tabId).then(async (tab) => {
    if (!tab?.id || !tab.url || !isHttpUrl(tab.url)) return;
    const origin = originFromUrl(tab.url);
    const enabled = await getEnabledByOrigin(origin);
    if (enabled) {
      await ensureContentScript(tab.id, tab.url);
    }
  }).catch((e) => {
    // Tab may have been closed before we could process it
    if (!e?.message?.includes('No tab with id')) {
      console.debug('[toc] onActivated: get tab failed:', e);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    setInjectedState(tabId, null).catch(() => {});
  }
  if (changeInfo.status === 'complete') {
    queueIconUpdate(tabId, tab?.url || changeInfo.url).catch((e) => {
      console.warn('[toc] onUpdated: updateIconForTab failed:', e);
    });
    if (tab?.url) {
      maybeAutoInject(tabId, tab.url).catch((e) => {
        console.warn('[toc] onUpdated: auto inject failed:', e);
      });
    }
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    if (tab && tab.id) await queueIconUpdate(tab.id, tab.url);
  } catch (e) {
    console.warn('[toc] onCreated: updateIconForTab failed:', e, { tabId: tab?.id });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  setInjectedState(tabId, null).catch(() => {});
  try { __iconUpdateState.delete(tabId); } catch (_) {}
});

// Clean up icon update state for closed tabs on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  setInjectedState(tabId, null).catch(() => {});
  __iconUpdateState.delete(tabId);
});

async function processAllTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  const map = await getEnabledMap();
  await processInBatches(tabs, async (t) => {
    if (t.id) await queueIconUpdate(t.id, t.url).catch(() => {});
    if (t.id && t.url && isHttpUrl(t.url)) {
      const origin = originFromUrl(t.url);
      if (map[origin]) {
        await ensureContentScript(t.id, t.url);
      }
    }
  }, 5);
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await setGlobalDefaultIconDisabled();
    await processAllTabs();
  } catch (e) {
    console.warn('[toc] onInstalled failed:', e);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await setGlobalDefaultIconDisabled();
    await processAllTabs();
  } catch (e) {
    console.warn('[toc] onStartup failed:', e);
  }
});

(async () => {
  await setGlobalDefaultIconDisabled();
})().catch(e => console.warn('[toc] initial icon setup failed:', e));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (!msg || !msg.type) return;
    // Only accept messages from this extension instance.
    if (sender && sender.id && sender.id !== chrome.runtime.id) {
      sendResponse && sendResponse({ ok: false, reason: 'bad-sender' });
      return;
    }
    if (msg.type === 'toc:ensureIcon') {
      const tabId = sender?.tab?.id;
      const url = sender?.tab?.url || sender?.url || '';
      if (!tabId || !isHttpUrl(url)) { sendResponse && sendResponse({ ok: false, reason: 'no-tab' }); return; }
      queueIconUpdate(tabId, url).then(() => {
        sendResponse && sendResponse({ ok: true });
      }).catch((e) => {
        console.warn('[toc] onMessage: updateIconForTab failed:', e, { tabId });
        sendResponse && sendResponse({ ok: false });
      });
      return true;
    }
    if (msg.type === 'toc:mutateConfig') {
      if (!sender || sender.id !== chrome.runtime.id) {
        sendResponse && sendResponse({ ok: false, reason: 'bad-sender' });
        return;
      }
      const senderUrl = sender?.tab?.url || sender?.url || '';
      const expectedPattern = sitePatternFromUrl(senderUrl);
      if (!expectedPattern || msg.urlPattern !== expectedPattern) {
        sendResponse && sendResponse({ ok: false, reason: 'bad-site' });
        return;
      }
      mutateTocConfigs({
        operation: msg.operation,
        urlPattern: msg.urlPattern,
        selector: msg.selector,
        side: msg.side
      }).then((result) => {
        sendResponse && sendResponse(result);
      }).catch((e) => {
        console.warn('[toc] onMessage: mutateTocConfigs failed:', e);
        sendResponse && sendResponse({ ok: false, reason: 'storage-write-failed' });
      });
      return true;
    }
    if (msg.type === 'toc:mutateUiState') {
      if (!sender || sender.id !== chrome.runtime.id) {
        sendResponse && sendResponse({ ok: false, reason: 'bad-sender' });
        return;
      }
      const senderUrl = sender?.tab?.url || sender?.url || '';
      const sourceValidation = validateUiStateMutationSource(msg, senderUrl);
      if (!sourceValidation.ok) {
        sendResponse && sendResponse(sourceValidation);
        return;
      }
      mutateUiState({
        operation: msg.operation,
        key: msg.key,
        value: msg.value
      }).then((result) => {
        sendResponse && sendResponse(result);
      }).catch((e) => {
        console.warn('[toc] onMessage: mutateUiState failed:', e);
        sendResponse && sendResponse({ ok: false, reason: 'storage-write-failed' });
      });
      return true;
    }
  } catch (e) {
    console.warn('[toc] onMessage handler failed:', e);
  }
});

async function getTabsByOrigin(origin) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  return tabs.filter((t) => {
    if (!t || !t.url || !isHttpUrl(t.url)) return false;
    return originFromUrl(t.url) === origin;
  });
}
