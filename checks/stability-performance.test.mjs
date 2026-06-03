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
    console: { ...console, debug() {} },
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
    getBoundedText() { return ''; },
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

function loadBoundedText() {
  const file = path.join(repoRoot, 'src/utils/bounded-text.js');
  assert.equal(fs.existsSync(file), true, 'src/utils/bounded-text.js should exist');
  const source = fs.readFileSync(file, 'utf8').replace(/export function /g, 'function ');
  const sandbox = { console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.getBoundedText = getBoundedText;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.getBoundedText;
}

function loadCoreUtilsForValidation() {
  const file = path.join(repoRoot, 'src/utils/core-utils.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export function /g, 'function ');
  const sandbox = {
    console,
    CSS: { supports() { return true; } },
    document: {
      createDocumentFragment() {
        return {
          querySelector() {}
        };
      }
    },
    uiConst(_name, fallback) { return fallback; },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}
__exports.validateSelectorExpression = validateSelectorExpression;
__exports.isSafeXPathExpression = isSafeXPathExpression;
__exports.isHighRiskBroadCssSelector = isHighRiskBroadCssSelector;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports;
}

function loadDomUtilsForCollection(options = {}) {
  const file = path.join(repoRoot, 'src/utils/dom-utils.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export function /g, 'function ');
  const calls = [];
  const sandbox = {
    console,
    document: {
      querySelectorAll(expr) {
        calls.push({ type: 'css', expr });
        return options.cssNodes || [];
      },
      evaluate(expr) {
        calls.push({ type: 'xpath', expr });
        const nodes = options.xpathNodes || [];
        let index = 0;
        return {
          iterateNext() {
            return nodes[index++] || null;
          }
        };
      }
    },
    XPathResult: { ORDERED_NODE_ITERATOR_TYPE: 1 },
    uiConst(_name, fallback) { return fallback; },
    isSafeXPathExpression(expr) {
      return !(/^(\/\/(?:html|body)\/\/\*|\.\/\/\*)/i.test(String(expr || '').trim()));
    },
    isHighRiskBroadCssSelector(expr) {
      return ['*', 'body *', 'html *', ':root *'].includes(String(expr || '').trim().toLowerCase());
    },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.collectBySelector = collectBySelector;`,
    sandbox,
    { filename: file }
  );
  return { collectBySelector: sandbox.__exports.collectBySelector, calls };
}

function loadConfigPrimitivesForSelectors() {
  const file = path.join(repoRoot, 'src/shared/config-primitives.js');
  const source = fs.readFileSync(file, 'utf8').replace(/export function /g, 'function ');
  const sandbox = { console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.applyTocConfigMutation = applyTocConfigMutation;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.applyTocConfigMutation;
}

function loadStorageForNormalization() {
  const file = path.join(repoRoot, 'src/utils/storage.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import[\s\S]*?from .+;\n/gm, '')
    .replace(/export function /g, 'function ');
  const sandbox = {
    console,
    STORAGE_KEYS: {
      TOC_CONFIGS: 'tocConfigs',
      SITE_ENABLE_MAP: 'tocSiteEnabledMap',
      PANEL_STATE_MAP: 'tocPanelExpandedMap',
      BADGE_POS_MAP: 'tocBadgePosMap',
      UI_MODE: 'tocUiMode'
    },
    uiConst(_name, fallback) { return fallback; },
    isPlainObject(value) { return !!(value && typeof value === 'object' && !Array.isArray(value)); },
    isExtensionContextInvalidated() { return false; },
    isContextInvalidatedError() { return false; },
    validateSelectorExpression() { return true; },
    msg(key) { return key; },
    serializedWrite(_key, fn) { return fn(); },
    isQuotaExceededError() { return false; },
    pruneObjectToLimit(map) { return map; },
    showToast() {},
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.normalizeStorageValue = normalizeStorageValue;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.normalizeStorageValue;
}

function loadUrlMonitorForPolling(options = {}) {
  const file = path.join(repoRoot, 'src/core/url-monitor.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace('export function createUrlMonitor', 'function createUrlMonitor');
  const timers = [];
  const sandbox = {
    console,
    document: { hidden: false },
    location: { href: 'https://example.com/article' },
    window: { addEventListener() {}, removeEventListener() {} },
    collectBySelector(selector, limit) {
      timers.collected.push({ selector, limit });
      return (options.elements || []).slice(0, limit);
    },
    getBoundedText: options.getBoundedText,
    uniqueInDocumentOrder(nodes) { return nodes; },
    setTimeout(fn, delay) {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout() {},
    __exports: {}
  };
  timers.collected = [];
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.createUrlMonitor = createUrlMonitor;`,
    sandbox,
    { filename: file }
  );
  return { createUrlMonitor: sandbox.__exports.createUrlMonitor, timers };
}

function loadBadgePositionForWrites(options = {}) {
  const file = path.join(repoRoot, 'src/utils/badge-position.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export function /g, 'function ');
  const calls = [];
  const sandbox = {
    console,
    Date,
    window: { innerWidth: 1000, innerHeight: 800 },
    chrome: options.chrome,
    getFiniteNumber(value) {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    },
    getBadgePosMap: options.getBadgePosMap || (async () => ({})),
    saveBadgePosMap: options.saveBadgePosMap || (async () => true),
    pruneObjectToLimit() {},
    serializedWrite(_key, fn) { return fn(); },
    touchObjectKey(map, key, value) {
      calls.push({ type: 'touch', key, value });
      map[key] = value;
    },
    uiConst(_name, fallback) { return fallback; },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.setBadgePosByHost = setBadgePosByHost;`,
    sandbox,
    { filename: file }
  );
  return { setBadgePosByHost: sandbox.__exports.setBadgePosByHost, calls };
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

async function loadContentScriptForConfigChanges(options = {}) {
  const file = path.join(repoRoot, 'src/content.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/import[\s\S]*?from '\.\/utils\/toc-utils\.js';\n/, '')
    .replace(/import[\s\S]*?from '\.\/core\/toc-app\.js';\n/, '');
  const timers = [];
  const storageListeners = [];
  let refreshCalls = 0;
  let initConfig = null;
  const currentUrl = options.url || 'https://docs.example.com/article';
  const current = new URL(currentUrl);
  let configs = options.configs || [];
  const localStorageData = new Map(Object.entries(options.localStorageData || {}));
  const localStorageOps = [];
  const badgePositionWrites = [];
  const wildcardMatch = (pattern, url) => {
    const escaped = String(pattern || '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(url);
  };
  const sandbox = {
    console: { ...console, debug() {} },
    Promise,
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    location: {
      href: current.href,
      origin: current.origin,
      protocol: current.protocol,
      host: current.host
    },
    document: {
      readyState: 'complete',
      addEventListener() {},
      documentElement: {},
      querySelector() { return null; }
    },
    localStorage: {
      getItem(key) {
        localStorageOps.push(['get', key]);
        return localStorageData.has(key) ? localStorageData.get(key) : null;
      },
      setItem(key, value) {
        localStorageOps.push(['set', key]);
        localStorageData.set(key, String(value));
      },
      removeItem(key) {
        localStorageOps.push(['remove', key]);
        localStorageData.delete(key);
      }
    },
    window: {},
    chrome: {
      runtime: {
        id: 'extension-id',
        sendMessage(_message, callback) {
          callback && callback({ ok: true });
        },
        onMessage: {
          addListener() {},
          removeListener() {}
        }
      },
      storage: {
        onChanged: {
          addListener(listener) { storageListeners.push(listener); },
          removeListener() {}
        }
      }
    },
    msg(key) { return key; },
    getConfigs() { return Promise.resolve(configs); },
    findMatchingConfig(list, url) {
      return (Array.isArray(list) ? list : []).find((cfg) => cfg && wildcardMatch(cfg.urlPattern, url)) || null;
    },
    getSiteEnabledByOrigin() { return Promise.resolve(options.enabled !== false); },
    getPanelExpandedByOrigin() { return Promise.resolve(false); },
    getUiMode() { return Promise.resolve('edge-dock'); },
    saveUiMode() { return Promise.resolve(true); },
    normalizeUiMode(mode) { return mode === 'classic' ? 'classic' : 'edge-dock'; },
    getBadgePosByHost() { return Promise.resolve(null); },
    setBadgePosByHost(host, pos) {
      badgePositionWrites.push({ host, pos });
      return Promise.resolve(true);
    },
    isContextInvalidatedError() { return false; },
    cleanupOwnedElements() {},
    safeJsonParse(raw) { try { return JSON.parse(raw); } catch (_) { return null; } },
    isPlainObject(value) { return !!(value && typeof value === 'object' && !Array.isArray(value)); },
    getFiniteNumber(value) {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    },
    uiConst(_name, fallback) { return fallback; },
    STORAGE_KEYS: {
      SITE_ENABLE_MAP: 'tocSiteEnabledMap',
      UI_MODE: 'tocUiMode',
      TOC_CONFIGS: 'tocConfigs'
    },
    initForConfig(cfg) {
      initConfig = cfg;
      return {
        refreshConfig() {
          refreshCalls++;
          return Promise.resolve(true);
        },
        collapse() {},
        destroy() {}
      };
    },
    __exports: {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: file });
  while (timers.length) {
    const fn = timers.shift();
    fn();
    await Promise.resolve();
  }
  for (let i = 0; i < 80; i++) await Promise.resolve();

  return {
    getInitConfig: () => initConfig,
    getRefreshCalls: () => refreshCalls,
    getLocalStorageOps: () => localStorageOps.slice(),
    getBadgePositionWrites: () => badgePositionWrites.slice(),
    setConfigs(nextConfigs) { configs = nextConfigs; },
    emitStorageChange(newConfigs, oldConfigs = configs) {
      const listener = storageListeners[0];
      assert.equal(typeof listener, 'function', 'content storage listener should be attached');
      listener({
        tocConfigs: {
          oldValue: oldConfigs,
          newValue: newConfigs
        }
      }, 'local');
    }
  };
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

test('bounded text helper limits characters, nodes, depth, and avoids element textContent fallback', () => {
  const getBoundedText = loadBoundedText();
  const textNode = (value) => ({ nodeType: 3, nodeValue: value });
  const element = (children, textGetter) => {
    const obj = { nodeType: 1, childNodes: children };
    Object.defineProperty(obj, 'textContent', {
      get() {
        if (textGetter) return textGetter();
        throw new Error('element textContent should not be read');
      }
    });
    return obj;
  };
  const tree = element([
    textNode('a'.repeat(80)),
    textNode('b'.repeat(80)),
    element([textNode('c'.repeat(80))]),
    element([textNode('d'.repeat(80))])
  ]);

  assert.equal(getBoundedText(tree, { maxChars: 120, maxNodes: 20, maxDepth: 5 }).length, 120);
  assert.equal(getBoundedText(tree, { maxChars: 400, maxNodes: 2, maxDepth: 5 }).length, 80);
  assert.equal(getBoundedText(tree, { maxChars: 400, maxNodes: 20, maxDepth: 1 }), 'a'.repeat(80) + 'b'.repeat(80));
  assert.equal(getBoundedText(element([], () => { throw new Error('no fallback'); }), { maxChars: 10 }), '');
});

test('URL polling avoids text reads with MutationObserver and uses bounded text without it', () => {
  const throwingElement = {
    tagName: 'H2',
    get textContent() {
      throw new Error('polling should not read textContent when MutationObserver is active');
    }
  };
  let boundedCalls = 0;
  const active = loadUrlMonitorForPolling({
    elements: [throwingElement],
    getBoundedText() {
      boundedCalls++;
      return 'Heading';
    }
  });
  active.createUrlMonitor({ mutationObserverAvailable: true }).start({ selectors: [] }, () => {});
  active.timers[0].fn();

  assert.equal(boundedCalls, 0);

  const fallback = loadUrlMonitorForPolling({
    elements: [throwingElement],
    getBoundedText() {
      boundedCalls++;
      return 'Heading';
    }
  });
  fallback.createUrlMonitor({ mutationObserverAvailable: false }).start({ selectors: [] }, () => {});
  fallback.timers[0].fn();

  assert.equal(boundedCalls, 1);
});

test('URL monitor defers initial content signature collection until the polling interval', () => {
  const env = loadUrlMonitorForPolling({
    elements: [{ tagName: 'H2' }],
    getBoundedText() {
      throw new Error('MutationObserver polling baseline should not need text');
    }
  });
  let callbacks = 0;
  const monitor = env.createUrlMonitor({ mutationObserverAvailable: true });

  monitor.start({ selectors: [{ type: 'css', expr: 'article h2' }] }, () => { callbacks++; });

  assert.equal(env.timers.collected.length, 0);
  assert.equal(env.timers[0].delay, 10000);

  env.timers[0].fn();

  assert.equal(env.timers.collected.length, 1);
  assert.equal(callbacks, 0);
  monitor.stop();
});

test('selector validation rejects high-risk broad CSS scans but keeps normal heading selectors', () => {
  const { validateSelectorExpression, isSafeXPathExpression, isHighRiskBroadCssSelector } = loadCoreUtilsForValidation();

  assert.equal(validateSelectorExpression('css', '*'), false);
  assert.equal(validateSelectorExpression('css', 'body *'), false);
  assert.equal(validateSelectorExpression('css', 'article h2, html *'), false);
  assert.equal(isHighRiskBroadCssSelector(':root *'), true);
  assert.equal(isSafeXPathExpression('//body//*'), false);
  assert.equal(isSafeXPathExpression('//html//*[contains(@class, "title")]'), false);
  assert.equal(isSafeXPathExpression('.//*'), false);
  assert.equal(validateSelectorExpression('css', 'article h2'), true);
  assert.equal(validateSelectorExpression('css', '.doc-title'), true);
  assert.equal(validateSelectorExpression('css', 'main > section h3'), true);
  assert.equal(validateSelectorExpression('xpath', '//article//h2'), true);
});

test('selector collection skips historical broad selectors before querying the page', () => {
  const env = loadDomUtilsForCollection({ cssNodes: [{}], xpathNodes: [{ nodeType: 1 }] });

  assert.deepEqual(plain(env.collectBySelector({ type: 'css', expr: 'body *' }, 20)), []);
  assert.deepEqual(plain(env.collectBySelector({ type: 'xpath', expr: '//body//*' }, 20)), []);
  assert.equal(env.calls.length, 0);
  assert.equal(env.collectBySelector({ type: 'css', expr: 'article h2' }, 20).length, 1);
  assert.equal(env.collectBySelector({ type: 'xpath', expr: '//article//h2' }, 20).length, 1);
});

test('config mutations filter broad legacy selectors and reject new broad selectors', () => {
  const applyTocConfigMutation = loadConfigPrimitivesForSelectors();
  const legacy = [{
    urlPattern: 'https://example.com/*',
    selectors: [
      { type: 'css', expr: 'body *' },
      { type: 'xpath', expr: '//html//*' },
      { type: 'css', expr: 'article h2' }
    ]
  }];

  const rejected = applyTocConfigMutation([], {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'css', expr: '*' }
  }, 100);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'invalid-selector');

  const rejectedXpath = applyTocConfigMutation([], {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'xpath', expr: '//body//*' }
  }, 100);
  assert.equal(rejectedXpath.ok, false);
  assert.equal(rejectedXpath.reason, 'invalid-selector');

  const cleaned = applyTocConfigMutation(legacy, {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'css', expr: '.doc-title' }
  }, 101);
  assert.deepEqual(plain(cleaned.configs[0].selectors.map((selector) => selector.expr)), ['.doc-title', 'article h2']);
});

test('config normalization drops unused collapsedDefault field from new and legacy configs', () => {
  const applyTocConfigMutation = loadConfigPrimitivesForSelectors();
  const normalizeStorageValue = loadStorageForNormalization();

  const added = applyTocConfigMutation([], {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'css', expr: 'article h2' }
  }, 100);
  assert.equal(added.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(added.configs[0], 'collapsedDefault'), false);

  const normalized = normalizeStorageValue('tocConfigs', [{
    urlPattern: 'https://example.com/*',
    side: 'right',
    collapsedDefault: true,
    selectors: [{ type: 'css', expr: 'article h2' }]
  }]);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized[0], 'collapsedDefault'), false);

  assert.doesNotMatch(read('README.md'), /collapsedDefault/);
  assert.doesNotMatch(read('README_CN.md'), /collapsedDefault/);
  assert.doesNotMatch(read('src/content.js'), /collapsedDefault/);
});

test('content script defers legacy badge migration until the site is enabled', async () => {
  const legacyKey = 'tocBadgePos::docs.example.com';
  const disabled = await loadContentScriptForConfigChanges({
    enabled: false,
    localStorageData: {
      [legacyKey]: JSON.stringify({ left: 12, top: 34 })
    }
  });
  assert.deepEqual(disabled.getLocalStorageOps(), []);
  assert.deepEqual(disabled.getBadgePositionWrites(), []);
  assert.equal(disabled.getInitConfig(), null);

  const enabled = await loadContentScriptForConfigChanges({
    enabled: true,
    localStorageData: {
      [legacyKey]: JSON.stringify({ left: 12, top: 34 })
    }
  });
  assert.ok(enabled.getLocalStorageOps().some(([op, key]) => op === 'get' && key === legacyKey));
  assert.equal(enabled.getBadgePositionWrites().length, 1);
  assert.notEqual(enabled.getInitConfig(), null);
});

test('content script skips config refresh when tocConfigs change is unrelated to the current URL', async () => {
  const initial = [{
    urlPattern: 'https://docs.example.com/*',
    selectors: [{ type: 'css', expr: 'article h2' }]
  }];
  const env = await loadContentScriptForConfigChanges({ configs: initial });
  assert.equal(env.getInitConfig().urlPattern, 'https://docs.example.com/*');

  env.emitStorageChange([
    initial[0],
    {
      urlPattern: 'https://other.example.com/*',
      selectors: [{ type: 'css', expr: 'main h2' }]
    }
  ], initial);
  await Promise.resolve();

  assert.equal(env.getRefreshCalls(), 0);

  env.emitStorageChange([{
    urlPattern: 'https://docs.example.com/*',
    selectors: [{ type: 'css', expr: 'article h3' }]
  }], initial);
  await Promise.resolve();

  assert.equal(env.getRefreshCalls(), 1);
});

test('badge position write skips local map read when background mutation is available', async () => {
  const sent = [];
  const { setBadgePosByHost } = loadBadgePositionForWrites({
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sent.push(message);
          callback({ ok: true, value: { x: 200, y: 100, anchorX: 'left' } });
        }
      }
    },
    getBadgePosMap() {
      throw new Error('local badge map should not be read when runtime mutation is available');
    }
  });

  const saved = await setBadgePosByHost('docs.example.com', { x: 200, y: 100 });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'toc:mutateUiState');
  assert.deepEqual(saved, { x: 200, y: 100, anchorX: 'left' });
});

test('badge position write falls back to local serialized map write without runtime mutation', async () => {
  let savedMap = null;
  const { setBadgePosByHost } = loadBadgePositionForWrites({
    getBadgePosMap: async () => ({}),
    saveBadgePosMap: async (map) => {
      savedMap = map;
      return true;
    }
  });

  const saved = await setBadgePosByHost('docs.example.com', { x: 300, y: 180 });

  assert.equal(Object.keys(savedMap).length, 1);
  assert.equal(savedMap['docs.example.com'].x, 300);
  assert.equal(saved.x, 300);
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

test('origin-wide background fan-out is batched instead of fully concurrent', () => {
  const background = read('src/background.js');

  assert.match(background, /async function processInBatches\(items,\s*fn,\s*batchSize = 5\)/);
  assert.match(background, /async function updateIconsForOrigin\(origin\)[\s\S]*?await processInBatches\(/);
  assert.match(background, /async function broadcastEnabledToOrigin\(origin,\s*enabled,\s*exceptTabId\)[\s\S]*?await processInBatches\(/);
  assert.doesNotMatch(background, /Promise\.allSettled\(tabs\.filter\(t => t\.id\)\.map\(t => queueIconUpdate/);
  assert.doesNotMatch(background, /Promise\.allSettled\(tabs\.filter\(t => t\.id && \(!exceptTabId \|\| t\.id !== exceptTabId\)\)\.map/);
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
  assert.match(workflow, /release:[\s\S]*?name: Build and validate[\s\S]*?grep -q '__TOC_URL_HOOK_INSTALLED__'/);
  assert.match(workflow, /release:[\s\S]*?name: Build and validate[\s\S]*?grep -q '__UI_STATE_PRIMITIVES'/);
});
