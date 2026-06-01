import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);

function loadDockController() {
  const file = path.join(repoRoot, 'src/ui/edge-dock.js');
  assert.equal(fs.existsSync(file), true, 'src/ui/edge-dock.js should exist');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export function /g, 'function ');

  const timers = new Map();
  let nextTimerId = 0;
  const sandbox = {
    console,
    setTimeout(fn, delay) {
      const id = ++nextTimerId;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    __exports: {}
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(
    `${source}\n__exports.createDockStateController = createDockStateController;`,
    sandbox,
    { filename: file }
  );

  return {
    createDockStateController: sandbox.__exports.createDockStateController,
    timers,
    runTimers() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.fn();
      }
    }
  };
}

function loadDockClamp() {
  const file = path.join(repoRoot, 'src/ui/edge-dock.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export function /g, 'function ');
  const sandbox = { console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.clampDockTop = clampDockTop;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.clampDockTop;
}

function loadDockSideResolver() {
  const file = path.join(repoRoot, 'src/ui/edge-dock.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export function /g, 'function ');
  const sandbox = { console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.resolveDockSide = resolveDockSide;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.resolveDockSide;
}

function loadDockPreviewHelpers() {
  const file = path.join(repoRoot, 'src/ui/edge-dock.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/export function /g, 'function ');
  const sandbox = { console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}
__exports.getPreviewLineMetrics = getPreviewLineMetrics;
__exports.selectPreviewItems = selectPreviewItems;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports;
}

test('dock peeks on hover and collapses after the configured delay', () => {
  const env = loadDockController();
  const changes = [];
  const dock = env.createDockStateController({
    closeDelayMs: 250,
    onChange(next, prev) { changes.push([prev, next]); }
  });

  dock.peek();
  assert.equal(dock.getMode(), 'peek');

  dock.scheduleCollapse();
  assert.equal(env.timers.size, 1);
  assert.equal([...env.timers.values()][0].delay, 250);

  env.runTimers();
  assert.equal(dock.getMode(), 'collapsed');
  assert.deepEqual(changes, [['collapsed', 'peek'], ['peek', 'collapsed']]);
});

test('entering the dock again cancels a pending peek collapse', () => {
  const env = loadDockController();
  const dock = env.createDockStateController({ closeDelayMs: 250 });

  dock.peek();
  dock.scheduleCollapse();
  dock.cancelCollapse();
  env.runTimers();

  assert.equal(dock.getMode(), 'peek');
});

test('pinned mode ignores hover collapse and toggles explicitly', () => {
  const env = loadDockController();
  const dock = env.createDockStateController({ closeDelayMs: 250 });

  dock.togglePinned();
  dock.scheduleCollapse();
  env.runTimers();
  assert.equal(dock.getMode(), 'pinned');

  dock.togglePinned();
  assert.equal(dock.getMode(), 'collapsed');
});

test('touch activation toggles pinned mode without relying on hover', () => {
  const env = loadDockController();
  const dock = env.createDockStateController({ closeDelayMs: 250 });

  dock.activate('touch');
  assert.equal(dock.getMode(), 'pinned');
  dock.activate('touch');
  assert.equal(dock.getMode(), 'collapsed');
});

test('dock top clamping keeps the whole toolbar inside viewport safety margins', () => {
  const clampDockTop = loadDockClamp();

  assert.equal(clampDockTop(-20, 800, 104, 12), 12);
  assert.equal(clampDockTop(900, 800, 104, 12), 684);
  assert.equal(clampDockTop(240, 800, 104, 12), 240);
});

test('legacy floating positions snap to the nearest edge while anchored positions win', () => {
  const resolveDockSide = loadDockSideResolver();

  assert.equal(resolveDockSide({ x: 90 }, 1000, 'right'), 'left');
  assert.equal(resolveDockSide({ x: 910 }, 1000, 'left'), 'right');
  assert.equal(resolveDockSide({ x: 910, anchorX: 'left' }, 1000, 'right'), 'left');
  assert.equal(resolveDockSide(null, 1000, 'left'), 'left');
});

test('collapsed outline preview windows long toc lists around the active item', () => {
  const { selectPreviewItems } = loadDockPreviewHelpers();
  const items = Array.from({ length: 20 }, (_, index) => ({ index }));

  assert.deepEqual(
    Array.from(selectPreviewItems(items, 10, 12), (item) => item.index),
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  );
  assert.deepEqual(
    Array.from(selectPreviewItems(items, -1, 12), (item) => item.index),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  );
});

test('collapsed outline preview maps heading levels to line width and inset', () => {
  const { getPreviewLineMetrics } = loadDockPreviewHelpers();

  assert.deepEqual({ ...getPreviewLineMetrics(1) }, { width: 30, inset: 0 });
  assert.deepEqual({ ...getPreviewLineMetrics(3) }, { width: 22, inset: 4 });
  assert.deepEqual({ ...getPreviewLineMetrics(6) }, { width: 12, inset: 10 });
  assert.deepEqual({ ...getPreviewLineMetrics(99) }, { width: 12, inset: 10 });
});

test('edge dock is included in cleanup, mutation filtering, and picker exclusion rules', () => {
  const constants = fs.readFileSync(path.join(repoRoot, 'src/utils/constants.js'), 'utf8');
  const domWatcher = fs.readFileSync(path.join(repoRoot, 'src/core/dom-watcher.js'), 'utf8');
  const picker = fs.readFileSync(path.join(repoRoot, 'src/ui/element-picker.js'), 'utf8');

  assert.match(constants, /\.toc-edge-dock/);
  assert.match(domWatcher, /\.toc-edge-dock/);
  assert.match(picker, /\.toc-edge-dock/);
});

test('toc app orchestrates the edge dock instead of the collapsed badge', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'src/core/toc-app.js'), 'utf8');

  assert.match(app, /renderEdgeDock/);
  assert.doesNotMatch(app, /renderCollapsedBadge/);
  assert.match(app, /getPanelHost/);
  assert.match(app, /dockInstance\.getMode\(\) === 'collapsed'/);
});

test('floating panel mounts inside the edge dock and no longer owns dragging', () => {
  const panel = fs.readFileSync(path.join(repoRoot, 'src/ui/floating-panel.js'), 'utf8');

  assert.match(panel, /mountTarget/);
  assert.match(panel, /removalObserver\.observe\(document\.documentElement,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\)/);
  assert.doesNotMatch(panel, /createDragController/);
  assert.doesNotMatch(panel, /buttonPickElement/);
  assert.doesNotMatch(panel, /buttonSiteConfig/);
  assert.doesNotMatch(panel, /buttonRefresh/);
});

test('expanded outline card is title free and styles items by heading level', () => {
  const panel = fs.readFileSync(path.join(repoRoot, 'src/ui/floating-panel.js'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'src/content.css'), 'utf8');

  assert.doesNotMatch(panel, /toc-header-row/);
  assert.doesNotMatch(panel, /data-role', 'collapse/);
  assert.match(panel, /panel\.setAttribute\('aria-label', msg\('tocTitle'\)\)/);
  assert.match(panel, /btn\.dataset\.level = String\(item\.level \|\| 2\)/);
  assert.match(css, /\.toc-floating\.toc-floating-docked\s*\{[^}]*width:\s*320px/s);
  assert.match(css, /\.toc-floating\.toc-floating-docked\s*\{[^}]*border-radius:\s*18px/s);
  assert.match(css, /\.toc-item\[data-level="6"\]/);
});

test('edge dock styles and localized menu labels are present', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'src/content.css'), 'utf8');
  const dock = fs.readFileSync(path.join(repoRoot, 'src/ui/edge-dock.js'), 'utf8');
  const en = fs.readFileSync(path.join(repoRoot, '_locales/en/messages.json'), 'utf8');
  const zh = fs.readFileSync(path.join(repoRoot, '_locales/zh_CN/messages.json'), 'utf8');

  assert.match(css, /\.toc-edge-dock/);
  assert.match(css, /\.toc-edge-dock-panel-host\s*\{[^}]*display:\s*block/s);
  assert.match(css, /\.toc-edge-dock-preview-line/);
  assert.match(css, /\.toc-edge-dock-preview-line\[data-level="6"\]/);
  assert.match(dock, /toolbar\.setAttribute\('role', 'toolbar'\)/);
  assert.match(dock, /toc-edge-dock-preview/);
  assert.match(dock, /toc-edge-dock-preview-line/);
  assert.match(dock, /toc-edge-dock-settings-tile/);
  assert.match(dock, /toc-edge-dock-settings-sparkle/);
  assert.match(dock, /setItems:/);
  assert.match(dock, /setActiveIndex:/);
  assert.match(dock, /function onTocPointerEnter[\s\S]*?closeMenu\(\);[\s\S]*?controller\.peek\(\);/);
  for (const locale of [en, zh]) {
    assert.match(locale, /"dockSettingsTitle"/);
    assert.match(locale, /"dockMoveToLeft"/);
    assert.match(locale, /"dockMoveToRight"/);
  }
});
