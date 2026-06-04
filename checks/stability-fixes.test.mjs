import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadDomUtils(querySelectorAll = () => []) {
  const file = path.join(repoRoot, 'src/utils/dom-utils.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export\s+async\s+function /g, 'async function ')
    .replace(/export function /g, 'function ');
  const sandbox = {
    console,
    document: {
      querySelectorAll,
      evaluate() {
        return { iterateNext() { return null; } };
      }
    },
    XPathResult: { ORDERED_NODE_ITERATOR_TYPE: 1 },
    uiConst(_name, fallback) { return fallback; },
    isSafeXPathExpression() { return true; },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}
__exports.collectBySelector = collectBySelector;
__exports.uniqueInDocumentOrder = uniqueInDocumentOrder;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports;
}

function loadConfigPrimitives() {
  const file = path.join(repoRoot, 'src/shared/primitives.js');
  assert.equal(fs.existsSync(file), true, 'src/shared/primitives.js should exist');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export\s+\{[^}]*\};?\n?/g, '')
    .replace(/export function /g, 'function ');
  const sandbox = {
    console,
    isPlainObject(value) { return !!(value && typeof value === 'object' && !Array.isArray(value)); },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.applyTocConfigMutation = applyTocConfigMutation;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.applyTocConfigMutation;
}

function loadUrlMonitor() {
  const file = path.join(repoRoot, 'src/core/url-monitor.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace('export function createUrlMonitor', 'function createUrlMonitor');
  const delays = [];
  const timers = [];
  let identity = 0;
  const sandbox = {
    console,
    document: {
      hidden: false,
      querySelector() { return null; }
    },
    location: { href: 'https://example.com/' },
    window: { addEventListener() {}, removeEventListener() {} },
    setTimeout(fn, delay) {
      delays.push(delay);
      timers.push({ fn, delay });
      return ++identity;
    },
    clearTimeout() {},
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${source}\n__exports.createUrlMonitor = createUrlMonitor;`, sandbox, {
    filename: file
  });
  return { createUrlMonitor: sandbox.__exports.createUrlMonitor, delays, timers };
}

function loadDomWatcher() {
  const file = path.join(repoRoot, 'src/core/dom-watcher.js');
  const source = fs.readFileSync(file, 'utf8').replace('export function createDomWatcher', 'function createDomWatcher');
  let observer = null;
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe() {}
    disconnect() {}
    takeRecords() {}
  }
  const sandbox = {
    console,
    Node: { ELEMENT_NODE: 1 },
    document: { documentElement: { nodeType: 1 } },
    MutationObserver: FakeMutationObserver,
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${source}\n__exports.createDomWatcher = createDomWatcher;`, sandbox, {
    filename: file
  });
  return { createDomWatcher: sandbox.__exports.createDomWatcher, getObserver: () => observer };
}

test('deduplicated selector results are sorted in document order', () => {
  const { uniqueInDocumentOrder } = loadDomUtils();
  const earlier = {
    id: 'earlier',
    compareDocumentPosition(other) {
      return other === later ? 4 : 0;
    }
  };
  const later = {
    id: 'later',
    compareDocumentPosition(other) {
      return other === earlier ? 2 : 0;
    }
  };

  assert.deepEqual(
    Array.from(uniqueInDocumentOrder([later, earlier, later]), (item) => item.id),
    ['earlier', 'later']
  );
});

test('selector collection accepts a lower candidate limit for polling', () => {
  const nodes = [{}, {}, {}, {}];
  const { collectBySelector } = loadDomUtils(() => nodes);

  assert.equal(collectBySelector({ type: 'css', expr: 'h2' }, 2).length, 2);
});

test('config mutations retain sequential additions from separate tabs', () => {
  const applyTocConfigMutation = loadConfigPrimitives();
  const first = applyTocConfigMutation([], {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    side: 'right',
    selector: { type: 'css', expr: 'article h2' }
  }, 100);
  const second = applyTocConfigMutation(first.configs, {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    side: 'right',
    selector: { type: 'css', expr: 'article h3' }
  }, 101);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(
    Array.from(second.configs[0].selectors, (selector) => selector.expr),
    ['article h3', 'article h2']
  );
});

test('config mutations deduplicate, remove, clear, and enforce capacity limits', () => {
  const applyTocConfigMutation = loadConfigPrimitives();
  const limits = { maxSites: 1, maxSelectorsPerSite: 2 };
  let result = applyTocConfigMutation([], {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'css', expr: 'h2' }
  }, 100, limits);
  result = applyTocConfigMutation(result.configs, {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'css', expr: 'h2' }
  }, 101, limits);
  result = applyTocConfigMutation(result.configs, {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'xpath', expr: '//article//h3' }
  }, 102, limits);
  result = applyTocConfigMutation(result.configs, {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'css', expr: 'h4' }
  }, 103, limits);

  assert.deepEqual(
    Array.from(result.configs[0].selectors, (selector) => `${selector.type}:${selector.expr}`),
    ['css:h4', 'xpath://article//h3']
  );

  result = applyTocConfigMutation(result.configs, {
    operation: 'remove-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'xpath', expr: '//article//h3' }
  }, 104, limits);
  assert.deepEqual(Array.from(result.configs[0].selectors, (selector) => selector.expr), ['h4']);

  result = applyTocConfigMutation(result.configs, {
    operation: 'clear-site',
    urlPattern: 'https://example.com/*'
  }, 105, limits);
  assert.deepEqual(Array.from(result.configs), []);

  result = applyTocConfigMutation(result.configs, {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'css', expr: 'h2' }
  }, 106, limits);
  result = applyTocConfigMutation(result.configs, {
    operation: 'add-selector',
    urlPattern: 'https://second.example/*',
    selector: { type: 'css', expr: 'h3' }
  }, 107, limits);
  assert.deepEqual(Array.from(result.configs, (config) => config.urlPattern), ['https://second.example/*']);
});

