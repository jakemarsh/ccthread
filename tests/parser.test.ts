import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { streamJsonl, readAllLines } from "../src/parser/stream.ts";

beforeAll(() => { process.env.CCTHREAD_SILENT = "1"; });
afterAll(() => { delete process.env.CCTHREAD_SILENT; });
import { contentBlocks, isAssistant, isUser } from "../src/parser/types.ts";
import { join } from "node:path";

const FX = join(import.meta.dir, "fixtures");

describe("streamJsonl", () => {
  test("parses a minimal file line-by-line", async () => {
    const lines = await readAllLines(join(FX, "minimal.jsonl"));
    expect(lines).toHaveLength(3);
    expect(lines[0]?.type).toBe("user");
    expect(lines[1]?.type).toBe("assistant");
  });

  test("skips malformed lines and reports issues without crashing", async () => {
    const issues: any[] = [];
    const out = [];
    for await (const p of streamJsonl(join(FX, "malformed.jsonl"), { onIssue: i => issues.push(i) })) {
      out.push(p.line);
    }
    expect(out).toHaveLength(2);
    expect(issues).toHaveLength(1);
    expect(issues[0].lineNumber).toBe(2);
  });

  test("throws in strict mode on malformed lines", async () => {
    const gen = streamJsonl(join(FX, "malformed.jsonl"), { strict: true });
    let threw = false;
    try {
      for await (const _ of gen) { /* consume */ }
    } catch { threw = true; }
    expect(threw).toBe(true);
  });

  test("handles user content as string OR array of blocks", async () => {
    const lines = await readAllLines(join(FX, "tool-use-and-result.jsonl"));
    const first = lines[0]!;
    const third = lines[2]!;
    expect(isUser(first)).toBe(true);
    expect(isUser(third)).toBe(true);
    expect(contentBlocks((first as any).message)).toHaveLength(1);
    expect(contentBlocks((first as any).message)[0]?.type).toBe("text");
    const b = contentBlocks((third as any).message);
    expect(b[0]?.type).toBe("tool_result");
  });

  test("thinking and image blocks parse cleanly", async () => {
    const lines = await readAllLines(join(FX, "thinking-and-images.jsonl"));
    const asst = lines.find(isAssistant)!;
    const blocks = contentBlocks((asst as any).message);
    expect(blocks.some(b => b.type === "thinking")).toBe(true);
    expect(blocks.some(b => b.type === "text")).toBe(true);
  });
});
