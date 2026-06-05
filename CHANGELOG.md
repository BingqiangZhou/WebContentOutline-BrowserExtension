# Changelog

All notable changes to the Web TOC Assistant extension will be documented in this file.

**[中文版本 / Chinese Version](CHANGELOG_CN.md)**

[Table of Contents](#table-of-contents) • [Latest](#120---2026-06-05)

---

## Table of Contents

- [1.2.0](#120---2026-06-05) - 2026-06-05
- [1.1.0](#110---2026-06-05) - 2026-06-05
- [1.0.2](#102---2026-06-04) - 2026-06-04
- [1.0.1](#101---2026-06-02) - 2026-06-02
- [1.0.0](#100---2026-06-02) - 2026-06-02
- [0.8.1](#081---2026-05-18) - 2026-05-18
- [0.8.0](#080---2026-05-15) - 2026-05-15
- [0.7.1](#071---2026-05-07) - 2026-05-07
- [0.7.0](#070---2026-05-07) - 2026-05-07
- [0.6.3](#063---2026-03-15) - 2026-03-15
- [0.6.2](#062---2026-03-14) - 2026-03-14
- [0.6.1](#061---2026-02-05) - 2026-02-05
- [0.6.0](#060---2026-02-05) - 2026-02-05
- [0.5.2](#052---2026-02-03) - 2026-02-03
- [0.5.1](#051---2026-02-03) - 2026-02-03
- [0.5.0](#050---2026-02-03) - 2026-02-03
- [0.4.1](#041---2026-01-23) - 2026-01-23
- [0.4.0](#040---2026-01-22) - 2026-01-22
- [0.3.0](#030---2026-01-15) - 2026-01-15
- [0.2.0](#020---2026-01-15) - 2026-01-15
- [0.1.1](#011---2025-09-15) - 2025-09-15
- [0.1.0](#010---2025-09-14) - 2025-09-14

---

## [1.2.0] - 2026-06-05

### 🐛 Fixed
- **Circuit breaker permanent lockout** — Rebuild scheduler now auto-resets after 30 seconds, preventing permanent TOC loss from transient errors
- **TOC not restored after tab switch** — Added `visibilitychange` listener to trigger pending rebuilds when switching back to the tab
- **Hidden tab resource waste** — URL monitor pauses polling when the tab is hidden and resumes on visibility, reducing background CPU usage

### 🔧 Changed
- **CSP compliance** — Replaced `innerHTML` string concatenation with `createElement` + `textContent` for extension context invalidated notice, following Content Security Policy best practices
- **stopApp duplicate cleanup** — Simplified the stop flow to call `dispose()` directly, eliminating redundant `destroy()` + `cleanupOwnedElements()` calls

### ⚡ Technical Improvements
- **Unified shared utilities** — `isPlainObject` and `isHighRiskBroadCssSelector` are now exported from `primitives.ts` and imported where needed, eliminating cross-module duplication. `SELECTOR_EXPR_MAX_LENGTH` constant consolidated into `constants.ts`
- **Variable naming correction** — Renamed `mutationObserver` (actually a rebuild scheduler handle) to `rebuildScheduler` in `toc-app.ts`
- **IntersectionObserver reuse** — `setItems()` disconnects without destroying the observer instance; `observeItems()` reuses the existing observer instead of creating a new one each time
- **Mutation record processing** — `checkAndReconnect()` now passes `takeRecords()` output to `hasMeaningfulChange()` to trigger rebuilds for pending mutations
- **Unified event cleanup** — Edge dock adopts `AbortController` + `{ signal }` pattern for managing all 13 event listener lifecycles, matching the existing floating-panel pattern
- **Full TypeScript type checking** — Removed `@ts-nocheck` from all 27 source files, fixed all type errors, added `@types/chrome` and global type declarations (`src/types.d.ts`)

---

## [1.1.0] - 2026-06-05

### ⚡ Technical Improvements
- **WXT build migration**
  - Replaced the custom `build.js` and source `manifest.json` pipeline with WXT-managed Manifest V3 generation, TypeScript entrypoints, and Vite bundling.
  - Runtime injection behavior remains unchanged: the background service worker dynamically injects `content-scripts/toc.js` and `content-scripts/toc.css` only on enabled sites.
- **TypeScript project structure**
  - Migrated source modules from `.js` to `.ts`, added shared storage/message types, and introduced WXT/TypeScript configuration.
- **Vitest test workflow**
  - Replaced `node:test` scripts with Vitest while preserving existing coverage and adding WXT migration checks.
- **Release pipeline hardening**
  - Updated the release skill and GitHub Actions workflow for WXT packages, generated manifest validation, and zip content checks.

---

## [1.0.2] - 2026-06-04

### 🐛 Fixed
- **Circuit breaker for rebuild failures** — Rebuild scheduler now stops attempting rebuilds after 5 consecutive failures, preventing infinite retry loops on broken pages
- **Active item highlight flicker on rebuild** — Preserved active TOC item across rebuilds when the same DOM element still exists, eliminating highlight flicker during frequent DOM mutations
- **DOM element leak in config manager** — Orphaned shadow host elements are now properly cleaned up when config initialization fails
- **Layout thrashing during TOC building** — Replaced per-element interleaved geometry reads with a two-pass batch approach: Phase 1 reads all geometry, Phase 2 filters and extracts text only for survivors
- **URL monitor polling after context invalidation** — Stopped rescheduling poll timers when extension context is invalidated, preventing leaked timers
- **Element picker cursor not restored** — Fixed cursor restore order so `document.body.style.cursor` resets before listener cleanup, preventing stuck cursors
- **CSS `transition: all` causing jank** — Replaced `transition: all` with specific property transitions on delete buttons and animations, avoiding expensive style recalculation on every frame
- **WriteQueue memory leak** — `serializedWrite` now prunes completed queue entries via `finally()`, preventing unbounded growth of the write queue map
- **CSS selector depth explosion** — Added depth limit of 20 to `generateCssSelector` to prevent excessively long selectors on deeply nested pages

### ⚡ Technical Improvements
- **Major refactoring: removed over-engineering** — Simplified the codebase by 2887 lines across 4 rounds of cleanup, removing dead modules (`event-bus.js`, `page-url-hook.js`, `config-primitives.js`, `storage-primitives.js`), redundant abstractions, and unused constants
- **WeakSet for owned-node detection** — DOM watcher uses `WeakSet` for O(1) ownership checks instead of O(depth) `closest()` traversal
- **`onConfigDirty` callback** — Replaced monkey-patched `cfg.__markConfigDirty` with an explicit callback passed through `createRebuildScheduler` options
- **`prefers-reduced-motion` support** — Added reduced-motion media query rules for TOC items, buttons, selector items, and delete buttons
- **`will-change` GPU hints** — Added `will-change` hints on animated elements (collapsed badge, floating panel, delete buttons) for smoother compositor-layer animations
- **Rebuild return value semantics** — `toc-app.rebuild()` now returns `true`/`false` to distinguish successful no-ops from genuine failures, improving scheduler circuit-breaker accuracy
- **Merged shared primitives** — Consolidated storage, config, and UI state primitives into a single `shared/primitives.js` module; build produces one IIFE bundle for the background service worker
- **Brand icon redesign** — Replaced all extension icons (enabled/disabled, 16/32/48/128px + SVG) with new transparent white-document design; enabled state turns black, disabled state turns gray
- **Chrome Web Store brand assets** — Added marquee banners, small promo tiles, store screenshots, and extension intro images for both English and Chinese locales
- **Icon generation script** — New `scripts/generate-brand-assets.mjs` for automated brand asset production and validation

### 🔧 Changed
- **Icon status indicator description** — Updated from "blue/gray" to "transparent white-document icon turns black when enabled and gray when disabled" to reflect the new icon design
- **README project structure** — Updated directory listing to reflect module consolidation (`primitives.js` replaces `storage-primitives.js`, removed `event-bus.js`, added `docs/brand/`)
- **Build script** — Added auto-suffix for zip filename based on git branch name

---

## [1.0.1] - 2026-06-02

### 🔧 Changed
- **Config writes routed through background service worker**
  - Content script no longer writes configs directly to `chrome.storage.local`; all mutations (`add-selector`, `remove-selector`, `clear-site`) are sent as validated `toc:mutateConfig` messages to the background script
  - Background applies mutations via the new `shared/config-primitives.js` module using `serializedWrite` for safe multi-tab concurrency
- **Edge Dock preview visuals refined**
  - Smaller, centered preview lines and settings icon with CSS custom properties for light/dark preview colors
  - Active-line ring replaces solid highlight; focus ring uses `box-shadow` instead of `outline`
- **DOM watcher is heading-aware in default mode**
  - When no custom selectors are configured, mutations only trigger rebuilds when actual heading elements are affected, reducing unnecessary rebuilds on dynamic pages

### 🐛 Fixed
- **Badge-mode flicker on content-identical rebuilds** — Skips UI rebuild when TOC items are unchanged, preventing visual flicker during frequent DOM mutations
- **URL monitor polling accuracy** — Uses `WeakMap`-based element identity and text-content hashing for more reliable change detection; uses throttled polling interval when MutationObserver is active
- **`uniqueInDocumentOrder` sort correctness** — Added explicit `compareDocumentPosition`-based sort after dedup to guarantee correct DOM order for elements from mixed selectors
- **Edge Dock peek auto-collapse timing** — Programmatic peek from panel-open now auto-collapses after 1.8 s; closing the expanded panel properly collapses the dock in modern mode

### ⚡ Technical Improvements
- New `shared/config-primitives.js` module with `applyTocConfigMutation` — normalized, validated, rate-limited config writes
- `background.js` handles `toc:mutateConfig` messages with sender validation and per-site URL pattern verification
- Content script listens for `tocConfigs` storage changes and triggers `refreshConfig()` for cross-tab config synchronization
- `collectBySelector` accepts an optional `maxCandidates` parameter for controlled polling queries

---

## [1.0.0] - 2026-06-02

### 🚀 Added
- **Edge Dock TOC toolbar**
  - Replaces the collapsed floating badge with a detached circular extension list mark and live miniature outline
  - Uses heading-level width and indentation for up to 12 nearby outline bars, with current-position highlighting
  - Lets each collapsed outline bar navigate directly without changing the panel's temporary expansion state
  - Expands inward on desktop hover and restores the bars after pointer leave; touch devices temporarily toggle the list
  - Adds quick settings for refresh, element picking, site configuration, and left/right edge switching
- **Global UI mode preference**
  - Defaults to the modern Edge Dock
  - Allows switching to the classic text badge and freely draggable floating panel interaction
  - Synchronizes mode changes across open tabs through `chrome.storage.local`

### 🔧 Changed
- **TOC panel is now a lightweight docked card**
  - Removes visible title chrome and uses a title-free outline card with hierarchy-aware indentation
  - Attaches the inward-expanding card directly to the outline bars and animates from the same edge anchor for a ChatGPT-style hover interaction
  - Keeps navigation, highlighting, accessibility labels, and incremental updates
  - Removes free panel dragging; the dock moves vertically with safe viewport margins
- **Existing position storage remains compatible**
  - Reuses `tocBadgePosMap` for dock side and vertical anchor persistence

### ⚡ Technical Improvements
- **Active item tracking** now stays alive while the outline card is closed, keeping the collapsed preview synchronized during scrolling
- **Classic mode layout** restores the classic structured header and action groups while keeping the new global mode switch compact
- **Edge Dock tests** cover heading levels, live preview windowing, hover delay, hover-only state, touch activation, viewport clamping, cleanup isolation, and nested panel removal

---

## [0.8.1] - 2026-05-18

### 🚀 Added
- **MAIN world script for SPA navigation safety**
  - New `page-url-hook.js` injected into page's MAIN world to wrap `history.pushState`/`replaceState`
  - Dispatches custom `toc:urlchange` events for URL monitoring, avoiding direct History API monkey-patching from content script

### 🔧 Changed
- **URL monitor uses custom events** instead of directly wrapping History API methods
  - No longer overwrites `history.pushState`/`history.replaceState` from the content script context
  - Safe on sites like ChatGPT that heavily modify the History API
- **Mutation debounce tuning**: DEBOUNCE_MS 500→400ms, MAX_DYNAMIC_DEBOUNCE_MS 1000→1800ms for faster initial response and better burst handling
- **Build script** now copies `page-url-hook.js` to dist and removes existing zip before packaging

### 🐛 Fixed
- **Button type safety**: All dynamically created `<button>` elements now explicitly set `type="button"` to prevent unintended form submission

### ⚡ Technical Improvements
- **Navigation safety test suite**: Added Node.js tests in `checks/navigation-safety.test.mjs` covering URL monitor, page hook, button types, and rebuild timing

---

## [0.8.0] - 2026-05-15

### 🚀 Added
- **ES Modules architecture with esbuild bundling**
  - Migrated entire content script from monolithic `utils.js` and global namespace injection to standard ESM `import`/`export`
  - esbuild bundles `src/content.js` into a single IIFE at build time — no runtime load-order concerns
- **Build system**
  - Added `build.js` with esbuild bundling, syntax validation, and dist packaging
  - Build produces `dist/build/` with runtime files and `dist/packages/v{version}.zip`
- **Modular architecture**
  - Split monolithic `utils.js` (1126 lines) into 11 focused utility modules in `src/utils/`
  - Split `mutation-observer.js` into 3 focused modules: `dom-watcher.js`, `url-monitor.js`, `rebuild-scheduler.js`
  - Added standalone `nav-lock.js` module for navigation lock state
  - Added `event-bus.js` for decoupled module communication
  - Added `focus-trap.js` shared utility
  - Extracted `floating-panel-helpers.js` from floating panel
- **URL change monitoring**
  - History API interception (`pushState`/`replaceState`) with polling fallback for SPAs
- **CSS custom properties theming**
  - Replaced duplicated light/dark CSS rules with CSS custom properties (`--toc-bg-panel`, etc.)
- **CI/CD release workflow**

### 🔧 Changed
- **Module system evolution**: Global namespace → custom `define()`/`require()` → standard ESM
- **Storage primitives**: Single ESM source file; build produces separate IIFE bundle for background service worker
- **Constants consolidation**: Scattered `uiConst()` calls consolidated into per-file `CFG` objects
- **Dynamic nav lock duration**: Adjusts lock time based on scroll distance

### 🐛 Fixed
- **Dark theme**: Not applying to Selector Generated and Site Configuration overlays
- **Repeated context invalidation notices**: Prevented `ctxInvalidatedNotice` on every rebuild
- **Service worker**: Fixed `importScripts` path for dual-context storage primitives
- **Rebuild scheduler**: Fixed disconnect via `handle.disconnect()` in `start()`

### ⚡ Technical Improvements
- **Tiered visibility filtering**: Three-phase check with short-circuit at item limit — cheap DOM checks first, then style/geometry, then parent clipping
- **O(n) Set-based dedup**: Replaced sort-based deduplication in `uniqueInDocumentOrder`
- **Shared storage primitives**: Extracted to single source, eliminating context duplication

---

## [0.7.1] - 2026-05-07

### 🐛 Fixed
- **CSS injection idempotency**
  - Removes prior CSS injection before re-inserting to prevent duplicate styles on repeated enable/reinject cycles
- **Per-origin action click lock**
  - Changed from global boolean to per-origin Set, allowing simultaneous enable/disable on different sites
- **Pending intent migrated to per-origin map**
  - Supports multi-origin recovery with 60s expiry cleanup and legacy format compatibility
- **Visibility style `!important` consistency**
  - Panel and badge visibility now uses `setProperty(..., 'important')` and `removeProperty` to resist host page style overrides
- **Element picker event propagation**
  - Added `stopPropagation` and `stopImmediatePropagation` to click and contextmenu handlers
- **Event target null guards**
  - Added null guards for `e.target.closest` in element picker and floating panel
- **Disposed state check after async gap**
  - Added second `disposed` check after async `getConfigs()` in content.js main()

### ⚡ Technical Improvements
- **`getSessionMap` return validation**
  - Validates return value is a non-array object to prevent corruption errors
- **Startup pending intent recovery**
  - Runs `recoverPendingIntent` on startup to recover incomplete toggle operations

---

## [0.7.0] - 2026-05-07

### 🚀 Added
- **Touch and pen drag support**
  - Migrated drag system from mouse events to pointer events for touchscreen and stylus support
  - Added `touch-action: none` on collapsed badge to prevent page scroll during drag
- **Namespace attribute for extension elements**
  - Added `data-toc-owner` attribute to all extension UI elements to avoid conflicts with host page elements
- **Incremental panel updates**
  - Added `updateItems` method to update only changed TOC items during rebuild, avoiding full re-renders
- **Write-ahead intent log**
  - Saves intent before storage writes to prevent data loss from MV3 service worker hibernation
- **Serialized storage writes**
  - All storage writes serialized through a queue to prevent TOCTOU race conditions
- **Rebuild circuit breaker**
  - Tracks consecutive rebuild failures and cools down after threshold to prevent infinite rebuild loops
- **Context invalidated refresh link**
  - Added clickable "Refresh Page" link in extension context invalidated notice

### 🔧 Changed
- **Render function refactored to options object**
  - Changed `renderFloatingPanel` from 14 positional parameters to an options object
- **Constants consolidated into per-file CFG objects**
  - Consolidated scattered `uiConst()` calls into centralized `CFG` objects across all modules
- **MutationObserver starts unconditionally**
  - No longer checks selector validity before starting, always observes for improved SPA support
- **`pendingRebuild` changed from boolean to counter**
  - Prevents lost rebuild requests during high-frequency DOM changes
- **Parallel tab processing**
  - Changed to `Promise.allSettled` for parallel tab processing
- **Dynamic debounce tuning**
  - Reduced exponent from 1.5 to 1.3 and cap from 2000ms to 1000ms for faster TOC updates on active pages
- **Added `alarms` permission**
  - Uses `chrome.alarms` instead of `setInterval` for background scheduled tasks
- **CSS selector validation no longer executes DOM queries**
  - Removed `querySelector` fallback validation to avoid side effects

### 🐛 Fixed
- Escape in element picker no longer collapses TOC panel
- **Badge position drift**
  - Removed position save from `expand()` to prevent cumulative drift
- Panel header buttons not responding to clicks
- Element picker highlight uses `position:fixed` for correct scroll tracking
- CSS escape polyfill handles digit-after-hyphen correctly
- Floating panel roving tabindex, removalObserver, scroll fallback, user-selected tracking
- Background service worker double-toggle, double-click race, alarm reset
- Config write error handling, null guard, mutation debounce reset
- toc-app rebuild race, expand flicker, active state restoration
- Content script cleanup hooks and deduplicated expand/collapse logic
- Rebuild loop correctly stops after `destroy()`
- Prevent double-registration in `addWindowListener` signal fallback
- Drag cancel no longer saves position
- Reset `__TOC_APP_LOADED__` in `destroy()` to allow re-enable without page reload

### ⚡ Technical Improvements
- **Batch layout reads**
  - Refactored `isElementVisible` into `batchCollectVisibility` with one synchronous layout pass instead of per-element queries
- **In-memory caches**
  - Added in-memory caches for panel expanded state and badge position to reduce storage reads
- **removalObserver optimization**
  - Narrowed to `document.body` `childList`-only instead of full subtree observation
- **Config dirty flag**
  - Skips config storage reads during rebuild unless config has changed
- **Module dependency validation**
  - Added load-time dependency checks to all modules with clear error logging when missing
- **IntersectionObserver entry buffering**
  - Buffers entries during RAF throttle instead of dropping, preventing lost scroll positions
- **Per-selector match limit**
  - Added limit on `querySelectorAll` results per selector to prevent page freeze on broad selectors
- **i18n completion**
  - Added new i18n keys for context invalidation, storage errors, and quota pruning

---

## [0.6.3] - 2026-03-15

### 🐛 Fixed
- **Silent handling for invalidated extension context**
  - Storage write failures from old content script no longer log errors after extension reload
  - Context invalidation is expected behavior; refreshing the page restores functionality
  - Only quota-related errors are still logged

---

## [0.6.2] - 2026-03-14

### 🐛 Fixed
- **Syntax error fixes**
  - Fixed missing closing parenthesis in `background.js` onRemoved listener
  - Fixed missing closing parenthesis in `toc-app.js` Promise.race
- **CSS injection timing issue**
  - Reverted to dynamic CSS injection to prevent page layout issues caused by static injection
  - CSS is now only injected when extension is enabled, not on all pages
- **Content script initialization timing**
  - Added DOM stability wait to ensure TOC initializes after page rendering is complete

### 🔧 Changed
- **MutationObserver improvements**
  - Added dynamic debounce mechanism that increases debounce time for frequent changes
  - Increased rebuild loop delay from 0ms to 16ms to reduce main thread contention
- **Timer management**
  - Unified timer management into `timers` object
  - Increased persist delay from 160ms to 500ms to reduce storage I/O frequency
- **Rebuild timeout protection**
  - Added 5-second timeout protection to prevent rebuild from hanging indefinitely

---

## [0.6.1] - 2026-02-05

### 🔄 Changed
- **Resize positioning strategy**
  - On window resize, badge/panel snaps horizontally to anchored edge (left/right)
  - Vertical position scales with viewport height ratio

### 🛠 Fixed
- Fixed collapse/expand alignment mismatch after resize
- Fixed runtime `anchorX` initialization ReferenceError on some pages
- Prevented right-anchored badge from jumping to the left edge when shrinking the window

---

## [0.6.0] - 2026-02-05

### 🚀 Added
- **Navigation lock failsafe mechanism**
  - Added 8-second timeout auto-unlock to prevent navigation lock from getting stuck
  - Improved active state restoration logic
- **Animation frame management**
  - Added requestAnimationFrame scheduling and cleanup mechanism
  - Enhanced resource cleanup on component destruction
- **Storage quota management**
  - Added automatic storage quota management (max 400 keys)
  - Prompts user for confirmation when storage quota is reached
  - Added quota exceeded warning messages
- **Icon update queuing**
  - Added queuing mechanism to prevent icon flicker on rapid updates
  - Enhanced cross-tab icon state synchronization

### 🔧 Changed
- **Error handling and retry logic**
  - Refactored config manager with enhanced error handling and retry logic
  - Added `mutateConfigsWithRetry` for configuration mutation verification
  - Added utility functions for quota detection and pruning
- **Enhanced drag-and-drop**
  - Improved drag state management and cleanup
  - Added automatic drag end when element disconnected
- **Keyboard interaction**
  - Enhanced keyboard interaction handling for badge component
- **Element picker**
  - Improved focus management and cleanup logic
- **Wildcard matching**
  - Optimized wildcard matching performance and reliability

### 🐛 Fixed
- Fixed potential race conditions in configuration deletion
- Fixed MutationObserver cleanup logic
- Fixed event listener leaks in floating panel and element picker

### ⚡ Technical Improvements
- Added navigation lock timeout constant
- Added icon update state tracking to prevent concurrent updates
- Enhanced cleanup of event listeners and animation frames
- Enhanced toast notification removal logic
- Added safer JSON parsing and selector validation
- Enhanced badge and panel rendering to prevent duplicates
- Improved error handling in drag helper

---

## [0.5.2] - 2026-02-03

### 🐛 Fixed
- **Fixed page jumping**
  - Fixed page jumping issue during auto-refresh
  - Fixed rebuild triggering when TOC is empty causing page jumps
- **Rebuild optimization**
  - Added rebuild state flag to prevent IntersectionObserver interference
  - Optimized rebuild logic to skip unnecessary rebuilds (empty content, identical content, badge mode)
  - Ensured rebuild flag is properly reset in all code paths

### ⚡ Technical Improvements
- Added `window.TOC_APP.isRebuilding()` API to check rebuild state
- IntersectionObserver now skips active state updates during rebuild
- Improved error handling to ensure rebuild flag resets correctly in exceptional cases

---

## [0.5.1] - 2026-02-03

### 🔧 Changed
- **Rendering logic optimization**
  - Prevented duplicate initialization for improved stability
  - Optimized state management, reduced code redundancy
- **Enhanced interaction experience**
  - Smooth panel expand/collapse transition animations
  - Improved position synchronization between TOC button and panel
  - Enhanced drag interaction for smoother operation

### ⚡ Technical Improvements
- Added CSS styles for transition animations
- Improved component lifecycle management and event listener cleanup
- Code refinement and optimization

---

## [0.5.0] - 2026-02-03

### 🚀 Added
- Draggable floating panel header for repositioning
- Position synchronization between panel and TOC button when collapsing/expanding
- Right-side positioning support for both panel and TOC button
- Panel position storage (`tocPanelPosMap`)
- Enhanced element visibility detection with computed styles, bounding rects, and parent clipping checks
- Injection failed notification with retry option
- Localization fallback for missing translation keys

### 🔧 Changed
- **Content script injection method refactored**
  Changed from static declaration in manifest.json to dynamic injection via `chrome.scripting.executeScript` in background.js
- Added `scripting` permission for content script injection
- Optimized element filtering logic in TOC builder
- Streamlined CSS selector utility functions
- Improved error handling and fallback for storage operations
- Enhanced TOC button position management with dedicated storage key

### ⚡ Technical Improvements
- Detect CSS hidden properties
- Detect zero-width/zero-height elements
- Detect parent overflow clipping
- Detect detached DOM elements

---

## [0.4.1] - 2026-01-23

### 🔧 Changed
- Modernized storage APIs to Promise-based style
- Improved error handling across storage operations

### 🐛 Fixed
- Icon toggle state now properly uses Promise-based `chrome.action` API

---

## [0.4.0] - 2026-01-22

### 🚀 Added
- Selector deletion functionality in configuration dialog
- Improved dialog handling and UI feedback

### 🔧 Changed
- Improved robustness and error handling across core components
- Enhanced event handling and memory management

---

## [0.3.0] - 2026-01-15

### 🚀 Added
- Dark mode support for TOC panel
- Localized extension title messages

### 🔧 Changed
- Improved error handling and UI feedback across components

---

## [0.2.0] - 2026-01-15

### 🚀 Added
- Internationalization (i18n) support
- Default Chinese (`zh_CN`) locale
- Localized messages and UI elements
- Per-site enable/disable UI functionality
- Site-level enable/disable toggle with persistent state

### 🔧 Changed
- Switched from `chrome.storage.sync` to `chrome.storage.local` for per-site configuration
- Updated icon colors to blue theme
- Added floating TOC overlay UI components

---

## [0.1.1] - 2025-09-15

### 🐛 Fixed
- Fixed bugs and stability issues from initial release
- Improved error handling and UI feedback
- Enhanced event handling and memory management

---

## [0.1.0] - 2025-09-14

### 🚀 Added
- Initial release
- Basic TOC generation from webpage headings
- Floating panel with interactive navigation
- Custom selector configuration (CSS/XPath)
- Collapsed TOC button mode
- Element picker for selector creation
- Per-site configuration storage
- Auto-rebuild on DOM mutations
