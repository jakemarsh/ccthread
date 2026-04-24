#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from "citty";
import { runProjects } from "./commands/projects.ts";
import { runList } from "./commands/list.ts";
import { runShow } from "./commands/show.ts";
import { runFind } from "./commands/find.ts";
import { runSearch } from "./commands/search.ts";
import { runInfo } from "./commands/info.ts";
import { runTools } from "./commands/tools.ts";
import { runStats } from "./commands/stats.ts";
import { runCurrent } from "./commands/current.ts";
import { SessionAmbiguousError, SessionNotFoundError, NoProjectsDirError, CurrentSessionUndetectableError } from "./paths.ts";

// Version is baked by bun build --define; fall back for `bun run`.
declare const CCTHREAD_VERSION: string;
const VERSION = typeof CCTHREAD_VERSION === "string" ? CCTHREAD_VERSION : "0.1.0-dev";

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const projects = defineCommand({
  meta: { name: "projects", description: "List every project under ~/.claude/projects with session counts + last-active time." },
  args: {
    json: { type: "boolean", default: false, description: "Emit a JSON array instead of markdown." },
    plain: { type: "boolean", default: false, description: "Strip markdown formatting (useful for grep)." },
  },
  async run({ args }) {
    process.stdout.write(await runProjects({ json: args.json, plain: args.plain }));
  },
});

const list = defineCommand({
  meta: { name: "list", description: "List conversations (sessions) with metadata: id, start, duration, #messages, model, title." },
  args: {
    project: { type: "string", description: "Filter to one project — accepts basename, decoded path, or on-disk encoded name." },
    since: { type: "string", description: "Only sessions last-modified on or after this ISO date/time (e.g. 2026-04-01)." },
    until: { type: "string", description: "Only sessions last-modified on or before this ISO date/time." },
    limit: { type: "string", description: "Max sessions to return (default 50)." },
    sort: { type: "string", description: "Sort order: recent (default), oldest, or size." },
    json: { type: "boolean", default: false, description: "Emit JSON array." },
    plain: { type: "boolean", default: false, description: "Strip markdown formatting." },
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
  meta: { name: "show", description: "Print one conversation as clean, paginated markdown." },
  args: {
    id: { type: "positional", required: true, description: "Session id (8+ hex prefix or full UUID), .jsonl path, or the literal 'last'." },
    page: { type: "string", description: "1-indexed page to render (default 1)." },
    "per-page": { type: "string", description: "Messages per page (default 50)." },
    from: { type: "string", description: "Render messages starting at this 0-indexed position (alternative to --page)." },
    to: { type: "string", description: "Render messages up to but not including this 0-indexed position." },
    "no-thinking": { type: "boolean", default: false, description: "Hide thinking blocks (shown by default)." },
    "include-sidechains": { type: "boolean", default: false, description: "Inline subagent sidechain messages (hidden by default)." },
    "tool-details": { type: "string", description: "Tool-result rendering: brief (default, 40-line truncation), full (no truncation), or none (hide bodies, show one-line status)." },
    "count-total": { type: "boolean", default: false, description: "Pre-scan to compute total message count (enables accurate 'Page N of M'). Costs one extra read of the file." },
    "before-last-compact": { type: "boolean", default: false, description: "Only render messages from before the session's most recent /compact. Use with id 'current' to answer 'before we compacted, what did you say?' questions." },
    verbose: { type: "boolean", default: false, description: "Also show hook/progress/attachment noise usually filtered." },
    utc: { type: "boolean", default: false, description: "Format timestamps in UTC instead of local time." },
    plain: { type: "boolean", default: false, description: "Strip emoji + code-fence language hints." },
    json: { type: "boolean", default: false, description: "Emit a structured JSON object (session metadata + rendered body)." },
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
      beforeLastCompact: args["before-last-compact"],
      verbose: args.verbose,
      utc: args.utc,
      plain: args.plain,
      json: args.json,
    }));
  },
});

