// Background service worker for MV3 - per-site enable/disable, icon state, and dynamic injection

importScripts('./utils.js');
const { STORAGE_KEYS: SHARED_STORAGE_KEYS, originFromUrl: sharedOriginFromUrl, msg: sharedMsg } = globalThis.TOC_UTILS || {};
const BG_STORAGE_KEYS = SHARED_STORAGE_KEYS || { SITE_ENABLE_MAP: 'tocSiteEnabledMap' };

const CONTENT_SCRIPTS = [
  'src/utils.js',
  'src/utils/css-selector.js',
  'src/utils/toc-builder.js',
  'src/ui/collapsed-badge.js',
  'src/ui/element-picker.js',
  'src/ui/floating-panel.js',
  'src/core/config-manager.js',
  'src/core/mutation-observer.js',
  'src/core/toc-app.js',
  'src/content.js'
];

const CONTENT_CSS = ['src/content.css'];
const SESSION_KEYS = {
  INJECTED_TABS: 'tocInjectedTabs'
};
const INJECTION_COOLDOWN_MS = 1200;
const INJECTION_PING_RETRY_MS = 200;
const injectionInFlight = new Map();

function originFromUrl(url) {
  if (sharedOriginFromUrl) return sharedOriginFromUrl(url);
  try { return new URL(url).origin; } catch (_) { return ''; }
}

function isHttpUrl(url) {
  return !!(url && /^https?:\/\//i.test(url));
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
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [KEY]: map });
    }
  } catch (e) {
    console.warn('[toc] saveEnabledMap failed:', e);
  }
}

async function getEnabledByOrigin(origin) {
  const map = await getEnabledMap();
  return !!(origin && map[origin]);
}

async function setEnabledByOrigin(origin, enabled) {
  const map = await getEnabledMap();
  if (!origin) return false;
  map[origin] = !!enabled;
  await saveEnabledMap(map);
  return map[origin];
}

function getIconPathMap(enabled) {
  const base = enabled ? 'icons/png/toc-enabled' : 'icons/png/toc-disabled';
  return {
    "16": chrome.runtime.getURL(`${base}-16.png`),
    "32": chrome.runtime.getURL(`${base}-32.png`),
    "48": chrome.runtime.getURL(`${base}-48.png`),
    "128": chrome.runtime.getURL(`${base}-128.png`)
  };
}

async function setActionIconAsync(details) {
  try {
    await chrome.action.setIcon(details);
    return true;
  } catch (e) {
    console.error('[toc] setIcon error:', e.message);
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
    const title = ((sharedMsg && sharedMsg('titleDisabled')) || chrome.i18n.getMessage('titleDisabled')) || 'Web TOC: Disabled';
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
    const fallbackTitle = ((sharedMsg && sharedMsg('titleDisabledFallback')) || chrome.i18n.getMessage('titleDisabledFallback')) || 'Web TOC: Disabled';
    await setActionTitleAsync({ tabId, title: fallbackTitle });
    return;
  }

  const origin = originFromUrl(finalUrl);
  const enabled = await getEnabledByOrigin(origin);
  try {
    const path = getIconPathMap(enabled);
    await setActionIconAsync({ tabId, path });
    const titleKey = enabled ? 'titleEnabled' : 'titleDisabled';
    const title = ((sharedMsg && sharedMsg(titleKey)) || chrome.i18n.getMessage(titleKey)) || (enabled ? 'Web TOC: Enabled' : 'Web TOC: Disabled');
    await setActionTitleAsync({ tabId, title });
  } catch (e) { console.warn('[toc] updateIconForTab failed:', e); }
}

