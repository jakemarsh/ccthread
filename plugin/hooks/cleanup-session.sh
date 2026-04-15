#!/bin/sh
# ccthread SessionEnd hook — removes the PID-keyed session file written by
# the SessionStart hook. Best-effort; failures are silent.
DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/ccthread}"
rm -f "$DATA/sessions/$PPID.json" 2>/dev/null || true
exit 0
