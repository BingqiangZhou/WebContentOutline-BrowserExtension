// Background service worker for MV3 - per-site enable/disable, icon state, and dynamic injection

import { browser } from 'wxt/browser';
import {
  serializedWrite,
  isQuotaExceededError,
  touchObjectKey,
  pruneObjectToLimit,
  applyTocConfigMutation,
  applyUiStateMutation,
  validateUiStateMutationSource,
} from '../src/shared/primitives.js';

// Storage keys needed by background.js
const BG_STORAGE_KEYS = {
  SITE_ENABLE_MAP: 'tocSiteEnabledMap',
  TOC_CONFIGS: 'tocConfigs',
  PANEL_STATE_MAP: 'tocPanelExpandedMap',
  BADGE_POS_MAP: 'tocBadgePosMap'
};

// Duplicated from core-utils.js (service worker cannot use ES module system)
function originFromUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

const CONTENT_SCRIPTS = ['content-scripts/toc.js'];
const CONTENT_CSS = ['content-scripts/toc.css'];

function isHttpUrl(url: string | undefined): boolean {
  return !!(url && /^https?:\/\//i.test(url));
}

const BG_MAX_MAP_KEYS = 400;
const BG_MAX_CONFIG_SITES = 200;
const BG_MAX_SELECTORS_PER_SITE = 50;

async function getEnabledMap(): Promise<Record<string, boolean>> {
  const KEY = BG_STORAGE_KEYS.SITE_ENABLE_MAP;
  try {
    if (browser?.storage?.local) {
      const res = await browser.storage.local.get([KEY]);
      return (res[KEY] as Record<string, boolean>) || {};
    }
  } catch (e) {
    console.warn('[toc] getEnabledMap failed:', e);
  }
  return {};
}

async function saveEnabledMap(map: Record<string, boolean>): Promise<{ ok: boolean; pruned?: boolean; error?: Error }> {
  const KEY = BG_STORAGE_KEYS.SITE_ENABLE_MAP;
  try {
    if (!browser?.storage?.local) return { ok: false, error: new Error('browser.storage.local unavailable') };
    await browser.storage.local.set({ [KEY]: map });
    return { ok: true, pruned: false };
  } catch (e) {
    if (isQuotaExceededError(e)) {
      try {
        const pruned = { ...map };
        pruneObjectToLimit(pruned, BG_MAX_MAP_KEYS);
        await browser.storage.local.set({ [KEY]: pruned });
        return { ok: true, pruned: true };
      } catch (e2) {
        return { ok: false, error: e2 as Error };
      }
    }
    console.warn('[toc] saveEnabledMap failed:', e);
    return { ok: false, error: e as Error };
  }
}

async function getEnabledByOrigin(origin: string): Promise<boolean> {
  const map = await getEnabledMap();
  return !!(origin && map[origin]);
}

async function setEnabledByOrigin(origin: string, enabled: boolean): Promise<{ ok: boolean; enabled: boolean; error: Error | null }> {
  if (!origin) return { ok: false, enabled: false, error: null };
  return serializedWrite('tocSiteEnabledMap', async () => {
    const map = await getEnabledMap();
    const prev = !!map[origin];
    touchObjectKey(map, origin, !!enabled);
    pruneObjectToLimit(map, BG_MAX_MAP_KEYS);
    const res = await saveEnabledMap(map);
    if (!res || !res.ok) {
      return { ok: false, enabled: prev, error: res && res.error ? res.error : null };
    }
    return { ok: true, enabled: !!map[origin], error: null };
  }) as Promise<{ ok: boolean; enabled: boolean; error: Error | null }>;
}

async function mutateTocConfigs(mutation: { operation: string; urlPattern: string; selector?: any; side?: string }): Promise<any> {
  const KEY = BG_STORAGE_KEYS.TOC_CONFIGS;
  return serializedWrite('tocConfigs', async () => {
    try {
      if (!browser?.storage?.local) return { ok: false, reason: 'storage-unavailable' };
      const stored = await browser.storage.local.get([KEY]);
      const result = applyTocConfigMutation(stored[KEY] || [], mutation, Date.now(), {
        maxSites: BG_MAX_CONFIG_SITES,
        maxSelectorsPerSite: BG_MAX_SELECTORS_PER_SITE
      });
      if (!result || !result.ok || !result.changed) {
        return result || { ok: false, reason: 'invalid-result' };
      }
      await browser.storage.local.set({ [KEY]: result.configs });
      return result;
    } catch (e) {
      console.warn('[toc] mutateTocConfigs failed:', e);
      return { ok: false, reason: isQuotaExceededError(e) ? 'quota-exceeded' : 'storage-write-failed' };
    }
  });
}

async function mutateUiState(mutation: { operation: string; key: string; value: any }): Promise<any> {
  const storageKey = mutation.operation === 'set-badge-position'
    ? BG_STORAGE_KEYS.BADGE_POS_MAP
    : mutation.operation === 'set-panel-expanded'
      ? BG_STORAGE_KEYS.PANEL_STATE_MAP
      : '';
  if (!storageKey) return { ok: false, reason: 'invalid-operation' };
  return serializedWrite(storageKey, async () => {
    try {
      if (!browser?.storage?.local) return { ok: false, reason: 'storage-unavailable' };
      const stored = await browser.storage.local.get([storageKey]);
      const result = applyUiStateMutation(stored[storageKey] || {}, mutation, BG_MAX_MAP_KEYS);
      if (!result || !result.ok) return result || { ok: false, reason: 'invalid-result' };
      await browser.storage.local.set({ [storageKey]: result.map });
      return result;
    } catch (e) {
      console.warn('[toc] mutateUiState failed:', e, { storageKey });
      return { ok: false, reason: isQuotaExceededError(e) ? 'quota-exceeded' : 'storage-write-failed' };
    }
  });
}

function sitePatternFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return `${parsed.origin}/*`;
  } catch {
    return '';
  }
}

