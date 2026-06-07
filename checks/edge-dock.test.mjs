import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function extractCssVariable(css, variable) {
  const match = css.match(new RegExp(`${variable}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(match, `${variable} should be defined as an opaque hex color`);
  return match[1];
}

function loadDockController() {
  const file = path.join(repoRoot, 'src/ui/edge-dock.ts');
  assert.equal(fs.existsSync(file), true, 'src/ui/edge-dock.ts should exist');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export function /g, 'function '));

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
  const file = path.join(repoRoot, 'src/ui/edge-dock.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export function /g, 'function '));
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
  const file = path.join(repoRoot, 'src/ui/edge-dock.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export function /g, 'function '));
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
  const file = path.join(repoRoot, 'src/ui/edge-dock.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export function /g, 'function '));
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

test('programmatic peeks can use a longer auto-collapse delay', () => {
  const env = loadDockController();
  const dock = env.createDockStateController({ closeDelayMs: 250 });

  dock.peek();
  dock.scheduleCollapse(1800);

  assert.equal(env.timers.size, 1);
  assert.equal([...env.timers.values()][0].delay, 1800);
  env.runTimers();
  assert.equal(dock.getMode(), 'collapsed');
});

test('dock state controller exposes hover-only modes without pinned state', () => {
  const env = loadDockController();
  const dock = env.createDockStateController({ closeDelayMs: 250 });

  assert.equal(dock.setMode('pinned'), 'collapsed');
  assert.equal('pin' in dock, false);
  assert.equal('togglePinned' in dock, false);
});

test('touch activation toggles temporary peek without pinned state', () => {
  const env = loadDockController();
  const dock = env.createDockStateController({ closeDelayMs: 250 });

  dock.activate('touch');
  assert.equal(dock.getMode(), 'peek');
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

  assert.deepEqual({ ...getPreviewLineMetrics(1) }, { width: 26, inset: 0 });
  assert.deepEqual({ ...getPreviewLineMetrics(3) }, { width: 20, inset: 4 });
  assert.deepEqual({ ...getPreviewLineMetrics(6) }, { width: 11, inset: 10 });
  assert.deepEqual({ ...getPreviewLineMetrics(99) }, { width: 11, inset: 10 });
});

test('edge dock is included in cleanup, mutation filtering, and picker exclusion rules', () => {
  const domWatcher = fs.readFileSync(path.join(repoRoot, 'src/core/dom-watcher.ts'), 'utf8');
  const picker = fs.readFileSync(path.join(repoRoot, 'src/ui/element-picker.ts'), 'utf8');

  // Both files reference the extension owner via OWNED_SELECTOR or EXTENSION_OWNER
  assert.match(domWatcher, /OWNED_SELECTOR/);
  assert.match(picker, /EXTENSION_OWNER/);
});

test('toc app orchestrates the edge dock instead of the collapsed badge', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'src/core/toc-app.ts'), 'utf8');

  assert.match(app, /renderEdgeDock/);
  assert.doesNotMatch(app, /renderCollapsedBadge/);
  assert.match(app, /getPanelHost/);
  assert.match(app, /dockInstance\.getMode\(\) === 'collapsed'/);
  assert.match(app, /onNavigate:\s*function\(item[^)]*\)[\s\S]*?syncActiveIndex\(index\)[\s\S]*?navLock\.lock\(1000\)[\s\S]*?scrollToElement\(item\.el\)/);
});

test('floating panel mounts inside the edge dock and no longer owns dragging', () => {
  const panel = fs.readFileSync(path.join(repoRoot, 'src/ui/floating-panel.ts'), 'utf8');

  assert.match(panel, /mountTarget/);
  assert.doesNotMatch(panel, /createDragController/);
  assert.doesNotMatch(panel, /buttonPickElement/);
  assert.doesNotMatch(panel, /buttonSiteConfig/);
  assert.doesNotMatch(panel, /buttonRefresh/);
});

test('expanded outline card is title free and styles items by heading level', () => {
  const panel = fs.readFileSync(path.join(repoRoot, 'src/ui/floating-panel.ts'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'entrypoints/toc.content/style.css'), 'utf8');

  assert.doesNotMatch(panel, /toc-header-row/);
  assert.doesNotMatch(panel, /data-role', 'collapse/);
  assert.match(panel, /panel\.setAttribute\('aria-label', msg\('tocTitle'\)\)/);
  assert.match(panel, /btn\.dataset\.level = String\(item\.level \|\| 2\)/);
  assert.match(css, /\.toc-floating\.toc-floating-docked\s*\{[^}]*width:\s*320px/s);
  assert.match(css, /\.toc-floating\.toc-floating-docked\s*\{[^}]*border-radius:\s*18px/s);
  assert.match(css, /\.toc-item\[data-level="6"\]/);
});

test('edge dock styles and localized menu labels are present', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'entrypoints/toc.content/style.css'), 'utf8');
  const dock = fs.readFileSync(path.join(repoRoot, 'src/ui/edge-dock.ts'), 'utf8');
  const en = fs.readFileSync(path.join(repoRoot, '_locales/en/messages.json'), 'utf8');
  const zh = fs.readFileSync(path.join(repoRoot, '_locales/zh_CN/messages.json'), 'utf8');

  assert.match(css, /\.toc-edge-dock/);
  assert.match(css, /\.toc-edge-dock-panel-host\s*\{[^}]*display:\s*block/s);
  assert.match(css, /\.toc-edge-dock\s*\{[^}]*--toc-dock-color:\s*#202124[^}]*--toc-dock-hover:\s*#f3f4f6/s);
  assert.doesNotMatch(css, /#ec4899|rgba\(236,\s*72,\s*153|#f472b6|rgba\(244,\s*114,\s*182/);
  assert.match(css, /\.toc-edge-dock-settings\s*\{[^}]*width:\s*28px[^}]*height:\s*28px[^}]*border-radius:\s*999px[^}]*margin-right:\s*6px/s);
  assert.match(css, /\.toc-edge-dock-left \.toc-edge-dock-settings\s*\{[^}]*margin-left:\s*6px[^}]*margin-right:\s*0/s);
  assert.match(css, /\.toc-edge-dock-settings-icon\s*\{[^}]*display:\s*flex[^}]*width:\s*14px[^}]*height:\s*12px/s);
  assert.match(css, /\.toc-edge-dock-settings-bullet\s*\{[^}]*width:\s*3px[^}]*height:\s*3px[^}]*background:\s*currentColor/s);
  assert.match(css, /\.toc-edge-dock-settings-line\s*\{[^}]*width:\s*9px[^}]*height:\s*2px[^}]*background:\s*currentColor/s);
  assert.match(css, /@media \(prefers-color-scheme:\s*dark\)[\s\S]*?\.toc-edge-dock\s*\{[^}]*--toc-dock-bg:\s*#242424[^}]*--toc-dock-color:\s*#e5e7eb[^}]*--toc-dock-hover:\s*#303030/s);
  assert.match(css, /\.toc-edge-dock-toolbar\s*\{[^}]*gap:\s*3px/s);
  assert.doesNotMatch(css, /\.toc-edge-dock-toc\s*\{[^}]*min-height:\s*236px/s);
  assert.match(css, /\.toc-edge-dock-toc\s*\{[^}]*min-height:\s*40px/s);
  assert.match(css, /\.toc-edge-dock-toc\s*\{[^}]*padding:\s*6px/s);
  assert.match(css, /\.toc-edge-dock-preview\s*\{[^}]*align-items:\s*center[^}]*gap:\s*8px/s);
  assert.match(css, /\.toc-edge-dock\[data-mode="peek"\] \.toc-edge-dock-toc\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.toc-edge-dock-preview-line/);
  assert.match(css, /\.toc-edge-dock-preview-line\[data-level="6"\]/);
  assert.match(css, /\.toc-edge-dock-panel-host\s*\{[^}]*top:\s*40px/s);
  assert.match(css, /\.toc-edge-dock-right \.toc-edge-dock-panel-host\s*\{[^}]*right:\s*0/s);
  assert.match(css, /\.toc-edge-dock-left \.toc-edge-dock-panel-host\s*\{[^}]*left:\s*0/s);
  assert.match(css, /\.toc-edge-dock-right \.toc-floating\.toc-floating-docked\s*\{[^}]*border-radius:\s*18px 0 0 18px[^}]*transform-origin:\s*right top/s);
  assert.match(css, /\.toc-edge-dock-left \.toc-floating\.toc-floating-docked\s*\{[^}]*border-radius:\s*0 18px 18px 0[^}]*transform-origin:\s*left top/s);
  assert.match(css, /\.toc-floating-expand\.toc-floating-left,[\s\S]*?\.toc-floating-expand\.toc-floating-right\s*\{[^}]*transform:\s*scaleX\(0\.12\)[^}]*opacity:\s*0/s);
  assert.match(css, /\.toc-floating-expand\.toc-expanded\s*\{[^}]*transform:\s*scaleX\(1\)[^}]*opacity:\s*1/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.toc-floating-expand\s*\{[^}]*transition:\s*none/s);
  assert.match(dock, /toolbar\.setAttribute\('role', 'toolbar'\)/);
  assert.match(dock, /toc-edge-dock-preview/);
  assert.match(dock, /toc-edge-dock-preview-line/);
  assert.match(dock, /toc-edge-dock-settings-bullet/);
  assert.match(dock, /toc-edge-dock-settings-line/);
  assert.doesNotMatch(dock, /toc-edge-dock-settings-track/);
  assert.doesNotMatch(dock, /toc-edge-dock-settings-knob/);
  assert.doesNotMatch(dock, /toc-edge-dock-settings-tile/);
  assert.doesNotMatch(dock, /toc-edge-dock-settings-sparkle/);
  assert.match(dock, /function createSettingsIcon\(\)[\s\S]*?document\.createElement\('span'\)/);
  assert.doesNotMatch(dock, /document\.createElementNS\(SVG_NS, 'rect'\)/);
  assert.match(dock, /setItems:/);
  assert.match(dock, /setActiveIndex:/);
  assert.match(dock, /var tocButton = document\.createElement\('div'\)/);
  assert.match(dock, /var line = document\.createElement\('button'\)/);
  assert.match(dock, /line\.type = 'button'/);
  assert.match(dock, /line\.dataset\.index = String\(index\)/);
  assert.match(dock, /function navigatePreviewItem[\s\S]*?options\.onNavigate && options\.onNavigate\(item, index\)/);
  assert.match(dock, /function onPreviewClick[\s\S]*?e\.stopPropagation\(\)[\s\S]*?navigatePreviewItem\(parseInt\([\s\S]*?dataset\.index/);
  assert.match(dock, /preview\.addEventListener\('click', onPreviewClick\b/);
  assert.doesNotMatch(dock, /preview\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(dock, /function onTocPointerEnter[\s\S]*?closeMenu\(\);[\s\S]*?controller\.peek\(\);/);
  assert.match(dock, /function onTocClick\(\)[\s\S]*?lastPointerType !== 'touch'[\s\S]*?controller\.activate\(\);/);
  assert.match(dock, /function onRootPointerLeave\(e[^)]*\)[\s\S]*?lastPointerType !== 'touch'[\s\S]*?controller\.scheduleCollapse\(/);
  assert.match(dock, /function onDocumentPointerDown\(e[^)]*\)[\s\S]*?controller\.getMode\(\) === 'peek'[\s\S]*?controller\.collapse\(\);/);
  assert.doesNotMatch(dock, /controller\.pin\(\)|togglePinned|mode === 'pinned'|next === 'pinned'/);
  assert.match(dock, /function openMenu\(\)[\s\S]*?controller\.collapse\(\);[\s\S]*?quickMenu\.hidden = false;/);
  assert.match(dock, /function onSettingsPointerEnter[\s\S]*?lastPointerType !== 'touch'[\s\S]*?openMenu\(\);/);
  assert.match(dock, /function scheduleMenuClose\(\)[\s\S]*?setTimeout\(closeMenu, CFG\.CLOSE_DELAY_MS\)/);
  assert.match(dock, /PROGRAMMATIC_CLOSE_DELAY_MS:\s*1800/);
  assert.match(dock, /peek:\s*function\(opts[^)]*\)\s*\{[\s\S]*?controller\.peek\(\);[\s\S]*?opts && opts\.autoCollapse[\s\S]*?controller\.scheduleCollapse\(CFG\.PROGRAMMATIC_CLOSE_DELAY_MS\)/);
  assert.match(dock, /function onRootFocusIn[\s\S]*?settingsButton[\s\S]*?openMenu\(\);/);
  assert.match(dock, /function onRootFocusOut[\s\S]*?scheduleMenuClose\(\);/);
  assert.doesNotMatch(dock, /function onSettingsClick\(\)[\s\S]*?var open = quickMenu\.hidden;/);
  assert.match(dock, /settingsButton\.addEventListener\('pointerenter', onSettingsPointerEnter\b/);
  assert.doesNotMatch(dock, /dockSwitchToClassic/);
  assert.doesNotMatch(dock, /onSwitchUiMode/);
  for (const locale of [en, zh]) {
    assert.match(locale, /"dockSettingsTitle"/);
    assert.match(locale, /"dockMoveToLeft"/);
    assert.match(locale, /"dockMoveToRight"/);
  }
});

test('collapsed preview colors stay visible on light and dark host pages', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'entrypoints/toc.content/style.css'), 'utf8');
  const darkTheme = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  const variables = [
    '--toc-preview-line',
    '--toc-preview-line-hover',
    '--toc-preview-line-active'
  ];

  for (const variable of variables) {
    const color = extractCssVariable(css, variable);
    assert.ok(contrastRatio(color, '#ffffff') >= 3, `${variable} should contrast with light pages`);
    assert.ok(contrastRatio(color, '#242424') >= 3, `${variable} should contrast with dark pages`);
  }

  assert.equal(extractCssVariable(css, '--toc-preview-line-hover'), extractCssVariable(css, '--toc-preview-line'));
  assert.equal(extractCssVariable(css, '--toc-preview-line-active'), extractCssVariable(css, '--toc-preview-line'));
  const ringLight = extractCssVariable(css, '--toc-preview-ring-light');
  const ringDark = extractCssVariable(css, '--toc-preview-ring-dark');
  assert.ok(contrastRatio(ringLight, '#242424') >= 6, '--toc-preview-ring-light should stand out on dark pages');
  assert.ok(contrastRatio(ringDark, '#ffffff') >= 6, '--toc-preview-ring-dark should stand out on light pages');
  assert.match(css, /\.toc-edge-dock-preview-line\s*\{[^}]*background:\s*var\(--toc-preview-line\)/s);
  assert.match(css, /\.toc-edge-dock-preview-line-active\s*\{[^}]*background:\s*var\(--toc-preview-line-active\)[^}]*box-shadow:\s*0 0 0 1px var\(--toc-preview-ring-light\),\s*0 0 0 2px var\(--toc-preview-ring-dark\)/s);
  assert.match(css, /\.toc-edge-dock-preview-line:hover,[\s\S]*?\.toc-edge-dock-preview-line:focus-visible\s*\{[^}]*background:\s*var\(--toc-preview-line-hover\)[^}]*box-shadow:\s*0 0 0 1px var\(--toc-preview-ring-light\),\s*0 0 0 3px var\(--toc-preview-ring-dark\)/s);
  assert.doesNotMatch(darkTheme, /\.toc-edge-dock-preview-line(?:-active)?\s*\{/);
});
