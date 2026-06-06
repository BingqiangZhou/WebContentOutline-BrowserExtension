import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadCreateUrlMonitor() {
  const file = path.join(repoRoot, 'src/core/url-monitor.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace('export function createUrlMonitor', 'function createUrlMonitor'));

  const listeners = new Map();
  const sandbox = {
    console,
    document: {
      hidden: false,
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      removeEventListener() {}
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

function loadCreateRebuildScheduler(hostname = 'example.com') {
  const file = path.join(repoRoot, 'src/core/rebuild-scheduler.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace('export function createRebuildScheduler', 'function createRebuildScheduler'));

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
    document: {
      hidden: false,
      addEventListener() {},
      removeEventListener() {}
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
    getChatbotContainerSelector() { return null; },
    invalidateChatbotCache() {},
    isStreaming() { return false; },
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

test('url monitor listens for native SPA navigation events', async () => {
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
    const popstateHandler = listeners.get('popstate');
    assert.equal(typeof popstateHandler, 'function');
    popstateHandler();

    await new Promise((resolve) => setTimeout(resolve, 600));
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

test('extension-created buttons explicitly opt out of submit behavior', () => {
  const files = [
    'src/core/config-manager.ts',
    'src/ui/element-picker.ts',
    'src/ui/classic-collapsed-badge.ts',
    'src/ui/classic-floating-panel.ts',
    'src/ui/floating-panel.ts',
    'src/ui/edge-dock.ts',
    'src/utils/toast.ts'
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

test('project versions are unified and recorded in the changelog', () => {
  const wxtConfig = fs.readFileSync(path.join(repoRoot, 'wxt.config.ts'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

  assert.match(wxtConfig, /defineConfig/);
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.match(changelog, new RegExp(`## \\[${packageJson.version.replaceAll('.', '\\.')}(-[\\w.]+)?\\] - \\d{4}-\\d{2}-\\d{2}`));
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

test('high-frequency mutations use fixed debounce without site-specific branches', () => {
  const schedulerSource = fs.readFileSync(path.join(repoRoot, 'src/core/rebuild-scheduler.ts'), 'utf8');
  assert.doesNotMatch(schedulerSource, /chatgpt|chat\.openai|isHighDynamicSpaHost/i);
  assert.doesNotMatch(schedulerSource, /1\.3\*|backoff|exponential/i);

  const env = loadCreateRebuildScheduler('example.com');
  const scheduler = env.createRebuildScheduler(() => Promise.resolve(true));
  scheduler.start({ selectors: [] });

  for (let i = 0; i < 8; i++) {
    env.tick(100);
    env.getMutationHandler()();
  }

  // Every mutation uses the same fixed debounce delay
  for (const delay of env.delays) {
    assert.equal(delay, 400, `all mutation debounces should be 400ms, got ${delay}`);
  }
  scheduler.disconnect();
});
