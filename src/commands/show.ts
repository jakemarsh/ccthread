import { resolveSession } from "../paths.ts";
import { streamJsonl } from "../parser/stream.ts";
import {
  renderLine, renderDocHeader, accumulateTokens, type RenderOptions,
} from "../format/markdown.ts";
import {
  isAssistant, isUser, type AssistantLine, type LogLine,
} from "../parser/types.ts";

export interface ShowOptions extends RenderOptions {
  page?: number;
  perPage?: number;
  from?: number;
  to?: number;
  countTotal?: boolean;
  json?: boolean;
  noThinking?: boolean;
  includeSidechains?: boolean;
}

export async function runShow(idOrPath: string, opts: ShowOptions = {}): Promise<string> {
  const ref = await resolveSession(idOrPath);

  // --tool-details: "brief" (default, truncated to 40 lines), "full" (no
  // truncation), or "none" (one-line status only). "summary" is a
  // back-compat alias for "brief" — kept to avoid breaking existing callers
  // but renamed to avoid collision with the "summarize a session" use case
  // and the JSONL "summary" line type.
  let td = opts.toolDetails ?? "brief";
  if ((td as any) === "summary") td = "brief";
  const VALID_TD = new Set(["full", "brief", "none"]);
  if (!VALID_TD.has(td as string)) throw new Error(`show: invalid --tool-details "${td}" (expected: full, brief, none)`);

  const renderOpts: RenderOptions = {
    ...opts,
    thinking: opts.noThinking ? false : (opts.thinking ?? true),
    sidechains: opts.includeSidechains ?? false,
    toolDetails: td as any,
    sessionPath: ref.path,
  };

  const perPage = opts.perPage ?? 50;
  const page = opts.page ?? 1;
  if (perPage <= 0) throw new Error(`show: --per-page must be >= 1 (got ${perPage})`);
  if (page < 1) throw new Error(`show: --page must be >= 1 (got ${page})`);
  const fromIdx = opts.from != null ? opts.from : (page - 1) * perPage;
  const toIdx = opts.to != null ? opts.to : fromIdx + perPage;
  if (fromIdx < 0) throw new Error(`show: --from must be >= 0 (got ${fromIdx})`);
  if (toIdx < fromIdx) throw new Error(`show: --to (${toIdx}) must be >= --from (${fromIdx})`);

  // Two modes: if --count-total, stream once to collect total message count,
  // then again to render the requested slice. Otherwise, render on the fly
  // until we've emitted enough messages for the page.
  let totalRendered = 0;
  if (opts.countTotal) {
    for await (const { line } of streamJsonl(ref.path)) {
      const r = renderLine(line, { idx: 0, totalRendered: 0, opts: renderOpts });
      if (r.countsAsMessage) totalRendered++;
    }
  }

  const out: string[] = [];
  const toks = accumulateTokens();
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let model: string | undefined;
  let customTitle: string | undefined;
  let renderedIdx = 0;
  let emittedIdx = 0;
  const body: string[] = [];

  for await (const { line } of streamJsonl(ref.path)) {
    if ((line as any).type === "custom-title") {
      const ct = (line as any).customTitle;
      if (typeof ct === "string" && ct.trim()) customTitle = ct.trim();
    }
    if ((line as any).type === "ai-title" && !customTitle) {
      const at = (line as any).aiTitle;
      if (typeof at === "string" && at.trim()) customTitle = at.trim();
    }
    if ((line as any).type === "summary" && !customTitle) {
      const sm = (line as any).summary;
      if (typeof sm === "string" && sm.trim()) customTitle = sm.trim();
    }
    if (isUser(line) || isAssistant(line)) {
      if (line.timestamp) {
        if (!firstTs) firstTs = line.timestamp;
        lastTs = line.timestamp;
      }
      if (isAssistant(line)) {
        toks.add(line as AssistantLine);
        if (!model) model = (line as AssistantLine).message?.model ?? undefined;
      }
    }
    const r = renderLine(line, { idx: renderedIdx, totalRendered, opts: renderOpts });
    for (const stage of r.stages) {
      if (stage.kind === "message") {
        if (renderedIdx >= fromIdx && renderedIdx < toIdx) body.push(stage.body);
        renderedIdx++;
        emittedIdx = renderedIdx;
        if (renderedIdx >= toIdx && !opts.countTotal) break;
      } else {
        // Only attach non-message stages if we're inside the page window.
        if (renderedIdx > fromIdx && renderedIdx <= toIdx) body.push(stage.body);
      }
    }
    if (renderedIdx >= toIdx && !opts.countTotal) break;
  }

  const total = opts.countTotal ? totalRendered : emittedIdx; // unknown-total fallback

  if (opts.json) {
    return JSON.stringify({
      sessionId: ref.sessionId,
      shortId: ref.shortId,
      project: ref.project.decodedPath,
      model,
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
      totalMessages: total,
      page,
      perPage,
      fromIdx,
      toIdx,
      body: body.join("\n\n"),
    }, null, 2);
  }

  const header = renderDocHeader({
    shortId: ref.shortId,
    projectPath: ref.project.decodedPath,
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
    durationMs: firstTs && lastTs ? new Date(lastTs).getTime() - new Date(firstTs).getTime() : undefined,
    totalMessages: total,
    model,
    customTitle,
    tokens: (toks.total.input || toks.total.output || toks.total.cacheRead || toks.total.cacheCreate) ? toks.total : undefined,
  }, renderOpts);

  out.push(header);
  if (emittedIdx === 0 && (!opts.countTotal || total === 0)) {
    out.push("_(no rendered messages in this session)_");
  } else if (body.length === 0 && fromIdx >= emittedIdx) {
    const pageCount = total ? Math.ceil(total / perPage) : Math.max(1, Math.ceil(emittedIdx / perPage));
    out.push(`_Page ${page} is past the end (${emittedIdx} messages, ${pageCount} page${pageCount === 1 ? "" : "s"})._`);
  } else {
    const end = Math.min(toIdx, total || emittedIdx);
    const pageCount = total ? Math.ceil(total / perPage) : null;
    const pageStr = pageCount
      ? `_Page ${page} of ${pageCount} — messages ${fromIdx + 1}–${end} of ${total}._`
      : `_Page ${page} — messages ${fromIdx + 1}–${end} (pass --count-total for total-page count)._`;
    out.push(pageStr);
    out.push(body.join("\n\n"));
  }

  return out.join("\n\n") + "\n";
}
