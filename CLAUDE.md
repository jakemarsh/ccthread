# CLAUDE.md — ccthread

Context for future agents working in this repo. Reading the code is fine; reading this first will save you time.

## Why this exists

Claude Code writes every session to `~/.claude/projects/<encoded-project>/<session-uuid>.jsonl`. Raw JSONL is unreadable for agents and humans. `ccthread` turns any session (or any slice) into clean markdown and offers cross-project search. The six target use cases:

1. Finding things in past conversations
2. Learning from past mistakes
3. Reviewing/summarizing rounds of work for teammates
4. Finding answers or values discussed before
5. Reviewing conversations to create skills out of past processes (or enhance them)
6. Reviewing conversations to populate a project's `CLAUDE.md`

## Stack & key decisions

- **Bun + TypeScript.** Chosen over C for portability, simplicity, and `bun build --compile` — which emits a single cross-platform binary with the Bun runtime embedded.
- **Streaming everywhere.** Real session files go up to 100+ MB / 35k lines. Never load a file whole. All parsing flows through `src/parser/stream.ts` which uses `Bun.file().stream()` + line splitter.
- **Ship a compiled binary.** Users get `ccthread` as a single executable; Bun isn't required at runtime.
- **Plugin with a tiny dispatcher.** The plugin repo stays ~few KB. `plugin/bin/ccthread` detects OS/arch on first run and downloads the matching release asset into `${CLAUDE_PLUGIN_DATA}/bin/`, caches it, then execs it.
- **No SQLite index in v1.** Streaming scan is plenty fast (sub-second for `find` across 11k files on an M-series Mac). v2 can add `bun:sqlite` for offset caching.
- **Thinking on by default.** Agents reviewing past work usually want the reasoning. `--no-thinking` flips it off.
- **Tool results truncated to 40 lines by default.** `--tool-details full` shows everything; `none` hides them entirely.
- **Pager is opt-in.** Default is plain stdout (agent-friendly; humans can `| less` themselves).

## Architecture

```
src/
  cli.ts                # citty-based entry; dispatches subcommands
  commands/             # one file per subcommand (projects, list, show, find, search, info, tools, stats)
  parser/
    stream.ts           # streaming line-by-line reader (never buffers whole files)
    types.ts            # discriminated types for every known log-line shape
    resolve.ts          # resolves tool_result overflow to sibling tool-results/*.txt
  format/
    markdown.ts         # canonical renderer; per-type rendering policy table lives here
    truncate.ts         # line truncation + image-block stripping
  paths.ts              # ~/.claude/projects resolution; project-name decode (lossy → fs-verified)
tests/
  fixtures/             # small crafted .jsonl files covering every message type we render
  *.test.ts             # unit + command-level tests (bun test)
plugin/
  .claude-plugin/plugin.json
  bin/ccthread          # POSIX dispatcher
  bin/ccthread.cmd      # Windows dispatcher
  bin/.ccthread-version # pinned binary version (bumped in lockstep with plugin.json)
  skills/ccthread/SKILL.md
scripts/
  build-all.ts          # cross-compile every target
```

## JSONL schema — what you'll actually hit

Every line is one JSON object. Not every line is a user/assistant message. Every known `type` handled in `src/format/markdown.ts` → `renderLine`. Default policy:

| Line `type` | Default in `show` | Behind a flag |
|---|---|---|
| `user` (text/image/tool_use/etc) | 👤 User | — |
| `user` (only `tool_result` blocks) | 🧩 Tool result under prior tool_use | — |
| `assistant` | 🤖 Assistant | — |
| `system` api_error | ⚠️ API error (status + msg) | — |
| `system` compact_boundary | horizontal rule + "_Context compacted_" | — |
| `system` local_command | ⚙️ Local command note | — |
| `system` scheduled_task_fire | ⏰ note | — |
| `system` turn_duration / bridge_status | hidden | `--verbose` |
| `progress` (hook) | hidden | `--verbose` |
| `attachment` | hidden | `--verbose` |
| `permission-mode` | inline note | — |
| `custom-title` | feeds doc-header title | — |
| `agent-name` / `last-prompt` / `file-history-snapshot` / `queue-operation` | hidden | `--verbose` |
| `pr-link` | 🔗 link | — |
| `isSidechain: true` (any type) | hidden | `--include-sidechains` |

