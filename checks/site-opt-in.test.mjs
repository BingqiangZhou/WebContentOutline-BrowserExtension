// Per-site opt-in semantics: the TOC runs only on origins with an explicit
// `true` entry in tocSiteEnabledMap. Absent entries and explicit `false` are
// disabled. Guards against an accidental revert to the pre-1.12 default-on
// (opt-out) model, where an absent entry counted as enabled.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// --- Static assertions: every enable gate reads the map as opt-in ---

test('per-site enable gates use opt-in semantics (explicit true only)', () => {
  const background = readSource('entrypoints/background.ts');
  const domUtils = readSource('src/utils/dom-utils.ts');
  const options = readSource('entrypoints/options/main.ts');

  // Background gate — feeds maybeAutoInject, handleActionClick, updateIconForTab
  // and processAllTabs.
  assert.match(background, /return !!origin && map\[origin\] === true;/);
  // Rollback/prev value inside setEnabledByOrigin must agree with the read.
  assert.match(background, /const prev = map\[origin\] === true;/);
  // Content-side check before starting the app (src/content.ts entry gate).
  assert.match(domUtils, /return !!key && map\[key\] === true;/);
  // Options page toggle initial state.
  assert.match(options, /const enabled = map\[origin\] === true;/);

  // No default-on residue: an absent entry must never read as enabled.
  for (const [name, src] of [
    ['entrypoints/background.ts', background],
    ['src/utils/dom-utils.ts', domUtils],
    ['entrypoints/options/main.ts', options]
  ]) {
    assert.doesNotMatch(src, /map\[[^\]]+\]\s*!==\s*false/, `${name} must not treat absent entries as enabled`);
  }
});

test('global fallback icon reflects the disabled default', () => {
  const background = readSource('entrypoints/background.ts');
  const fn = background.match(/async function setGlobalDefaultIcon\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'setGlobalDefaultIcon should exist');
  assert.match(fn[0], /getIconPathMap\(false\)/);
  assert.doesNotMatch(fn[0], /getIconPathMap\(true\)/);
});

test('localized copy no longer claims default-on behavior', () => {
  const en = JSON.parse(readSource('public/_locales/en/messages.json'));
  const zh = JSON.parse(readSource('public/_locales/zh_CN/messages.json'));

  assert.doesNotMatch(en.optionsSitesDescription.message, /enabled by default/i);
  assert.doesNotMatch(zh.optionsSitesDescription.message, /默认启用/);
  // The empty state must point users at the opt-in entry point.
  assert.match(en.optionsNoSites.message, /toolbar icon/i);
  assert.match(zh.optionsNoSites.message, /工具栏图标/);
});

// --- Behavior: the real content-side predicate against stored maps ---

function loadRealPredicate(sandboxExtras) {
  const file = path.join(repoRoot, 'src/utils/dom-utils.ts');
  const source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  const sandbox = {
    console,
    getEnabledMap: async () => sandbox.__map,
    __map: {},
    __exports: {},
    ...sandboxExtras
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.getSiteEnabledByOrigin = getSiteEnabledByOrigin;', sandbox, { filename: file });
  return sandbox;
}

test('getSiteEnabledByOrigin: only an explicit true entry enables a site', async () => {
  const sandbox = loadRealPredicate({ location: { origin: 'https://current.example' } });
  const fn = sandbox.__exports.getSiteEnabledByOrigin;

  sandbox.__map = {};
  assert.equal(await fn(), false, 'absent entry disables the current origin');
  assert.equal(await fn('https://absent.example'), false, 'absent entry disables a named origin');

  sandbox.__map = { 'https://current.example': true };
  assert.equal(await fn(), true, 'explicit true enables the current origin');
  assert.equal(await fn('https://current.example'), true, 'explicit true enables a named origin');

  sandbox.__map = { 'https://current.example': false };
  assert.equal(await fn(), false, 'explicit false keeps the site disabled');

  sandbox.__map = { 'https://current.example': true };
  assert.equal(await fn(''), true, 'empty origin falls back to the current location origin');
});

test('getSiteEnabledByOrigin: no resolvable origin is disabled', async () => {
  const sandbox = loadRealPredicate({});
  sandbox.__map = { 'https://x.example': true };
  assert.equal(await sandbox.__exports.getSiteEnabledByOrigin(), false, 'no location and no origin resolves to an empty key');
});
