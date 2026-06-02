import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadDomWatcher() {
  const file = path.join(repoRoot, 'src/core/dom-watcher.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace('export function createDomWatcher', 'function createDomWatcher');
  let observer = null;
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observeCalls = [];
      observer = this;
    }
    observe(target, options) {
      this.observeCalls.push({ target, options });
    }
    disconnect() {}
    takeRecords() {}
  }
  const documentElement = { nodeType: 1, isConnected: true };
  const sandbox = {
    console,
    Node: { ELEMENT_NODE: 1 },
    document: { documentElement },
    MutationObserver: FakeMutationObserver,
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${source}\n__exports.createDomWatcher = createDomWatcher;`, sandbox, {
    filename: file
  });
  return {
    createDomWatcher: sandbox.__exports.createDomWatcher,
    documentElement,
    getObserver: () => observer,
    setDocumentElement: (next) => { sandbox.document.documentElement = next; }
  };
}

function loadTocBuilder() {
  const file = path.join(repoRoot, 'src/utils/toc-builder.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export function /g, 'function ');
  const requestedLimits = [];
  const sandbox = {
    console,
    uiConst(_name, fallback) { return fallback; },
    collectBySelector(_selector, limit) {
      requestedLimits.push(limit);
      return Array.from({ length: limit }, () => ({ isConnected: false }));
    },
    uniqueInDocumentOrder(nodes) { return nodes; },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.buildTocItemsFromSelectors = buildTocItemsFromSelectors;`,
    sandbox,
    { filename: file }
  );
  return { buildTocItemsFromSelectors: sandbox.__exports.buildTocItemsFromSelectors, requestedLimits };
}

function loadUiStatePrimitives() {
  const file = path.join(repoRoot, 'src/shared/ui-state-primitives.js');
  assert.equal(fs.existsSync(file), true, 'src/shared/ui-state-primitives.js should exist');
  const source = fs.readFileSync(file, 'utf8').replace(/export function /g, 'function ');
  const sandbox = { console, URL, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}
__exports.applyUiStateMutation = applyUiStateMutation;
__exports.validateUiStateMutationSource = validateUiStateMutationSource;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports;
}

