import { resolveSession } from "../paths.ts";
import { streamJsonl } from "../parser/stream.ts";
import { isAssistant, type AssistantLine } from "../parser/types.ts";

export interface ToolsOptions { top?: number; json?: boolean; plain?: boolean }

export async function runTools(idOrPath: string, opts: ToolsOptions = {}): Promise<string> {
  const ref = await resolveSession(idOrPath);
  const counts: Record<string, number> = {};
  let totalCalls = 0;

  for await (const { line } of streamJsonl(ref.path)) {
    if (!isAssistant(line)) continue;
    for (const b of (line as AssistantLine).message?.content ?? []) {
      if ((b as any)?.type === "tool_use") {
        counts[(b as any).name] = (counts[(b as any).name] ?? 0) + 1;
        totalCalls++;
      }
    }
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = opts.top ?? 20;
  const shown = sorted.slice(0, top);

  if (opts.json) return JSON.stringify({ sessionId: ref.sessionId, totalCalls, tools: Object.fromEntries(sorted) }, null, 2);

  const lines: string[] = [];
  if (!opts.plain) lines.push(`# Tools for ${ref.shortId} — ${totalCalls} call${totalCalls === 1 ? "" : "s"}\n`);
  if (!shown.length) return "(no tool calls)\n";
  for (const [name, n] of shown) {
    const pct = totalCalls ? Math.round((n * 100) / totalCalls) : 0;
    lines.push(`- ${name}: ${n} (${pct}%)`);
  }
  return lines.join("\n") + "\n";
}
