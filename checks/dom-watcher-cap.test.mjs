/**
 * dom-watcher per-callback record scan cap.
 *
 * A mutation storm (SPA streaming) can deliver thousands of records in a single
 * callback. hasMeaningfulChange must bound how many it scans per callback so the
 * observer callback itself never blocks the main thread for long. A meaningful
 * change beyond the cap is deferred to the next batch (it is durable, so it
 * surfaces again) rather than missed entirely.
 *
 * This is a RED test until the cap is added to hasMeaningfulChange.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADING_SEL = 'h1, h2, h3, h4, h5, h6';

function loadWatcher() {
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
      querySelector: function () { return null; },
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

// node whose subtree contains a heading → childListTouchesDefaultHeading true
function headingNode() {
  return { nodeType: 1, closest: function (sel) { return sel === HEADING_SEL ? {} : null; } };
}
// plain node → never touches a heading
function plainNode() {
  return { nodeType: 1, closest: function () { return null; } };
}
function plainMutation() {
  return { type: 'childList', target: plainNode(), addedNodes: [plainNode()], removedNodes: [] };
}
function headingMutation() {
  return { type: 'childList', target: plainNode(), addedNodes: [headingNode()], removedNodes: [] };
}

test('a heading mutation beyond the scan cap is deferred to the next batch', () => {
  var env = loadWatcher();
  var calls = 0;
  // Default heading mode: only heading-touching childList mutations are meaningful.
  var watcher = env.createDomWatcher(function () { calls++; }, { selectors: [] });
  watcher.start();
  var observer = env.getObserver();

  // 500 plain (non-meaningful) records, then a meaningful heading record beyond
  // the cap. With the cap the heading record is never scanned this batch.
  var batch = [];
  for (var i = 0; i < 500; i++) batch.push(plainMutation());
  batch.push(headingMutation());
  observer.callback(batch);
  assert.equal(calls, 0, 'meaningful record beyond the scan cap must not trigger this batch');
});

test('a heading mutation within the scan cap is still detected', () => {
  var env = loadWatcher();
  var calls = 0;
  var watcher = env.createDomWatcher(function () { calls++; }, { selectors: [] });
  watcher.start();
  var observer = env.getObserver();

  // A small batch well within the cap with one heading record → detected.
  observer.callback([plainMutation(), headingMutation()]);
  assert.equal(calls, 1, 'meaningful record within the cap is detected as before');
});
