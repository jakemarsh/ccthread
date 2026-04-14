# ccthread

Give your Claude Code agent access to every conversation you've ever had with it.

Every Claude Code session lives as a `.jsonl` file in `~/.claude/projects/`. `ccthread` reads them locally and turns them into clean markdown — so your agent can search, summarize, and quote from past work the way it already handles source files.

## The point

After you install ccthread as a Claude Code plugin, you can say things like:

> *"What did we decide about rate limits in that session last Thursday?"*

> *"Find the thread where we worked out the Retell setup and put what we learned in CLAUDE.md."*

> *"Summarize everything I did on the checkout flow this week — I need to update the team."*

> *"Make a skill out of the process we figured out for redacting test fixtures."*

> *"Search for the port number we landed on for the local dev server."*

Claude invokes `ccthread find` / `ccthread search` / `ccthread show` under the hood and answers from the real conversation content — not a reconstruction, not a guess. You can also use it directly from your shell; it has a proper `--help` and all the ergonomic flags you'd expect.

---

## Install

**As a Claude Code plugin (recommended)**
```
/plugin install ccthread
```
That's it. The bundled skill teaches Claude when and how to invoke the CLI. See [Claude Code skill](#claude-code-skill-the-hero-feature) below for what the agent can do with it.

**macOS / Linux binary**
```sh
curl -fsSL https://raw.githubusercontent.com/jakemarsh/ccthread/main/install.sh | sh
```

**Windows (PowerShell)**
```powershell
irm https://raw.githubusercontent.com/jakemarsh/ccthread/main/install.ps1 | iex
```

**From source**
```sh
git clone https://github.com/jakemarsh/ccthread && cd ccthread
bun install && bun test && bun run build
./dist/ccthread --help
```

---

## TL;DR — the commands you'll actually use

```sh
ccthread find "stripe webhook"            # which old thread discussed this?
ccthread show 2F0A28FA                    # read a session (paginated markdown)
ccthread show last                        # read the most recent session
ccthread search "rate limit" --window 2   # grep with surrounding context
ccthread list --project great-work --since 2026-04-01
ccthread info 2F0A28FA                    # metadata + token usage
ccthread tools 2F0A28FA                   # tool-call breakdown
ccthread stats --project great-work       # aggregate totals
ccthread projects                         # list every project
```

`<id>` accepts a UUID prefix (8+ hex chars), a file path, or the literal `last` / `latest`.

Every command supports `--json`, `--plain`, and `--help`.

---

## Claude Code skill (the hero feature)

The reason ccthread exists: **Claude can answer questions about your past conversations**. That's a genuinely new capability — before this, old sessions were opaque JSONL that nothing could read without tooling.

### What you can ask

**Recall decisions and values**
> *"What port number did we use for the local Stripe webhook last time?"*
Claude runs `ccthread search "stripe webhook" --window 3` and quotes the relevant messages.

**Find an old session by topic**
> *"Find the thread where we set up the Retell phone number."*
Claude runs `ccthread find "retell"` and picks the right session, then `ccthread show <id>` to read it.

**Summarize work for a teammate**
> *"Summarize my work on the checkout refactor this week. Keep it under 200 words."*
Claude runs `ccthread list --project <name> --since <date>` then `ccthread show` on each, then writes the summary.

**Learn from past mistakes**
> *"Why did we roll back the migration in that session two weeks ago? What happened?"*
Claude runs `ccthread search "rollback"` or `ccthread info <id>`, reads the transcript around the decision, and explains.

**Turn a past process into a skill**
> *"Go look at that long session where we figured out how to deploy the Mac app via Sparkle — turn what we learned into a skill."*
Claude runs `ccthread show <id> --no-thinking --tool-details none`, distills the steps, and writes a new `SKILL.md`.

**Populate CLAUDE.md with project knowledge**
> *"Look at my last month of sessions on great-work and pull out the conventions we've settled on into CLAUDE.md."*
Claude iterates over `ccthread list --project great-work --since <date>` and `ccthread show`, then commits new sections to CLAUDE.md.

**Answer questions across many sessions**
> *"How often have I hit 'Overloaded' errors this week?"*
Claude runs `ccthread stats --since <date>` (it reports api_errors directly) or `ccthread search "Overloaded"`.

### How it works under the hood

After `/plugin install ccthread`, the plugin registers a skill (`plugin/skills/ccthread/SKILL.md`) that tells Claude:
- where past conversations live
- which ccthread subcommand fits which kind of question
- which flags to reach for (`--no-thinking` when summarizing, `--include-sidechains` when you want subagent work, `--json` when chaining)

The skill auto-triggers on phrases like "past conversation", "old thread", "last session", "summarize", "what did we decide", "remember when", "find where we talked about". You can also call it directly: "use the ccthread skill to…"

The CLI itself runs purely locally. Nothing leaves your machine. Files are read lazily via streams, so even 100+ MB sessions return page 1 in under a second.

---

## Direct CLI use

You don't need to be in Claude Code to use ccthread — it's a proper Unix CLI.

### `ccthread projects`

List every project under `~/.claude/projects/` with session counts and last-active date.

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

Print a single conversation as paginated markdown.

| Flag | Meaning |
|---|---|
| `--page N` | 1-indexed page (default 1). |
| `--per-page M` | Messages per page (default 50). |
| `--from N --to M` | 0-indexed half-open range (alternative to pagination). |
| `--no-thinking` | Hide thinking blocks. Shown by default. |
| `--include-sidechains` | Inline subagent sidechain messages. Hidden by default. |
| `--tool-details full\|summary\|none` | Tool-result display. Default `summary` (40 lines). `full` = untruncated; `none` = hide bodies. |
| `--count-total` | Pre-scan to compute total message count (enables "Page N of M"). One extra file read. |
| `--verbose` | Also show hook / progress / attachment noise. |
| `--utc` | Timestamps in UTC. |

