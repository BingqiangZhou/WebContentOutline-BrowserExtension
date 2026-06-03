No user account or login is required. The extension works immediately after installation.

## Testing Steps

1. Open a content-heavy page (e.g. https://en.wikipedia.org/wiki/Google).

2. Click the extension icon in the browser toolbar. The transparent white-document icon turns black (enabled), and a small badge appears at the right edge of the viewport.

3. Hover over the badge to expand the Table of Contents panel. Click any TOC item to scroll to that section. The active heading is highlighted as you scroll.

4. Click the badge again to disable — the icon turns gray and the badge disappears.

5. Per-site toggle: The extension can be enabled/disabled independently on each website. State persists across page reloads.

## Key Features to Verify

- Auto-generated TOC from page headings (h1–h6)
- Custom CSS/XPath selectors via the element picker (gear icon → settings)
- Edge Dock and Classic UI modes (gear icon → settings → UI mode)
- Collapse/expand panel, vertical dock repositioning by dragging
- Works on SPA sites (URL changes are detected automatically)

## Permissions Justification

- storage: Per-site enabled state and user preferences
- tabs: Determine active tab URL for per-site logic
- scripting: Inject content script dynamically
- host_permissions (http/https): Read DOM headings and render floating UI. No data is collected, transmitted, or sent externally. Zero outbound network requests.

## Dependencies

None. The extension is fully self-contained with no external services, APIs, or accounts.
