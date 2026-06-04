---
name: release
description: Release a new version of the extension. Handles version bump, CHANGELOG generation, build, git tag, and push to trigger GitHub Actions release. Use this skill whenever the user says "发布", "release", "publish", "打包发布", or wants to cut a new version, even if they just say "发布吧" or "release it" without specifying details.
---

# Release Extension

You are managing the release process for the Web TOC Assistant browser extension. The full pipeline: commit pending changes → validate → version bump → changelog → build → tag → push → GitHub Actions auto-publishes the release.

## Arguments

The skill accepts an optional version string (e.g., `1.1.0`, `1.0.3`). If not provided, ask the user which version to release based on the change analysis.

## Step 1: Pre-flight Checks

Before touching anything, verify the repo is in a releasable state:

```bash
git status --porcelain
git log --oneline -5
```

- Check which branch we're on. If not on `main`, ask before proceeding.

## Step 2: Commit Pending Changes

If there are uncommitted changes, analyze the diff and commit directly with a descriptive message (no need to ask the user):

```bash
git diff --stat
git diff
git add -A
git commit -m "<type>: <descriptive message>"
```

Choose commit type based on the changes: `feat` for new features, `fix` for bug fixes, `refactor` for restructuring, `docs` for documentation, `chore` for maintenance tasks.

## Step 3: Run Tests (Validation)

Validate the committed code before starting the release process:

```bash
npm test
```

If tests fail, stop and report the errors. Ask the user to fix the issues before proceeding with the release.

## Step 4: Analyze Changes Since Last Release

Find the previous release tag and analyze what changed:

```bash
git tag --sort=-version:refname | head -5
git log v{prev_version}..HEAD --oneline
git diff v{prev_version}..HEAD --stat -- src/
git diff v{prev_version}..HEAD -- src/
```

Categorize changes into:
- **🚀 新增 / Added**: New features, new capabilities
- **🔧 更改 / Changed**: Behavior changes, improvements
- **🐛 修复 / Fixed**: Bug fixes
- **⚡ 技术改进 / Technical Improvements**: Refactoring, performance, internal changes

**Only include sections that have entries.** Omit empty sections entirely.

Based on the scope and nature of changes, suggest a version number to the user:
- **Patch** (1.0.x): Bug fixes, stability improvements, performance tweaks — no new features
- **Minor** (1.x.0): New user-facing features or significant behavior changes
- **Major** (x.0.0): Breaking changes

## Step 5: Update Version

Once the user confirms the version, update all version files:

1. `"version"` in `manifest.json`
2. `"version"` in `package.json`
3. `"version"` in `package-lock.json` (both the top-level and `packages."".version` if present)

## Step 6: Update CHANGELOG.md and CHANGELOG_CN.md

Both changelogs follow the same structure in their respective languages. Read the existing files first, then add a new entry at the top (after the Table of Contents section).

**Format for CHANGELOG.md (English):**
```markdown
## [X.Y.Z] - YYYY-MM-DD

### 🚀 Added
- **Feature name**
  - Description in English

### 🐛 Fixed
- ...

### ⚡ Technical Improvements
- ...

---
```

**Format for CHANGELOG_CN.md (Chinese):**
```markdown
## [X.Y.Z] - YYYY-MM-DD

### 🚀 新增
- **功能名称**
  - 中文描述

### 🐛 修复
- ...

### ⚡ 技术改进
- ...

---
```

**Table of Contents updates for both files:**
- Add the new version to the list (reverse chronological order)
- Update the `[Latest]` / `[最新版本]` link in the header

**Each file contains content in its own language only — no bilingual mixing.**

## Step 7: Update README if Needed

Check if README.md / README_CN.md need updates:

- **Update if**: new user-facing features, architecture changes, new storage keys, new permissions
- **Skip if**: only bug fixes, internal refactoring, or performance changes invisible to users

Also update `CLAUDE.md` if architecture, module structure, or storage schema changed.

## Step 8: Build

```bash
npm run build
```

The build script:
- Bundles content script with esbuild into `dist/build/`
- Validates syntax
- Auto-increments `.build-number` (internal tracking, not in zip filename)
- Creates `dist/packages/v{VERSION}.zip`

If build fails, stop and fix errors before proceeding.

## Step 9: Verify Build Output

Check the produced zip:
```bash
ls -la dist/packages/v${VERSION}.zip
unzip -l dist/packages/v${VERSION}.zip | head -20
```

Verify:
1. Zip exists and file size is reasonable (~50-100 KB)
2. Contains expected files: `manifest.json`, `src/content.js`, `src/background.js`, `src/content.css`, `src/shared/primitives.js`, `_locales/`, `icons/`
3. Does NOT contain dev files: `build.js`, `.claude/`, `node_modules/`, `.build-number`, `.gitignore`

## Step 10: Commit, Tag, and Push

```bash
git add manifest.json package.json package-lock.json CHANGELOG.md CHANGELOG_CN.md
# Only add READMEs/CLAUDE.md if they were actually modified
git add README.md README_CN.md CLAUDE.md 2>/dev/null

git commit -m "release: v${VERSION}"
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin main "v${VERSION}"
```

**GitHub Actions will automatically:**
- Build the extension on the tag
- Create a GitHub Release with the zip asset
- Include installation instructions and changelog links

Do NOT manually create the release via `gh` CLI.

## Step 11: Confirm

Report to the user:
1. Version released
2. Zip file path and size
3. Git tag pushed
4. GitHub Actions release link: `https://github.com/{owner}/{repo}/actions`
5. Remind about Chrome Web Store / Edge Add-ons if applicable: "如需同步到 Chrome Web Store 或 Edge Add-ons，请手动上传 dist/packages/v${VERSION}.zip"
