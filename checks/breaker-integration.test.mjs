import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Flush host microtasks (vm shares the host microtask queue) so awaited rebuild
// chains inside the sandbox settle between steps.
function flush() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

// Integration-level breaker test: the REAL toc-app rebuild() never rejects —
// it resolves 'fail' after logging a caught build error (see rebuildOnce's
// catch in src/core/toc-app.ts). The scheduler must count that resolved
// status, or the circuit breaker can never trip in production — which is
// exactly how it silently died before the status contract existed.
// (circuit-breaker.test.mjs covers the legacy rejected-promise path.)
function loadScheduler(opts) {
  var onRebuild = opts.onRebuild;
  var currentTime = opts.startTime || 1_000_000;
  var captured = { onMutation: null, onUrlChange: null };
  var LONG_TIMER_THRESHOLD = 5000;
  var longTimers = [];
  var nextTimerId = 1;
  var file = path.join(repoRoot, 'src/core/rebuild-scheduler.ts');
  var source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export\s+async\s+function /g, 'async function ')
    .replace(/export function /g, 'function '));
  var sandbox = {
    console: console,
    Date: { now: function () { return currentTime; } },
    document: { hidden: false, addEventListener: function () {}, removeEventListener: function () {} },
    setTimeout: function (fn, delay) {
      var d = Number(delay) || 0;
      if (d <= LONG_TIMER_THRESHOLD) { try { fn(); } catch (_) {} return nextTimerId++; }
      var id = nextTimerId++;
      longTimers.push({ id: id, fn: fn, fireAt: currentTime + d });
      return id;
    },
    clearTimeout: function (id) {
      if (id == null) return;
      for (var i = 0; i < longTimers.length; i++) {
        if (longTimers[i].id === id) { longTimers.splice(i, 1); return; }
      }
    },
    createDomWatcher: function (onMutation, _opts) {
      captured.onMutation = onMutation;
      return { start: function () { return true; }, stop: function () {}, invalidate: function () {}, checkAndReconnect: function () {} };
    },
    createUrlMonitor: function (_opts) {
      return {
        start: function (_cfg, onUrlChange) { captured.onUrlChange = onUrlChange; },
        stop: function () {},
        invalidate: function () {}
      };
    },
    isContextInvalidatedError: function () { return false; },
    invalidateChatbotCache: function () {},
    isStreaming: function () { return false; },
    getChatbotContainerSelector: function () { return null; },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    source + '\n__exports.createRebuildScheduler = createRebuildScheduler;',
    sandbox,
    { filename: file }
  );
  var handle = sandbox.__exports.createRebuildScheduler(onRebuild, {
    navLock: { isLocked: function () { return false; } }
  });
  return {
    handle: handle,
    captured: captured,
    advance: function (ms) {
      currentTime += ms;
      var fired = [];
      for (var i = longTimers.length - 1; i >= 0; i--) {
        if (longTimers[i].fireAt <= currentTime) fired.push(longTimers.splice(i, 1)[0]);
      }
      fired.sort(function (a, b) { return a.fireAt - b.fireAt; });
      for (var j = 0; j < fired.length; j++) {
        try { fired[j].fn(); } catch (_) {}
      }
    }
  };
}

test('resolved "fail" status (the real toc-app contract) trips the breaker', async () => {
  var rebuildCalls = 0;
  var env = loadScheduler({
    // Mimics toc-app's rebuild(): never rejects, resolves 'fail' per error.
    onRebuild: function () {
      rebuildCalls++;
      return Promise.resolve('fail');
    }
  });
  env.handle.start({ selectors: [] });
  await flush();

  // 5 resolved-'fail' rebuilds trip the breaker; the 6th mutation is blocked.
  for (var i = 0; i < 6; i++) { env.captured.onMutation(); await flush(); }
  assert.equal(rebuildCalls, 5, 'resolved fail status must count toward the breaker');

  // Recovery probe: no external event, just time passing.
  env.advance(31000);
  await flush();
  assert.equal(rebuildCalls, 6, 'half-open probe retries after the recovery window');
});

test('a successful rebuild resets the failure count', async () => {
  var rebuildCalls = 0;
  var failFirst = 3;
  var env = loadScheduler({
    onRebuild: function () {
      rebuildCalls++;
      if (rebuildCalls <= failFirst) return Promise.resolve('fail');
      return Promise.resolve('ok');
    }
  });
  env.handle.start({ selectors: [] });
  await flush();

  // Interleave failures and successes: the counter must reset on each 'ok',
  // so the breaker (threshold 5 consecutive) never trips.
  for (var round = 0; round < 4; round++) {
    for (var i = 0; i < 4; i++) { env.captured.onMutation(); await flush(); }
  }
  assert.equal(rebuildCalls, 16, 'every mutation rebuilds while failures never reach 5 consecutive');
});
