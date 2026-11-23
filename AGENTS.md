# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, etc.) when working with code in this repository.

## Project Overview

Web TOC Assistant (网页目录助手) is a Manifest V3 browser extension that automatically generates interactive floating table of contents for any webpage using DOM element detection.

**Key characteristics:**
- WXT-managed Manifest V3 architecture with runtime-registered content scripts
- Vanilla TypeScript and CSS built by WXT/Vite
- All-in-one CSS with `!important` to resist host page interference
- Per-site enable/disable state stored in `chrome.storage.local`

## Installation and Development

**Do not develop directly on `main`.** Use the `dev` branch for ongoing development, or create feature branches (e.g. `feature/foo`) from `dev` for isolated work. The `main` branch is reserved for releases only.

**Build & packaging**: Run `npm run build` to typecheck, run Vitest, and build with WXT. For release packaging, use `npm run release:build` which also zips the extension into `.output/` (filename includes branch suffix for non-main branches). Load `.output/chrome-mv3` in Developer Mode; the project root contains source files and is not a runnable unpacked extension directory.

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
Automated checks use Vitest: run `npm run test`. Suites live in `checks/**/*.test.mjs` (see `vitest.config.ts`) as plain `.mjs` files — static source assertions plus `node:vm` sandbox evaluation of production modules; shared helpers in `checks/test-helpers.mjs`. Prefer executing the real module in a sandbox over asserting on source text when both are possible. CI (`.github/workflows/ci.yml`) runs `npm run build` — typecheck, tests, WXT build — on every push to `dev`/`main` and on pull requests. Manual browser smoke testing is still required for extension behavior.

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
            ├── utils/toc-builder.ts → dom-utils.ts, content-region.ts, chatbot-detector.ts
            ├── ui/shadow-root.ts (single shared closed Shadow DOM root + CSS injection)
            ├── utils/dom-utils.ts → ui/shadow-root.ts (closed-root accessor for cleanupOwnedElements)
            ├── ui/edge-dock.ts, ui/element-picker.ts, ui/floating-panel.ts
            ├── ui/overlay-dialog.ts (shared .toc-overlay dialog) → focus-trap.ts
            ├── core/config-manager.ts → ui/overlay-dialog.ts
            ├── core/rebuild-scheduler.ts → dom-watcher.ts, url-monitor.ts, chatbot-detector.ts
            ├── core/active-item-tracker.ts (shared reading-position observer)
            └── core/nav-lock.ts (createNavLock + onUnlock)
```

Background script and options page:
```
entrypoints/background.ts
  └── src/shared/primitives.ts, src/shared/messages.ts

entrypoints/options/main.ts
  └── src/shared/messages.ts
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
- Manages per-site opt-in enable state in `chrome.storage.local` → `tocSiteEnabledMap` (only an explicit `true` entry enables a site; absent means disabled)
- Updates extension icon (enabled=blue, disabled=gray)
- Injects `content-scripts/toc.js` via `browser.scripting` (only that file: the content script fetches `content-scripts/toc.css` itself — `cssInjectionMode: 'ui'`, web-accessible — into its shadow root)
- Cross-tab synchronization for same origin
- Message handling goes through the centralized `TOC_MESSAGE` protocol in `src/shared/messages.ts` (discriminated union with typed payloads — add new message types there, never as raw literals)
- Binds every state-changing message to its sender: a content script may only change the state and the config of its own site; one of the extension's own pages (the options page) may name any. The distinction is `isFromExtensionPage()` — decided by the sender document's URL, never by `sender.tab`, which an options page opened in a tab has too

**`entrypoints/options/`** - Options page (extension page)
- Lists the per-site opt-in state from `tocSiteEnabledMap` and the selector configs from `tocConfigs`; site-level actions stay available via the toolbar icon on the page itself
- Follows storage while open (`storage.onChanged` re-renders a list, returning keyboard focus to the same row) — the toolbar icon and the in-page config dialog change it behind the page's back. Each list renders under a generation: a render that is still awaiting storage gives way when a newer one starts, so overlapping renders (a storage event plus the page's own refresh) cannot duplicate rows
- Writes only through the background (`PERSIST_ACTIVE_STATE`, `MUTATE_CONFIG` `clear-site`), so its changes are serialized with the in-page dialog's. A refused write is reported and the list is put back to the stored state

**`src/content.ts`** - Content script bootstrap
- Checks site enable state on load
- Imports `initForConfig` from `core/toc-app.ts` via ESM (using WXT-compatible `.js` import specifiers in source)
- Sets up reinjection guard and cleanup hooks
- Message listeners via `TOC_MESSAGE` from the same shared protocol module
- Disabling the site takes the whole shadow host down — nothing of the extension stays in the page; the next enable recreates it. UI that arrives after that teardown (a toast or dialog whose request was in flight across the disable) is dropped, never mounted into the page's own DOM: the `?? document` fallback at the mount points is for "no root could be created", not for a torn-down root (`isTocShadowRootTornDown()`)

