#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const outputDir = path.join(rootDir, '.output');
const packagesDir = path.join(rootDir, 'dist', 'packages');

function listZipFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listZipFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.zip')) out.push(absolute);
  }
  return out;
}

const zips = listZipFiles(outputDir)
  .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
  .sort((a, b) => b.mtimeMs - a.mtimeMs);

if (zips.length === 0) {
  console.error('No WXT zip package found under .output/. Run `wxt zip` first.');
  process.exit(1);
}

let branchSuffix = '';
try {
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  if (branch && branch !== 'main' && branch !== 'HEAD') {
    branchSuffix = '-' + branch.replace(/[/\\]+/g, '-');
  }
} catch {}

fs.mkdirSync(packagesDir, { recursive: true });
const dest = path.join(packagesDir, `v${pkg.version}${branchSuffix}.zip`);
if (fs.existsSync(dest)) fs.rmSync(dest);
fs.copyFileSync(zips[0].file, dest);

const kb = (fs.statSync(dest).size / 1024).toFixed(1);
console.log(`Package created: ${path.relative(rootDir, dest)} (${kb} KB)`);
