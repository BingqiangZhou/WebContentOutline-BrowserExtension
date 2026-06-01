# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web TOC Assistant (网页目录助手) is a Manifest V3 browser extension that automatically generates interactive floating table of contents for any webpage using DOM element detection.

**Key characteristics:**
- ES Modules architecture with esbuild bundling into a single IIFE
- Pure vanilla JavaScript with a `build.js` script for validation, bundling, and packaging
- All-in-one CSS with `!important` to resist host page interference
- Per-site enable/disable state stored in `chrome.storage.local`

## Installation and Development

**Build & packaging**: Run `npm run build` to bundle with esbuild, validate syntax, and create a distributable zip. Load `dist/build` in Developer Mode; the project root contains ESM source files and is not a runnable unpacked extension directory.

### Loading the extension
1. Open Edge/Chrome: `edge://extensions/` or `chrome://extensions/`
2. Enable Developer Mode
3. Run `npm run build`
4. Click "Load unpacked" and select the `dist/build` folder

### Making changes
- Edit files directly — esbuild resolves ESM imports at build time
- For testing: run `npm run build`, then load from `dist/build/`
- Changes to `manifest.json`: reload the extension
- Changes to content scripts: rebuild and refresh the page
- Changes to `background.js`: reload the extension

### Testing
No automated test framework. Manual testing required by loading the extension and testing on various websites.

## Architecture

### Module System

Content script modules use **ES Modules** (`import`/`export`). At build time, esbuild bundles the entire dependency tree starting from `src/content.js` into a single IIFE at `dist/build/src/content.js`. There is no runtime module loading or load-order concern.

The background service worker cannot use ESM (MV3 limitation). The build produces a separate IIFE bundle of `shared/storage-primitives.js` for `importScripts()` in the service worker.

### Dependency Graph

```
src/content.js (entry point)
  ├── utils/toc-utils.js (barrel re-export)
  │     ├── constants.js, core-utils.js, toast.js
  │     ├── storage.js, badge-position.js, dom-utils.js
  │     └── (storage.js → shared/storage-primitives.js)
  └── core/toc-app.js (orchestrator)
        ├── utils/toc-builder.js → dom-utils.js
        ├── ui/edge-dock.js, ui/element-picker.js, ui/floating-panel.js
        │     └── (floating-panel.js → ui/floating-panel-helpers.js)
        ├── core/config-manager.js → event-bus.js, focus-trap.js
        ├── core/rebuild-scheduler.js → dom-watcher.js, url-monitor.js, nav-lock.js
        └── core/nav-lock.js
```

Background script (separate context, uses IIFE bundle produced by build):
```
src/background.js
  └── importScripts → shared/storage-primitives.js (IIFE bundle)
```

### Window Globals

Only a few window globals remain for compatibility/debugging:

| Global | Purpose |
|--------|---------|
| `window.__TOC_ASSISTANT_LOADED__` | Reinjection guard (prevents double-initialization) |
| `window.__TOC_ASSISTANT_CLEANUP__` | Disposal hook for dev reload/reinjection |

### Entry Points

**`src/background.js`** - Service worker
- Uses `importScripts('shared/storage-primitives.js')` for shared storage utilities
- Manages per-site enable/disable state in `chrome.storage.local` → `tocSiteEnabledMap`
- Updates extension icon (enabled=blue, disabled=gray)
- Injects content script via `chrome.scripting.executeScript` (single bundled file)
- Cross-tab synchronization for same origin
- Message handling: `toc:ensureIcon`, `toc:openPanel`, `toc:updateEnabled`

**`src/content.js`** - Content script entry
- Checks site enable state on load
- Imports `initForConfig` from `core/toc-app.js` via ESM
- Sets up reinjection guard and cleanup hooks
- Message listeners: `toc:openPanel`, `toc:updateEnabled`

### Core Subsystems

**1. Site Enable/Disable System (`background.js`)**
- Storage: `chrome.storage.local` → key: `tocSiteEnabledMap`
- Maps origin → boolean (enabled state per site)
- Dynamic icon switching based on state
- Message broadcast to all tabs of same origin

**2. Configuration Management (`core/config-manager.js`)**
- Storage: `chrome.storage.local` → key: `tocConfigs`
- Per-site URL pattern matching (wildcards supported)
- Selector management (CSS/XPath)
- Emits `toc:config-changed` via event bus when configs update

**3. TOC Building Pipeline (`utils/toc-builder.js`)**
```
Selectors (CSS/XPath)
  → collectBySelector() → DOM Elements
  → uniqueInDocumentOrder() → Deduplicate via compareDocumentPosition
  → Filter hidden/empty elements
  → Map to TOC items {id, el, text}
```

**4. UI State Management (`core/toc-app.js`)**
- Uses nav-lock via ESM import for navigation locking
- Active item restoration after rebuild
- Pending rebuild queue (processes after navigation unlock)
- Component lifecycle coordination with `destroy()` cleanup

