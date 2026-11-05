// Floating-panel update behavior: two-node active sync and the append-only
// rebuild fast path. Loads src/ui/floating-panel.ts into a vm sandbox with a
// minimal fake DOM that tracks per-element mutations so tests can assert
// exactly WHICH nodes were touched.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeFakeElement(tagName) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    className: '',
    children: [],
    dataset: {},
    attrs: {},
    __mutations: 0,
    _tabIndex: undefined,
    hidden: false,
    isConnected: true,
    textContent: '',
    _parent: null,
    _classes: new Set()
  };
  el.classList = {
    add(name) { el.__mutations++; el._classes.add(name); },
    remove(name) { el.__mutations++; el._classes.delete(name); },
    contains(name) { return el._classes.has(name); },
    toggle(name, force) {
      el.__mutations++;
      const next = force !== undefined ? !!force : !el._classes.has(name);
      if (next) el._classes.add(name); else el._classes.delete(name);
      return next;
    }
  };
  Object.defineProperty(el, 'tabIndex', {
    get() { return el._tabIndex; },
    set(v) { el.__mutations++; el._tabIndex = v; },
    configurable: true,
    enumerable: true
  });
  el.setAttribute = function (name, value) {
    if (name === 'aria-selected') el.__mutations++;
    el.attrs[name] = String(value);
  };
  el.getAttribute = function (name) { return name in el.attrs ? el.attrs[name] : null; };
  el.removeAttribute = function (name) {
    if (name === 'aria-selected') el.__mutations++;
    delete el.attrs[name];
  };
  el.appendChild = function (child) { child._parent = el; el.children.push(child); return child; };
  el.replaceChildren = function () { el.children.forEach(function (c) { c._parent = null; }); el.children.length = 0; };
  el.remove = function () {
    if (el._parent) {
      const i = el._parent.children.indexOf(el);
      if (i >= 0) el._parent.children.splice(i, 1);
      el._parent = null;
    }
    el.isConnected = false;
  };
  el.addEventListener = function () {};
  el.removeEventListener = function () {};
  el.focus = function () {};
  el.style = {
    setProperty() {}, removeProperty() {}
  };
  return el;
}

function loadPanelSource() {
  return stripImportsAndExports(stripTsSyntax(
    fs.readFileSync(path.join(repoRoot, 'src/ui/floating-panel.ts'), 'utf8')
  ));
}

// Faithful stand-in for core-utils' isTocContentIdentical as the panel uses it:
// same length and same el+text+level per index → identical (mirrors the real
// comparator in src/utils/core-utils.ts).
function isTocContentIdentical(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text || a[i].el !== b[i].el || a[i].level !== b[i].level) return false;
  }
  return true;
}

