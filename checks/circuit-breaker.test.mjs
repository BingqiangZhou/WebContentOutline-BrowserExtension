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

// Load rebuild-scheduler in a vm sandbox with synchronous setTimeout (collapses
// debounce) and a controllable clock. Returns the scheduler handle plus captured
// mutation/url-change callbacks so tests can drive it.
function loadScheduler(opts) {
  var onRebuild = opts.onRebuild;
  var currentTime = opts.startTime || 1_000_000;
  var captured = { onMutation: null, onUrlChange: null };
  // Hybrid fake clock: short timers (<= threshold, e.g. the 400ms debounce)
  // fire synchronously to keep the test flow simple; long timers (the 30s
  // breaker recovery probe) are scheduled and fired by advance().
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

test('circuit breaker resets on URL change after latching open', async () => {
  var rebuildCalls = 0;
  var env = loadScheduler({
    onRebuild: function () { rebuildCalls++; throw new Error('boom'); }
  });
  env.handle.start({ selectors: [] });
  await flush();

  // 5 failures trip the breaker; the 6th mutation is blocked.
  for (var i = 0; i < 6; i++) { env.captured.onMutation(); await flush(); }
  assert.equal(rebuildCalls, 5, '6th rebuild is blocked once the breaker latches');

  // URL change must give the page a fresh chance.
  env.captured.onUrlChange(true);
  await flush();
  assert.equal(rebuildCalls, 6, 'breaker recovers after a URL change');
});

test('breaker actively probes on a quiescent page after the recovery window', async () => {
  var rebuildCalls = 0;
  var env = loadScheduler({
    onRebuild: function () { rebuildCalls++; throw new Error('boom'); }
  });
  env.handle.start({ selectors: [] });
  await flush();

  for (var i = 0; i < 6; i++) { env.captured.onMutation(); await flush(); }
  assert.equal(rebuildCalls, 5);

  // No mutation, no URL change — just time passing. The breaker must schedule
  // its own recovery probe instead of waiting for an external event.
  env.advance(31000);
  await flush();
  assert.equal(rebuildCalls, 6, 'recovery probe runs with no DOM event');
});

test('breaker self-recovers via a half-open probe after the recovery window', async () => {
  var rebuildCalls = 0;
  var shouldFail = true;
  var env = loadScheduler({
    onRebuild: function () { rebuildCalls++; if (shouldFail) throw new Error('boom'); return true; }
  });
  env.handle.start({ selectors: [] });
  await flush();

  for (var i = 0; i < 6; i++) { env.captured.onMutation(); await flush(); }
  assert.equal(rebuildCalls, 5);

  // Still within the recovery window -> no probe yet.
  env.advance(10_000);
  env.captured.onMutation();
  await flush();
  assert.equal(rebuildCalls, 5, 'no probe while inside the recovery window');

  // Past the recovery window -> a probe runs (still failing, window refreshes).
  env.advance(25_000);
  env.captured.onMutation();
  await flush();
  assert.equal(rebuildCalls, 6, 'a half-open probe runs after the recovery window');

  // The page heals; the next probe (after the refreshed window) succeeds and
  // fully resets the breaker.
  shouldFail = false;
  env.advance(31_000);
  env.captured.onMutation();
  await flush();
  assert.equal(rebuildCalls, 7, 'breaker fully resets once a probe succeeds');
});
