## Page Instructions

To facilitate the compliance of your extension with the Chrome Web Store Developer Program Policies, you are required to provide the information listed below. The information provided in this form will be shared with the Chrome Web Store team. Please ensure that the information provided is accurate, as it will improve the review time of your extension and decrease the risk of this version being rejected.

## Single purpose

### Left panel instructions

An extension must have a single purpose that is narrow and easy-to-understand. Learn more

### Single purpose description *

```text
Automatically generates an interactive floating table of contents (TOC) for web pages by scanning DOM heading elements, allowing users to quickly navigate long-form content through a sidebar outline with click-to-scroll, active heading tracking, and per-site customization.
```

## Permission justification

### Left panel instructions

A permission is either one of a list of known strings, such as "activeTab", or a match pattern giving access to one or more hosts. Remove any permission that is not needed to fulfill the single purpose of your extension. Requesting an unnecessary permission will result in this version being rejected.

### Warning

```text
Due to the Host Permission, your extension may require an in-depth review which will delay publishing.
```

## storage justification *

```text
The "storage" permission is used to persist user preferences locally in chrome.storage.local. Specifically, it stores five categories of data, all of which remain on the user's device and are never transmitted externally:

1. tocSiteEnabledMap — per-site (origin) enable/disable state, so the extension remembers whether the user has activated the TOC for a given website.
2. tocConfigs — per-site selector configurations (CSS/XPath expressions and display side), saved when users customize which elements to include in the TOC via the built-in element picker.
3. tocPanelExpandedMap — per-site panel expanded/collapsed state, so the TOC panel restores its last open/closed position on revisit.
4. tocBadgePosMap — per-host floating badge position, so the collapsed TOC button remembers where the user last dragged it.
5. tocUiMode — global UI mode preference ("edge-dock" or "classic"), so the user's chosen layout style persists across sessions.

All data is stored locally on the user's device. No data is sent to any external server or third party.
```

## tabs justification *

```text
The "tabs" permission is required to read the URL of the active tab (via chrome.tabs.get, chrome.tabs.query, and the tab.url property in event listeners). The extension uses the tab's origin (e.g., "https://example.com") as a lookup key to determine whether the user has previously enabled or disabled the TOC for that specific website. This enables two core behaviors: (1) setting the correct toolbar icon state when the user switches tabs, using the 1.0 transparent white-document mark in black for enabled sites and gray for disabled sites, and (2) automatically injecting the content script into tabs where the user has previously enabled the extension, without requiring a repeated manual click.
```

## scripting justification *

```text
The "scripting" permission is required to dynamically inject the extension's WXT-built content script (`content-scripts/toc.js`) and stylesheet (`content-scripts/toc.css`) into web pages via the Chromium scripting API. The injected content script scans the page DOM for heading elements, builds an interactive table of contents, renders the floating navigation UI (sidebar, badge, panel), and implements scroll-tracking and click-to-scroll navigation. Injection occurs only on sites where the user has explicitly enabled the extension by clicking the toolbar icon. For previously enabled sites, the script is injected on page load to provide a seamless experience. The extension also removes the injected stylesheet when a user disables the TOC for a site. No code is fetched from or sent to any remote server; all injected code is bundled within the extension package.
```

## Host permission justification *

```text
The extension requires broad host permissions ("http://*/*" and "https://*/*") to inject its content script into any webpage the user chooses to enable it on, for the purpose of scanning the DOM for heading elements and generating the interactive table of contents.

Broad host permissions are strictly necessary instead of "activeTab" for two core reasons:

1. Automatic Availability on Enabled Sites: The extension's primary value is providing a seamless, always-ready TOC experience. Once a user enables the extension for a site, the floating TOC button and navigation should appear automatically on subsequent page loads and navigations within that site. Using "activeTab" would require the user to manually click the extension icon on every single page visit, fundamentally breaking this automatic behavior.

2. Per-Site Preference Enforcement: The extension stores per-origin enable/disable preferences in local storage. To apply these preferences immediately when a page loads or a tab is activated, the extension must have host-level access to determine whether to inject the content script before any user interaction occurs.

The extension does not collect, transmit, or store any page content, personal data, or browsing history on any remote server. All data processing happens entirely within the user's browser.
```

### Right panel hint

```text
A host permission is any match pattern specified in the "permissions" and "content_scripts" fields of the extension manifest
```

## Are you using remote code?

### Options

- [x] No, I am not using remote code
- [ ] Yes, I am using remote code

### Right panel hint

```text
Remote code is any JS or Wasm that is not included in the extension's package. This includes references to external files in <script> tags, modules pointing to external files, and strings evaluated through eval()
```

---

## Privacy & Data Use Disclosure

### Does your extension collect or transmit user data?

No. The extension does not collect, transmit, or share any user data with external servers or third parties.

### What data does your extension store locally?

The extension stores only user preference data in chrome.storage.local on the user's device:

| Storage Key | Data Description | Purpose |
|---|---|---|
| `tocSiteEnabledMap` | Map of website origins to boolean (enabled/disabled) | Remember which sites the user has enabled the TOC for |
| `tocConfigs` | Per-site CSS/XPath selector configurations and display side | Persist custom element selectors chosen via the element picker |
| `tocPanelExpandedMap` | Map of website origins to boolean (expanded/collapsed) | Restore the TOC panel's last open/closed state per site |
| `tocBadgePosMap` | Map of hosts to {x, y} coordinates | Remember the dragged position of the collapsed TOC button per site |
| `tocUiMode` | String: "edge-dock" or "classic" | Persist the user's preferred UI layout mode |

### Does your extension use analytics or tracking?

No. The extension contains no analytics, telemetry, or tracking code of any kind.

### Does your extension make any network requests?

No. The extension makes zero outbound network requests. It does not use fetch(), XMLHttpRequest, sendBeacon(), or any other network API.

### What permissions does your extension use and why?

| Permission | Justification |
|---|---|
| `storage` | Persist user preferences locally (enable/disable state, selector configs, UI state) |
| `tabs` | Read tab URLs to look up per-site enable/disable state and set the correct toolbar icon |
| `scripting` | Inject the bundled content script and stylesheet into pages where the user has enabled the extension |
| `http://*/*`, `https://*/*` | Allow injection on any website the user chooses to enable the TOC for, with automatic activation on revisits |

---

## Store Visual Assets

Generated with `npm run assets:brand`.

| Asset | Path |
|---|---|
| Extension icons | `icons/png/toc-{enabled,disabled}-{16,32,48,128}.png` |
| Brand mark SVGs | `docs/brand/web-toc-assistant-mark-{enabled,disabled}.svg` |
| Small promotional tiles | `docs/brand/chrome-web-store-small-promo-{en,zh-CN}.png` |
| Marquee promotional tiles | `docs/brand/chrome-web-store-marquee-{en,zh-CN}.png` |
| Screenshot cover images | `docs/brand/store-screenshot-cover-{en,zh-CN}.png` |
