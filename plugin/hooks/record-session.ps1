# ccthread SessionStart hook — Windows.
# Writes the session id + transcript path to a PID-keyed file so the
# ccthread CLI can look up the "current" session when claude wasn't
# invoked with --session-id in argv.

$ErrorActionPreference = "Stop"

# Skip on non-Windows (PowerShell Core 6+ runs on macOS/Linux too). The
# POSIX sibling handles those platforms.
if ($PSVersionTable.Platform -and $PSVersionTable.Platform -ne 'Win32NT') { exit 0 }

$payload = [Console]::In.ReadToEnd()

$dataDir = if ($env:CLAUDE_PLUGIN_DATA) { $env:CLAUDE_PLUGIN_DATA } else { Join-Path $env:USERPROFILE ".claude\plugins\data\ccthread" }
$sessions = Join-Path $dataDir "sessions"
New-Item -ItemType Directory -Path $sessions -Force | Out-Null

$data = $null
try { $data = $payload | ConvertFrom-Json } catch {
  # Invisible silent-fail used to hide payload-shape changes. Leave a
  # breadcrumb instead so it's debuggable if/when Claude Code ever
  # ships a different payload.
  if ($payload) {
    $ts = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    $snippet = $payload.Substring(0, [Math]::Min(200, $payload.Length))
    Set-Content -Path (Join-Path $sessions ".last-error") -Value "$ts record-session.ps1: json parse failed: $snippet" -Encoding UTF8 -ErrorAction SilentlyContinue
  }
  exit 0
}

if (-not $data.session_id) {
  if ($payload) {
    $ts = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    $snippet = $payload.Substring(0, [Math]::Min(200, $payload.Length))
    Set-Content -Path (Join-Path $sessions ".last-error") -Value "$ts record-session.ps1: no session_id in payload: $snippet" -Encoding UTF8 -ErrorAction SilentlyContinue
  }
  exit 0
}

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
