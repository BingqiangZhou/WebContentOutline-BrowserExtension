# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web TOC Assistant (网页目录助手) is a Manifest V3 browser extension that automatically generates interactive floating table of contents for any webpage using DOM element detection.

**Key characteristics:**
- WXT-managed Manifest V3 architecture with runtime-registered content scripts
- Vanilla TypeScript and CSS built by WXT/Vite
- All-in-one CSS with `!important` to resist host page interference
- Per-site enable/disable state stored in `chrome.storage.local`

## Installation and Development

**Build & packaging**: Run `npm run build` to typecheck, run Vitest, build with WXT, zip the extension, and copy a release-compatible package to `dist/packages/`. Load `.output/chrome-mv3` in Developer Mode; the project root contains source files and is not a runnable unpacked extension directory.

### Loading the extension
1. Open Edge/Chrome: `edge://extensions/` or `chrome://extensions/`
2. Enable Developer Mode
3. Run `npm run build`
4. Click "Load unpacked" and select the `.output/chrome-mv3` folder

### Making changes
- Edit TypeScript/CSS files directly — WXT/Vite resolves ESM imports at build time
- For testing: run `npm run test` and `npm run build`, then load `.output/chrome-mv3/`
- Changes to `wxt.config.ts`: rebuild and reload the extension
- Changes to content scripts: rebuild and refresh the page
- Changes to `entrypoints/background.ts`: rebuild and reload the extension

### Testing
Automated checks use Vitest: run `npm run test`. Manual browser smoke testing is still required for extension behavior.

## Architecture

### Module System

Content script modules use **ES Modules** (`import`/`export`). WXT builds `entrypoints/toc.content/index.ts` into `content-scripts/toc.js` and keeps it runtime-registered so it is injected only for enabled origins.

The background service worker is `entrypoints/background.ts` and imports shared primitives as ESM through WXT.

### Dependency Graph

```
entrypoints/toc.content/index.ts
  └── src/content.ts
      ├── utils/toc-utils.ts (barrel re-export)
      └── core/toc-app.ts (orchestrator)
            ├── utils/toc-builder.ts → dom-utils.ts
            ├── ui/edge-dock.ts, ui/element-picker.ts, ui/floating-panel.ts
            ├── core/config-manager.ts → focus-trap.ts
            └── core/rebuild-scheduler.ts → dom-watcher.ts, url-monitor.ts, nav-lock.ts
```

Background script:
```
entrypoints/background.ts
  └── src/shared/primitives.ts
```

### Window Globals

Only a few window globals remain for compatibility/debugging:

| Global | Purpose |
|--------|---------|
| `window.__TOC_ASSISTANT_LOADED__` | Reinjection guard (prevents double-initialization) |
| `window.__TOC_ASSISTANT_CLEANUP__` | Disposal hook for dev reload/reinjection |

### Entry Points

**`entrypoints/background.ts`** - Service worker
- Uses WXT's `browser` wrapper and ESM imports for shared storage, config, and UI state mutation utilities
- Manages per-site enable/disable state in `chrome.storage.local` → `tocSiteEnabledMap`
- Updates extension icon (enabled=blue, disabled=gray)
- Injects `content-scripts/toc.js` and `content-scripts/toc.css` via `browser.scripting`
- Cross-tab synchronization for same origin
- Message handling: `toc:ensureIcon`, `toc:openPanel`, `toc:updateEnabled`, `toc:mutateConfig`, `toc:mutateUiState`

**`src/content.ts`** - Content script bootstrap
- Checks site enable state on load
- Imports `initForConfig` from `core/toc-app.ts` via ESM (using WXT-compatible `.js` import specifiers in source)
- Sets up reinjection guard and cleanup hooks
- Message listeners: `toc:openPanel`, `toc:updateEnabled`

### Core Subsystems

**1. Site Enable/Disable System (`entrypoints/background.ts`)**
- Storage: `chrome.storage.local` → key: `tocSiteEnabledMap`
- Maps origin → boolean (enabled state per site)
- Dynamic icon switching based on state
- Message broadcast to all tabs of same origin

**2. Configuration Management (`core/config-manager.ts`)**
- Storage: `chrome.storage.local` → key: `tocConfigs`
- Per-site URL pattern matching (wildcards supported)
- Selector management (CSS/XPath)
- Config change notification via callback pattern (`setOnConfigChanged` / `_onConfigChanged`)

