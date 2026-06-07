# Web TOC Assistant Brand Assets

Generated with `npm run assets:brand`.

## Design System

All promotional assets use a consistent indigo-themed design language:

- **Primary**: Indigo (`#4F46E5` / `#6366F1`) with accent colors — Emerald (`#10B981`), Amber (`#F59E0B`), Red (`#EF4444`)
- **Background**: Light gradient from `#EEF2FF` to `#F3F4F6`
- **Typography**: Inter (preferred) / Arial / PingFang SC with weight hierarchy
- **Cards**: White with subtle drop shadows, rounded corners
- **Brand icon**: Document outline mark re-colored in indigo for promotional materials

## Icon System

- Direction: transparent document outline mark that mirrors the Edge Dock collapsed bars.
- Enabled state: white document fill with `#202124` foreground.
- Disabled state: transparent document fill with `#737373` foreground.
- The mark shape stays identical across states; state is communicated by the document fill and foreground tone.

## Files

### Brand Marks

- `web-toc-assistant-mark-enabled.svg` and `web-toc-assistant-mark-disabled.svg`: master brand marks (512×512).

### Chrome Web Store Promotional Tiles

- `chrome-web-store-small-promo-en.png` and `chrome-web-store-small-promo-zh-CN.png`: 440×280 small promotional tiles.
- `chrome-web-store-marquee-en.png` and `chrome-web-store-marquee-zh-CN.png`: 1400×560 marquee tiles.

### Store Screenshots

- `store-screenshot-cover-en.png` and `store-screenshot-cover-zh-CN.png`: 1280×800 bilingual screenshot cover images with browser mockup and Edge Dock panel preview.
- `store-extension-intro-en.png` and `store-extension-intro-zh-CN.png`: 1280×800 bilingual full-extension intro cover images (user-designed).

### Historical Assets

- `0.x/`: pre-1.0 store description texts and metadata.
- `1.x/`: original AI-generated intro images (1586×992, from commit `8d49815f`, restored from git history).

## Extension Runtime Icons

The extension runtime icon paths in `wxt.config.ts` remain unchanged. Regenerated icon sources are written under `icons/`, then mirrored into `public/icons/` for WXT packaging.
