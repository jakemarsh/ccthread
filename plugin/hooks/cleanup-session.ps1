# ccthread SessionEnd hook — Windows.
$ErrorActionPreference = "SilentlyContinue"
$dataDir = if ($env:CLAUDE_PLUGIN_DATA) { $env:CLAUDE_PLUGIN_DATA } else { Join-Path $env:USERPROFILE ".claude\plugins\data\ccthread" }
$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$file = Join-Path $dataDir "sessions\$parent.json"
if (Test-Path $file) { Remove-Item $file }
