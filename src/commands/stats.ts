import { listAllSessions, encodeProjectPath } from "../paths.ts";
import { streamJsonl } from "../parser/stream.ts";
import { isAssistant, isSystem, isUser, type AssistantLine, type LogLine } from "../parser/types.ts";
import { accumulateTokens, humanDuration, renderTokens } from "../format/markdown.ts";

export interface StatsOptions {
  project?: string;
  since?: string;
  until?: string;
  groupBy?: "project" | "day" | "model";
  json?: boolean;
  plain?: boolean;
}

interface Agg {
  sessions: number;
  messages: number;
  durationMs: number;
  roles: Record<string, number>;
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
  tools: Record<string, number>;
  models: Record<string, number>;
  interrupted: number;
  apiErrors: number;
  compactBoundaries: number;
}

function newAgg(): Agg {
  return {
    sessions: 0, messages: 0, durationMs: 0,
    roles: {}, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    tools: {}, models: {}, interrupted: 0, apiErrors: 0, compactBoundaries: 0,
  };
}

export async function runStats(opts: StatsOptions = {}): Promise<string> {
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
  const since = opts.since ? new Date(opts.since).getTime() : -Infinity;
  const until = opts.until ? new Date(opts.until).getTime() : Infinity;
  sessions = sessions.filter(s => s.mtime.getTime() >= since && s.mtime.getTime() <= until);

  if (opts.groupBy) {
    const VALID_GB = new Set(["project", "day", "model"]);
    if (!VALID_GB.has(opts.groupBy)) throw new Error(`stats: invalid --group-by "${opts.groupBy}" (expected: project, day, model)`);
  }

  const groups = new Map<string, Agg>();
  const overall = newAgg();

  for (const s of sessions) {
    overall.sessions++;
    const perSession = await aggregate(s.path);
    merge(overall, perSession);

    if (opts.groupBy) {
      const keys: string[] = [];
      if (opts.groupBy === "project") keys.push(s.project.basename);
      else if (opts.groupBy === "day") keys.push(s.mtime.toISOString().slice(0, 10));
      else if (opts.groupBy === "model") {
        const ms = Object.keys(perSession.models);
        if (ms.length === 0) keys.push("unknown");
        else keys.push(...ms);
      }
      for (const k of keys) {
        let a = groups.get(k);
        if (!a) { a = newAgg(); groups.set(k, a); }
        a.sessions++;
        merge(a, perSession);
      }
    }
  }

  if (opts.json) {
    return JSON.stringify({
      scope: { project: opts.project ?? null, since: opts.since ?? null, until: opts.until ?? null },
      overall,
      groups: opts.groupBy ? Object.fromEntries(groups) : undefined,
    }, null, 2);
  }

  return renderText(overall, opts.groupBy ? groups : null, opts);
}

async function aggregate(path: string): Promise<Agg> {
  const a = newAgg();
  const toks = accumulateTokens();
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  for await (const { line } of streamJsonl(path)) {
    a.roles[line.type] = (a.roles[line.type] ?? 0) + 1;
    if (line.timestamp) {
      if (!firstTs) firstTs = line.timestamp;
      lastTs = line.timestamp;
    }
    if (isUser(line) || isAssistant(line)) a.messages++;
    if (isAssistant(line)) {
      const m = (line as AssistantLine).message?.model;
      if (m) a.models[m] = (a.models[m] ?? 0) + 1;
      toks.add(line as AssistantLine);
      for (const b of (line as any).message?.content ?? []) {
        if (b?.type === "tool_use") a.tools[b.name] = (a.tools[b.name] ?? 0) + 1;
      }
    }
    if (isSystem(line)) {
      if ((line as any).subtype === "api_error") a.apiErrors++;
      if ((line as any).subtype === "compact_boundary") a.compactBoundaries++;
    }
    if (isUser(line)) {
      const blocks = (line as any).message?.content;
      const text = Array.isArray(blocks)
        ? blocks.map((b: any) => b?.type === "text" ? b.text ?? "" : "").join("")
        : typeof blocks === "string" ? blocks : "";
      if (text.includes("[Request interrupted by user]")) a.interrupted++;
    }
  }
  a.tokens = toks.total;
  a.durationMs = firstTs && lastTs ? new Date(lastTs).getTime() - new Date(firstTs).getTime() : 0;
  return a;
}

function merge(dst: Agg, src: Agg) {
  dst.messages += src.messages;
  dst.durationMs += src.durationMs;
  dst.tokens.input += src.tokens.input;
  dst.tokens.output += src.tokens.output;
  dst.tokens.cacheRead += src.tokens.cacheRead;
  dst.tokens.cacheCreate += src.tokens.cacheCreate;
  dst.interrupted += src.interrupted;
  dst.apiErrors += src.apiErrors;
  dst.compactBoundaries += src.compactBoundaries;
  for (const [k, v] of Object.entries(src.roles)) dst.roles[k] = (dst.roles[k] ?? 0) + v;
  for (const [k, v] of Object.entries(src.tools)) dst.tools[k] = (dst.tools[k] ?? 0) + v;
  for (const [k, v] of Object.entries(src.models)) dst.models[k] = (dst.models[k] ?? 0) + v;
}

function renderText(overall: Agg, groups: Map<string, Agg> | null, opts: StatsOptions): string {
  const lines: string[] = [];
  const scope = opts.project ? ` (project: ${opts.project})` : "";
  lines.push(`# Stats${scope}`);
  lines.push(renderAgg(overall));
  if (groups && groups.size) {
    lines.push("");
    lines.push(`## By ${opts.groupBy}`);
    const rows = [...groups.entries()].sort((a, b) => b[1].sessions - a[1].sessions);
    lines.push("| key | sessions | msgs | tokens |");
    lines.push("|---|---|---|---|");
    for (const [k, a] of rows) {
      lines.push(`| ${k} | ${a.sessions} | ${a.messages} | ${renderTokens(a.tokens)} |`);
    }
  }
  return lines.join("\n") + "\n";
}

function renderAgg(a: Agg): string {
  const topTools = Object.entries(a.tools).sort((x, y) => y[1] - x[1]).slice(0, 8)
    .map(([k, v]) => `${k} ${v}`).join(", ");
  const topModels = Object.entries(a.models).sort((x, y) => y[1] - x[1]).slice(0, 4)
    .map(([k, v]) => {
      const name = k.replace(/^claude-/, "");
      const pct = Math.round((v * 100) / Object.values(a.models).reduce((s, n) => s + n, 0));
      return `${name} (${pct}%)`;
    }).join(", ");
  const lines = [
    `- Sessions: ${a.sessions.toLocaleString()}, messages: ${a.messages.toLocaleString()}, duration: ${humanDuration(a.durationMs)}`,
    `- Roles: ${Object.entries(a.roles).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    `- Tokens: ${renderTokens(a.tokens)}`,
  ];
  if (topTools) lines.push(`- Top tools: ${topTools}`);
  if (topModels) lines.push(`- Models: ${topModels}`);
  if (a.interrupted || a.apiErrors || a.compactBoundaries) {
    lines.push(`- Interrupted: ${a.interrupted} · API errors: ${a.apiErrors} · Compact boundaries: ${a.compactBoundaries}`);
  }
  return lines.join("\n");
}
