[CmdletBinding()]
param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Increment = 'patch',
  [string]$Remote = 'origin',
  [switch]$Draft,
  [switch]$Prerelease
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'app-manifest.json'

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
}

function Test-GitHubRelease([string]$Tag) {
  $previousErrorAction = $ErrorActionPreference
  try {
    # A missing release is the expected result for a new tag. PowerShell 5
    # otherwise promotes gh's "release not found" stderr into a terminating error.
    $ErrorActionPreference = 'SilentlyContinue'
    & gh release view $Tag --json tagName 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  }
  finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

Push-Location $projectRoot
try {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.git'))) { throw 'Run this script from a Git clone of Bedrock Beacon.' }
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is required to publish a release.' }
  Invoke-Checked 'gh' @('auth', 'status')

  $branch = (& git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'A named Git branch must be checked out before publishing.' }
  $remoteUrl = (& git remote get-url $Remote).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $remoteUrl) { throw "Git remote '$Remote' is not configured." }
  $changes = @(& git status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Git working tree.' }
  if ($changes.Count -gt 0) { throw 'Commit or stash all working changes before publishing. The release script only commits generated version metadata.' }

  Invoke-Checked 'git' @('fetch', $Remote, '--tags')
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw "Manifest version '$($manifest.version)' is not a three-part semantic version." }

  $highest = [version]$manifest.version
  foreach ($tag in @(& git tag --list 'v*')) {
    if ($tag -match '^v(\d+\.\d+\.\d+)$') {
      $tagVersion = [version]$Matches[1]
      if ($tagVersion -gt $highest) { $highest = $tagVersion }
    }
  }
  $major = $highest.Major; $minor = $highest.Minor; $patch = $highest.Build
  switch ($Increment) {
    'major' { $major++; $minor = 0; $patch = 0 }
    'minor' { $minor++; $patch = 0 }
    'patch' { $patch++ }
  }
  $version = "$major.$minor.$patch"
  $tagName = "v$version"

  & git rev-parse --verify --quiet "refs/tags/$tagName" *> $null
  if ($LASTEXITCODE -eq 0) { throw "Tag $tagName already exists." }
  if (Test-GitHubRelease $tagName) { throw "GitHub Release $tagName already exists." }

  $bundledNode = Join-Path $projectRoot 'runtime\node\node.exe'
  $node = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
  Invoke-Checked $node @((Join-Path $projectRoot 'scripts\set-version.js'), $version)
  Invoke-Checked (Join-Path $projectRoot 'build-portable.ps1') @()

  $archive = Join-Path $projectRoot "dist\BedrockBeacon-$version-win-x64.zip"
  if (-not (Test-Path -LiteralPath $archive)) { throw "Release archive was not created: $archive" }
  $hash = Get-FileHash -LiteralPath $archive -Algorithm SHA256
  $checksum = "$archive.sha256"
  "$($hash.Hash)  $([IO.Path]::GetFileName($archive))" | Set-Content -LiteralPath $checksum -Encoding ascii

  Invoke-Checked 'git' @('add', '--', 'app-manifest.json', 'package.json', 'package-lock.json')
  Invoke-Checked 'git' @('commit', '-m', "Release $tagName")
  Invoke-Checked 'git' @('tag', '-a', $tagName, '-m', "Bedrock Beacon $version")
  Invoke-Checked 'git' @('push', $Remote, $branch)
  Invoke-Checked 'git' @('push', $Remote, $tagName)

  $releaseArguments = @('release', 'create', $tagName, $archive, $checksum, '--verify-tag', '--title', "Bedrock Beacon $version", '--generate-notes')
  if ($Draft) { $releaseArguments += '--draft' }
  if ($Prerelease) { $releaseArguments += '--prerelease' }
  Invoke-Checked 'gh' $releaseArguments

  Write-Host ''
  Write-Host "Published Bedrock Beacon $version"
  Write-Host "Archive: $archive"
  Write-Host "SHA256: $($hash.Hash)"
  Invoke-Checked 'gh' @('release', 'view', $tagName, '--web')
}
finally {
  Pop-Location
}
