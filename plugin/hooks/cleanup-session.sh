#!/bin/sh
# ccthread SessionEnd hook — removes the session file written by the
# SessionStart hook. Best-effort; failures are silent.
#
# Matches primarily on session_id from the hook payload, falls back to
# the pid-based filename if the payload's missing a session_id. The
# payload match keeps cleanup correct even in edge cases where $PPID
# isn't what record-session.sh saw (pid reuse, etc.).
#
# Runs on POSIX natively and on Windows under Git Bash / MSYS / Cygwin.

DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/ccthread}"
SESSIONS="$DATA/sessions"
[ -d "$SESSIONS" ] || exit 0

input=$(cat 2>/dev/null || true)
session_id=$(printf '%s' "$input" | sed -n "s/.*\"session_id\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n1)

if [ -n "$session_id" ]; then
  for f in "$SESSIONS"/*.json; do
    [ -f "$f" ] || continue
    if grep -q "\"session_id\":\"$session_id\"" "$f" 2>/dev/null; then
      rm -f "$f" 2>/dev/null || true
    fi
  done
fi

rm -f "$SESSIONS/$PPID.json" 2>/dev/null || true
exit 0
