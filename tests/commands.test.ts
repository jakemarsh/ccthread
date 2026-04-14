import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join, dirname } from "node:path";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runProjects } from "../src/commands/projects.ts";
import { runList } from "../src/commands/list.ts";
import { runShow } from "../src/commands/show.ts";
import { runFind } from "../src/commands/find.ts";
import { runSearch } from "../src/commands/search.ts";
import { runInfo } from "../src/commands/info.ts";
import { runTools } from "../src/commands/tools.ts";
import { runStats } from "../src/commands/stats.ts";

const FX = join(import.meta.dir, "fixtures");

// Build a fake ~/.claude/projects/ layout pointing CCTHREAD_PROJECTS_DIR
// at a temp dir with our fixtures copied in under a synthetic project name.
let TMP: string;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "ccthread-test-"));
  const projDir = join(TMP, "-tmp-ccthread-fixtures");
  cpSync(FX, projDir, { recursive: true });
  process.env.CCTHREAD_PROJECTS_DIR = TMP;
  process.env.CCTHREAD_SILENT = "1";
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.CCTHREAD_PROJECTS_DIR;
  delete process.env.CCTHREAD_SILENT;
});

describe("commands", () => {
  test("projects lists fixture dir", async () => {
    const out = await runProjects({});
    expect(out).toContain("fixtures");
  });

  test("list enumerates fixture sessions", async () => {
    const out = await runList({ limit: 50 });
    expect(out).toContain("minimal");
    expect(out.toLowerCase()).toContain("msg");
  });

  test("show renders minimal.jsonl", async () => {
    const out = await runShow(join(FX, "minimal.jsonl"), {});
    expect(out).toContain("👤 User");
    expect(out).toContain("hello!");
  });

  test("show respects --no-thinking", async () => {
    const on = await runShow(join(FX, "thinking-and-images.jsonl"), {});
    const off = await runShow(join(FX, "thinking-and-images.jsonl"), { noThinking: true });
    expect(on).toContain("_thinking_");
    expect(off).not.toContain("_thinking_");
  });

  test("find locates keyword across fixtures", async () => {
    const out = await runFind("hello");
    expect(out.toLowerCase()).toContain("hello");
  });

  test("search returns match with window", async () => {
    const out = await runSearch("hello", { window: 1, limit: 5 });
    expect(out).toContain("Match:");
  });

  test("info reports counts + tokens", async () => {
    const out = await runInfo(join(FX, "tool-use-and-result.jsonl"));
    expect(out).toContain("user: 2");
    expect(out).toContain("Tools");
  });

  test("tools lists Bash usage", async () => {
    const out = await runTools(join(FX, "tool-use-and-result.jsonl"));
    expect(out).toContain("Bash: 1");
  });

  test("stats aggregates across fixtures", async () => {
    const out = await runStats({});
    expect(out).toContain("Sessions:");
    expect(out).toContain("Tokens:");
  });
});