**What's rendered by default** (everything else is hidden; `--verbose` reveals the noise):

| Line type | Default |
|---|---|
| `user` with text/image/tool_use/etc | 👤 User |
| `user` with only `tool_result` blocks | 🧩 Tool result, attached to preceding tool_use |
| `assistant` | 🤖 Assistant (with model + cache-hit tokens) |
| `system` `api_error` | ⚠️ API error (status + message) |
| `system` `compact_boundary` | rule + "_Context compacted_" |
| `system` `local_command` / `scheduled_task_fire` | one-line note |
| `permission-mode` | inline note |
| `pr-link` | 🔗 link in the doc header |
| `progress` / `attachment` / `queue-operation` / `turn_duration` / `bridge_status` / `agent-name` / `last-prompt` / `file-history-snapshot` | hidden |
| `isSidechain: true` (any type) | hidden unless `--include-sidechains` |

Images are stripped to size labels (`[image: image/png, 124 KB]`). Base64 data never leaks into output. Long tool results that overflow to sibling `tool-results/<id>.txt` files are resolved inline.

### `ccthread find <query>`

One line per session that contains the keyword. Use this for *"which old thread was X in?"*.

| Flag | Meaning |
|---|---|
| `--project <name>` | Limit to one project. |
| `--limit N` | Max matching sessions (default 20). |
| `--snippet-len N` | Snippet context length (default 60 chars). |

Substring match, case-insensitive.

### `ccthread search <query>`

Keyword search with ±N messages of context around each hit. Grouped output: one section per session, each hit headed by `### Match: "..." @ msg N`.

| Flag | Meaning |
|---|---|
| `--project <name>` | Scope to one project. |
| `--session <id>` | Scope to one session. |
| `--since <ISO>` / `--until <ISO>` | Date range filter. |
| `--window N` | Messages before AND after each hit (default 2). |
| `--limit N` | Max sessions (default 20). |
| `--max-matches-per-session N` | Cap hits per session (default 5). |
| `--regex` | Treat query as ECMAScript regex. |
| `--case-sensitive` | Case-sensitive match. |
| `--role user\|assistant\|tool_use\|tool_result\|thinking\|any` | Restrict matches by role. |
| `--fields text,tool_use,tool_result,thinking` | Which content to search within (default `text,tool_use,tool_result`). |
| `--sort recent\|oldest\|hits` | Session ordering. |
| `--include-sidechains` | Include subagent content. |

### `ccthread info <id>`

Full metadata for one session: project, cwd, git branch, models, start/end/duration, message counts per type, token totals (input/output/cache-hit/cache-create), tool-call breakdown, interrupted/api-error/compact-boundary counts.

### `ccthread tools <id>`

Tool-usage breakdown for one session (Bash: 412, Edit: 203, …). `--top N` limits the list.

### `ccthread stats`

Aggregate totals across many sessions. Scope with `--project`, `--since`, `--until`, or combine.

| Flag | Meaning |
|---|---|
| `--project <name>` | Limit to one project. |
| `--since <ISO>` / `--until <ISO>` | Date range. |
| `--group-by project\|day\|model` | Emit a markdown table broken down by the chosen key. |

Shows: session count, message count, total duration, role counts, token totals (with cache-hit percentage), top tools, top models, interrupted/api-error/compact-boundary counts.

---

## Global options

| Flag / env | Meaning |
|---|---|
| `--help`, `-h` | Usage for main or any subcommand. |
| `--version`, `-v` | Print the ccthread version. |
| `--strict` | Exit on malformed JSON lines instead of warning + continuing. |
| `--silent` | Suppress stderr warnings. |
| `CCTHREAD_PROJECTS_DIR` | Override projects directory (default `~/.claude/projects`). |
| `CCTHREAD_STRICT=1` | Same as `--strict`. |
| `CCTHREAD_SILENT=1` | Same as `--silent`. |

**Exit codes**: `0` ok · `1` runtime error · `2` bad args / invalid input · `3` session or project not found · `4` ambiguous session id.

---

## Session identifiers

Anywhere `<id>` is accepted you can pass:

- A **full UUID** (`2F0A28FA-23B0-41ED-BF9C-2E13144B9BED`)
- A **hex prefix ≥6 characters** (`2F0A28FA`) — disambiguated across all projects
- A **file path** (absolute, `./relative`, or `~`-rooted)
- **`last`** or **`latest`** — the most recently modified session anywhere

Ambiguous prefix → exit 4 with a list of candidates.

---

## How it works

`ccthread` reads `~/.claude/projects/<encoded-project>/<uuid>.jsonl` files and streams them line-by-line (never loads whole files — some are 100+ MB). Streaming means:

- `show` returns page 1 in ~80 ms even on a 56 MB file.
- `find` across 11,000+ sessions finishes in ~0.4 s.
- Memory usage stays roughly constant regardless of file size.

Every recent log-line type is handled. Images are stripped to size labels. Tool-result overflow files are auto-resolved. Everything runs locally.

---

## Caveats

- Your `.jsonl` files contain whatever you and your tools wrote during sessions — including any secrets that leaked into prompts or tool output. `ccthread` only reads them locally, but piping output elsewhere ships that content along.
- Project-name decoding is lossy (dash vs slash ambiguity). We walk the filesystem to disambiguate; rare edge cases show the naive decode.
- Branch rendering (multi-child `parentUuid` chains) is not implemented — v0.1.0 renders in file order.

## Roadmap

- SQLite index for offset caching + sub-second cross-project search.
- `ccthread watch` for tailing active sessions.
- Branch / DAG rendering.
- HTML export.

## License

MIT © Jake Marsh
