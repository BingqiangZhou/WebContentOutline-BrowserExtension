// Background service worker for MV3 - per-site enable/disable and dynamic icon

// ---- Site-level storage (chrome.storage.local) ----
const STORAGE_KEYS = { SITE_ENABLE_MAP: 'tocSiteEnabledMap' };

function originFromUrl(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

function getEnabledMap() {
  const KEY = STORAGE_KEYS.SITE_ENABLE_MAP;
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get([KEY], (res) => {
          if (chrome.runtime.lastError) {
            console.warn('[toc] getEnabledMap storage error:', chrome.runtime.lastError);
            resolve({});
          } else {
            resolve(res[KEY] || {});
          }
        });
      } else {
        resolve({});
      }
    } catch (e) {
      console.warn('[toc] getEnabledMap failed:', e);
      resolve({});
    }
  });
}

function saveEnabledMap(map) {
  const KEY = STORAGE_KEYS.SITE_ENABLE_MAP;
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ [KEY]: map }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[toc] saveEnabledMap storage error:', chrome.runtime.lastError);
          }
          resolve();
        });
      } else {
        resolve();
      }
    } catch (e) {
      console.warn('[toc] saveEnabledMap failed:', e);
      resolve();
    }
  });
}

async function getEnabledByOrigin(origin) {
  const map = await getEnabledMap();
  return !!(origin && map[origin]);
}

async function toggleEnabledByOrigin(origin) {
  const map = await getEnabledMap();
  const next = !map[origin];
  map[origin] = next;
  await saveEnabledMap(map);
  return next;
}

// ---- Icon paths ----
function getIconPathMap(enabled) {
  const base = enabled ? 'icons/png/toc-enabled' : 'icons/png/toc-disabled';
  try {
    return {
      "16": chrome.runtime.getURL(`${base}-16.png`),
      "32": chrome.runtime.getURL(`${base}-32.png`)
    };
  } catch (_) {
    // Fallback to relative if runtime not ready
    return {
      "16": `${base}-16.png`,
      "32": `${base}-32.png`
    };
  }
}

// ---- Action helpers (callback -> Promise with error logging) ----
function setActionIconAsync(details) {
  return new Promise((resolve) => {
    try {
      chrome.action.setIcon(details, () => {
        const err = chrome.runtime?.lastError;
        if (err) console.warn('[toc] setIcon error:', err, details);
        resolve(!err);
      });
    } catch (e) {
      console.warn('[toc] setIcon threw:', e, details);
      resolve(false);
    }
  });
}

function setActionTitleAsync(details) {
  return new Promise((resolve) => {
    try {
      chrome.action.setTitle(details, () => {
        const err = chrome.runtime?.lastError;
        if (err) console.warn('[toc] setTitle error:', err, details);
        resolve(!err);
      });
    } catch (e) {
      console.warn('[toc] setTitle threw:', e, details);
      resolve(false);
    }
  });
}

async function setGlobalDefaultIconDisabled() {
  try {
    const path = getIconPathMap(false);
    await setActionIconAsync({ path });
    await setActionTitleAsync({ title: '网页目录助手：禁用（按站点，点击启用）' });
  } catch (e) { console.warn('[toc] setGlobalDefaultIconDisabled failed:', e); }
}

