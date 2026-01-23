# Package Extension Script
# This script should be run from the project root directory
$rootDir = $PWD.Path

# Read version from manifest.json
$manifest = Get-Content "$rootDir\manifest.json" -Raw | ConvertFrom-Json
$version = "v" + $manifest.version

# Set paths
$packagesDir = "$rootDir\dist\packages"
$tempDir = "$rootDir\dist\temp_package"
$zipPath = "$packagesDir\$version.zip"

Write-Host "Packaging extension version $version..."
Write-Host "Root directory: $rootDir"

# Create packages directory
New-Item -ItemType Directory -Force -Path $packagesDir | Out-Null

# Clean temp directory
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# Define exclusion patterns
$excludePatterns = @(
    "\.claude",
    "\.git",
    "^dist\\",
    "^node_modules\\",
    "^CLAUDE\.md$"
)

# Helper function to check if path should be excluded
function ShouldExclude {
    param([string]$relativePath)
    foreach ($pattern in $excludePatterns) {
        if ($relativePath -match "^$pattern") {
            return $true
        }
    }
    return $false
}

# Copy files excluding specified patterns
Get-ChildItem -Path $rootDir -Recurse -Force | ForEach-Object {
    $relativePath = $_.FullName.Substring($rootDir.Length + 1)

    # Skip if excluded
    if (ShouldExclude $relativePath) {
        return
    }

    # Skip directories (they will be created as needed)
    if ($_.PSIsContainer) {
        return
    }

    $targetPath = Join-Path $tempDir $relativePath
    $targetDir = Split-Path $targetPath -Parent

    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    }

    Copy-Item $_.FullName -Destination $targetPath -Force
}

# Create zip
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

# Cleanup
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue

# Output result
$fileSize = (Get-Item $zipPath).Length
Write-Host "Package created: $zipPath"
Write-Host "File size: $fileSize bytes"
