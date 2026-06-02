# Edge Dock Neutral Settings Entry Design

## Goal

Refine the Edge Dock toolbar so the settings entry is a standalone circular
surface with a clear sliders icon, while the collapsed TOC remains a separate
hierarchical line preview below it.

## Visual Direction

The settings entry uses a compact circular surface attached to the page edge:

- White background in light mode.
- Soft neutral shadow.
- Black sliders icon with three horizontal tracks and three circular controls.
- Light gray hover background.
- No pink accent color.

The circle is visually independent from the collapsed TOC preview. A small
vertical gap separates the two entries so they remain a coherent toolbar
without looking like one combined card.

In dark mode, the settings circle uses a dark gray background, a subtle
neutral border, and a light gray icon.

## Interaction

The two toolbar entries have distinct responsibilities:

- Hovering or focusing the circular settings entry opens the quick settings
  menu and collapses an open TOC card.
- Clicking the circular settings entry also opens the quick settings menu.
- Hovering or focusing the hierarchical line preview opens the temporary TOC
  card and closes the quick settings menu.
- Moving from the settings circle into the quick settings menu keeps the menu
  open.
- Leaving the toolbar and menu closes temporary content after the existing
  `250ms` delay.
- Clicking outside or pressing `Escape` closes the quick settings menu.

Touch behavior remains click-based and does not depend on hover.

## Implementation Boundaries

The change remains scoped to the Edge Dock:

- `src/ui/edge-dock.js` renders the sliders icon with CSS-friendly HTML
  elements and keeps settings hover behavior separate from TOC hover behavior.
- `src/content.css` defines the standalone circular surface, neutral theme,
  sliders icon, TOC spacing, focus ring, and dark-mode variant.
- `checks/edge-dock.test.mjs` locks the DOM structure, neutral palette, circular
  surface, hover behavior, focus behavior, and touch-safe click path.

No storage schema, permissions, TOC state model, or panel rendering changes are
required.

## Accessibility

- The settings entry remains a `button` with `type="button"`,
  `aria-haspopup="menu"`, and synchronized `aria-expanded`.
- The sliders icon is decorative and remains hidden from assistive technology.
- Keyboard focus on the settings entry opens the quick settings menu.
- Focus movement into the menu keeps it open.
- `Escape` closes the menu and restores focus to the settings entry.
- Existing focus-ring and reduced-motion handling remain active.

## Verification

Automated verification:

```bash
node --test checks/edge-dock.test.mjs
node --test checks/*.test.mjs
npm run build
git diff --check
node --check src/ui/edge-dock.js
```

Manual verification after reloading the unpacked extension:

1. Confirm the light-mode settings entry is a standalone white circle with a
   black sliders icon.
2. Confirm settings hover opens only the quick settings menu.
3. Confirm TOC preview hover opens only the TOC card.
4. Confirm moving into the settings menu does not close it prematurely.
5. Confirm touch click opens settings reliably.
6. Confirm dark mode uses a dark gray circle and light gray icon.
