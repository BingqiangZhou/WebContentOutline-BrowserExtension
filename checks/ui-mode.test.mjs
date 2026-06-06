import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadNormalizeUiMode() {
  const storage = stripTsSyntax(read('src/utils/storage.ts'));
  const match = storage.match(/export function normalizeUiMode\(mode\) \{[\s\S]*?\n\s*\}/);
  assert.ok(match, 'normalizeUiMode() should be exported from storage.js');
  const sandbox = { __exports: {} };
  vm.runInNewContext(
    `${match[0].replace('export function', 'function')}\n__exports.normalizeUiMode = normalizeUiMode;`,
    sandbox
  );
  return sandbox.__exports.normalizeUiMode;
}

test('global toc ui mode defaults invalid values to edge dock', () => {
  const normalizeUiMode = loadNormalizeUiMode();

  assert.equal(normalizeUiMode(undefined), 'edge-dock');
  assert.equal(normalizeUiMode(null), 'edge-dock');
  assert.equal(normalizeUiMode('unexpected'), 'edge-dock');
  assert.equal(normalizeUiMode('edge-dock'), 'edge-dock');
  assert.equal(normalizeUiMode('classic'), 'classic');
});

test('storage exposes global ui mode helpers through toc utils', () => {
  const constants = read('src/utils/constants.ts');
  const storage = read('src/utils/storage.ts');
  const tocUtils = read('src/utils/toc-utils.ts');

  assert.match(constants, /UI_MODE:\s*'tocUiMode'/);
  assert.match(storage, /export function getUiMode\(\)/);
  assert.match(storage, /getStorage\(STORAGE_KEYS\.UI_MODE,\s*'edge-dock'\)/);
  assert.match(storage, /export function saveUiMode\(mode[^)]*\)/);
  assert.match(storage, /setStorage\(STORAGE_KEYS\.UI_MODE,\s*normalizeUiMode\(mode\)\)/);
  assert.match(tocUtils, /export \* from '\.\/storage\.js'/);
});

test('edge dock and classic panel expose opposite global mode switch actions', () => {
  const dock = read('src/ui/edge-dock.ts');
  const classicPanel = read('src/ui/classic-floating-panel.ts');

  assert.match(dock, /dockSwitchToClassic/);
  assert.match(dock, /options\.onSwitchUiMode\('classic'\)/);
  assert.match(classicPanel, /classicSwitchToModern/);
  assert.match(classicPanel, /options\.onSwitchUiMode\('edge-dock'\)/);
});

test('classic renderers preserve the original free floating badge and panel interaction', () => {
  const badge = read('src/ui/classic-collapsed-badge.ts');
  const classicPanel = read('src/ui/classic-floating-panel.ts');
  const panel = read('src/ui/floating-panel.ts');

  assert.match(badge, /export function renderClassicCollapsedBadge/);
  assert.match(badge, /toc-collapsed-badge/);
  assert.match(badge, /createDragController/);
  assert.match(classicPanel, /export function renderClassicFloatingPanel/);
  assert.match(classicPanel, /embedded:\s*true/);
  assert.match(classicPanel, /toc-header/);
  assert.match(classicPanel, /toc-actions/);
  assert.match(classicPanel, /createDragController/);
  assert.doesNotMatch(panel, /toc-header/);
  assert.doesNotMatch(panel, /createDragController/);
  // setFixedPosition and clampPanelPosition are inlined as private helpers in classic-floating-panel.ts
  assert.match(classicPanel, /function setFixedPosition/);
  assert.match(classicPanel, /function clampPanelPosition/);
});

test('classic panel restores the original structured header and actions styles', () => {
  const css = read('entrypoints/toc.content/style.css');

  assert.match(css, /\.toc-header\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*padding:\s*8px 10px[^}]*background:\s*var\(--toc-bg-header\)/s);
  assert.match(css, /\.toc-header-row\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between[^}]*align-items:\s*center/s);
  assert.match(css, /\.toc-title\s*\{[^}]*font-weight:\s*600[^}]*font-size:\s*14px/s);
  assert.match(css, /\.toc-actions\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between[^}]*flex-direction:\s*row/s);
  assert.match(css, /\.toc-actions-left\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.toc-actions-right\s*\{[^}]*display:\s*flex[^}]*margin-left:\s*auto/s);
});

test('classic mode switch sits beside the toc title instead of crowding the action row', () => {
  const classicPanel = read('src/ui/classic-floating-panel.ts');
  const css = read('entrypoints/toc.content/style.css');
  const en = JSON.parse(read('_locales/en/messages.json'));
  const zh = JSON.parse(read('_locales/zh_CN/messages.json'));

  assert.match(classicPanel, /titleGroup\.appendChild\(title\);[\s\S]*?titleGroup\.appendChild\(btnSwitchToModern\);[\s\S]*?headerRow\.appendChild\(titleGroup\);[\s\S]*?headerRow\.appendChild\(btnCollapse\);/);
  assert.doesNotMatch(classicPanel, /actionsRight\.appendChild\(btnSwitchToModern\)/);
  assert.match(css, /\.toc-title-group\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*4px/s);
  assert.match(css, /\.toc-classic-switch-mode\s*\{[^}]*white-space:\s*nowrap/s);
  assert.equal(en.classicSwitchToModern.message, 'Switch to Modern UI');
  assert.equal(zh.classicSwitchToModern.message, '切换到新版界面');
});

test('toc app and content script orchestrate the selected global ui mode', () => {
  const app = read('src/core/toc-app.ts');
  const content = read('src/content.ts');

  assert.match(app, /renderClassicCollapsedBadge/);
  assert.match(app, /renderClassicFloatingPanel/);
  assert.match(app, /options\.uiMode === 'classic'/);
  assert.match(app, /onSwitchUiMode/);
  assert.match(app, /collapse\(\{\s*persist:\s*false\s*\}\)/);
  assert.match(app, /opts\.persist !== false/);
  assert.doesNotMatch(app, /next === 'pinned'|prev === 'pinned'|dockInstance\.pin\(\)/);
  assert.match(content, /getUiMode/);
  assert.match(content, /saveUiMode/);
  assert.match(content, /normalizeUiMode/);
  assert.match(content, /onSwitchUiMode:\s*applyUiMode/);
  assert.match(content, /changes\?\.\[UI_MODE_KEY\]/);
  assert.match(content, /if \(opts\?\.expandPanel\) \{[\s\S]*?appInstance\.expand\(\{\s*autoCollapse:\s*currentUiMode !== 'classic'\s*\}\)/);
  assert.match(content, /else if \(currentUiMode !== 'classic'\) \{[\s\S]*?appInstance\.collapse\(\);[\s\S]*?\} else \{[\s\S]*?getPanelExpandedByOrigin/);
  assert.match(app, /async function expand\(opts[^)]*\)[\s\S]*?dockInstance\.peek\(opts \|\| \{\}\)/);
});
