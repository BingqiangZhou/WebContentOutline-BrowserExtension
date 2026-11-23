/**
 * toc-app and the rebuild scheduler, together.
 *
 * Most rebuilds are dispatched by the scheduler (DOM changes, URL changes).
 * Some are started by toc-app directly: an expanding dock, the Refresh button,
 * a config change. The scheduler cannot see those in its own in-flight promise.
 * A request that arrives during such a rebuild (the floating panel flushing what
 * was parked during a navigation) used to be dispatched straight into toc-app's
 * rebuild(), which merely JOINED the running one — the request was consumed and
 * the page kept a stale TOC until the next unrelated event.
 *
 * Runs the REAL toc-app, the REAL rebuild-scheduler and the REAL nav-lock.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { loadTocApp } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
void repoRoot;

async function settle() {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

test('a scheduler request that lands during a rebuild toc-app started itself is rebuilt afterwards', async () => {
  const env = loadTocApp({ realScheduler: true });
  const app = env.initForConfig({ urlPattern: 'https://site.example/*', selectors: [] }, {});
  await settle();                                    // the initial rebuild (toc-app's own) parks inside buildTocItems
  assert.equal(env.counters.builds, 1);

  env.scheduler().setPendingRebuild(true);            // the panel's post-navigation flush
  assert.equal(env.counters.builds, 1, 'nothing is dispatched into the running rebuild');

  env.finishBuild();                                 // toc-app's rebuild completes
  await settle();
  assert.equal(env.counters.builds, 2, 'the parked request gets its own rebuild once that one settles');

  env.finishBuild();
  await settle();
  assert.equal(env.counters.builds, 2, 'exactly once');
  app.destroy();
});

test('when the scheduler started the rebuild itself, a request landing during it is still rebuilt exactly once', async () => {
  // The scheduler already queues its own collisions; the settle notification
  // must not add a second dispatch on top of that.
  const env = loadTocApp({ realScheduler: true });
  const app = env.initForConfig({ urlPattern: 'https://site.example/*', selectors: [] }, {});
  await settle();

  env.finishBuild();                                 // let toc-app's own initial rebuild finish
  await settle();
  env.scheduler().setPendingRebuild(true);            // a scheduler-dispatched rebuild starts …
  assert.equal(env.counters.builds, 2);
  env.scheduler().setPendingRebuild(true);            // … and a second request lands during it
  assert.equal(env.counters.builds, 2, 'the scheduler queues its own collision');

  env.finishBuild();
  await settle();
  assert.equal(env.counters.builds, 3, 'one follow-up');
  env.finishBuild();
  await settle();
  assert.equal(env.counters.builds, 3, 'not two');
  app.destroy();
});
