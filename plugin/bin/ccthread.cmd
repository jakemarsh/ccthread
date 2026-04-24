@echo off
setlocal
rem ccthread dispatcher (Windows) — downloads the right binary on first run, then execs.

set "ROOT=%CLAUDE_PLUGIN_ROOT%"
if "%ROOT%"=="" set "ROOT=%~dp0.."
set "DATA=%CLAUDE_PLUGIN_DATA%"
if "%DATA%"=="" set "DATA=%LOCALAPPDATA%\claude\plugins\ccthread"

set /p VERSION=<"%ROOT%\bin\.ccthread-version"

rem PROCESSOR_ARCHITECTURE reports the current process's arch; a 32-bit
rem host reads "x86". PROCESSOR_ARCHITEW6432 carries the machine arch
rem in that case.
set "RAW_ARCH=%PROCESSOR_ARCHITECTURE%"
if "%RAW_ARCH%"=="" set "RAW_ARCH=%PROCESSOR_ARCHITEW6432%"
if /I "%RAW_ARCH%"=="x86" if not "%PROCESSOR_ARCHITEW6432%"=="" set "RAW_ARCH=%PROCESSOR_ARCHITEW6432%"
if /I "%RAW_ARCH%"=="ARM64" (set "TARGET=bun-windows-arm64") else (set "TARGET=bun-windows-x64-baseline")

set "BINDIR=%DATA%\bin\ccthread-%VERSION%-%TARGET%"
set "BIN=%BINDIR%\ccthread.exe"

if not exist "%BIN%" (
  set "URL=https://github.com/jakemarsh/ccthread/releases/download/v%VERSION%/ccthread-v%VERSION%-%TARGET%.tar.gz"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\bin\ccthread-fetch.ps1" -Url "%URL%" -BinDir "%BINDIR%" || (
    echo ccthread: could not install ccthread from %URL% 1>&2
    echo Install manually: https://github.com/jakemarsh/ccthread/releases 1>&2
    exit /b 1
  )
)

"%BIN%" %*
