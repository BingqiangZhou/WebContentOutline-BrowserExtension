# Web TOC Assistant

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://chromewebstore.google.com/detail/fnicpbioofepnfgpdhggjmhjalogbgcn)
[![Edge Extension](https://img.shields.io/badge/Edge-Extension-blue.svg)](https://microsoftedge.microsoft.com/addons/detail/jejjhfkmfdlccdbifpihkepaabcdlijc)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)

**[English](README.md)** | [中文](README_CN.md)

A web table of contents generator that automatically creates interactive floating TOC for any website to enhance reading experience.

<p align="left">
  <img src="docs/brand/store-extension-intro-en.png" alt="Web TOC Assistant" width="800"/>
</p>

## ✨ Key Features

### 🎯 TOC Generation
- **Default Header Recognition**: Automatically uses page header structure (h1-h6 tags) when no selectors are configured
- **Automatic Content Region Detection**: Intelligently identifies the main content area of a page, filtering out navigation bars, sidebars, and footers for more accurate TOC headings
- **Chatbot Page Detection**: Automatically recognizes ChatGPT, Claude, Gemini, DeepSeek, Kimi and other AI chatbot pages, generating conversation-turn-based TOC
- **Enhanced Visibility Detection**: Advanced element filtering using computed styles, bounding rects, and parent clipping detection to ensure only truly visible elements are included
- **Automatic Filtering**: Automatically filters hidden elements (display:none, visibility:hidden, opacity:0), zero-size elements, and overflow-clipped content
- **Custom Selectors**: Supports CSS and XPath selectors to adapt to various website structures
- **Real-time Updates**: Automatically regenerates TOC when page content changes (500ms debounce)

### 🎪 Visual Element Picker
- **Hover Highlighting**: Real-time highlighting of target elements as you move your mouse
- **One-click Selector Generation**: Automatically generates CSS selector when you click an element
- **Config Saving**: Saves selectors as site-specific configurations
- **Automatic Exclusion**: Automatically excludes extension's own UI elements

### 📍 Flexible UI Interaction
- **Edge Dock**: Detached circular settings entry plus a compact TOC preview on the left or right edge
- **Live Outline Preview**: Collapsed TOC bars reflect heading levels, highlight the current reading position, and navigate directly when clicked
- **Hover Preview**: Hover over the outline bars to expand the TOC inward; moving away restores the bars automatically
- **Vertical Dragging**: Drag the dock up and down with mouse, touch, or stylus
- **Position Memory**: Remembers dock side and vertical position per domain and constrains the dock after window resize
- **Smooth Scrolling**: Smooth scroll to content when clicking TOC items

### 🔄 Navigation Experience
- **Current Position Highlighting**: Automatically highlights the TOC item corresponding to current reading position (IntersectionObserver)
- **Navigation Locking**: Locks highlighting during user clicks to prevent jumping
- **Navigation Lock Failsafe**: Auto-unlocks after timeout if stuck
- **State Recovery**: Automatically restores highlight state after page changes
- **Anti-Jump Mechanism**: Prevents page jumping during auto-refresh and rebuilds

### ⚙️ Site Configuration Management
- **Wildcard Matching**: URL pattern matching with wildcard support (e.g., `https://example.com/*`)
- **Local Storage**: Configuration and site enable state saved to `chrome.storage.local`
- **Config Management**: View and clear site configurations
- **Multi-selector Support**: Configure multiple CSS/XPath selectors per site

### 🌐 Multi-site Control
- **Per-site Enable/Disable**: Independent control for each website
- **Icon Status Indicator**: The transparent white-document toolbar icon turns black when enabled and gray when disabled
- **Cross-tab Sync**: Automatic state synchronization across tabs of the same site

## 🚀 Installation & Usage

### Installation

#### Method 1: Install from Web Store (Recommended)

1. **Chrome**: Visit [Chrome Web Store](https://chromewebstore.google.com/detail/fnicpbioofepnfgpdhggjmhjalogbgcn)
2. **Edge**: Visit [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/jejjhfkmfdlccdbifpihkepaabcdlijc)
3. Click "Add to Chrome/Edge" to install
4. Visit any webpage to start using

#### Method 2: Load Unpacked Extension (Developer Mode)

1. Download project files to your local machine
2. Run `npm run build` from the project root
3. Open Chrome browser and navigate to `chrome://extensions/` or Edge browser to `edge://extensions/`
4. Enable "Developer Mode"
5. Click "Load unpacked" and select the `.output/chrome-mv3` folder
6. Visit any webpage to start using

### Basic Operations

#### 1. Enable/Disable Extension

**How**: Click the "Web TOC Assistant" icon in the browser toolbar

**Effect**:
- Enabled state: The transparent white-document icon turns black, and the edge-docked TOC toolbar appears on page
- Disabled state: The transparent white-document icon turns gray, and the dock disappears
- Sync effect: Other tabs of the same site automatically sync state

#### 2. Expand TOC Panel

**How**:
- Desktop: Hover over the outline bars to expand the TOC; move away from both the bars and list to collapse it
- Touch devices: Tap the TOC area to toggle a temporary panel, then tap outside to collapse it
- Collapsed state: Click a horizontal outline bar to navigate directly without pinning the panel open

**Default Behavior**:
- Automatically recognizes h1-h6 headers on the page
- Displays floating panel on left or right side
- Shows current page content structure

#### 3. Quick Navigation

**How**: Click any item in the TOC

**Effect**:
- Smooth scroll to corresponding content
- Auto-highlight current reading position
- Support keyboard arrow keys for navigation

#### 4. Pick Element (Custom Selector)

**When to use**: Default header recognition is inaccurate, or need to identify other elements

**Steps**:
1. Expand the TOC panel
2. Click the settings icon in the edge dock, then click "Pick Element"
3. Move mouse over the page - target elements will be highlighted
4. Click the element you want to identify
5. CSS selector is auto-generated and previewed
6. Click "Save as Site Config" to save selector as current site configuration

**Notes**:
- Press ESC to cancel pick mode
- Right-click also cancels pick mode
- Auto-cancels after 20 seconds of inactivity
- Won't select extension's own UI elements

#### 5. Manage Site Configuration

**How**: Click the settings icon in the edge dock, then click "Site Configuration"

**Functions**:
- View all configurations for current site
- Clear current site configuration
- View URL matching rules

#### 6. Adjust Dock Position

**How**:
- Drag either dock icon vertically
- Use "Move to left side" or "Move to right side" in quick settings to switch edges

**Effect**:
- Dock position and side are remembered per domain
- Automatically restores on page refresh or next visit
- Keeps the dock attached to the selected edge with safe top and bottom margins
- On window resize, the vertical position is constrained to the visible viewport
- Uses default position if saved position is out of viewport

#### 7. Refresh TOC

**How**: Click the settings icon in the edge dock, then click "Refresh"

**When to use**:
- After dynamic page content changes
- When suspecting TOC is inaccurate

#### 8. Side Switching

**How**:
- Open quick settings and click "Move to left side" or "Move to right side"

**Effect**:
- The dock moves to the selected side of the viewport
- The side preference is remembered per domain

### Advanced Usage

#### URL Matching Rules

Configuration supports wildcard matching:
- Exact match: `https://example.com/page`
- Domain match: `https://example.com/*`
- Path match: `https://example.com/docs/*`

#### Multi-selector Configuration

You can configure multiple selectors for the same site:
```json
{
  "urlPattern": "https://example.com/*",
  "selectors": [
    { "type": "css", "expr": "h1, h2, h3" },
    { "type": "css", "expr": ".article-title" },
    { "type": "xpath", "expr": "//article//h2" }
  ]
}
```

#### XPath Selectors

For complex page structures, you can use XPath:
- `//article//h2` - All h2 under article
- `//*[@class='title']` - Any element with class "title"
- `//div[@id='content']//h3` - Headers within specific container

### Advanced Features

#### Edge Dock

**Effect**:
- Hover previews the TOC without changing saved expanded state
- The collapsed outline preview shows up to 12 nearby headings; deeper headings use shorter indented bars
- Clicking a collapsed outline bar navigates directly without pinning the card open
- Moving away from the bars and list restores the collapsed outline automatically
- Touch devices can temporarily toggle the card and dismiss it by tapping outside
- Quick settings expose refresh, element picker, site configuration, and side switching
- The detached circular settings button uses the extension's monochrome list mark

## 🛠️ Technical Implementation

### Project Structure

```
├── wxt.config.ts              # WXT and generated Manifest V3 configuration
├── tsconfig.json              # TypeScript configuration
├── vitest.config.ts           # Vitest configuration
├── package.json               # Node.js metadata
├── entrypoints/               # WXT extension entrypoints
│   ├── background.ts          # Background service worker entry
│   └── toc.content/           # Runtime-registered content script
│       ├── index.ts           # Content script entry
│       └── style.css          # Content script styles
├── icons/                     # Extension icons
│   ├── png/                   # PNG icons (16/32/48/128)
│   │   ├── toc-enabled-*.png  # Enabled state icons
│   │   └── toc-disabled-*.png # Disabled state icons
│   └── svg/                   # SVG source files
├── docs/brand/                # 1.0 brand assets and Chrome Web Store visuals
├── public/                    # WXT-packaged static assets (icons + _locales — single source)
│   └── _locales/              # Internationalization messages (en, zh_CN)
├── src/
│   ├── content.ts             # Content script bootstrap
│   ├── utils/                 # Utility modules
│   │   ├── constants.ts       # Storage keys, UI constants
│   │   ├── core-utils.ts      # Type checks, i18n, validation
│   │   ├── storage.ts         # Storage I/O and normalization
│   │   └── toc-builder.ts     # TOC building logic
│   ├── shared/                # Shared between contexts
│   │   └── primitives.ts      # Shared storage, config, and UI state utilities
│   ├── ui/                    # UI components
│   │   ├── edge-dock.ts       # Edge-docked toolbar and hover-only TOC state
│   │   ├── element-picker.ts  # Element picker
│   │   └── floating-panel.ts  # Shared lightweight TOC list card (inline helpers)
│   └── core/                  # Core logic
│       ├── config-manager.ts  # Configuration management
│       ├── dom-watcher.ts     # MutationObserver wrapper
│       ├── url-monitor.ts     # URL/hash change monitor
│       ├── rebuild-scheduler.ts # Rebuild scheduling & coordination
│       └── toc-app.ts         # Main application logic (inline nav-lock)
├── docs/                      # Documentation assets
│   ├── PRIVACY_POLICY.md      # Privacy policy
│   └── descriptions/          # Screenshots & store descriptions
├── CLAUDE.md                  # Claude Code development guide
└── README_CN.md               # Chinese version (中文版)
```

### Brand Assets

Run `npm run assets:brand` to regenerate the 1.0 transparent white-document icon set and bilingual Chrome Web Store visual assets. Runtime icon sources are written under `icons/` and mirrored into `public/icons/` for WXT packaging. The generated package also includes master SVG marks, 440×280 small promotional tiles, 1400×560 marquee tiles, and 1280×800 screenshot cover images under `docs/brand/`.

### Core Technologies

- **Runtime**: Edge/Chrome browser (Chromium-based)
- **Extension Standard**: Manifest V3
- **Language**: Vanilla TypeScript + CSS3 (built by WXT/Vite)
- **Storage**: `browser.storage.local` / Chromium extension storage
- **Permissions**: `storage`, `tabs`, `scripting`
- **Host Permissions**: `http://*/*`, `https://*/*` (optional — granted per-site on demand when you click the toolbar icon, revoked when disabled; no access by default)

### Architecture

**WXT + TypeScript**: WXT generates the Manifest V3 package, bundles the runtime-registered content script, and outputs the unpacked extension under `.output/chrome-mv3`.

**Content Script Dependency Graph**:
```
entrypoints/toc.content/index.ts (runtime content script)
  ├── src/content.ts (bootstrap)
  ├── src/utils/toc-utils.ts (barrel re-export of all utils)
  └── src/core/toc-app.ts (orchestrator, inline nav-lock via createNavLock())
        ├── ui/ components (edge-dock, element-picker, floating-panel)
        ├── core/config-manager.ts → focus-trap.ts
        └── core/rebuild-scheduler.ts → dom-watcher.ts, url-monitor.ts
```

**Background Script**: `entrypoints/background.ts` uses WXT's `browser` API wrapper and dynamically injects `content-scripts/toc.js` plus `content-scripts/toc.css` only for enabled origins.

**Shared Primitives**: `src/shared/primitives.ts` is imported directly by both WXT entrypoints and content modules.

### Key Algorithms

- **Element Deduplication**: Set-based O(n) dedup preserving first-occurrence order
- **Tiered Visibility Filtering**: Three-phase check — cheap DOM checks first, then style/geometry, then parent clipping — with short-circuit at item limit
- **Hidden Element Filtering**: Checks `display:none`, `visibility:hidden`, `opacity:0`, zero dimensions
- **Debounced Rebuild**: MutationObserver + fixed debounce (400ms normal, 1200ms during streaming) to avoid frequent updates
- **Selector Generation**: Prioritizes class selector, falls back to path selector
- **Navigation Lock**: Locks IntersectionObserver during user clicks to prevent jumping
- **Navigation Lock Failsafe**: Auto-unlocks after timeout (8s) if stuck
- **Animation Frame Management**: Schedules and cleans up requestAnimationFrame callbacks
- **Storage Quota Handling**: Auto-prunes old data when quota exceeded
- **Serialized Config Writes**: Applies selector changes in the background service worker with validation and serialized storage writes

## 📖 Configuration Format

Site configuration is stored in `chrome.storage.local`:

```json
{
  "tocConfigs": [
    {
      "urlPattern": "https://example.com/*",
      "side": "right",
      "selectors": [
        { "type": "css", "expr": "h1, h2, h3, h4, h5, h6" },
        { "type": "css", "expr": ".article-title, .section-header" },
        { "type": "xpath", "expr": "//article//h2[@class='title']" }
      ]
    }
  ],
  "tocSiteEnabledMap": {
    "https://example.com": true,
    "https://another.com": false
  },
  "tocBadgePosMap": {
    "example.com": { "x": 100, "y": 200 }
  }
}
```

**Field Description**:
- `urlPattern`: URL matching pattern with `*` wildcard support
- `side`: Panel display position (`left` or `right`)
- `selectors`: Selector array, supports mixing CSS and XPath
- `tocBadgePosMap`: Dock anchor position per domain (legacy key retained for compatibility; includes `x`, `y`, `anchorX`)

## 🎯 Use Cases

| Scenario | Description | Benefit |
|----------|-------------|---------|
| 📚 **Technical Docs** | Long API docs, tutorials | Quick chapter navigation, improved lookup efficiency |
| 📝 **Blog Posts** | Long articles, in-depth analysis | Clear article structure, easy skimming |
| 🌐 **Forum Threads** | Long posts, discussions | Quickly find points of interest |
| 📖 **Online Tutorials** | Step-by-step tutorials, courses | Navigate learning progress step by step |
| 🔍 **Research Materials** | Academic papers, reports | Improved information retrieval and reading efficiency |

## 🔧 FAQ

### Q: Can't see the "TOC" button?
**A:** Check the following:
1. Confirm extension is properly installed and enabled
2. Click toolbar icon to confirm current site is enabled
3. Confirm page protocol is http or https (file:// not supported)
4. Try refreshing the page

### Q: TOC is empty or inaccurate?
**A:** Extension defaults to recognizing h1-h6 tags. If page structure is special:
1. Use "Pick Element" feature to configure appropriate selectors for the site
2. Click "Refresh" to re-scan the page
3. Try using XPath selectors for more precise matching

### Q: TOC highlight jumps or out of sync?
**A:** This is normal debouncing behavior:
1. Highlight auto-corrects after scrolling stops
2. Clicking TOC items locks navigation to prevent jumping
3. Page content changes trigger re-scanning

### Q: Dock position wrong or missing?
**A:**
1. Drag the edge dock vertically to a suitable position; it auto-saves
2. Uses default position if saved position is out of viewport
3. Clearing browser cache may reset position

### Q: Configuration not taking effect?
**A:**
1. Check if URL matching rules are correct
2. Confirm selector syntax is correct
3. Try refreshing page or reloading extension

### Q: Extension not working on a specific website?
**A:**
1. Some websites may have CSP (Content Security Policy) restrictions
2. Shadow DOM usage may cause selector failures
3. Try using XPath selectors

## 🔧 Development Guide

### Build & Packaging
Source code is built by WXT:
- Edit TypeScript/CSS files directly; WXT/Vite resolves ESM imports at build time
- Run `npm run typecheck` for TypeScript validation
- Run `npm run test` for Vitest checks
- Run `npm run build` to build the extension. For release packaging, use `npm run release:build` which also creates a zip in `.output/`.
- Load `.output/chrome-mv3` in Developer Mode. The project root is source code, not a runnable unpacked extension directory.

### Debugging
1. **Background Page**: Click "Service Worker" at `edge://extensions/` to view background logs
2. **Content Script**: Press F12 on target webpage to view Console logs
3. **Storage View**: View `chrome.storage.local` in DevTools > Application > Storage

### Adding New Features
1. Create new file in appropriate module directory (`utils/`, `ui/`, `core/`, `shared/`)
2. Use `export` for the module's public API
3. `import` from the module wherever needed (WXT/Vite resolves at build time)
4. If it's a utility, consider adding to `utils/toc-utils.ts` barrel re-export

For detailed technical documentation, see [`CLAUDE.md`](CLAUDE.md).

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork this project
2. Create feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -m 'Add new feature'`
4. Push branch: `git push origin feature/new-feature`
5. Create Pull Request

## 🗺️ Roadmap

### 🔮 v2.0 — AI-Powered Smart TOC

The next major version is being planned. Core goals:

- **Remove Classic UI** — ~~Keep only Edge Dock as the single UI mode~~ *(Done — Classic UI removed)*
- **AI-Powered Content Detection** — Leverage on-device AI models to automatically identify the main content region and generate TOC, replacing manual CSS/XPath selector configuration. This eliminates the need for API keys or cloud services — all AI processing runs locally in the browser
- **Simplified UI** — Remove manual configuration UI (element picker, site config, action buttons) — the TOC panel becomes a pure navigation tool
- **Zero-Config Experience** — Install and use immediately, no setup required

> **AI Approach**: We are evaluating on-device AI options that run entirely within the browser — no API keys, no cloud services, no data leaves your machine. The specific technology choice (e.g., Chrome's built-in AI APIs, WebAssembly-based models, or other local inference approaches) is still under investigation to ensure broad compatibility and reliable performance.

📄 Detailed design document: [v2 Roadmap](docs/v2-roadmap.md)

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and updates. [中文更新日志](CHANGELOG_CN.md)

## 🙏 Acknowledgements

This project's automatic content detection stands on the shoulders of prior work. Below is what we referenced, which feature borrows it, and how we extended it.

- **[Smart TOC](https://github.com/FallenMax/smart-toc)** (FallenMax) — *Main-content detection, Layer 3 ancestor scoring (`src/utils/content-region.ts`).* We adapted Smart TOC's core idea: score each heading's ancestor elements (tag weight × distance decay, accumulated) to locate the article container. **Our extensions:** Smart TOC re-scores its top-5 candidates by `scrollHeight² / linkCount` alone; we re-score the top-5 with additional structural signals — viewport-width ratio, heading density, link-density penalty, text density, height ratio, and horizontal centering, plus a −500 penalty for `body`/`html`. We also wrap it in a 4-layer cascade (landmarks → class heuristics → ancestor scoring → whole-document fallback) rather than a single strategy, sample up to 100 headings with ancestor depth ≤ 6, and cache the result per URL with disconnect-invalidation.

- **[Boilerpipe](https://github.com/kohlschutter/boilerpipe)** (Kohlschütter et al.) — *Content-vs-navigation scoring (same Layer 3 re-scoring).* We adopted Boilerpipe's text-density finding — a text density below ~10.5 typically indicates boilerplate (nav / ads / sidebar). **Our approach:** rather than running the full Boilerpipe pipeline, we lift only this threshold as one feature among several in the candidate re-scoring, so a container must look like content across multiple signals at once.

- **[W3C ARIA](https://www.w3.org/WAI/ARIA/)** — *Detection and filtering across the codebase.* We rely on standard ARIA semantics rather than HTML tags alone: `role="log"` / `aria-live` (ARIA23) drive live-chat detection in `src/utils/chatbot-detector.ts`; `role="heading"` and `aria-level` determine TOC levels (with `aria-level` taking precedence over the tag name in `src/utils/toc-builder.ts`); `aria-hidden` and `aria-expanded` feed visibility filtering and DOM-change watching. This is standards-compliant usage (not a modified algorithm) — ARIA lets the extension read structure that heading tags can't express.

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

---

**If this project helps you, please give it a ⭐ Star!**
