---
name: description
description: Use when writing, updating, or generating store listing descriptions for Chrome Web Store or Edge Add-ons. Triggers on any mention of store descriptions, marketplace listings, extension descriptions for stores, or the description files in docs/descriptions/. Also use when the user mentions preparing store submission materials, updating what appears on the Chrome Web Store or Edge Add-ons page, or needs plain-text descriptions formatted for browser extension marketplaces — even if they don't explicitly say "store description."
---

# Store Description

Write or update the browser extension's store listing description for Chrome Web Store and Edge Add-ons.

## Why This Skill Exists

Both stores only support **plain text** — no HTML, no Markdown. Pasting Markdown directly into the store form shows raw symbols like `**`, `###`, and `` ` `` to users, which looks broken and unprofessional. This skill maintains a Markdown source file (easy to edit and diff) and generates clean `.txt` files ready for copy-paste into store forms.

## Arguments

Optional version number (e.g., `1.0`). If omitted, read version from `manifest.json` and format as `{major}.{minor}.x`.

## File Layout

All files live in `docs/descriptions/`:

| File | Purpose |
|------|---------|
| `description_{version}.md` | Markdown source — the single source of truth to edit |
| `description_{version}_store_cn.txt` | Chinese plain text — paste into store form |
| `description_{version}_store_en.txt` | English plain text — paste into store form |

## Workflow

### Step 1 — Locate the Source

1. Determine version: use the argument, or read `manifest.json` → `{major}.{minor}.x`.
2. Check if `description_{version}.md` exists in `docs/descriptions/`.
3. If it exists → read it and understand the current structure.
4. If not → read the latest existing `description_*.md` as a starting reference.

### Step 2 — Write or Update Markdown Source

Edit a single file with **both** languages, separated by a `---` horizontal rule:

```
# Web TOC Assistant / 网页目录助手

## 中文商店描述
### 概述 / 新版界面 / 核心功能 / 适用场景 / 隐私与权限 / 开源地址
---

## English Store Description
### Overview / New Interface / Key Features / Great For / Privacy / Open Source
```

Writing guidelines:
- Start with an overview paragraph, then feature sections with `###`.
- Use `##` only for the two language separators — never for feature sections.
- Feature lists use `- **feature name**：description` format.
- Both languages should cover equivalent content but read naturally — adapt wording for each audience rather than translating literally.
- When updating an existing file, check `git log` for recent changes and only modify sections that actually changed.

### Step 3 — Generate Plain-Text Versions

Read `store-description-format-guide.md` in this skill directory for the full conversion rules and examples.

The core idea: strip all Markdown formatting and replace structural markers with plain-text equivalents (`★` for headings, `•` for list items, etc.). The guide explains every rule with before/after examples.

Split the output into two files:
- `_store_cn.txt` ← the Chinese section (between `## 中文商店描述` and `---`)
- `_store_en.txt` ← the English section (between `## English Store Description` and EOF)

### Step 4 — Finalize

1. Write all three files (`.md` source + two `.txt` outputs).
2. Report what was written or changed.
3. Remind the user: open the `.txt` files, select all, copy-paste into the store's description field.

## Common Mistakes

- **Pasting Markdown into store fields** — raw `**`, `###`, `` ` `` display literally to users. Always use the generated `.txt` files.
- **Including developer content** — installation instructions, build commands, and architecture details don't belong in store descriptions. These are for end users.
- **Outdated features** — before updating, check `git log` to see what actually changed. Don't carry forward descriptions of removed features.
- **Literal translation** — Chinese and English readers have different expectations for tone and structure. Adapt naturally for each audience.
