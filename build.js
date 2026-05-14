#!/usr/bin/env node
// Build script for Web TOC Assistant
// Currently validates and copies source files to dist/build/.
// Future: esbuild bundling when modules are converted to ES imports.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist', 'build');
const SRC_DIR = path.join(ROOT_DIR, 'src');

function getLoadOrder() {
  const bg = fs.readFileSync(path.join(SRC_DIR, 'background.js'), 'utf8');
  const match = bg.match(/CONTENT_SCRIPTS\s*=\s*\[([\s\S]*?)\]/);
  if (!match) {
    console.error('Cannot find CONTENT_SCRIPTS in background.js');
    process.exit(1);
  }
  return match[1]
    .split('\n')
    .map(l => l.trim().replace(/['",]/g, ''))
    .filter(l => l.endsWith('.js'));
}

function validateFile(filePath) {
  try {
    execSync(`node -c "${filePath}"`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.error(`  SYNTAX ERROR: ${filePath}`);
    console.error(e.stderr?.toString());
    return false;
  }
}

// Only copy runtime files (.js, .css, .json, .png, .svg, etc.) — skip docs (.md, .txt)
const RUNTIME_EXTENSIONS = new Set([
  '.js', '.css', '.json', '.png', '.svg', '.gif', '.jpg', '.ico', '.html'
]);

function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (RUNTIME_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('Building Web TOC Assistant...\n');

// Step 1: Validate load order
const loadOrder = getLoadOrder();
console.log(`Load order: ${loadOrder.length} scripts`);

// Step 2: Validate syntax of content scripts
let errors = 0;
for (const file of loadOrder) {
  const filePath = path.join(ROOT_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.error(`  MISSING: ${file}`);
    errors++;
    continue;
  }
  if (!validateFile(filePath)) errors++;
}

// Also validate background.js
if (!validateFile(path.join(SRC_DIR, 'background.js'))) errors++;

// Validate content.css exists (no syntax check for CSS via node)
const contentCss = path.join(SRC_DIR, 'content.css');
if (!fs.existsSync(contentCss)) {
  console.error(`  MISSING: src/content.css`);
  errors++;
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found. Fix before packaging.`);
  process.exit(1);
}

console.log('  All files passed syntax validation.');

// Step 3: Copy to dist/build
if (fs.existsSync(DIST_DIR)) fs.rmSync(DIST_DIR, { recursive: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

// Copy manifest.json
fs.copyFileSync(
  path.join(ROOT_DIR, 'manifest.json'),
  path.join(DIST_DIR, 'manifest.json')
);

// Copy src/
copyRecursive(SRC_DIR, path.join(DIST_DIR, 'src'));

// Copy _locales/
const localesDir = path.join(ROOT_DIR, '_locales');
if (fs.existsSync(localesDir)) {
  copyRecursive(localesDir, path.join(DIST_DIR, '_locales'));
}

// Copy icons/
const iconsDir = path.join(ROOT_DIR, 'icons');
if (fs.existsSync(iconsDir)) {
  copyRecursive(iconsDir, path.join(DIST_DIR, 'icons'));
}

console.log('\nBuild complete. Output in dist/build/');
console.log('  Scripts validated: ' + loadOrder.length);

// Step 4: Package as zip
const VERSION = (() => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
  return manifest.version;
})();

const packagesDir = path.join(ROOT_DIR, 'dist', 'packages');
fs.mkdirSync(packagesDir, { recursive: true });

const zipFile = path.join(packagesDir, `v${VERSION}.zip`);
try {
  execSync(`cd "${DIST_DIR}" && zip -r "${zipFile}" .`, { stdio: 'pipe' });
  const stats = fs.statSync(zipFile);
  const kb = (stats.size / 1024).toFixed(1);
  console.log(`\nPackage created: dist/packages/v${VERSION}.zip (${kb} KB)`);
} catch (e) {
  console.error('Failed to create zip package');
  process.exit(1);
}
