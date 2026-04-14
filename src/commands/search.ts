import { listAllSessions, encodeProjectPath, resolveSession } from "../paths.ts";
import { streamJsonl } from "../parser/stream.ts";
import { renderLine, fmtTime } from "../format/markdown.ts";
import { contentBlocks, isAssistant, isUser, type LogLine } from "../parser/types.ts";

export interface SearchOptions {
  project?: string;
  session?: string;
  since?: string;
  until?: string;
  window?: number;
  limit?: number;
  maxMatchesPerSession?: number;
  regex?: boolean;
  caseSensitive?: boolean;
  role?: "user" | "assistant" | "tool_use" | "tool_result" | "thinking" | "any";
  fields?: string; // e.g. "text,tool_use,tool_result"
  sort?: "recent" | "oldest" | "hits";
  includeSidechains?: boolean;
  json?: boolean;
  plain?: boolean;
}

interface Match {
  sessionShort: string;
  sessionId: string;
  project: string;
  timestamp: string | null;
  msgIndex: number;
  role: string;
  snippet: string;
  window: string[];
}

export async function runSearch(query: string, opts: SearchOptions = {}): Promise<string> {
  if (!query) throw new Error("search: missing query");

  if (opts.role && opts.role !== "any") {
    const VALID_ROLES = new Set(["user", "assistant", "tool_use", "tool_result", "thinking"]);
    if (!VALID_ROLES.has(opts.role)) throw new Error(`search: invalid --role "${opts.role}" (expected: user, assistant, tool_use, tool_result, thinking, any)`);
  }

  const fields = (opts.fields ?? "text,tool_use,tool_result").split(",").map(s => s.trim()).filter(Boolean);
  const VALID_FIELDS = new Set(["text", "tool_use", "tool_result", "thinking"]);
  for (const f of fields) if (!VALID_FIELDS.has(f)) throw new Error(`search: invalid --fields value "${f}" (expected one of: text, tool_use, tool_result, thinking)`);
  const window = opts.window ?? 2;
  const limit = opts.limit ?? 20;
  const maxPer = opts.maxMatchesPerSession ?? 5;
  const matcher = buildMatcher(query, opts);

  let sessions = opts.session
    ? [await resolveSession(opts.session, { projectFilter: opts.project })]
    : await listAllSessions();
  if (!opts.session && opts.project) {
    const p = opts.project;
    sessions = sessions.filter(s =>
      s.project.name === p
      || s.project.decodedPath === p
      || s.project.basename === p
      || s.project.name === encodeProjectPath(p)
    );
  }

  const since = opts.since ? new Date(opts.since).getTime() : -Infinity;
  const until = opts.until ? new Date(opts.until).getTime() : Infinity;
  sessions = sessions.filter(s => s.mtime.getTime() >= since && s.mtime.getTime() <= until);

  const sort = opts.sort ?? "recent";
  const VALID_SORTS = new Set(["recent", "oldest", "hits"]);
  if (!VALID_SORTS.has(sort)) throw new Error(`search: invalid --sort value "${sort}" (expected: recent, oldest, hits)`);
  if (sort === "recent") sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  else if (sort === "oldest") sessions.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

  const results: { session: typeof sessions[number]; matches: Match[] }[] = [];
  let sessionsHit = 0;
  for (const s of sessions) {
    if (sessionsHit >= limit) break;
    const m = await scanSession(s.path, s.shortId, s.sessionId, s.project.decodedPath, matcher, fields, window, maxPer, opts);
    if (m.length) { results.push({ session: s, matches: m }); sessionsHit++; }
  }

  if (opts.json) return JSON.stringify(results.map(r => ({ session: r.session.shortId, project: r.session.project.decodedPath, matches: r.matches })), null, 2);

  if (!results.length) return "(no matches)\n";
  if (sort === "hits") results.sort((a, b) => b.matches.length - a.matches.length);

  const lines: string[] = [];
  if (!opts.plain) lines.push(`# Search "${query}" — ${results.length} session${results.length === 1 ? "" : "s"}\n`);
  for (const { session, matches } of results) {
    lines.push(`## ${session.shortId} · ${session.project.basename} (${matches.length} hit${matches.length === 1 ? "" : "s"})`);
    for (const m of matches) {
      const t = m.timestamp ? fmtTime(m.timestamp, false) : "??:??:??";
      lines.push(`\n### Match: "${query}" @ msg ${m.msgIndex + 1} (${t})`);
      lines.push(m.window.join("\n\n"));
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function buildMatcher(query: string, opts: SearchOptions): (s: string) => boolean {
  if (opts.regex) {
    const flags = opts.caseSensitive ? "" : "i";
    const re = new RegExp(query, flags);
    return s => re.test(s);
  }
  if (opts.caseSensitive) {
    return s => s.includes(query);
  }
  const q = query.toLowerCase();
  return s => s.toLowerCase().includes(q);
}

async function scanSession(
  path: string,
  shortId: string,
  sessionId: string,
  project: string,
  matches: (s: string) => boolean,
  fields: string[],
  window: number,
  maxPer: number,
  opts: SearchOptions
): Promise<Match[]> {
  // Read the whole session into memory as an array of rendered-message entries.
  // We need random access to build ±window slices. Session files are usually
  // small enough for this (tens to a few thousand messages); huge ones are the
  // edge case.
  const entries: { line: LogLine; rendered: string | null; role: string; index: number; timestamp: string | null }[] = [];
  let idx = 0;
  for await (const { line } of streamJsonl(path)) {
    if (line.isSidechain && !opts.includeSidechains) continue;
    if (isUser(line) || isAssistant(line)) {
      const r = renderLine(line, { idx, totalRendered: 0, opts: { sessionPath: path } });
      // Flatten all stages produced by this line into one string for the window.
      const rendered = r.stages.map(s => s.body).join("\n\n");
      entries.push({
        line, rendered, index: idx,
        role: isUser(line) ? "user" : "assistant",
        timestamp: (line as any).timestamp ?? null,
      });
      if (r.countsAsMessage) idx++;
    }
  }

  const hits: Match[] = [];
  for (let i = 0; i < entries.length && hits.length < maxPer; i++) {
    const e = entries[i]!;
    if (opts.role && opts.role !== "any" && e.role !== opts.role) continue;
    const searchable = extractSearchable(e.line, fields);
    if (!matches(searchable)) continue;
    const snippet = buildSnippet(searchable, matches);
    const lo = Math.max(0, i - window);
    const hi = Math.min(entries.length, i + window + 1);
    const win: string[] = [];
    for (let k = lo; k < hi; k++) {
      if (entries[k]!.rendered) win.push(entries[k]!.rendered!);
    }
    hits.push({
      sessionShort: shortId,
      sessionId,
      project,
      timestamp: e.timestamp,
      msgIndex: e.index,
      role: e.role,
      snippet,
      window: win,
    });
  }
  return hits;
}

function extractSearchable(line: LogLine, fields: string[]): string {
  if (!isUser(line) && !isAssistant(line)) return "";
  const blocks = contentBlocks((line as any).message);
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "text" && fields.includes("text")) out.push((b as any).text);
    if (b.type === "thinking" && fields.includes("thinking")) out.push((b as any).thinking);
    if (b.type === "tool_use" && fields.includes("tool_use")) out.push(JSON.stringify((b as any).input ?? {}));
    if (b.type === "tool_result" && fields.includes("tool_result")) {
      const c = (b as any).content;
      if (typeof c === "string") out.push(c);
      else if (Array.isArray(c)) for (const x of c) if ((x as any).type === "text") out.push((x as any).text);
    }
  }
  return out.join("\n");
}

function buildSnippet(text: string, matches: (s: string) => boolean): string {
  const line = text.split("\n").find(l => matches(l)) ?? text;
  return line.replace(/\s+/g, " ").trim().slice(0, 160);
}