### Core Subsystems

**1. Site Enable/Disable System (`entrypoints/background.ts`)**
- Storage: `chrome.storage.local` → key: `tocSiteEnabledMap`
- Maps origin → boolean; opt-in semantics — a site runs only with an explicit `true` entry (absent/`false` = disabled, the toolbar icon writes the entry)
- Dynamic icon switching based on state
- Message broadcast to all tabs of same origin

**2. Configuration Management (`core/config-manager.ts`)**
- Storage: `chrome.storage.local` → key: `tocConfigs`
- Per-site URL pattern matching (wildcards supported)
- Selector management (CSS/XPath)
- Config change notification via callback pattern (`setOnConfigChanged` / `_onConfigChanged`)
- No dock `side` in a config: the dock's side is the per-host position the dock saves itself in `tocBadgePosMap.anchorX`. A `side` left in a stored config by an older version is dropped when the config is read
- Selector validation has two copies that must refuse and allow exactly the same expressions: `isSafeXPathExpression()` in `utils/core-utils.ts` (content, shown as "Invalid selector" in the dialog) and `isHighRiskBroadXPathExpression()` in `shared/primitives.ts` (background, which would otherwise answer a bare "Operation failed"). XPath refused: a bare descendant star (`//*`, `.//*`, `//*/*`), everything under `html`/`body` (`//html/*`, `//body/*`), and the explicit descendant axis (`descendant::*`). XPath allowed: a star with a predicate (`//*[@id='main']//h2`). CSS: only an exact broad selector (`*`, `html *`, `body *`, `:root *`) is refused. `checks/stability-performance.test.mjs` pins the parity of the XPath copies

**3. TOC Building Pipeline (`utils/toc-builder.ts`)**
```
Selectors (CSS/XPath)
  → collectBySelector() → DOM Elements
  → uniqueInDocumentOrder() → Deduplicate via compareDocumentPosition
  → Filter hidden/empty elements
  → Map to TOC items {id, el, text}
```
User selectors run inside the detected content region and are retried against the whole page only when the region has no match (an element picked in the sidebar). A list holding only the chatbot sentinel is not retried, and neither is the automatic heading path.

**4. UI State Management (`core/toc-app.ts`)**
- Uses nav-lock from `core/nav-lock.ts` (createNavLock with onUnlock hook)
- Active item restoration after rebuild
- Pending rebuild queue (processes after navigation unlock; the floating panel flushes it through the scheduler with `setPendingRebuild(true)`)
- Component lifecycle coordination with `destroy()` cleanup

**5. Dynamic Content Updates**
Split into three focused modules:
- `core/dom-watcher.ts` — MutationObserver-based DOM change detection; with no selectors only heading-touching changes count, and the selector list is read live through `getSelectors()` (the chatbot sentinel is pushed into it after `start()`)
- `core/url-monitor.ts` — URL change detection: the Navigation API (`navigatesuccess`, Chromium 102+) when present, otherwise popstate/hashchange with History API wrapping, plus a polling fallback
- `core/rebuild-scheduler.ts` — Coordinates both with debouncing, nav-lock (received via opts), a half-open recovery probe, and circuit breaker (pauses after 5 consecutive failures). It also knows when toc-app is running a rebuild it started itself (`isRebuildInFlight`: hover-expand, the Refresh button, a config change) and parks a request that lands during one until toc-app reports `notifySettled()` — dispatching into it would only join it and lose the request

**6. Config Change Notification**
- Callback pattern via `setOnConfigChanged()` in `core/config-manager.ts`
- `toc-app.ts` registers a callback that triggers a TOC rebuild when configs change in storage
- A `refreshConfig()` that lands while a rebuild is in flight queues exactly one follow-up rebuild

### Storage Schema

```javascript
// chrome.storage.local
{
  "tocConfigs": [
    {
      urlPattern: "https://example.com/*",
      selectors: [
        { type: "css", expr: "h1, h2, h3" },
        { type: "xpath", expr: "//*[@id='main']//h2" }
      ]
    }
  ],
  "tocSiteEnabledMap": {
    "https://example.com": true,
    "https://another.com": false
  },
  "tocBadgePosMap": {
    "example.com": { "x": 1920, "y": 300, "anchorX": "right" }
  }
}
```

`tocSiteEnabledMap` is opt-in: only an explicit `true` entry enables a site; an absent entry (or explicit `false`) means disabled.

## Defensive Programming Patterns

1. **Error boundaries**: try/catch around all chrome API calls

2. **Cleanup hooks**: `destroy()` methods on toc-app, rebuild-scheduler for full teardown

