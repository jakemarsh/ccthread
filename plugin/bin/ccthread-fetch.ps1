# ccthread binary fetcher — downloads, verifies, and atomically installs
# a release tarball into the plugin's cache dir. Called by ccthread.cmd.
#
# Usage: ccthread-fetch.ps1 <url> <binDir>
#   <url>    full URL to the .tar.gz (the sibling .sha256 is optional)
#   <binDir> target dir for the extracted release (will be created)
param(
  [Parameter(Mandatory=$true)][string]$Url,
  [Parameter(Mandatory=$true)][string]$BinDir
)
$ErrorActionPreference = 'Stop'

# Stage the download + extract in a temp dir, then rename into place so a
# killed mid-download or a concurrent invocation can't leave a partial
# layout in $BinDir.
$Tgz = [IO.Path]::GetTempFileName()
$ShaFile = [IO.Path]::GetTempFileName()
$Stage = [IO.Path]::Combine([IO.Path]::GetTempPath(), [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $Stage | Out-Null

try {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Tgz

  # Verify SHA256 if a sibling .sha256 exists; mirror install.ps1 behavior.
  $ShaAvailable = $false
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$Url.sha256" -OutFile $ShaFile -ErrorAction Stop
    $ShaAvailable = $true
  } catch {
    # No .sha256 at the release — skip verification.
  }
  if ($ShaAvailable) {
    $Expected = (Get-Content $ShaFile -Raw).Trim().Split()[0].ToLower()
    $Actual = (Get-FileHash -Algorithm SHA256 -Path $Tgz).Hash.ToLower()
    if ($Expected -ne $Actual) {
      throw "ccthread: SHA256 mismatch for $Url"
    }
  }

  tar -xzf $Tgz -C $Stage
  if ($LASTEXITCODE -ne 0) { throw "ccthread: tar extraction failed" }

  $Extracted = Get-ChildItem -Directory -Path $Stage | Select-Object -First 1
  if (-not $Extracted) { throw "ccthread: extraction produced no directory" }

  # Atomic install: remove any pre-existing (possibly partial) target, then
  # rename the freshly extracted dir into place.
  if (Test-Path $BinDir) { Remove-Item $BinDir -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path $BinDir -Parent) -Force | Out-Null
  Move-Item $Extracted.FullName $BinDir
} finally {
  Remove-Item $Tgz -ErrorAction SilentlyContinue
  Remove-Item $ShaFile -ErrorAction SilentlyContinue
  Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue
}
