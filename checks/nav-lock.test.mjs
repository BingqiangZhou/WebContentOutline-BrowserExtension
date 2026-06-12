import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadNavLock() {
  var file = path.join(repoRoot, 'src/core/nav-lock.ts');
  var source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  var sandbox = {
    console: console,
    setTimeout: function (fn, delay) { var tid = ++id; timers.push({ id: tid, fn: fn, delay: delay || 0 }); return tid; },
    clearTimeout: function (i) { timers = timers.filter(function (t) { return t.id !== i; }); },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.createNavLock = createNavLock;', sandbox, { filename: file });
  return sandbox.__exports.createNavLock;
}

var timers = [];
var id = 0;
function fireLastTimer() {
  if (timers.length) { var t = timers.shift(); try { t.fn(); } catch (_) {} }
}

test('navLock fires onUnlock when its auto-unlock timer expires', () => {
  timers = []; id = 0;
  var createNavLock = loadNavLock();
  var unlocked = 0;
  var lock = createNavLock({ onUnlock: function () { unlocked++; } });

  lock.lock(3000);
  assert.equal(lock.isLocked(), true);
  assert.equal(unlocked, 0);
  fireLastTimer(); // auto-unlock timer expires
  assert.equal(lock.isLocked(), false);
  assert.equal(unlocked, 1, 'onUnlock fires when the lock auto-releases');
});

test('explicit unlock also fires onUnlock', () => {
  timers = []; id = 0;
  var createNavLock = loadNavLock();
  var unlocked = 0;
  var lock = createNavLock({ onUnlock: function () { unlocked++; } });

  lock.lock(3000);
  lock.unlock();
  assert.equal(unlocked, 1, 'explicit unlock notifies');
  // Auto-unlock timer (if it later fires) must not double-fire.
  fireLastTimer();
  assert.equal(unlocked, 1);
});

test('onUnlock is optional (no throw when omitted)', () => {
  timers = []; id = 0;
  var createNavLock = loadNavLock();
  var lock = createNavLock();
  lock.lock(1000);
  fireLastTimer();
  assert.equal(lock.isLocked(), false);
});
