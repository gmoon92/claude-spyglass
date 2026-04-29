# 🔭 spyglass

**The observability layer Claude Code never gave you.**

[![Version](https://img.shields.io/badge/version-0.1.0--mvp-blue)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green)]()

---

You just ran a Claude Code session. It cost $3.47. You have no idea why.

Was it the subagent that went deep? The loop that read 40 files? The context that silently ballooned while you weren't looking? Claude Code doesn't tell you. It just charges you.

**Spyglass tells you.** Every token spent, every tool called, every millisecond waited — captured in real time and surfaced in a live web dashboard.

---

## What you'll see

| | |
|---|---|
| **Token burn, live** | Watch the counter tick up as Claude works. Catch the moment a session starts spending too fast. |
| **Tool call timeline** | Every `Read`, `Bash`, `Agent` — sequenced, timed, with duration. Find the slow ones instantly. |
| **Actual cost** | USD per session, not vague token counts. Prompt-cache savings broken out separately. |
| **P95 latency · error rate** | Aggregated across sessions. Know your tool call health at a glance. |

---

## Quick Start

**Requires:** [Bun](https://bun.sh) 1.2+, Claude Code

```bash
# Clone & start
git clone <repository-url> ~/.spyglass-src
cd ~/.spyglass-src && bun install && bun run dev

# Verify
curl -sf http://127.0.0.1:9999/health && echo OK

# Open dashboard
open http://localhost:9999
```

Then wire up Claude Code hooks so spyglass receives data from every session — including future projects automatically.

Copy the `env` and `hooks` keys from one of the examples below into your **global** `~/.claude/settings.json`:

| Profile | Hooks | Coverage |
|---------|-------|----------|
| Minimal | 6 | Tokens · sessions · tool usage |
| **Full ★** | **27** | **+ Subagent · Task · Permission · Compact · Worktree** |

Examples: [`settings.hooks.minimal.json`](./docs/examples/settings.hooks.minimal.json) · [`settings.hooks.full.json`](./docs/examples/settings.hooks.full.json)

Full guide → [docs/install-guide.md](./docs/install-guide.md)

---

## Commands

```bash
bun run dev      # Start (or restart) the server
bun run stop     # Stop the server
bun run status   # Show server status
bun run doctor   # Diagnose hook + config issues
```

---

## Stack

Bun · TypeScript · SQLite WAL · HTTP + SSE

---

MIT — made with obsession for Claude Code developers who hate flying blind.
