/**
 * rebuild-scheduler: a rebuild request that lands while a rebuild is already in
 * flight must not be lost.
 *
 * The scheduler collapses concurrent requests by parking them in
 * `hasPendingRebuild`. Before this behavior existed nothing re-dispatched the
 * parked request when the in-flight rebuild finished, so a change that arrived
 * mid-rebuild stayed invisible until some unrelated event (another mutation, a
 * navigation) happened to rebuild again.
 *
 * Re-dispatching has edges that must NOT fire: a failed rebuild, a hidden tab,
 * a held navigation lock, a tripped breaker, a disconnected scheduler, and a
 * request that was withdrawn again. Each of those has its own recovery path.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, loadTocApp } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Flush host microtasks (vm shares the host microtask queue) so awaited rebuild
// chains inside the sandbox settle between steps.
function flush() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

// Load the real rebuild-scheduler with a mutable tab/lock state and captured
// page listeners. Short timers fire synchronously (collapses the debounce), as
// in checks/circuit-breaker.test.mjs.
function loadScheduler(opts) {
  const state = { hidden: false, locked: false };
  const captured = { onMutation: null, onUrlChange: null, visibilityHandler: null };
  const nextTimerId = { value: 1 };
  const file = path.join(repoRoot, 'src/core/rebuild-scheduler.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export\s+async\s+function /g, 'async function ')
    .replace(/export function /g, 'function '));
  const sandbox = {
    console: { ...console, warn() {}, debug() {} },
    Date: { now: () => 1_000_000 },
    document: {
      get hidden() { return state.hidden; },
      addEventListener(type, fn) { if (type === 'visibilitychange') captured.visibilityHandler = fn; },
      removeEventListener(type, fn) { if (type === 'visibilitychange' && captured.visibilityHandler === fn) captured.visibilityHandler = null; }
    },
    setTimeout: function (fn) { try { fn(); } catch (_) {} return nextTimerId.value++; },
    clearTimeout: function () {},
    createDomWatcher: function (onMutation) {
      captured.onMutation = onMutation;
      return { start: () => true, stop() {}, invalidate() {}, checkAndReconnect() {} };
    },
    createUrlMonitor: function () {
      return {
        start: function (_cfg, onUrlChange) { captured.onUrlChange = onUrlChange; },
        stop() {},
        invalidate() {}
      };
    },
    isContextInvalidatedError: function () { return false; },
    invalidateChatbotCache() {},
    isStreaming: () => false,
    getChatbotContainerSelector: () => null,
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.createRebuildScheduler = createRebuildScheduler;', sandbox, { filename: file });
  const handle = sandbox.__exports.createRebuildScheduler(opts.onRebuild, {
    navLock: { isLocked: () => state.locked }
  });
  return {
    handle,
    setHidden: (hidden) => { state.hidden = hidden; },
    setLocked: (locked) => { state.locked = locked; },
    fireVisibilityChange: () => { if (captured.visibilityHandler) captured.visibilityHandler(); }
  };
}

// A scheduler whose rebuilds stay in flight until a test resolves them.
function loadParkedScheduler() {
  const pending = [];
  const calls = { count: 0 };
  const env = loadScheduler({
    onRebuild: () => { calls.count++; return new Promise((resolve) => pending.push(resolve)); }
  });
  env.handle.start({ selectors: [] });
  return {
    ...env,
    calls,
    finishInFlight(status) { pending.shift()(status); }
  };
}

test('a request that lands during an in-flight rebuild runs once that rebuild succeeds', async () => {
  const env = loadParkedScheduler();

  env.handle.setPendingRebuild(true);              // request → rebuild #1 starts
  assert.equal(env.calls.count, 1);
  env.handle.setPendingRebuild(true);              // a second request lands mid-rebuild
  assert.equal(env.calls.count, 1, 'rebuilds never overlap');

  env.finishInFlight('ok');
  await flush();
  assert.equal(env.calls.count, 2, 'the queued request is re-dispatched without another external trigger');
  assert.equal(env.handle.getPendingRebuild(), false);

  env.finishInFlight('ok');                        // nothing landed during rebuild #2
  await flush();
  assert.equal(env.calls.count, 2, 'exactly one follow-up, no loop');
  env.handle.disconnect();
});

test('a queued request waits while the tab is hidden and runs when it is visible again', async () => {
  const env = loadParkedScheduler();
  env.handle.setPendingRebuild(true);
  env.handle.setPendingRebuild(true);

  env.setHidden(true);
  env.finishInFlight('ok');
  await flush();
  assert.equal(env.calls.count, 1, 'no rebuild is started in a hidden tab');

  env.setHidden(false);
  env.fireVisibilityChange();                      // the existing visibilitychange path
  assert.equal(env.calls.count, 2);
  env.handle.disconnect();
});

test('a queued request waits for the navigation lock and runs on unlock', async () => {
  const env = loadParkedScheduler();
  env.handle.setPendingRebuild(true);
  env.handle.setPendingRebuild(true);

  env.setLocked(true);
  env.finishInFlight('ok');
  await flush();
  assert.equal(env.calls.count, 1, 'no rebuild while the user is navigating');

  env.setLocked(false);
  env.handle.setPendingRebuild(true);              // what toc-app's onUnlock does
  assert.equal(env.calls.count, 2);
  env.handle.disconnect();
});

test('a failed rebuild is not retried immediately — the breaker still trips after 5 failures', async () => {
  const env = loadParkedScheduler();

  for (let round = 1; round <= 5; round++) {
    env.handle.setPendingRebuild(true);            // rebuild starts
    env.handle.setPendingRebuild(true);            // a request lands mid-rebuild
    env.finishInFlight('fail');
    await flush();
  }
  // An immediate retry per burst would count two failures per round and trip
  // the breaker about twice as fast on a page that is merely erroring.
  assert.equal(env.calls.count, 5);
  env.handle.disconnect();
});

test('nothing is dispatched when the scheduler was disconnected mid-rebuild', async () => {
  const env = loadParkedScheduler();
  env.handle.setPendingRebuild(true);
  env.handle.setPendingRebuild(true);

  env.handle.disconnect();
  env.finishInFlight('ok');
  await flush();
  assert.equal(env.calls.count, 1);
});

test('a request withdrawn during the rebuild is not re-dispatched', async () => {
  const env = loadParkedScheduler();
  env.handle.setPendingRebuild(true);
  env.handle.setPendingRebuild(true);
  env.handle.setPendingRebuild(false);              // what floating-panel does before a manual refresh

  env.finishInFlight('ok');
  await flush();
  assert.equal(env.calls.count, 1);
  env.handle.disconnect();
});

// ---------------------------------------------------------------------------
// toc-app: refreshConfig() landing in the middle of a rebuild
//
// content.ts calls app.refreshConfig() whenever tocConfigs changes in storage.
// rebuild() collapses concurrent calls by returning the in-flight promise, so a
// refresh that landed mid-rebuild used to vanish: it set the dirty flag, joined
// a rebuild that may have read the OLD selectors, and nothing ran afterwards.
// ---------------------------------------------------------------------------

async function settle() {
  await flush();
  await flush();
}

test('refreshConfig() landing mid-rebuild runs one trailing rebuild that applies the new config', async () => {
  const env = loadTocApp();
  const cfg = { urlPattern: 'https://site.example/*', side: 'right', selectors: [] };
  const app = env.initForConfig(cfg, {});
  await settle();                                    // the initial rebuild parks inside buildTocItems
  assert.deepEqual({ ...env.counters }, { configReads: 1, builds: 1 });

  app.refreshConfig();                               // storage.onChanged: the user added a selector
  app.refreshConfig();                               // a second change lands in the same window
  env.finishBuild();                                 // rebuild #1 completes with the OLD selectors
  await settle();

  assert.equal(env.counters.configReads, 2, 'the config is re-read without another external trigger');
  assert.equal(env.counters.builds, 2);
  assert.equal(cfg.selectors[0].expr, '.new');

  env.finishBuild();
  await settle();
  assert.equal(env.counters.builds, 2, 'exactly one follow-up, no loop');
  app.destroy();
});

test('a refresh that lands before the in-flight rebuild has cleared the dirty flag still re-reads the config', async () => {
  // Window: the in-flight rebuild is parked inside updateConfigFromStorage. It
  // will clear configDirty AFTER our refresh set it, and then build with the
  // stale selectors it just read — so the follow-up must re-mark the config dirty.
  const env = loadTocApp({ parkConfigReads: true });
  const cfg = { urlPattern: 'https://site.example/*', side: 'right', selectors: [] };
  const app = env.initForConfig(cfg, {});
  await settle();
  assert.equal(env.counters.configReads, 1);

  app.refreshConfig();
  env.releaseConfigRead();                           // the stale read completes
  await settle();                                    // …and that rebuild parks in buildTocItems
  assert.equal(env.counters.builds, 1);

  env.finishBuild();
  await settle();
  assert.equal(env.counters.configReads, 2, 'the follow-up must read the config again');
  assert.equal(cfg.selectors[0].expr, '.new');

  env.releaseConfigRead();                           // the follow-up's own read completes
  await settle();                                    // …and it parks in buildTocItems
  assert.equal(env.counters.builds, 2, 'the follow-up rebuilds with the new selectors');
  env.finishBuild();
  await settle();
  app.destroy();
});

test('no trailing rebuild runs after the instance was destroyed', async () => {
  const env = loadTocApp();
  const app = env.initForConfig({ urlPattern: 'https://site.example/*', side: 'right', selectors: [] }, {});
  await settle();

  app.refreshConfig();
  app.destroy();
  env.finishBuild();
  await settle();

  assert.deepEqual({ ...env.counters }, { configReads: 1, builds: 1 });
});

test('a plain rebuild() call landing mid-rebuild does not schedule a follow-up', async () => {
  const env = loadTocApp();
  const app = env.initForConfig({ urlPattern: 'https://site.example/*', side: 'right', selectors: [] }, {});
  await settle();

  app.rebuild();                                     // e.g. a second Refresh click
  env.finishBuild();
  await settle();

  assert.deepEqual({ ...env.counters }, { configReads: 1, builds: 1 });
  app.destroy();
});
