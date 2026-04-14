import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readAllLines } from "../src/parser/stream.ts";
import { renderLine, accumulateTokens } from "../src/format/markdown.ts";
import type { AssistantLine } from "../src/parser/types.ts";

const FX = join(import.meta.dir, "fixtures");

describe("renderLine", () => {
  test("renders user and assistant messages as markdown", async () => {
    const lines = await readAllLines(join(FX, "minimal.jsonl"));
    const rendered = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: {} }).stages.map(s => s.body)
    ).flat();
    expect(rendered.join("\n")).toContain("👤 User");
    expect(rendered.join("\n")).toContain("🤖 Assistant");
    expect(rendered.join("\n")).toContain("hello!");
  });

  test("images are stripped and described, not base64-dumped", async () => {
    const lines = await readAllLines(join(FX, "thinking-and-images.jsonl"));
    const rendered = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: {} }).stages.map(s => s.body)
    ).flat().join("\n");
    expect(rendered).toContain("[image: image/png");
    expect(rendered).not.toContain("iVBORw0KGgo"); // the base64 blob
  });

  test("thinking hidden when opts.thinking=false", async () => {
    const lines = await readAllLines(join(FX, "thinking-and-images.jsonl"));
    const on = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: { thinking: true } }).stages.map(s => s.body)
    ).flat().join("\n");
    const off = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: { thinking: false } }).stages.map(s => s.body)
    ).flat().join("\n");
    expect(on).toContain("_thinking_");
    expect(off).not.toContain("_thinking_");
  });

  test("tool_result blocks render under previous tool_use, not as user msg", async () => {
    const lines = await readAllLines(join(FX, "tool-use-and-result.jsonl"));
    let userMessageCount = 0;
    let toolResultStages = 0;
    for (let idx = 0; idx < lines.length; idx++) {
      const r = renderLine(lines[idx]!, { idx, totalRendered: lines.length, opts: {} });
      for (const s of r.stages) {
        if (s.kind === "message" && s.body.startsWith("## 👤 User")) userMessageCount++;
        if (s.kind === "tool-result") toolResultStages++;
      }
    }
    expect(userMessageCount).toBe(1); // only the first user msg, not the tool_result one
    expect(toolResultStages).toBe(1);
  });

  test("system compact_boundary renders as a rule", async () => {
    const lines = await readAllLines(join(FX, "system-events.jsonl"));
    const rendered = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: {} }).stages.map(s => s.body)
    ).flat().join("\n");
    expect(rendered).toContain("Context compacted");
    expect(rendered).toContain("API error");
  });

  test("progress lines hidden by default, shown in verbose", async () => {
    const lines = await readAllLines(join(FX, "system-events.jsonl"));
    const def = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: {} }).stages
    ).flat().length;
    const verb = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: { verbose: true } }).stages
    ).flat().length;
    expect(verb).toBeGreaterThan(def);
  });

  test("sidechain lines hidden unless opts.sidechains", async () => {
    const lines = await readAllLines(join(FX, "sidechain.jsonl"));
    const off = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: {} }).stages
    ).flat().filter(s => s.kind === "message").length;
    const on = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: { sidechains: true } }).stages
    ).flat().filter(s => s.kind === "message").length;
    expect(on).toBeGreaterThan(off);
  });

  test("interrupted marker is preserved and formatted", async () => {
    const lines = await readAllLines(join(FX, "system-events.jsonl"));
    const rendered = lines.map((line, idx) =>
      renderLine(line, { idx, totalRendered: lines.length, opts: {} }).stages.map(s => s.body)
    ).flat().join("\n");
    expect(rendered).toContain("Interrupted by user");
  });
});

describe("accumulateTokens", () => {
  test("uses flat cache_creation_input_tokens + cache_read_input_tokens", async () => {
    const lines = await readAllLines(join(FX, "tool-use-and-result.jsonl"));
    const toks = accumulateTokens();
    for (const l of lines) if (l.type === "assistant") toks.add(l as AssistantLine);
    expect(toks.total.input).toBe(15 + 5);
    expect(toks.total.output).toBe(20 + 3);
    expect(toks.total.cacheRead).toBe(5);
    expect(toks.total.cacheCreate).toBe(0);
  });
});
