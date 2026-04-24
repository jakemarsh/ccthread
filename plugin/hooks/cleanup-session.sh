#!/bin/sh
# ccthread SessionEnd hook — removes the PID-keyed session file written by
# the SessionStart hook. Best-effort; failures are silent.

# Skip on Windows-like shells; PowerShell sibling handles those.
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*|Windows*) exit 0 ;;
esac

DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/ccthread}"
rm -f "$DATA/sessions/$PPID.json" 2>/dev/null || true
exit 0
