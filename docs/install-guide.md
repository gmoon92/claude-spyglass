# spyglass 설치 가이드

Claude Code 실행 과정을 가시화하는 spyglass를 **로컬 클론 + Bun 직접 실행** 방식으로 설치하는 절차입니다.

> 모든 명령은 그대로 실행 가능하며, 사용자 환경에 따라 치환해야 하는 값은 `<...>` 형태로 명시합니다.

---

## 목차

1. [구성 개요](#1-구성-개요)
2. [필수 조건](#2-필수-조건)
3. [설치 절차](#3-설치-절차)
4. [Claude Code 훅 설정](#4-claude-code-훅-설정)
5. [동작 확인](#5-동작-확인)
6. [관리 명령어](#6-관리-명령어)
7. [업데이트](#7-업데이트)
8. [문제 해결](#8-문제-해결)

---

## 1. 구성 개요

spyglass는 호스트에서 **Bun 프로세스로 직접 실행**되며, Claude Code의 글로벌 훅이 HTTP로 데이터를 전달하는 단순한 구조입니다.

```
┌──────────────────────── 호스트 ────────────────────────┐
│                                                        │
│   Claude Code                                          │
│      │                                                 │
│      │  훅 이벤트 발생                                 │
│      ▼                                                 │
│   ~/.claude/settings.json (글로벌, 사용자 전체 적용)   │
│      │                                                 │
│      │  bash $SPYGLASS_DIR/hooks/spyglass-collect.sh   │
│      ▼                                                 │
│   훅 스크립트                                          │
│      │                                                 │
│      │  HTTP POST http://127.0.0.1:9999/{collect,events}│
│      ▼                                                 │
│   spyglass 서버 (Bun, bun run dev)                     │
│      │                                                 │
│      ▼                                                 │
│   ~/.spyglass/                                         │
│     ├── spyglass.db        (SQLite, WAL 모드)         │
│     ├── server.pid         (서버 PID)                 │
│     ├── pricing.json       (모델 가격, 자동 생성)     │
│     └── logs/              (collect.log, hook-raw.jsonl)│
│                                                        │
└────────────────────────────────────────────────────────┘
```

**원칙**

- 훅은 **반드시 글로벌 사용자 설정 `~/.claude/settings.json`** 에만 등록합니다. 프로젝트 로컬 `.claude/settings.json` 또는 `.claude/settings.local.json`에는 등록하지 않습니다.
- 모든 데이터는 `~/.spyglass/` 아래에 저장되며, 저장소 클론 디렉토리와 독립적입니다(클론 디렉토리를 옮겨도 데이터는 보존).
- 서버는 `bun run dev`로 백그라운드 데몬화되어 PID 파일(`~/.spyglass/server.pid`)로 관리됩니다.

---

## 2. 필수 조건

| 구성요소 | 버전 | 확인 명령 |
|---------|------|----------|
| **Bun** | 1.2.0 이상 | `bun --version` |
| **Git** | 2.x 이상 | `git --version` |
| **Claude Code** | 최신 | `claude --version` |
| **curl** | 호스트 기본 | `curl --version` |
| **jq** (권장) | 1.6 이상 | `jq --version` — `~/.claude/settings.json` 자동 병합용 |

### Bun 미설치 시

```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL -l   # PATH 갱신
bun --version
```

### jq 미설치 시 (선택)

```bash
# macOS
brew install jq

# Linux (Debian/Ubuntu)
sudo apt-get install -y jq
```

---

## 3. 설치 절차

### 3.1 저장소 클론

```bash
# 권장 위치: ~/.spyglass-src
git clone <repository-url> "${HOME}/.spyglass-src"
cd "${HOME}/.spyglass-src"
```

> `<repository-url>` 은 spyglass 저장소의 git URL로 치환합니다. 비공개 저장소라면 SSH(`git@github.com:<org>/<repo>.git`) 또는 HTTPS+토큰(`.netrc` / git credential helper)으로 인증합니다.

### 3.2 의존성 설치

```bash
cd "${HOME}/.spyglass-src"
bun install
```

bun 워크스페이스(`packages/*`)가 한 번에 설치됩니다.

### 3.3 서버 기동

```bash
cd "${HOME}/.spyglass-src"
bun run dev
```

`bun run dev`는 `restart` 동작입니다 — 기존에 실행 중이던 spyglass 서버 프로세스가 있으면 종료 후 재기동합니다. 백그라운드 데몬으로 동작하며 PID는 `~/.spyglass/server.pid`에 기록됩니다.

기본 바인딩: `127.0.0.1:9999` (loopback only).

### 3.4 헬스체크

```bash
curl -sf http://127.0.0.1:9999/health && echo OK
# OK
```

`OK`가 출력되면 서버가 정상 기동된 상태입니다.

---

## 4. Claude Code 훅 설정

> **반드시 `~/.claude/settings.json`(글로벌 사용자 설정)** 에 등록합니다. 프로젝트 단위 설정에 등록하면 다른 프로젝트에서 데이터 공백이 발생합니다.

### 4.1 SPYGLASS_DIR 확인

훅 명령은 `$SPYGLASS_DIR` 환경변수를 참조합니다. 이 값은 `~/.claude/settings.json`의 `env` 키에 설정하며, Claude Code가 훅 실행 시 자동으로 주입합니다.

저장소를 클론한 절대 경로를 확인합니다:

```bash
# 예: ~/.spyglass-src 에 클론한 경우
cd "${HOME}/.spyglass-src" && pwd
# /Users/alice/.spyglass-src
```

훅 스크립트 실행 권한 확인:

```bash
SPYGLASS_DIR="$(cd "${HOME}/.spyglass-src" && pwd)"
test -x "$SPYGLASS_DIR/hooks/spyglass-collect.sh" && echo OK || chmod +x "$SPYGLASS_DIR/hooks/spyglass-collect.sh"
```

### 4.2 기존 설정 백업

```bash
mkdir -p "${HOME}/.claude"
if [ -f "${HOME}/.claude/settings.json" ]; then
  cp "${HOME}/.claude/settings.json" "${HOME}/.claude/settings.json.bak-$(date +%Y%m%d-%H%M%S)"
fi
```

### 4.3 훅 프로파일 선택

| 프로파일 | 훅 수 | 수집 범위 | 예제 |
|---------|------|----------|------|
| **최소** | 6개 | UserPromptSubmit, PreToolUse, PostToolUse, SessionStart, SessionEnd, Stop | [`docs/examples/settings.hooks.minimal.json`](./examples/settings.hooks.minimal.json) |
| **권장** ★ | 27개 | Subagent / Task / Permission / Compact / Worktree / FileChanged / CwdChanged 등 전체 HOOK_EVENTS | [`docs/examples/settings.hooks.full.json`](./examples/settings.hooks.full.json) |

### 4.4 자동 병합 (jq 사용 — 권장)

기존 `~/.claude/settings.json`의 `model`, `enabledPlugins`, `statusLine` 등 다른 키를 보존하면서 `env.SPYGLASS_DIR`과 `hooks` 키만 병합합니다.

```bash
SPYGLASS_DIR="$(cd "${HOME}/.spyglass-src" && pwd)"
PROFILE="${HOME}/.spyglass-src/docs/examples/settings.hooks.full.json"   # 또는 settings.hooks.minimal.json
SETTINGS="${HOME}/.claude/settings.json"

# 기존 settings.json이 없으면 빈 객체로 시작
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

# env.SPYGLASS_DIR을 실제 절대 경로로 치환한 프로파일을 메모리에 로드 → 기존 설정과 병합
TMP="$(mktemp)"
jq --arg dir "$SPYGLASS_DIR" --slurpfile profile "$PROFILE" '
  . as $orig
  | $profile[0] as $p
  | $orig
  | .env  = ((.env  // {}) + ($p.env  // {}) + {SPYGLASS_DIR: $dir})
  | .hooks = ((.hooks // {}) + ($p.hooks // {}))
' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"

# 병합 결과 검증
jq '.env.SPYGLASS_DIR, (.hooks | keys | length)' "$SETTINGS"
# "/Users/alice/.spyglass-src"
# 29   (또는 6)
```

### 4.5 수동 병합 (jq 미사용 시)

`~/.claude/settings.json`을 텍스트 에디터로 열고 다음 두 키를 추가/병합합니다.

```jsonc
{
  // 기존 model, enabledPlugins, statusLine, autoMemoryEnabled 등은 그대로 유지

  "env": {
    "SPYGLASS_DIR": "/Users/<your-name>/.spyglass-src"
    // 기존 env가 있으면 다른 키와 함께 보존
  },
  "hooks": {
    // 예제 파일(docs/examples/settings.hooks.full.json 또는 minimal.json)의
    // hooks 객체 내용을 그대로 추가
  }
}
```

규칙:
- `SPYGLASS_DIR` 값은 **절대 경로**여야 합니다. `~`는 일부 환경에서 해석되지 않을 수 있습니다.
- 기존 `hooks` 키와 충돌하는 이벤트 키가 있으면 배열을 병합합니다(둘 다 실행되도록).
- 파일 전체를 예제로 **덮어쓰지 마세요** — 다른 훅·MCP 서버·권한 설정이 사라집니다.

### 4.6 환경변수

모든 spyglass 환경변수는 `~/.claude/settings.json`의 `env` 키에서 설정합니다. Claude Code가 훅 실행 시 자동으로 주입하므로 shell profile(`.zshrc` 등)에 따로 추가할 필요 없습니다.

```jsonc
// ~/.claude/settings.json
{
  "env": {
    "SPYGLASS_DIR": "/Users/alice/.spyglass-src",   // 필수
    "SPYGLASS_HOST": "localhost",                    // 선택, 기본값: localhost
    "SPYGLASS_PORT": "9999",                         // 선택, 기본값: 9999
    "SPYGLASS_TIMEOUT": "1"                          // 선택, 기본값: 1 (초)
  }
}
```

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SPYGLASS_DIR` | 클론된 저장소 절대 경로 | **필수** |
| `SPYGLASS_HOST` | 서버 호스트 | `localhost` |
| `SPYGLASS_PORT` | 서버 포트 | `9999` |
| `SPYGLASS_TIMEOUT` | 훅 → 서버 HTTP 타임아웃(초) | `1` |

### 4.7 Claude Code 재시작

`~/.claude/settings.json` 변경 후 Claude Code를 **완전히 종료**하고 다시 실행해야 훅이 로드됩니다.

### 4.8 주의사항

- Claude Code는 이벤트 키 수준의 `"*"` 와일드카드를 **지원하지 않습니다**. 이벤트는 **개별 등록**해야 합니다.
- `matcher: "*"`는 `PreToolUse` / `PostToolUse` / `PostToolUseFailure`의 **도구 매칭 전용**입니다.
- `type: "command"` 필드가 없으면 Claude Code가 훅을 무시합니다.

---

## 5. 동작 확인

### 5.1 doctor (자동 검증)

```bash
cd "${HOME}/.spyglass-src"
bun run doctor
```

다음 5단계를 자동 점검합니다:

1. Bun 런타임 / 버전
2. 서버 프로세스 / 헬스체크
3. `~/.claude/settings.json` 훅 등록 여부 (`spyglass-collect.sh` 명령 포함 검사)
4. `SPYGLASS_DIR` 경로 유효성
5. DB 파일 / 마이그레이션 버전

### 5.2 훅 수집 로그

Claude Code 세션을 한 번 실행한 뒤:

```bash
# 훅 스크립트 실행 로그
tail -n 20 "${HOME}/.spyglass/logs/collect.log"

# raw 이벤트 (전체 훅 페이로드)
tail -n 20 "${HOME}/.spyglass/logs/hook-raw.jsonl"
```

### 5.3 이벤트 분포 확인

```bash
# bun으로 (별도 sqlite3 설치 불필요)
bun -e 'const {Database} = require("bun:sqlite");
  const db = new Database(`${process.env.HOME}/.spyglass/spyglass.db`);
  console.table(db.query("SELECT event_type, COUNT(*) as count FROM claude_events GROUP BY event_type ORDER BY count DESC").all());'
```

또는 호스트에 `sqlite3`이 있으면:

```bash
sqlite3 "${HOME}/.spyglass/spyglass.db" \
  "SELECT event_type, COUNT(*) FROM claude_events GROUP BY event_type ORDER BY 2 DESC;"
```

### 5.4 대시보드

```bash
# macOS
open http://127.0.0.1:9999

# Linux
xdg-open http://127.0.0.1:9999
```

최소 한 번의 Claude Code 세션이 수집되면 세션 목록·실시간 피드·통계가 표시됩니다.

---

## 6. 관리 명령어

모든 명령은 클론된 저장소(`~/.spyglass-src`) 디렉토리에서 실행합니다.

| 작업 | 명령어 | 비고 |
|------|--------|------|
| 기동 / 재시작 | `bun run dev` | PID 파일이 있으면 기존 프로세스 종료 후 재기동 |
| 중지 | `bun run stop` | PID 파일 기준 SIGTERM |
| 상태 확인 | `bun run status` | PID·포트·헬스 한 줄 요약 |
| 환경 검증 | `bun run doctor` | 5단계 점검 |
| 타입 체크 | `bun run typecheck` | `tsc --noEmit` |
| 테스트 | `bun test` | 워크스페이스 전체 테스트 |
| TUI (선택) | `bun run tui` | 터미널 대시보드 |

### 6.1 데이터 위치

| 항목 | 경로 |
|------|------|
| DB | `~/.spyglass/spyglass.db` |
| WAL/SHM | `~/.spyglass/spyglass.db-wal`, `~/.spyglass/spyglass.db-shm` |
| 가격표 | `~/.spyglass/pricing.json` (자동 생성, 직접 편집 가능) |
| 훅 로그 | `~/.spyglass/logs/collect.log` |
| 훅 원본 페이로드 | `~/.spyglass/logs/hook-raw.jsonl` |
| 서버 PID | `~/.spyglass/server.pid` |

### 6.2 모델 가격 커스터마이징

Anthropic 가격 변경 시 `~/.spyglass/pricing.json`을 편집하면 반영됩니다(없으면 첫 기동 시 기본값 자동 생성).

```json
[
  {
    "model": "claude-opus-4-7",
    "input": 15,
    "output": 75,
    "cacheCreate": 18.75,
    "cacheRead": 1.5
  }
]
```

단위는 **1M 토큰당 USD**. 파일은 프로세스 시작 시 1회 로드되므로 수정 후 `bun run dev`로 재시작.

---

## 7. 업데이트

```bash
cd "${HOME}/.spyglass-src"
git pull
bun install
bun run dev   # 자동으로 기존 프로세스 종료 후 재기동
```

DB 마이그레이션은 서버 기동 시 자동 적용됩니다(`PRAGMA user_version`으로 추적).

---

## 8. 문제 해결

### 8.1 `curl http://127.0.0.1:9999/health`가 실패

```bash
# 1) 서버 상태 확인
cd "${HOME}/.spyglass-src" && bun run status

# 2) 포트 충돌 확인
lsof -iTCP:9999 -sTCP:LISTEN

# 3) PID 파일이 stale인 경우
rm -f "${HOME}/.spyglass/server.pid"
cd "${HOME}/.spyglass-src" && bun run dev
```

### 8.2 Claude Code 세션을 실행해도 데이터가 수집되지 않음

```bash
# 자동 진단
cd "${HOME}/.spyglass-src" && bun run doctor
```

수동 체크리스트:

1. **글로벌 설정 확인** — `jq '.env.SPYGLASS_DIR, (.hooks|keys|length)' ~/.claude/settings.json`
2. **훅 스크립트 실행 권한** — `ls -l "$(jq -r .env.SPYGLASS_DIR ~/.claude/settings.json)/hooks/spyglass-collect.sh"`
3. **Claude Code 재시작 여부** — 설정 변경 후 반드시 재시작
4. **서버 실행 여부** — `curl -sf http://127.0.0.1:9999/health`
5. **훅 로그** — `tail "${HOME}/.spyglass/logs/collect.log"` 에 오류가 있는지

### 8.3 `~/.spyglass` 권한 오류

```bash
# 소유자가 본인이 아닌 경우 (예: 과거 root로 생성됨)
sudo chown -R "$(id -u):$(id -g)" "${HOME}/.spyglass"
chmod 700 "${HOME}/.spyglass"
```

### 8.4 DB 마이그레이션 확인

```bash
bun -e 'const {Database}=require("bun:sqlite");
  const db = new Database(`${process.env.HOME}/.spyglass/spyglass.db`);
  console.log(db.query("PRAGMA user_version").get());'
# { user_version: 13 }   (마이그레이션 파일 수와 일치해야 함)
```

### 8.5 완전 초기화

> ⚠️ **경고**: 이 명령은 모든 수집 데이터를 영구 삭제합니다.

```bash
cd "${HOME}/.spyglass-src" && bun run stop
rm -rf "${HOME}/.spyglass"
cd "${HOME}/.spyglass-src" && bun run dev
```

### 8.6 훅 등록 해제

`~/.claude/settings.json`에서 `env.SPYGLASS_DIR`과 spyglass 관련 `hooks` 항목을 제거하거나, 백업 파일로 복원합니다.

```bash
# 가장 최근 백업으로 복원
cp "$(ls -1t ${HOME}/.claude/settings.json.bak-* 2>/dev/null | head -1)" "${HOME}/.claude/settings.json"
```

---

## 참고

- [README.md](../README.md) — 프로젝트 개요와 기능 설명
- [examples/settings.hooks.minimal.json](./examples/settings.hooks.minimal.json) — 최소 훅 프로파일
- [examples/settings.hooks.full.json](./examples/settings.hooks.full.json) — 권장(전체) 훅 프로파일
