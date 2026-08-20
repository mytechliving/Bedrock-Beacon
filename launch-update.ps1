param(
  [Parameter(Mandatory = $true)][string]$Updater,
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [Parameter(Mandatory = $true)][ValidateSet('portable', 'service')][string]$RestartMode
)

$ErrorActionPreference = 'Stop'
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
foreach ($value in @($Updater, $Source, $Target)) {
  if ($value.Contains('"')) { throw 'Update paths cannot contain quotation marks.' }
}
$commandLine = '"{0}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{1}" -Source "{2}" -Target "{3}" -ParentPid {4} -RestartMode {5}' -f $powerShell, $Updater, $Source, $Target, $ParentPid, $RestartMode
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine; CurrentDirectory = (Split-Path -Parent $Updater) }
if ($result.ReturnValue -ne 0) { throw "Windows could not start the independent updater process (code $($result.ReturnValue))." }
$result.ProcessId
