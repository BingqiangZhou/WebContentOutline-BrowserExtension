import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Loads url-monitor with a controllable clock so we can drive the poll and the
// 500ms url-change debounce deterministically. opts.navigation injects a fake
// Navigation API (globalThis.navigation); opts.history injects a history object
// whose wrapping can be asserted.
function loadUrlMonitor(initialHref, opts) {
  opts = opts || {};
  var file = path.join(repoRoot, 'src/core/url-monitor.ts');
  var source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export function /g, 'function '));
  var captured = { onChangeArgs: [] };
  var currentTime = 0;
  var nextId = 1;
  var timers = [];
  var loc = { href: initialHref || 'https://example.com/a' };
  var navListeners = {};
  var navigation = opts.navigation || null;
  if (navigation) {
    navigation.addEventListener = function (type, fn) {
      (navListeners[type] = navListeners[type] || []).push(fn);
    };
    navigation.removeEventListener = function (type, fn) {
      var list = navListeners[type] || [];
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
  var origPushState = function () {};
  var origReplaceState = function () {};
  var history = opts.history || null;
  if (history) {
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
  }
  var sandbox = {
    console: console,
    location: loc,
    document: { hidden: false, addEventListener: function () {}, removeEventListener: function () {} },
    window: { addEventListener: function () {}, removeEventListener: function () {} },
    setTimeout: function (fn, delay) {
      var id = nextId++;
      timers.push({ id: id, fn: fn, fireAt: currentTime + (Number(delay) || 0) });
      return id;
    },
    clearTimeout: function (id) {
      timers = timers.filter(function (t) { return t.id !== id; });
    },
    __exports: {}
  };
  if (navigation) sandbox.navigation = navigation;
  if (history) sandbox.history = history;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.createUrlMonitor = createUrlMonitor;', sandbox, { filename: file });
  var handle = null;
  return {
    captured: captured,
    loc: loc,
    start: function (onChange) {
      handle = sandbox.__exports.createUrlMonitor({});
      handle.start({}, function (immediate) {
        captured.onChangeArgs.push(immediate);
        if (onChange) onChange(immediate);
      });
    },
    stop: function () {
      if (handle) handle.stop();
    },
    fireNavigationSuccess: function () {
      (navListeners.navigatesuccess || []).slice().forEach(function (fn) { fn(); });
    },
    navigationListeners: function () {
      return (navListeners.navigatesuccess || []).length;
    },
    historyWrapped: function () {
      return !!history && (history.pushState !== origPushState || history.replaceState !== origReplaceState);
    },
    advance: function (ms) {
      currentTime += ms;
      var due = timers.filter(function (t) { return t.fireAt <= currentTime; }).sort(function (a, b) { return a.fireAt - b.fireAt; });
      timers = timers.filter(function (t) { return t.fireAt > currentTime; });
      for (var i = 0; i < due.length; i++) { try { due[i].fn(); } catch (_) {} }
    }
  };
}

test('url change schedules a debounced (non-immediate) rebuild so the SPA can render first', () => {
  var env = loadUrlMonitor('https://example.com/a');
  env.start();
  // SPA navigation
  env.loc.href = 'https://example.com/b';
  env.advance(3000); // first poll detects the href change -> schedules 500ms timer
  env.advance(500);  // fires the url-change callback
  assert.deepEqual(env.captured.onChangeArgs, [false]);
});

test('navigatesuccess drives the debounced URL-change callback without touching history', () => {
  var env = loadUrlMonitor('https://example.com/a', { navigation: {}, history: {} });
  env.start();
  assert.equal(env.navigationListeners(), 1, 'a navigatesuccess listener is registered');
  // SPA navigation
  env.loc.href = 'https://example.com/b';
  env.fireNavigationSuccess();
  env.advance(500); // the 500ms url-change debounce
  assert.deepEqual(env.captured.onChangeArgs, [false]);
  assert.equal(env.historyWrapped(), false, 'history.pushState must stay untouched when the Navigation API exists');
  env.stop();
  assert.equal(env.navigationListeners(), 0, 'stop() removes the navigatesuccess listener');
});

test('without the Navigation API the legacy history wrap still detects pushState', () => {
  var env = loadUrlMonitor('https://example.com/a', { history: {} });
  env.start();
  assert.equal(env.navigationListeners(), 0, 'no Navigation API — nothing to register');
  assert.equal(env.historyWrapped(), true, 'legacy path wraps history.pushState');
  env.loc.href = 'https://example.com/b';
  env.advance(3000); // poll fallback detects the change
  env.advance(500);
  assert.deepEqual(env.captured.onChangeArgs, [false]);
  env.stop();
  assert.equal(env.historyWrapped(), false, 'stop() restores the original history methods');
});
