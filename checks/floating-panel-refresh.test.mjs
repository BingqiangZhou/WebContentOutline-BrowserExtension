/**
 * floating-panel's post-navigation refresh goes through the scheduler.
 *
 * Clicking a TOC item holds the navigation lock (so the reading-position
 * observer cannot override the highlight while the page scrolls). Rebuild
 * requests that arrive meanwhile are parked by the scheduler. When the lock
 * releases, the panel flushes that parked request — and it must do so through
 * the scheduler: it used to withdraw the request and call a bare rebuild
 * instead, which merely JOINED a rebuild that was already in flight, so the
 * parked change was lost until the next unrelated mutation.
 *
 * Runs the REAL floating-panel, the REAL rebuild-scheduler and the REAL
 * nav-lock in one sandbox, wired the way toc-app wires them. toc-app itself is
 * not in this sandbox: the scheduler here only ever parks behind ITS OWN
 * in-flight rebuild. A rebuild toc-app started directly (hover-expand, the
 * Refresh button) is covered in checks/toc-app-scheduler.test.mjs, where the
 * scheduler is told about it through isRebuildInFlight / notifySettled.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Minimal element double that records event listeners so a test can click.
function makeEl(tagName) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    textContent: '',
    dataset: {},
    attrs: {},
    children: [],
    _parent: null,
    _classes: new Set(),
    _listeners: {},
    _tabIndex: undefined,
    hidden: false,
    isConnected: true,
    style: { setProperty() {}, removeProperty() {} }
  };
  // `el.className = 'a b'` (how the panel assigns classes) and classList share one set.
  Object.defineProperty(el, 'className', {
    get() { return [...el._classes].join(' '); },
    set(value) { el._classes = new Set(String(value).split(/\s+/).filter(Boolean)); },
    configurable: true,
    enumerable: true
  });
  el.classList = {
    add(name) { el._classes.add(name); },
    remove(name) { el._classes.delete(name); },
    contains(name) { return el._classes.has(name); },
    toggle(name, force) {
      const next = force !== undefined ? !!force : !el._classes.has(name);
      if (next) el._classes.add(name); else el._classes.delete(name);
    }
  };
  Object.defineProperty(el, 'tabIndex', {
    get() { return el._tabIndex; },
    set(v) { el._tabIndex = v; },
    configurable: true,
    enumerable: true
  });
  el.setAttribute = function (name, value) { el.attrs[name] = String(value); };
  el.getAttribute = function (name) { return name in el.attrs ? el.attrs[name] : null; };
  el.removeAttribute = function (name) { delete el.attrs[name]; };
  el.appendChild = function (child) { child._parent = el; el.children.push(child); return child; };
  el.replaceChildren = function () { el.children.forEach((c) => { c._parent = null; }); el.children.length = 0; };
  el.remove = function () {
    if (el._parent) {
      const i = el._parent.children.indexOf(el);
      if (i >= 0) el._parent.children.splice(i, 1);
      el._parent = null;
    }
    el.isConnected = false;
  };
  el.contains = function (node) {
    for (const c of el.children) { if (c === node || c.contains(node)) return true; }
    return false;
  };
  el.closest = function (selector) {
    const wanted = selector.replace(/^\./, '');
    for (let n = el; n; n = n._parent) { if (n._classes && n._classes.has(wanted)) return n; }
    return null;
  };
  el.addEventListener = function (type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); };
  el.removeEventListener = function (type, fn) { el._listeners[type] = (el._listeners[type] || []).filter((f) => f !== fn); };
  // Like a real DOM event, the dispatch bubbles to the ancestors' listeners.
  el.dispatch = function (type, event) {
    event.target = el;
    for (let n = el; n; n = n._parent) {
      for (const fn of [...(n._listeners[type] || [])]) fn(event);
    }
  };
  el.focus = function () {};
  return el;
}

// The three real modules in one context. Timers are queued and fired by
// runTimers(), so time can be advanced one step at a time.
function loadPanelWithScheduler() {
  const timers = new Map();
  let nextTimerId = 1;
  const parkedRebuilds = [];
  const script = (relativePath) => stripImportsAndExports(stripTsSyntax(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')));
  const sandbox = {
    console: { ...console, warn() {}, debug() {} },
    Date: { now: () => 1_000_000 },
    AbortController,
    document: {
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
      createElement: makeEl,
      createDocumentFragment: () => makeEl('#fragment'),
      documentElement: makeEl('html')
    },
    window: { addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame(cb) { cb(); return 1; },
    cancelAnimationFrame() {},
    setTimeout(fn) { const id = nextTimerId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    // floating-panel collaborators
    msg: (key) => 'L:' + key,
    normalizeSide: (side) => side,
    isTocContentIdentical: () => false,
    cleanupOwnedElements() {},
    scrollToElement() {},
    getTocShadowRootSync: () => null,
    EXTENSION_OWNER: 'web-toc-assistant',
    // rebuild-scheduler collaborators
    createDomWatcher: () => ({ start: () => true, stop() {}, invalidate() {}, checkAndReconnect() {} }),
    createUrlMonitor: () => ({ start() {}, stop() {}, invalidate() {} }),
    isContextInvalidatedError: () => false,
    invalidateChatbotCache() {},
    isStreaming: () => false,
    getChatbotContainerSelector: () => null,
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    script('src/core/nav-lock.ts') + '\n' + script('src/core/rebuild-scheduler.ts') + '\n' + script('src/ui/floating-panel.ts') +
    '\n__exports.createNavLock = createNavLock;' +
    '\n__exports.createRebuildScheduler = createRebuildScheduler;' +
    '\n__exports.renderFloatingPanel = renderFloatingPanel;',
    sandbox,
    { filename: 'nav-lock.ts + rebuild-scheduler.ts + floating-panel.ts' }
  );

  const navLock = sandbox.__exports.createNavLock({
    // What toc-app's onUnlock does: flush a parked rebuild, if there is one.
    onUnlock: () => { if (scheduler.getPendingRebuild()) scheduler.setPendingRebuild(true); }
  });
  const scheduler = sandbox.__exports.createRebuildScheduler(
    () => new Promise((resolve) => parkedRebuilds.push(resolve)),   // each rebuild parks until released
    { navLock }
  );
  scheduler.start({ selectors: [] });

  const mountTarget = makeEl('div');
  const panel = sandbox.__exports.renderFloatingPanel({
    items: [{ id: 'a', el: makeEl('h2'), text: 'Section A', level: 2 }],
    mountTarget,
    skipAnimation: true,
    navLock,
    getPendingRebuild: scheduler.getPendingRebuild,
    setPendingRebuild: scheduler.setPendingRebuild
  });
  const firstButton = (node) => {
    for (const c of node.children) { if (c.tagName === 'BUTTON') return c; const inner = firstButton(c); if (inner) return inner; }
    return null;
  };
  return {
    navLock,
    scheduler,
    parkedRebuilds,
    clickFirstItem() { firstButton(panel.__node || mountTarget).dispatch('click', { preventDefault() {} }); },
    advanceTime() {
      // One "round" of queued timers; timers queued during the round run next round.
      for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
    },
    remove() { panel.remove(); scheduler.disconnect(); }
  };
}

test('a rebuild parked during navigation is re-dispatched even while another rebuild is in flight', async () => {
  const env = loadPanelWithScheduler();

  env.scheduler.setPendingRebuild(true);            // rebuild #1 starts and parks
  env.scheduler.setPendingRebuild(true);            // a page change lands mid-rebuild → queued
  assert.equal(env.parkedRebuilds.length, 1);

  env.clickFirstItem();                             // the user clicks a TOC item
  assert.equal(env.navLock.isLocked(), true, 'navigation holds the lock');
  env.advanceTime();                                // the lock releases (800ms) …
  assert.equal(env.navLock.isLocked(), false);
  env.advanceTime();                                // … and the panel re-checks for a parked rebuild (100ms)
  assert.equal(env.parkedRebuilds.length, 1, 'nothing runs while rebuild #1 is in flight');

  env.parkedRebuilds.shift()('ok');                 // rebuild #1 completes
  await flush();

  assert.equal(env.parkedRebuilds.length, 1, 'the parked change is rebuilt afterwards, with no further page event');
  env.parkedRebuilds.shift()('ok');
  await flush();
  env.remove();
});

test('no rebuild is forced when nothing was parked during navigation', async () => {
  const env = loadPanelWithScheduler();

  env.clickFirstItem();
  env.advanceTime();
  env.advanceTime();
  await flush();

  assert.equal(env.parkedRebuilds.length, 0);
  env.remove();
});
