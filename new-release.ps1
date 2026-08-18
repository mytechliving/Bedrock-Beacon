param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Increment = 'patch'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'app-manifest.json'

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.version -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
  throw "Current version '$($manifest.version)' is not a three-part semantic version."
}

$major = [int]$Matches[1]
$minor = [int]$Matches[2]
$patch = [int]$Matches[3]
switch ($Increment) {
  'major' { $major++; $minor = 0; $patch = 0 }
  'minor' { $minor++; $patch = 0 }
  'patch' { $patch++ }
}
$nextVersion = "$major.$minor.$patch"

$bundledNode = Join-Path $projectRoot 'runtime\node\node.exe'
$node = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
& $node (Join-Path $projectRoot 'scripts\set-version.js') $nextVersion
if ($LASTEXITCODE -ne 0) { throw "Could not update release metadata (exit code $LASTEXITCODE)." }

Write-Host "Bedrock Beacon version advanced to $nextVersion."
& (Join-Path $projectRoot 'build-portable.ps1')
if ($LASTEXITCODE -ne 0) { throw "Portable build failed with exit code $LASTEXITCODE." }
