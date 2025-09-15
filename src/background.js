// Background service worker for MV3 - per-site enable/disable and dynamic icon

// Storage keys
const STORAGE_KEYS = {
  SITE_ENABLE_MAP: 'tocSiteEnabledMap'
};

// ---- Storage helpers ----
function getEnabledMap() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get([STORAGE_KEYS.SITE_ENABLE_MAP], (res) => {
        resolve(res[STORAGE_KEYS.SITE_ENABLE_MAP] || {});
      });
    } catch (e) {
      resolve({});
    }
  });
}

function saveEnabledMap(map) {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.set({ [STORAGE_KEYS.SITE_ENABLE_MAP]: map }, () => resolve());
    } catch (e) {
      resolve();
    }
  });
}

function originFromUrl(url) {
  try { return new URL(url).origin; } catch { return ''; }
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

// ---- Icon drawing ----
function drawListIcon(size, enabled) {
  try {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    const fg = enabled ? '#00C853' : '#8A8A8A';
    const bullet = enabled ? '#00C853' : '#6E6E6E';

    const padding = Math.round(size * 0.15); // 15% padding
    const lineHeight = Math.round(size * 0.16);
    const gap = Math.round(size * 0.08);
    const bulletSize = Math.max(1, Math.round(size * 0.14));

    let xText = padding + bulletSize + Math.round(size * 0.10);
    let y = padding;

    ctx.lineWidth = Math.max(1, Math.round(size * 0.10));
    ctx.lineCap = 'round';

    for (let i = 0; i < 3; i++) {
      // Bullet squares
      ctx.fillStyle = bullet;
      const bx = padding;
      const by = y + Math.floor((lineHeight - bulletSize) / 2);
      const br = Math.max(1, Math.round(bulletSize * 0.2));
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(bx, by, bulletSize, bulletSize, br);
        ctx.fill();
      } else {
        ctx.fillRect(bx, by, bulletSize, bulletSize);
      }

      // Lines
      ctx.strokeStyle = fg;
      ctx.beginPath();
      ctx.moveTo(xText, y + Math.floor(lineHeight / 2));
      ctx.lineTo(size - padding, y + Math.floor(lineHeight / 2));
      ctx.stroke();

      y += lineHeight + gap;
    }

    return ctx.getImageData(0, 0, size, size);
  } catch (e) {
    // Fallback: transparent image
    try { return new ImageData(size, size); } catch { return null; }
  }
}

async function buildIconImages(enabled) {
  const sizes = [16, 32, 48, 128];
  const imageData = {};
  for (const s of sizes) {
    const data = drawListIcon(s, enabled);
    if (data) imageData[s] = data;
  }
  return imageData;
}

async function updateIconForTab(tabId, url) {
  if (!tabId || !url || !/^https?:\/\//i.test(url)) return;
  const origin = originFromUrl(url);
  const enabled = await getEnabledByOrigin(origin);
  const images = await buildIconImages(enabled);
  try {
    await chrome.action.setIcon({ tabId, imageData: images });
    await chrome.action.setTitle({ tabId, title: enabled ? '网页内容大纲：启用（点击禁用本网站）' : '网页内容大纲：禁用（点击启用本网站）' });
  } catch (e) {}
}

async function handleActionClick(tab) {
  if (!tab || !tab.id || !tab.url) return;
  const url = tab.url;
  if (!/^https?:\/\//i.test(url)) return;
  const origin = originFromUrl(url);
  const enabled = await toggleEnabledByOrigin(origin);

  // Update icon
  await updateIconForTab(tab.id, url);

  // Notify content script
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'toc:updateEnabled', enabled }, () => {
      // ignore response
    });
  } catch (e) {}
}

// ---- Event wiring ----
chrome.action.onClicked.addListener(handleActionClick);

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.id) await updateIconForTab(tab.id, tab.url || '');
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    updateIconForTab(tabId, (changeInfo.url || tab?.url || '')); 
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id && t.url) await updateIconForTab(t.id, t.url);
    }
  } catch (e) {}
});
