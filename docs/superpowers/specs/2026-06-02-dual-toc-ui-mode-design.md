# Dual TOC UI Mode Design

## Goal

Support two complete TOC interfaces behind one global preference:

- `edge-dock`: the modern edge-docked TOC toolbar.
- `classic`: the original `0.8.1` floating badge and freely positioned panel.

Users can switch modes from either interface. The saved preference applies to
every website and defaults to `edge-dock` when no preference exists.

## Why Two Renderers

The classic and modern interfaces differ in behavior, not only appearance.
Classic mode uses a draggable text badge and a freely positioned panel with an
action toolbar. Modern mode uses an edge dock, hover peek, click pinning, and a
separate quick-settings menu.

The implementation keeps these as two renderer paths rather than adding
classic-only branches throughout the modern components. This preserves the
original interaction model and keeps the modern Edge Dock understandable.

## Global Preference

Add one storage key:

```js
tocUiMode: 'edge-dock' | 'classic'
```

Rules:

- Missing or invalid values normalize to `edge-dock`.
- The preference is stored in `chrome.storage.local`.
- The preference is global, not site-specific.
- Existing site configuration, enabled-state, expanded-state, and position
  maps remain unchanged.
- Switching mode saves the preference and rebuilds the current page UI
  immediately.

## Modern Edge Dock

Modern mode continues to use the Edge Dock interaction model:

- The settings entry is a standalone `44px` circular button.
- The circle has an `8px` gap from the page edge and does not visually connect
  to the edge.
- The icon reuses the extension TOC-list mark: three bullets and three
  horizontal lines.
- The light theme uses a white circle and black icon.
- The dark theme uses a dark gray circle and light gray icon.
- The collapsed TOC preview remains a separate hierarchical-line entry below
  the settings circle.
- Hovering or focusing the settings circle opens quick settings only.
- Hovering or focusing the TOC preview opens the TOC card only.
- The quick-settings menu adds a localized `Switch to classic mode` action.

## Classic Mode

Classic mode restores the original `0.8.1` interaction and layout:

- A blue text badge appears when the panel is collapsed.
- The badge can be dragged freely within viewport bounds.
- Clicking the badge expands a freely positioned floating TOC panel.
- The floating panel can be dragged freely within viewport bounds.
- The panel keeps the classic header, collapse entry, element picker, site
  configuration, and refresh actions.
- The panel action toolbar adds a localized `Switch to modern mode` action.

Classic styling may adopt the current font, rounded-corner, shadow, focus-ring,
and dark-mode baseline, but it must retain the original geometry and
interaction model.

## Runtime Ownership

The content-script root reads the global preference before creating TOC UI and
passes the normalized mode into the TOC application.

The TOC application owns mode switching:

1. Save the global preference.
2. Destroy the active UI instance and transient observers/listeners.
3. Reinitialize the current page with the same site configuration.
4. Create exactly one UI renderer for the selected mode.

The renderers do not decide which mode is active. They expose callbacks for
mode switching:

- Edge Dock quick settings call `onSwitchUiMode('classic')`.
- Classic panel action toolbar calls `onSwitchUiMode('edge-dock')`.

## Component Boundaries

### Storage

Add normalized helpers:

```js
getUiMode()
saveUiMode(mode)
normalizeUiMode(mode)
```

`normalizeUiMode()` returns `classic` only for the exact classic value and
returns `edge-dock` otherwise.

### Modern Renderer

Update `src/ui/edge-dock.js` and `src/content.css`:

- Render the extension list mark with CSS-friendly HTML or an inline SVG that
  is explicitly insulated from the Edge Dock reset.
- Add the mode-switch quick-settings action.
- Render a complete detached circle with an edge gap.
- Preserve the existing Edge Dock state controller.

### Classic Renderer

Restore classic-specific components from the `v0.8.1` tag as modernized
modules:

- `src/ui/classic-collapsed-badge.js`
- `src/ui/classic-floating-panel.js`
- Supporting helpers required by the classic panel.

Use class prefixes that clearly identify classic-owned DOM so cleanup,
mutation filtering, and element picking can exclude both UI modes.

### Application Orchestration

Update `src/core/toc-app.js` and `src/content.js`:

- Initialize exactly one renderer path based on the normalized global mode.
- Preserve current rebuild scheduling, picker behavior, and site config.
- Destroy one mode completely before creating the other.

## Accessibility

Modern mode:

- The settings circle remains a `button` with `type="button"`,
  `aria-haspopup="menu"`, and synchronized `aria-expanded`.
- The TOC list mark is decorative and hidden from assistive technology.
- Keyboard focus and `Escape` behavior remain supported.

Classic mode:

- The collapsed badge remains a `button`.
- Panel toolbar actions use `type="button"`.
- The mode-switch action is keyboard accessible.
- Existing focus-ring behavior remains active.

## Localization

Add English and Simplified Chinese strings for:

- `Switch to classic mode`
- `Switch to modern mode`

## Testing

Add tests for:

- Missing or invalid `tocUiMode` values normalize to `edge-dock`.
- `classic` round-trips through global storage.
- Edge Dock quick settings expose the classic switch callback.
- Classic panel toolbar exposes the modern switch callback.
- Runtime orchestration initializes exactly one renderer path.
- Switching destroys old DOM before creating new DOM.
- Cleanup, DOM watcher, and element picker exclusions include both modern and
  classic UI ownership classes.
- Extension-created buttons explicitly use `type="button"`.
- Modern settings entry uses a detached `44px` circle and extension list mark.
- Existing Edge Dock state-controller tests remain green.
- Existing navigation, rebuild, packaging, and version tests remain green.

Run:

```bash
npm run build
node --test checks/*.test.mjs
git diff --check
node --check src/ui/edge-dock.js
node --check src/ui/classic-collapsed-badge.js
node --check src/ui/classic-floating-panel.js
```

## Manual Verification

After reloading the unpacked extension:

1. Confirm missing preference opens modern Edge Dock.
2. Confirm the modern settings button is a detached `44px` circle with the
   extension list icon.
3. Switch to classic mode and confirm immediate replacement with the classic
   draggable text badge.
4. Expand the classic panel and confirm free dragging and classic actions.
5. Switch back to modern mode from the classic panel.
6. Refresh and open another website to confirm the preference is global.
7. Verify light mode, dark mode, left-side dock mirroring, touch click, and
   window resize behavior.
