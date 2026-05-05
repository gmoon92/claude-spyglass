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

**Requires:** [Bun](https://bun.sh) 1.2+, [Claude Code](https://claude.ai/code)

```bash
# 1. Claude Code 설치 (미설치 시)
curl -fsSL https://claude.ai/install.sh | bash

# 2. Bun 설치 (미설치 시)
curl -fsSL https://bun.sh/install | bash

# 3. Clone & start
git clone <repository-url> ~/.spyglass-src
cd ~/.spyglass-src && bun install && bun run dev

# 4. Verify
curl -sf http://127.0.0.1:9999/health && echo OK

# 5. Open dashboard
open http://localhost:9999
```

### 채널 A — 훅 (툴 타임라인·세션)

`~/.claude/settings.json`(글로벌)에 `env`와 `hooks` 키를 병합합니다:

| Profile | Hooks | Coverage |
|---------|-------|----------|
| Minimal | 6 | Tokens · sessions · tool usage |
| **Full ★** | **27** | **+ Subagent · Task · Permission · Compact · Worktree** |

Examples: [`settings.hooks.minimal.json`](./docs/examples/settings.hooks.minimal.json) · [`settings.hooks.full.json`](./docs/examples/settings.hooks.full.json)

### 채널 B — 프록시 (토큰·비용·시스템 프롬프트)

spyglass가 실행 중일 때만 경유하도록 `.zshrc` / `.bashrc`에 추가:

```bash
claude() {
  if curl -sf http://localhost:9999/health > /dev/null 2>&1; then
    ANTHROPIC_BASE_URL=http://localhost:9999 command claude "$@"
  else
    command claude "$@"
  fi
}
```

또는 `~/.claude/settings.json`에서 항상 경유:

```jsonc
{
  "env": {
    "SPYGLASS_DIR": "/Users/<your-name>/.spyglass-src",
    "ANTHROPIC_BASE_URL": "http://localhost:9999"
  }
}
```

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
