import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);

function loadSelector() {
  const file = path.join(repoRoot, 'src/core/active-item-tracker.js');
  assert.equal(fs.existsSync(file), true, 'src/core/active-item-tracker.js should exist');
  const source = fs.readFileSync(file, 'utf8').replace(/export function /g, 'function ');
  const sandbox = { console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.selectActiveItem = selectActiveItem;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.selectActiveItem;
}

function loadTrackerEnvironment() {
  const file = path.join(repoRoot, 'src/core/active-item-tracker.js');
  const source = fs.readFileSync(file, 'utf8').replace(/export function /g, 'function ');
  const rafQueue = [];
  const observerInstances = [];
  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      observerInstances.push(this);
    }
    disconnect() {}
    observe() {}
  }
  const sandbox = {
    console,
    document: { contains() { return true; } },
    IntersectionObserver: FakeIntersectionObserver,
    requestAnimationFrame(callback) {
      rafQueue.push(callback);
      return rafQueue.length;
    },
    cancelAnimationFrame() {},
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.createActiveItemTracker = createActiveItemTracker;`,
    sandbox,
    { filename: file }
  );
  return {
    createActiveItemTracker: sandbox.__exports.createActiveItemTracker,
    flushRaf() {
      while (rafQueue.length) rafQueue.shift()();
    },
    observerInstances
  };
}

test('active item selector chooses the topmost visible outline item', () => {
  const selectActiveItem = loadSelector();
  const first = { id: 'first' };
  const second = { id: 'second' };

  assert.equal(selectActiveItem([
    { item: first, top: 240 },
    { item: second, top: 90 }
  ]), second);
});

test('active item selector returns null when nothing is visible', () => {
  const selectActiveItem = loadSelector();

  assert.equal(selectActiveItem([]), null);
});

test('active tracker retains the previous item while scrolling between headings', () => {
  const env = loadTrackerEnvironment();
  const element = {};
  const changes = [];
  env.createActiveItemTracker({
    items: [{ id: 'first', el: element }],
    onChange(_item, index) { changes.push(index); }
  });
  env.flushRaf();

  env.observerInstances[0].callback([
    { target: element, isIntersecting: true, boundingClientRect: { top: 80 } }
  ]);
  env.flushRaf();
  env.observerInstances[0].callback([
    { target: element, isIntersecting: false, boundingClientRect: { top: -20 } }
  ]);
  env.flushRaf();

  assert.deepEqual(changes, [-1, 0]);
});

test('toc app owns active tracking and synchronizes the collapsed preview', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'src/core/toc-app.js'), 'utf8');

  assert.match(app, /createActiveItemTracker/);
  assert.match(app, /items:\s*items/);
  assert.match(app, /dockInstance\.setItems\(items\)/);
  assert.match(app, /dockInstance\.setActiveIndex\(activeIndex\)/);
  assert.match(app, /activeTracker\.setItems\(items\)/);
  assert.match(app, /activeTracker\.destroy\(\)/);
});

test('floating panel consumes shared active state instead of creating its own observer', () => {
  const panel = fs.readFileSync(path.join(repoRoot, 'src/ui/floating-panel.js'), 'utf8');

  assert.match(panel, /var activeIndex = opts\.activeIndex/);
  assert.match(panel, /var onNavigate = opts\.onNavigate/);
  assert.match(panel, /setActiveIndex/);
  assert.doesNotMatch(panel, /new IntersectionObserver/);
});
