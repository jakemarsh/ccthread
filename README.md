# ccthread

Read, search, and have Claude summarize your Claude Code conversation logs from the CLI.

Every Claude Code session gets saved as a `.jsonl` file in `~/.claude/projects/`. `ccthread` reads them and turns them into clean markdown, so you — or an agent — can actually do something with them.

## Why

Install it as a Claude Code plugin and you can ask things like:

> *"What did we decide about rate limits in that session last Thursday?"*

> *"Find the thread where we worked out the ACME setup and put what we learned in CLAUDE.md."*

> *"Summarize my checkout flow work this week. I need to update the team."*

> *"Make a skill out of the process we figured out for redacting test fixtures."*

> *"What port did we land on for the local Stripe webhook?"*

Claude runs `ccthread find` / `search` / `show` and answers from the actual conversation content. You can also use the CLI yourself — it has a real `--help` and the usual flags.

## Install

Pick whichever fits your setup. They're independent — you can do one, both, or neither and build from source.

### Option A — Claude Code plugin

Use this if you want Claude Code to call `ccthread` automatically when you ask about past conversations.

```
/plugin marketplace add jakemarsh/ccthread
/plugin install ccthread@jakemarsh
```

The repo doubles as its own marketplace. `add` registers it; `install` activates the skill. The first time Claude invokes `ccthread`, the plugin's dispatcher downloads the matching binary for your platform and caches it under `~/.claude/plugins/data/ccthread/`. No other setup needed.

### Option B — standalone CLI on your PATH

Use this if you want to run `ccthread` yourself in a shell (pipe it, script it, grep through it).

