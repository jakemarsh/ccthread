# ccthread SessionStart hook — Windows.
# Writes the session id + transcript path to a PID-keyed file so the
# ccthread CLI can look up the "current" session when claude wasn't
# invoked with --session-id in argv.

$ErrorActionPreference = "Stop"

$payload = [Console]::In.ReadToEnd()
try { $data = $payload | ConvertFrom-Json } catch { exit 0 }

if (-not $data.session_id) { exit 0 }

$dataDir = if ($env:CLAUDE_PLUGIN_DATA) { $env:CLAUDE_PLUGIN_DATA } else { Join-Path $env:USERPROFILE ".claude\plugins\data\ccthread" }
$sessions = Join-Path $dataDir "sessions"
New-Item -ItemType Directory -Path $sessions -Force | Out-Null

# Remove entries older than 1 day.
Get-ChildItem -Path $sessions -Filter "*.json" -File -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |
  ForEach-Object { Remove-Item $_.FullName -ErrorAction SilentlyContinue }

$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$payload = @{
  session_id = $data.session_id
  transcript_path = $data.transcript_path
  cwd = $data.cwd
  pid = $parent
  started_at = [int][double]::Parse((Get-Date -UFormat %s))
} | ConvertTo-Json -Compress

Set-Content -Path (Join-Path $sessions "$parent.json") -Value $payload -Encoding UTF8
