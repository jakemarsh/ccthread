# ccthread SessionEnd hook — Windows.
#
# Matches primarily on session_id from the hook payload, falls back to
# a pid-based filename. The payload match keeps cleanup correct even if
# $PID.ParentProcessId can't be resolved anymore (claude has exited).
$ErrorActionPreference = "SilentlyContinue"

# Skip on non-Windows (PowerShell Core on macOS/Linux). POSIX sibling handles those.
if ($PSVersionTable.Platform -and $PSVersionTable.Platform -ne 'Win32NT') { exit 0 }

$dataDir = if ($env:CLAUDE_PLUGIN_DATA) { $env:CLAUDE_PLUGIN_DATA } else { Join-Path $env:USERPROFILE ".claude\plugins\data\ccthread" }
$sessionsDir = Join-Path $dataDir "sessions"
if (-not (Test-Path $sessionsDir)) { exit 0 }

$sessionId = $null
try {
  $payload = [Console]::In.ReadToEnd()
  if ($payload) {
    $data = $payload | ConvertFrom-Json
    $sessionId = $data.session_id
  }
} catch { }

if ($sessionId) {
  $needle = "`"session_id`":`"$sessionId`""
  Get-ChildItem -Path $sessionsDir -Filter "*.json" -File |
    Where-Object { (Get-Content $_.FullName -Raw) -like "*$needle*" } |
    ForEach-Object { Remove-Item $_.FullName }
}

$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
if ($parent) {
  $file = Join-Path $sessionsDir "$parent.json"
  if (Test-Path $file) { Remove-Item $file }
}
