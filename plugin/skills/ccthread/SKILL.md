---
name: ccthread
description: Read, search, and summarize Claude Code conversation history. Use when the user asks to find things discussed in past sessions, review old threads, summarize recent work for teammates, extract learnings into a skill or CLAUDE.md, or answer "what was that value/port/command we used?" — ccthread reads ~/.claude/projects/ and emits clean markdown. Triggers on "past conversation", "old thread", "last session", "review", "summarize", "what did we", "find where we talked", "remember when", "conversation history".
allowed-tools: Bash
---

# ccthread — past-conversation archaeology

You have a CLI tool `ccthread` available. It reads Claude Code conversation logs from `~/.claude/projects/` and returns clean markdown. Use it whenever the user asks about past work.

## Common patterns

**Find a conversation by topic**
```
ccthread find "<keywords>" --limit 10
```

**Read a conversation**
```
ccthread show <id> --page 1 --per-page 50
```
Paginate with `--page 2` etc. Run `ccthread info <id>` first to see how long it is.

**Keyword search with context**
```
ccthread search "<query>" --window 2 --limit 5
```
Good for "what did we decide about X?" — returns ±2 messages around each hit.

**Summarize recent work on a project**
```
ccthread list --project <name> --since 2026-04-01
ccthread show <id>  # for each session you want to dig into
```

**Stats / overview**
```
ccthread stats --project <name> --since <date>
```

**Tool usage for a session**
```
ccthread tools <id>
```

## Tips

- Session ids can be short (8-char prefix) or full UUIDs. `last` / `latest` resolves to the most recent session.
- `--no-thinking` hides thinking blocks when they're noise.
- `--tool-details none` hides tool outputs entirely (cleanest for summaries); `full` shows them untruncated.
- `--include-sidechains` inlines subagent threads.
- `--json` emits structured output when you need to re-process it.
- Default page size is 50 messages.

## When to reach for this skill

- "what was that port/env/value we settled on in the X session?" → `ccthread search`
- "summarize last week on project Y for the team" → `ccthread list --since ...` then `ccthread show <id>` on each
- "make a skill from that process we worked out" → `ccthread show <id>` then distill into SKILL.md
- "update CLAUDE.md with lessons from recent work" → `ccthread list --project ... --since ...` → read → write
- "find where we hit that bug and what we tried" → `ccthread find "<error text>"`

## Running ccthread outside this skill

This skill is all you need when you're in Claude Code — the dispatcher keeps a cached binary under `~/.claude/plugins/data/ccthread/`. If you want `ccthread` on your shell PATH too, the project's install scripts drop it there:

```sh
curl -fsSL https://raw.githubusercontent.com/jakemarsh/ccthread/main/install.sh | sh          # macOS / Linux
irm https://raw.githubusercontent.com/jakemarsh/ccthread/main/install.ps1 | iex              # Windows PowerShell
```

Repo: https://github.com/jakemarsh/ccthread
