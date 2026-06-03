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
  const file = path.join(repoRoot, 'src/shared/config-primitives.js');
  assert.equal(fs.existsSync(file), true, 'src/shared/config-primitives.js should exist');
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

function loadUrlMonitor(elementsByExpr = {}) {
  const file = path.join(repoRoot, 'src/core/url-monitor.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace('export function createUrlMonitor', 'function createUrlMonitor');
  const collected = [];
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
    collectBySelector(selector, limit) {
      collected.push({ ...selector, limit });
      return (elementsByExpr[selector.expr] || []).slice(0, limit);
    },
    uniqueInDocumentOrder(nodes) {
      return Array.from(new Set(nodes));
    },
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
  return { createUrlMonitor: sandbox.__exports.createUrlMonitor, collected, delays, timers };
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
  const build = read('build.js');

  assert.match(background, /importScripts\('shared\/config-primitives\.js'\)/);
  assert.match(background, /toc:mutateConfig/);
  assert.match(background, /serializedWrite\('tocConfigs'/);
  assert.match(build, /config-primitives\.js/);
});

test('content scripts refresh app config when tocConfigs changes', () => {
  const content = read('src/content.js');
  const app = read('src/core/toc-app.js');

  assert.match(content, /TOC_CONFIGS_KEY/);
  assert.match(content, /changes && changes\[TOC_CONFIGS_KEY\]/);
  assert.match(content, /appInstance\.refreshConfig/);
  assert.match(app, /refreshConfig/);
});

test('polling supports shared selector collection without layout reads', () => {
  const monitor = read('src/core/url-monitor.js');

  assert.match(monitor, /collectBySelector/);
  assert.match(monitor, /uniqueInDocumentOrder/);
  assert.match(monitor, /h1, h2, h3, h4, h5, h6/);
  assert.doesNotMatch(monitor, /offsetTop/);
});

test('polling collects default headings, XPath, and CSS selectors through the shared collector', () => {
  const trackedElement = {
    tagName: 'H2',
    textContent: 'Heading',
    get offsetTop() {
      throw new Error('polling must not read layout');
    }
  };
  const env = loadUrlMonitor({
    'h1, h2, h3, h4, h5, h6': [trackedElement],
    '//article//h3': [trackedElement],
    'article h2': [trackedElement]
  });

  const defaultMonitor = env.createUrlMonitor({ mutationObserverAvailable: true });
  defaultMonitor.start({ selectors: [] }, () => {});
  env.timers.at(-1).fn();
  defaultMonitor.stop();

  const customMonitor = env.createUrlMonitor({ mutationObserverAvailable: true });
  customMonitor.start({
    selectors: [
      { type: 'xpath', expr: '//article//h3' },
      { type: 'css', expr: 'article h2' }
    ]
  }, () => {});
  env.timers.at(-1).fn();
  customMonitor.stop();

  assert.deepEqual(
    env.collected.map((selector) => `${selector.type}:${selector.expr}`),
    [
      'css:h1, h2, h3, h4, h5, h6',
      'xpath://article//h3',
      'css:article h2'
    ]
  );
});

test('polling stays low frequency with MutationObserver and falls back to three seconds without it', () => {
  const withObserver = loadUrlMonitor();
  const primary = withObserver.createUrlMonitor({ mutationObserverAvailable: true });
  primary.start({ selectors: [] }, () => {});
  assert.equal(withObserver.delays[0], 10000);
  primary.stop();

  const withoutObserver = loadUrlMonitor();
  const fallback = withoutObserver.createUrlMonitor({ mutationObserverAvailable: false });
  fallback.start({ selectors: [] }, () => {});
  assert.equal(withoutObserver.delays[0], 3000);
  fallback.stop();
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

test('scheduler uses low-frequency polling when MutationObserver starts', () => {
  const scheduler = read('src/core/rebuild-scheduler.js');
  const monitor = read('src/core/url-monitor.js');

  assert.match(scheduler, /watcherOk/);
  assert.match(scheduler, /mutationObserverAvailable:\s*watcherOk/);
  assert.match(monitor, /mutationObserverAvailable/);
});

test('collapsed rebuilds skip view synchronization when content is identical', () => {
  const app = read('src/core/toc-app.js');
  const collapsedBranch = app.slice(
    app.indexOf('if (!panelInstance) {'),
    app.indexOf('if (getNavLock())')
  );

  assert.match(collapsedBranch, /isContentIdentical\(prevItems, newItems\)/);
  assert.ok(
    collapsedBranch.indexOf('isContentIdentical(prevItems, newItems)') < collapsedBranch.indexOf('syncItemViews'),
    'collapsed rebuild should compare before synchronizing views'
  );
});

test('project exposes npm test and publishes stability fixes as 1.0.1', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));

  assert.equal(packageJson.scripts.test, 'node --test checks/*.test.mjs');
  assert.equal(manifest.version, '1.0.1');
  assert.equal(packageJson.version, '1.0.1');
  assert.equal(packageLock.version, '1.0.1');
  assert.equal(packageLock.packages[''].version, '1.0.1');
});