3. **CSS isolation**: All UI mounts in one Shadow DOM root; `:host { all: initial }` plus a per-element `all: unset` reset; styles also use `!important`

## CSS Architecture (`entrypoints/toc.content/style.css`)

- All UI mounts inside a single **closed** Shadow DOM root (`ui/shadow-root.ts`); the CSS is fetched at runtime and loaded via a constructable stylesheet (`adoptedStyleSheets`, with a `<style>` fallback) — host-page CSS cannot reach the extension's UI, and page scripts cannot reach it either (`host.shadowRoot` is `null`). Extension code reads the root through `getTocShadowRootSync()`, never through `.shadowRoot`
- `:host { all: initial }` defends inherited properties at the shadow boundary; a per-element `all: unset` reset neutralizes browser UA defaults on buttons/textareas
- CSS custom properties for light/dark theming (driven by `prefers-color-scheme`)
- Per-element reset: `.toc-floating, .toc-floating *, .toc-edge-dock, .toc-edge-dock * { all: unset !important; }` (the site-config dialog's own controls get theirs in separate rules, since a `<select>`/`<input>` must keep its native border and arrow)
- Styles also use `!important` as a secondary defense
- The reduced-motion block (`@media (prefers-reduced-motion: reduce)`) MUST stay the last block: it has the same specificity as the component rules that set the transitions and only wins by coming later
- Components: edge dock, floating panel, overlay dialogs, buttons

## Key Algorithms

**Element deduplication**: Uses `compareDocumentPosition` to maintain DOM order

**Hidden element filtering**: Checks `display:none`, `visibility:hidden`, `opacity:0`, zero dimensions, overflow clipping

**Selector generation** (`utils/css-selector.ts`):
- Priority: class-based selector
- Fallback: path selector with nth-of-type

**Navigation lock**: Prevents IntersectionObserver from interfering during user clicks on TOC items. Auto-unlocks after 1 s (`NAV_LOCK_MS`; the panel may unlock earlier on scroll-stop).

**Rebuild scheduling** (`core/rebuild-scheduler.ts`):
- Fixed debounce: 400ms (normal), 1200ms (during streaming), with circuit breaker after 5 consecutive failures
- Max wait: a rebuild always fires within 3 s of the first pending mutation (`MAX_REBUILD_WAIT_MS`), so a continuous mutation stream cannot postpone it forever
- Circuit breaker: pauses after 5 consecutive failures; self-recovers via a half-open probe every 30s and an immediate reset on URL change (so a transient failure burst never permanently freezes the TOC)
- A request that lands while a rebuild is in flight is re-dispatched once that rebuild succeeds — not while the tab is hidden, the nav-lock is held or the breaker is tripped (each has its own recovery path), and never right after a failed rebuild

## Manifest V3 Specifics

- `permissions`: ["storage", "scripting"] (no `tabs` — the host permissions below already expose `tab.url` for the http(s) tabs the extension touches)
- `host_permissions`: ["http://*/*", "https://*/*"]
- `default_locale`: "en" - i18n support; user-facing strings must be added to BOTH `public/_locales/en/messages.json` and `public/_locales/zh_CN/messages.json`
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
- Floating panel: `ui/floating-panel.ts` (title-free TOC card rendering, inline helpers)
- Edge dock: `ui/edge-dock.ts` (edge toolbar, live outline preview, hover preview, pinned state, vertical dragging)
- Active item tracker: `core/active-item-tracker.ts` (shared reading-position observer for collapsed and expanded states)
- Element picker: `ui/element-picker.ts` (hover highlighting, click selection)

### Adding new storage keys
Use `chrome.storage.local` - follow existing patterns in `utils/storage.ts` for storage wrappers. Add the key name to `STORAGE_KEYS` in `utils/constants.ts`.

### Per-site state changes
Use `tocSiteEnabledMap` for enable/disable, `tocConfigs` for selectors, `tocBadgePosMap` for the dock's side and vertical position per host

### Building and packaging
Run `npm run build` to:
1. Run TypeScript typecheck
2. Run Vitest
3. Build the WXT chrome-mv3 extension

For release packaging, run `npm run release:build` which also zips the extension into `.output/`.

## Working Documents

The `docs/superpowers/` directory (design specs) and its `docs/superpowers/plans/` subdirectory (implementation plans) hold local-only working documents generated by agent skills. These files are excluded from git via `.gitignore` — do NOT commit them. These directories are created on demand and may not exist when no active working documents are present.

## Project Skills

Two project skills live in `.claude/skills/`: `release` (full release pipeline — pre-flight, version bump, changelog, build, tag, push) and `description` (bilingual Chrome/Edge store listing generation). Prefer invoking them for those tasks instead of improvising the steps manually.
