$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$stageRoot = Join-Path $distRoot 'BedrockBeacon'
$manifest = Get-Content -Raw (Join-Path $projectRoot 'app-manifest.json') | ConvertFrom-Json
$archive = Join-Path $distRoot "BedrockBeacon-$($manifest.version)-win-x64.zip"
$requiredBuildInputs = @(
  'runtime\node\node.exe',
  'runtime\java\jdk-21.0.12+8-jre\bin\java.exe',
  'service\BedrockHarborService.exe',
  'data\bedrockconnect\BedrockConnect-1.69.0.jar'
)
foreach ($input in $requiredBuildInputs) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $input))) { throw "Portable build input is missing: $input" }
}

function Assert-UnderDist([string]$Path) {
  $resolvedDist = [IO.Path]::GetFullPath($distRoot).TrimEnd('\') + '\'
  $resolvedPath = [IO.Path]::GetFullPath($Path)
  if (-not $resolvedPath.StartsWith($resolvedDist, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the distribution directory: $resolvedPath"
  }
}

New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
Assert-UnderDist $stageRoot
Assert-UnderDist $archive
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

$files = @(
  'server.js', 'property-schema.js', 'app-manifest.json', 'package.json', 'package-lock.json',
  'README.md', 'THIRD_PARTY_NOTICES.md', 'start.bat', 'start.ps1',
  'install-service.ps1', 'uninstall-service.ps1', 'install-update.ps1',
  'build-portable.ps1', 'new-release.ps1'
)
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stageRoot }

Copy-Item -LiteralPath (Join-Path $projectRoot 'public') -Destination $stageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts') -Destination $stageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'node_modules') -Destination $stageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'service') -Destination $stageRoot -Recurse

$runtimeTarget = Join-Path $stageRoot 'runtime'
New-Item -ItemType Directory -Force -Path $runtimeTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'runtime\node') -Destination $runtimeTarget -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'runtime\java') -Destination $runtimeTarget -Recurse

$gatewayTarget = Join-Path $stageRoot 'data\bedrockconnect'
New-Item -ItemType Directory -Force -Path $gatewayTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'data\bedrockconnect\BedrockConnect-1.69.0.jar') -Destination $gatewayTarget
foreach ($directory in @('Servers','data\uploads','data\exports','data\service-logs')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $stageRoot $directory) | Out-Null
}

& tar.exe -a -cf $archive -C $distRoot 'BedrockBeacon'
if ($LASTEXITCODE -ne 0) { throw "Could not create portable archive (tar exit code $LASTEXITCODE)." }

$hash = Get-FileHash -LiteralPath $archive -Algorithm SHA256
$size = [math]::Round((Get-Item -LiteralPath $archive).Length / 1MB, 1)
Write-Host "Portable package: $archive"
Write-Host "Size: $size MB"
Write-Host "SHA256: $($hash.Hash)"
