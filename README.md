# Web TOC Assistant

[![License](https://img.shields.io/TOC button/license-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/TOC button/Chrome-Extension-green.svg)](https://chromewebstore.google.com/detail/fnicpbioofepnfgpdhggjmhjalogbgcn)
[![Edge Extension](https://img.shields.io/TOC button/Edge-Extension-blue.svg)](https://microsoftedge.microsoft.com/addons/detail/jejjhfkmfdlccdbifpihkepaabcdlijc)
[![Manifest V3](https://img.shields.io/TOC button/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)

**[English](README.md)** | [中文](README_CN.md)

A web table of contents generator that automatically creates interactive floating TOC for any website to enhance reading experience.

<p align="left">
  <img src="dist/descriptions/Gemini_Generated_screenshots1280x800.png" alt="Web TOC Assistant Screenshot" width="800"/>
</p>

## ✨ Key Features

### 🎯 TOC Generation
- **Default Header Recognition**: Automatically uses page header structure (h1-h6 tags) when no selectors are configured
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
- **Floating Panel**: Expandable TOC panel with left/right side display support
- **Draggable Panel**: Drag the panel header to reposition; position is automatically saved
- **Draggable Button**: Collapsed "TOC" button supports drag positioning
- **Position Memory**: Remembers panel and button position per domain, synchronizes positions when collapsing/expanding
- **Smooth Scrolling**: Smooth scroll to content when clicking TOC items

### 🔄 Navigation Experience
- **Current Position Highlighting**: Automatically highlights the TOC item corresponding to current reading position (IntersectionObserver)
- **Navigation Locking**: Locks highlighting during user clicks to prevent jumping
- **State Recovery**: Automatically restores highlight state after page changes
- **Anti-Jump Mechanism**: Prevents page jumping during auto-refresh and rebuilds

### ⚙️ Site Configuration Management
- **Wildcard Matching**: URL pattern matching with wildcard support (e.g., `https://example.com/*`)
- **Local Storage**: Configuration and site enable state saved to `chrome.storage.local`
- **Config Management**: View and clear site configurations
- **Multi-selector Support**: Configure multiple CSS/XPath selectors per site

### 🌐 Multi-site Control
- **Per-site Enable/Disable**: Independent control for each website
- **Icon Status Indicator**: Enabled = blue icon, Disabled = gray icon
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
2. Open Chrome browser and navigate to `chrome://extensions/` or Edge browser to `edge://extensions/`
3. Enable "Developer Mode"
4. Click "Load unpacked" and select the project folder
5. Visit any webpage to start using

### Basic Operations

#### 1. Enable/Disable Extension

**How**: Click the "Web TOC Assistant" icon in the browser toolbar

**Effect**:
- Enabled state: Icon turns blue, "TOC" floating button appears on page
- Disabled state: Icon turns gray, floating button disappears
- Sync effect: Other tabs of the same site automatically sync state

#### 2. Expand TOC Panel

**How**: Click the "TOC" floating button on the page

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
2. Click "Pick Element" button
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

**How**: Click "Manage Saves" button in the TOC panel

**Functions**:
- View all configurations for current site
- Clear current site configuration
- View URL matching rules

#### 6. Adjust Button and Panel Position

**How**:
- Drag the "TOC" floating button to any position
- Drag the panel header to any position when expanded

**Effect**:
- Button and panel remember current position (saved per domain)
- Automatically restores on page refresh or next visit
- Positions synchronize when collapsing/expanding
- Uses default position if saved position is out of viewport

#### 7. Refresh TOC

**How**: Click "Refresh" button in the TOC panel

**When to use**:
- After dynamic page content changes
- When suspecting TOC is inaccurate

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

#### Draggable Panel
**How**: Click and drag the panel header to reposition

**Effect**:
- Panel position is automatically saved per domain
- Position syncs with TOC button position when collapsing/expanding
- Cursor changes to indicate draggable state

## 🛠️ Technical Implementation

### Project Structure

```
├── manifest.json              # Manifest V3 configuration
├── icons/                     # Extension icons
│   ├── png/                   # PNG icons (16/32/48/128)
│   │   ├── toc-enabled-*.png  # Enabled state icons
│   │   └── toc-disabled-*.png # Disabled state icons
│   └── svg/                   # SVG source files
├── _locales/                  # Internationalization
│   ├── en/
│   │   └── messages.json      # English translation
│   └── zh_CN/
│       └── messages.json      # Chinese translation
├── src/
│   ├── background.js          # Background service worker
│   ├── content.js             # Content script entry
│   ├── content.css            # Content script styles
│   ├── utils.js               # Utility functions
│   ├── README.md              # Technical documentation
│   ├── utils/                 # Utility modules
│   │   ├── css-selector.js   # CSS selector generation
│   │   └── toc-builder.js    # TOC building logic
│   ├── ui/                    # UI components
│   │   ├── collapsed-TOC button.js    # Collapsed button
│   │   ├── element-picker.js     # Element picker
│   │   └── floating-panel.js     # Floating panel
│   └── core/                  # Core logic
│       ├── config-manager.js     # Configuration management
│       ├── mutation-observer.js  # Page change observer
│       └── toc-app.js            # Main application logic
├── CLAUDE.md                  # Claude Code development guide
└── README_EN.md               # Chinese version (中文版)
```

### Core Technologies

- **Runtime**: Edge/Chrome browser (Chromium-based)
- **Extension Standard**: Manifest V3
- **Language**: Vanilla JavaScript + CSS3 (No build system)
- **Storage**: `chrome.storage.local` API
- **Permissions**: `storage`, `tabs`, `scripting`
- **Host Permissions**: `http://*/*`, `https://*/*`

### Architecture

**Modular Design**: 10 module files loaded in dependency order
- Layer 1: `utils.js` - Base utilities
- Layer 2: `utils/css-selector.js`, `utils/toc-builder.js` - Utility modules
- Layer 3: `ui/collapsed-TOC button.js`, `ui/element-picker.js`, `ui/floating-panel.js` - UI components
- Layer 4: `core/config-manager.js`, `core/mutation-observer.js`, `core/toc-app.js` - Core logic
- Layer 5: `content.js` - Entry point

**Global Namespace**: All modules expose APIs via `window` object
- `window.TOC_UTILS` - Base utilities
- `window.CSS_SELECTOR` - Selector generation
- `window.TOC_BUILDER` - TOC building
- `window.TOC_UI` - UI components
- `window.CONFIG_MANAGER` - Configuration management
- `window.MUTATION_OBSERVER` - DOM observation
- `window.TOC_APP` - Main application

### Key Algorithms

- **Element Deduplication**: Uses `compareDocumentPosition` to maintain DOM order
- **Hidden Element Filtering**: Checks `display:none`, `visibility:hidden`, `opacity:0`, zero dimensions
- **Debounced Rebuild**: MutationObserver + 500ms debounce to avoid frequent updates
- **Selector Generation**: Prioritizes class selector, falls back to path selector
- **Navigation Lock**: Locks IntersectionObserver during user clicks to prevent jumping

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
      ],
      "collapsedDefault": false
    }
  ],
  "tocSiteEnabledMap": {
    "https://example.com": true,
    "https://another.com": false
  },
  "tocPanelExpandedMap": {
    "https://example.com": true
  },
  "tocBadgePosMap": {
    "example.com": { "left": 100, "top": 200, "right": 180 }
  },
  "tocPanelPosMap": {
    "example.com": { "left": 100, "top": 200, "right": 380 }
  }
}
```

**Field Description**:
- `urlPattern`: URL matching pattern with `*` wildcard support
- `side`: Panel display position (`left` or `right`)
- `selectors`: Selector array, supports mixing CSS and XPath
- `collapsedDefault`: Default collapsed state
- `tocBadgePosMap`: Badge position storage per domain (includes `left`, `top`, `right`)
- `tocPanelPosMap`: Panel position storage per domain (includes `left`, `top`, `right`)

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

### Q: Button position wrong or missing?
**A:**
1. Drag button to appropriate position, it auto-saves
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

### No Build System
This project uses pure vanilla JavaScript with no build tools:
- Edit files directly
- Reload extension after modifying `manifest.json`
- Refresh page after modifying content scripts to see changes

### Debugging
1. **Background Page**: Click "Service Worker" at `edge://extensions/` to view background logs
2. **Content Script**: Press F12 on target webpage to view Console logs
3. **Storage View**: View `chrome.storage.local` in DevTools > Application > Storage

### Adding New Features
1. Create new file in appropriate module directory
2. Update load order in `manifest.json`
3. Expose API via global namespace
4. Import in dependent modules

For detailed technical documentation, see [`src/README.md`](src/README.md) and [`CLAUDE.md`](CLAUDE.md).

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork this project
2. Create feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -m 'Add new feature'`
4. Push branch: `git push origin feature/new-feature`
5. Create Pull Request

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and updates.

---

**If this project helps you, please give it a ⭐ Star!**
