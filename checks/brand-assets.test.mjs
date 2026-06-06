import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readPngSize(buffer) {
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('brand asset generation script is exposed through npm', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['assets:brand'], 'node scripts/generate-brand-assets.mjs');
  assert.ok(pkg.devDependencies['@resvg/resvg-js']);
});

test('extension SVG icons use black enabled foreground and gray transparent disabled state', async () => {
  const enabled = await readFile(path.join(ROOT, 'icons/svg/toc-enabled.svg'), 'utf8');
  const disabled = await readFile(path.join(ROOT, 'icons/svg/toc-disabled.svg'), 'utf8');

  assert.match(enabled, /id="document-outline-icon"/);
  assert.match(enabled, /M33 14H78/);
  assert.match(enabled, /fill="#ffffff"/);
  assert.match(enabled, /#202124/i);
  assert.doesNotMatch(enabled, /<rect x="10" y="10"/);
  assert.match(disabled, /id="document-outline-icon"/);
  assert.match(disabled, /M33 14H78/);
  assert.match(disabled, /fill="transparent"/);
  assert.match(disabled, /#737373/i);
  assert.doesNotMatch(disabled, /#202124/i);
  assert.doesNotMatch(disabled, /#e5e7eb/i);
  assert.doesNotMatch(disabled, /#d1d5db/i);
  assert.doesNotMatch(disabled, /<rect x="10" y="10"/);
  assert.doesNotMatch(`${enabled}\n${disabled}`, /#2f6feb|#1d4ed8|#dbeafe|#16a34a|#15803d|#dcfce7|disabled-state-slash/i);
});

test('brand sources use black enabled foreground and gray transparent disabled mark', async () => {
  const files = [
    'scripts/generate-brand-assets.mjs',
    'docs/brand/README.md',
    'docs/brand/web-toc-assistant-mark-enabled.svg',
    'docs/brand/web-toc-assistant-mark-disabled.svg'
  ];
  for (const file of files) {
    const content = await readFile(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(content, /brandBlue|brandGreen|#2f6feb|#1d4ed8|#dbeafe|#eff6ff|#e0f2fe|#16a34a|#15803d|#dcfce7/i, `${file} should not use colored brand palettes`);
  }

  const disabledMark = await readFile(path.join(ROOT, 'docs/brand/web-toc-assistant-mark-disabled.svg'), 'utf8');
  assert.match(disabledMark, /fill="transparent"/);
  assert.match(disabledMark, /#737373/i);
  assert.doesNotMatch(disabledMark, /#202124/i);

  const generator = await readFile(path.join(ROOT, 'scripts/generate-brand-assets.mjs'), 'utf8');
  assert.doesNotMatch(generator, /renderPng\(screenshotSvg\('[^']+'\), 'docs\/descriptions\//);
});

test('extension PNG icons have required Chrome toolbar and store sizes', async () => {
  for (const state of ['enabled', 'disabled']) {
    for (const size of [16, 32, 48, 128]) {
      const file = path.join(ROOT, `icons/png/toc-${state}-${size}.png`);
      const dimensions = readPngSize(await readFile(file));
      assert.deepEqual(dimensions, { width: size, height: size }, `${file} has wrong dimensions`);
    }
  }
});

test('bilingual brand package includes Chrome Web Store visual assets', async () => {
  const requiredFiles = [
    'docs/brand/README.md',
    'docs/brand/web-toc-assistant-mark-enabled.svg',
    'docs/brand/web-toc-assistant-mark-disabled.svg',
    'docs/brand/chrome-web-store-small-promo-en.png',
    'docs/brand/chrome-web-store-small-promo-zh-CN.png',
    'docs/brand/chrome-web-store-marquee-en.png',
    'docs/brand/chrome-web-store-marquee-zh-CN.png',
    'docs/brand/store-screenshot-cover-en.png',
    'docs/brand/store-screenshot-cover-zh-CN.png',
    'docs/brand/store-extension-intro-en.png',
    'docs/brand/store-extension-intro-zh-CN.png'
  ];

  for (const file of requiredFiles) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} should exist`);
  }

  assert.deepEqual(readPngSize(await readFile(path.join(ROOT, 'docs/brand/chrome-web-store-small-promo-en.png'))), { width: 440, height: 280 });
  assert.deepEqual(readPngSize(await readFile(path.join(ROOT, 'docs/brand/chrome-web-store-small-promo-zh-CN.png'))), { width: 440, height: 280 });
  assert.deepEqual(readPngSize(await readFile(path.join(ROOT, 'docs/brand/chrome-web-store-marquee-en.png'))), { width: 1400, height: 560 });
  assert.deepEqual(readPngSize(await readFile(path.join(ROOT, 'docs/brand/chrome-web-store-marquee-zh-CN.png'))), { width: 1400, height: 560 });
  assert.deepEqual(readPngSize(await readFile(path.join(ROOT, 'docs/brand/store-screenshot-cover-en.png'))), { width: 1280, height: 800 });
  assert.deepEqual(readPngSize(await readFile(path.join(ROOT, 'docs/brand/store-screenshot-cover-zh-CN.png'))), { width: 1280, height: 800 });
  assert.deepEqual(readPngSize(await readFile(path.join(ROOT, 'docs/brand/store-extension-intro-en.png'))), { width: 1280, height: 800 });
  assert.deepEqual(readPngSize(await readFile(path.join(ROOT, 'docs/brand/store-extension-intro-zh-CN.png'))), { width: 1280, height: 800 });
});

test('brand generator syncs runtime icons into WXT public assets', async () => {
  const generator = await readFile(path.join(ROOT, 'scripts/generate-brand-assets.mjs'), 'utf8');
  assert.match(generator, /PUBLIC_ICON_DIR/);
  assert.match(generator, /public[/\\]icons/);

  for (const state of ['enabled', 'disabled']) {
    for (const size of [16, 32, 48, 128]) {
      const source = await readFile(path.join(ROOT, `icons/png/toc-${state}-${size}.png`));
      const runtime = await readFile(path.join(ROOT, `public/icons/png/toc-${state}-${size}.png`));
      assert.equal(sha256(runtime), sha256(source), `public PNG icon should match generated source: ${state}-${size}`);
    }
  }

  for (const state of ['enabled', 'disabled']) {
    const source = await readFile(path.join(ROOT, `icons/svg/toc-${state}.svg`));
    const runtime = await readFile(path.join(ROOT, `public/icons/svg/toc-${state}.svg`));
    assert.equal(sha256(runtime), sha256(source), `public SVG icon should match generated source: ${state}`);
  }
});

test('root and WXT public locale files remain in sync', async () => {
  for (const locale of ['en', 'zh_CN']) {
    const source = await readFile(path.join(ROOT, `_locales/${locale}/messages.json`));
    const runtime = await readFile(path.join(ROOT, `public/_locales/${locale}/messages.json`));
    assert.equal(sha256(runtime), sha256(source), `public locale should match root locale: ${locale}`);
  }
});