const find = defineCommand({
  meta: { name: "find", description: "Find conversations that mention a keyword — one line per match. Lighter than `search`; great for 'which old thread was X in?'" },
  args: {
    query: { type: "positional", required: true, description: "Substring to look for (case-insensitive). Quote it to protect shell chars." },
    project: { type: "string", description: "Only search within one project." },
    limit: { type: "string", description: "Max matching sessions to return (default 20)." },
    "snippet-len": { type: "string", description: "Characters of surrounding context in the one-line snippet (default 60)." },
    json: { type: "boolean", default: false, description: "Emit JSON array of hits." },
    plain: { type: "boolean", default: false, description: "Strip markdown formatting." },
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
  meta: { name: "search", description: "Keyword search across sessions with ±N messages of context around each hit. Use `find` if you only want session-level hits." },
  args: {
    query: { type: "positional", required: true, description: "Substring to search for (or regex when --regex)." },
    project: { type: "string", description: "Only search within one project." },
    session: { type: "string", description: "Only search within one session (id or path)." },
    since: { type: "string", description: "Only sessions modified on or after this ISO date/time." },
    until: { type: "string", description: "Only sessions modified on or before this ISO date/time." },
    window: { type: "string", description: "Messages before AND after each hit to include (default 2)." },
    limit: { type: "string", description: "Max sessions to return (default 20)." },
    "max-matches-per-session": { type: "string", description: "Cap hits emitted per session (default 5)." },
    regex: { type: "boolean", default: false, description: "Treat query as an ECMAScript regular expression." },
    "case-sensitive": { type: "boolean", default: false, description: "Case-sensitive match (default: insensitive)." },
    role: { type: "string", description: "Restrict to one role: user, assistant, tool_use, tool_result, thinking, or any (default any)." },
    fields: { type: "string", description: "Comma-separated fields to search within message content (default: text,tool_use,tool_result). Add 'thinking' to include reasoning blocks." },
    sort: { type: "string", description: "Session ordering: recent (default), oldest, or hits." },
    "include-sidechains": { type: "boolean", default: false, description: "Include subagent sidechain messages in the search scope." },
    "before-last-compact": { type: "boolean", default: false, description: "Restrict the scope to messages that happened before each session's most recent /compact." },
    json: { type: "boolean", default: false, description: "Emit JSON with match metadata + windows." },
    plain: { type: "boolean", default: false, description: "Strip markdown formatting." },
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
      beforeLastCompact: args["before-last-compact"],
      json: args.json,
      plain: args.plain,
    }));
  },
});

const info = defineCommand({
  meta: { name: "info", description: "Show metadata for one conversation: project, cwd, git branch, models, duration, message counts by type, token totals, tool calls, sidechain/interrupted/api-error/compact-boundary counts." },
  args: {
    id: { type: "positional", required: true, description: "Session id (8+ hex prefix or full UUID), .jsonl path, or 'last'." },
    json: { type: "boolean", default: false, description: "Emit structured JSON." },
    plain: { type: "boolean", default: false, description: "Strip markdown formatting." },
  },
  async run({ args }) {
    process.stdout.write(await runInfo(args.id, { json: args.json, plain: args.plain }));
  },
});

const tools = defineCommand({
  meta: { name: "tools", description: "Tool-usage breakdown for one conversation (Bash, Read, Edit, etc.) with call counts + percentages." },
  args: {
    id: { type: "positional", required: true, description: "Session id, path, or 'last'." },
    top: { type: "string", description: "Show only the top N tools by calls (default 20)." },
    json: { type: "boolean", default: false, description: "Emit structured JSON." },
    plain: { type: "boolean", default: false, description: "Strip markdown formatting." },
  },
  async run({ args }) {
    process.stdout.write(await runTools(args.id, { top: num(args.top), json: args.json, plain: args.plain }));
  },
});

