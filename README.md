# ccthread

Read, search, and summarize your Claude Code conversation history from the CLI.

Every Claude Code session lives as a `.jsonl` file in `~/.claude/projects/`. `ccthread` turns them into clean markdown you can actually read — or feed back into an agent that's reviewing past work.

- **Streaming**: handles 100+ MB session files without loading them whole.
- **Every log type**: user/assistant messages, tool uses + results, thinking blocks, images, sidechains, system errors, compaction boundaries, and more — each rendered appropriately.
- **Search**: cross-project keyword search with context windows; regex optional.
- **Pagination by message**: 1-indexed pages so agents can ask for "page 3 of this long session" without byte math.
- **Cross-platform**: single-file binary via `bun build --compile` (macOS, Linux, Windows).
- **Claude Code plugin**: bundled skill so the agent can call `ccthread` automatically.

---

## Install

**macOS / Linux**
```sh
curl -fsSL https://raw.githubusercontent.com/jakemarsh/ccthread/main/install.sh | sh
```

**Windows (PowerShell)**
```powershell
irm https://raw.githubusercontent.com/jakemarsh/ccthread/main/install.ps1 | iex
```

**As a Claude Code plugin**
```
/plugin install ccthread
```
After install, agents can invoke `ccthread` via the bundled skill whenever the user asks about past conversations. See [Claude Code skill](#claude-code-skill).

**From source**
```sh
git clone https://github.com/jakemarsh/ccthread && cd ccthread
bun install && bun test && bun run build
./dist/ccthread --help
```

---

## Quickstart

```sh
# What projects do I have?
ccthread projects

# 10 most recent sessions in a project
ccthread list --project great-work --limit 10

# Which old conversation mentioned Retell?
ccthread find "retell phone" --limit 5

# Read the first 50 messages of a session
ccthread show 2F0A28FA

# Pull every mention of "port 3000" with ±2 messages of context
ccthread search "port 3000" --window 2

# Stats for the last two weeks of a project
ccthread stats --project great-work --since 2026-04-01
```

---

## Commands

Every command accepts `--json` (structured output), `--plain` (no markdown), and `--help` for inline docs.

### `ccthread projects`

List every project under `~/.claude/projects/` with session counts and last-active date.

```sh
ccthread projects              # markdown list
ccthread projects --json       # JSON array
```

### `ccthread list`

List conversations with their metadata.

| Flag | Meaning |
|---|---|
| `--project <name>` | Filter to one project (basename, decoded path, or on-disk name). |
| `--since <ISO>` | Only sessions modified on or after this ISO date/time. |
| `--until <ISO>` | Only sessions modified on or before this ISO date/time. |
| `--limit N` | Cap sessions returned (default 50). |
| `--sort recent\|oldest\|size` | Sort order (default `recent`). |

Columns: short id · start date · #messages · duration · model · title. A `project` column is added when the scope spans multiple projects.

### `ccthread show <id-or-path>`

Print a single conversation as paginated markdown. `<id>` accepts a UUID prefix (≥6 hex chars), a full UUID, a file path, or the literal `last` / `latest` for the most recently modified session.

| Flag | Meaning |
|---|---|
| `--page N` | 1-indexed page (default 1). |
| `--per-page M` | Messages per page (default 50). |
| `--from N --to M` | 0-indexed half-open message range (alternative to pagination). |
| `--no-thinking` | Hide thinking blocks. Shown by default. |
| `--include-sidechains` | Inline subagent sidechain messages. Hidden by default. |
| `--tool-details full\|summary\|none` | Tool-result display. Default `summary` (40 lines). `full` shows untruncated; `none` hides bodies. |
| `--count-total` | Pre-scan to compute total message count (enables accurate "Page N of M"). Costs one extra file read. |
| `--verbose` | Also show hook / progress / attachment noise normally filtered. |
| `--utc` | Format timestamps in UTC. |

**What gets rendered by default** (everything else is hidden, overridable with `--verbose`):

| Line type | Default rendering |
|---|---|
| `user` with text/image/tool_use/etc | 👤 User |
| `user` with only `tool_result` blocks | 🧩 Tool result under previous tool_use |
| `assistant` | 🤖 Assistant (with model + cache-hit tokens) |
| `system` `api_error` | ⚠️ API error (status + message) |
| `system` `compact_boundary` | horizontal rule + "_Context compacted_" |
| `system` `local_command` / `scheduled_task_fire` | one-line note |
| `permission-mode` | inline "_Permission mode → X_" |
| `pr-link` | 🔗 PR link in the doc header |
| `progress` / `attachment` / `queue-operation` / `turn_duration` / `bridge_status` / `agent-name` / `last-prompt` / `file-history-snapshot` | hidden |
| `isSidechain: true` (any type) | hidden unless `--include-sidechains` |

Images are always stripped to a size label (`[image: image/png, 124 KB]`). Base64 data never leaks into output.

Long tool results that overflow to sibling `tool-results/<id>.txt` files are resolved and inlined (still subject to truncation).

### `ccthread find <query>`

One line per session that contains the keyword. Good for *"which old thread talked about X?"*. Lighter than `search`.

| Flag | Meaning |
|---|---|
| `--project <name>` | Limit to one project. |
| `--limit N` | Max matching sessions (default 20). |
| `--snippet-len N` | Snippet context length (default 60 chars). |

Substring match, case-insensitive.

### `ccthread search <query>`

Cross-project keyword search with context windows — ±N messages around each hit. Returns grouped output: one section per session, each match headed by `### Match: "..." @ msg N`.

| Flag | Meaning |
|---|---|
| `--project <name>` | Scope to one project. |
| `--session <id>` | Scope to one session. |
| `--since <ISO>` / `--until <ISO>` | Date range filter (on file mtime). |
| `--window N` | Messages before AND after each hit (default 2). |
| `--limit N` | Max sessions returned (default 20). |
| `--max-matches-per-session N` | Cap hits per session (default 5). |
| `--regex` | Treat query as ECMAScript regex. |
| `--case-sensitive` | Case-sensitive match. |
| `--role user\|assistant\|tool_use\|tool_result\|thinking\|any` | Restrict matches by message role. |
| `--fields text,tool_use,tool_result,thinking` | Which content to search within (default `text,tool_use,tool_result`; add `thinking` to include reasoning). |
| `--sort recent\|oldest\|hits` | Session ordering. |
| `--include-sidechains` | Include subagent sidechain content. |

### `ccthread info <id>`

Everything the tool knows about one session: cwd, git branch, models used, start/end/duration, message counts per type, token totals (input/output/cache-hit/cache-create), tool-call breakdown, interrupted/api-error/compact counts.

### `ccthread tools <id>`

Tool-usage breakdown for one session. `--top N` limits the list.

### `ccthread stats`

Aggregate totals across many sessions. Without scope it covers everything; scope with `--project`, `--since`, `--until`, or combine them.

| Flag | Meaning |
|---|---|
| `--project <name>` | Limit to one project. |
| `--since <ISO>` / `--until <ISO>` | Date range. |
| `--group-by project\|day\|model` | Emit a markdown table broken down by the chosen key. |

Shows: session count, message count, total duration, role counts, token totals (with cache-hit percentage), top tools, top models, and interrupted/api-error/compact-boundary counts.

---

## Global options

| Flag / env | Meaning |
|---|---|
| `--help`, `-h` | Show usage for the main command or a subcommand. |
| `--version`, `-v` | Print the ccthread version. |
| `--strict` | Exit on malformed JSON lines instead of warning + continuing. |
| `--silent` | Suppress stderr warnings. |
| `CCTHREAD_PROJECTS_DIR` | Override the projects directory (default `~/.claude/projects`). Useful for testing. |
| `CCTHREAD_STRICT=1` | Same as `--strict`. |
| `CCTHREAD_SILENT=1` | Same as `--silent`. |

**Exit codes**: `0` success · `1` runtime error · `2` bad args or invalid input · `3` session/project not found · `4` ambiguous session id.

---

## Session identifiers

Anywhere `<id>` is accepted, you can pass:

- A **full UUID** (`2F0A28FA-23B0-41ED-BF9C-2E13144B9BED`)
- A **hex prefix ≥6 characters** (`2F0A28FA`) — disambiguated across all projects
- A **file path** (absolute, `./relative`, or `~`-rooted)
- **`last`** or **`latest`** — the most recently modified session

Ambiguous prefix → exit 4 with a list of candidates.

---

## Use cases

**Find something discussed before**
```sh
ccthread search "cache_read_input_tokens" --window 1
```

**Summarize the past week for a teammate**
```sh
ccthread list --project great-work --since $(date -v-7d +%F)
ccthread show <id> --tool-details summary   # for each interesting session
```

**Turn a past process into a skill**
```sh
ccthread show <id> --no-thinking --tool-details none > process.md
# Distill process.md into a new SKILL.md
```

**Populate a project's `CLAUDE.md`**
```sh
ccthread list --project <name> --since <date>
ccthread show <id>                          # review
```

**Learn from past mistakes**
```sh
ccthread search "api error" --window 3
ccthread info <id>                           # duration, error count, etc.
```

---

## Claude Code skill

The plugin ships a `ccthread` skill so Claude Code agents can call the CLI when the user asks about past work. After `/plugin install ccthread`:

> *"What did we decide about the rate limiter in that session last week?"*

Claude invokes `ccthread find` / `ccthread search` / `ccthread show` as needed and answers from the real conversation content.

See [`plugin/skills/ccthread/SKILL.md`](plugin/skills/ccthread/SKILL.md) for the patterns the skill recognizes.

---

## How it works

`ccthread` reads `~/.claude/projects/<encoded-project>/<uuid>.jsonl` files, streams them line-by-line (never loads whole files — some are 100+ MB), and emits markdown. Streaming means:

- `show` returns page 1 in ~80ms even on a 56 MB file.
- `find` across 11,000+ sessions finishes in ~0.4 s.
- Memory usage stays roughly constant regardless of file size.

Every recent log-line type is handled. Images are stripped to size labels. Base64 data never leaks into output. Tool-result overflow files (`<session>/tool-results/<id>.txt`) are auto-resolved.

Everything runs locally. Nothing is transmitted.

---

## Caveats

- Your `.jsonl` files contain whatever you and your tools wrote during sessions — including any secrets that leaked into prompts or tool output. `ccthread` only reads them locally, but piping output elsewhere ships that content along.
- Project-name decoding is lossy (dash vs slash ambiguity in encoded names). We walk the filesystem to disambiguate; edge cases show the naive decode.
- Branch rendering (multi-child `parentUuid` chains) is not implemented in v0.1.0 — we render in file order.

## Roadmap

- SQLite index for offset caching + sub-second cross-project search.
- `ccthread watch` for tailing active sessions.
- Branch / DAG rendering.
- HTML export.

## License

MIT © Jake Marsh
