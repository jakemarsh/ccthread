// Regression tests — one case per bug we've fixed. Do NOT weaken assertions
// here; the whole point is to keep past bugs from sneaking back in.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { readAllLines, streamJsonl } from "../src/parser/stream.ts";
import { renderLine, accumulateTokens } from "../src/format/markdown.ts";
import { runShow } from "../src/commands/show.ts";
import { runList } from "../src/commands/list.ts";
import { runInfo } from "../src/commands/info.ts";
import { runFind } from "../src/commands/find.ts";
import { resolveSession, SessionNotFoundError } from "../src/paths.ts";
import type { AssistantLine } from "../src/parser/types.ts";

const FX = join(import.meta.dir, "fixtures");

let TMP: string;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "ccthread-regressions-"));
  cpSync(FX, join(TMP, "-fixtures"), { recursive: true });
  process.env.CCTHREAD_PROJECTS_DIR = TMP;
  process.env.CCTHREAD_SILENT = "1";
});
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.CCTHREAD_PROJECTS_DIR;
  delete process.env.CCTHREAD_SILENT;
});

describe("regressions", () => {
  // Bug: resolveSession silently returned nothing / wrong code path on unknown ids.
  test("resolveSession throws SessionNotFoundError for unknown id", async () => {
    let caught: unknown = null;
    try { await resolveSession("nonexistent-id-definitely-not-here"); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(SessionNotFoundError);
  });

  // Bug: the "ai-title" line type was unknown to the parser, so titles from it
  // never reached list/find/info/show.
  test("ai-title feeds title in list, info, show, find when no custom-title", async () => {
    const path = join(FX, "ai-title.jsonl");
    const show = await runShow(path, {});
    expect(show).toContain("Set up recurring daily Google Cloud reports");
    const info = await runInfo(path);
    expect(info).toContain("Set up recurring daily Google Cloud reports");
    const list = await runList({ limit: 100 });
    expect(list).toContain("Set up recurring daily Google Cloud reports");
    const find = await runFind("recurring");
    expect(find).toContain("Set up recurring daily Google Cloud reports");
  });

  // Bug: streamJsonl silently swallowed malformed lines (no stderr warning).
  test("malformed lines emit stderr warnings by default (unless CCTHREAD_SILENT)", async () => {
    delete process.env.CCTHREAD_SILENT;
    const captured: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr.write as any) = (chunk: any) => {
      captured.push(String(chunk));
      return true;
    };
    try {
      for await (const _ of streamJsonl(join(FX, "malformed.jsonl"))) { /* consume */ }
    } finally {
      (process.stderr.write as any) = origWrite;
      process.env.CCTHREAD_SILENT = "1";
    }
    expect(captured.join("")).toContain("invalid json");
  });

  // Bug: --strict / CCTHREAD_STRICT didn't make malformed lines fatal.
  test("CCTHREAD_STRICT env makes malformed lines fatal", async () => {
    process.env.CCTHREAD_STRICT = "1";
    let threw = false;
    try {
      for await (const _ of streamJsonl(join(FX, "malformed.jsonl"))) { /* consume */ }
    } catch { threw = true; }
    delete process.env.CCTHREAD_STRICT;
    expect(threw).toBe(true);
  });

  // Bug: requesting a page past the end produced "Page 99 of 94" nonsense.
  test("show --page past total produces a clear past-end notice", async () => {
    const path = join(FX, "minimal.jsonl");
    const out = await runShow(path, { page: 99, perPage: 50 });
    expect(out).toMatch(/past the end/);
    expect(out).not.toMatch(/Page 99 of \d+ — messages/);
  });

  // Bug: empty sessions rendered "Page 1 — messages 1-50" instead of noting
  // that there's nothing to show.
  test("empty session renders a no-messages notice, not a bogus page range", async () => {
    const empty = join(TMP, "-fixtures", "truly-empty.jsonl");
    writeFileSync(empty, "");
    const out = await runShow(empty, {});
    expect(out).toContain("no rendered messages");
    expect(out).not.toMatch(/messages 1–50/);
  });

  // Bug: tokens were being summed via the wrong field path (cache_creation
  // object instead of flat cache_creation_input_tokens).
  test("token totals use flat cache_*_input_tokens fields", async () => {
    const toks = accumulateTokens();
    toks.add({
      type: "assistant",
      message: {
        role: "assistant",
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
          cache_creation: { ephemeral_5m_input_tokens: 999, ephemeral_1h_input_tokens: 999 },
        },
      },
    } as unknown as AssistantLine);
    expect(toks.total.cacheCreate).toBe(100);
    expect(toks.total.cacheRead).toBe(50);
  });

  // Bug: a user message that contained ONLY tool_result blocks was rendered
  // as "👤 User" instead of "🧩 Tool result" attached to the preceding tool_use.
  test("user-with-only-tool_result renders as tool-result, not user", async () => {
    const lines = await readAllLines(join(FX, "tool-use-and-result.jsonl"));
    let userMsgCount = 0;
    let toolResults = 0;
    for (let i = 0; i < lines.length; i++) {
      const r = renderLine(lines[i]!, { idx: i, totalRendered: lines.length, opts: {} });
      for (const s of r.stages) {
        if (s.kind === "message" && s.body.startsWith("## 👤 User")) userMsgCount++;
        if (s.kind === "tool-result") toolResults++;
      }
    }
    expect(userMsgCount).toBe(1);
    expect(toolResults).toBe(1);
  });

  // Bug: sidechain messages leaked into default output.
  test("sidechain messages hidden by default, shown with opts.sidechains", async () => {
    const lines = await readAllLines(join(FX, "sidechain.jsonl"));
    const countMsgs = (opts: any) => lines
      .map((l, i) => renderLine(l, { idx: i, totalRendered: lines.length, opts }).stages)
      .flat().filter(s => s.kind === "message").length;
    expect(countMsgs({})).toBe(2);
    expect(countMsgs({ sidechains: true })).toBe(3);
  });

  // Bug: thinking blocks defaulted to hidden (per old plan); per the v0.1.0
  // decision they should be shown by default.
  test("thinking blocks shown by default", async () => {
    const out = await runShow(join(FX, "thinking-and-images.jsonl"), {});
    expect(out).toContain("_thinking_");
  });

  // Bug: --no-thinking didn't actually suppress thinking.
  test("--no-thinking hides them", async () => {
    const out = await runShow(join(FX, "thinking-and-images.jsonl"), { noThinking: true });
    expect(out).not.toContain("_thinking_");
  });

  // Bug: images were rendered as base64 blobs (huge, useless output).
  test("base64 image data is stripped and replaced with a size label", async () => {
    const out = await runShow(join(FX, "thinking-and-images.jsonl"), {});
    expect(out).toContain("[image: image/png");
    expect(out).not.toContain("iVBORw0KGgo");
  });

  // Bug: a real 'type: "ai-title"' line was getting rendered inline as "_(ai-title)_"
  // in verbose mode but silently passed through the default case in non-verbose —
  // regression-test that the default is no inline render.
  test("ai-title does not produce an inline rendered message in default mode", async () => {
    const path = join(FX, "ai-title.jsonl");
    const out = await runShow(path, {});
    expect(out).not.toContain("(ai-title)");
  });

  // Bug: enum-like flags silently accepted invalid values.
  test("list --sort rejects unknown value", async () => {
    let err: any;
    try { await runList({ sort: "wrong" as any, limit: 5 }); } catch (e) { err = e; }
    expect(err?.message ?? "").toMatch(/invalid --sort/);
  });

  test("show --tool-details rejects unknown value", async () => {
    let err: any;
    try { await runShow(join(FX, "minimal.jsonl"), { toolDetails: "lots" as any }); } catch (e) { err = e; }
    expect(err?.message ?? "").toMatch(/invalid --tool-details/);
  });

  // Bug: --since and --until silently accepted unparseable strings (NaN
  // comparison meant nothing ever matched, exit 0 with "(no sessions match)").
  test("list --since rejects unparseable date", async () => {
    let err: any;
    try { await runList({ since: "not-a-date" }); } catch (e) { err = e; }
    expect(err?.message ?? "").toMatch(/is not a valid date/);
  });

  // Bug: show --from 20 --to 10 (inverted range) produced a misleading
  // "Page 1 is past the end (10 messages)" where 10 is actually where we
  // stopped streaming, not the session's real length. Validate the range.
  test("show rejects inverted --from/--to range", async () => {
    let err: any;
    try { await runShow(join(FX, "minimal.jsonl"), { from: 20, to: 10 }); } catch (e) { err = e; }
    expect(err?.message ?? "").toMatch(/must be >=/);
  });

  test("show rejects --page < 1", async () => {
    let err: any;
    try { await runShow(join(FX, "minimal.jsonl"), { page: 0 }); } catch (e) { err = e; }
    expect(err?.message ?? "").toMatch(/must be >=/);
  });
});

