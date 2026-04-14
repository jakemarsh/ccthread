import { resolveSession } from "../paths.ts";
import { streamJsonl } from "../parser/stream.ts";
import { isAssistant, isUser, isSystem, isProgress, type AssistantLine, type LogLine } from "../parser/types.ts";
import { accumulateTokens, humanDuration, renderTokens } from "../format/markdown.ts";

export interface InfoOptions { json?: boolean; plain?: boolean }

export async function runInfo(idOrPath: string, opts: InfoOptions = {}): Promise<string> {
  const ref = await resolveSession(idOrPath);
  const counts: Record<string, number> = {};
  const toolCounts: Record<string, number> = {};
  const models = new Set<string>();
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let sidechains = 0;
  let interrupted = 0;
  let apiErrors = 0;
  let compactBoundaries = 0;
  let customTitle: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  const toks = accumulateTokens();

  for await (const { line } of streamJsonl(ref.path)) {
    counts[line.type] = (counts[line.type] ?? 0) + 1;
    if ((line as any).cwd && !cwd) cwd = (line as any).cwd;
    if ((line as any).gitBranch && !gitBranch) gitBranch = (line as any).gitBranch;
    if (line.isSidechain) sidechains++;
    if (line.timestamp) {
      if (!firstTs) firstTs = line.timestamp;
      lastTs = line.timestamp;
    }

    if (isAssistant(line)) {
      const m = (line as AssistantLine).message?.model;
      if (m) models.add(m);
      toks.add(line as AssistantLine);
      for (const b of (line as any).message?.content ?? []) {
        if (b?.type === "tool_use") toolCounts[b.name] = (toolCounts[b.name] ?? 0) + 1;
      }
    }

    if ((line as any).type === "custom-title") {
      const ct = (line as any).customTitle;
      if (typeof ct === "string" && ct.trim()) customTitle = ct.trim();
    }
    if ((line as any).type === "ai-title" && !customTitle) {
      const at = (line as any).aiTitle;
      if (typeof at === "string" && at.trim()) customTitle = at.trim();
    }

    if (isSystem(line)) {
      if ((line as any).subtype === "api_error") apiErrors++;
      if ((line as any).subtype === "compact_boundary") compactBoundaries++;
    }

    if (isUser(line)) {
      const blocks = (line as any).message?.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b?.type === "text" && typeof b.text === "string" && b.text.includes("[Request interrupted by user]")) interrupted++;
        }
      } else if (typeof blocks === "string" && blocks.includes("[Request interrupted by user]")) {
        interrupted++;
      }
    }
  }

  const durationMs = firstTs && lastTs ? new Date(lastTs).getTime() - new Date(firstTs).getTime() : 0;

  if (opts.json) {
    return JSON.stringify({
      sessionId: ref.sessionId,
      shortId: ref.shortId,
      path: ref.path,
      project: ref.project.decodedPath,
      cwd,
      gitBranch,
      customTitle,
      models: [...models],
      firstTimestamp: firstTs ?? null,
      lastTimestamp: lastTs ?? null,
      durationMs,
      counts,
      toolCounts,
      tokens: toks.total,
      sidechains,
      interrupted,
      apiErrors,
      compactBoundaries,
    }, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Conversation ${ref.shortId}`);
  lines.push(`- **Session**: \`${ref.sessionId}\``);
  lines.push(`- **Path**: \`${ref.path}\``);
  lines.push(`- **Project**: \`${ref.project.decodedPath}\``);
  if (cwd) lines.push(`- **CWD**: \`${cwd}\``);
  if (gitBranch) lines.push(`- **Git branch**: \`${gitBranch}\``);
  if (customTitle) lines.push(`- **Title**: "${customTitle}"`);
  if (firstTs) lines.push(`- **Started**: ${firstTs}`);
  if (lastTs) lines.push(`- **Ended**: ${lastTs}`);
  if (durationMs) lines.push(`- **Duration**: ${humanDuration(durationMs)}`);
  if (models.size) lines.push(`- **Models**: ${[...models].join(", ")}`);
  lines.push(`- **Tokens**: ${renderTokens(toks.total)}`);
  lines.push(``);
  lines.push(`## Message counts`);
  const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of ordered) lines.push(`- ${k}: ${v}`);
  if (sidechains) lines.push(`- sidechain lines: ${sidechains}`);
  if (interrupted) lines.push(`- interrupted: ${interrupted}`);
  if (apiErrors) lines.push(`- api errors: ${apiErrors}`);
  if (compactBoundaries) lines.push(`- compact boundaries: ${compactBoundaries}`);
  if (Object.keys(toolCounts).length) {
    lines.push(``);
    lines.push(`## Tools`);
    const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
    for (const [name, n] of topTools) lines.push(`- ${name}: ${n}`);
  }
  return lines.join("\n") + "\n";
}
