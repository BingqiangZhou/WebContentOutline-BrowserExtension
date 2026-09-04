# Store Description Plain-Text Format Guide

Chrome Web Store and Edge Add-ons description fields only support plain text — no HTML, no Markdown. Pasting Markdown shows raw symbols (`**`, `###`, `` ` ``) to users.

This guide converts Markdown source files (`description_*.md`) into clean plain text suitable for store submission (`description_*_store_*.txt`).

## Conversion Rules

### Headings

| Markdown | Plain Text |
|----------|--------|
| `### 标题文本` | `★ 标题文本` |

- Replace `#` prefix with `★ ` (Unicode star U+2605).
- Leave one blank line before and after each heading for visual separation.
- Level-1 headings (`#`) are removed — stores display the extension name automatically.
- Level-2 headings (`##`) are removed — they only serve as language separators in the Markdown source.

### Bold Text

| Markdown | Plain Text |
|----------|--------|
| `**加粗内容**` | `加粗内容` |

- Strip `**` markers, keep the text content.
- For emphasis in list items, place the keyword at the start and separate with ` — `: `  • 标题缩略预览 — 收起时显示…`

### Inline Code

| Markdown | Plain Text |
|----------|--------|
| `` `h1-h6` `` | `h1-h6` |

- Strip backticks, keep the text.

### List Items

| Markdown | Plain Text |
|----------|--------|
| `- 列表内容` | `  • 列表内容` |

- Replace `- ` with `  • ` (two spaces + Unicode bullet `•` U+2022).
- The two-space indent visually distinguishes list items from regular paragraphs.

### Horizontal Rules

| Markdown | Plain Text |
|----------|--------|
| `---` | (blank line) |

- Replace with a single blank line.

### Paragraph Spacing

- One blank line between paragraphs.
- No blank lines between consecutive list items (keep lists compact).
- One blank line before and after a list block.

### Links

| Markdown | Plain Text |
|----------|--------|
| `[显示文本](https://...)` | `https://...` |
| Bare URL `https://...` | `https://...` (unchanged) |

- Store descriptions don't support clickable links, so just show the URL.

## File Naming

| File Type | Pattern | Purpose |
|-----------|---------|---------|
| Markdown source | `description_{version}.md` | Editable source with Markdown rendering |
| Plain-text store file | `description_{version}_store_{locale}.txt` | Copy-paste into store form |
| HTML preview | `description_{version}.html` | Local visual preview (optional) |

- `{version}`: extension version, e.g., `1.x`.
- `{locale}`: `cn` for Chinese, `en` for English.

## Complete Example

Markdown source:
```markdown
### 核心功能

- **自动生成目录**：默认识别网页中的 `h1-h6` 标题。
- **平滑快速跳转**：点击目录项即可滚动到对应内容。
```

Converted plain text:
```
★ 核心功能

  • 自动生成目录 — 默认识别网页中的 h1-h6 标题。
  • 平滑快速跳转 — 点击目录项即可滚动到对应内容。
```

## Process

1. Edit the Markdown source file (`description_*.md`).
2. Apply the conversion rules above for each language section.
3. Save as the corresponding `.txt` files.
4. When submitting to the store, open the `.txt` file, select all, and paste into the description field.
