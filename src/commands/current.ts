import { detectCurrentSession } from "../util/current-session.ts";
import { resolveSession } from "../paths.ts";

export interface CurrentOptions { json?: boolean; plain?: boolean }

export async function runCurrent(opts: CurrentOptions = {}): Promise<string> {
  const detected = detectCurrentSession();
  if (!detected) {
    if (opts.json) return JSON.stringify({ sessionId: null, source: null, path: null }, null, 2);
    return "(no current session detected — are you running inside Claude Code?)\n";
  }

  // Best-effort resolve to a path so callers can pipe to other commands.
  let path: string | null = null;
  try {
    const ref = await resolveSession(detected.sessionId);
    path = ref.path;
  } catch { path = detected.transcriptPath ?? null; }

  if (opts.json) {
    return JSON.stringify({
      sessionId: detected.sessionId,
      shortId: detected.sessionId.slice(0, 8),
      source: detected.source,
      path,
      cwd: detected.cwd ?? null,
    }, null, 2) + "\n";
  }

  const lines = [
    `- **Session**: \`${detected.sessionId}\``,
    `- **Short id**: \`${detected.sessionId.slice(0, 8)}\``,
    `- **Detected via**: ${detected.source}`,
  ];
  if (path) lines.push(`- **Path**: \`${path}\``);
  if (detected.cwd) lines.push(`- **CWD**: \`${detected.cwd}\``);
  if (!opts.plain) lines.unshift("# Current Session");
  return lines.join("\n") + "\n";
}
