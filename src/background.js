// Background service worker for MV3 - per-site enable/disable, icon state, and dynamic injection

importScripts('shared/primitives.js');
const { serializedWrite, isQuotaExceededError, touchObjectKey, pruneObjectToLimit, applyTocConfigMutation, applyUiStateMutation, validateUiStateMutationSource } = globalThis.__STORAGE_PRIMITIVES;

// Storage keys needed by background.js
const BG_STORAGE_KEYS = {
  SITE_ENABLE_MAP: 'tocSiteEnabledMap',
  TOC_CONFIGS: 'tocConfigs',
  PANEL_STATE_MAP: 'tocPanelExpandedMap',
  BADGE_POS_MAP: 'tocBadgePosMap'
};

// Duplicated from core-utils.js (service worker cannot use ES module system)
function originFromUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

const CONTENT_SCRIPTS = ['src/content.js'];
const CONTENT_CSS = ['src/content.css'];

function isHttpUrl(url) {
  return !!(url && /^https?:\/\//i.test(url));
}

const BG_MAX_MAP_KEYS = 400;
const BG_MAX_CONFIG_SITES = 200;
const BG_MAX_SELECTORS_PER_SITE = 50;

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
  try {
    if (!chrome?.storage?.local) return { ok: false, error: new Error('chrome.storage.local unavailable') };
    await chrome.storage.local.set({ [KEY]: map });
    return { ok: true, pruned: false };
  } catch (e) {
    if (isQuotaExceededError(e)) {
      try {
        const pruned = { ...map };
        pruneObjectToLimit(pruned, BG_MAX_MAP_KEYS);
        await chrome.storage.local.set({ [KEY]: pruned });
        return { ok: true, pruned: true };
      } catch (e2) {
        return { ok: false, error: e2 };
      }
    }
    console.warn('[toc] saveEnabledMap failed:', e);
    return { ok: false, error: e };
  }
}

async function getEnabledByOrigin(origin) {
  const map = await getEnabledMap();
  return !!(origin && map[origin]);
}

async function setEnabledByOrigin(origin, enabled) {
  if (!origin) return { ok: false, enabled: false, error: null };
  return serializedWrite('tocSiteEnabledMap', async () => {
    const map = await getEnabledMap();
    const prev = !!map[origin];
    touchObjectKey(map, origin, !!enabled);
    pruneObjectToLimit(map, BG_MAX_MAP_KEYS);
    const res = await saveEnabledMap(map);
    if (!res || !res.ok) {
      return { ok: false, enabled: prev, error: res && res.error };
    }
    return { ok: true, enabled: !!map[origin], error: null };
  });
}

async function mutateTocConfigs(mutation) {
  const KEY = BG_STORAGE_KEYS.TOC_CONFIGS;
  return serializedWrite('tocConfigs', async () => {
    try {
      if (!chrome?.storage?.local) return { ok: false, reason: 'storage-unavailable' };
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
      console.warn('[toc] mutateTocConfigs failed:', e);
      return { ok: false, reason: isQuotaExceededError(e) ? 'quota-exceeded' : 'storage-write-failed' };
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
      console.warn('[toc] mutateUiState failed:', e, { storageKey });
      return { ok: false, reason: isQuotaExceededError(e) ? 'quota-exceeded' : 'storage-write-failed' };
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

async function setTabIcon(tabId, enabled) {
  try {
    await chrome.action.setIcon({ tabId, path: getIconPathMap(enabled) });
  } catch (e) {
    try {
      const pathMap = getIconPathMap(enabled);
      const absolute = {};
      for (const [size, p] of Object.entries(pathMap)) {
        absolute[size] = chrome.runtime.getURL(p.replace(/^\/+/, ''));
      }
      await chrome.action.setIcon({ tabId, path: absolute });
    } catch (_) {}
  }
  try {
    const title = chrome.i18n.getMessage(enabled ? 'titleEnabled' : 'titleDisabled') || (enabled ? 'Web TOC: Enabled' : 'Web TOC: Disabled');
    await chrome.action.setTitle({ tabId, title });
  } catch (_) {}
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
    try {
      await chrome.action.setIcon({ tabId, path: getIconPathMap(false) });
      await chrome.action.setTitle({ tabId, title: chrome.i18n.getMessage('titleDisabledFallback') || 'Web TOC: Disabled' });
    } catch (_) {}
    return;
  }

  const origin = originFromUrl(finalUrl);
  const enabled = await getEnabledByOrigin(origin);
  try { await setTabIcon(tabId, enabled); } catch (e) { console.warn('[toc] updateIconForTab failed:', e); }
}

function pingContentScript(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'toc:ping' }, (res) => {
        if (chrome.runtime.lastError) resolve(false);
        else resolve(!!(res && res.ok));
      });
    } catch (_) {
      resolve(false);
    }
  });
}

