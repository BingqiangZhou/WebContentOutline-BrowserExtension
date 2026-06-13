import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('project exposes WXT TypeScript build scripts', () => {
  const pkg = readJson('package.json');

  assert.equal(pkg.scripts.dev, 'wxt');
  assert.equal(pkg.scripts['dev:edge'], 'wxt -b edge');
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit');
  assert.equal(pkg.scripts.test, 'vitest run');
  assert.equal(pkg.scripts.postinstall, 'wxt prepare');
  assert.match(pkg.scripts.build, /wxt build/);
  assert.match(pkg.scripts.zip, /^wxt zip$/);
  assert.match(pkg.scripts['release:build'], /npm run zip/);
  assert.equal(pkg.devDependencies.wxt, '0.20.26');
  assert.equal(typeof pkg.devDependencies.typescript, 'string');
  assert.equal(typeof pkg.devDependencies.vitest, 'string');
});

test('WXT migration files and entrypoints exist', () => {
  for (const relativePath of [
    'wxt.config.ts',
    'tsconfig.json',
    'vitest.config.ts',
    'entrypoints/background.ts',
    'entrypoints/toc.content/index.ts',
    'entrypoints/toc.content/style.css',
    'src/shared/primitives.ts'
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});

test('WXT config preserves MV3 permissions and static assets', () => {
  const config = fs.readFileSync(path.join(repoRoot, 'wxt.config.ts'), 'utf8');
  const contentEntry = fs.readFileSync(path.join(repoRoot, 'entrypoints/toc.content/index.ts'), 'utf8');
  const backgroundEntry = fs.readFileSync(path.join(repoRoot, 'entrypoints/background.ts'), 'utf8');

  assert.match(config, /manifestVersion:\s*3/);
  assert.match(config, /permissions:\s*\['storage', 'tabs', 'scripting'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /optional_host_permissions:\s*\[/);
  assert.match(contentEntry, /registration:\s*'runtime'/);
  assert.match(contentEntry, /cssInjectionMode:\s*'ui'/);
  assert.match(backgroundEntry, /content-scripts\/toc\.js/);
  // CSS is self-served by the content script's shadow root (cssInjectionMode
  // 'ui' → web_accessible_resources), not injected by the background.
  assert.doesNotMatch(backgroundEntry, /scripting\.(insertCSS|removeCSS)/);
  const shadowRootEntry = fs.readFileSync(path.join(repoRoot, 'src/ui/shadow-root.ts'), 'utf8');
  assert.match(shadowRootEntry, /content-scripts\/toc\.css/);

  for (const relativePath of [
    'public/icons/png/toc-disabled-16.png',
    'public/icons/png/toc-enabled-128.png',
    'public/_locales/en/messages.json',
    'public/_locales/zh_CN/messages.json'
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});

test('legacy manifest and custom build script are retired', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'manifest.json')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'build.js')), false);
});
