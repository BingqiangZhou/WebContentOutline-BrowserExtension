// Background service worker for MV3 - per-site enable/disable and dynamic icon

// ---- Site-level storage (chrome.storage.local) ----
const STORAGE_KEYS = { SITE_ENABLE_MAP: 'tocSiteEnabledMap' };

function originFromUrl(url) {
  try { return new URL(url).origin; } catch (e) { return ''; }
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
// In MV3, setIcon with tabId requires absolute paths via chrome.runtime.getURL()
function getIconPathMap(enabled) {
  const base = enabled ? 'icons/png/toc-enabled' : 'icons/png/toc-disabled';
  return {
    "16": chrome.runtime.getURL(`${base}-16.png`),
    "32": chrome.runtime.getURL(`${base}-32.png`),
    "48": chrome.runtime.getURL(`${base}-48.png`),
    "128": chrome.runtime.getURL(`${base}-128.png`)
  };
}

// ---- Action helpers ----
// In MV3, chrome.action.setIcon returns a Promise, no callback needed
async function setActionIconAsync(details) {
  try {
    await chrome.action.setIcon(details);
    return true;
  } catch (e) {
    console.error('[toc] setIcon error:', e.message);
    return false;
  }
}

// In MV3, chrome.action.setTitle returns a Promise, no callback needed
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
  if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) {
    try {
      const t = await chrome.tabs.get(tabId);
      finalUrl = t?.url || '';
    } catch (_) {}
  }

  // If still no http(s) URL, set disabled icon as a safe default and return
  if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) {
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

async function updateIconsForOrigin(origin) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id && t.url && originFromUrl(t.url) === origin) {
        await updateIconForTab(t.id, t.url);
      }
    }
  } catch (e) {
    console.warn('[toc] updateIconsForOrigin failed:', e, { origin });
  }
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
      } catch (e) {
        console.warn('[toc] sendMessage to tab failed:', e, { tabId: t.id, url: t.url });
      }
    }
  } catch (e) {
    console.warn('[toc] broadcastEnabledToOrigin failed:', e, { origin, enabled });
  }
}

// Request the content script in a tab to open the TOC panel
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
  if (!/^https?:\/\//i.test(url)) return;
  const origin = originFromUrl(url);

  const enabled = await toggleEnabledByOrigin(origin);

  // Update icon for current tab
  const path = getIconPathMap(enabled);
  try {
    await setActionIconAsync({ tabId: tab.id, path });
    const titleKey = enabled ? 'titleEnabled' : 'titleDisabled';
    const title = chrome.i18n.getMessage(titleKey) || (enabled ? 'Web TOC: Enabled' : 'Web TOC: Disabled');
    await setActionTitleAsync({ tabId: tab.id, title });
  } catch (e) {
    console.error('[toc] failed to set icon:', e);
  }

  // Also refresh icons for other tabs of the same origin
  await updateIconsForOrigin(origin);

  // Broadcast enable state to same-origin tabs so their UIs update/cleanup
  await broadcastEnabledToOrigin(origin, enabled, tab.id);

  try {
    chrome.tabs.sendMessage(tab.id, { type: 'toc:updateEnabled', enabled }, () => { void chrome.runtime.lastError; });
  } catch (e) {
    console.warn('[toc] sendMessage in handleActionClick failed:', e);
  }

  if (enabled) {
    await requestOpenPanel(tab.id);
  }
}

// ---- Event wiring ----
chrome.action.onClicked.addListener(handleActionClick);

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateIconForTab(activeInfo.tabId).catch(e => {
    console.warn('[toc] onActivated: updateIconForTab failed:', e);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 只在页面加载完成时更新图标，避免频繁更新
  if (changeInfo.status === 'complete') {
    // 异步更新图标，添加错误处理
    updateIconForTab(tabId).catch((e) => {
      console.warn('[toc] onUpdated: updateIconForTab failed:', e);
    });
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    if (tab && tab.id) await updateIconForTab(tab.id);
  } catch (e) {
    console.warn('[toc] onCreated: updateIconForTab failed:', e, { tabId: tab?.id });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await setGlobalDefaultIconDisabled();
    const tabs = await chrome.tabs.query({});
    // 并行更新所有标签页图标，提高性能
    const updatePromises = tabs.map(t => {
      if (t.id) return updateIconForTab(t.id).catch(e => {
        console.warn('[toc] onInstalled: updateIconForTab failed for tab', t.id, e);
      });
      return Promise.resolve();
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
    // 并行更新所有标签页图标，提高性能
    const updatePromises = tabs.map(t => {
      if (t.id && t.url) return updateIconForTab(t.id, t.url).catch(e => {
        console.warn('[toc] onStartup: updateIconForTab failed for tab', t.id, e);
      });
      return Promise.resolve();
    });
    await Promise.all(updatePromises);
  } catch (e) {
    console.warn('[toc] onStartup failed:', e);
  }
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
      }).catch((e) => {
        console.warn('[toc] onMessage: updateIconForTab failed:', e, { tabId });
        sendResponse && sendResponse({ ok: false });
      });
      return true; // async response
    }
  } catch (e) {
    console.warn('[toc] onMessage handler failed:', e);
  }
});
