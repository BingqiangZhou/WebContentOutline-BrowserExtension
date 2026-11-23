// Background service-worker harness: loads entrypoints/background.ts into a vm
// sandbox with a fake `browser` so storage-cache, broadcast, and badge behavior
// can be driven end-to-end through the real action-click flow.
//
// Shared by the cache tests (this file), the parallel-broadcast tests, and the
// unsupported-page badge tests below.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { stripTsSyntax, stripImportsAndExports, loadTocMessage } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The REAL config-mutation primitive, so a test can see what a MUTATE_CONFIG
// message actually leaves in storage.
const realApplyTocConfigMutation = (() => {
  const file = path.join(repoRoot, 'src/shared/primitives.ts');
  const source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  const sandbox = { console, SELECTOR_EXPR_MAX_LENGTH: 2000, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.applyTocConfigMutation = applyTocConfigMutation;', sandbox, { filename: file });
  return sandbox.__exports.applyTocConfigMutation;
})();

function loadBackground(initialMap, overrides, stored) {
  overrides = overrides || {};
  const file = path.join(repoRoot, 'entrypoints/background.ts');
  const source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));

  const store = Object.assign({ tocSiteEnabledMap: Object.assign({}, initialMap || {}) }, stored || {});
  let storageReadCount = 0;
  const iconByTab = new Map(); // tabId -> enabled (last wins)
  const badgeTexts = [];
  const badgeApiCalls = []; // ordered: {api, text?}
  const injections = [];
  const sentMessages = [];
  const timers = [];
  let nextTimerId = 1;
  const storageChangedListeners = [];
  let actionClickListener = null;
  let tabsUpdatedListener = null;
  let messageListener = null;
  let tabsList = [];
  // Optional gates: hold the FIRST storage read / write until released, so a
  // test can land an onChanged write mid-flight (the TOCTOU window).
  let readGate = null;
  let setGate = null;
  let holdingRead = !!overrides.holdFirstRead;
  let holdingSet = !!overrides.holdFirstSet;

  const browser = {
    storage: {
      local: {
        get: async function (keys) {
          storageReadCount++;
          // Snapshot FIRST, then optionally hold: a real in-flight read
          // returns the state from when it was ISSUED, not when it resolves.
          const out = {};
          (keys || []).forEach(function (k) { out[k] = store[k]; });
          if (holdingRead) {
            holdingRead = false;
            await new Promise(function (resolve) { readGate = resolve; });
          }
          return out;
        },
        set: async function (obj) {
          if (holdingSet) {
            holdingSet = false;
            await new Promise(function (resolve) { setGate = resolve; });
          }
          Object.assign(store, obj);
        }
      },
      onChanged: {
        addListener: function (fn) { storageChangedListeners.push(fn); }
      }
    },
    action: {
      onClicked: { addListener: function (fn) { actionClickListener = fn; } },
      setIcon: async function (opts) {
        if (opts && opts.tabId != null) {
          iconByTab.set(opts.tabId, JSON.stringify(opts.path || {}).indexOf('toc-enabled') >= 0);
        }
      },
      setTitle: async function () {},
      setBadgeText: async function (details) {
        badgeApiCalls.push({ api: 'setBadgeText', tabId: details.tabId, text: details.text });
        if (overrides.badgeThrowOnClear && details && details.text === '') {
          throw new Error('no tab with id');
        }
        badgeTexts.push({ tabId: details.tabId, text: details.text });
      },
      setBadgeBackgroundColor: async function (details) {
        badgeApiCalls.push({ api: 'setBadgeBackgroundColor', tabId: details.tabId });
      }
    },
    tabs: {
      query: async function () { return tabsList.map(function (t) { return Object.assign({}, t); }); },
      get: async function (tabId) {
        const t = tabsList.filter(function (x) { return x.id === tabId; })[0];
        return Object.assign({}, t || { id: tabId, url: 'https://a.example/x' });
      },
      sendMessage: function (tabId, msg, cb) {
        sentMessages.push({ tabId: tabId, type: msg && msg.type, enabled: msg && msg.enabled });
        try {
          if (cb) cb(overrides.pingOk === false ? undefined : { ok: true });
        } catch (_) {}
      },
      onActivated: { addListener: function () {} },
      onUpdated: { addListener: function (fn) { tabsUpdatedListener = fn; } },
      onCreated: { addListener: function () {} },
      onRemoved: { addListener: function () {} }
    },
    runtime: {
      id: 'test-extension',
      lastError: null,
      onInstalled: { addListener: function () {} },
      onStartup: { addListener: function () {} },
      onMessage: { addListener: function (fn) { messageListener = fn; } },
      // Realistic: an absolute extension URL (background.ts compares sender URLs against it).
      getURL: function (p) { return 'chrome-extension://test-extension/' + String(p); }
    },
    i18n: { getMessage: function (key) { return key; } },
    scripting: {
      executeScript: async function (opts) { injections.push(opts.target.tabId); }
    }
  };

  const sandbox = {
    console: console,
    browser: browser,
    defineBackground: function (fn) { sandbox.__bgInit = fn; },
    setTimeout: function (fn, delay) {
      const id = nextTimerId++;
      timers.push({ id: id, fn: fn });
      return id;
    },
    clearTimeout: function (id) {
      for (let i = 0; i < timers.length; i++) {
        if (timers[i].id === id) { timers.splice(i, 1); return; }
      }
    },
    // Stripped-import shims (module-local fakes; only storage semantics matter here)
    serializedWrite: function (_key, asyncFn) { return asyncFn(); },
    isQuotaExceededError: function () { return false; },
    touchObjectKey: function (map, key, value) { map[key] = value; },
    pruneObjectToLimit: function (map) { return map; },
    applyTocConfigMutation: realApplyTocConfigMutation,
    applyUiStateMutation: function () { return { ok: true, map: {} }; },
    validateUiStateMutationSource: function () { return { ok: true }; },
    originFromUrl: function (url) {
      try { return new URL(url).origin; } catch (_) { return ''; }
    },
    MAP_MAX_KEYS: 400,
    TOC_MESSAGE: loadTocMessage(),
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: file });

  // Trigger the WXT entry (defineBackground callback → startBackground).
  sandbox.__bgInit();

  return {
    clickToolbarIcon: async function (tab) {
      assert.ok(actionClickListener, 'action.onClicked listener should be registered');
      await actionClickListener(tab);
    },
    fireStorageChanged: function (newValue) {
      // Faithful: onChanged fires BECAUSE the value was written — update the
      // backing store too, so unheld concurrent reads see the new state.
      store.tocSiteEnabledMap = newValue;
      storageChangedListeners.forEach(function (fn) {
        fn({ tocSiteEnabledMap: { newValue: newValue } }, 'local');
      });
    },
    releaseRead: function () { if (readGate) { readGate(); readGate = null; } },
    releaseSet: function () { if (setGate) { setGate(); setGate = null; } },
    flush: async function () {
      for (let i = 0; i < 6; i++) await new Promise(function (r) { setImmediate(r); });
    },
    fireTabCompleted: async function (tab) {
      assert.ok(tabsUpdatedListener, 'tabs.onUpdated listener should be registered');
      tabsUpdatedListener(tab.id, { status: 'complete' }, tab);
      await this.flush();
    },
    // Deliver a runtime message the way chrome does and return the payload the
    // listener passed to sendResponse once its async work has settled.
    fireMessage: async function (msg, sender) {
      assert.ok(messageListener, 'runtime.onMessage listener should be registered');
      let payload;
      messageListener(msg, sender, function (response) { payload = response; });
      await new Promise(function (resolve) { setImmediate(resolve); });
      await this.flush();
      return payload;
    },
    setTabs: function (tabs) { tabsList = tabs; },
    storageReads: function () { return storageReadCount; },
    storedMap: function () { return store.tocSiteEnabledMap; },
    storedConfigs: function () { return (store.tocConfigs || []).slice(); },
    iconOf: function (tabId) { return iconByTab.get(tabId); },
    badgeTexts: function () { return badgeTexts.slice(); },
    badgeApiCalls: function () { return badgeApiCalls.slice(); },
    injectedTabs: function () { return injections.slice(); },
    sentMessages: function () { return sentMessages.slice(); },
    runTimers: function () {
      const due = timers.splice(0, timers.length);
      due.forEach(function (t) { t.fn(); });
    }
  };
}