async function updateIconForTab(tabId, url) {
  if (!tabId) return;
  let finalUrl = url;
  if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) {
    try {
      const t = await chrome.tabs.get(tabId);
      finalUrl = t?.url || '';
    } catch (_) {}
  }

  // If still no http(s) URL, set disabled icon as a safe default and return
  if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) {
    const fallbackPath = getIconPathMap(false);
    console.debug('[toc] updateIconForTab: non-http(s), set disabled', { tabId, finalUrl });
    await setActionIconAsync({ tabId, path: fallbackPath });
    await setActionTitleAsync({ tabId, title: '网页内容大纲：禁用（按站点，点击启用）' });
    return;
  }

  const origin = originFromUrl(finalUrl);
  const enabled = await getEnabledByOrigin(origin);
  try {
    const path = getIconPathMap(enabled);
    console.debug('[toc] updateIconForTab', { tabId, url: finalUrl, origin, enabled, path });
    const okDict = await setActionIconAsync({ tabId, path });
    if (!okDict) {
      // fallback to single 32px path
      const single = enabled ? 'icons/png/toc-enabled-32.png' : 'icons/png/toc-disabled-32.png';
      const singleAbs = (typeof chrome?.runtime?.getURL === 'function') ? chrome.runtime.getURL(single) : single;
      console.debug('[toc] setIcon fallback(single)', { tabId, singleAbs });
      await setActionIconAsync({ tabId, path: singleAbs });
    }
    await setActionTitleAsync({ tabId, title: enabled ? '网页目录助手：启用（按站点，点击禁用）' : '网页目录助手：禁用（按站点，点击启用）' });
  } catch (e) { console.warn('[toc] updateIconForTab failed:', e, { tabId, url: finalUrl, enabled }); }
}

async function updateIconsForOrigin(origin) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id && t.url && originFromUrl(t.url) === origin) {
        await updateIconForTab(t.id, t.url);
      }
    }
  } catch (e) {}
}

async function broadcastEnabledToOrigin(origin, enabled, exceptTabId) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.id || !t.url) continue;
      if (originFromUrl(t.url) !== origin) continue;
      if (exceptTabId && t.id === exceptTabId) continue;
      try {
        chrome.tabs.sendMessage(t.id, { type: 'toc:updateEnabled', enabled }, () => { void chrome.runtime.lastError; });
      } catch (e) {}
    }
  } catch (e) {}
}

// Request the content script in a tab to open the TOC panel
async function requestOpenPanel(tabId) {
  try {
    chrome.tabs.sendMessage(tabId, { type: 'toc:openPanel' }, () => { void chrome.runtime.lastError; });
  } catch (e) {}
}

async function handleActionClick(tab) {
  if (!tab || !tab.id || !tab.url) return;
  const url = tab.url;
  if (!/^https?:\/\//i.test(url)) return;
  const origin = originFromUrl(url);
  console.debug('[toc] action click', { tabId: tab.id, url, origin });
  const enabled = await toggleEnabledByOrigin(origin);
  await updateIconForTab(tab.id, url);
  // Also refresh icons for other tabs of the same origin
  await updateIconsForOrigin(origin);

  // Broadcast enable state to same-origin tabs so their UIs update/cleanup
  await broadcastEnabledToOrigin(origin, enabled, tab.id);

  try {
    chrome.tabs.sendMessage(tab.id, { type: 'toc:updateEnabled', enabled }, () => { void chrome.runtime.lastError; });
  } catch (e) {}

  if (enabled) {
    await requestOpenPanel(tab.id);
  }
}

// ---- Event wiring ----
chrome.action.onClicked.addListener(handleActionClick);

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await updateIconForTab(activeInfo.tabId);
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    updateIconForTab(tabId);
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    if (tab && tab.id) await updateIconForTab(tab.id);
  } catch (e) {}
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await setGlobalDefaultIconDisabled();
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id) await updateIconForTab(t.id);
    }
  } catch (e) {}
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await setGlobalDefaultIconDisabled();
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id && t.url) await updateIconForTab(t.id, t.url);
    }
  } catch (e) {}
});

// Set default disabled icon at service worker initialization as well
(async () => {
  await setGlobalDefaultIconDisabled();
})();

// Allow content scripts to request an immediate icon sync before UI setup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (!msg || !msg.type) return;
    if (msg.type === 'toc:ensureIcon') {
      const tabId = sender?.tab?.id;
      if (!tabId) { sendResponse && sendResponse({ ok: false, reason: 'no-tab' }); return; }
      updateIconForTab(tabId).then(() => {
        sendResponse && sendResponse({ ok: true });
      }).catch(() => {
        sendResponse && sendResponse({ ok: false });
      });
      return true; // async response
    }
  } catch (_) {}
});
