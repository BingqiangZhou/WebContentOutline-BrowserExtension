import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEvaluatePatterns() {
  var file = path.join(repoRoot, 'src/utils/content-region.ts');
  var source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  var sandbox = { console: console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    source + '\n__exports.evaluatePatterns = evaluatePatterns;',
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.evaluatePatterns;
}

function elWithClass(className) {
  return {
    getAttribute: function (attr) { return attr === 'class' ? className : null; },
    id: ''
  };
}

test('substring false-kill: legit classes containing the "ad" substring are not penalized', () => {
  var evaluatePatterns = loadEvaluatePatterns();
  // "thread", "read", "shadow", "download", "gradient" all contain the bare
  // substring "ad" (t-h-r-e-**a-d**, re-**a-d**, ...). None of them are ads.
  for (var cls of ['thread', 'read-more', 'shadow-card', 'download-btn', 'gradient-bg']) {
    assert.ok(
      evaluatePatterns(elWithClass(cls)) >= 0,
      '"' + cls + '" should not be penalized as non-content'
    );
  }
});

test('real ad / nav containers are still penalized', () => {
  var evaluatePatterns = loadEvaluatePatterns();
  for (var cls of ['ad', 'ads', 'advert', 'advertisement', 'ad-container', 'sidebar', 'nav', 'navbar', 'footer', 'menu', 'leaderboard']) {
    assert.ok(
      evaluatePatterns(elWithClass(cls)) < 0,
      '"' + cls + '" should still be penalized as non-content'
    );
  }
});
