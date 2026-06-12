import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal MutationObserver capture; document.querySelector is configurable so
// we can test scope selectors.
function loadWatcher(querySelector) {
  var file = path.join(repoRoot, 'src/core/dom-watcher.ts');
  var source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8').replace('export function createDomWatcher', 'function createDomWatcher')));
  var observer = null;
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  var sandbox = {
    console: console,
    Node: { ELEMENT_NODE: 1 },
    document: {
      documentElement: { nodeType: 1 },
      querySelector: querySelector || function () { return null; },
      querySelectorAll: function () { return []; }
    },
    MutationObserver: FakeMutationObserver,
    OWNED_SELECTOR: '[data-toc-owner="web-toc-assistant"]',
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.createDomWatcher = createDomWatcher;', sandbox, { filename: file });
  return { createDomWatcher: sandbox.__exports.createDomWatcher, getObserver: function () { return observer; } };
}

function childListMutation(target) {
  return { type: 'childList', target: target, addedNodes: [{}], removedNodes: [] };
}

test('updateScope changes which mutations are meaningful after a SPA navigation', () => {
  // scope container exists but does NOT contain the mutation target.
  var scopeContainer = { contains: function () { return false; } };
  var env = loadWatcher(function (sel) { return sel === '[data-chat]' ? scopeContainer : null; });

  var calls = 0;
  // Non-default mode (selectors present): any childList with nodes is meaningful
  // unless filtered out by scope.
  var watcher = env.createDomWatcher(function () { calls++; }, {
    selectors: [{ type: 'css', expr: 'x' }],
    scopeSelector: '[data-chat]'
  });
  watcher.start();
  var observer = env.getObserver();
  var outsideTarget = { nodeType: 1, parentElement: null };

  // Scoped to [data-chat]; target is outside → filtered.
  observer.callback([childListMutation(outsideTarget)]);
  assert.equal(calls, 0, 'mutation outside the stale chatbot scope is filtered');

  // After SPA navigation the page is no longer a chatbot page; scope is cleared.
  watcher.updateScope(null);
  observer.callback([childListMutation(outsideTarget)]);
  assert.equal(calls, 1, 'mutation is meaningful once scope is updated');
});