async function injectIntoTab(tabId) {
  // Inject CSS first
  try {
    if (CONTENT_CSS.length) {
      try { await chrome.scripting.removeCSS({ target: { tabId }, files: CONTENT_CSS }); } catch (_) {}
      await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
    }
  } catch (e) {
    console.warn('[toc] injectIntoTab failed (css):', e, { tabId });
    return { ok: false, step: 'css', error: e };
  }

  // Inject content script
  try {
    if (CONTENT_SCRIPTS.length) {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
    }
  } catch (e) {
    console.warn('[toc] injectIntoTab failed (js):', e, { tabId });
    try { await chrome.scripting.removeCSS({ target: { tabId }, files: CONTENT_CSS }); } catch (_) {}
    return { ok: false, step: 'js', error: e };
  }

  return { ok: true };
}

async function ensureContentScript(tabId, url) {
  if (!tabId || !isHttpUrl(url)) return false;

  const pingOk = await pingContentScript(tabId);
  if (pingOk) return true;

  const result = await injectIntoTab(tabId);
  return !!result.ok;
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
    for (const t of tabs) {
      if (!t.id || t.id === exceptTabId) continue;
      if (enabled) await ensureContentScript(t.id, t.url);
      try {
        chrome.tabs.sendMessage(t.id, { type: 'toc:updateEnabled', enabled }, () => { void chrome.runtime.lastError; });
      } catch (_) {}
      if (!enabled) {
        try { await chrome.scripting.removeCSS({ target: { tabId: t.id }, files: CONTENT_CSS }); } catch (_) {}
      }
    }
  } catch (e) {
    console.warn('[toc] broadcastEnabledToOrigin failed:', e, { origin, enabled });
  }
}

async function handleActionClick(tab) {
  if (!tab || !tab.id || !tab.url) return;
  if (!isHttpUrl(tab.url)) return;
  const origin = originFromUrl(tab.url);
  if (!origin) return;

  const currentlyEnabled = await getEnabledByOrigin(origin);
  const nextEnabled = !currentlyEnabled;
  const saved = await setEnabledByOrigin(origin, nextEnabled);

  if (!saved || !saved.ok) {
    await updateIconForTab(tab.id, tab.url);
    return;
  }

  try { await chrome.action.setBadgeText({ tabId: tab.id, text: '' }); } catch (_) {}

  if (saved.enabled) {
    await ensureContentScript(tab.id, tab.url);
    await updateIconForTab(tab.id, tab.url);
    await broadcastEnabledToOrigin(origin, true, tab.id);
    try {
      chrome.tabs.sendMessage(tab.id, { type: 'toc:updateEnabled', enabled: true }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
    try {
      chrome.tabs.sendMessage(tab.id, { type: 'toc:openPanel' }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
    return;
  }

  await updateIconForTab(tab.id, tab.url);
  await broadcastEnabledToOrigin(origin, false, tab.id);
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'toc:updateEnabled', enabled: false }, () => { void chrome.runtime.lastError; });
  } catch (_) {}
  try { await chrome.scripting.removeCSS({ target: { tabId: tab.id }, files: CONTENT_CSS }); } catch (_) {}
}

chrome.action.onClicked.addListener(handleActionClick);

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await updateIconForTab(activeInfo.tabId);
  } catch (_) {}
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab?.id || !tab.url || !isHttpUrl(tab.url)) return;
    const origin = originFromUrl(tab.url);
    const enabled = await getEnabledByOrigin(origin);
    if (enabled) await ensureContentScript(tab.id, tab.url);
  } catch (_) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateIconForTab(tabId, tab?.url || changeInfo.url).catch(() => {});
    if (tab?.url) maybeAutoInject(tabId, tab.url).catch(() => {});
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab?.id) updateIconForTab(tab.id, tab.url).catch(() => {});
});

