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

function loadBackground(initialMap, overrides) {
  overrides = overrides || {};
  const file = path.join(repoRoot, 'entrypoints/background.ts');
  const source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));

  const store = { tocSiteEnabledMap: Object.assign({}, initialMap || {}) };
  let storageReadCount = 0;
  const iconByTab = new Map(); // tabId -> enabled (last wins)
  const badgeTexts = [];
  const injections = [];
  const sentMessages = [];
  const timers = [];
  let nextTimerId = 1;
  const storageChangedListeners = [];
  let actionClickListener = null;
  let tabsList = [];

  const browser = {
    storage: {
      local: {
        get: async function (keys) {
          storageReadCount++;
          const out = {};
          (keys || []).forEach(function (k) { out[k] = store[k]; });
          return out;
        },
        set: async function (obj) { Object.assign(store, obj); }
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
        if (overrides.badgeThrowOnClear && details && details.text === '') {
          throw new Error('no tab with id');
        }
        badgeTexts.push({ tabId: details.tabId, text: details.text });
      },
      setBadgeBackgroundColor: async function () {}
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
      onUpdated: { addListener: function () {} },
      onCreated: { addListener: function () {} },
      onRemoved: { addListener: function () {} }
    },
    runtime: {
      id: 'test-extension',
      lastError: null,
      onInstalled: { addListener: function () {} },
      onStartup: { addListener: function () {} },
      onMessage: { addListener: function () {} },
      getURL: function (p) { return String(p); }
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
    applyTocConfigMutation: function () { return { ok: true, changed: false, configs: [] }; },
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
      storageChangedListeners.forEach(function (fn) {
        fn({ tocSiteEnabledMap: { newValue: newValue } }, 'local');
      });
    },
    setTabs: function (tabs) { tabsList = tabs; },
    storageReads: function () { return storageReadCount; },
    storedMap: function () { return store.tocSiteEnabledMap; },
    iconOf: function (tabId) { return iconByTab.get(tabId); },
    badgeTexts: function () { return badgeTexts.slice(); },
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