**3. TOC Building Pipeline (`utils/toc-builder.ts`)**
```
Selectors (CSS/XPath)
  → collectBySelector() → DOM Elements
  → uniqueInDocumentOrder() → Deduplicate via compareDocumentPosition
  → Filter hidden/empty elements
  → Map to TOC items {id, el, text}
```

**4. UI State Management (`core/toc-app.ts`)**
- Uses nav-lock via ESM import for navigation locking
- Active item restoration after rebuild
- Pending rebuild queue (processes after navigation unlock)
- Component lifecycle coordination with `destroy()` cleanup

**5. Dynamic Content Updates**
Split into three focused modules:
- `core/dom-watcher.ts` — MutationObserver-based DOM change detection
- `core/url-monitor.ts` — URL change detection via History API interception, popstate, and polling fallback
- `core/rebuild-scheduler.ts` — Coordinates both with debouncing, nav-lock integration, retry logic, and circuit breaker (pauses after 5 consecutive failures)

**6. Config Change Notification**
- Callback pattern via `setOnConfigChanged()` in `core/config-manager.ts`
- `toc-app.ts` registers a callback that triggers a TOC rebuild when configs change in storage

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

## CSS Architecture (`entrypoints/toc.content/style.css`)

- Defensive CSS with CSS custom properties for light/dark theming
- Uses CSS custom properties for light/dark theming
- Global reset: `.toc-floating, .toc-floating * { all: unset !important; }`
- All styles use `!important` to prevent host page interference
- Components: edge dock, floating panel, overlay dialogs, buttons

## Key Algorithms

**Element deduplication**: Uses `compareDocumentPosition` to maintain DOM order

**Hidden element filtering**: Checks `display:none`, `visibility:hidden`, `opacity:0`, zero dimensions, overflow clipping

**Selector generation** (`utils/css-selector.ts`):
- Priority: class-based selector
- Fallback: path selector with nth-of-type

**Navigation lock**: Prevents IntersectionObserver from interfering during user clicks on TOC items. Auto-unlocks after 8 seconds as a safety fallback.

**Rebuild scheduling** (`core/rebuild-scheduler.ts`):
- Dynamic debounce: `DEBOUNCE_MS * 1.3^consecutiveMutations`, capped at 1800ms
- Circuit breaker: pauses after 5 consecutive failures

## Manifest V3 Specifics

- `permissions`: ["storage", "tabs", "scripting"]
- `host_permissions`: ["http://*/*", "https://*/*"]
- `default_locale`: "en" - i18n support
- Content script is bundled by WXT and injected dynamically via `browser.scripting.executeScript`
- Background script is a WXT MV3 service worker entrypoint
- `src/shared/primitives.ts` is shared ESM source imported by WXT entrypoints

## Common Modification Patterns

### Adding a new content script module
1. Create file in appropriate directory (`utils/`, `ui/`, `core/`)
2. Use `export` for the module's public API
3. `import` from the module wherever needed (WXT/Vite resolves at build time)
4. If it's a utility, consider adding to `utils/toc-utils.ts` barrel re-export

### Modifying TOC building logic
Edit `utils/toc-builder.ts` - handles selector execution, filtering, and item mapping

### Modifying UI components
- Floating panel: `ui/floating-panel.ts` (title-free TOC card rendering) + `ui/floating-panel-helpers.ts` (extracted helpers)
- Edge dock: `ui/edge-dock.ts` (edge toolbar, live outline preview, hover preview, pinned state, vertical dragging)
- Active item tracker: `core/active-item-tracker.ts` (shared reading-position observer for collapsed and expanded states)
- Element picker: `ui/element-picker.ts` (hover highlighting, click selection)

### Adding new storage keys
Use `chrome.storage.local` - follow existing patterns in `utils/storage.ts` for storage wrappers. Add the key name to `STORAGE_KEYS` in `utils/constants.ts`.

### Per-site state changes
Use `tocSiteEnabledMap` for enable/disable, `tocConfigs` for selectors, `tocPanelExpandedMap` for UI state

### Building and packaging
Run `npm run build` to:
1. Run TypeScript typecheck
2. Run Vitest
3. Build and zip the WXT chrome-mv3 extension
4. Copy the zip to `dist/packages/v{version}.zip`

## Working Documents

The `docs/superpowers/` directory holds local-only working documents (design specs, implementation plans) generated by Claude Code superpowers skills. These files are excluded from git via `.gitignore` — do NOT commit them. The directory is created on demand and may not exist when no active working documents are present.
