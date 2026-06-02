import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);

function loadCreateUrlMonitor() {
  const file = path.join(repoRoot, 'src/core/url-monitor.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace('export function createUrlMonitor', 'function createUrlMonitor');

  const listeners = new Map();
  const sandbox = {
    console,
    document: {
      hidden: false,
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    history: {
      pushState() {},
      replaceState() {}
    },
    location: {
      href: 'https://chatgpt.com/c/example'
    },
    collectBySelector(selector) {
      return sandbox.document.querySelectorAll(selector.expr);
    },
    uniqueInDocumentOrder(nodes) {
      return Array.from(new Set(nodes));
    },
    setTimeout,
    clearTimeout,
    window: {
      addEventListener(type, fn) {
        listeners.set(type, fn);
      },
      removeEventListener(type, fn) {
        if (listeners.get(type) === fn) listeners.delete(type);
      }
    },
    __exports: {}
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(`${source}\n__exports.createUrlMonitor = createUrlMonitor;`, sandbox, {
    filename: file
  });

  return { createUrlMonitor: sandbox.__exports.createUrlMonitor, sandbox, listeners };
}

function loadPageUrlHook() {
  const file = path.join(repoRoot, 'src/page-url-hook.js');
  const source = fs.readFileSync(file, 'utf8');

  const listeners = new Map();
  const events = [];
  const sandbox = {
    console,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    document: {},
    history: {
      pushState() {
        sandbox.location.href = 'https://example.com/after-push';
        return 'push-result';
      },
      replaceState() {
        sandbox.location.href = 'https://example.com/after-replace';
        return 'replace-result';
      }
    },
    location: {
      href: 'https://example.com/start'
    },
    window: {
      addEventListener(type, fn) {
        const arr = listeners.get(type) || [];
        arr.push(fn);
        listeners.set(type, arr);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type) || [];
        listeners.set(type, arr.filter((item) => item !== fn));
      },
      dispatchEvent(event) {
        events.push(event);
        const arr = listeners.get(event.type) || [];
        for (const fn of arr) fn(event);
        return true;
      }
    }
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.history = sandbox.history;
  sandbox.window.location = sandbox.location;
  sandbox.globalThis = sandbox.window;

  vm.runInNewContext(source, sandbox, { filename: file });

  return { sandbox, events };
}

function loadCreateRebuildScheduler(hostname = 'example.com') {
  const file = path.join(repoRoot, 'src/core/rebuild-scheduler.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace('export function createRebuildScheduler', 'function createRebuildScheduler');

  let mutationHandler = null;
  let urlChangeHandler = null;
  const delays = [];
  let now = 10000;
  let timerId = 0;
  const sandbox = {
    console,
    Date: {
      now() { return now; }
    },
    location: {
      hostname
    },
    setTimeout(fn, delay) {
      delays.push(delay);
      return ++timerId;
    },
    clearTimeout() {},
    createDomWatcher(onMutation) {
      mutationHandler = onMutation;
      return {
        start() { return true; },
        stop() {},
        invalidate() {},
        checkAndReconnect() {}
      };
    },
    createUrlMonitor() {
      return {
        start(cfg, onChange) { urlChangeHandler = onChange; },
        stop() {},
        invalidate() {}
      };
    },
    NL: {
      isLocked() { return false; },
      onUnlock() {}
    },
    uiConst(name, fallback) { return fallback; },
    isContextInvalidatedError() { return false; },
    __exports: {}
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(
    [
      'var createDomWatcher = globalThis.createDomWatcher;',
      'var createUrlMonitor = globalThis.createUrlMonitor;',
      'var NL = globalThis.NL;',
      'var uiConst = globalThis.uiConst;',
      'var isContextInvalidatedError = globalThis.isContextInvalidatedError;',
      source,
      '__exports.createRebuildScheduler = createRebuildScheduler;'
    ].join('\n'),
    sandbox,
    { filename: file }
  );

  return {
    createRebuildScheduler: sandbox.__exports.createRebuildScheduler,
    getMutationHandler() { return mutationHandler; },
    getUrlChangeHandler() { return urlChangeHandler; },
    delays,
    tick(ms) { now += ms; }
  };
}

test('url monitor observes SPA navigation without replacing History API methods', () => {
  const { createUrlMonitor, sandbox } = loadCreateUrlMonitor();
  const originalPushState = sandbox.history.pushState;
  const originalReplaceState = sandbox.history.replaceState;

  const monitor = createUrlMonitor({
    uiConst(name, fallback) { return fallback; },
    getLastRebuildTime() { return 0; }
  });

  try {
    monitor.start({ selectors: [] }, () => {});

    assert.equal(sandbox.history.pushState, originalPushState);
    assert.equal(sandbox.history.replaceState, originalReplaceState);
  } finally {
    monitor.stop();
  }
});

test('url monitor listens for page-world SPA navigation events', async () => {
  const { createUrlMonitor, sandbox, listeners } = loadCreateUrlMonitor();
  let calls = 0;
  const monitor = createUrlMonitor({
    uiConst(name, fallback) { return name === 'URL_CHANGE_DEDUP_MS' ? 0 : fallback; },
    getLastRebuildTime() { return 0; }
  });

  try {
    monitor.start({ selectors: [] }, (immediate) => {
      if (immediate) calls++;
    });

    sandbox.location.href = 'https://chatgpt.com/c/next';
    const handler = listeners.get('toc:urlchange');
    assert.equal(typeof handler, 'function');
    handler({ type: 'toc:urlchange' });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls, 1);
  } finally {
    monitor.stop();
  }
});

test('url monitor teardown does not overwrite History API changes made by the page', () => {
  const { createUrlMonitor, sandbox } = loadCreateUrlMonitor();
  const thirdPartyPushState = function thirdPartyPushState() {};
  const thirdPartyReplaceState = function thirdPartyReplaceState() {};

  const monitor = createUrlMonitor({
    uiConst(name, fallback) { return fallback; },
    getLastRebuildTime() { return 0; }
  });

  try {
    monitor.start({ selectors: [] }, () => {});
    sandbox.history.pushState = thirdPartyPushState;
    sandbox.history.replaceState = thirdPartyReplaceState;
  } finally {
    monitor.stop();
  }

  assert.equal(sandbox.history.pushState, thirdPartyPushState);
  assert.equal(sandbox.history.replaceState, thirdPartyReplaceState);
});

test('page URL hook emits one event for pushState and replaceState', () => {
  const { sandbox, events } = loadPageUrlHook();

  assert.equal(sandbox.history.pushState({}, '', '/after-push'), 'push-result');
  assert.equal(sandbox.history.replaceState({}, '', '/after-replace'), 'replace-result');

  const urlEvents = events.filter((event) => event.type === 'toc:urlchange');
  assert.equal(urlEvents.length, 2);
  assert.deepEqual(
    urlEvents.map((event) => event.detail && event.detail.kind),
    ['pushState', 'replaceState']
  );
});

test('page URL hook is idempotent on repeated injection', () => {
  const file = path.join(repoRoot, 'src/page-url-hook.js');
  const source = fs.readFileSync(file, 'utf8');
  const { sandbox, events } = loadPageUrlHook();
  const wrappedPushState = sandbox.history.pushState;
  const wrappedReplaceState = sandbox.history.replaceState;

  vm.runInNewContext(source, sandbox, { filename: file });

  assert.equal(sandbox.history.pushState, wrappedPushState);
  assert.equal(sandbox.history.replaceState, wrappedReplaceState);

  sandbox.history.pushState({}, '', '/after-second-push');
  const urlEvents = events.filter((event) => event.type === 'toc:urlchange');
  assert.equal(urlEvents.length, 1);
});

test('extension-created buttons explicitly opt out of submit behavior', () => {
  const files = [
    'src/core/config-manager.js',
    'src/ui/element-picker.js',
    'src/ui/classic-collapsed-badge.js',
    'src/ui/classic-floating-panel.js',
    'src/ui/floating-panel.js',
    'src/ui/edge-dock.js',
    'src/utils/toast.js'
  ];

  for (const relativeFile of files) {
    const file = path.join(repoRoot, relativeFile);
    const source = fs.readFileSync(file, 'utf8');
    const createButton = /var\s+([A-Za-z0-9_$]+)\s*=\s*document\.createElement\(['"]button['"]\);/g;
    let match;
    while ((match = createButton.exec(source))) {
      const variableName = match[1];
      const nextCreateIndex = source.slice(match.index + 1).search(/var\s+[A-Za-z0-9_$]+\s*=\s*document\.createElement\(['"]button['"]\);/);
      const end = nextCreateIndex === -1 ? source.length : match.index + 1 + nextCreateIndex;
      const block = source.slice(match.index, end);
      assert.match(
        block,
        new RegExp(`${variableName}\\.type\\s*=\\s*['"]button['"]|${variableName}\\.setAttribute\\(['"]type['"],\\s*['"]button['"]\\)`),
        `${relativeFile}: ${variableName} should set type="button"`
      );
    }
  }
});

test('project versions are unified at 1.0.1', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));

  assert.equal(manifest.version, '1.0.1');
  assert.equal(packageJson.version, '1.0.1');
  assert.equal(packageLock.version, '1.0.1');
  assert.equal(packageLock.packages[''].version, '1.0.1');
});

test('build script removes existing version zip before packaging and copies page hook', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'build.js'), 'utf8');

  assert.match(source, /page-url-hook\.js/);
  assert.match(source, /fs\.existsSync\(zipFile\)[\s\S]*fs\.rmSync\(zipFile/);
});

test('mutation rebuilds start quickly on every host, including ChatGPT', () => {
  for (const hostname of ['example.com', 'chatgpt.com']) {
    const env = loadCreateRebuildScheduler(hostname);
    const scheduler = env.createRebuildScheduler(() => Promise.resolve(true));
    scheduler.start({ selectors: [] });

    env.getMutationHandler()();

    assert.ok(env.delays.length > 0, `${hostname}: mutation should schedule a rebuild`);
    assert.ok(env.delays[0] <= 500, `${hostname}: first mutation should rebuild quickly`);
    scheduler.disconnect();
  }
});

test('high-frequency mutations back off globally without site-specific branches', () => {
  const schedulerSource = fs.readFileSync(path.join(repoRoot, 'src/core/rebuild-scheduler.js'), 'utf8');
  assert.doesNotMatch(schedulerSource, /chatgpt|chat\.openai|isHighDynamicSpaHost/i);

  const env = loadCreateRebuildScheduler('example.com');
  const scheduler = env.createRebuildScheduler(() => Promise.resolve(true));
  scheduler.start({ selectors: [] });

  for (let i = 0; i < 8; i++) {
    env.tick(100);
    env.getMutationHandler()();
  }

  const lastDelay = env.delays[env.delays.length - 1];
  assert.ok(lastDelay >= 1200, `burst mutations should back off, got ${lastDelay}`);
  assert.ok(lastDelay <= 2000, `burst mutations should stay responsive, got ${lastDelay}`);
  scheduler.disconnect();
});