const stats = defineCommand({
  meta: { name: "stats", description: "Aggregate totals across many sessions: counts, durations, token usage (incl. cache), top tools, models, error/interrupt/compact counts." },
  args: {
    project: { type: "string", description: "Only count sessions in one project." },
    since: { type: "string", description: "Only sessions modified on or after this ISO date/time." },
    until: { type: "string", description: "Only sessions modified on or before this ISO date/time." },
    "group-by": { type: "string", description: "Break totals down by: project, day, or model." },
    json: { type: "boolean", default: false, description: "Emit structured JSON (includes per-group breakdowns)." },
    plain: { type: "boolean", default: false, description: "Strip markdown formatting." },
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

const current = defineCommand({
  meta: { name: "current", description: "Print the session id of the Claude Code session that invoked this command. Detected via parent-process argv or the plugin's SessionStart hook. Use 'current' as a session id with show/info/search/tools." },
  args: {
    json: { type: "boolean", default: false, description: "Emit structured JSON." },
    plain: { type: "boolean", default: false, description: "Strip markdown formatting." },
  },
  async run({ args }) {
    process.stdout.write(await runCurrent({ json: args.json, plain: args.plain }));
  },
});

const main = defineCommand({
  meta: {
    name: "ccthread",
    version: VERSION,
    description: "Read, search, and summarize Claude Code conversation logs from ~/.claude/projects/.\n\nExamples:\n  ccthread projects                         # list projects\n  ccthread list --project great-work        # list recent sessions\n  ccthread find \"rate limit\"                # which old thread mentioned it?\n  ccthread show <id> --page 2               # paginate through a long session\n  ccthread search \"port 3000\" --window 2    # grep with context\n  ccthread info <id>                        # session metadata + token usage\n  ccthread tools <id>                       # tool-call breakdown\n  ccthread stats --since 2026-04-01         # aggregate totals",
  },
  args: {
    strict: { type: "boolean", default: false, description: "Fail fast on malformed JSON lines (default: warn + continue)." },
    silent: { type: "boolean", default: false, description: "Suppress stderr warnings about malformed lines." },
  },
  setup({ args }) {
    if (args.strict) process.env.CCTHREAD_STRICT = "1";
    if (args.silent) process.env.CCTHREAD_SILENT = "1";
  },
  subCommands: { projects, list, show, find, search, info, tools, stats, current },
});

// Handle --help / -h / --version explicitly since citty's runCommand won't
// run the automatic help/version handlers without a `run` function on main.
const argv = process.argv.slice(2);
const wantsHelp = argv.includes("--help") || argv.includes("-h");
const wantsVersion = argv.includes("--version") || argv.includes("-v");
if (argv.length === 0 || (wantsHelp && argv.every(a => a.startsWith("-")))) {
  await showUsage(main);
  process.exit(0);
}
if (wantsVersion && argv.every(a => a.startsWith("-"))) {
  process.stdout.write(VERSION + "\n");
  process.exit(0);
}
if (wantsHelp) {
  // Subcommand help: find the sub and showUsage on it.
  const subName = argv.find(a => !a.startsWith("-"));
  const subs = (main as any).subCommands;
  const sub = subName ? await resolveSub(subs, subName) : null;
  if (sub) {
    await showUsage(sub, main);
    process.exit(0);
  }
}

async function resolveSub(subs: Record<string, unknown>, name: string): Promise<any | null> {
  if (!subs || typeof subs !== "object") return null;
  const v = (subs as any)[name];
  if (!v) return null;
  return typeof v === "function" ? await v() : v;
}

try {
  await runCommand(main, { rawArgs: argv });
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
    process.stderr.write(`ccthread: ${err.message}\n`);
    process.exit(1);
  }
  if (err instanceof CurrentSessionUndetectableError) {
    process.stderr.write(`ccthread: ${err.message}\n`);
    process.exit(3);
  }
  // Missing required positional or unknown argument from citty → exit 2
  // (usage error, per sysexits.h EX_USAGE=64 in spirit).
  const msg = err instanceof Error ? err.message : String(err);
  if (/Missing required (?:positional )?argument/i.test(msg)
      || /Unknown (?:command|argument|option)/i.test(msg)
      || /Invalid regular expression/i.test(msg)
      || /invalid --/i.test(msg)
      || /is not a valid date/i.test(msg)
      || /must be >=/.test(msg)) {
    process.stderr.write(`ccthread: ${msg}\n`);
    process.exit(2);
  }
  process.stderr.write(`ccthread: ${msg}\n`);
  process.exit(1);
}
