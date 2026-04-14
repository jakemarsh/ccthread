@echo off
setlocal
rem ccthread dispatcher (Windows) — downloads the right binary on first run, then execs.

set "ROOT=%CLAUDE_PLUGIN_ROOT%"
if "%ROOT%"=="" set "ROOT=%~dp0.."
set "DATA=%CLAUDE_PLUGIN_DATA%"
if "%DATA%"=="" set "DATA=%LOCALAPPDATA%\claude\plugins\ccthread"

set /p VERSION=<"%ROOT%\bin\.ccthread-version"

if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" (set "TARGET=bun-windows-arm64") else (set "TARGET=bun-windows-x64-baseline")

set "BINDIR=%DATA%\bin\ccthread-%VERSION%-%TARGET%"
set "BIN=%BINDIR%\ccthread.exe"

if not exist "%BIN%" (
  set "URL=https://github.com/jakemarsh/ccthread/releases/download/v%VERSION%/ccthread-v%VERSION%-%TARGET%.tar.gz"
  if not exist "%BINDIR%" mkdir "%BINDIR%"
  powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $url='%URL%'; $tmp=[IO.Path]::GetTempFileName(); Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp; tar -xzf $tmp -C '%BINDIR%'; Remove-Item $tmp" || (
    echo ccthread: could not download %URL% 1>&2
    echo Install manually: https://github.com/jakemarsh/ccthread/releases 1>&2
    exit /b 1
  )
)

"%BIN%" %*
