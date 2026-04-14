#!/usr/bin/env bun
import { defineCommand, runCommand } from "citty";
import { runProjects } from "./commands/projects.ts";
import { runList } from "./commands/list.ts";
import { runShow } from "./commands/show.ts";
import { runFind } from "./commands/find.ts";
import { runSearch } from "./commands/search.ts";
import { runInfo } from "./commands/info.ts";
import { runTools } from "./commands/tools.ts";
import { runStats } from "./commands/stats.ts";
import { SessionAmbiguousError, SessionNotFoundError, NoProjectsDirError } from "./paths.ts";

// Version is baked by bun build --define; fall back for `bun run`.
declare const CCTHREAD_VERSION: string;
const VERSION = typeof CCTHREAD_VERSION === "string" ? CCTHREAD_VERSION : "0.1.0-dev";

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const projects = defineCommand({
  meta: { name: "projects", description: "List projects in ~/.claude/projects/" },
  args: {
    json: { type: "boolean", default: false },
    plain: { type: "boolean", default: false },
  },
  async run({ args }) {
    process.stdout.write(await runProjects({ json: args.json, plain: args.plain }));
  },
});

const list = defineCommand({
  meta: { name: "list", description: "List conversations" },
  args: {
    project: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    limit: { type: "string" },
    sort: { type: "string", description: "recent|oldest|size" },
    json: { type: "boolean", default: false },
    plain: { type: "boolean", default: false },
  },
  async run({ args }) {
    process.stdout.write(await runList({
      project: args.project,
      since: args.since,
      until: args.until,
      limit: num(args.limit),
      sort: args.sort as any,
      json: args.json,
      plain: args.plain,
    }));
  },
});

const show = defineCommand({
  meta: { name: "show", description: "Print a conversation as markdown" },
  args: {
    id: { type: "positional", required: true, description: "session id, prefix, path, or 'last'" },
    page: { type: "string" },
    "per-page": { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    "no-thinking": { type: "boolean", default: false },
    "include-sidechains": { type: "boolean", default: false },
    "tool-details": { type: "string", description: "full|summary|none" },
    "count-total": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    utc: { type: "boolean", default: false },
    plain: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
  async run({ args }) {
    process.stdout.write(await runShow(args.id, {
      page: num(args.page),
      perPage: num(args["per-page"]),
      from: num(args.from),
      to: num(args.to),
      noThinking: args["no-thinking"],
      includeSidechains: args["include-sidechains"],
      toolDetails: args["tool-details"] as any,
      countTotal: args["count-total"],
      verbose: args.verbose,
      utc: args.utc,
      plain: args.plain,
      json: args.json,
    }));
  },
});

const find = defineCommand({
  meta: { name: "find", description: "Find conversations by keyword (one line per session)" },
  args: {
    query: { type: "positional", required: true },
    project: { type: "string" },
    limit: { type: "string" },
    "snippet-len": { type: "string" },
    json: { type: "boolean", default: false },
    plain: { type: "boolean", default: false },
  },
  async run({ args }) {
    process.stdout.write(await runFind(args.query, {
      project: args.project,
      limit: num(args.limit),
      snippetLen: num(args["snippet-len"]),
      json: args.json,
      plain: args.plain,
    }));
  },
});

const search = defineCommand({
  meta: { name: "search", description: "Keyword search with context windows" },
  args: {
    query: { type: "positional", required: true },
    project: { type: "string" },
    session: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    window: { type: "string" },
    limit: { type: "string" },
    "max-matches-per-session": { type: "string" },
    regex: { type: "boolean", default: false },
    "case-sensitive": { type: "boolean", default: false },
    role: { type: "string" },
    fields: { type: "string" },
    sort: { type: "string" },
    "include-sidechains": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    plain: { type: "boolean", default: false },
  },
  async run({ args }) {
    process.stdout.write(await runSearch(args.query, {
      project: args.project,
      session: args.session,
      since: args.since,
      until: args.until,
      window: num(args.window),
      limit: num(args.limit),
      maxMatchesPerSession: num(args["max-matches-per-session"]),
      regex: args.regex,
      caseSensitive: args["case-sensitive"],
      role: args.role as any,
      fields: args.fields,
      sort: args.sort as any,
      includeSidechains: args["include-sidechains"],
      json: args.json,
      plain: args.plain,
    }));
  },
});

const info = defineCommand({
  meta: { name: "info", description: "Metadata for a conversation" },
  args: {
    id: { type: "positional", required: true },
    json: { type: "boolean", default: false },
    plain: { type: "boolean", default: false },
  },
  async run({ args }) {
    process.stdout.write(await runInfo(args.id, { json: args.json, plain: args.plain }));
  },
});

const tools = defineCommand({
  meta: { name: "tools", description: "Tool usage breakdown for one conversation" },
  args: {
    id: { type: "positional", required: true },
    top: { type: "string" },
    json: { type: "boolean", default: false },
    plain: { type: "boolean", default: false },
  },
  async run({ args }) {
    process.stdout.write(await runTools(args.id, { top: num(args.top), json: args.json, plain: args.plain }));
  },
});

const stats = defineCommand({
  meta: { name: "stats", description: "Aggregate stats across conversations" },
  args: {
    project: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    "group-by": { type: "string", description: "project|day|model" },
    json: { type: "boolean", default: false },
    plain: { type: "boolean", default: false },
  },
  async run({ args }) {
    process.stdout.write(await runStats({
      project: args.project,
      since: args.since,
      until: args.until,
      groupBy: args["group-by"] as any,
      json: args.json,
      plain: args.plain,
    }));
  },
});

const main = defineCommand({
  meta: {
    name: "ccthread",
    version: VERSION,
    description: "Read, search, and summarize Claude Code conversation logs.",
  },
  args: {
    strict: { type: "boolean", default: false, description: "Fail fast on malformed JSON lines" },
    silent: { type: "boolean", default: false, description: "Suppress stderr warnings" },
  },
  setup({ args }) {
    if (args.strict) process.env.CCTHREAD_STRICT = "1";
    if (args.silent) process.env.CCTHREAD_SILENT = "1";
  },
  subCommands: { projects, list, show, find, search, info, tools, stats },
});

try {
  await runCommand(main, { rawArgs: process.argv.slice(2) });
  process.exit(0);
} catch (err: unknown) {
  if (err instanceof SessionAmbiguousError) {
    process.stderr.write(`ccthread: ${err.message}\n`);
    for (const m of err.matches) process.stderr.write(`  ${m.shortId}  ${m.project.decodedPath}  ${m.path}\n`);
    process.exit(4);
  }
  if (err instanceof SessionNotFoundError) {
    process.stderr.write(`ccthread: ${err.message}\n`);
    process.exit(3);
  }
  if (err instanceof NoProjectsDirError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  // Missing required positional from citty → exit 2.
  const msg = err instanceof Error ? err.message : String(err);
  if (/required (?:positional )?argument/i.test(msg) || /missing/i.test(msg)) {
    process.stderr.write(`ccthread: ${msg}\n`);
    process.exit(2);
  }
  process.stderr.write(`ccthread: ${msg}\n`);
  process.exit(1);
}
