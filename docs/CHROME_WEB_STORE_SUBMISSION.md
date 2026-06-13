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
3. tocBadgePosMap — per-host dock position, so the edge dock remembers where the user last dragged it.

All data is stored locally on the user's device. No data is sent to any external server or third party.
```

## tabs justification *

```text
The "tabs" permission is required to read the URL of the active tab (via chrome.tabs.get, chrome.tabs.query, and the tab.url property in event listeners). The extension uses the tab's origin (e.g., "https://example.com") as a lookup key to remember the user's per-site preference. The TOC is enabled by default on every website; the user can disable it for a specific site, and that preference is remembered by origin. This enables two core behaviors: (1) setting the correct toolbar icon state when the user switches tabs — the transparent white-document mark in black for sites where the TOC is active (the default) and gray for sites the user has disabled — and (2) automatically injecting the content script into http(s) tabs where the TOC is active, while skipping sites the user has disabled.
```

## scripting justification *

```text
The "scripting" permission is required to dynamically inject the extension's WXT-built content script (`content-scripts/toc.js`) and stylesheet (`content-scripts/toc.css`) into web pages via the Chromium scripting API. The injected content script scans the page DOM for heading elements, builds an interactive table of contents, renders the floating navigation UI (sidebar, badge, panel), and implements scroll-tracking and click-to-scroll navigation. The TOC is enabled by default on every website, so the content script is injected into http(s) pages on page load to provide a seamless experience; the user can disable the TOC for a specific site via the toolbar, and on disabled sites nothing is injected. The extension also removes the injected stylesheet when a user disables the TOC for a site. No code is fetched from or sent to any remote server; all injected code is bundled within the extension package.
```

## Host permission justification *

```text
The extension declares broad host access as REQUIRED ("host_permissions": "http://*/*" and "https://*/*"), granted at install time. This is necessary because the extension's single purpose — generating an interactive table of contents from a page's headings — requires reading the DOM and injecting a content script on whatever http(s) page the user chooses to use it on. The user cannot know in advance which sites they will want a TOC for, so host access must be available across all web pages rather than restricted to a fixed list. The extension only reads/injects on sites the user has explicitly enabled via the toolbar toggle (a per-site preference stored locally); on all other sites nothing is read or injected.

Why broad required host permissions rather than "activeTab":
"activeTab" grants only transient, single-tab access that expires on navigation, so the TOC could not reappear automatically on subsequent visits to an enabled site (the extension's core value). Broad host permissions let the extension honor the user's per-site enable/disable choice on every page load and tab activation without repeated clicks.

Why broad required host permissions rather than optional per-origin grants:
Earlier versions (1.8.0–1.9.0) used optional per-origin host permissions requested at runtime. This caused reliability problems: the per-origin grant could be lost or revoked, after which the extension silently failed to appear on sites the user had enabled. Required host permissions eliminate that failure point, so an enabled site reliably shows the TOC.

The extension does not collect, transmit, or store any page content, personal data, or browsing history on any remote server. All DOM processing happens locally in the user's browser.
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
| `tocBadgePosMap` | Map of hosts to {x, y} coordinates | Remember the dragged position of the edge dock per site |

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
| `http://*/*`, `https://*/*` (host_permissions) | Broad host access granted at install, so the extension can read the DOM and inject its content script on any http(s) page the user enables via the toolbar toggle. Applied only on user-enabled sites; nothing is collected or transmitted |

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
