import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('toc app and content script use edge-dock as the only ui mode', () => {
  const app = read('src/core/toc-app.ts');
  const content = read('src/content.ts');

  assert.match(app, /renderEdgeDock/);
  assert.doesNotMatch(app, /renderClassicCollapsedBadge/);
  assert.doesNotMatch(app, /renderClassicFloatingPanel/);
  assert.doesNotMatch(app, /options\.uiMode === 'classic'/);
  assert.doesNotMatch(app, /onSwitchUiMode/);
  assert.doesNotMatch(content, /getUiMode/);
  assert.doesNotMatch(content, /saveUiMode/);
  assert.doesNotMatch(content, /normalizeUiMode/);
  assert.doesNotMatch(content, /onSwitchUiMode/);
  assert.doesNotMatch(content, /currentUiMode/);
  assert.match(app, /async function expand\(opts[^)]*\)[\s\S]*?dockInstance\.peek\(opts \|\| \{\}\)/);
});

test('storage no longer exposes ui mode helpers', () => {
  const constants = read('src/utils/constants.ts');
  const storage = read('src/utils/storage.ts');

  assert.doesNotMatch(constants, /UI_MODE/);
  assert.doesNotMatch(storage, /normalizeUiMode/);
  assert.doesNotMatch(storage, /getUiMode/);
  assert.doesNotMatch(storage, /saveUiMode/);
});

test('edge dock no longer has switch to classic mode button', () => {
  const dock = read('src/ui/edge-dock.ts');

  assert.doesNotMatch(dock, /dockSwitchToClassic/);
  assert.doesNotMatch(dock, /onSwitchUiMode/);
});

test('css no longer has classic ui styles', () => {
  const css = read('entrypoints/toc.content/style.css');

  assert.doesNotMatch(css, /toc-collapsed-badge/);
  assert.doesNotMatch(css, /toc-floating-classic/);
  assert.doesNotMatch(css, /\.toc-header\s*\{/);
  assert.doesNotMatch(css, /\.toc-header-row/);
  assert.doesNotMatch(css, /\.toc-title-group/);
  assert.doesNotMatch(css, /\.toc-classic-switch-mode/);
  assert.doesNotMatch(css, /\.toc-actions\s*\{/);
  assert.doesNotMatch(css, /\.toc-actions-left/);
  assert.doesNotMatch(css, /\.toc-actions-right/);
});

test('i18n no longer has classic ui strings', () => {
  const en = JSON.parse(read('public/_locales/en/messages.json'));
  const zh = JSON.parse(read('public/_locales/zh_CN/messages.json'));

  assert.equal(en.badgeTitle, undefined);
  assert.equal(en.dockSwitchToClassic, undefined);
  assert.equal(en.classicSwitchToModern, undefined);
  assert.equal(en.classicSwitchToModernTitle, undefined);
  assert.equal(zh.badgeTitle, undefined);
  assert.equal(zh.dockSwitchToClassic, undefined);
  assert.equal(zh.classicSwitchToModern, undefined);
  assert.equal(zh.classicSwitchToModernTitle, undefined);
});