function getIconPathMap(enabled: boolean): Record<string, string> {
  const base = enabled ? 'icons/png/toc-enabled' : 'icons/png/toc-disabled';
  return {
    "16": `/${base}-16.png`,
    "32": `/${base}-32.png`,
    "48": `/${base}-48.png`,
    "128": `/${base}-128.png`
  };
}

async function setTabIcon(tabId: number, enabled: boolean): Promise<void> {
  try {
    await browser.action.setIcon({ tabId, path: getIconPathMap(enabled) });
  } catch {
    try {
      const pathMap = getIconPathMap(enabled);
      const absolute: Record<string, string> = {};
      for (const [size, p] of Object.entries(pathMap)) {
        absolute[size] = browser.runtime.getURL(p.replace(/^\/+/, '') as any);
      }
      await browser.action.setIcon({ tabId, path: absolute });
    } catch (_) {}
  }
  try {
    const title = browser.i18n.getMessage(enabled ? 'titleEnabled' : 'titleDisabled') || (enabled ? 'Web TOC: Enabled' : 'Web TOC: Disabled');
    await browser.action.setTitle({ tabId, title });
  } catch (_) {}
}

/**
 * Update the icon for a tab using a pre-fetched enabled map when available.
 * Falls back to reading storage if no map is provided.
 */
async function updateIconForTab(tabId: number, url: string = '', enabledMap: Record<string, boolean> | null = null): Promise<boolean | undefined> {
  if (!tabId) return;
  let finalUrl = url;
  if (!finalUrl || !isHttpUrl(finalUrl)) {
    try {
      const t = await browser.tabs.get(tabId);
      finalUrl = t?.url || '';
    } catch (_) {}
  }

  if (!finalUrl || !isHttpUrl(finalUrl)) {
    try {
      await browser.action.setIcon({ tabId, path: getIconPathMap(false) });
      await browser.action.setTitle({ tabId, title: browser.i18n.getMessage('titleDisabledFallback') || 'Web TOC: Disabled' });
    } catch (_) {}
    return;
  }

  const origin = originFromUrl(finalUrl);
  // Use pre-fetched map if available, otherwise read from storage
  const enabled = enabledMap != null ? !!(origin && enabledMap[origin]) : await getEnabledByOrigin(origin);
  try { await setTabIcon(tabId, enabled); } catch (e) { console.warn('[toc] updateIconForTab failed:', e); }
  return enabled;
}

