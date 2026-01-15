# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web TOC Assistant (网页目录助手) is a Manifest V3 browser extension that automatically generates interactive floating table of contents for any webpage using DOM element detection.

**Key characteristics:**
- Pure vanilla JavaScript - no build system, no bundler, no TypeScript
- Modular architecture with global namespace dependency injection
- All-in-one CSS with `!important` to resist host page interference
- Per-site enable/disable state stored in `chrome.storage.local`

## Installation and Development

**No build process** - this is a zero-build extension.

### Loading the extension
1. Open Edge/Chrome: `edge://extensions/` or `chrome://extensions/`
2. Enable Developer Mode
3. Click "Load unpacked" and select the project folder

### Making changes
- Edit files directly - no compilation needed
- Changes to `manifest.json`: reload the extension
- Changes to content scripts: refresh the page
- Changes to `background.js`: reload the extension

### Testing
No automated test framework. Manual testing required by loading the extension and testing on various websites.

## Architecture

### Module Dependency Layers (Critical Load Order)

The extension uses a **layered module system** with dependency injection via global namespaces. The load order in `manifest.json` is critical:

```
Layer 1: utils.js
    ↓
Layer 2: utils/css-selector.js, utils/toc-builder.js
    ↓
Layer 3: ui/collapsed-badge.js, ui/element-picker.js, ui/floating-panel.js
    ↓
Layer 4: core/config-manager.js, core/mutation-observer.js, core/toc-app.js
    ↓
Layer 5: content.js
    ↓ (background.js - service worker, separate context)
```

### Global Namespace API

All modules expose APIs via `window` object (content script context):
- `window.TOC_UTILS` - Storage, DOM operations, selector execution, URL matching
- `window.CSS_SELECTOR` - Selector generation: `buildClassSelector()`, `cssPathFor()`
- `window.TOC_BUILDER` - TOC building: `buildTocItems()`, `buildTocItemsFromSelectors()`
- `window.TOC_UI` - UI components: panel rendering, badge, element picker
- `window.CONFIG_MANAGER` - Config management: `manageSave()`, `saveSelector()`
- `window.MUTATION_OBSERVER` - DOM observer with debounced rebuilds
- `window.TOC_APP` - Main app: `initForConfig()`, `expand()`, `collapse()`, `rebuild()`

### Entry Points

**`src/background.js`** - Service worker (264 lines)
- Manages per-site enable/disable state in `chrome.storage.local` → `tocSiteEnabledMap`
- Updates extension icon (enabled=blue, disabled=gray)
- Cross-tab synchronization for same origin
- Message handling: `toc:ensureIcon`, `toc:openPanel`, `toc:updateEnabled`

**`src/content.js`** - Content script entry (161 lines)
- Checks site enable state on load
- Initializes `TOC_APP.initForConfig(cfg)`
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
- Panel state persistence

**3. TOC Building Pipeline (`utils/toc-builder.js`)**
```
Selectors (CSS/XPath)
  → collectBySelector() → DOM Elements
  → uniqueInDocumentOrder() → Deduplicate via compareDocumentPosition
  → Filter hidden/empty elements
  → Map to TOC items {id, el, text}
```

**4. UI State Management (`core/toc-app.js`)**
- Navigation lock mechanism (prevents IntersectionObserver interference during user clicks)
- Active item restoration after rebuild
- Pending rebuild queue (processes after navigation unlock)
- Component lifecycle coordination

**5. Dynamic Content Updates (`core/mutation-observer.js`)**
- MutationObserver with 500ms debounce
- Selector validation before observation
- Navigation-aware rebuilding
- Pending rebuild queue during user interaction

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

1. **Dependency checking**: Every module checks for required globals
   ```javascript
   const { getConfigs, initForConfig } = window.TOC_UTILS || {};
   if (!getConfigs || !initForConfig) return;
   ```

2. **Fallback storage**: localStorage if chrome.storage unavailable

3. **Error boundaries**: try/catch around all chrome API calls

4. **Cleanup hooks**: Override `.remove()` to clear event listeners

5. **CSS isolation**: All styles use `!important` with global reset

## CSS Architecture (`src/content.css`)

- **306 lines** of defensive CSS
- Global reset: `.toc-floating, .toc-floating * { all: unset !important; }`
- All styles use `!important` to prevent host page interference
- Components: floating panel, badge, overlay dialogs, buttons

## Key Algorithms

**Element deduplication**: Uses `compareDocumentPosition` to maintain DOM order

**Hidden element filtering**: Checks `display:none`, `visibility:hidden`, `opacity:0`, zero dimensions

**Selector generation** (`utils/css-selector.js`):
- Priority: class-based selector
- Fallback: path selector with nth-of-type

**Navigation lock**: Prevents IntersectionObserver from interfering during user clicks on TOC items

## Manifest V3 Specifics

- `permissions`: ["storage", "tabs"] - no host permissions
- `default_locale`: "zh_CN" - i18n support
- Content scripts run at `document_idle`
- Service worker for background logic

## Common Modification Patterns

### Adding a new content script module
1. Create file in appropriate directory (`utils/`, `ui/`, `core/`)
2. Expose API via `window.MODULE_NAME`
3. Add to `manifest.json` content_scripts.js array in correct dependency order
4. Add dependency checks in consuming modules

### Modifying TOC building logic
Edit `utils/toc-builder.js` - handles selector execution, filtering, and item mapping

### Modifying UI components
- Floating panel: `ui/floating-panel.js` (main TOC rendering, IntersectionObserver)
- Collapsed badge: `ui/collapsed-badge.js` (draggable button)
- Element picker: `ui/element-picker.js` (hover highlighting, click selection)

### Adding new storage keys
Use `chrome.storage.local` - follow existing patterns in `utils.js` for storage wrappers

### Per-site state changes
Use `tocSiteEnabledMap` for enable/disable, `tocConfigs` for selectors, `tocPanelExpandedMap` for UI state
