# ccthread SessionEnd hook — Windows.
$ErrorActionPreference = "SilentlyContinue"

# Skip on non-Windows (PowerShell Core on macOS/Linux). POSIX sibling handles those.
if ($PSVersionTable.Platform -and $PSVersionTable.Platform -ne 'Win32NT') { exit 0 }

$dataDir = if ($env:CLAUDE_PLUGIN_DATA) { $env:CLAUDE_PLUGIN_DATA } else { Join-Path $env:USERPROFILE ".claude\plugins\data\ccthread" }
$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$file = Join-Path $dataDir "sessions\$parent.json"
if (Test-Path $file) { Remove-Item $file }