function loadPanel(items) {
  const file = path.join(repoRoot, 'src/ui/floating-panel.ts');
  const source = loadPanelSource();

  let buttonCreations = 0;
  const timers = [];
  let nextTimerId = 1;
  const mountTarget = makeFakeElement('div');

  const sandbox = {
    console: console,
    document: {
      createElement(tagName) {
        if (String(tagName).toLowerCase() === 'button') buttonCreations++;
        return makeFakeElement(tagName);
      },
      createDocumentFragment() {
        const frag = makeFakeElement('#fragment');
        return frag;
      },
      documentElement: makeFakeElement('html')
    },
    window: { addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame(cb) { cb(); return 1; },
    cancelAnimationFrame() {},
    setTimeout(fn) { const id = nextTimerId++; timers.push({ id, fn }); return id; },
    clearTimeout(id) {
      for (let i = 0; i < timers.length; i++) if (timers[i].id === id) timers.splice(i, 1);
    },
    AbortController: AbortController,
    // Stripped-import shims. msg returns a non-key string so the panel's
    // "untranslated fallback" guards (msg(key) !== key) never strip content.
    msg: (k) => 'localized:' + k,
    normalizeSide: (s) => s,
    isTocContentIdentical: isTocContentIdentical,
    cleanupOwnedElements: () => {},
    scrollToElement: () => {},
    getTocShadowHost: () => null,
    EXTENSION_OWNER: 'web-toc-assistant',
    NAV_LOCK_MS: 3000,
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.renderFloatingPanel = renderFloatingPanel;', sandbox, { filename: file });

  let currentItems = Array.isArray(items) ? items.slice() : [];
  const mutationsSnapshot = new Map();
  const panel = sandbox.__exports.renderFloatingPanel({
    items: currentItems,
    mountTarget: mountTarget,
    skipAnimation: true
  });

  function nodesInTree(root, predicate, acc) {
    acc = acc || [];
    (root.children || []).forEach(function (child) {
      if (predicate(child)) acc.push(child);
      nodesInTree(child, predicate, acc);
    });
    return acc;
  }

  return {
    panel: panel,
    nodeFor(i) { return currentItems[i] && currentItems[i]._node; },
    buttonCount() { return nodesInTree(mountTarget, (el) => el.tagName === 'BUTTON').length; },
    createdButtons() { return buttonCreations; },
    listHasNote() {
      return nodesInTree(mountTarget, (el) => el.className.indexOf('toc-empty') >= 0 && el.attrs.role === 'note').length > 0;
    },
    updateItems(newItems, meta) {
      currentItems = newItems.slice();
      return panel.updateItems(newItems, meta);
    },
    resetButtonCreations() { buttonCreations = 0; },
    mutatedIndexes() {
      const out = [];
      currentItems.forEach(function (item, i) {
        if (item._node && item._node.__mutations > (mutationsSnapshot.get(item._node) || 0)) out.push(i);
      });
      return out;
    },
    resetMutationCounters() {
      currentItems.forEach(function (item) {
        if (item._node) mutationsSnapshot.set(item._node, item._node.__mutations);
      });
    }
  };
}

function sixItems() {
  const out = [];
  for (let i = 0; i < 6; i++) out.push({ id: 'i' + i, el: {}, text: 'Heading ' + i, level: 2 });
  return out;
}

test('setActiveIndex touches only the old and new nodes', () => {
  const env = loadPanel(sixItems());
  env.panel.setActiveIndex(2);
  env.resetMutationCounters();
  env.panel.setActiveIndex(4);
  assert.deepEqual(env.mutatedIndexes(), [2, 4]);
  assert.equal(env.nodeFor(4).classList.contains('active'), true);
  assert.equal(env.nodeFor(4).getAttribute('aria-selected'), 'true');
  assert.equal(env.nodeFor(4).tabIndex, 0);
  assert.equal(env.nodeFor(2).classList.contains('active'), false);
  assert.equal(env.nodeFor(2).tabIndex, -1);
  // No active item: first item becomes the tab stop. (Fresh snapshot: the
  // mutated-index counter is cumulative since the last reset.)
  env.resetMutationCounters();
  env.panel.setActiveIndex(-1);
  // mutatedIndexes reports index order; both cleared node 4 and new tab-stop
  // node 0 must be touched — and nothing else.
  assert.deepEqual(env.mutatedIndexes().sort(function (a, b) { return a - b; }), [0, 4]);
  assert.equal(env.nodeFor(0).tabIndex, 0);
  assert.equal(env.nodeFor(4).classList.contains('active'), false);
});

test('setActiveIndex is idempotent for the same index', () => {
  const env = loadPanel(sixItems());
  env.panel.setActiveIndex(3);
  env.resetMutationCounters();
  env.panel.setActiveIndex(3);
  assert.deepEqual(env.mutatedIndexes(), []);
});

function letterItems() {
  const mk = (id, text) => ({ id: id, el: {}, text: text, level: 2 });
  return { a: mk('a', 'A'), b: mk('b', 'B'), c: mk('c', 'C'), d: mk('d', 'D'), e: mk('e', 'E') };
}

test('tail-append update reuses existing nodes and appends only the delta', () => {
  const L = letterItems();
  const env = loadPanel([L.a, L.b, L.c]);
  const before = [env.nodeFor(0), env.nodeFor(1), env.nodeFor(2)];
  env.resetButtonCreations();
  assert.equal(env.updateItems([L.a, L.b, L.c, L.d, L.e], null), true);
  assert.equal(env.buttonCount(), 5);
  assert.equal(env.createdButtons(), 2, 'only the appended items create buttons');
  assert.deepEqual([env.nodeFor(0), env.nodeFor(1), env.nodeFor(2)], before, 'prefix nodes preserved by identity');
  assert.equal(env.nodeFor(4).textContent, 'E');
});

test('non-append changes and truncation-note changes fall back to a full re-render', () => {
  const L = letterItems();
  const env = loadPanel([L.a, L.b, L.c]);
  const before = [env.nodeFor(0), env.nodeFor(1), env.nodeFor(2)];
  const b2 = { id: 'b2', el: L.b.el, text: 'B changed', level: 2 };
  env.updateItems([L.a, b2, L.c], null); // mid-list text change
  assert.notEqual(env.nodeFor(1), before[1], 'mid-list change re-renders the list');
  assert.equal(env.buttonCount(), 3);
  assert.equal(env.updateItems([L.a, L.b, L.c, L.d], { truncated: true, maxItems: 400, totalCandidates: 5 }), true);
  assert.equal(env.listHasNote(), true, 'truncation note appears via the full path');
  assert.equal(env.buttonCount(), 4);
});

test('append with FRESH item objects keeps prefix nodes wired (production shape)', () => {
  // Production rebuilds create NEW item objects on every build; only
  // el/text/level match the previous prefix. The fast path must carry the
  // existing _node references onto the new prefix objects — otherwise
  // setActiveIndex / arrow-key focus / focusActive silently no-op for the
  // whole pre-existing list after the first streaming append.
  const L = letterItems();
  const env = loadPanel([L.a, L.b, L.c]);
  env.panel.setActiveIndex(1);
  const before = [env.nodeFor(0), env.nodeFor(1), env.nodeFor(2)];
  env.resetButtonCreations();
  const fresh = [
    { id: 'a2', el: L.a.el, text: 'A', level: 2 },
    { id: 'b2', el: L.b.el, text: 'B', level: 2 },
    { id: 'c2', el: L.c.el, text: 'C', level: 2 },
    { id: 'd2', el: {}, text: 'D', level: 2 }
  ];
  assert.equal(env.updateItems(fresh, null), true);
  assert.equal(env.createdButtons(), 1, 'still append-only');
  assert.equal(env.nodeFor(0), before[0], 'prefix _node carried to the fresh object');
  assert.equal(env.nodeFor(1), before[1]);
  assert.equal(env.nodeFor(2), before[2]);
  // Prove the carried nodes stay live: syncing within the prefix must move
  // the active highlight, not no-op.
  env.resetMutationCounters();
  env.panel.setActiveIndex(0);
  assert.equal(env.nodeFor(0).classList.contains('active'), true);
  assert.equal(env.nodeFor(1).classList.contains('active'), false);
  assert.deepEqual(env.mutatedIndexes().sort(function (a, b) { return a - b; }), [0, 1]);
});