async function updateIconsForOrigin(origin) {
  try {
    const tabs = await getTabsByOrigin(origin);
    for (const t of tabs) {
      if (t.id) {
        await updateIconForTab(t.id, t.url);
      }
    }
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
      return res[key] || {};
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
  const map = await getSessionMap(SESSION_KEYS.INJECTED_TABS);
  if (state) {
    map[String(tabId)] = state;
  } else {
    delete map[String(tabId)];
  }
  await setSessionMap(SESSION_KEYS.INJECTED_TABS, map);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setInjectionBadge(tabId, failed) {
  if (!tabId) return;
  try {
    if (failed) {
      await chrome.action.setBadgeText({ tabId, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
      const title = ((sharedMsg && sharedMsg('titleInjectionFailed')) || chrome.i18n.getMessage('titleInjectionFailed'))
        || 'Web TOC Assistant: Injection failed (click to retry)';
      await setActionTitleAsync({ tabId, title });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await updateIconForTab(tabId);
    }
  } catch (e) {
    console.warn('[toc] setInjectionBadge failed:', e);
  }
}

async function injectIntoTab(tabId) {
  let cssInserted = false;
  try {
    if (CONTENT_CSS.length) {
      await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
      cssInserted = true;
    }
  } catch (e) {
    console.warn('[toc] injectIntoTab failed (css):', e, { tabId });
    return { ok: false, step: 'css', error: e };
  }

  for (const file of CONTENT_SCRIPTS) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (e) {
      console.warn('[toc] injectIntoTab failed (js):', e, { tabId, file });
      if (cssInserted) {
        try {
          await chrome.scripting.removeCSS({ target: { tabId }, files: CONTENT_CSS });
        } catch (removeErr) {
          console.warn('[toc] removeCSS failed after js error:', removeErr, { tabId });
        }
      }
      return { ok: false, step: 'js', file, error: e };
    }
  }

  return { ok: true };
}

async function ensureContentScript(tabId, url) {
  if (!tabId) return false;
  if (!isHttpUrl(url)) return false;

  const inFlight = injectionInFlight.get(tabId);
  if (inFlight) return await inFlight;

  const pingOk = await pingContentScript(tabId);
  if (pingOk) {
    await setInjectedState(tabId, { url, ts: Date.now() });
    await setInjectionBadge(tabId, false);
    return true;
  }

  const state = await getInjectedState(tabId);
  if (state && state.url === url && Date.now() - state.ts < INJECTION_COOLDOWN_MS) {
    await sleep(INJECTION_PING_RETRY_MS);
    const retryOk = await pingContentScript(tabId);
    if (retryOk) {
      await setInjectedState(tabId, { url, ts: Date.now() });
      await setInjectionBadge(tabId, false);
      return true;
    }
  }

  const injectPromise = (async () => {
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
    for (const t of tabs) {
      if (!t.id) continue;
      if (exceptTabId && t.id === exceptTabId) continue;
      if (enabled) {
        await ensureContentScript(t.id, t.url);
      }
      try {
        chrome.tabs.sendMessage(t.id, { type: 'toc:updateEnabled', enabled }, () => { void chrome.runtime.lastError; });
      } catch (e) {
        console.warn('[toc] sendMessage to tab failed:', e, { tabId: t.id, url: t.url });
      }
    }
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
  const currentlyEnabled = await getEnabledByOrigin(origin);
  const nextEnabled = !currentlyEnabled;
  await setEnabledByOrigin(origin, nextEnabled);

  if (nextEnabled) {
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
}

chrome.action.onClicked.addListener(handleActionClick);

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateIconForTab(activeInfo.tabId).catch(e => {
    console.warn('[toc] onActivated: updateIconForTab failed:', e);
  });
  chrome.tabs.get(activeInfo.tabId).then(async (tab) => {
    if (!tab?.id || !tab.url || !isHttpUrl(tab.url)) return;
    const origin = originFromUrl(tab.url);
    const enabled = await getEnabledByOrigin(origin);
    if (enabled) {
      await ensureContentScript(tab.id, tab.url);
    }
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    setInjectedState(tabId, null).catch(() => {});
  }
  if (changeInfo.status === 'complete') {
    updateIconForTab(tabId).catch((e) => {
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
    if (tab && tab.id) await updateIconForTab(tab.id, tab.url);
  } catch (e) {
    console.warn('[toc] onCreated: updateIconForTab failed:', e, { tabId: tab?.id });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  setInjectedState(tabId, null).catch(() => {});
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await setGlobalDefaultIconDisabled();
    const tabs = await chrome.tabs.query({});
    const map = await getEnabledMap();
    const updatePromises = tabs.map(async (t) => {
      if (t.id) await updateIconForTab(t.id, t.url).catch(() => {});
      if (t.id && t.url && isHttpUrl(t.url)) {
        const origin = originFromUrl(t.url);
        if (map[origin]) {
          await ensureContentScript(t.id, t.url);
        }
      }
    });
    await Promise.all(updatePromises);
  } catch (e) {
    console.warn('[toc] onInstalled failed:', e);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await setGlobalDefaultIconDisabled();
    const tabs = await chrome.tabs.query({});
    const map = await getEnabledMap();
    const updatePromises = tabs.map(async (t) => {
      if (t.id) await updateIconForTab(t.id, t.url).catch(() => {});
      if (t.id && t.url && isHttpUrl(t.url)) {
        const origin = originFromUrl(t.url);
        if (map[origin]) {
          await ensureContentScript(t.id, t.url);
        }
      }
    });
    await Promise.all(updatePromises);
  } catch (e) {
    console.warn('[toc] onStartup failed:', e);
  }
});

(async () => {
  await setGlobalDefaultIconDisabled();
})();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (!msg || !msg.type) return;
    if (msg.type === 'toc:ensureIcon') {
      const tabId = sender?.tab?.id;
      if (!tabId) { sendResponse && sendResponse({ ok: false, reason: 'no-tab' }); return; }
      updateIconForTab(tabId).then(() => {
        sendResponse && sendResponse({ ok: true });
      }).catch((e) => {
        console.warn('[toc] onMessage: updateIconForTab failed:', e, { tabId });
        sendResponse && sendResponse({ ok: false });
      });
      return true;
    }
  } catch (e) {
    console.warn('[toc] onMessage handler failed:', e);
  }
});

async function getTabsByOrigin(origin) {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => {
    if (!t || !t.url || !isHttpUrl(t.url)) return false;
    return originFromUrl(t.url) === origin;
  });
}



