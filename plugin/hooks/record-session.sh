#!/bin/sh
# ccthread SessionStart hook.
# Writes the session id + transcript path to a PID-keyed file so the
# ccthread CLI can look up the "current" session even when the host
# claude process wasn't invoked with --session-id in argv.
#
# PPID here is the claude process that spawned this hook.
set -e

# Skip on Windows-like shells (Git Bash, MSYS, Cygwin). The PowerShell
# hook handles those; running here too would double-write session files
# under different PIDs.
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*|Windows*) exit 0 ;;
esac

input=$(cat)

# Minimal JSON extraction — no jq dependency. Claude Code's hook payload is
# well-formed so these lazy regexes are fine.
extract() {
  printf '%s' "$input" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n1
}

session_id=$(extract session_id)
transcript_path=$(extract transcript_path)
cwd=$(extract cwd)

DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/ccthread}"
SESSIONS="$DATA/sessions"
mkdir -p "$SESSIONS"

# If we got a non-empty payload but no session_id, leave a breadcrumb so
# this isn't invisible if Claude Code ever changes the payload shape.
if [ -z "$session_id" ]; then
  if [ -n "$input" ]; then
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    printf '%s record-session.sh: no session_id in payload: %s\n' "$ts" "$(printf '%s' "$input" | head -c 200)" > "$SESSIONS/.last-error" 2>/dev/null || true
  fi
  exit 0
fi

now=$(date +%s 2>/dev/null || echo 0)

# Drop files older than a day so the registry doesn't grow forever on boxes
# that crash without SessionEnd firing. Ignore find errors silently.
find "$SESSIONS" -type f -name '*.json' -mtime +1 -delete 2>/dev/null || true

cat > "$SESSIONS/$PPID.json" <<EOF
{"session_id":"$session_id","transcript_path":"$transcript_path","cwd":"$cwd","pid":$PPID,"started_at":$now}
EOF

exit 0
