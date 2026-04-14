import {
  type LogLine, type UserLine, type AssistantLine, type SystemLine,
  type ContentBlock, type ToolUseBlock, type ToolResultBlock, type TextBlock,
  type ThinkingBlock, type ImageBlock,
  contentBlocks, isUser, isAssistant, isSystem,
} from "../parser/types.ts";
import { describeImage, truncateLines } from "./truncate.ts";
import { resolveOverflow } from "../parser/resolve.ts";

export interface RenderOptions {
  plain?: boolean;            // no emoji, no code-fence lang hints
  thinking?: boolean;         // default true; --no-thinking flips to false
  sidechains?: boolean;       // default false
  toolDetails?: "full" | "brief" | "none" | "summary" /* deprecated alias for brief */;
  verbose?: boolean;          // show hidden hook/attachment/etc lines
  utc?: boolean;
  sessionPath?: string;       // used for overflow resolution
  startIndex?: number;        // for "msg N/total" — index of first rendered message
  totalMessages?: number;     // total rendered-message count for header
}

const DEFAULTS: Required<Pick<RenderOptions, "thinking" | "sidechains" | "toolDetails" | "plain" | "verbose" | "utc">> = {
  plain: false,
  thinking: true,
  sidechains: false,
  toolDetails: "brief",
  verbose: false,
  utc: false,
};

// Emoji + role glyph by category.
const GLYPH = {
  user: "👤",
  assistant: "🤖",
  system: "⚙️",
  tool: "🧩",
  error: "⚠️",
  sidechain: "🧵",
  interrupt: "⏸",
  clock: "⏰",
  pr: "🔗",
} as const;

function emoji(name: keyof typeof GLYPH, opts: RenderOptions): string {
  return opts.plain ? "" : GLYPH[name];
}

// A stage in the document: any single rendered block we append to the output.
// Tool results are attached as extra blocks under the previous tool_use without
// bumping the rendered-message counter.
interface Stage {
  kind: "message" | "tool-result" | "note" | "rule";
  body: string;
}