function pingContentScript(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      browser.tabs.sendMessage(tabId, { type: 'toc:ping' }, (res: any) => {
        if (browser.runtime.lastError) resolve(false);
        else resolve(!!(res && res.ok));
      });
    } catch (_) {
      resolve(false);
    }
  });
}

async function injectIntoTab(tabId: number): Promise<{ ok: boolean; step?: string; error?: any }> {
  // Inject CSS first
  try {
    if (CONTENT_CSS.length) {
      try { await browser.scripting.removeCSS({ target: { tabId }, files: CONTENT_CSS }); } catch (_) {}
      await browser.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
    }
  } catch (e) {
    console.warn('[toc] injectIntoTab failed (css):', e, { tabId });
    return { ok: false, step: 'css', error: e };
  }

  // Inject content script
  try {
    if (CONTENT_SCRIPTS.length) {
      await browser.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS as any });
    }
  } catch (e) {
    console.warn('[toc] injectIntoTab failed (js):', e, { tabId });
    try { await browser.scripting.removeCSS({ target: { tabId }, files: CONTENT_CSS }); } catch (_) {}
    return { ok: false, step: 'js', error: e };
  }

  return { ok: true };
}

// Per-tab injection lock to prevent concurrent ensureContentScript calls
// from double-injecting when tabs.onActivated and tabs.onUpdated fire near-simultaneously.
const injectionLocks = new Map<number, Promise<boolean>>();

async function ensureContentScript(tabId: number, url: string): Promise<boolean> {
  if (!tabId || !isHttpUrl(url)) return false;

  // If injection is already in-flight for this tab, await the existing promise
  const existing = injectionLocks.get(tabId);
  if (existing) return existing;

  const promise = (async (): Promise<boolean> => {
    try {
      const pingOk = await pingContentScript(tabId);
      if (pingOk) return true;

      const result = await injectIntoTab(tabId);
      return !!result.ok;
    } finally {
      injectionLocks.delete(tabId);
    }
  })();

  injectionLocks.set(tabId, promise);
  return promise;
}

async function maybeAutoInject(tabId: number, url: string): Promise<void> {
  if (!isHttpUrl(url)) return;
  const origin = originFromUrl(url);
  const enabled = await getEnabledByOrigin(origin);
  if (!enabled) return;
  await ensureContentScript(tabId, url);
}

async function broadcastEnabledToOrigin(origin: string, enabled: boolean, exceptTabId: number | undefined): Promise<void> {
  try {
    const tabs = await getTabsByOrigin(origin);
    for (const t of tabs) {
      if (!t.id || t.id === exceptTabId) continue;
      if (enabled) await ensureContentScript(t.id, t.url!);
      try {
        browser.tabs.sendMessage(t.id, { type: 'toc:updateEnabled', enabled }, () => { void browser.runtime.lastError; });
      } catch (_) {}
      if (!enabled) {
        try { await browser.scripting.removeCSS({ target: { tabId: t.id }, files: CONTENT_CSS }); } catch (_) {}
      }
    }
  } catch (e) {
    console.warn('[toc] broadcastEnabledToOrigin failed:', e, { origin, enabled });
  }
}

