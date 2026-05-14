---
name: package
description: Package the extension as a distributable zip file, with automatic CHANGELOG and README updates based on git diff
---

# Package Extension

You are tasked with packaging the browser extension as a distributable zip file. Before packaging, you must analyze code changes since the last version and update CHANGELOG.md and README.md accordingly.

## Arguments

The skill accepts a version number as an argument (e.g., `0.7.0`). If provided, update `manifest.json` to this version before proceeding. If not provided, use the version currently in `manifest.json`.

## Step 1: Update Version

If a version argument was provided:
1. Update `"version"` in `manifest.json` to the specified version

## Step 2: Analyze Changes

1. Find the previous version tag:
   ```bash
   git tag --sort=-version:refname | head -5
   ```
   Pick the most recent tag as the previous version.

2. Generate a diff between the previous version and current HEAD:
   ```bash
   git diff v{prev_version}..HEAD --stat
   git log v{prev_version}..HEAD --oneline
   git diff v{prev_version}..HEAD -- src/
   ```
   Focus on `src/` changes for functional changes. Also check for changes to `manifest.json`, `_locales/`, `icons/`.

3. Categorize the changes into:
   - **🚀 新增 / Added**: New features, new capabilities
   - **🔧 更改 / Changed**: Behavior changes, improvements to existing features
   - **🐛 修复 / Fixed**: Bug fixes
   - **⚡ 技术改进 / Technical Improvements**: Refactoring, performance, internal changes

## Step 3: Update CHANGELOG.md and CHANGELOG_CN.md

The changelog is split into two separate files by language. Update both:

1. **CHANGELOG.md** (English): Read the current file, add a new version entry at the top (after the Table of Contents section), following the existing English-only format:
   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### 🚀 Added
   - **Feature name**
     - Description in English

   ### 🔧 Changed
   - ...

   ### 🐛 Fixed
   - ...

   ---
   ```

2. **CHANGELOG_CN.md** (Chinese): Same structure, but all content in Chinese:
   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### 🚀 新增
   - **功能名称**
     - 中文描述

   ### 🔧 更改
   - ...

   ### 🐛 修复
   - ...

   ---
   ```

3. For both files, update the Table of Contents section:
   - Add the new version link to the list (maintain reverse chronological order)
   - Update the `[Latest]` / `[最新版本]` link in the header line
4. Only include sections that have entries. If there are no bug fixes, omit the "Fixed" section entirely.
5. Each file contains content in its own language only — no bilingual mixing.

## Step 4: Update README.md and README_CN.md

Review the changes and determine if README updates are needed:

1. **Always update if**:
   - New user-facing features were added → add to Key Features section
   - Architecture changed (new modules, renamed files) → update Project Structure and Architecture sections
   - New permissions added → update Core Technologies section
   - New storage keys added → update Configuration Format section
   - New UI interactions added → update usage instructions

2. **Do NOT update for**:
   - Bug fixes only (no user-facing changes)
   - Internal refactoring with no API/behavior changes
   - Performance improvements invisible to users

3. Update **both** `README.md` (English) and `README_CN.md` (Chinese) to keep them in sync.

4. Also update `CLAUDE.md` if architecture, module structure, or storage schema has changed.

## Step 5: Commit Changes

Commit all documentation updates and the version bump together:
```bash
git add manifest.json CHANGELOG.md CHANGELOG_CN.md README.md README_CN.md CLAUDE.md
git commit -m "chore: bump version to X.Y.Z"
```

## Step 6: Validate and Package

First, run the build script to validate all source files:
```bash
node build.js
```
If validation fails, stop and fix the errors before proceeding.

Then create the zip file excluding development files:
```bash
# Read version
VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

# Create packages directory
mkdir -p dist/packages

# Create zip excluding development files
zip -r "dist/packages/v${VERSION}.zip" . -x \
    ".claude/*" "CLAUDE.md" ".claude-*" \
    ".git/*" ".gitignore" ".gitattributes" \
    ".github/*" \
    "dist/*" \
    "node_modules/*" \
    "docs/superpowers/*" \
    "build.js" \
    "package.json" \
    "package-lock.json" \
    "*.md"

echo "Package created: dist/packages/v${VERSION}.zip"
```

## Step 7: Tag and Push

```bash
# Create and push git tag
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin main "v${VERSION}"
echo "Git tag v${VERSION} created and pushed to remote"
```

## Step 8: Verification

After creating the zip, verify:
1. The zip file exists at the expected path
2. The file name matches the version format (e.g., `v0.7.0.zip`)
3. Report the file size of the created zip
4. The git tag was created and pushed to remote successfully (check with `git ls-remote --tags origin`)
5. The zip does NOT contain development files (build.js, package.json, .claude/, etc.)