export function fmtTime(iso: string | undefined, utc: boolean): string {
  if (!iso) return "??:??:??";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const h = String(utc ? d.getUTCHours() : d.getHours()).padStart(2, "0");
  const m = String(utc ? d.getUTCMinutes() : d.getMinutes()).padStart(2, "0");
  const s = String(utc ? d.getUTCSeconds() : d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "unknown";
  return iso.slice(0, 10);
}

function codeFence(lang: string | null, body: string, opts: RenderOptions): string {
  const open = opts.plain || !lang ? "```" : "```" + lang;
  return `${open}\n${body}\n\`\`\``;
}

export function renderTokens(total: { input: number; output: number; cacheRead: number; cacheCreate: number }): string {
  const inM = (total.input + total.cacheRead + total.cacheCreate) / 1_000_000;
  const outM = total.output / 1_000_000;
  const cached = total.input + total.cacheRead + total.cacheCreate;
  const pct = cached > 0 ? Math.round((total.cacheRead * 100) / cached) : 0;
  const inStr = inM >= 1 ? `${inM.toFixed(1)}M` : `${Math.round((total.input + total.cacheRead + total.cacheCreate) / 1000)}K`;
  const outStr = outM >= 1 ? `${outM.toFixed(1)}M` : `${Math.round(total.output / 1000)}K`;
  return `${inStr} in (${pct}% cached) / ${outStr} out`;
}

export interface DocHeaderInput {
  shortId: string;
  projectPath: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  durationMs?: number;
  totalMessages: number;
  model?: string;
  customTitle?: string;
  tokens?: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

export function renderDocHeader(h: DocHeaderInput, opts: RenderOptions = {}): string {
  const parts: string[] = [];
  parts.push(`# Conversation ${h.shortId}`);
  parts.push(`- **Project**: \`${h.projectPath}\``);
  if (h.firstTimestamp) {
    const ts = opts.utc ? h.firstTimestamp : new Date(h.firstTimestamp).toLocaleString();
    const dur = h.durationMs ? ` (${humanDuration(h.durationMs)}, ${h.totalMessages} messages)` : ` (${h.totalMessages} messages)`;
    parts.push(`- **Started**: ${ts}${dur}`);
  } else {
    parts.push(`- **Messages**: ${h.totalMessages}`);
  }
  if (h.model) parts.push(`- **Model**: ${h.model}`);
  if (h.tokens) parts.push(`- **Tokens**: ${renderTokens(h.tokens)}`);
  if (h.customTitle) parts.push(`- **Custom title**: "${h.customTitle}"`);
  return parts.join("\n") + "\n";
}

export function humanDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  const sec = s % 60;
  if (m >= 1) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export interface RenderLineResult {
  stages: Stage[];            // anything to append to output
  countsAsMessage: boolean;   // whether this bumps the rendered-message counter
}

export function renderLine(
  line: LogLine,
  context: { idx: number; totalRendered: number; opts: RenderOptions }
): RenderLineResult {
  const opts = { ...DEFAULTS, ...context.opts };
  // Sidechain filter (applies before type-specific rendering).
  if (line.isSidechain && !opts.sidechains) return { stages: [], countsAsMessage: false };

  switch (line.type) {
    case "user": return renderUser(line as UserLine, context.idx, context.totalRendered, opts);
    case "assistant": return renderAssistant(line as AssistantLine, context.idx, context.totalRendered, opts);
    case "system": return renderSystem(line as SystemLine, opts);
    case "permission-mode": {
      const mode = (line as any).permissionMode;
      return { stages: [{ kind: "note", body: `_Permission mode → ${mode}_` }], countsAsMessage: false };
    }
    case "pr-link": {
      const l = line as any;
      return {
        stages: [{ kind: "note", body: `${emoji("pr", opts)} PR link: ${l.prUrl || `${l.prRepository}#${l.prNumber}`}` }],
        countsAsMessage: false,
      };
    }
    case "progress":
    case "attachment":
    case "custom-title":
    case "ai-title":
    case "summary":
    case "agent-name":
    case "last-prompt":
    case "file-history-snapshot":
    case "queue-operation":
      if (opts.verbose) return { stages: [{ kind: "note", body: `_(${line.type})_` }], countsAsMessage: false };
      return { stages: [], countsAsMessage: false };
    default:
      if (opts.verbose) return { stages: [{ kind: "note", body: `_(unknown type: ${line.type})_` }], countsAsMessage: false };
      return { stages: [], countsAsMessage: false };
  }
}

function renderUser(line: UserLine, idx: number, totalRendered: number, opts: RenderOptions & typeof DEFAULTS): RenderLineResult {
  const blocks = contentBlocks(line.message);
  const onlyToolResults = blocks.length > 0 && blocks.every(b => b.type === "tool_result");
  if (onlyToolResults) {
    const stages = blocks.map(b => ({
      kind: "tool-result" as const,
      body: renderToolResult(b as ToolResultBlock, opts, line),
    }));
    return { stages, countsAsMessage: false };
  }

  const header = `## ${emoji("user", opts)} User — ${fmtTime(line.timestamp, opts.utc)} · msg ${idx + 1}/${totalRendered || "?"}`.trim();
  const body = renderContentBlocks(blocks, opts, line);
  const interrupted = body.includes("[Request interrupted by user]");
  const bodyNormalized = interrupted
    ? body.replace(/\[Request interrupted by user\]/g, `> ${emoji("interrupt", opts)} **Interrupted by user**`)
    : body;
  return { stages: [{ kind: "message", body: `${header}\n${bodyNormalized}`.trim() }], countsAsMessage: true };
}

function renderAssistant(line: AssistantLine, idx: number, totalRendered: number, opts: RenderOptions & typeof DEFAULTS): RenderLineResult {
  const model = line.message?.model ? ` (${line.message.model.replace(/^claude-/, "")}` : "";
  const cache = line.message?.usage?.cache_read_input_tokens;
  const cacheStr = cache ? `, ${cache} cache-hit tokens)` : model ? ")" : "";
  const header = `## ${emoji("assistant", opts)} Assistant — ${fmtTime(line.timestamp, opts.utc)} · msg ${idx + 1}/${totalRendered || "?"}${model}${cacheStr}`;
  const body = renderContentBlocks(contentBlocks(line.message), opts, line);
  return { stages: [{ kind: "message", body: `${header}\n${body}`.trim() }], countsAsMessage: true };
}

function renderSystem(line: SystemLine, opts: RenderOptions & typeof DEFAULTS): RenderLineResult {
  switch (line.subtype) {
    case "api_error": {
      const err: any = line.error ?? {};
      const status = err?.status ?? "?";
      const msg = err?.error?.error?.message ?? err?.error?.message ?? "API error";
      return {
        stages: [{ kind: "message", body: `## ${emoji("error", opts)} API error — ${fmtTime(line.timestamp, opts.utc)}\n> status ${status}: ${msg}` }],
        countsAsMessage: true,
      };
    }
    case "compact_boundary":
      return { stages: [{ kind: "rule", body: `\n---\n\n_Context compacted_\n` }], countsAsMessage: false };
    case "local_command": {
      return {
        stages: [{ kind: "note", body: `${emoji("system", opts)} _Local command — ${fmtTime(line.timestamp, opts.utc)}_` }],
        countsAsMessage: false,
      };
    }
    case "scheduled_task_fire":
      return {
        stages: [{ kind: "note", body: `${emoji("clock", opts)} _Scheduled task fired_` }],
        countsAsMessage: false,
      };
    case "turn_duration":
    case "bridge_status":
      if (opts.verbose) return { stages: [{ kind: "note", body: `_(system ${line.subtype})_` }], countsAsMessage: false };
      return { stages: [], countsAsMessage: false };
    default:
      if (opts.verbose) return { stages: [{ kind: "note", body: `_(system ${line.subtype ?? "unknown"})_` }], countsAsMessage: false };
      return { stages: [], countsAsMessage: false };
  }
}

function renderContentBlocks(blocks: ContentBlock[], opts: RenderOptions & typeof DEFAULTS, line: LogLine): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "text": parts.push(renderText((b as TextBlock).text, opts)); break;
      case "thinking":
        if (opts.thinking) {
          const tText = ((b as ThinkingBlock).thinking ?? "").trim();
          if (tText) parts.push(renderThinking(tText));
        }
        break;
      case "image": parts.push(describeImage((b as ImageBlock).source.media_type, (b as ImageBlock).source.data)); break;
      case "tool_use": parts.push(renderToolUse(b as ToolUseBlock, opts)); break;
      case "tool_result": parts.push(renderToolResult(b as ToolResultBlock, opts, line)); break;
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

function renderText(text: string, opts: RenderOptions & typeof DEFAULTS): string {
  // System reminders (inline tag) → muted blockquote.
  const sysTag = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;
  const cmdTag = /<command-name>([\s\S]*?)<\/command-name>/g;
  let out = text.replace(sysTag, (_, body) => {
    const lines = String(body).trim().split("\n").map(l => `> ${l}`).join("\n");
    return `\n${emoji("system", opts)} _System reminder:_\n${lines}\n`;
  });
  out = out.replace(cmdTag, (_, cmd) => `_(slash command: ${String(cmd).trim()})_`);
  return out;
}

function renderThinking(text: string): string {
  const lines = text.trim().split("\n").map(l => `> ${l}`).join("\n");
  return `> _thinking_\n${lines}`;
}

function renderToolUse(b: ToolUseBlock, opts: RenderOptions & typeof DEFAULTS): string {
  const shortId = (b.id || "").slice(-6);
  const header = `tool-use ${b.name}${shortId ? ` (${shortId})` : ""}`;
  const input = b.input ?? {};
  const asJson = JSON.stringify(input, null, 2);
  const lineCount = asJson.split("\n").length;
  const isBash = b.name === "Bash" && typeof (input as any).command === "string";
  const body = isBash && (input as any).command.split("\n").length <= 3
    ? `$ ${(input as any).command.trim()}`
    : asJson;
  return codeFence(opts.plain ? null : header, body, opts);
}

function renderToolResult(b: ToolResultBlock, opts: RenderOptions & typeof DEFAULTS, line: LogLine): string {
  const shortId = (b.tool_use_id || "").slice(-6);
  const status = b.is_error ? "error" : "ok";
  if (opts.toolDetails === "none") {
    return `_🧩 tool-result ← ${shortId} (${status})_`;
  }
  let raw = typeof b.content === "string"
    ? b.content
    : Array.isArray(b.content)
      ? b.content.map(c => (c as any).type === "image" ? describeImage((c as any).source.media_type, (c as any).source.data) : (c as any).text ?? "").join("\n")
      : "";

  // Overflow resolution: some tool results stash long output in sibling .txt files.
  const sessionPath = opts.sessionPath;
  if (sessionPath && (!raw || raw.length < 40)) {
    const overflow = resolveOverflow(sessionPath, b.tool_use_id);
    if (overflow) raw = overflow;
  }

  const maxLines = opts.toolDetails === "full" ? Infinity : 40;
  const { body, hiddenLines } = truncateLines(raw, maxLines);
  const tail = hiddenLines > 0 ? `\n… (+${hiddenLines} lines truncated; use --tool-details full)` : "";
  const header = `tool-result ← ${shortId} (${status})`;
  return codeFence(opts.plain ? null : header, body + tail, opts);
}

// Aggregate token totals from a stream of assistant messages.
export function accumulateTokens(): {
  add: (l: AssistantLine) => void;
  total: { input: number; output: number; cacheRead: number; cacheCreate: number };
} {
  const total = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  return {
    total,
    add(l) {
      const u = l.message?.usage;
      if (!u) return;
      total.input += u.input_tokens ?? 0;
      total.output += u.output_tokens ?? 0;
      total.cacheRead += u.cache_read_input_tokens ?? 0;
      total.cacheCreate += u.cache_creation_input_tokens ?? 0;
    },
  };
}
