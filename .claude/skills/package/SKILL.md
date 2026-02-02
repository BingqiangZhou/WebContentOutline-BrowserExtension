---
name: package
description: Package the extension as a distributable zip file, excluding development files
---

# Package Extension

You are tasked with packaging the browser extension as a distributable zip file.

## Requirements

1. **Read the version** from `manifest.json` (format: "version": "x.y.z")
2. **Create a zip file** with these specifications:
   - Output path: `dist/packages/v{version}.zip` (e.g., `dist/packages/v0.4.1.zip`)
   - Create the `dist/packages` directory if it doesn't exist
3. **Include** all files EXCEPT:
   - Claude-related files: `.claude/`, `CLAUDE.md`, `.claude-*`
   - Git-related files: `.git/`, `.gitignore`, `.gitattributes`
   - GitHub workflows: `.github/`
   - Distribution folder: `dist/`
   - Node modules (if any): `node_modules/`
4. **Preserve the original folder structure** for included files
5. **Create and push git tag** for the version (e.g., `v0.4.1`) to remote, triggering GitHub Action

## Implementation

Execute the PowerShell script in this skill directory:

```powershell
powershell -ExecutionPolicy Bypass -File .claude/skills/package/scripts/package.ps1
```

For Unix-like systems (Linux/macOS), use `zip` command:

```bash
# Read version
VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

# Create packages directory
mkdir -p dist/packages

# Create zip excluding specified patterns
zip -r "dist/packages/v${VERSION}.zip" . -x \
    ".claude/*" "CLAUDE.md" ".claude-*" \
    ".git/*" ".gitignore" ".gitattributes" \
    ".github/*" \
    "dist/*" \
    "node_modules/*"

echo "Package created: dist/packages/v${VERSION}.zip"

# Create and push git tag
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin "v${VERSION}"
echo "Git tag v${VERSION} created and pushed to remote"
```

## Verification

After creating the zip, verify:
1. The zip file exists at the expected path
2. The file name matches the version format (e.g., `v0.4.1.zip`)
3. Report the file size of the created zip
4. The git tag was created and pushed to remote successfully (check with `git ls-remote --tags origin`)
