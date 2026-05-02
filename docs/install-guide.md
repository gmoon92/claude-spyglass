# spyglass 설치 가이드

Claude Code 실행 과정을 가시화하는 spyglass를 **로컬 클론 + Bun 직접 실행** 방식으로 설치하는 절차입니다.

> 모든 명령은 그대로 실행 가능하며, 사용자 환경에 따라 치환해야 하는 값은 `<...>` 형태로 명시합니다.

---

## 목차

1. [구성 개요](#1-구성-개요)
2. [필수 조건](#2-필수-조건)
3. [설치 절차](#3-설치-절차)
4. [Claude Code 훅 설정](#4-claude-code-훅-설정)
5. [Claude Code 프록시 설정](#5-claude-code-프록시-설정)
6. [동작 확인](#6-동작-확인)
7. [관리 명령어](#7-관리-명령어)
8. [업데이트](#8-업데이트)
9. [문제 해결](#9-문제-해결)

---

## 1. 구성 개요

spyglass는 호스트에서 **Bun 프로세스로 직접 실행**되며, 두 가지 채널로 데이터를 수집합니다.

```
┌──────────────────────────── 호스트 ────────────────────────────┐
│                                                                │
│   Claude Code                                                  │
│      │                                                         │
│      ├─[채널 A: 훅]───────────────────────────────────────┐   │
│      │   이벤트 발생 시 훅 스크립트 실행                   │   │
│      │   bash $SPYGLASS_DIR/hooks/spyglass-collect.sh      │   │
│      │   HTTP POST http://127.0.0.1:9999/collect           │   │
│      │                                                     │   │
│      └─[채널 B: 프록시]────────────────────────────────────┤   │
│          ANTHROPIC_BASE_URL=http://127.0.0.1:9999 설정 시  │   │
│          /v1/messages → spyglass 경유 → Anthropic API       │   │
│                                                             ▼   │
│                                             spyglass 서버       │
│                                          (Bun, bun run dev)    │
│                                                 │              │
│                                                 ▼              │
│                                       ~/.spyglass/             │
│                                         ├── spyglass.db        │
│                                         │     ├─ sessions      │
│                                         │     ├─ requests      │
│                                         │     ├─ claude_events │
│                                         │     ├─ proxy_requests│
│                                         │     └─ system_prompts│
│                                         ├── server.pid         │
│                                         ├── pricing.json       │
│                                         └── logs/              │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

| 채널 | 수집 데이터 | 설정 방법 |
|------|------------|----------|
| **훅** | 툴 호출·세션 이벤트·타입·소요 시간 | `~/.claude/settings.json` 훅 등록 |
| **프록시** | API 토큰·비용·시스템 프롬프트·응답 메타 | `ANTHROPIC_BASE_URL` 환경변수 |

두 채널 모두 활성화하면 대시보드에서 훅 타임라인과 실제 API 비용을 함께 확인할 수 있습니다.

**원칙**

- 훅은 **반드시 글로벌 사용자 설정 `~/.claude/settings.json`** 에만 등록합니다. 프로젝트 로컬 설정에는 등록하지 않습니다.
- 모든 데이터는 `~/.spyglass/` 아래에 저장되며, 저장소 클론 디렉토리와 독립적입니다.
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

## 5. Claude Code 프록시 설정

> 프록시 채널은 **선택 사항**입니다. 훅만으로도 동작하지만, 프록시를 함께 활성화하면 실제 API 비용·토큰 수·시스템 프롬프트 전문이 `proxy_requests` 테이블에 기록되어 대시보드 정확도가 크게 향상됩니다.

### 5.1 동작 원리

spyglass 서버는 `/v1/*` 경로의 요청을 **투명 프록시**로 처리합니다.

```
Claude Code  →  spyglass:9999/v1/messages  →  https://api.anthropic.com/v1/messages
                     │ 메타 기록
                     └→ proxy_requests 테이블
```

- 클라이언트의 API 키(`x-api-key` / `Authorization`)는 그대로 Anthropic에 전달됩니다. spyglass는 키를 저장하지 않습니다.
- 스트리밍(`stream: true`)과 비스트리밍 모두 지원합니다.
- 응답 내용(텍스트)은 저장하지 않으며, 토큰 수·비용·시스템 프롬프트 해시 등 메타만 기록합니다.

### 5.2 활성화 방법

#### 방법 A — 조건부 셸 함수 (권장)

서버가 실행 중일 때만 경유하도록 헬스체크를 포함합니다. `.zshrc` / `.bashrc` 에 추가:

```bash
# spyglass가 실행 중이면 프록시 경유, 아니면 직접 연결
claude() {
  if curl -sf http://localhost:9999/health > /dev/null 2>&1; then
    ANTHROPIC_BASE_URL=http://localhost:9999 command claude "$@"
  else
    command claude "$@"
  fi
}
```

또는 kimi(Moonshot) 같은 서드파티 모델도 함께 경유할 경우:

```bash
kimi() {
  local model="kimi-k2.6"
  if curl -sf http://localhost:9999/health > /dev/null 2>&1; then
    ANTHROPIC_BASE_URL=http://localhost:9999 \
    ANTHROPIC_AUTH_TOKEN="<moonshot-api-key>" \
    ANTHROPIC_MODEL="$model" \
    command claude --dangerously-skip-permissions "$@"
  else
    ANTHROPIC_BASE_URL="https://api.moonshot.ai/anthropic" \
    ANTHROPIC_AUTH_TOKEN="<moonshot-api-key>" \
    ANTHROPIC_MODEL="$model" \
    command claude --dangerously-skip-permissions "$@"
  fi
}
```

#### 방법 B — settings.json env 등록 (항상 경유)

Claude Code가 실행될 때마다 자동으로 프록시를 경유합니다.

```jsonc
// ~/.claude/settings.json
{
  "env": {
    "SPYGLASS_DIR": "/Users/alice/.spyglass-src",
    "ANTHROPIC_BASE_URL": "http://localhost:9999"
  }
}
```

> ⚠️ **주의**: spyglass 서버가 꺼진 상태에서 Claude Code를 실행하면 API 연결이 실패합니다. 항상 `bun run dev`로 서버를 먼저 기동하거나, 방법 A처럼 조건부 처리를 추가하세요.

### 5.3 upstream 환경변수

서버 측에서 다음 환경변수로 upstream 대상을 조정할 수 있습니다.

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `ANTHROPIC_UPSTREAM_URL` | 기본 Anthropic upstream | `https://api.anthropic.com` |
| `MOONSHOT_UPSTREAM_URL` | `kimi-` prefix 모델용 | `https://api.moonshot.ai/anthropic` |
| `CUSTOM_UPSTREAMS` | 추가 prefix 매핑 (`prefix1=url1,prefix2=url2`) | 없음 |

서버를 기동할 때 환경변수로 전달합니다:

```bash
ANTHROPIC_UPSTREAM_URL=https://my-custom-gateway.example.com \
  bun run dev
```

### 5.4 동작 확인

서버 기동 후 Claude Code를 한 번 실행한 뒤:

```bash
sqlite3 "${HOME}/.spyglass/spyglass.db" \
  "SELECT id, timestamp, model, tokens_input, tokens_output, cost_usd FROM proxy_requests ORDER BY timestamp DESC LIMIT 5;"
```

행이 쌓이면 프록시가 정상 동작 중입니다.

---

## 6. 동작 확인

### 6.1 doctor (자동 검증)

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

### 6.2 훅 수집 로그

Claude Code 세션을 한 번 실행한 뒤:

```bash
# 훅 스크립트 실행 로그
tail -n 20 "${HOME}/.spyglass/logs/collect.log"

# raw 이벤트 (전체 훅 페이로드)
tail -n 20 "${HOME}/.spyglass/logs/hook-raw.jsonl"
```

### 6.3 이벤트 분포 확인

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

### 6.4 대시보드

```bash
# macOS
open http://127.0.0.1:9999

# Linux
xdg-open http://127.0.0.1:9999
```

최소 한 번의 Claude Code 세션이 수집되면 세션 목록·실시간 피드·통계가 표시됩니다.

---

## 7. 관리 명령어

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

### 7.1 데이터 위치

| 항목 | 경로 |
|------|------|
| DB | `~/.spyglass/spyglass.db` |
| WAL/SHM | `~/.spyglass/spyglass.db-wal`, `~/.spyglass/spyglass.db-shm` |
| 가격표 | `~/.spyglass/pricing.json` (자동 생성, 직접 편집 가능) |
| 훅 로그 | `~/.spyglass/logs/collect.log` |
| 훅 원본 페이로드 | `~/.spyglass/logs/hook-raw.jsonl` |
| 서버 PID | `~/.spyglass/server.pid` |

### 7.2 모델 가격 커스터마이징

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

### 7.3 오래된 데이터 정리

DB가 너무 커지면 오래된 행을 삭제하고 VACUUM으로 파일 크기를 줄입니다.

```bash
# 예: 오늘 자정 이전 데이터 전부 삭제 (spyglass 서버 중지 후 실행)
CUTOFF=$(date -j -f "%Y-%m-%d %H:%M:%S" "$(date +%Y-%m-%d) 00:00:00" "+%s")000   # macOS
# CUTOFF=$(date -d "today 00:00" "+%s")000                                         # Linux

sqlite3 "${HOME}/.spyglass/spyglass.db" <<SQL
BEGIN;
DELETE FROM requests       WHERE timestamp < $CUTOFF;
DELETE FROM claude_events  WHERE timestamp < $CUTOFF;
DELETE FROM proxy_requests WHERE timestamp < $CUTOFF;
DELETE FROM sessions
 WHERE started_at < $CUTOFF
   AND id NOT IN (SELECT DISTINCT session_id FROM requests       WHERE session_id IS NOT NULL)
   AND id NOT IN (SELECT DISTINCT session_id FROM claude_events  WHERE session_id IS NOT NULL)
   AND id NOT IN (SELECT DISTINCT session_id FROM proxy_requests WHERE session_id IS NOT NULL);
DELETE FROM system_prompts
 WHERE last_seen_at < $CUTOFF
   AND hash NOT IN (SELECT DISTINCT system_hash FROM proxy_requests WHERE system_hash IS NOT NULL);
COMMIT;
SQL
sqlite3 "${HOME}/.spyglass/spyglass.db" "VACUUM; ANALYZE;"
```

> 서버가 실행 중이면 먼저 `bun run stop`으로 중지한 뒤 실행하세요.

---

## 8. 업데이트

```bash
cd "${HOME}/.spyglass-src"
git pull
bun install
bun run dev   # 자동으로 기존 프로세스 종료 후 재기동
```

DB 마이그레이션은 서버 기동 시 자동 적용됩니다(`PRAGMA user_version`으로 추적).

---

## 9. 문제 해결

### 9.1 `curl http://127.0.0.1:9999/health`가 실패

```bash
# 1) 서버 상태 확인
cd "${HOME}/.spyglass-src" && bun run status

# 2) 포트 충돌 확인
lsof -iTCP:9999 -sTCP:LISTEN

# 3) PID 파일이 stale인 경우
rm -f "${HOME}/.spyglass/server.pid"
cd "${HOME}/.spyglass-src" && bun run dev
```

### 9.2 Claude Code 세션을 실행해도 데이터가 수집되지 않음

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

### 9.3 프록시 경유 시 API 요청이 실패

```bash
# 1) spyglass 서버 동작 확인
curl -sf http://localhost:9999/health && echo OK

# 2) ANTHROPIC_BASE_URL 값 확인 (trailing slash 금지)
echo "$ANTHROPIC_BASE_URL"
# http://localhost:9999  (/ 없이)

# 3) proxy_requests 테이블에 행이 쌓이는지 확인
sqlite3 "${HOME}/.spyglass/spyglass.db" \
  "SELECT COUNT(*), MAX(timestamp) FROM proxy_requests;"
```

서버가 꺼져 있으면 `ANTHROPIC_BASE_URL`을 해제하거나 서버를 기동한 뒤 재시도합니다:

```bash
unset ANTHROPIC_BASE_URL   # 현재 셸에서 임시 해제
```

### 9.4 `~/.spyglass` 권한 오류

```bash
# 소유자가 본인이 아닌 경우 (예: 과거 root로 생성됨)
sudo chown -R "$(id -u):$(id -g)" "${HOME}/.spyglass"
chmod 700 "${HOME}/.spyglass"
```

### 9.5 DB 마이그레이션 확인

```bash
bun -e 'const {Database}=require("bun:sqlite");
  const db = new Database(`${process.env.HOME}/.spyglass/spyglass.db`);
  console.log(db.query("PRAGMA user_version").get());'
# { user_version: 13 }   (마이그레이션 파일 수와 일치해야 함)
```

### 9.6 완전 초기화

> ⚠️ **경고**: 이 명령은 모든 수집 데이터를 영구 삭제합니다.

```bash
cd "${HOME}/.spyglass-src" && bun run stop
rm -rf "${HOME}/.spyglass"
cd "${HOME}/.spyglass-src" && bun run dev
```

### 9.7 훅 등록 해제

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
