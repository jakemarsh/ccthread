import { listAllSessions, encodeProjectPath } from "../paths.ts";
import { streamJsonl } from "../parser/stream.ts";
import { contentBlocks, isAssistant, isUser, type LogLine } from "../parser/types.ts";

export interface FindOptions {
  project?: string;
  limit?: number;
  snippetLen?: number;
  json?: boolean;
  plain?: boolean;
}

interface Hit {
  shortId: string;
  sessionId: string;
  project: string;
  projectBasename: string;
  started: string | null;
  title: string;
  snippet: string;
  path: string;
}

export async function runFind(query: string, opts: FindOptions = {}): Promise<string> {
  if (!query) throw new Error("find: missing query");
  const q = query.toLowerCase();
  const snippetLen = opts.snippetLen ?? 60;

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
  sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const hits: Hit[] = [];
  const limit = opts.limit ?? 20;

  // Scan files in batches to avoid opening thousands at once.
  const BATCH = 8;
  for (let i = 0; i < sessions.length && hits.length < limit; i += BATCH) {
    const batch = sessions.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async s => {
      try { return await scanOne(s.path, q, snippetLen); }
      catch (e) {
        process.stderr.write(`warn: could not scan ${s.path}: ${e instanceof Error ? e.message : e}\n`);
        return null;
      }
    }));
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (!r) continue;
      const s = batch[j]!;
      hits.push({
        shortId: s.shortId,
        sessionId: s.sessionId,
        project: s.project.decodedPath,
        projectBasename: s.project.basename,
        started: r.started,
        title: r.title,
        snippet: r.snippet,
        path: s.path,
      });
      if (hits.length >= limit) break;
    }
  }

  if (opts.json) return JSON.stringify(hits, null, 2);
  if (!hits.length) return "(no matches)\n";

  const lines: string[] = [];
  if (!opts.plain) lines.push(`# Matches for "${query}" (${hits.length})\n`);
  for (const h of hits) {
    const date = h.started ? h.started.slice(0, 16).replace("T", " ") : "????-??-?? ??:??";
    lines.push(`- \`${h.shortId}\` · ${date} · ${h.projectBasename} — ${h.title || "(untitled)"}`);
    lines.push(`  > …${h.snippet}…`);
  }
  return lines.join("\n") + "\n";
}

async function scanOne(path: string, q: string, snippetLen: number): Promise<{ started: string | null; title: string; snippet: string } | null> {
  let started: string | null = null;
  let firstUserText = "";
  let customTitle = "";
  let aiTitle = "";
  let snippet: string | null = null;

  for await (const { line } of streamJsonl(path)) {
    const ts = (line as any).timestamp;
    if (ts && !started && (isUser(line) || isAssistant(line))) started = ts;
    if ((line as any).type === "custom-title") {
      const ct = (line as any).customTitle;
      if (typeof ct === "string" && ct.trim()) customTitle = ct.trim();
      continue;
    }
    if ((line as any).type === "ai-title") {
      const at = (line as any).aiTitle;
      if (typeof at === "string" && at.trim()) aiTitle = at.trim();
      continue;
    }
    if ((line as any).type === "summary" && !aiTitle) {
      const sm = (line as any).summary;
      if (typeof sm === "string" && sm.trim()) aiTitle = sm.trim();
      continue;
    }
    if (snippet) continue; // keep first match's snippet
    const text = extractText(line);
    if (!text) continue;
    const low = text.toLowerCase();
    const idx = low.indexOf(q);
    if (idx >= 0) {
      if (!firstUserText && isUser(line)) firstUserText = text.replace(/\s+/g, " ").trim().slice(0, 60);
      const start = Math.max(0, idx - Math.floor(snippetLen / 2));
      const end = Math.min(text.length, idx + q.length + Math.floor(snippetLen / 2));
      snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
    }
    if (!firstUserText && isUser(line)) {
      firstUserText = text.replace(/\s+/g, " ").trim().slice(0, 60);
    }
  }
  if (!snippet) return null;
  return { started, title: customTitle || aiTitle || firstUserText, snippet };
}

function extractText(line: LogLine): string {
  if (!isUser(line) && !isAssistant(line)) return "";
  const blocks = contentBlocks((line as any).message);
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "text") out.push((b as any).text ?? "");
    else if (b.type === "thinking") out.push((b as any).thinking ?? "");
    else if (b.type === "tool_use") out.push(JSON.stringify((b as any).input ?? {}));
    else if (b.type === "tool_result") {
      const c = (b as any).content;
      if (typeof c === "string") out.push(c);
      else if (Array.isArray(c)) for (const x of c) if ((x as any).type === "text") out.push((x as any).text ?? "");
    }
  }
  return out.join("\n");
}
