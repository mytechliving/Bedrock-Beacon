# Run this script from an elevated PowerShell window.
$ErrorActionPreference = 'Stop'
$serviceWrapper = Join-Path $PSScriptRoot 'service\BedrockHarborService.exe'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run PowerShell as Administrator, then run this script again.'
}
& $serviceWrapper install
Write-Host 'Bedrock Beacon is installed as an Automatic (Delayed Start) Windows service.'
Write-Host 'Close the interactive Beacon window before starting the service.'
Write-Host 'Start it with: Start-Service BedrockHarbor'
