/**
 * dom-utils: uniqueInDocumentOrder ordering correctness + no host-DOM mutation,
 * and cleanupOwnedElements reaching the extension's own (closed) shadow root.
 *
 * - Ordering / dedup tests are characterization (pass before & after the
 *   WeakMap refactor).
 * - "never writes __tocSrcOrder onto host elements" is a RED test for the
 *   current expando implementation: the current code writes the property (then
 *   deletes it in a finally). A property setter detects the WRITE itself, so
 *   this fails today and passes once the expando is replaced with a WeakMap.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadUniqueInDocumentOrder() {
  var file = path.join(repoRoot, 'src/utils/dom-utils.ts');
  var source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export\s+async\s+function /g, 'async function ')
    .replace(/export function /g, 'function '));
  var sandbox = {
    console: console,
    Node: { ELEMENT_NODE: 1 },
    document: { documentElement: { nodeType: 1 } },
    XPathResult: { ORDERED_NODE_ITERATOR_TYPE: 1 },
    uiConst: function (_n, f) { return f; },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.uniqueInDocumentOrder = uniqueInDocumentOrder;', sandbox, { filename: file });
  return sandbox.__exports.uniqueInDocumentOrder;
}

// Element whose compareDocumentPosition reports "disconnected" (bit 1), so the
// sort falls back to source order — deterministic regardless of host DOM.
function disc(text) {
  return { tagName: 'H2', textContent: text, compareDocumentPosition: function () { return 1; } };
}

// Element that records whether __tocSrcOrder is ever WRITTEN onto it (via a
// setter). The current impl writes-then-deletes the expando; a setter catches
// the write even though the property is gone by the time the call returns.
function tracked() {
  var el = { tagName: 'H2', textContent: 'X', compareDocumentPosition: function () { return 1; } };
  var writes = 0;
  Object.defineProperty(el, '__tocSrcOrder', {
    configurable: true,
    get: function () { return undefined; },
    set: function () { writes++; }
  });
  return { el: el, writes: function () { return writes; } };
}

test('uniqueInDocumentOrder preserves source order for disconnected elements', () => {
  var fn = loadUniqueInDocumentOrder();
  var a = disc('A'), b = disc('B'), c = disc('C');
  // NOTE: compare via primitives/index identity — the returned array is from
  // the vm sandbox (different Array.prototype), so deepEqual rejects it.
  var r = fn([a, b, c]);
  assert.equal(r.length, 3);
  assert.strictEqual(r[0], a);
  assert.strictEqual(r[1], b);
  assert.strictEqual(r[2], c);
});

test('uniqueInDocumentOrder deduplicates by element identity', () => {
  var fn = loadUniqueInDocumentOrder();
  var a = disc('A'), b = disc('B');
  var r = fn([a, b, a]);
  assert.equal(r.length, 2);
  assert.strictEqual(r[0], a);
  assert.strictEqual(r[1], b);
});

test('uniqueInDocumentOrder never writes __tocSrcOrder onto host elements', () => {
  var fn = loadUniqueInDocumentOrder();
  var a = tracked(), b = tracked();
  fn([a.el, b.el]);
  assert.equal(a.writes(), 0, 'must not write __tocSrcOrder onto host element A');
  assert.equal(b.writes(), 0, 'must not write __tocSrcOrder onto host element B');
});

// Loads dom-utils.ts with an owned element sitting inside the extension's
// shadow root. No [data-toc-owner] host is discoverable in the light DOM and
// `host.shadowRoot` is null for a closed root, so the only way in is the
// module accessor.
function loadCleanupOwnedElements() {
  var file = path.join(repoRoot, 'src/utils/dom-utils.ts');
  var source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export\s+async\s+function /g, 'async function ')
    .replace(/export function /g, 'function '));
  var hooks = { cleanup: 0, remove: 0 };
  var owned = {
    __TOC_CLEANUP__: function () { hooks.cleanup++; },
    remove: function () { hooks.remove++; }
  };
  var shadowRoot = { querySelectorAll: function () { return [owned]; } };
  var sandbox = {
    console: console,
    Node: { ELEMENT_NODE: 1 },
    XPathResult: { ORDERED_NODE_ITERATOR_TYPE: 1 },
    EXTENSION_OWNER: 'web-toc-assistant',
    getTocShadowRootSync: function () { return shadowRoot; },
    document: {
      documentElement: { nodeType: 1 },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; }
    },
    uiConst: function (_n, f) { return f; },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.cleanupOwnedElements = cleanupOwnedElements;', sandbox, { filename: file });
  return { cleanupOwnedElements: sandbox.__exports.cleanupOwnedElements, hooks: hooks };
}

test('cleanupOwnedElements tears down UI that lives inside the closed shadow root', () => {
  var env = loadCleanupOwnedElements();
  env.cleanupOwnedElements();
  // Without this, every disable/re-enable leaks the dock's and panel's listeners and timers.
  assert.equal(env.hooks.cleanup, 1, 'the owned element must run its cleanup hook');
  assert.equal(env.hooks.remove, 1, 'the owned element must be removed');
});