function loadStoragePrimitives() {
  const file = path.join(repoRoot, 'src/shared/storage-primitives.js');
  const source = fs.readFileSync(file, 'utf8').replace(/export function /g, 'function ');
  const sandbox = { console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.serializedWrite = serializedWrite;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('default heading mode ignores unrelated attribute mutations', () => {
  const env = loadDomWatcher();
  let calls = 0;
  const watcher = env.createDomWatcher(() => { calls++; }, { selectors: [] });
  watcher.start();

  env.getObserver().callback([{
    type: 'attributes',
    attributeName: 'class',
    target: {
      closest() { return null; },
      querySelector() { return null; }
    }
  }]);

  assert.equal(calls, 0);
});

test('default heading mode reacts when a changed ancestor contains a heading', () => {
  const env = loadDomWatcher();
  let calls = 0;
  const watcher = env.createDomWatcher(() => { calls++; }, { selectors: [] });
  watcher.start();

  env.getObserver().callback([{
    type: 'attributes',
    attributeName: 'class',
    target: {
      closest() { return null; },
      querySelector(selector) { return selector === 'h1, h2, h3, h4, h5, h6' ? {} : null; }
    }
  }]);

  assert.equal(calls, 1);
});

test('DOM watcher rebinds when the observed root changes', () => {
  const env = loadDomWatcher();
  const watcher = env.createDomWatcher(() => {}, { selectors: [] });
  watcher.start();
  const observer = env.getObserver();
  const nextRoot = { nodeType: 1, isConnected: true };

  env.setDocumentElement(nextRoot);
  watcher.checkAndReconnect();

  assert.equal(observer.observeCalls.length, 2);
  assert.equal(observer.observeCalls[1].target, nextRoot);
});

test('TOC builder never requests more than the global candidate budget', () => {
  const env = loadTocBuilder();
  const selectors = Array.from({ length: 50 }, (_, index) => ({
    type: 'css',
    expr: `.heading-${index}`
  }));

  env.buildTocItemsFromSelectors(selectors, {});

  assert.ok(env.requestedLimits.length > 0);
  assert.ok(
    env.requestedLimits.reduce((sum, limit) => sum + limit, 0) <= 1200,
    `requested ${env.requestedLimits.reduce((sum, limit) => sum + limit, 0)} candidates`
  );
});

test('UI state mutations preserve independent position and panel entries', () => {
  const { applyUiStateMutation } = loadUiStatePrimitives();
  const firstPosition = applyUiStateMutation({}, {
    operation: 'set-badge-position',
    key: 'docs.example.com',
    value: { x: 0, y: 120, anchorX: 'left' }
  }, 400);
  const secondPosition = applyUiStateMutation(firstPosition.map, {
    operation: 'set-badge-position',
    key: 'chat.example.com',
    value: { x: 900, y: 260, anchorX: 'right' }
  }, 400);
  const firstPanel = applyUiStateMutation({}, {
    operation: 'set-panel-expanded',
    key: 'https://docs.example.com',
    value: true
  }, 400);
  const secondPanel = applyUiStateMutation(firstPanel.map, {
    operation: 'set-panel-expanded',
    key: 'https://chat.example.com',
    value: false
  }, 400);

  assert.deepEqual(plain(secondPosition.map), {
    'docs.example.com': { x: 0, y: 120, anchorX: 'left' },
    'chat.example.com': { x: 900, y: 260, anchorX: 'right' }
  });
  assert.deepEqual(plain(secondPanel.map), {
    'https://docs.example.com': true,
    'https://chat.example.com': false
  });
});

test('serialized UI state writes preserve concurrent site updates', async () => {
  const { applyUiStateMutation } = loadUiStatePrimitives();
  const { serializedWrite } = loadStoragePrimitives();
  const storage = {};
  const mutate = (storageKey, mutation, delay) => serializedWrite(storageKey, async () => {
    const snapshot = storage[storageKey] || {};
    await new Promise((resolve) => setTimeout(resolve, delay));
    const result = applyUiStateMutation(snapshot, mutation, 400);
    storage[storageKey] = result.map;
  });

  await Promise.all([
    mutate('tocBadgePosMap', {
      operation: 'set-badge-position',
      key: 'docs.example.com',
      value: { x: 10, y: 20 }
    }, 10),
    mutate('tocBadgePosMap', {
      operation: 'set-badge-position',
      key: 'chat.example.com',
      value: { x: 30, y: 40 }
    }, 0),
    mutate('tocPanelExpandedMap', {
      operation: 'set-panel-expanded',
      key: 'https://docs.example.com',
      value: true
    }, 10),
    mutate('tocPanelExpandedMap', {
      operation: 'set-panel-expanded',
      key: 'https://chat.example.com',
      value: false
    }, 0)
  ]);

  assert.deepEqual(Object.keys(storage.tocBadgePosMap), ['docs.example.com', 'chat.example.com']);
  assert.deepEqual(Object.keys(storage.tocPanelExpandedMap), ['https://docs.example.com', 'https://chat.example.com']);
});

test('UI state source validation rejects forged site keys', () => {
  const { validateUiStateMutationSource } = loadUiStatePrimitives();

  assert.deepEqual(plain(validateUiStateMutationSource({
    operation: 'set-badge-position',
    key: 'docs.example.com'
  }, 'https://evil.example.com/article')), { ok: false, reason: 'bad-site' });
  assert.deepEqual(plain(validateUiStateMutationSource({
    operation: 'set-panel-expanded',
    key: 'https://docs.example.com'
  }, 'https://evil.example.com/article')), { ok: false, reason: 'bad-site' });
  assert.deepEqual(plain(validateUiStateMutationSource({
    operation: 'set-panel-expanded',
    key: 'https://docs.example.com'
  }, 'https://docs.example.com/article')), { ok: true, reason: null });
});

test('background owns UI state writes and removes CSS when disabling tabs', () => {
  const background = read('src/background.js');
  const build = read('build.js');

  assert.match(background, /importScripts\('shared\/ui-state-primitives\.js'\)/);
  assert.match(background, /toc:mutateUiState/);
  assert.match(background, /serializedWrite\(storageKey/);
  assert.match(background, /validateUiStateMutationSource/);
  assert.match(background, /sender\.id !== chrome\.runtime\.id/);
  assert.match(background, /removeInjectedCss/);
  assert.match(background, /async function insertInjectedCss/);
  assert.match(background, /removeInjectedCss[\s\S]*?setInjectedState\(tabId,\s*null\)/);
  assert.match(background, /if \(!state \|\| state\.url !== url\)[\s\S]*?insertInjectedCss\(tabId\)/);
  assert.match(build, /ui-state-primitives\.js/);
});

test('extension CSS selectors are scoped to owned UI roots', () => {
  const css = read('src/content.css').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.doesNotMatch(css, /(^|,|\n)\s*\.toc-/m);
});

test('extension DOM checks use owner attributes instead of generic host classes', () => {
  const watcher = read('src/core/dom-watcher.js');
  const config = read('src/core/config-manager.js');
  const picker = read('src/ui/element-picker.js');
  const toast = read('src/utils/toast.js');
  const constants = read('src/utils/constants.js');

  assert.match(watcher, /\[data-toc-owner="web-toc-assistant"\]/);
  assert.doesNotMatch(watcher, /OWNED_SELECTOR = '\.toc-edge-dock/);
  assert.match(config, /\.toc-overlay\[data-toc-owner="web-toc-assistant"\]/);
  assert.match(picker, /closest\('\[data-toc-owner="web-toc-assistant"\]'\)/);
  assert.match(toast, /\.toc-toast-container\[data-toc-owner="web-toc-assistant"\]/);
  assert.doesNotMatch(constants, /\[data-toc-owner\](?![=])/);
});

test('floating panel removal watcher only observes narrow parent targets', () => {
  const panel = read('src/ui/floating-panel.js');

  assert.doesNotMatch(panel, /observe\(document\.documentElement,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\)/);
  assert.match(panel, /removalObserver\.observe\(target,\s*\{\s*childList:\s*true\s*\}\)/);
});

test('release validation runs tests and verifies shared runtime bundles', () => {
  const workflow = read('.github/workflows/release.yml');

  assert.match(workflow, /name: Run tests[\s\S]*?run: npm test/);
  assert.match(workflow, /dist\/build\/src\/page-url-hook\.js/);
  assert.match(workflow, /dist\/build\/src\/shared\/storage-primitives\.js/);
  assert.match(workflow, /dist\/build\/src\/shared\/config-primitives\.js/);
  assert.match(workflow, /dist\/build\/src\/shared\/ui-state-primitives\.js/);
  assert.match(workflow, /grep -q '__TOC_URL_HOOK_INSTALLED__'/);
  assert.match(workflow, /grep -q '__UI_STATE_PRIMITIVES'/);
});
