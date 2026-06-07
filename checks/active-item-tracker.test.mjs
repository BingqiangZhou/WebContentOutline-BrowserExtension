import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadSelector() {
  const file = path.join(repoRoot, 'src/core/active-item-tracker.ts');
  assert.equal(fs.existsSync(file), true, 'src/core/active-item-tracker.ts should exist');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8').replace(/export function /g, 'function '));
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
  const file = path.join(repoRoot, 'src/core/active-item-tracker.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8').replace(/export function /g, 'function '));
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

  const map = new Map();
  map.set(first, 240);
  map.set(second, 90);

  assert.equal(selectActiveItem(map), second);
});

test('active item selector returns null when nothing is visible', () => {
  const selectActiveItem = loadSelector();

  assert.equal(selectActiveItem(new Map()), null);
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
  const app = fs.readFileSync(path.join(repoRoot, 'src/core/toc-app.ts'), 'utf8');

  assert.match(app, /createActiveItemTracker/);
  assert.match(app, /items:\s*items/);
  assert.match(app, /dockInstance\.setItems\(items\)/);
  assert.match(app, /dockInstance\.setActiveIndex\(activeIndex\)/);
  assert.match(app, /activeTracker\.setItems\(items\)/);
  assert.match(app, /activeTracker\.destroy\(\)/);
});

test('floating panel consumes shared active state instead of creating its own observer', () => {
  const panel = fs.readFileSync(path.join(repoRoot, 'src/ui/floating-panel.ts'), 'utf8');

  assert.match(panel, /var activeIndex[^=]*= typeof opts\.activeIndex/);
  assert.match(panel, /var onNavigate[\s\S]*?= opts\.onNavigate/);
  assert.match(panel, /setActiveIndex/);
  assert.doesNotMatch(panel, /new IntersectionObserver/);
});
