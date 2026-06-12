import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Loads url-monitor with a controllable clock so we can drive the poll and the
// 500ms url-change debounce deterministically.
function loadUrlMonitor(initialHref) {
  var file = path.join(repoRoot, 'src/core/url-monitor.ts');
  var source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export function /g, 'function '));
  var captured = { onChangeArgs: [] };
  var currentTime = 0;
  var nextId = 1;
  var timers = [];
  var loc = { href: initialHref || 'https://example.com/a' };
  var sandbox = {
    console: console,
    location: loc,
    document: { hidden: false, addEventListener: function () {}, removeEventListener: function () {} },
    window: { addEventListener: function () {}, removeEventListener: function () {} },
    setTimeout: function (fn, delay) {
      var id = nextId++;
      timers.push({ id: id, fn: fn, fireAt: currentTime + (Number(delay) || 0) });
      return id;
    },
    clearTimeout: function (id) {
      timers = timers.filter(function (t) { return t.id !== id; });
    },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.createUrlMonitor = createUrlMonitor;', sandbox, { filename: file });
  return {
    captured: captured,
    loc: loc,
    start: function (onChange) {
      sandbox.__exports.createUrlMonitor({}).start({}, function (immediate) {
        captured.onChangeArgs.push(immediate);
        if (onChange) onChange(immediate);
      });
    },
    advance: function (ms) {
      currentTime += ms;
      var due = timers.filter(function (t) { return t.fireAt <= currentTime; }).sort(function (a, b) { return a.fireAt - b.fireAt; });
      timers = timers.filter(function (t) { return t.fireAt > currentTime; });
      for (var i = 0; i < due.length; i++) { try { due[i].fn(); } catch (_) {} }
    }
  };
}

test('url change schedules a debounced (non-immediate) rebuild so the SPA can render first', () => {
  var env = loadUrlMonitor('https://example.com/a');
  env.start();
  // SPA navigation
  env.loc.href = 'https://example.com/b';
  env.advance(3000); // first poll detects the href change -> schedules 500ms timer
  env.advance(500);  // fires the url-change callback
  assert.deepEqual(env.captured.onChangeArgs, [false]);
});
