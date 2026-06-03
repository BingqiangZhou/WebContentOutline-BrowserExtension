No user account or login is required to test this extension. It functions immediately upon installation.

## Testing Instructions

1. **Navigate to a structured webpage:** Visit any long article, documentation page, or a Wikipedia entry (e.g., https://en.wikipedia.org/wiki/Google).

2. **Activate:** Click the extension icon in the browser toolbar. The toolbar icon turns from gray (disabled) to blue (enabled), and an Edge Dock badge appears at the right edge of the page.

3. **Interact:** Hover over the Edge Dock badge to expand the Table of Contents panel. Click any TOC item to scroll to that section. The active heading is highlighted as you scroll.

4. **Settings:** Toggle the "Enable on this site" switch in the extension popup menu. All preferences are stored locally via `chrome.storage.local`.

## Permissions Note

The extension uses host permissions solely to scan the DOM for heading elements (h1–h6) and to render the floating navigation UI. No data is collected, transmitted, or sent to any remote server. The extension makes zero outbound network requests.

For a full permission justification and privacy disclosure, see `docs/CHROME_WEB_STORE_SUBMISSION.md`.
