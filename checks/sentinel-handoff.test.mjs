/**
 * The chatbot sentinel must reach the DOM watcher.
 *
 * On a chatbot page without user selectors, toc-app's first rebuild replaces
 * cfg.selectors with a new array (config-manager.ts), and buildTocItems then
 * pushes a `_tocSentinel` selector into it (toc-builder.ts) so the watcher stops
 * filtering out message mutations that carry no h1-h6. The watcher must read
 * that list live — a snapshot taken at start() never sees the sentinel, and new
 * turns stop triggering rebuilds.
 *
 * Runs the REAL dom-watcher inside the REAL rebuild-scheduler.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadSchedulerWithRealWatcher() {
  const script = (relativePath) => stripImportsAndExports(stripTsSyntax(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')));
  // The chat scope: every mutation below is inside the chat container.
  const chatContainer = { isConnected: true, contains: () => true };
  let observer = null;
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  const sandbox = {
    console,
    MutationObserver: FakeMutationObserver,
    Node: { ELEMENT_NODE: 1 },
    document: {
      hidden: false,
      documentElement: { nodeType: 1 },
      addEventListener() {},
      removeEventListener() {},
      querySelector: (selector) => (selector === '[role="log"]' ? chatContainer : null),
      querySelectorAll: () => []
    },
    // Timers fire synchronously, which collapses the debounce. (It also makes
    // the max-wait timer fire during the rebuild the debounce just started — a
    // phantom "request during rebuild"; harmless for what this file asserts.)
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    createUrlMonitor: () => ({ start() {}, stop() {}, invalidate() {} }),
    isContextInvalidatedError: () => false,
    invalidateChatbotCache() {},
    isStreaming: () => false,
    getChatbotContainerSelector: () => '[role="log"]',
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    script('src/core/dom-watcher.ts') + '\n' + script('src/core/rebuild-scheduler.ts') +
    '\n__exports.createRebuildScheduler = createRebuildScheduler;' +
    '\n__exports.createDomWatcher = createDomWatcher;',
    sandbox,
    { filename: 'dom-watcher.ts + rebuild-scheduler.ts' }
  );
  return {
    createRebuildScheduler: sandbox.__exports.createRebuildScheduler,
    createDomWatcher: sandbox.__exports.createDomWatcher,
    fire(mutations) { observer.callback(mutations); }
  };
}

const element = (querySelector) => ({ nodeType: 1, closest: () => null, querySelector });
// A new chat turn: nodes added, none of them an h1-h6.
const messageMutation = () => [{ type: 'childList', target: element(() => null), addedNodes: [element(() => null)], removedNodes: [] }];
// An added subtree that contains a heading.
const headingMutation = () => [{ type: 'childList', target: element(() => null), addedNodes: [element(() => ({ tagName: 'H2' }))], removedNodes: [] }];

const neverLocked = { isLocked: () => false };

test('the chatbot sentinel injected after start() makes message mutations trigger a rebuild', () => {
  const env = loadSchedulerWithRealWatcher();
  let rebuilds = 0;
  const scheduler = env.createRebuildScheduler(() => { rebuilds++; return Promise.resolve('ok'); }, { navLock: neverLocked });

  // What toc-app does on a chatbot page without user selectors: the watcher
  // starts on an empty list, the first rebuild replaces cfg.selectors with a new
  // array, and buildTocItems pushes the sentinel into that new array.
  const cfg = { selectors: [] };
  scheduler.start(cfg);
  cfg.selectors = [];
  cfg.selectors.push({ type: 'css', expr: '[data-message-author-role]', _tocSentinel: true });

  env.fire(messageMutation());
  assert.equal(rebuilds, 1, 'a new turn that carries no heading must trigger a rebuild once the sentinel is known');
  scheduler.disconnect();
});

test('without the sentinel, a message-only mutation is still filtered out', () => {
  const env = loadSchedulerWithRealWatcher();
  let rebuilds = 0;
  const scheduler = env.createRebuildScheduler(() => { rebuilds++; return Promise.resolve('ok'); }, { navLock: neverLocked });
  scheduler.start({ selectors: [] });

  env.fire(messageMutation());
  assert.equal(rebuilds, 0, 'ordinary pages must not rebuild on unrelated changes');

  env.fire(headingMutation());
  assert.equal(rebuilds, 1, 'heading changes always rebuild');
  scheduler.disconnect();
});

test('the watcher reads the selector list live through getSelectors', () => {
  const env = loadSchedulerWithRealWatcher();
  const live = [];
  let calls = 0;
  const watcher = env.createDomWatcher(() => { calls++; }, { selectors: [], getSelectors: () => live });
  watcher.start();

  env.fire(messageMutation());
  assert.equal(calls, 0);

  live.push({ type: 'css', expr: '.msg' });
  env.fire(messageMutation());
  assert.equal(calls, 1, 'a selector added after start() must take effect without restarting the watcher');
  watcher.stop();
});

test('a failing getSelectors falls back to the static selector list', () => {
  const env = loadSchedulerWithRealWatcher();
  let calls = 0;
  const watcher = env.createDomWatcher(() => { calls++; }, {
    selectors: [{ type: 'css', expr: '.msg' }],
    getSelectors: () => { throw new Error('config replaced mid-read'); }
  });
  watcher.start();

  env.fire(messageMutation());
  assert.equal(calls, 1, 'a throwing getter must not disable watching or throw inside the observer');
  watcher.stop();
});
