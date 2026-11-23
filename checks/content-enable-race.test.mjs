/**
 * content.ts: an enable → disable → enable burst while the app is starting.
 *
 * 1.12.0 made startApp() re-check the enabled state after every await, which
 * fixed "disable during initialization leaves a zombie TOC". That check is a
 * boolean, so it cannot tell "still enabled" from "disabled and enabled again":
 * a burst like a fast triple-click on the toolbar icon runs startApp() twice,
 * creates two app instances, and the first one is never destroyed — its
 * MutationObserver, URL poller and IntersectionObserver keep running.
 *
 * Runs the REAL src/content.ts (the injected bootstrap); storage and the app
 * factory are stubbed and controllable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { moduleScript, loadTocMessage } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function settle() {
  // Let awaited chains inside the sandbox (it shares the host microtask queue) run.
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

// The page loads with the site disabled; the tests enable it through the same
// UPDATE_ENABLED message the background sends. Every config read and every
// shadow-root lookup parks until released, so startApp() is observably in
// flight at each of its two awaits. With `opts.parkEnabledRead` the bootstrap's
// own read of the enabled state parks too (it will answer `true`: the site was
// enabled when the page loaded).
function loadContentScript(opts = {}) {
  const instances = [];
  const pendingConfigReads = [];
  const pendingShadowRoots = [];
  const pendingEnabledReads = [];
  const timers = [];
  let messageListener = null;
  let shadowDisposals = 0;

  const sandbox = {
    console: { ...console, debug() {}, warn() {}, error() {}, log() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    location: { href: 'https://site.example/page', origin: 'https://site.example', protocol: 'https:', host: 'site.example' },
    // readyState 'complete' + hidden: the bootstrap takes the timer path.
    document: { readyState: 'complete', hidden: true, addEventListener() {} },
    chrome: {
      runtime: {
        id: 'ext-id',
        sendMessage(_message, callback) { if (callback) callback({ ok: true }); },
        onMessage: {
          addListener(listener) { messageListener = listener; },
          removeListener() {}
        }
      },
      storage: { onChanged: { addListener() {}, removeListener() {} } }
    },
    msg: (key) => key,
    debug() {},
    isContextInvalidatedError: () => false,
    cleanupOwnedElements() {},
    STORAGE_KEYS: { TOC_CONFIGS: 'tocConfigs' },
    buildSitePattern: () => 'https://site.example/*',
    findMatchingConfig: () => null,                 // no stored config for this site
    getConfigs: () => new Promise((resolve) => pendingConfigReads.push(resolve)),
    getSiteEnabledByOrigin: () => (opts.parkEnabledRead
      ? new Promise((resolve) => pendingEnabledReads.push(resolve))
      : Promise.resolve(false)),
    getTocShadowRoot: () => new Promise((resolve) => pendingShadowRoots.push(resolve)),
    disposeTocShadowRoot() { shadowDisposals++; },
    TOC_MESSAGE: loadTocMessage(),
    initForConfig() {
      const instance = {
        id: instances.length + 1,
        destroyed: false,
        expands: 0,
        rebuild: async () => 'ok',
        refreshConfig: async () => 'ok',
        collapse() {},
        expand: async () => { instance.expands++; },
        destroy() { instance.destroyed = true; }
      };
      instances.push(instance);
      return instance;
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const file = path.join(repoRoot, 'src/content.ts');
  vm.runInNewContext(moduleScript(fs.readFileSync(file, 'utf8')) + '\nstartTocContent({});', sandbox, { filename: file });

  return {
    settle,
    // Runs the bootstrap's queued startup step, so main() reaches its read of
    // the enabled state.
    runBootstrap() { timers.splice(0).forEach((fn) => fn()); },
    async send(enabled) {
      messageListener({ type: sandbox.TOC_MESSAGE.UPDATE_ENABLED, enabled }, { id: 'ext-id' }, () => {});
      await settle();
    },
    // What a future popup/command would send: start the app with the panel open.
    async openPanel() {
      messageListener({ type: sandbox.TOC_MESSAGE.OPEN_PANEL }, { id: 'ext-id' }, () => {});
      await settle();
    },
    releaseConfigReads() { pendingConfigReads.splice(0).forEach((resolve) => resolve([])); },
    releaseShadowRoots() { pendingShadowRoots.splice(0).forEach((resolve) => resolve({})); },
    // Release only the OLDEST parked call, so a test can choose the resumption order.
    releaseOneConfigRead() { if (pendingConfigReads.length) pendingConfigReads.shift()([]); },
    releaseOneShadowRoot() { if (pendingShadowRoots.length) pendingShadowRoots.shift()({}); },
    // Release only the NEWEST parked shadow-root lookup.
    releaseLastShadowRoot() { if (pendingShadowRoots.length) pendingShadowRoots.pop()({}); },
    releaseEnabledRead() { pendingEnabledReads.splice(0).forEach((resolve) => resolve(true)); },
    instances: () => instances.slice(),
    alive: () => instances.filter((instance) => !instance.destroyed),
    shadowDisposals: () => shadowDisposals
  };
}

test('enable, disable, enable while startApp() is reading config creates exactly one instance', async () => {
  const env = loadContentScript();

  await env.send(true);                             // startApp #1 parks in getConfigs()
  await env.send(false);
  await env.send(true);                             // startApp #2 parks there too
  env.releaseConfigReads();
  await settle();
  env.releaseShadowRoots();
  await settle();

  assert.equal(env.instances().length, 1, 'only the latest enable may create the app');
  assert.equal(env.alive().length, 1);

  await env.send(false);
  assert.equal(env.alive().length, 0, 'disabling tears the app down completely');
});

test('the same burst while startApp() is waiting for the shadow root creates exactly one instance', async () => {
  const env = loadContentScript();

  await env.send(true);                             // startApp #1 parks in getConfigs()
  await env.send(false);
  await env.send(true);                             // startApp #2 parks there too
  env.releaseConfigReads();
  await settle();                                   // both proceed to getTocShadowRoot() and park

  await env.send(false);
  await env.send(true);                             // startApp #3 parks in getConfigs()
  env.releaseShadowRoots();
  await settle();                                   // #1 and #2 come back from their await

  assert.equal(env.instances().length, 0, 'starts that were disabled AND re-enabled after they began must not resume');

  env.releaseConfigReads();
  await settle();
  env.releaseShadowRoots();
  await settle();

  assert.equal(env.instances().length, 1, 'only startApp #3 (the latest enable) creates the app');
  await env.send(false);
  assert.equal(env.alive().length, 0);
});

test('a disable that lands while the bootstrap is still reading the enabled state wins over that read', async () => {
  // Page load on an ENABLED site: the bootstrap has read "enabled" and is
  // suspended. Before it resumes, the background disables the site and sends
  // UPDATE_ENABLED false. This tab is not enabled yet, so that message looks
  // like a no-op — but the pending read is now stale, and no TOC may appear on
  // a site the background has switched off.
  const env = loadContentScript({ parkEnabledRead: true });
  env.runBootstrap();                               // main() reaches getSiteEnabledByOrigin() and parks
  await env.settle();

  await env.send(false);                            // the background disabled the site meanwhile
  env.releaseEnabledRead();                         // the stale "enabled" arrives
  await env.settle();                               // …and the bootstrap acts on it
  env.releaseConfigReads();
  await env.settle();
  env.releaseShadowRoots();
  await env.settle();

  assert.equal(env.instances().length, 0, 'no app on a site the background has disabled');
});

test('a redundant "enabled" notice does not retire a start that is still in flight', async () => {
  // The tab is enabled and its app is starting when an UPDATE_ENABLED true that
  // changes nothing arrives (another context re-asserting the site). The start
  // in flight must still complete — exactly one instance.
  const env = loadContentScript();
  await env.send(true);
  await env.send(true);                             // unchanged

  env.releaseConfigReads();
  await env.settle();
  env.releaseShadowRoots();
  await env.settle();

  assert.equal(env.instances().length, 1);
  await env.send(false);
  assert.equal(env.alive().length, 0);
});

test('an open-panel request whose start was retired does not expand the newer instance', async () => {
  // OPEN_PANEL starts the app and then wants the panel expanded. If that start
  // is retired by a disable + re-enable, the app that exists afterwards belongs
  // to the newer enable — which asked for nothing.
  const env = loadContentScript();
  await env.openPanel();                             // startApp #1 parks in getConfigs(); wants the panel open
  env.releaseOneConfigRead();                        // #1 moves on and parks at the shadow root
  await env.settle();
  await env.send(false);
  await env.send(true);                              // startApp #2: a plain enable
  env.releaseOneConfigRead();                        // #2 moves on and parks at the shadow root
  await env.settle();
  env.releaseLastShadowRoot();                       // #2 completes first …
  await env.settle();
  env.releaseOneShadowRoot();                        // … then the retired #1 comes back
  await env.settle();

  assert.equal(env.instances().length, 1);
  assert.equal(env.instances()[0].expands, 0, 'the retired request must not expand the newer instance');
  await env.send(false);
  assert.equal(env.alive().length, 0);
});

test('disabling the site takes the shadow host down', async () => {
  // The host element is the one trace of the extension a page can still find
  // after a disable. Nothing of the extension may remain on a disabled site.
  const env = loadContentScript();
  await env.send(true);
  env.releaseConfigReads();
  await env.settle();
  env.releaseShadowRoots();
  await env.settle();
  assert.equal(env.instances().length, 1);
  assert.equal(env.shadowDisposals(), 0, 'enabled: the host stays up');

  await env.send(false);
  assert.equal(env.shadowDisposals(), 1, 'disabled: the host is removed');
  assert.equal(env.alive().length, 0);
});
