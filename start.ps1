$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$nodeRuntime = Join-Path $PSScriptRoot 'runtime\node\node.exe'
if (-not (Test-Path $nodeRuntime)) { throw 'Bundled Node runtime is missing. Re-extract the complete portable package.' }
Start-Process "http://localhost:3210"
& $nodeRuntime (Join-Path $PSScriptRoot 'server.js')
