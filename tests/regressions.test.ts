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

  // Bug: the "summary" line type (pre-compact AI-generated session title)
  // was unknown. Stats counted it as a raw type; title wasn't surfaced.
  test("summary line feeds title when no custom-title/ai-title", async () => {
    const path = join(FX, "summary-title.jsonl");
    const show = await runShow(path, {});
    expect(show).toContain("Daily Report Workflow");
    const info = await runInfo(path);
    expect(info).toContain("Daily Report Workflow");
  });

  // Bug: search --role thinking/tool_use/tool_result was a no-op because the
  // role filter only matched "user"/"assistant" top-level roles. Those three
  // aren't roles — they're content-block types. Auto-narrow --fields.
  test("search --role thinking finds hits inside thinking blocks", async () => {
    // The thinking-and-images fixture has a thinking block containing "tiny red pixel".
    const { runSearch } = await import("../src/commands/search.ts");
    const out = await runSearch("tiny red pixel", {
      session: join(FX, "thinking-and-images.jsonl"),
      role: "thinking",
      window: 0,
    });
    expect(out).toContain("1 session");
  });

  // The CCTHREAD_SESSION_ID env var is the bypass for Tier 1/2 detection —
  // used by scripts and tests and when all else fails.
  test("CCTHREAD_SESSION_ID env resolves 'current' to the matching fixture", async () => {
    const { runCurrent } = await import("../src/commands/current.ts");
    const fakeId = "aaaaaaaa-0000-0000-0000-000000000000"; // needs to be hex to pass UUID_RE
    process.env.CCTHREAD_SESSION_ID = fakeId;
    try {
      const out = await runCurrent({ json: true });
      const j = JSON.parse(out);
      expect(j.sessionId).toBe(fakeId);
      expect(j.source).toBe("env");
    } finally {
      delete process.env.CCTHREAD_SESSION_ID;
    }
  });

  test("detectCurrentSession returns null when no signal is available", async () => {
    const { detectCurrentSession } = await import("../src/util/current-session.ts");
    // Scrub every env var the detector would honour so we only test the
    // failure path.
    const saved = process.env.CCTHREAD_SESSION_ID;
    delete process.env.CCTHREAD_SESSION_ID;
    try {
      // In the test process, ancestors probably don't have --session-id in
      // argv (bun test -> this process). Tier 2 shouldn't find anything.
      // If it does (e.g. running inside stovetop), skip.
      const got = detectCurrentSession();
      if (got?.source === "argv" || got?.source === "hook") return; // environment-dependent, skip
      expect(got).toBeNull();
    } finally {
      if (saved) process.env.CCTHREAD_SESSION_ID = saved;
    }
  });

  // --before-last-compact narrows show/search to messages before the most
  // recent compact_boundary line.
  test("show --before-last-compact stops at the compact boundary", async () => {
    const path = join(FX, "with-compact.jsonl");
    const withFlag = await runShow(path, { beforeLastCompact: true });
    const without = await runShow(path, {});
    expect(withFlag).toContain("magic constant is 42");
    expect(withFlag).not.toContain("post-compact reply");
    expect(without).toContain("post-compact reply");
  });

  test("show --before-last-compact says so when the session has no compactions", async () => {
    const path = join(FX, "minimal.jsonl");
    const out = await runShow(path, { beforeLastCompact: true });
    expect(out).toMatch(/hasn.?t been compacted/);
  });

  test("search --before-last-compact ignores post-compact matches", async () => {
    const { runSearch } = await import("../src/commands/search.ts");
    const path = join(FX, "with-compact.jsonl");
    // "magic constant" appears both pre- and post-compact. Pre-compact only:
    // 1 hit; post-compact phrase is not present with the scope restricted.
    const out = await runSearch("magic constant", { session: path, beforeLastCompact: true, window: 0 });
    expect(out).toContain("1 session");
    expect(out).not.toContain("post-compact reply");
  });

  // Bug regression: the argv regex used \b before -- which doesn't match
  // because both - and - are non-word characters, so session ids never
  // extracted from the ancestor command line.
  test("argv regex matches --session-id <uuid> and --resume <uuid> patterns", () => {
    const SESSION_ID = /(?:^|\s)--session-id[ =]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const RESUME = /(?:^|\s)--resume[ =]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const cmd1 = "claude --session-id 2F0A28FA-23B0-41ED-BF9C-2E13144B9BED --mcp-config foo";
    const cmd2 = "claude --resume abc12345-1234-5678-9abc-def012345678";
    expect(SESSION_ID.exec(cmd1)?.[1]).toBe("2F0A28FA-23B0-41ED-BF9C-2E13144B9BED");
    expect(RESUME.exec(cmd2)?.[1]).toBe("abc12345-1234-5678-9abc-def012345678");
  });

  test("summary line does not render inline in the conversation body", async () => {
    const path = join(FX, "summary-title.jsonl");
    const show = await runShow(path, {});
    // "Daily Report Workflow" should appear in the title slot, not as a
    // standalone message bubble.
    const bodyAfterHeader = show.split("## ")[0] + show.split("## ").slice(1).join("## ");
    expect(show).not.toContain("(summary)");
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

describe("stream parser — edge cases", () => {
  // Bug: files that start with a UTF-8 BOM crashed on the first line
  // with "Unexpected token ï". Some exports/editors leave it in.
  test("strips UTF-8 BOM from the first chunk", async () => {
    const path = join(TMP, "bom.jsonl");
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from(`{"type":"user","message":{"content":"hi"}}\n`);
    writeFileSync(path, Buffer.concat([bom, body]));
    const lines = await readAllLines(path);
    expect(lines.length).toBe(1);
    expect((lines[0] as any).type).toBe("user");
  });

  // Bug: Windows-generated .jsonl files have CRLF line endings; the
  // trailing \r wasn't stripped, leaking into raw strings used by search.
  test("strips trailing \\r from CRLF line endings", async () => {
    const path = join(TMP, "crlf.jsonl");
    writeFileSync(path, `{"type":"user","message":{"content":"a"}}\r\n{"type":"user","message":{"content":"b"}}\r\n`);
    const collected: string[] = [];
    for await (const { raw } of streamJsonl(path)) collected.push(raw);
    expect(collected.length).toBe(2);
    for (const r of collected) expect(r.endsWith("\r")).toBe(false);
  });

  // Bug: trailing malformed lines bypassed the default issue handler AND
  // ignored CCTHREAD_STRICT. Only opts.strict / opts.onIssue were honored.
  test("trailing malformed line respects CCTHREAD_STRICT env var", async () => {
    const path = join(TMP, "trailing-bad.jsonl");
    writeFileSync(path, `{"type":"user","message":{"content":"ok"}}\n{not-json`);
    const prev = process.env.CCTHREAD_STRICT;
    process.env.CCTHREAD_STRICT = "1";
    try {
      let caught: unknown = null;
      try {
        for await (const _ of streamJsonl(path)) { /* consume */ }
      } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain("trailing");
    } finally {
      if (prev === undefined) delete process.env.CCTHREAD_STRICT;
      else process.env.CCTHREAD_STRICT = prev;
    }
  });

  test("trailing malformed line routes to default issue handler (not opts.onIssue)", async () => {
    const path = join(TMP, "trailing-bad2.jsonl");
    writeFileSync(path, `{"type":"user","message":{"content":"ok"}}\n{broken`);
    const issues: { lineNumber: number; message: string }[] = [];
    for await (const _ of streamJsonl(path, {
      onIssue: (i) => issues.push({ lineNumber: i.lineNumber, message: i.message }),
    })) { /* consume */ }
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain("trailing");
  });
});

describe("cleanup-session hook — payload-driven delete", () => {
  // Guard: shell scripts only run on POSIX. Skip on Windows.
  const skipOnWindows = process.platform === "win32";

  test.skipIf(skipOnWindows)("deletes the file matching session_id from payload, leaves others", async () => {
    const hookDir = join(import.meta.dir, "..", "plugin", "hooks");
    const sessionsHome = mkdtempSync(join(tmpdir(), "ccthread-cleanup-"));
    const sessionsDir = join(sessionsHome, "sessions");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(sessionsDir, { recursive: true });

    const matchPid = "11111";
    const otherPid = "22222";
    const matchId = "deadbeef-dead-beef-dead-beefdeadbeef";
    const otherId = "cafef00d-cafe-f00d-cafe-f00dcafef00d";
    writeFileSync(join(sessionsDir, `${matchPid}.json`),
      `{"session_id":"${matchId}","transcript_path":"/x","cwd":"/","pid":${matchPid},"started_at":0}`);
    writeFileSync(join(sessionsDir, `${otherPid}.json`),
      `{"session_id":"${otherId}","transcript_path":"/y","cwd":"/","pid":${otherPid},"started_at":0}`);

    const payload = JSON.stringify({ session_id: matchId });
    const proc = Bun.spawnSync({
      cmd: ["sh", join(hookDir, "cleanup-session.sh")],
      stdin: new TextEncoder().encode(payload),
      env: { ...process.env, CLAUDE_PLUGIN_DATA: sessionsHome },
    });
    expect(proc.exitCode).toBe(0);

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(sessionsDir, `${matchPid}.json`))).toBe(false);
    expect(existsSync(join(sessionsDir, `${otherPid}.json`))).toBe(true);

    rmSync(sessionsHome, { recursive: true, force: true });
  });
});

describe("plugin manifest — platform-gated hooks", () => {
  // Caught once where hooks.json registered sh AND powershell for every
  // platform, which meant every session start logged a hook-failure notice
  // on whichever platform lacked the sibling shell.
  test("hooks.json gates each command by shell field", async () => {
    const path = join(import.meta.dir, "..", "plugin", "hooks", "hooks.json");
    const doc = JSON.parse(await Bun.file(path).text());
    for (const event of ["SessionStart", "SessionEnd"]) {
      const hooks = doc.hooks[event][0].hooks as Array<{ shell: string; command: string }>;
      const shells = hooks.map(h => h.shell).sort();
      expect(shells).toEqual(["bash", "powershell"]);
      for (const h of hooks) {
        expect(h.command).toContain("${CLAUDE_PLUGIN_ROOT}");
      }
    }
  });
});
