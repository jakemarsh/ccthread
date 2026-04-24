import { listAllSessions, encodeProjectPath } from "../paths.ts";
import { streamJsonl } from "../parser/stream.ts";
import { contentBlocks, isUser, isAssistant, type LogLine, type AssistantLine } from "../parser/types.ts";
import { parseDateArg } from "../util/dates.ts";

export interface ListOptions {
  project?: string;
  since?: string;  // ISO
  until?: string;  // ISO
  limit?: number;
  sort?: "recent" | "oldest" | "size";
  json?: boolean;
  plain?: boolean;
}

interface Row {
  shortId: string;
  sessionId: string;
  project: string;
  projectBasename: string;
  started: string | null;
  durationMs: number | null;
  messages: number;
  title: string;
  model: string | null;
  path: string;
  size: number;
}

export async function runList(opts: ListOptions = {}): Promise<string> {
  let sessions = await listAllSessions();
  if (opts.project) {
    const p = opts.project;
    sessions = sessions.filter(s =>
      s.project.name === p
      || s.project.decodedPath === p
      || s.project.basename === p
      || s.project.name === encodeProjectPath(p)
    );
  }

  const since = parseDateArg("list --since", opts.since, -Infinity);
  const until = parseDateArg("list --until", opts.until, Infinity);
  sessions = sessions.filter(s => s.mtime.getTime() >= since && s.mtime.getTime() <= until);

  const sort = opts.sort ?? "recent";
  const VALID_SORTS = new Set(["recent", "oldest", "size"]);
  if (!VALID_SORTS.has(sort)) throw new Error(`list: invalid --sort value "${sort}" (expected: recent, oldest, size)`);
  if (sort === "recent") sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  else if (sort === "oldest") sessions.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
  else if (sort === "size") sessions.sort((a, b) => b.size - a.size);

  const limit = opts.limit ?? 50;
  sessions = sessions.slice(0, limit);

  const rows: Row[] = [];
  for (const s of sessions) rows.push(await summarize(s));

  if (opts.json) return JSON.stringify(rows, null, 2);
  return renderTable(rows, !!opts.project, !!opts.plain, sort === "size");
}

async function summarize(s: { shortId: string; sessionId: string; project: { decodedPath: string; basename: string }; path: string; mtime: Date; size: number }): Promise<Row> {
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let messages = 0;
  let title = "";
  let model: string | null = null;
  let customTitle = "";
  let aiTitle = "";
  let firstUserText = "";

  // Walk the whole file — could be big. For `list` it's worth it for accurate
  // counts + timestamps. If perf becomes a problem we'll short-circuit.
  for await (const { line } of streamJsonl(s.path)) {
    if (line.type === "custom-title") {
      const ct = (line as any).customTitle;
      if (typeof ct === "string" && ct.trim()) customTitle = ct.trim();
      continue;
    }
    if (line.type === "ai-title") {
      const at = (line as any).aiTitle;
      if (typeof at === "string" && at.trim()) aiTitle = at.trim();
      continue;
    }
    if (line.type === "summary" && !aiTitle) {
      const sm = (line as any).summary;
      if (typeof sm === "string" && sm.trim()) aiTitle = sm.trim();
      continue;
    }
    if (isUser(line) || isAssistant(line)) {
      messages++;
      if (line.timestamp) {
        if (!firstTs) firstTs = line.timestamp;
        lastTs = line.timestamp;
      }
      if (!model && isAssistant(line)) model = (line as AssistantLine).message?.model ?? null;
      if (!firstUserText && isUser(line)) firstUserText = firstUserTextFrom(line as any);
    }
  }
  title = customTitle || aiTitle || truncate(firstUserText, 60);

  return {
    shortId: s.shortId,
    sessionId: s.sessionId,
    project: s.project.decodedPath,
    projectBasename: s.project.basename,
    started: firstTs,
    durationMs: firstTs && lastTs ? Math.max(0, new Date(lastTs).getTime() - new Date(firstTs).getTime()) : null,
    messages,
    title,
    model,
    path: s.path,
    size: s.size,
  };
}

function firstUserTextFrom(line: LogLine): string {
  const bs = contentBlocks((line as any).message);
  for (const b of bs) {
    if (b.type === "text") return (b as any).text.replace(/\s+/g, " ").trim();
  }
  return "";
}

function truncate(s: string, n: number): string {
  if (!s) return "(untitled)";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function renderTable(rows: Row[], scoped: boolean, plain: boolean, showSize: boolean): string {
  if (!rows.length) return "(no sessions match)\n";
  const lines: string[] = [];
  if (!plain) lines.push(`# Sessions (${rows.length})\n`);
  for (const r of rows) {
    const date = r.started ? r.started.slice(0, 10) : "????-??-??";
    const dur = r.durationMs ? humanShort(r.durationMs) : "";
    const sz = showSize ? ` · ${humanBytes(r.size)}` : "";
    const head = `- \`${r.shortId}\` · ${date} · ${r.messages} msg${dur ? ` · ${dur}` : ""}${sz}${r.model ? ` · ${r.model.replace(/^claude-/, "")}` : ""}${!scoped ? ` · ${r.projectBasename}` : ""}`;
    lines.push(head);
    if (r.title) lines.push(`    ${r.title}`);
  }
  return lines.join("\n") + "\n";
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}M`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function humanShort(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 1) return `${h}h${m ? ` ${m}m` : ""}`;
  if (m >= 1) return `${m}m`;
  return `${s}s`;
}