macOS / Linux:
```sh
curl -fsSL https://raw.githubusercontent.com/jakemarsh/ccthread/main/install.sh | sh
```
Drops `ccthread` in `/usr/local/bin` (or `~/.local/bin` if the first isn't writable).

Windows (PowerShell):
```powershell
irm https://raw.githubusercontent.com/jakemarsh/ccthread/main/install.ps1 | iex
```
Drops `ccthread.exe` in `%LOCALAPPDATA%\Programs\ccthread\` and adds it to your user PATH.

### Option A + B

Doing both is fine and common. The plugin keeps its own cached binary (so it doesn't care whether `ccthread` is on your PATH), and you still get the CLI for your own shell work.

### From source

```sh
git clone https://github.com/jakemarsh/ccthread && cd ccthread
bun install && bun test && bun run build
./dist/ccthread --help
```

## TL;DR

```sh
ccthread find "stripe webhook"            # which old thread discussed this?
ccthread show 2F0A28FA                    # read a session (paginated markdown)
ccthread show last                        # read the most recent session
ccthread show current                     # read THIS session (auto-detected)
ccthread search "rate limit" --window 2   # grep with surrounding context
ccthread list --project great-work --since 2026-04-01
ccthread info 2F0A28FA                    # metadata + token usage
ccthread tools 2F0A28FA                   # tool-call breakdown
ccthread stats --project great-work       # aggregate totals
ccthread projects                         # list every project
ccthread current                          # print the current session's id
```

`<id>` can be a UUID prefix (6+ hex chars, 8+ recommended), a file path, `last` / `latest`, or `current` (the session you're in right now, if ccthread is running inside Claude Code).

Every command supports `--json`, `--plain`, and `--help`.

## Using it from Claude Code

After `/plugin install ccthread`, the bundled skill tells Claude where past conversations live and when to reach for the CLI. It triggers on phrases like "past conversation", "old thread", "last session", "summarize", "what did we decide", "remember when", "find where we talked about". You can also just say "use ccthread to...".

### Things it's good for

**Recalling decisions and values.**

> What port did we use for the local Stripe webhook last time?

→ `ccthread search "stripe webhook" --window 3` and quotes the relevant messages.

**Finding an old session by topic.**

> Find the thread where we set up the ACME phone number.

→ `ccthread find "ACME"`, picks the right session, then `ccthread show <id>`.

**Writing a recap for a teammate.**

> Summarize my work on the checkout refactor this week. Under 200 words.

→ `ccthread list --project <name> --since <date>` to find the sessions, then `show` on each one, then Claude writes the recap from the rendered transcripts.

**Learning from past mistakes.**

> Why did we roll back that migration two weeks ago?

→ `ccthread search "rollback"` + `ccthread info <id>`, reads the transcript around the decision.

**Turning a past process into a skill.**

> Go look at the long session where we figured out Sparkle deploys and turn it into a skill.

→ `ccthread show <id> --no-thinking --tool-details none`, distills the steps, writes SKILL.md.

**Seeding CLAUDE.md with project knowledge.**

> Look at my last month of sessions on great-work and pull conventions into CLAUDE.md.

→ Iterates over `ccthread list` + `ccthread show`, commits new sections.

**Looking up something from the current conversation.**

> Before we compacted, you said something useful about X — find it.

→ `ccthread show current --before-last-compact` or `ccthread search "X" --session current --before-last-compact --window 3`. Works because Claude Code writes each session's transcript to disk as it goes, and ccthread can detect which session invoked it (via the parent `claude` process's argv, or the plugin's SessionStart hook for bare `claude` launches).

**Answering questions across many sessions.**

> How often have I hit Overloaded errors this week?

→ `ccthread stats --since <date>` reports api_errors directly, or `ccthread search "Overloaded"` for per-match detail.

`ccthread` itself is just the reader — the agent does the thinking, reading its output like it would a source file. Everything runs locally; nothing leaves your machine. Files are streamed, so a 100 MB session still returns page 1 in under a second.

## Direct CLI use

You don't need Claude Code to use this. It's a proper Unix CLI.

### `ccthread projects`

Lists every project under `~/.claude/projects/` with session counts and last-active date.

### `ccthread list`

| Flag | Meaning |
|---|---|
| `--project <name>` | Filter to one project (basename, decoded path, or on-disk name). |
| `--since <ISO>` | Only sessions modified on or after this ISO date. |
| `--until <ISO>` | Only sessions modified on or before this ISO date. |
| `--limit N` | Cap sessions returned (default 50). |
| `--sort recent\|oldest\|size` | Sort order (default `recent`). |

Columns: short id · start date · #messages · duration · model · title. A `project` column shows up when the scope spans multiple projects.

### `ccthread show <id-or-path>`

| Flag | Meaning |
|---|---|
| `--page N` | 1-indexed page (default 1). |
| `--per-page M` | Messages per page (default 50). |
| `--from N --to M` | 0-indexed half-open range. |
| `--no-thinking` | Hide thinking blocks. |
| `--include-sidechains` | Inline subagent sidechain messages. |
| `--tool-details full\|brief\|none` | Default `brief` (40-line truncation per tool result). `full` = untruncated. `none` = hide bodies. |
| `--count-total` | Pre-scan for accurate "Page N of M" (one extra file read). |
| `--verbose` | Show hook / progress / attachment lines too. |
| `--utc` | UTC timestamps. |

### What gets rendered

Real log files contain a lot of bookkeeping that isn't useful for reading. `show` filters it down to the parts humans and agents care about, with `--verbose` and `--include-sidechains` to pull the rest in when you want them.

**Shown by default**

- 👤 **User messages** — regular text, images, tool-use requests
- 🤖 **Assistant messages** — text, tool uses, with model + cache-hit token count in the header
- 🧩 **Tool results** — attached under the preceding tool-use instead of rendering as a synthetic user message
- ⚠️ **API errors** — status code + error message
- **Context compaction** — rule + "_Context compacted_" where Claude Code compacted the session
- **Local commands** — one-line note when you ran a slash command
- **Scheduled task fires** — one-line note
- **Permission mode changes** — inline "_Permission mode → X_"
- 🔗 **PR links** — in the document header

**Hidden by default** (use `--verbose` to see)

- `progress` — hook execution progress (very noisy)
- `attachment` — IPC metadata (tool lists, etc.)
- `queue-operation` — background task bookkeeping
- `turn_duration`, `bridge_status` — timing/transport internals
- `agent-name`, `last-prompt`, `file-history-snapshot` — internal state

**Hidden by default** (use `--include-sidechains` to see)

- Any line where `isSidechain: true` — subagent threads

Images are stripped to size labels (`[image: image/png, 124 KB]`). Base64 data never leaks into output. Long tool results that overflow to sibling `tool-results/<id>.txt` files get resolved inline.

### `ccthread find <query>`

One line per session that contains the keyword. Good for "which old thread was X in?".

| Flag | Meaning |
|---|---|
| `--project <name>` | Limit to one project. |
| `--limit N` | Max matching sessions (default 20). |
| `--snippet-len N` | Snippet context length (default 60 chars). |

Substring match, case-insensitive.

### `ccthread search <query>`

Keyword search with ±N messages of context around each hit. One section per session, each hit headed by `### Match: "..." @ msg N`.

| Flag | Meaning |
|---|---|
| `--project <name>` | Scope to one project. |
| `--session <id>` | Scope to one session. |
| `--since <ISO>` / `--until <ISO>` | Date range. |
| `--window N` | Messages before AND after each hit (default 2). |
| `--limit N` | Max sessions (default 20). |
| `--max-matches-per-session N` | Cap hits per session (default 5). |
| `--regex` | Query is an ECMAScript regex. |
| `--case-sensitive` | Case-sensitive match. |
| `--role user\|assistant\|tool_use\|tool_result\|thinking\|any` | Restrict matches by role. |
| `--fields text,tool_use,tool_result,thinking` | Which content to search within (default: text,tool_use,tool_result). |
| `--sort recent\|oldest\|hits` | Session ordering. |
| `--include-sidechains` | Include subagent content. |
| `--before-last-compact` | Only match against messages before each session's most recent `/compact`. |

### `ccthread info <id>`

Quick overview of one session — numbers and metadata, not a narrative. Covers: project, cwd, git branch, models used, start/end/duration, message counts per type, token totals (input / output / cache-hit / cache-create), tool-call breakdown, and interrupted/api-error/compact-boundary counts. For prose about what actually happened in a session, read the session with `ccthread show` or let Claude summarize it for you.

### `ccthread tools <id>`

Tool-usage breakdown (Bash: 412, Edit: 203, …). `--top N` limits the list.

### `ccthread stats`

Aggregates across many sessions. Scope with `--project`, `--since`, `--until`, or combine.

| Flag | Meaning |
|---|---|
| `--project <name>` | Limit to one project. |
| `--since <ISO>` / `--until <ISO>` | Date range. |
| `--group-by project\|day\|model` | Markdown table broken down by the chosen key. |

Shows: session count, messages, total duration, role counts, token totals (with cache-hit percentage), top tools, top models, interrupted/api-error/compact-boundary counts.

## Global options

| Flag / env | Meaning |
|---|---|
| `--help`, `-h` | Usage for main or any subcommand. |
| `--version`, `-v` | Print version. |
| `--strict` | Exit on malformed JSON lines instead of warn + continue. |
| `--silent` | Suppress stderr warnings. |
| `CCTHREAD_PROJECTS_DIR` | Override projects directory (default `~/.claude/projects`). |
| `CCTHREAD_STRICT=1` | Same as `--strict`. |
| `CCTHREAD_SILENT=1` | Same as `--silent`. |

Exit codes: `0` ok, `1` runtime error, `2` bad args, `3` session/project not found, `4` ambiguous session id.

## Session identifiers

Anywhere `<id>` is accepted you can pass:

- A full UUID (`2F0A28FA-23B0-41ED-BF9C-2E13144B9BED`)
- A hex prefix of 6+ characters (`2F0A28FA`). 8+ is recommended to avoid
  ambiguous matches when you search across all projects.
- A file path (absolute, `./relative`, or `~`-rooted).
- `last` or `latest` for the most recently modified session anywhere.
- `current` — the session that invoked ccthread. Detected in order: `CCTHREAD_SESSION_ID` env var → `--session-id` / `--resume` in an ancestor `claude` process's argv → a PID-keyed file written by the plugin's SessionStart hook. If none of those work, you'll get a clear error listing your options.

Ambiguous prefix → exit 4 with a list of candidates.

## How it works

`ccthread` reads `~/.claude/projects/<encoded-project>/<uuid>.jsonl` files and streams them line-by-line. It never loads whole files, because some are 100+ MB. That means:

- `show` returns page 1 in ~80 ms even on a 56 MB file.
- `find` across 11,000+ sessions finishes in ~0.4 s.
- Memory stays roughly constant regardless of file size.

Every recent log-line type is handled. Images stripped to size labels. Tool-result overflow files auto-resolved. All local.

## Caveats

- Your `.jsonl` files contain whatever you and your tools wrote — secrets included if they leaked into prompts or tool output. `ccthread` only reads locally, but piping output to somewhere else takes that content with it.
- Project-name decoding is lossy (dash vs slash). We walk the filesystem to disambiguate; rare edge cases fall back to the naive decode.
- No branch/DAG rendering yet. v0.1.0 renders messages in file order.

## Roadmap

- SQLite index for sub-second cross-project search.
- `ccthread watch` for tailing active sessions.
- Branch / DAG rendering.
- HTML export.

## License

MIT © Jake Marsh
