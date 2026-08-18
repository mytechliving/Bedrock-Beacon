param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][int]$ParentPid
)

$ErrorActionPreference = 'Stop'
$logDirectory = Join-Path $Target 'data\updates'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logFile = Join-Path $logDirectory 'last-update.log'

function Write-UpdateLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $logFile -Value $line
}

try {
  $resolvedSource = [IO.Path]::GetFullPath($Source).TrimEnd('\')
  $resolvedTarget = [IO.Path]::GetFullPath($Target).TrimEnd('\')
  if (-not (Test-Path -LiteralPath (Join-Path $resolvedSource 'app-manifest.json'))) { throw 'Staged application manifest is missing.' }
  if ($resolvedSource -eq $resolvedTarget) { throw 'Update source and target cannot be the same directory.' }

  $service = Get-Service -Name 'BedrockHarbor' -ErrorAction SilentlyContinue
  $restartService = $null -ne $service
  if ($service -and $service.Status -ne 'Stopped') {
    Write-UpdateLog 'Stopping BedrockHarbor Windows service.'
    Stop-Service -Name 'BedrockHarbor' -Force
  }

  Write-UpdateLog "Waiting for application process $ParentPid to exit."
  Wait-Process -Id $ParentPid -Timeout 60 -ErrorAction SilentlyContinue
  if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { Stop-Process -Id $ParentPid -Force }

  Write-UpdateLog 'Installing staged application files while preserving data and Servers.'
  $excluded = @(
    (Join-Path $resolvedSource 'data'),
    (Join-Path $resolvedSource 'Servers'),
    (Join-Path $resolvedSource 'dist')
  )
  & robocopy.exe $resolvedSource $resolvedTarget /E /R:2 /W:1 /XD $excluded /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Application file installation failed with robocopy exit code $LASTEXITCODE." }

  $gatewaySource = Join-Path $resolvedSource 'data\bedrockconnect'
  if (Test-Path -LiteralPath $gatewaySource) {
    $gatewayTarget = Join-Path $resolvedTarget 'data\bedrockconnect'
    New-Item -ItemType Directory -Force -Path $gatewayTarget | Out-Null
    & robocopy.exe $gatewaySource $gatewayTarget /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Gateway installation failed with robocopy exit code $LASTEXITCODE." }
  }

  Write-UpdateLog 'Application update installed successfully.'
  if ($restartService) {
    Start-Service -Name 'BedrockHarbor'
    Write-UpdateLog 'Windows service restarted.'
  } else {
    $node = Join-Path $resolvedTarget 'runtime\node\node.exe'
    Start-Process $node -ArgumentList 'server.js' -WorkingDirectory $resolvedTarget -WindowStyle Hidden
    Write-UpdateLog 'Portable application restarted.'
  }
} catch {
  Write-UpdateLog "UPDATE FAILED: $($_.Exception.Message)"
  throw
}
