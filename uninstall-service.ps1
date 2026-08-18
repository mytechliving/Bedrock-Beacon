# Run this script from an elevated PowerShell window.
$ErrorActionPreference = 'Stop'
$serviceWrapper = Join-Path $PSScriptRoot 'service\BedrockHarborService.exe'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run PowerShell as Administrator, then run this script again.'
}
Stop-Service BedrockHarbor -ErrorAction SilentlyContinue
& $serviceWrapper uninstall
Write-Host 'Bedrock Beacon Windows service removed. Server and world data were preserved.'
