// Repository hygiene. Two behavior checks — git must not silently swallow
// new test-prefixed paths, and every XPath example the READMEs document must be
// one the extension actually accepts — plus the files the repo promises: a
// LICENSE behind the README's badge and a CI workflow that runs the build.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));

/** Ask git itself whether a (possibly not-yet-existing) path would be ignored. */
function isIgnoredByGit(relativePath) {
  const result = spawnSync('git', ['check-ignore', '--quiet', relativePath], { cwd: repoRoot });
  assert.equal(result.error, undefined, 'git check-ignore must be runnable');
  assert.notEqual(result.status, 128, String(result.stderr || 'git check-ignore failed'));
  return result.status === 0;
}

/** XPath expressions the READMEs show the user: inline code and the config sample. */
function xpathExamplesIn(relativePath) {
  const text = read(relativePath);
  return [
    ...[...text.matchAll(/`(\/\/[^`\n]+)`/g)].map((m) => m[1]),
    ...[...text.matchAll(/"expr":\s*"(\/\/[^"]+)"/g)].map((m) => m[1])
  ];
}

/** The real selector validator and config-mutation primitive, as the extension runs them. */
function loadRealValidation() {
  const asScript = (relativePath) => stripTsSyntax(read(relativePath))
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export\s+\{[^}]*\};?\n?/g, '')
    .replace(/export function /g, 'function ');
  const sandbox = {
    console,
    document: { createDocumentFragment: () => ({ querySelector() {} }) },
    SELECTOR_EXPR_MAX_LENGTH: 2000,
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${asScript('src/shared/primitives.ts')}\n${asScript('src/utils/core-utils.ts')}\n` +
    '__exports.validateSelectorExpression = validateSelectorExpression;\n' +
    '__exports.applyTocConfigMutation = applyTocConfigMutation;',
    sandbox,
    { filename: 'primitives.ts + core-utils.ts' }
  );
  return sandbox.__exports;
}

test('new test-prefixed paths are not silently ignored by git', () => {
  // Control: the probe itself works — a genuinely ignored path reports as ignored.
  assert.equal(isIgnoredByGit('node_modules/probe'), true);
  for (const probe of ['checks/test-probe.test.mjs', 'src/test-utils.ts', 'tests/example.test.mjs']) {
    assert.equal(isIgnoredByGit(probe), false, `${probe} must be visible to git add`);
  }
});

test('the MIT license the README declares is present in the repo', () => {
  assert.equal(JSON.parse(read('package.json')).license, 'MIT');
  assert.equal(exists('LICENSE'), true, 'LICENSE is missing');
  assert.match(read('LICENSE'), /MIT License/);
  assert.match(read('LICENSE'), /Bingqiang Zhou/);
});

test('CI runs the full build on every push and PR, on the same Node as the release', () => {
  const ci = exists('.github/workflows/ci.yml') ? read('.github/workflows/ci.yml') : '';
  assert.match(ci, /push:/);
  assert.match(ci, /pull_request:/);
  assert.match(ci, /npm ci/); // postinstall runs `wxt prepare`; tsconfig extends .wxt/tsconfig.json
  assert.match(ci, /npm run build/);
  assert.match(ci, /node-version:\s*'24'/);
  assert.match(read('.github/workflows/release.yml'), /node-version:\s*'24'/);
});

test('every XPath example in the READMEs is accepted by the extension', () => {
  const examples = [...new Set(['README.md', 'README_CN.md'].flatMap(xpathExamplesIn))];
  assert.ok(examples.length >= 4, `expected the documented examples, found ${JSON.stringify(examples)}`);

  const { validateSelectorExpression, applyTocConfigMutation } = loadRealValidation();
  for (const expr of examples) {
    assert.equal(validateSelectorExpression('xpath', expr), true, `the validator rejects ${expr}`);
    const added = applyTocConfigMutation([], {
      operation: 'add-selector',
      urlPattern: 'https://x.example/*',
      selector: { type: 'xpath', expr }
    }, 1, null);
    assert.equal(added.ok, true, `the background rejects ${expr}`);
  }
});