async function processAllTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    const map = await getEnabledMap();
    for (const t of tabs) {
      if (t.id) updateIconForTab(t.id, t.url).catch(() => {});
      if (t.id && t.url && isHttpUrl(t.url)) {
        const origin = originFromUrl(t.url);
        if (map[origin]) ensureContentScript(t.id, t.url).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[toc] processAllTabs failed:', e);
  }
}

async function setGlobalDefaultIconDisabled() {
  try {
    await chrome.action.setIcon({ path: getIconPathMap(false) });
    await chrome.action.setTitle({ title: chrome.i18n.getMessage('titleDisabled') || 'Web TOC: Disabled' });
  } catch (e) { console.warn('[toc] setGlobalDefaultIconDisabled failed:', e); }
}

chrome.runtime.onInstalled.addListener(async () => {
  await setGlobalDefaultIconDisabled();
  await processAllTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await setGlobalDefaultIconDisabled();
  await processAllTabs();
});

setGlobalDefaultIconDisabled().catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (!msg || !msg.type) return;
    if (sender?.id && sender.id !== chrome.runtime.id) {
      sendResponse?.({ ok: false, reason: 'bad-sender' });
      return;
    }
    if (msg.type === 'toc:ensureIcon') {
      const tabId = sender?.tab?.id;
      const url = sender?.tab?.url || sender?.url || '';
      if (!tabId || !isHttpUrl(url)) { sendResponse?.({ ok: false, reason: 'no-tab' }); return; }
      (async () => {
        try { await updateIconForTab(tabId, url); sendResponse?.({ ok: true }); }
        catch (_) { sendResponse?.({ ok: false }); }
      })();
      return true;
    }
    if (msg.type === 'toc:mutateConfig') {
      if (!sender || sender.id !== chrome.runtime.id) { sendResponse?.({ ok: false, reason: 'bad-sender' }); return; }
      const senderUrl = sender?.tab?.url || sender?.url || '';
      const expectedPattern = sitePatternFromUrl(senderUrl);
      if (!expectedPattern || msg.urlPattern !== expectedPattern) { sendResponse?.({ ok: false, reason: 'bad-site' }); return; }
      (async () => {
        try {
          const result = await mutateTocConfigs({
            operation: msg.operation,
            urlPattern: msg.urlPattern,
            selector: msg.selector,
            side: msg.side
          });
          sendResponse?.(result);
        } catch (_) { sendResponse?.({ ok: false, reason: 'storage-write-failed' }); }
      })();
      return true;
    }
    if (msg.type === 'toc:mutateUiState') {
      if (!sender || sender.id !== chrome.runtime.id) { sendResponse?.({ ok: false, reason: 'bad-sender' }); return; }
      const senderUrl = sender?.tab?.url || sender?.url || '';
      const sourceValidation = validateUiStateMutationSource(msg, senderUrl);
      if (!sourceValidation.ok) { sendResponse?.(sourceValidation); return; }
      (async () => {
        try {
          const result = await mutateUiState({
            operation: msg.operation,
            key: msg.key,
            value: msg.value
          });
          sendResponse?.(result);
        } catch (_) { sendResponse?.({ ok: false, reason: 'storage-write-failed' }); }
      })();
      return true;
    }
  } catch (e) {
    console.warn('[toc] onMessage handler failed:', e);
  }
});

async function getTabsByOrigin(origin) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  return tabs.filter((t) => t?.url && isHttpUrl(t.url) && originFromUrl(t.url) === origin);
}
