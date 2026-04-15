#!/bin/sh
# ccthread SessionStart hook.
# Writes the session id + transcript path to a PID-keyed file so the
# ccthread CLI can look up the "current" session even when the host
# claude process wasn't invoked with --session-id in argv.
#
# PPID here is the claude process that spawned this hook.
set -e

input=$(cat)

# Minimal JSON extraction — no jq dependency. Claude Code's hook payload is
# well-formed so these lazy regexes are fine.
extract() {
  printf '%s' "$input" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n1
}

session_id=$(extract session_id)
transcript_path=$(extract transcript_path)
cwd=$(extract cwd)

[ -z "$session_id" ] && exit 0  # nothing to record

DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/ccthread}"
SESSIONS="$DATA/sessions"
mkdir -p "$SESSIONS"

now=$(date +%s 2>/dev/null || echo 0)

# Drop files older than a day so the registry doesn't grow forever on boxes
# that crash without SessionEnd firing. Ignore find errors silently.
find "$SESSIONS" -type f -name '*.json' -mtime +1 -delete 2>/dev/null || true

cat > "$SESSIONS/$PPID.json" <<EOF
{"session_id":"$session_id","transcript_path":"$transcript_path","cwd":"$cwd","pid":$PPID,"started_at":$now}
EOF

exit 0
