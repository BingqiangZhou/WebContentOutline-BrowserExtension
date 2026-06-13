import { defineConfig } from 'wxt';
import { execSync } from 'node:child_process';

// Branch-aware zip suffix: non-main/HEAD branches get a hyphenated suffix
// so dev builds don't overwrite release artifacts at the same version.
let zipBranchSuffix = '';
try {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  if (branch && branch !== 'main' && branch !== 'HEAD') {
    zipBranchSuffix = `-${branch.replace(/[/\\]/g, '-')}`;
  }
} catch {}

const disabledIcon = {
  16: 'icons/png/toc-disabled-16.png',
  32: 'icons/png/toc-disabled-32.png',
  48: 'icons/png/toc-disabled-48.png',
  128: 'icons/png/toc-disabled-128.png',
};

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    // MV3 service worker + chrome.scripting (executeScript/insertCSS/removeCSS)
    // baseline. The CSS/JS uses nothing newer than :where()/:is() (Chrome 88);
    // 102 sits safely above all requirements and covers Edge (Chromium) 102+.
    minimum_chrome_version: '102',
    permissions: ['storage', 'tabs', 'scripting'],
    // Host access is REQUIRED: granted at install time so the TOC can read and
    // inject into any page the user enables it on, with no per-site permission
    // prompt and no per-origin grant to lose. (Previously optional per-origin;
    // reverted for reliability — the per-origin grant was a root cause of the
    // extension silently not appearing on enabled sites.)
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: disabledIcon,
    action: {
      default_title: '__MSG_browserActionTitle__',
      default_icon: disabledIcon,
    },
  },
  zip: {
    artifactTemplate: `webtoc-assistant-v{{version}}${zipBranchSuffix}.zip`,
  },
  hooks: {
    'build:manifestGenerated': (_, manifest) => {
      // The content script uses registration: 'runtime' (injected dynamically
      // via scripting.executeScript), so WXT must not emit a static
      // content_scripts block. It may still emit an empty array, so strip it.
      if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 0) {
        delete manifest.content_scripts;
      }
    },
  },
});
