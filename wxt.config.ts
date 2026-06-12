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
    // Host access is OPTIONAL: requested per-origin at runtime when the user
    // enables a site (chrome.permissions.request in the action-click gesture),
    // and revoked on disable. Least-privilege — the extension has no host
    // access until the user explicitly grants a specific site.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
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
      if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 0) {
        delete manifest.content_scripts;
      }
      // Host access is OPTIONAL (optional_host_permissions), granted per-origin
      // at runtime via chrome.permissions.request. Strip any required
      // host_permissions WXT auto-derived from the content script's match
      // patterns, so the extension ships with NO default host access. Granted
      // optional origins still let scripting.executeScript inject.
      delete manifest.host_permissions;
    },
  },
});