test('enabled-map reads hit storage once and follow onChanged updates', async () => {
  const env = loadBackground({ 'https://a.example': false });
  await env.clickToolbarIcon({ id: 1, url: 'https://a.example/x' }); // enable
  assert.equal(env.storageReads(), 1, 'first read populates the cache');
  assert.equal(env.storedMap()['https://a.example'], true);
  await env.clickToolbarIcon({ id: 1, url: 'https://a.example/x' }); // disable
  assert.equal(env.storageReads(), 1, 'second toggle served from the cache');
  assert.equal(env.storedMap()['https://a.example'], false);
  env.fireStorageChanged({ 'https://a.example': true }); // options page wrote
  await env.clickToolbarIcon({ id: 1, url: 'https://a.example/x' }); // sees enabled → disables
  assert.equal(env.storageReads(), 1, 'onChanged replaced the cache, not a re-read');
  assert.equal(env.storedMap()['https://a.example'], false);
});

test('broadcast fans out to all same-origin tabs in parallel', async () => {
  const env = loadBackground({ 'https://a.example': false }, { pingOk: false });
  env.setTabs([
    { id: 1, url: 'https://a.example/x' }, // the clicked tab
    { id: 2, url: 'https://a.example/y' },
    { id: 3, url: 'https://a.example/z' },
    { id: 4, url: 'https://other.example/w' } // different origin — excluded
  ]);
  await env.clickToolbarIcon({ id: 1, url: 'https://a.example/x' });
  assert.deepEqual(env.injectedTabs().sort(function (a, b) { return a - b; }), [1, 2, 3]);
  assert.equal(env.iconOf(2), true); // per-tab icons set
  assert.equal(env.iconOf(3), true);
  assert.equal(env.iconOf(4), undefined, 'different-origin tab untouched');
  assert.ok(env.sentMessages().some(function (m) { return m.tabId === 2 && m.enabled === true; }));
  // The broadcast loop fans out in parallel (allSettled), not a serial await chain.
  const backgroundSource = fs.readFileSync(path.join(repoRoot, 'entrypoints/background.ts'), 'utf8');
  const fnBody = backgroundSource.match(/async function broadcastEnabledToOrigin\([\s\S]*?\n\}/);
  assert.ok(fnBody, 'broadcastEnabledToOrigin should exist');
  assert.match(fnBody[0], /Promise\.allSettled\(/);
});

test('clicking the icon on an unsupported page flashes the badge and clears it', async () => {
  const env = loadBackground({});
  await env.clickToolbarIcon({ id: 7, url: 'chrome://extensions/' });
  // Entry clear (stuck-badge self-heal) runs first, then the flash.
  assert.deepEqual(env.badgeTexts(), [{ tabId: 7, text: '' }, { tabId: 7, text: '!' }]);
  env.runTimers();
  assert.deepEqual(env.badgeTexts(), [{ tabId: 7, text: '' }, { tabId: 7, text: '!' }, { tabId: 7, text: '' }]);
  // Tab gone / API rejects during clear — no unhandled rejection, badge already shown.
  const env2 = loadBackground({}, { badgeThrowOnClear: true });
  await env2.clickToolbarIcon({ id: 8, url: 'file:///C:/x' });
  env2.runTimers();
  assert.deepEqual(env2.badgeTexts(), [{ tabId: 8, text: '!' }]);
});

test('a storage read resolving after an onChanged write must not pin the stale map', async () => {
  const env = loadBackground({ 'https://a.example': false }, { holdFirstRead: true });
  const nav = env.fireTabCompleted({ id: 5, url: 'https://a.example/x' }); // cold read starts, held
  await env.flush();
  env.fireStorageChanged({ 'https://a.example': true }); // options-page write lands mid-flight
  env.releaseRead(); // the pre-write snapshot resolves now
  await nav;
  await env.flush();
  // The CURRENT navigation used its own in-flight (stale) read; the NEXT one
  // must be served the onChanged value, not the stale snapshot.
  await env.fireTabCompleted({ id: 6, url: 'https://a.example/y' });
  assert.equal(env.iconOf(6), true, 'onChanged value must win over the stale in-flight read');
});

test('a foreign write landing during our save must not be stomped by the save result', async () => {
  const env = loadBackground({ 'https://a.example': false }, { holdFirstSet: true });
  const click = env.clickToolbarIcon({ id: 1, url: 'https://a.example/x' }); // enable; set held mid-flight
  await env.flush();
  // A NEWER foreign write (options page enabling another origin) lands while
  // our own set is still in flight.
  env.fireStorageChanged({ 'https://a.example': true, 'https://b.example': true });
  env.releaseSet();
  await click;
  await env.flush();
  await env.fireTabCompleted({ id: 6, url: 'https://b.example/y' });
  assert.equal(env.iconOf(6), true, 'the newer foreign write must survive our in-flight save');
});

test('badge flash sets the background color before the badge text', async () => {
  const env = loadBackground({});
  await env.clickToolbarIcon({ id: 7, url: 'chrome://extensions/' });
  const calls = env.badgeApiCalls();
  const colorIdx = calls.findIndex(function (c) { return c.api === 'setBadgeBackgroundColor'; });
  const bangIdx = calls.findIndex(function (c) { return c.api === 'setBadgeText' && c.text === '!'; });
  assert.ok(colorIdx >= 0 && bangIdx > colorIdx, 'color set before the badge text appears — no default-red first frame');
});

test('a later click clears any leftover badge for that tab', async () => {
  const env = loadBackground({});
  await env.clickToolbarIcon({ id: 7, url: 'chrome://extensions/' }); // '!' flashed
  // (clear timer not run — the SW could have been evicted before it fired)
  await env.clickToolbarIcon({ id: 7, url: 'https://a.example/x' }); // enable on a supported page
  assert.ok(
    env.badgeTexts().some(function (b) { return b.tabId === 7 && b.text === ''; }),
    'the next click clears a stuck badge'
  );
});

// ---------------------------------------------------------------------------
// PERSIST_ACTIVE_STATE: who may change which origin's enabled state
//
// MUTATE_CONFIG and MUTATE_UI_STATE already bind a request to the sender's own
// site. PERSIST_ACTIVE_STATE took the payload's origin at face value, so a
// content script on one site could switch another site on or off.
// ---------------------------------------------------------------------------

const TOC_MESSAGE = loadTocMessage();
// A content script: `url` is the page document it runs in, and it lives in a tab.
const CONTENT_SENDER = { id: 'test-extension', url: 'https://a.example/x', tab: { id: 1, url: 'https://a.example/x' } };
// The options page, in both shapes it really arrives in. Each carries a tab:
// opened as its own tab, or embedded in the extensions page (then the tab is
// chrome://extensions). `sender.tab` therefore cannot tell it from a content script.
const OPTIONS_PAGE = 'chrome-extension://test-extension/options.html';
const OPTIONS_SENDERS = [
  { as: 'its own tab', sender: { id: 'test-extension', url: OPTIONS_PAGE, tab: { id: 7, url: OPTIONS_PAGE } } },
  { as: 'embedded in the extensions page', sender: { id: 'test-extension', url: OPTIONS_PAGE, tab: { id: 8, url: 'chrome://extensions/' } } },
  { as: 'a tab-less context', sender: { id: 'test-extension', url: OPTIONS_PAGE } }
];

function persist(enabled, origin) {
  return { type: TOC_MESSAGE.PERSIST_ACTIVE_STATE, enabled, origin };
}

test('a content script cannot persist the enabled state of another origin', async () => {
  const env = loadBackground({});
  const res = await env.fireMessage(persist(true, 'https://evil.example'), CONTENT_SENDER);
  assert.equal(res && res.ok, false);
  assert.equal(res && res.reason, 'bad-origin');
  assert.equal(env.storedMap()['https://evil.example'], undefined, 'the other site stays untouched');
  assert.equal(env.storedMap()['https://a.example'], undefined, 'the sender does not change either');
});

test('a content script persists its own origin, named or implied', async () => {
  const named = loadBackground({});
  const namedRes = await named.fireMessage(persist(true, 'https://a.example'), CONTENT_SENDER);
  assert.equal(namedRes && namedRes.ok, true);
  assert.equal(named.storedMap()['https://a.example'], true);
  assert.equal(named.iconOf(1), true, 'the tab icon follows');

  const implied = loadBackground({});
  const impliedRes = await implied.fireMessage(persist(true, ''), CONTENT_SENDER);
  assert.equal(impliedRes && impliedRes.ok, true);
  assert.equal(implied.storedMap()['https://a.example'], true);
});

test('the options page may name any origin, but has to name one', async () => {
  for (const { as, sender } of OPTIONS_SENDERS) {
    const env = loadBackground({});
    const named = await env.fireMessage(persist(false, 'https://other.example'), sender);
    assert.equal(named && named.ok, true, `options page as ${as}: the toggle must work`);
    assert.equal(env.storedMap()['https://other.example'], false);

    const nameless = await env.fireMessage(persist(true, ''), sender);
    assert.equal(nameless && nameless.ok, false, `options page as ${as}: no origin to persist`);
    assert.equal(nameless && nameless.reason, 'bad-origin');
  }
});

test('a content script can only mutate the config of its own site; the options page can mutate any', async () => {
  // The in-page config dialog is bound to its own site (MUTATE_CONFIG). The
  // options page has no site and names the pattern — it used to be refused like
  // a cross-site content script, which is why it wrote config storage directly.
  const configB = { urlPattern: 'https://b.example/*', selectors: [{ type: 'css', expr: 'h2' }], updatedAt: 1 };
  const clearB = { type: TOC_MESSAGE.MUTATE_CONFIG, operation: 'clear-site', urlPattern: 'https://b.example/*' };
  const env = loadBackground({}, {}, { tocConfigs: [configB] });

  const fromOtherSite = await env.fireMessage(clearB, CONTENT_SENDER);   // a content script on a.example
  assert.equal(fromOtherSite && fromOtherSite.ok, false);
  assert.equal(fromOtherSite && fromOtherSite.reason, 'bad-site');
  assert.equal(env.storedConfigs().length, 1, 'the config of the other site survives');

  const fromOptions = await env.fireMessage(clearB, OPTIONS_SENDERS[0].sender);   // the options page, in its own tab
  assert.equal(fromOptions && fromOptions.ok, true, 'the options page names the site it changes');
  assert.equal(env.storedConfigs().length, 0);
});
