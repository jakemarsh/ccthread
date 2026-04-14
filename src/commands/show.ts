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

  const renderOpts: RenderOptions = {
    ...opts,
    thinking: opts.noThinking ? false : (opts.thinking ?? true),
    sidechains: opts.includeSidechains ?? false,
    toolDetails: opts.toolDetails ?? "summary",
    sessionPath: ref.path,
  };

  const perPage = opts.perPage ?? 50;
  const page = opts.page ?? 1;
  const fromIdx = opts.from != null ? opts.from : (page - 1) * perPage;
  const toIdx = opts.to != null ? opts.to : fromIdx + perPage;

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
  const end = Math.min(toIdx, total || toIdx);
  const pageCount = total ? Math.ceil(total / perPage) : null;
  const pageStr = pageCount
    ? `_Page ${page} of ${pageCount} — messages ${fromIdx + 1}–${end} of ${total}._`
    : `_Page ${page} — messages ${fromIdx + 1}–${end} (pass --count-total for total-page count)._`;
  out.push(pageStr);
  out.push(body.join("\n\n"));

  return out.join("\n\n") + "\n";
}