### Things that will bite you
- `message.content` is either a **string** or an **array of content blocks**. `contentBlocks()` in `parser/types.ts` normalizes.
- `parentUuid` is `null` at roots.
- `message.content` can be `null` on some assistant messages. Guard.
- Empty content arrays (`[]`) happen in ~270 files on my machine. Treat as no-op.
- `usage.cache_creation` is an **object** (`ephemeral_5m_input_tokens` etc.). For totals, use the flat `usage.cache_creation_input_tokens` + `usage.cache_read_input_tokens` fields instead.
- Long tool results overflow to `<project>/<session>/tool-results/<tool_use_id>.txt`. `parser/resolve.ts` reads them.
- Project names encoded as dashes: `-Users-jakemarsh-great-work` → `/Users/jakemarsh/great-work`. The encoding is **lossy** (dash vs slash ambiguity). `decodeProjectName` walks the filesystem greedily to disambiguate and falls back to naive decoding.
- Some `.jsonl` files sit at the **root** of `~/.claude/projects/` (not inside a project subdir). Listed under synthetic project `(unscoped)`.
- Sidechain subagent logs live under `<session>/subagents/agent-*.jsonl`. Not currently indexed by `list`; render them when linked.
- Thinking blocks have opaque `signature` fields — ignore signatures, render the `thinking` text.
- Inline `<system-reminder>...</system-reminder>` tags inside user content get rendered as muted blockquotes. `<command-name>/foo</command-name>` → `_(slash command: /foo)_`.
- `[Request interrupted by user]` is preserved verbatim in content; formatter replaces it with a visible marker.

## Adding a new subcommand

1. Create `src/commands/<name>.ts` exporting `run<Name>(args, opts)` returning a string.
2. Register it in `src/cli.ts` with a `citty` `defineCommand` and add to `main.subCommands`.
3. Add a test case to `tests/commands.test.ts`.
4. Update `plugin/skills/ccthread/SKILL.md` "Common patterns" if it's user-facing.

## Adding support for a new message type

1. Extend the union in `src/parser/types.ts`.
2. Add a case in `renderLine` (`src/format/markdown.ts`) — decide visible vs `--verbose`.
3. Add a fixture to `tests/fixtures/` and a test in `tests/format.test.ts`.

## Testing

- `bun test` runs all unit + command tests against fixtures.
- `tests/commands.test.ts` points `CCTHREAD_PROJECTS_DIR` at a temp dir — real `~/.claude/projects/` is not touched.
- Add a fixture (tiny `.jsonl` file) for each edge case; assert on rendered output.
- Set `CCTHREAD_SMOKE=1` to (in the future) run a gated pass across the host's real projects dir.

### Regression tests are mandatory

**Every bug we fix gets a test.** No exceptions. When you find a bug (edge case, crash, wrong output, wrong exit code, silent failure, etc.):

1. Write a failing test that reproduces it (usually in `tests/regressions.test.ts` or alongside the relevant subject).
2. Fix the bug.
3. Confirm the test passes.
4. Commit the test and fix together so future agents see why the check exists.

Avoid cheating tests to make them pass (weakening assertions, adding skipped cases, deleting tricky expectations). If a test is hard to pass, the code is probably wrong.

## Build & release

- Local dev: `bun run src/cli.ts <subcommand> ...`
- Single-target build: `bun run build`
- All 6 targets: `bun run build:all` (produces `dist/ccthread-<version>-<target>/` dirs)
- CI (`.github/workflows/release.yml`, when added): triggers on `v*` tags. Matrix: macos-latest + ubuntu-latest + windows-latest. Windows runner is **required** because `bun build --compile` can't embed Windows PE metadata when cross-compiling.
- Version lives in `package.json`. Baked into the binary via `--define CCTHREAD_VERSION='"..."'`. Plugin-side version lives in `plugin/bin/.ccthread-version` (must match). Bump all three together when releasing.

## Known gotchas

- `bun:sqlite` works in compiled binaries but we don't use it in v1.
- Use `-baseline` x64 targets for public distribution (default targets require AVX2 and will segfault on older CPUs).
- Windows PE metadata (icon, title) requires building on Windows.
- `--compile` binaries are ~60–70 MB each (Bun runtime is embedded).
- `process.argv` and `process.env` work normally; `__dirname` / `import.meta.dir` point into a virtual `$bunfs/` — use `process.cwd()` for user-relative paths.
- `citty` works fine under `--compile` (verified).

## Out of scope for v1

- SQLite indexing
- DAG / branch rendering (multi-child `parentUuid` chains)
- Editing or redacting sessions
- HTML / PDF export
- Watching for new sessions (`ccthread watch`)
- Config files / aliases
- Secret detection in output (user's responsibility; we just read what's on disk)