test('invalid config mutations leave existing configs unchanged', () => {
  const applyTocConfigMutation = loadConfigPrimitives();
  const configs = [{ urlPattern: 'https://example.com/*', selectors: [] }];
  const result = applyTocConfigMutation(configs, {
    operation: 'add-selector',
    urlPattern: 'https://example.com/*',
    selector: { type: 'css', expr: '' }
  }, 100);

  assert.equal(result.ok, false);
  assert.deepEqual(result.configs, configs);
});

test('background owns config mutations and packages the shared primitive', () => {
  const background = read('src/background.js');

  assert.match(background, /importScripts\('shared\/primitives\.js'\)/);
  assert.match(background, /toc:mutateConfig/);
  assert.match(background, /serializedWrite\('tocConfigs'/);
});

test('content scripts refresh app config when tocConfigs changes', () => {
  const content = read('src/content.js');
  const app = read('src/core/toc-app.js');

  assert.match(content, /TOC_CONFIGS_KEY/);
  assert.match(content, /changes\?\.\[TOC_CONFIGS_KEY\]/);
  assert.match(content, /appInstance\.refreshConfig/);
  assert.match(app, /refreshConfig/);
});

test('default heading watcher ignores unrelated text but reacts to heading text', () => {
  const env = loadDomWatcher();
  let calls = 0;
  const watcher = env.createDomWatcher(() => { calls++; }, { selectors: [] });
  watcher.start();
  const observer = env.getObserver();

  observer.callback([{
    type: 'characterData',
    target: { nodeType: 3, parentElement: { closest() { return null; } } }
  }]);
  assert.equal(calls, 0);

  observer.callback([{
    type: 'characterData',
    target: {
      nodeType: 3,
      parentElement: {
        closest(selector) {
          return selector === 'h1, h2, h3, h4, h5, h6' ? {} : null;
        }
      }
    }
  }]);
  assert.equal(calls, 1);
});

test('collapsed rebuilds skip view synchronization when content is identical', () => {
  const app = read('src/core/toc-app.js');

  // isContentIdentical is checked early, before the collapsed panelInstance branch
  const rebuildOnce = app.slice(
    app.indexOf('var prevItems = items;'),
    app.indexOf('var incrementalDone = false;')
  );

  assert.match(rebuildOnce, /isContentIdentical\(prevItems, newItems\)/);
  assert.ok(
    rebuildOnce.indexOf('isContentIdentical(prevItems, newItems)') < rebuildOnce.indexOf('if (!panelInstance)'),
    'isContentIdentical check should come before collapsed branch'
  );
});

test('project exposes npm test and publishes stability fixes as 1.0.2', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));

  assert.equal(packageJson.scripts.test, 'node --test checks/*.test.mjs');
  assert.equal(manifest.version, '1.0.2');
  assert.equal(packageJson.version, '1.0.2');
  assert.equal(packageLock.version, '1.0.2');
  assert.equal(packageLock.packages[''].version, '1.0.2');
});
