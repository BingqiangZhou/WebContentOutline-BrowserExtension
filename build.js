#!/usr/bin/env node
// Build script for Web TOC Assistant.
// Bundles the content script with esbuild and copies MV3 runtime assets to dist/build.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist', 'build');
const SRC_DIR = path.join(ROOT_DIR, 'src');

const RUNTIME_EXTENSIONS = new Set([
  '.js', '.css', '.json', '.png', '.svg', '.gif', '.jpg', '.ico', '.html'
]);

function validateFile(filePath) {
  try {
    execFileSync('node', ['-c', filePath], { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.error(`  SYNTAX ERROR: ${filePath}`);
    console.error(e.stderr?.toString());
    return false;
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (RUNTIME_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      copyFile(srcPath, destPath);
    }
  }
}

async function buildContentScript() {
  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'content.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome116'],
    outfile: path.join(DIST_DIR, 'src', 'content.js'),
    logLevel: 'silent',
    legalComments: 'none'
  });
}

async function buildPrimitives() {
  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'shared', 'primitives.js')],
    bundle: true,
    format: 'iife',
    globalName: '__TOC_PRIMITIVES_BUNDLE',
    platform: 'browser',
    target: ['chrome116'],
    outfile: path.join(DIST_DIR, 'src', 'shared', 'primitives.js'),
    footer: {
      js: [
        'globalThis.__STORAGE_PRIMITIVES = __TOC_PRIMITIVES_BUNDLE;',
        'globalThis.__CONFIG_PRIMITIVES = __TOC_PRIMITIVES_BUNDLE;',
        'globalThis.__UI_STATE_PRIMITIVES = __TOC_PRIMITIVES_BUNDLE;'
      ].join('\n')
    },
    logLevel: 'silent',
    legalComments: 'none'
  });
}

async function main() {
  console.log('Building Web TOC Assistant...\n');

  let errors = 0;
  for (const file of [
    path.join(ROOT_DIR, 'build.js'),
    path.join(SRC_DIR, 'background.js'),
    path.join(SRC_DIR, 'shared', 'primitives.js')
  ]) {
    if (!validateFile(file)) errors++;
  }

  const contentCss = path.join(SRC_DIR, 'content.css');
  if (!fs.existsSync(contentCss)) {
    console.error('  MISSING: src/content.css');
    errors++;
  }

  if (errors > 0) {
    console.error(`\n${errors} error(s) found. Fix before packaging.`);
    process.exit(1);
  }

  if (fs.existsSync(DIST_DIR)) fs.rmSync(DIST_DIR, { recursive: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  try {
    await buildContentScript();
    await buildPrimitives();
  } catch (e) {
    console.error('  BUNDLE ERROR');
    console.error(e && e.errors ? e.errors : e);
    process.exit(1);
  }

  if (!validateFile(path.join(DIST_DIR, 'src', 'content.js'))) {
    process.exit(1);
  }
  if (!validateFile(path.join(DIST_DIR, 'src', 'shared', 'primitives.js'))) {
    process.exit(1);
  }

  copyFile(path.join(ROOT_DIR, 'manifest.json'), path.join(DIST_DIR, 'manifest.json'));
  copyFile(path.join(SRC_DIR, 'background.js'), path.join(DIST_DIR, 'src', 'background.js'));
  copyFile(path.join(SRC_DIR, 'content.css'), path.join(DIST_DIR, 'src', 'content.css'));

  const localesDir = path.join(ROOT_DIR, '_locales');
  if (fs.existsSync(localesDir)) {
    copyRecursive(localesDir, path.join(DIST_DIR, '_locales'));
  }

  const iconsDir = path.join(ROOT_DIR, 'icons');
  if (fs.existsSync(iconsDir)) {
    copyRecursive(iconsDir, path.join(DIST_DIR, 'icons'));
  }

  console.log('  Content script bundled with esbuild.');
  console.log('\nBuild complete. Output in dist/build/');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
  const packagesDir = path.join(ROOT_DIR, 'dist', 'packages');
  fs.mkdirSync(packagesDir, { recursive: true });

  const zipFile = path.join(packagesDir, `v${manifest.version}.zip`);
  try {
    if (fs.existsSync(zipFile)) fs.rmSync(zipFile);
    execFileSync('zip', ['-r', zipFile, '.'], { stdio: 'pipe', cwd: DIST_DIR });
    const stats = fs.statSync(zipFile);
    const kb = (stats.size / 1024).toFixed(1);
    console.log(`\nPackage created: dist/packages/v${manifest.version}.zip (${kb} KB)`);
  } catch (e) {
    console.error('Failed to create zip package');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
