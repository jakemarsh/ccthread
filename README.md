# ccthread

Read, search, and summarize your Claude Code conversation history from the CLI.

Every Claude Code session lives as a `.jsonl` file in `~/.claude/projects/`. `ccthread` turns them into clean markdown you can actually read — or feed back into an agent that's reviewing past work.

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
See [Claude Code skill](#claude-code-skill) below.

**From source**
```sh
git clone https://github.com/jakemarsh/ccthread && cd ccthread
bun install && bun test && bun run build
./dist/ccthread --help
```

## Quickstart

```sh
# What projects do I have?
ccthread projects

# 10 most recent sessions in a project
ccthread list --project great-work --limit 10

# Which old conversation mentioned Retell?
ccthread find "retell phone" --limit 5

# Read a session (first 50 messages)
ccthread show 2F0A28FA

# Pull every mention of "port 3000" with ±2 messages of context
ccthread search "port 3000" --window 2

# Stats for the last two weeks of a project
ccthread stats --project great-work --since 2026-04-01
```

## Commands

| Command | What it does |
|---|---|
| `ccthread projects` | List all projects + session counts |
| `ccthread list [--project ...] [--since ...] [--sort ...]` | List conversations |
| `ccthread show <id> [--page N] [--per-page M] [--no-thinking] [--tool-details full\|summary\|none]` | Print a conversation as markdown |
| `ccthread find <query> [--project ...] [--limit N]` | Find conversations by keyword (one line each) |
| `ccthread search <query> [--window N] [--limit N] [--regex]` | Keyword search with context windows |
| `ccthread info <id>` | Metadata + message counts + token totals |
| `ccthread tools <id>` | Tool usage breakdown |
| `ccthread stats [--project ...] [--group-by project\|day\|model]` | Aggregate stats |

Every command accepts `--json` for structured output, `--plain` to strip markdown, `--help` for inline help.

`<id>` accepts: a full session UUID, a prefix of at least 6 hex chars, a file path, or `last` / `latest` for the most recently modified session. `--project` accepts the decoded path, the basename, or the encoded-with-dashes form.

## Use cases

**Find something you discussed before**
```sh
ccthread search "cache_read_input_tokens" --window 1
```

**Summarize the past week for a teammate**
```sh
ccthread list --project great-work --since $(date -v-7d +%F)
ccthread show <id> --tool-details summary   # for each interesting session
```

**Turn a process into a skill**
```sh
ccthread show <id> --no-thinking > process.md
# Distill process.md into a new SKILL.md
```

**Populate a project's CLAUDE.md**
```sh
ccthread list --project <name> --since <date>
ccthread show <id> | grep -A5 "decided"
```

## How it works

`ccthread` reads `~/.claude/projects/<encoded-project>/<uuid>.jsonl` files, streams them line by line (never loading entire files — some are 100+ MB), and emits markdown. It handles every known message type in recent Claude Code versions: text, thinking, tool uses, tool results (including overflow files), images (stripped to size labels), system events (API errors, compact boundaries), sidechains, interrupted turns, and more.

Everything runs locally. Nothing is transmitted.

## Claude Code skill

The plugin bundles a `ccthread` skill so Claude Code agents can call the CLI whenever the user asks about past work. After `/plugin install ccthread`:

> "What did we decide about the rate limiter in that session last week?"

Claude will invoke `ccthread find` / `ccthread search` / `ccthread show` as needed and answer from real conversation content.

See [`plugin/skills/ccthread/SKILL.md`](plugin/skills/ccthread/SKILL.md) for the patterns the skill knows.

## Caveats

Your `.jsonl` files contain whatever you and your tools wrote during sessions — including any secrets that leaked into prompts or tool output. `ccthread` only reads them locally, but piping output elsewhere ships that content along.

## License

MIT © Jake Marsh