async function handleActionClick(tab: any): Promise<void> {
  if (!tab || !tab.id || !tab.url) return;
  if (!isHttpUrl(tab.url)) return;
  const origin = originFromUrl(tab.url);
  if (!origin) return;

  const currentlyEnabled = await getEnabledByOrigin(origin);
  const nextEnabled = !currentlyEnabled;
  const saved: { ok: boolean; enabled: boolean; error: Error | null } = await setEnabledByOrigin(origin, nextEnabled);

  if (!saved || !saved.ok) {
    await updateIconForTab(tab.id, tab.url);
    return;
  }

  try { await browser.action.setBadgeText({ tabId: tab.id, text: '' }); } catch (_) {}

  if (saved.enabled) {
    await ensureContentScript(tab.id, tab.url);
    await updateIconForTab(tab.id, tab.url);
    await broadcastEnabledToOrigin(origin, true, tab.id);
    try {
      browser.tabs.sendMessage(tab.id, { type: 'toc:updateEnabled', enabled: true }, () => { void browser.runtime.lastError; });
    } catch (_) {}
    try {
      browser.tabs.sendMessage(tab.id, { type: 'toc:openPanel' }, () => { void browser.runtime.lastError; });
    } catch (_) {}
    return;
  }

  await updateIconForTab(tab.id, tab.url);
  await broadcastEnabledToOrigin(origin, false, tab.id);
  try {
    browser.tabs.sendMessage(tab.id, { type: 'toc:updateEnabled', enabled: false }, () => { void browser.runtime.lastError; });
  } catch (_) {}
  try { await browser.scripting.removeCSS({ target: { tabId: tab.id }, files: CONTENT_CSS }); } catch (_) {}
}

function startBackground() {
browser.action.onClicked.addListener(handleActionClick);

browser.tabs.onActivated.addListener(async (activeInfo: { tabId: number; windowId: number }) => {
  try {
    // Read the enabled map once and pass it to both icon update and injection check
    const map = await getEnabledMap();
    const enabled = await updateIconForTab(activeInfo.tabId, '', map);
    if (enabled) {
      try {
        const tab = await browser.tabs.get(activeInfo.tabId);
        if (tab?.id && tab.url && isHttpUrl(tab.url)) {
          await ensureContentScript(tab.id, tab.url);
        }
      } catch (_) {}
    }
  } catch (_) {}
});

browser.tabs.onUpdated.addListener((tabId: number, changeInfo: any, tab: any) => {
  if (changeInfo.status === 'complete') {
    updateIconForTab(tabId, tab?.url || changeInfo.url).catch(() => {});
    if (tab?.url) maybeAutoInject(tabId, tab.url).catch(() => {});
  }
});

browser.tabs.onCreated.addListener((tab: any) => {
  if (tab?.id) updateIconForTab(tab.id, tab.url).catch(() => {});
});

async function processAllTabs() {
  try {
    const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    const map = await getEnabledMap();
    for (const t of tabs) {
      // Pass pre-fetched map to avoid O(n) storage reads
      if (t.id) updateIconForTab(t.id, t.url, map).catch(() => {});
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
    await browser.action.setIcon({ path: getIconPathMap(false) });
    await browser.action.setTitle({ title: browser.i18n.getMessage('titleDisabled') || 'Web TOC: Disabled' });
  } catch (e) { console.warn('[toc] setGlobalDefaultIconDisabled failed:', e); }
}

browser.runtime.onInstalled.addListener(async () => {
  await setGlobalDefaultIconDisabled();
  await processAllTabs();
});

browser.runtime.onStartup.addListener(async () => {
  await setGlobalDefaultIconDisabled();
  await processAllTabs();
});

setGlobalDefaultIconDisabled().catch(() => {});

browser.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: any) => {
  try {
    if (!msg || !msg.type) return;
    if (sender?.id && sender.id !== browser.runtime.id) {
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
      if (!sender || sender.id !== browser.runtime.id) { sendResponse?.({ ok: false, reason: 'bad-sender' }); return; }
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
      if (!sender || sender.id !== browser.runtime.id) { sendResponse?.({ ok: false, reason: 'bad-sender' }); return; }
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
}

async function getTabsByOrigin(origin: string): Promise<any[]> {
  const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  return tabs.filter((t: any) => t?.url && isHttpUrl(t.url) && originFromUrl(t.url) === origin);
}

export default defineBackground(() => {
  startBackground();
});
