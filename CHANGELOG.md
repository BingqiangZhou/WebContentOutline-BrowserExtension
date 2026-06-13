# Changelog

All notable changes to the Web TOC Assistant extension will be documented in this file.

**[中文版本 / Chinese Version](CHANGELOG_CN.md)**

[Table of Contents](#table-of-contents) • [Latest](#1111---2026-06-13)

---

## Table of Contents

- [1.11.1](#1111---2026-06-13) - 2026-06-13
- [1.11.0](#1110---2026-06-13) - 2026-06-13
- [1.10.0](#1100---2026-06-13) - 2026-06-13
- [1.9.0](#190---2026-06-13) - 2026-06-13
- [1.8.0](#180---2026-06-13) - 2026-06-13
- [1.7.0](#170---2026-06-13) - 2026-06-13
- [1.6.2](#162---2026-06-08) - 2026-06-08
- [1.6.1](#161---2026-06-07) - 2026-06-07
- [1.6.0](#160---2026-06-07) - 2026-06-07
- [1.5.1](#151---2026-06-06) - 2026-06-06
- [1.5.0](#150---2026-06-06) - 2026-06-06
- [1.4.0](#140---2026-06-06) - 2026-06-06
- [1.3.1](#131---2026-06-06) - 2026-06-06
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

## [1.11.1] - 2026-06-13

A bug-fix release: the outline no longer loses its upper entries after scrolling a long page and clicking a lower item.

### 🐛 Fixed
- **Outline lost items above the viewport after navigating** — On a long page scrolled down (e.g. after clicking a lower TOC entry), a rebuild could drop headings that were simply scrolled out of view, so the upper part of the outline vanished. The offscreen visibility filter now uses document coordinates instead of viewport coordinates, so legitimately scrolled headings are kept while truly hidden ones (positioned at -9999px) are still filtered out.
- **No more forced rebuild on every click** — Clicking a TOC item no longer triggers a full outline rebuild a second later when nothing changed; only a rebuild actually deferred during navigation is flushed. (This per-click rebuild was the trigger that exposed the item-loss bug above.)

---

## [1.11.0] - 2026-06-13

A compatibility and stability release: the extension's UI now paints above high-z-index page overlays so it stays interactive on pages that also run translation or reader extensions, the outline reliably refreshes on highly dynamic/streaming pages, and Agnes AI conversations are now detected automatically.

### 🚀 Added
- **Agnes AI (app.agnes-ai.com) detection** — Chat conversations on Agnes are now detected automatically and turned into an outline of user prompts, joining ChatGPT, Claude, Gemini, DeepSeek, and the other supported chatbot platforms.

### 🐛 Fixed
- **Dock/panel frozen on pages with high-z-index overlays** — On sites that also run a translation or reader extension (or any high-z-index overlay), the edge dock and panel could appear frozen — hover did nothing, the menu wouldn't open, and the empty state never showed. The shadow host now carries a top-level z-index so the extension UI always paints above page overlays.
- **Outline freezing under continuous DOM mutation** — On highly dynamic pages (e.g. an actively streaming chat combined with a translation extension rewriting text nodes), the rebuild debounce could be reset forever and the outline would stick on its last-rendered state. A max-wait deadline now guarantees a rebuild fires within a bounded interval.

### ⚡ Technical Improvements
- **Centralized `MAX_Z_INDEX`** — The maximum z-index is now a single constant in `src/utils/constants.ts`, shared by the shadow host and the element-picker highlight (previously duplicated).
- **Scheduler teardown consolidation** — All rebuild-scheduler teardown paths now clear both timers through `clearScheduledTimers()`, closing a leak where the max-wait timer could outlive an invalidated extension context.

---

## [1.10.0] - 2026-06-13

A reliability and usability release: host access is once again requested at install time (reverting the per-site optional-permission model introduced in 1.8.0), and the TOC is now **enabled by default on every website** — it appears automatically, with per-site disable via the toolbar.

### 🔧 Changed
- **Host access is required again (reverts 1.8.0's optional per-site model)** — The extension once more requests broad host permissions at install time. Enabling a site is now a single toolbar click with no permission prompt, and there is no per-origin grant that can be lost or revoked. This fixes cases where the TOC silently failed to appear on sites the user had enabled.
- **TOC enabled by default on every website** — The extension now shows the table of contents automatically on any page with headings, with no per-site setup. The toolbar click now toggles a site off/on (opt-out per site); previously each site had to be enabled individually.

### ⚠️ Note for existing users
- Updating from 1.8.0/1.9.0 is a **permission increase**: Chrome will prompt you to approve broader host access, and the extension may be disabled until you accept. After accepting, your enabled sites work as before — one click each.

---

## [1.9.0] - 2026-06-13

A CSS-isolation and robustness release: the extension's UI now runs inside a Shadow DOM so host-page styles can no longer break it, outline generation reaches into shadow-DOM content regions, permission and SPA-navigation handling is hardened, and the intended visual styling is restored.

### 🔧 Changed
- **UI now runs inside a Shadow DOM** — The floating panel, edge dock, toasts, and dialogs mount inside a single open shadow root, so host-page CSS can no longer override or leak into the extension's UI. Styles load via a constructable stylesheet with no flash of unstyled content. This replaces the old light-DOM `all: unset` defense with structural isolation.

### 🚀 Added
- **Shadow-aware content-region detection** — The content-region detector now descends into open shadow roots, so the outline is built from the correct region on sites that render their main content into shadow trees.

### 🐛 Fixed
- **Permission revocation & SPA navigation** — Per-site enable state now reconciles correctly when host access is revoked via Chrome's site-permissions UI, and content-script reinjection is hardened across SPA navigations and service-worker restarts.
- **Restored 1.6.2 visual styling** — Re-added the per-element UA reset that the shadow migration had dropped, so TOC entries and dock menu items render in the intended font/spacing/radius again instead of browser-default button styling.

### ⚡ Technical Improvements
- Removed the now-redundant dom-watcher owned-filter (the UI is shadow-isolated from the mutation observer).
- Simplified the codebase: removed dead code/exports/branches and unused imports/params; extracted shared helpers (shadow-root traversal, overlay-dialog builder, selector-list normalizer).
- Hardened the bespoke vm-eval test harness (fixed the export-block strip regex; added loaders for the new shared helpers).

---

## [1.8.0] - 2026-06-13

A performance and accessibility release, plus a privacy improvement: host access is now requested per-site instead of up front, and generating the outline no longer blocks the page.

### 🔧 Changed
- **Per-site host access is now optional** — The extension no longer asks for broad host permissions at install time. Access is requested per-origin, in the toolbar-click gesture, only when you enable a site (stricter least-privilege; cleaner install).
- **Outline generation no longer blocks the page** — TOC building is now asynchronous and yields to the main thread in batches, with superseded builds cancelled. Long pages and chatbot streaming stay responsive; the generated outline is unchanged.

### 🚀 Added
- **Accessibility for the panel and dock** — Keyboard focus now moves into the outline when the panel is opened via keyboard; the dock toggle uses the correct `button` role; the settings menu supports arrow-key navigation and focuses the first item on open; the active outline item is marked `aria-current`; preview-line animation respects `prefers-reduced-motion`; muted-text contrast meets WCAG AA.

### ⚡ Technical Improvements
- **Chatbot detection caches negative results** per URL — non-chatbot pages no longer re-run the ARIA/data/structure DOM probe on every rebuild.
- **Long outline lists render faster** via `content-visibility: auto` (off-screen items are skipped).
- **Robustness** — hardened content-script bootstrap, unified listener cleanup, a typed message protocol, and removed `any` from the app core.
- **Smaller bundle** — removed an unused heading-weight constant, an unused barrel re-export, and 16 unused locale keys.
- **Attribution** — the README now documents the referenced libraries (Smart TOC, Boilerpipe, W3C ARIA).

---

## [1.7.0] - 2026-06-13

A capability and robustness release for the auto table-of-contents extraction pipeline: the TOC now works on Shadow DOM, iframe, and ARIA-heading sites, plus many extraction, chatbot, scroll, and dynamic-content fixes. No new permissions or breaking changes.

### 🚀 Added
- **Shadow DOM and iframe support** — Heading collection now traverses open shadow roots and same-origin iframes (bounded; hidden/zero-size iframes are skipped), so the TOC appears on component-based sites and iframe-embedded content that previously showed nothing.
- **ARIA heading support** — Elements using `role="heading"` with `aria-level` are now collected and leveled correctly (previously ignored; non-`h*` tags collapsed to level 2).

### 🐛 Fixed
- **Hidden child text no longer leaks into headings** — Standard-path text extraction now excludes `aria-hidden` / `.sr-only` descendants (anchor glyphs, screen-reader labels), matching the chatbot path.
- **Custom selectors are scoped to the content region** — User-defined selectors no longer pull in nav/footer headings.
- **Content-region negative-word matching no longer over-rejects** — Switched from substring to whole-token matching, fixing false kills like "ad" inside "thread" / "read" / "shadow".
- **Repeated same-named sections are preserved** — Identical-text headings are only collapsed when they are mirror copies at the same position; legitimately repeated titles (multiple "References" / "Notes") are kept.
- **Chatbot user messages no longer duplicated** — A user selector matching both a wrapper and its inner content no longer renders each message twice.
- **Chatbot detection is stable across rebuilds** — The internally-injected sentinel no longer disables the chatbot path on subsequent rebuilds (previously caused AI replies to disappear and stray entries to appear).
- **User-defined selectors are honored on chat pages** — Custom selectors now take priority over the built-in chatbot detection.
- **Circuit breaker self-recovers** — After 5 consecutive failures the TOC no longer freezes permanently; it recovers via a 30s probe and an immediate reset on navigation.
- **Stable TOC after SPA navigation** — The URL-change rebuild is now debounced (no longer reads pre-swap DOM) and the DOM-watcher scope is recomputed, so chatbot↔regular-page transitions no longer miss updates or double-rebuild.
- **Scroll-to-item lands below the actual header** — The offset now samples the real fixed/sticky overlay via `elementsFromPoint`, fixing headings hidden under non-semantic or container-nested headers (e.g. Trae). The gap was also tightened so headings sit just below the top edge.
- **Parked rebuild retries on nav-lock release** — A rebuild deferred during user navigation now runs promptly when the lock releases.
- **Removed the heading-level proportionality filter** — Documents using all six levels no longer have legitimate h4/h5/h6 dropped.
- **Icon/glyph-only headings are dropped** — Lone "#", "¶", etc. no longer appear as TOC entries.

### ⚡ Technical Improvements
- **Streaming debounce resets on SPA navigation** — `_lastAssistantTextLen` is cleared on chatbot cache invalidation so the 1200ms debounce does not mis-report on a new page.
- **Deterministic cross-root element ordering** — `uniqueInDocumentOrder` tiebreaks disconnected nodes (shadow/iframe roots) by source index instead of relying on sort stability.
- **Broad-selector rejection is surfaced** — An over-broad user selector now logs a debug message instead of silently yielding an empty TOC.
- **TOC identity check compares heading level** — `isTocContentIdentical` now includes `level`, so an `aria-level` change triggers a rebuild.
- **DeepSeek hint selectors deduplicated** — The two identical DeepSeek hint blocks now share one constant.
- **Test coverage expanded** — Added 12 test files; the suite now has 148 passing tests.

---

## [1.6.2] - 2026-06-08

### 🐛 Fixed
- **DeepSeek chatbot page detection and TOC extraction** — Updated detection to use stable `.ds-message` / `.ds-markdown` selectors, fixing empty TOC on DeepSeek pages. Added walk-up logic from `.ds-markdown` to parent `.ds-message` so AI response headings are correctly discovered.
- **Gemini and DeepSeek screen reader label leakage** — Screen reader labels like "You said" and "Gemini said" (hidden via `.cdk-visually-hidden` clip-path technique) were appearing in the TOC. Added `getVisibleText()` helper that clones elements and strips visually-hidden descendants, and `closest()` check to skip heading elements that are themselves visually hidden.

### ⚡ Technical Improvements
- **Chatbot discovery source tracking** — All 8 chatbot discovery strategies now report a `source` field, enabling confidence scoring bonuses for framework-specific detection and improving diagnostic logging.
- **Dead code removal in text extraction** — Removed unreachable `textEl = null` initialization and `if (!textEl)` guard in `extractUserText()`.

---

## [1.6.1] - 2026-06-07

### 🐛 Fixed
- **Config change notification broken after re-enable** — Removed `clearOnConfigChanged()` call in `destroy()` that permanently cleared the callback, preventing TOC rebuilds when config changed after a disable→re-enable cycle. The `_activeRebuild` null guard already prevents stale rebuilds safely.
- **Dead code cleanup and type safety** — Removed orphaned `panel-expanded` storage path, dead imports (`debounce` in edge-dock, unused CSS function in floating-panel), and fixed unsafe `as number` cast on `activeIndex` to use proper type narrowing.

---

## [1.6.0] - 2026-06-07

### 🔄 Changed
- **Remove Classic UI mode** — Removed the legacy Classic floating panel and collapsed badge, keeping Edge Dock as the only UI mode. Simplifies the codebase by removing ~891 lines (2 source files, 149 lines of CSS, 16 i18n strings, UI mode switching logic).
- **Centralize constants and eliminate duplicate code** — Extracted shared helpers (`originKey`, `resolveNonUiElement`, `getMeaningfulClasses`), centralized magic numbers into `constants.ts`, fixed all `undefined as any` type bypasses, moved `originFromUrl` to shared primitives.
- **Redesign store promotional assets** — Rebuilt all Chrome Web Store images (small promo, marquee, screenshot cover) following official best practices: saturated backgrounds, full-bleed layouts, minimal text, brand-first design.

### 🐛 Fixed
- Shorten English locale description to 132 chars for Chrome Web Store compliance.

---

## [1.5.1] - 2026-06-06

### 🔧 Internal
- **Codebase simplification** — Removed ~200 lines of unnecessary defensive code across 30+ files:
  - Removed dead import guards (`typeof fn === 'function'`, `if (importedFunc)`) for statically imported ES modules
  - Removed unnecessary `try/catch` around non-throwing DOM APIs (`el.remove()`, `observer.disconnect()`, `cancelAnimationFrame`, `e.preventDefault()`, `replaceChildren()`, etc.)
  - Removed dead code branches (platform checks for APIs available since Chrome 26–86, fallback branches for `replaceChildren`, redundant `else` branches)
  - Removed redundant null guards for always-defined variables (`AbortController`, `createDragController`, `createFocusTrap`)
  - Unified shared helpers (`normalizeSide`, `isTocContentIdentical`) replacing inline duplicate logic
  - Deleted 2 unnecessary files (`nav-lock.ts`, `floating-panel-helpers.ts`) — inlined into consumers
  - Simplified storage try/catch nesting and circuit breaker complexity
- **Content script bundle** reduced from 95.27 kB to 94.85 kB
- No user-facing changes — behavior is identical to v1.5.0

---

## [1.5.0] - 2026-06-06

### 🚀 New Features
- **TOC source indicators** — Visual source markers distinguish different types of TOC items:
  - **Chatbot pages**: User prompts are marked with a blue left-side indicator; AI response headings have no indicator
  - **Regular pages with custom selectors**: Items from user-configured selectors are marked with a green left-side indicator; auto-detected h1-h6 items have no indicator
  - Edge dock preview lines also use source-aware coloring (blue for user prompts, green for custom selectors)

---

## [1.4.0] - 2026-06-06

### 🔧 Changed
- **Toolbar-toggle model** — Reverted always-on standby dock to the original per-site toolbar icon toggle. Blue icon = enabled, gray icon = disabled. When disabled, the extension is completely invisible — no standby dock, no UI
- **Smaller edge dock button** — Collapsed edge dock button reduced from 48×48 to 40×40 for a more subtle appearance
- **Chatbot detection improved** — More accurate chatbot page detection and content region analysis

### 🐛 Fixed
- **Re-enable bug** — Fixed critical issue where TOC and dock wouldn't reappear after disabling and re-enabling a site. Root cause: CSS was removed on disable but never re-injected on re-enable (ensureContentScript skips injection when ping succeeds). CSS is now never removed on disable — it's inert when no matching DOM elements exist

---

## [1.3.1] - 2026-06-06

### 🚀 New Features
- **Chatbot page detection** — Automatically recognizes ChatGPT, Claude, Gemini, DeepSeek, Kimi and other chatbot pages, generates conversation-turn-based TOC
- **Automatic content region detection** — Intelligently identifies the main content area of a page, filters out navigation bars, sidebars, and footers for more accurate TOC headings

### ⚡ Performance Optimizations
- **Reorder geometry checks** — Cheap `offsetWidth`/`offsetHeight` checks run before expensive `getComputedStyle`, reducing style recalculation calls by ~60%
- **Single-pass ancestor scan** — Parent clipping check rewritten from O(depth²) to O(depth)
- **Chatbot matching optimization** — Fixed O(N×M) assistant matching with forward cursor, now O(N+M)
- **Active item tracking** — Linear min-scan instead of sort, O(n) instead of O(n log n)
- **Diff-based IntersectionObserver updates** — Only unobserve/observe changed elements instead of full disconnect/re-observe
- **Edge-dock preview** — Incremental active class toggle instead of full DOM re-render
- **Keyboard navigation** — Use `dataset.index` lookup instead of `querySelectorAll` per keypress
- **DOM clearing** — Use `replaceChildren()` instead of N× `removeChild`

### 🔧 MV3 Best Practices
- **Cached storage reads** — Pre-fetched enabled map passed to `updateIconForTab`, eliminating O(n) storage reads in `processAllTabs`
- **Single storage read in `tabs.onActivated`** — Was double-read, now reads once
- **Per-tab injection lock** — Prevents concurrent double-injection race between `tabs.onActivated` and `tabs.onUpdated`
- **Scroll caches** — `detectFixedHeaderHeight` cached with 5s TTL; `prefers-reduced-motion` cached to avoid `matchMedia` per click

### 🔧 Internal Improvements
- **TypeScript strict mode** — Enabled `strict: true` across the entire codebase, adding explicit type annotations to all source files for stronger type safety and earlier error detection
- **Test infrastructure** — Replaced fragile regex-based TypeScript syntax stripping with the TypeScript compiler API (`ts.transpileModule`) for reliable test execution
- **Cross-platform compatibility** — Fixed test file paths on Windows using `fileURLToPath`, added CRLF-aware patterns throughout the test suite

### 🔧 CI/CD
- **Pre-release support** — GitHub Actions workflow now detects pre-release tags (e.g. `v1.3.0-pre`, `v1.3.0-beta.1`) and sets `prerelease: true` accordingly

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
