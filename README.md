# 🔭 spyglass

**See exactly what Claude Code is doing — and what it's costing you.**

[![Version](https://img.shields.io/badge/version-0.1.0--mvp-blue)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green)]()

Claude Code is a black box. Spyglass opens it.

Every token spent, every tool call made, every session started — captured in real time and surfaced in a terminal dashboard or web UI. If you've ever wondered *why* a Claude session ballooned in cost, spyglass shows you.

---

## What you get

- **Live token counter** — watch usage tick up as Claude works
- **Tool call timeline** — see which tools ran, in what order, how long each took
- **Cost tracking** — actual USD cost per session, with prompt-cache savings broken out
- **P95 latency & error rate** — spot slow or flaky tool calls before they compound
- **Web dashboard + TUI** — pick your interface; both update in real time via SSE

---

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) 1.2+, Claude Code

```bash
# 1. Clone
git clone <repository-url> ~/.spyglass-src
cd ~/.spyglass-src

# 2. Install & start
bun install
bun run dev

# 3. Verify
curl -sf http://127.0.0.1:9999/health && echo OK

# 4. Open dashboard
open http://localhost:9999
```

The server runs as a background daemon on `127.0.0.1:9999`. PID is stored at `~/.spyglass/server.pid`.

---

## Hook setup

Spyglass collects data through Claude Code hooks. Register them **globally** (`~/.claude/settings.json`) so every project is captured automatically.

Copy the `env` and `hooks` keys from one of the example files below into your existing settings — don't replace the whole file.

| Profile | Coverage | File |
|---------|----------|------|
| Minimal (6 hooks) | Tokens · sessions · tool usage | [docs/examples/settings.hooks.minimal.json](./docs/examples/settings.hooks.minimal.json) |
| Full (27 hooks) ★ | + Subagent · Task · Permission · Compact · Worktree | [docs/examples/settings.hooks.full.json](./docs/examples/settings.hooks.full.json) |

Full setup guide → [docs/install-guide.md](./docs/install-guide.md)

---

## Commands

```bash
bun run dev      # Start (or restart) the server
bun run stop     # Stop the server
bun run status   # Show server status
bun run doctor   # Diagnose configuration issues
bun run tui      # Launch the terminal UI
```

---

## TUI

```
┌─────────────────────────────────────────────────────────────────┐
│ spyglass                          ● LIVE  |  Sessions: 3        │
├─────────────────────────────────────────────────────────────────┤
│ [F1:Live] [F2:History] [F3:Analysis] [F4:Settings]              │
├──────────────┬──────────────────────────────────────────────────┤
│  Sessions    │  COST $0.42  SAVED $0.18  P95 312ms  ERR 0%     │
│  ├── proj-a  │                                                  │
│  ├── proj-b  │  Total Tokens: 45.2K                            │
│  └── proj-c  │  [████████████████████░░░░░░░░░░] 45%           │
│              │                                                  │
│              │  Active Sessions: 3  |  Session Time: 00:15:32  │
├──────────────┴──────────────────────────────────────────────────┤
│ ↑↓ Navigate | Enter Select | / Search | A Ack | q Quit         │
└─────────────────────────────────────────────────────────────────┘
```

| Key | Action |
|-----|--------|
| F1 | Live tab — real-time monitoring |
| F2 | History tab — past sessions |
| F3 | Analysis tab — usage stats |
| F4 | Settings tab — thresholds |
| ↑↓ | Navigate list |
| Enter | Select / detail view |
| / | Search |
| A | Acknowledge alert |
| q | Quit |

---

## Architecture

```
Claude Code hooks  →  spyglass-collect.sh  →  POST /collect or /events
                                                        │
                                               Bun HTTP server
                                               SQLite (WAL mode)
                                                        │
                                      ┌─────────────────┼──────────────┐
                                   TUI (Ink)     Web Dashboard     REST API
```

---

## Build (distributors only)

```bash
bash scripts/build-image.sh          # auto version from package.json + git hash
bash scripts/build-image.sh 0.2.0   # explicit version
```

Output in `dist/`: a `.tar.gz` image and a `.sha256` checksum.

---

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun 1.2+ |
| Language | TypeScript 5 |
| TUI | Ink (React) |
| Storage | SQLite WAL |
| Transport | HTTP + SSE |

---

---

## License

MIT — made for Claude Code developers who want to see inside the box.