// CLI-surface regressions — spawn `bun run src/cli.ts` and check exit codes
// and output. These are the slow ones; skip by setting CCTHREAD_NO_CLI=1.
// CLI-surface regressions. These redirect the child's output to temp files
// because bun test's own stdio plumbing swallows subprocess pipes. Gate with
// CCTHREAD_NO_CLI=1 if you want to skip them.
describe("regressions (cli)", () => {
  const shouldSkip = process.env.CCTHREAD_NO_CLI === "1";
  const REPO = join(import.meta.dir, "..");
  const BIN_PATH = process.env.CCTHREAD_BIN || "/tmp/ccthread-test";

  const cli = (args: string[], env: Record<string, string> = {}) => {
    const outPath = join(TMP, `cli-${Math.random().toString(36).slice(2)}.out`);
    const errPath = join(TMP, `cli-${Math.random().toString(36).slice(2)}.err`);
    const proc = Bun.spawnSync({
      cmd: ["sh", "-c", `"${BIN_PATH}" ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ")} >"${outPath}" 2>"${errPath}"`],
      cwd: REPO,
      env: { ...process.env, CCTHREAD_SILENT: "1", ...env } as any,
    });
    let stdout = ""; try { stdout = require("node:fs").readFileSync(outPath, "utf8"); } catch {}
    let stderr = ""; try { stderr = require("node:fs").readFileSync(errPath, "utf8"); } catch {}
    return { status: proc.exitCode ?? 0, stdout, stderr };
  };

  const binMissing = !require("node:fs").existsSync(BIN_PATH);

  test.skipIf(shouldSkip || binMissing)("--help prints usage and exits 0 (was: 'No command specified')", () => {
    const r = cli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("USAGE");
    expect(r.stdout + r.stderr).not.toContain("No command specified");
  });

  test.skipIf(shouldSkip || binMissing)("no args prints usage and exits 0", () => {
    const r = cli([]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("USAGE");
  });

  test.skipIf(shouldSkip || binMissing)("--version prints version and exits 0", () => {
    const r = cli(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
  });

  test.skipIf(shouldSkip || binMissing)("show --help prints subcommand usage, doesn't run the command", () => {
    const r = cli(["show", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("ARGUMENTS");
    expect(r.stdout + r.stderr).not.toContain("# Conversation");
  });

  test.skipIf(shouldSkip || binMissing)("unknown session id exits 3", () => {
    const r = cli(["show", "nonexistent-xyz"], { CCTHREAD_PROJECTS_DIR: TMP });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("session not found");
  });

  test.skipIf(shouldSkip || binMissing)("missing required positional exits 2", () => {
    const r = cli(["find"]);
    expect(r.status).toBe(2);
  });

  test.skipIf(shouldSkip || binMissing)("invalid regex exits 2", () => {
    const r = cli(["search", "[unclosed", "--regex"], { CCTHREAD_PROJECTS_DIR: TMP });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Invalid regular expression");
  });
});
