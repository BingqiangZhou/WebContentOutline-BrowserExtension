import { defineConfig } from 'wxt';

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
    permissions: ['storage', 'tabs', 'scripting'],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: disabledIcon,
    action: {
      default_title: '__MSG_browserActionTitle__',
      default_icon: disabledIcon,
    },
  },
  hooks: {
    'build:manifestGenerated': (_, manifest) => {
      if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 0) {
        delete manifest.content_scripts;
      }
    },
  },
});
