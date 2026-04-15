// Detect the session id of the Claude Code session that invoked us.
//
// Three tiers, tried in order:
//   1. CCTHREAD_SESSION_ID env override (scripting / testing).
//   2. argv walk — find the nearest `claude` ancestor and grep its command
//      line for --session-id or --resume. Works immediately for Stovetop
//      users and anyone invoking claude with an explicit id/resume flag.
//   3. plugin hook file — the SessionStart hook writes
//      {session_id,transcript_path,cwd,pid,started_at} to
//      $CLAUDE_PLUGIN_DATA/sessions/<claude-pid>.json. We walk up to find
//      the claude ancestor's pid, then read its file.
//
// If all three fail, return null and let the caller emit a clear error.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CurrentSession {
  sessionId: string;
  transcriptPath?: string;
  cwd?: string;
  source: "env" | "argv" | "hook";
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function detectCurrentSession(): CurrentSession | null {
  // Tier 1 — env override.
  const fromEnv = process.env.CCTHREAD_SESSION_ID;
  if (fromEnv && UUID_RE.test(fromEnv)) {
    return { sessionId: fromEnv.match(UUID_RE)![0], source: "env" };
  }

  // Walk the ancestor chain once; both tier 2 and tier 3 want the pid of
  // the `claude` ancestor.
  const ancestors = walkAncestors();
  let claudePid: number | undefined;

  // Tier 2 — argv walk for --session-id / --resume.
  // \b doesn't work before -- (both non-word chars), so use a lookbehind /
  // start-or-space anchor.
  const SESSION_ID = /(?:^|\s)--session-id[ =]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const RESUME = /(?:^|\s)--resume[ =]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  for (const p of ancestors) {
    const m = SESSION_ID.exec(p.command) ?? RESUME.exec(p.command);
    if (m) return { sessionId: m[1]!, source: "argv" };
    if (!claudePid && isClaudeProcess(p.command)) claudePid = p.pid;
  }

  // Tier 3 — hook file.
  if (claudePid) {
    const file = hookFilePath(claudePid);
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        if (typeof data?.session_id === "string" && UUID_RE.test(data.session_id)) {
          return {
            sessionId: data.session_id.match(UUID_RE)![0],
            transcriptPath: data.transcript_path,
            cwd: data.cwd,
            source: "hook",
          };
        }
      } catch { /* corrupt file — fall through */ }
    }
  }

  return null;
}

export function hookFilePath(claudePid: number): string {
  const base = process.env.CCTHREAD_PLUGIN_DATA
    ?? process.env.CLAUDE_PLUGIN_DATA
    ?? join(homedir(), ".claude", "plugins", "data", "ccthread");
  return join(base, "sessions", `${claudePid}.json`);
}

interface Ancestor { pid: number; command: string }

function walkAncestors(): Ancestor[] {
  const out: Ancestor[] = [];
  let pid = process.ppid;
  let safety = 30;
  while (pid && pid > 1 && safety-- > 0) {
    const info = readProcess(pid);
    if (!info) break;
    out.push({ pid, command: info.command });
    if (!info.ppid || info.ppid === pid) break;
    pid = info.ppid;
  }
  return out;
}

interface ProcInfo { command: string; ppid: number }

function readProcess(pid: number): ProcInfo | null {
  if (process.platform === "win32") return readWindowsProcess(pid);
  return readPosixProcess(pid);
}

function readPosixProcess(pid: number): ProcInfo | null {
  try {
    // -ww: unlimited line width so full argv isn't truncated.
    const out = execFileSync("ps", ["-ww", "-o", "ppid=,command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    if (!trimmed) return null;
    const m = /^\s*(\d+)\s+(.*)$/.exec(trimmed);
    if (!m) return null;
    return { ppid: parseInt(m[1]!, 10), command: m[2]! };
  } catch { return null; }
}

function readWindowsProcess(pid: number): ProcInfo | null {
  try {
    const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { "$($p.ParentProcessId)|$($p.CommandLine)" }`;
    const out = execFileSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    if (!trimmed) return null;
    const bar = trimmed.indexOf("|");
    if (bar < 0) return null;
    return { ppid: parseInt(trimmed.slice(0, bar), 10), command: trimmed.slice(bar + 1) };
  } catch { return null; }
}

function isClaudeProcess(command: string): boolean {
  // The claude CLI binary. Match either the word-boundary `claude` invocation
  // (e.g. `claude --session-id ...`) or a path ending in `/claude`. Avoid
  // matching things like `claude-code-plugins` or `claude-sonnet` in paths.
  if (/(^|\/|\\|")claude(\.exe)?(\s|$|")/.test(command)) return true;
  return false;
}
