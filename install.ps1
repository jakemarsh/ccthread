$ErrorActionPreference = "Stop"

$Repo = "jakemarsh/ccthread"
$Version = if ($env:CCTHREAD_VERSION) { $env:CCTHREAD_VERSION } else { "latest" }

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "bun-windows-arm64" } else { "bun-windows-x64-baseline" }

if ($Version -eq "latest") {
  $latest = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest"
  $Version = ($latest.tag_name -replace '^v', '')
  if (-not $Version) { throw "Could not resolve latest version" }
}

$Url = "https://github.com/$Repo/releases/download/v$Version/ccthread-v$Version-$arch.tar.gz"
$Tmp = [IO.Path]::Combine([IO.Path]::GetTempPath(), [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $Tmp | Out-Null
$Tgz = Join-Path $Tmp "ccthread.tar.gz"

Write-Host "Downloading ccthread v$Version ($arch)..."
Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Tgz

# Verify SHA256 if a sibling .sha256 exists at the release. Mirrors install.sh.
$ShaFile = Join-Path $Tmp "ccthread.tar.gz.sha256"
$ShaAvailable = $false
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$Url.sha256" -OutFile $ShaFile -ErrorAction Stop
  $ShaAvailable = $true
} catch {
  # No .sha256 sibling at the release — skip verification.
}
if ($ShaAvailable) {
  $Expected = (Get-Content $ShaFile -Raw).Trim().Split()[0].ToLower()
  $Actual = (Get-FileHash -Algorithm SHA256 -Path $Tgz).Hash.ToLower()
  if ($Expected -ne $Actual) {
    throw "ccthread: SHA256 mismatch for $Url`n  expected: $Expected`n  got:      $Actual"
  }
}

tar -xzf $Tgz -C $Tmp

$Dest = Join-Path $env:LOCALAPPDATA "Programs\ccthread"
New-Item -ItemType Directory -Path $Dest -Force | Out-Null
$Exe = Get-ChildItem -Recurse -Path $Tmp -Filter "ccthread.exe" | Select-Object -First 1
Copy-Item $Exe.FullName (Join-Path $Dest "ccthread.exe") -Force
Remove-Item -Recurse -Force $Tmp

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($UserPath -split ';' | Where-Object { $_ -eq $Dest })) {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$Dest", "User")
  Write-Host "Added $Dest to your user PATH. Open a new shell to pick it up."
}
Write-Host "Installed to $Dest\ccthread.exe"