**5. Dynamic Content Updates**
Split into three focused modules:
- `core/dom-watcher.js` — MutationObserver-based DOM change detection
- `core/url-monitor.js` — URL change detection via custom events (from `page-url-hook.js`) + polling fallback
- `core/rebuild-scheduler.js` — Coordinates both with debouncing, nav-lock integration, retry logic, and circuit breaker (pauses after 5 consecutive failures)

**6. Event Bus (`core/event-bus.js`)**
- Lightweight pub/sub: `on(event, fn)`, `off(event, fn)`, `emit(event, ...args)`
- Currently used for `toc:config-changed` event (config-manager → toc-app)

### Storage Schema

```javascript
// chrome.storage.local
{
  "tocConfigs": [
    {
      urlPattern: "https://example.com/*",
      side: "right",
      selectors: [
        { type: "css", expr: "h1, h2, h3" },
        { type: "xpath", expr: "//article//h2" }
      ],
      collapsedDefault: false
    }
  ],
  "tocSiteEnabledMap": {
    "https://example.com": true,
    "https://another.com": false
  },
  "tocPanelExpandedMap": {
    "https://example.com": true
  }
}
```

## Defensive Programming Patterns

1. **Import validation**: Modules check imported symbols at initialization
   ```javascript
   if (!getConfigs || !initForConfig || !getSiteEnabledByOrigin) return;
   ```

2. **Fallback storage**: localStorage if chrome.storage unavailable

3. **Error boundaries**: try/catch around all chrome API calls

4. **Cleanup hooks**: `destroy()` methods on toc-app, nav-lock, rebuild-scheduler for full teardown

5. **CSS isolation**: All styles use `!important` with global reset

## CSS Architecture (`src/content.css`)

- Defensive CSS with CSS custom properties for light/dark theming
- Uses CSS custom properties for light/dark theming
- Global reset: `.toc-floating, .toc-floating * { all: unset !important; }`
- All styles use `!important` to prevent host page interference
- Components: edge dock, floating panel, overlay dialogs, buttons

## Key Algorithms

**Element deduplication**: Uses `compareDocumentPosition` to maintain DOM order

**Hidden element filtering**: Checks `display:none`, `visibility:hidden`, `opacity:0`, zero dimensions, overflow clipping

**Selector generation** (`utils/css-selector.js`):
- Priority: class-based selector
- Fallback: path selector with nth-of-type

**Navigation lock**: Prevents IntersectionObserver from interfering during user clicks on TOC items. Auto-unlocks after 8 seconds as a safety fallback.

**Rebuild scheduling** (`core/rebuild-scheduler.js`):
- Dynamic debounce: `DEBOUNCE_MS * 1.3^consecutiveMutations`, capped at 1800ms
- Circuit breaker: pauses after 5 consecutive failures

## Manifest V3 Specifics

- `permissions`: ["storage", "tabs", "scripting", "alarms"]
- `host_permissions`: ["http://*/*", "https://*/*"]
- `default_locale`: "en" - i18n support
- Content script is a single bundled IIFE, injected dynamically via `chrome.scripting.executeScript`
- Background script uses `importScripts()` (MV3 service workers cannot use ESM)
- `shared/storage-primitives.js` is ESM source; build produces a separate IIFE bundle for the background service worker

## Common Modification Patterns

### Adding a new content script module
1. Create file in appropriate directory (`utils/`, `ui/`, `core/`)
2. Use `export` for the module's public API
3. `import` from the module wherever needed (esbuild resolves at build time)
4. If it's a utility, consider adding to `utils/toc-utils.js` barrel re-export

### Modifying TOC building logic
Edit `utils/toc-builder.js` - handles selector execution, filtering, and item mapping

### Modifying UI components
- Floating panel: `ui/floating-panel.js` (main TOC rendering, IntersectionObserver) + `ui/floating-panel-helpers.js` (extracted helpers)
- Edge dock: `ui/edge-dock.js` (edge toolbar, hover preview, pinned state, vertical dragging)
- Element picker: `ui/element-picker.js` (hover highlighting, click selection)

### Adding new storage keys
Use `chrome.storage.local` - follow existing patterns in `utils/storage.js` for storage wrappers. Add the key name to `STORAGE_KEYS` in `utils/constants.js`.

### Per-site state changes
Use `tocSiteEnabledMap` for enable/disable, `tocConfigs` for selectors, `tocPanelExpandedMap` for UI state

### Building and packaging
Run `npm run build` to:
1. Bundle `src/content.js` with esbuild into `dist/build/src/content.js` (IIFE format)
2. Copy runtime files to `dist/build/` (background.js, page-url-hook.js, content.css, manifest.json, icons, locales, storage-primitives.js)
3. Package into `dist/packages/v{version}.zip`

## Working Documents

The `docs/superpowers/` directory holds local-only working documents (design specs, implementation plans) generated by Claude Code superpowers skills. These files are excluded from git via `.gitignore` — do NOT commit them. The directory is created on demand and may not exist when no active working documents are present.
