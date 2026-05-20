# 문제 해결 가이드

> ## 무엇이든 막히면 먼저 이것부터
>
> ```bash
> cd "${HOME}/.spyglass-src"
> bun run doctor          # 진단만
> bun run doctor --fix    # 권한·정합성 자동 보정
> ```
>
> 자동 복구 가능한 항목은 `--fix`로 한 번에 해결됩니다. 그래도 안 풀리면 아래 시나리오로 내려가세요.

claude-spyglass에서 자주 발생하는 문제를 **증상 → 원인 → 해결 → 예방** 순으로 정리했습니다. 본 문서는 `packages/server/src/cli/`, `packages/server/src/runtime/`, `packages/storage/src/`, `hooks/spyglass-collect.sh`의 실제 동작만 다룹니다.

빠른 진입점:
- **에러 메시지로 찾기** → [12. 흔한 에러 메시지](#12-흔한-에러-메시지)
- **FAQ 한 줄 답변** → [14. FAQ](#14-faq)
- **완전 초기화** → [15. 최후의 수단](#15-최후의-수단--완전-초기화)

---

## 목차

1. [doctor 검사 항목 한눈에 보기](#1-doctor-검사-항목-한눈에-보기)
2. [서버가 시작되지 않음](#2-서버가-시작되지-않음)
3. [훅이 동작하지 않음](#3-훅이-동작하지-않음)
4. [데이터가 들어오지 않음](#4-데이터가-들어오지-않음)
5. [DB 마이그레이션 실패](#5-db-마이그레이션-실패)
6. [대시보드 빈 화면 · SSE 실패](#6-대시보드-빈-화면--sse-실패)
7. [TUI 화면 깨짐](#7-tui-화면-깨짐)
8. [DB 손상 · WAL · 회복](#8-db-손상--wal--회복)
9. [버전 불일치 배지](#9-버전-불일치-배지)
10. [로그 분석](#10-로그-분석)
11. [데이터 정합성 경고](#11-데이터-정합성-경고)
12. [흔한 에러 메시지](#12-흔한-에러-메시지)
13. [환경 변수 참조](#13-환경-변수-참조)
14. [FAQ](#14-faq)
15. [최후의 수단 — 완전 초기화](#15-최후의-수단--완전-초기화)

---

## 1. doctor 검사 항목 한눈에 보기

도입부 박스의 `bun run doctor`가 수행하는 검사를 알아두면 결과 해석이 빠릅니다. `packages/server/src/cli/doctor.ts`가 다음 검사를 순서대로 실행합니다.

| 카테고리 | 검사 | 핵심 |
|---|---|---|
| environment | Bun 버전 (≥1.0) | `bun --version` |
| environment | `~/.claude/settings.json` 존재·파싱 | JSON 파싱 성공 |
| environment | spyglass 훅 등록 + `env.SPYGLASS_DIR` | 6개 훅 키 중 1개 이상 `spyglass-collect.sh` 포함 |
| environment | 훅 스크립트 실행 권한 | `chmod +x` |
| database | DB 파일 권한 | `0o600` 권장 |
| database | 스키마 버전 | `PRAGMA user_version ≥ 12` |
| server | 포트 가용성 | 9999 listen 또는 free |
| database | 최근 5분 수집 활동 | 새 row 존재 |
| integrity | orphan turn_id · 중복 response · mismatched turn_id | 0건 |

출력 기호: `✓` ok / `⚠` warn / `✗` fail. `✗`가 하나라도 있으면 종료 코드 1입니다 (`doctor.ts:83`).

---

## 2. 서버가 시작되지 않음

### 2.1 포트가 이미 사용 중

**증상**

```
[Server] Port 9999 is already in use
[Server] Blocking process(es): PID 12345
[Server] Run 'bun run dev' to restart with auto-cleanup
```

**원인**: 이전 서버 프로세스 또는 다른 프로그램이 9999 점유.

**해결**:

```bash
cd "${HOME}/.spyglass-src" && bun run dev   # 자동 정리 후 재기동
```

`bun run dev`(=`restart`)는 다음을 수행합니다 (`daemon.ts:105`).

1. 포트 가용 검사 → 점유 시 PID 파일과 lsof `-sTCP:LISTEN` 결과 합산
2. `SIGTERM` → 5초 대기 → 실패 시 `SIGKILL`
3. 포트 해제까지 추가로 5초 대기
4. `Bun.serve()` 호출

수동 정리가 필요하면:

```bash
lsof -iTCP:9999 -sTCP:LISTEN   # PID 확인
kill -TERM <pid>               # 5초 후에도 살아있으면 kill -KILL
```

> **주의**: `lsof -ti tcp:9999`만 쓰면 연결 중인 클라이언트(Claude Code, TUI)까지 잡힙니다. 반드시 `-sTCP:LISTEN`을 함께 사용하거나 `bun run dev`(`port.ts:35`)에 맡기세요.

**예방**: 종료는 항상 `bun run stop` 또는 Ctrl+C를 사용. 강제 종료(`kill -9`)는 PID 파일·포트 정리를 건너뛰어 다음 기동을 막습니다.

### 2.2 PID 파일 잔존 (stale)

**증상**: `[Server] Already running (PID: 12345)`인데 실제 PID가 죽어있음.

**원인**: `kill -9` 등 강제 종료 후 PID 파일이 정리되지 않음. `bun run status`는 `kill(pid, 0)`으로 검사해 stale 파일을 자동 제거합니다 (`daemon.ts:166`).

**해결**:

```bash
rm -f "${HOME}/.spyglass/server.pid"
bun run dev
# 또는 단순히 bun run status 를 한 번 호출 → 자동 정리
```

**예방**: `kill -9` 대신 `bun run stop` 또는 Ctrl+C. SIGINT/SIGTERM 핸들러가 PID 파일을 자동 정리합니다 (`daemon.ts:22`).

### 2.3 Bun 버전 미달 / 미설치

**증상**

```
✗ Bun이 설치되지 않았습니다
  → https://bun.sh/install에서 설치하세요
```

또는 `✗ Bun 0.x.y (require ≥ 1.0)`.

**해결**:

```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL -l
bun --version    # 1.2.x 이상
# 이미 설치되어 있으면
bun upgrade
```

`package.json`의 `engines.bun ≥ 1.2.0`이 요구됩니다.

**예방**: 주기적으로 `bun upgrade`. CI/배포 환경이라면 `.tool-versions` 또는 mise/asdf로 버전을 고정.

### 2.4 ~/.spyglass 디렉토리 권한

**증상**: `[SpyglassDB] Warning: Failed to set file permissions: EACCES`

**원인**: 과거 `sudo`로 서버를 띄워 `~/.spyglass`가 root 소유.

**해결**:

```bash
sudo chown -R "$(id -u):$(id -g)" "${HOME}/.spyglass"
chmod 700 "${HOME}/.spyglass"
chmod 600 "${HOME}/.spyglass/spyglass.db" 2>/dev/null || true
```

**예방**: spyglass는 절대 `sudo`로 실행하지 않습니다. `~/.spyglass`도 동기화 폴더(iCloud/Dropbox) 바깥에 두세요.

### 2.5 PID 파일 경로 분리

운영/임시 인스턴스를 동시에 띄우려면 `SPYGLASS_PID_FILE`로 분리 (`daemon.ts:17`): `SPYGLASS_PID_FILE=/tmp/spyglass-test.pid bun run packages/server/src/index.ts start`.

---

## 3. 훅이 동작하지 않음

훅은 `~/.claude/settings.json`에 등록된 셸 스크립트(`spyglass-collect.sh`)가 이벤트마다 호출되는 구조입니다. 대부분의 문제는 `doctor`의 environment 단계가 잡습니다.

### 3.1 settings.json에 훅이 등록되지 않음

**증상**

```
✗ 훅이 등록되지 않았습니다
  → settings.json에 spyglass-collect.sh 훅을 추가하세요
```

**원인**: `~/.claude/settings.json`의 `hooks.{UserPromptSubmit, PreToolUse, PostToolUse, SessionStart, SessionEnd, Stop}` 어디에도 `spyglass-collect.sh`를 호출하는 항목이 없음 (`environment.ts:90`).

**해결**: 설치 가이드 [4.4 자동 병합](./install-guide.md#44-자동-병합-jq-사용--권장)을 다시 실행. 직접 편집 시 다음 형태를 따릅니다.

```json
{
  "env": { "SPYGLASS_DIR": "/Users/<you>/.spyglass-src" },
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh" }]
    }]
  }
}
```

`type: "command"`가 없으면 Claude Code는 항목을 무시합니다.

**예방**: 설치 시 자동 병합 스크립트(`install-guide.md` 4.4) 사용. 수기 편집 시에는 변경 후 반드시 `bun run doctor`로 검증.

### 3.2 SPYGLASS_DIR 미설정 (warn)

**증상**

```
⚠ 훅 설정 있음, 하지만 SPYGLASS_DIR 미설정
```

**해결**: `~/.claude/settings.json`의 `env`에 **절대 경로**로 추가 (`~`나 `$HOME` 변수 확장은 환경에 따라 동작하지 않음).

```bash
SPYGLASS_DIR="$(cd "${HOME}/.spyglass-src" && pwd)"
echo "$SPYGLASS_DIR"   # 출력값을 그대로 settings.json에 붙여넣기
```

**예방**: `~` 대신 항상 절대 경로 사용. `SPYGLASS_DIR`은 셸 변수가 아니라 JSON 문자열이라 변수 확장이 안 됩니다.

### 3.3 훅 스크립트 실행 권한 없음

**증상**

```
✗ 훅 스크립트 실행 권한 없음: /Users/.../hooks/spyglass-collect.sh
  → chmod +x /Users/.../hooks/spyglass-collect.sh
```

**해결**:

```bash
chmod +x "${HOME}/.spyglass-src/hooks/spyglass-collect.sh"
# 또는
bun run doctor --fix   # fix.ts:42에서 자동 chmod +x
```

**예방**: `git pull` 후 권한이 풀리면 `bun run doctor --fix`. 동기화 폴더(iCloud/Dropbox)는 권한을 임의로 변경하므로 `.spyglass-src`는 동기화 대상에서 제외하세요.

### 3.4 Claude Code 재시작 누락

**증상**: 설정은 옳은데 새 세션에서 데이터가 안 들어옴.

**원인**: Claude Code는 시작 시점의 `settings.json`을 1회 로드.

**해결**: Claude Code를 **완전히 종료**하고 다시 시작. 멀티 인스턴스를 띄운 상태라면 모두 종료.

**예방**: `settings.json`을 편집한 직후 Claude Code도 한 번 재시작하는 습관.

### 3.5 No stdin payload received

**증상**: `~/.spyglass/logs/collect.log`에

```
[2026-05-16 10:00:00] [ERROR] No stdin payload received
```

**원인**: `spyglass-collect.sh`는 `[[ ! -t 0 ]]`로 stdin 여부를 확인합니다 (`hooks/spyglass-collect.sh:101`). 수동으로 셸에서 직접 실행했을 때 나오는 정상 메시지. Claude Code가 호출한 게 아니라면 무시 가능.

**확인**: 실제 페이로드가 들어오는지는

```bash
tail -f "${HOME}/.spyglass/logs/hook-raw.jsonl"
```

Claude Code에서 무엇이든 실행했을 때 새 라인이 추가되어야 합니다.

---

## 4. 데이터가 들어오지 않음

훅 스크립트는 잘 호출되는데(`collect.log`, `hook-raw.jsonl`에 기록), `requests` 테이블에는 행이 안 쌓이는 경우.

### 4.1 서버가 죽어있음

**증상**

```
⚠ 최근 수집: 47분 전
```

또는 `collect.log`에 `HTTP 000`이 반복.

**원인**: 훅은 `curl --max-time 1`로 비동기 POST (`hooks/spyglass-collect.sh:69`). 서버가 죽어있으면 connection refused → exit 000.

**해결**:

```bash
bun run status
curl -sf http://127.0.0.1:9999/health && echo OK
# 서버가 죽어있으면
bun run dev
```

**예방**: 부팅 시 자동 기동(launchd/systemd)을 등록하거나, 셸 초기화에 `bun run status` 헬스 체크를 추가.

### 4.2 SPYGLASS_HOST / SPYGLASS_PORT 불일치

**증상**: 서버는 떴는데 데이터만 안 들어옴. `collect.log`에 HTTP 000.

**원인**: 훅 스크립트는 `SPYGLASS_HOST`(기본 `localhost`), `SPYGLASS_PORT`(기본 `9999`)로 엔드포인트를 만듭니다 (`hooks/spyglass-collect.sh:18`). 한쪽만 커스터마이즈하면 미스매치.

**해결**: `~/.claude/settings.json`의 `env`에서 양쪽을 일치시킵니다. 서버는 `SPGLASS_HOST`/`SPGLASS_PORT`(오타 아님, 코드 그대로)를 우선 인식 (`runtime/config.ts:13`).

**예방**: 기본값(`localhost:9999`)을 그대로 쓰는 것이 가장 안전. 변경해야 한다면 서버·훅·프록시 셋 모두에 동일 값을 박으세요.

### 4.3 SPYGLASS_TIMEOUT이 너무 짧음

**증상**: 일부 이벤트만 누락. `collect.log`에 산발적 HTTP 000.

**원인**: 기본 타임아웃 1초. 큰 페이로드 + 느린 디스크에서 잘림.

**해결**:

```json
{ "env": { "SPYGLASS_TIMEOUT": "3" } }
```

**예방**: HDD나 네트워크 파일시스템에 DB를 두지 마세요. SSD + 로컬 경로가 기본 가정입니다.

### 4.4 hook_event_name 분기 확인

`spyglass-collect.sh`는 `hook_event_name` 필드로 라우팅합니다 (`hooks/spyglass-collect.sh:120`).

| `hook_event_name` | 엔드포인트 |
|---|---|
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | `/collect` |
| `SessionStart`, `SessionEnd`, `Stop` (기타) | `/events` |
| 비어있음 | `/collect` (legacy fallback) |

훅 명령에 잘못된 인자를 추가하거나 페이로드를 가공하지 마세요. 라우팅이 깨져 `claude_events`가 비게 됩니다.

### 4.5 서버 로그에서 거절 사유 확인

```bash
tail -f "${HOME}/.spyglass/logs/server.log"
```

`server.log`는 `installServerStdioMirror()`가 stdout/stderr를 자동 미러링한 결과 (`runtime/stdio-mirror.ts`). 경로는 `SPYGLASS_SERVER_LOG`로 변경 가능.

---

## 5. DB 마이그레이션 실패

### 5.1 마이그레이션 도중 SQL 오류

**증상**: 서버 부팅 시 `[migrator] Error applying 015-proxy-requests-enrich.sql: SQLiteError: ...`. 트랜잭션이 롤백되고 throw가 발생 (`storage/migrator.ts:170`).

**원인 가능성**:
- 비공식 도구로 스키마를 수정해 컬럼/테이블 충돌
- 비정상 종료로 DB가 잠금 상태(`*.db-wal`, `*.db-shm` 잔존)
- 마이그레이션 SQL 파일 손상

**해결 순서**:

1. **현재 버전 확인**

   ```bash
   bun -e 'const {Database}=require("bun:sqlite");
     const db = new Database(`${process.env.HOME}/.spyglass/spyglass.db`);
     console.log(db.query("PRAGMA user_version").get());'
   ```

2. **DB 백업 (반드시)**

   ```bash
   cp "${HOME}/.spyglass/spyglass.db" \
     "${HOME}/.spyglass/spyglass.db.bak-$(date +%Y%m%d-%H%M%S)"
   ```

3. **WAL 잔존 파일 정리**

   ```bash
   bun run stop 2>/dev/null
   sqlite3 "${HOME}/.spyglass/spyglass.db" "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"
   ```

4. **migrator는 중복 컬럼/테이블을 자동 무시** — `duplicate column name`, `already exists`는 건너뛰므로 (`migrator.ts:150`) 같은 마이그레이션을 두 번 적용해도 안전합니다.

5. **재기동**

   ```bash
   bun run dev
   bun run doctor
   ```

### 5.2 user_version만 미달 (DDL은 이미 적용됨)

**증상**

```
⚠ DB 스키마 v8 (권장: v12+)
```

**원인**: 과거 비정상 종료로 DDL은 들어갔지만 `PRAGMA user_version` 갱신 안 됨. v32 이후로는 트랜잭션 안에서 원자적으로 처리되므로 새 발생은 없습니다.

**해결**: 다음 부팅에서 migrator가 누락된 마이그레이션을 다시 시도합니다(중복 컬럼은 자동 무시).

```bash
bun run stop && bun run dev
bun run doctor
```

### 5.3 PRAGMA user_version = 0

**증상**: `⚠ DB 스키마 버전을 알 수 없음 (v0)`

**원인**: 빈 파일이 `spyglass.db`로 생성됨, 또는 외부 도구가 PRAGMA 리셋.

```bash
# 1. 스키마 진단
sqlite3 "${HOME}/.spyglass/spyglass.db" ".schema" | head -20

# 2. 테이블이 없으면 백업 후 삭제 → 서버가 재생성
cp "${HOME}/.spyglass/spyglass.db" "${HOME}/.spyglass/spyglass.db.bak-$(date +%s)"
rm "${HOME}/.spyglass/spyglass.db"
rm -f "${HOME}/.spyglass/spyglass.db-wal" "${HOME}/.spyglass/spyglass.db-shm"
bun run dev   # 001-init.sql부터 전부 적용
```

### 5.4 수동 롤백

spyglass는 자동 다운그레이드를 제공하지 않습니다. 백업 복원이 가장 안전:

```bash
bun run stop
cp "${HOME}/.spyglass/spyglass.db.bak-20260510-120000" "${HOME}/.spyglass/spyglass.db"
rm -f "${HOME}/.spyglass/spyglass.db-wal" "${HOME}/.spyglass/spyglass.db-shm"

# 코드도 같은 시점으로
cd "${HOME}/.spyglass-src" && git checkout v1.x.y
bun install && bun run dev
```

**예방**: 큰 업데이트 전 `cp ~/.spyglass/spyglass.db ~/.spyglass/spyglass.db.bak`를 습관화.

---

## 6. 대시보드 빈 화면 · SSE 실패

웹 대시보드는 다음 셋을 묶어서 동작합니다.

- `http://127.0.0.1:9999/` — 정적 자산
- `/events` — SSE 구독
- `/api/*` — REST 조회

### 6.1 페이지 빈 화면 / 자산 404

```bash
curl -i http://127.0.0.1:9999/health
# HTTP/1.1 200 OK ... ok
```

200이 아니면 서버가 안 떴거나 다른 프로세스가 9999를 점유 중. [2.1](#21-포트가-이미-사용-중).

> spyglass는 `127.0.0.1`(loopback)에만 바인딩됩니다. 외부 머신에서 접근하려면 SSH 포워딩(`ssh -L 9999:127.0.0.1:9999 user@host`).

### 6.2 SSE 연결 끊김

`idleTimeout: 0`으로 명시 설정 (`runtime/lifecycle.ts:98`)되어 있으므로 정상이면 끊기지 않습니다.

```bash
# SSE 직접 테스트
curl -N http://127.0.0.1:9999/events
# event: hello
# data: {"server":"spyglass",...}
```

브라우저 F12 → Network → EventStream에서 `/events` 연결 상태 확인. 10초 이상 무응답이면 서버 또는 중간 프록시/방화벽이 idle 연결을 끊고 있는 것입니다.

### 6.3 API 호출 실패

```bash
curl -i http://127.0.0.1:9999/api/dashboard
curl -i http://127.0.0.1:9999/api/stats/sessions
```

5xx면 서버 로그 확인:

```bash
tail -n 50 "${HOME}/.spyglass/logs/server.log"
```

### 6.4 CORS 에러

spyglass는 모든 응답에 `Access-Control-Allow-Origin: *`를 박습니다 (`runtime/dispatch.ts:27`). CORS 에러가 떴다면 응답이 spyglass에서 온 게 아니라 중간 프록시/캐시에서 가로채진 것입니다. `http://127.0.0.1:9999`로 직접 접근하는지 확인하세요.

### 6.5 데이터는 있는데 화면이 비어있음

최초 설치 직후라면 Claude Code를 한 번 실행해야 데이터가 쌓입니다. [4.1](#41-서버가-죽어있음).

---

## 7. TUI 화면 깨짐

### 7.1 색이 깨지거나 빠짐

`packages/tui/src/lib/capabilities.ts:17`에서:
- `COLORTERM`이 `truecolor`/`24bit`를 포함 → truecolor
- `TERM`이 `256` 포함 → 256색
- `NO_COLOR`가 비어있지 않음 → 16색

**확인 & 해결**:

```bash
echo "COLORTERM=$COLORTERM TERM=$TERM NO_COLOR=$NO_COLOR"
export COLORTERM=truecolor
export TERM=xterm-256color
unset NO_COLOR
```

tmux/screen 사용 시 `~/.tmux.conf`:

```
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",xterm-256color:Tc"
```

### 7.2 박스 그리기 문자가 ? 또는 □

```bash
echo "$LANG $LC_ALL"   # UTF-8이어야 함
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
```

`capabilities.ts:22`가 `LANG`/`LC_ALL`에 `UTF8` 포함 여부를 확인합니다(macOS는 항상 true). 폰트 문제는 JetBrains Mono, Fira Code, MesloLGS NF 등 Powerline-호환 폰트로 교체.

### 7.3 사이드바가 안 보임 / 레이아웃 깨짐

`ResponsiveShell`이 `md` 브레이크포인트(100 컬럼)에서 사이드바를 숨깁니다 (`design-tokens.ts:159`: `sm: 80, md: 100, lg: 140, xl: 180`).

```bash
tput cols    # 현재 폭 확인
```

100 컬럼 이상으로 키우거나 폰트 크기를 줄입니다.

### 7.4 애니메이션이 부담스러움 / CPU 점유

```bash
export SPYGLASS_NO_MOTION=1
bun run tui
```

### 7.5 언어 강제

언어 우선순위 (`server/src/i18n.ts:34`): `SPYGLASS_LANG` > `LC_ALL`/`LANG` > 기본 `ko`.

```bash
export SPYGLASS_LANG=en    # ko / en / ja / zh
```

---

## 8. DB 손상 · WAL · 회복

spyglass는 WAL 모드를 사용합니다 (`storage/connection.ts:159`).

- 정상 종료(SIGTERM)는 close 직전에 `PRAGMA wal_checkpoint(TRUNCATE)`로 WAL을 메인 DB에 머지합니다 (`connection.ts:214`).
- SIGKILL/시스템 crash는 WAL 잔존(`*.db-wal`, `*.db-shm`)을 남깁니다.

### 8.1 .db-wal / .db-shm 잔존

**증상**: 서버 재시작 후 `SQLiteError: disk I/O error`.

**원인**: 이전 프로세스 잔존 락 또는 같은 경로 중복 오픈.

**해결**:

```bash
bun run stop

# 1) WAL을 main DB로 강제 머지 (안전)
sqlite3 "${HOME}/.spyglass/spyglass.db" "PRAGMA wal_checkpoint(TRUNCATE);"

# 2) 그래도 안 풀리면 sidecar 제거 (락이 끊긴 상태에서만, 미커밋 트랜잭션 손실 위험)
rm "${HOME}/.spyglass/spyglass.db-wal" "${HOME}/.spyglass/spyglass.db-shm"

bun run dev
```

### 8.2 SQLite 무결성 검사 & 복구

```bash
sqlite3 "${HOME}/.spyglass/spyglass.db" "PRAGMA integrity_check;"   # ok가 정상
```

`ok`가 아니면 손상. dump → 새 DB로 import 복구:

```bash
cp "${HOME}/.spyglass/spyglass.db" "${HOME}/.spyglass/spyglass.db.corrupt-$(date +%s)"
sqlite3 "${HOME}/.spyglass/spyglass.db" .dump > /tmp/spyglass.sql
mv "${HOME}/.spyglass/spyglass.db" "${HOME}/.spyglass/spyglass.db.broken"
sqlite3 "${HOME}/.spyglass/spyglass.db" < /tmp/spyglass.sql

V=$(sqlite3 "${HOME}/.spyglass/spyglass.db.broken" "PRAGMA user_version")
sqlite3 "${HOME}/.spyglass/spyglass.db" "PRAGMA user_version = $V"
```

### 8.3 DB 크기 줄이기

```bash
bun run stop
sqlite3 "${HOME}/.spyglass/spyglass.db" <<SQL
PRAGMA wal_checkpoint(TRUNCATE);
VACUUM;
ANALYZE;
SQL
```

`VACUUM`은 임시 파일을 만들어 교체하므로 현재 DB 크기 만큼의 여유 공간이 필요합니다. 오래된 데이터 삭제는 [설치 가이드 7.3](./install-guide.md#73-오래된-데이터-정리).

---

## 9. 버전 불일치 배지

대시보드 우측 상단의 "업데이트 가능" 배지는 `version-checker.ts`가 1시간마다 GitHub API와 현재 버전을 비교한 결과입니다 (`version-checker.ts:178`).

### 9.1 git pull 후에도 배지가 남아있음

`updateAvailable === true`이면 자체 인터벌이 멈춥니다 (`lifecycle.ts:64`). 서버 재시작이 필요합니다.

```bash
cd "${HOME}/.spyglass-src"
git pull && bun install && bun run dev
```

재시작 후 로그:

```
[VersionChecker] current=1.0.1 latest=v1.0.1 updateAvailable=false
```

### 9.2 GitHub API rate limit / 네트워크 차단

**증상**: 로그에 `[VersionChecker] GitHub API failed: 403` 또는 `fetch failed`.

**원인**: 비인증 GitHub API는 IP당 시간당 60회 제한. 인터넷 차단 환경도 동일.

**해결**: 영향 없음. silent fail로 본 동작에 지장 없으며 배지만 표시되지 않습니다.

### 9.3 prerelease 태그

`version-checker`는 `/^v?\d+\.\d+\.\d+$/`만 인식 (`version-checker.ts:65`). `v1.0.0-beta.1`, `v1.0.0+sha`는 후보에서 제외됩니다.

---

## 10. 로그 분석

### 10.1 로그 파일 위치

| 파일 | 책임 | 작성자 |
|---|---|---|
| `~/.spyglass/logs/server.log` | 서버 stdout/stderr 미러 (INFO/WARN/ERROR/FATAL) | `stdio-mirror.ts` |
| `~/.spyglass/logs/collect.log` | 훅 스크립트 호출·에러 | `spyglass-collect.sh:41` |
| `~/.spyglass/logs/hook-raw.jsonl` | 훅이 받은 raw 페이로드 1줄/이벤트 | `spyglass-collect.sh:91` |
| `~/.spyglass/server.pid` | 데몬 PID | `daemon.ts:42` |
| `<cwd>/.claude/.tmp/logs/*.log,*.jsonl` | 진단 로그 (DIAG ON 시) | `diag-log.ts` |

### 10.2 일반 운영 로그

```bash
tail -n 100 "${HOME}/.spyglass/logs/server.log"
tail -f "${HOME}/.spyglass/logs/server.log"
grep -E "FATAL|ERROR" "${HOME}/.spyglass/logs/server.log" | tail -30
```

비정상 종료 흔적:

```
[2026-05-16T10:00:00.000Z] [FATAL] uncaughtException Error: ...
```

### 10.3 훅 raw 페이로드

```bash
# 가장 최근 이벤트 한 개
tail -n 1 "${HOME}/.spyglass/logs/hook-raw.jsonl" | jq

# 이벤트 종류별 카운트
jq -r '.hook_event_name // "null"' "${HOME}/.spyglass/logs/hook-raw.jsonl" \
  | sort | uniq -c | sort -rn
```

### 10.4 진단 로그 활성화 (SPYGLASS_DIAG_ENABLED)

> ## 진단 모드 — hook/proxy 페이로드 전체 캡처
>
> 일반 로그로 원인이 안 보일 때만 켜세요. 페이로드 전체가 디스크에 기록됩니다.
>
> ```bash
> # ON으로 재시작 (공백 prefix, '&' 절대 금지)
> SPYGLASS_DIAG_ENABLED=1 bun run dev
>
> # 기본 위치
> ls "${PWD}/.claude/.tmp/logs/"
> # model-trace.log / hook-payload.jsonl / proxy-payload.jsonl
>
> # 위치 override + SSE 본문까지 캡처
> SPYGLASS_DIAG_ENABLED=1 SPYGLASS_DIAG_LOG_DIR=/tmp/diag SPYGLASS_DIAG_RAW_SSE=1 bun run dev
>
> # OFF
> unset SPYGLASS_DIAG_ENABLED && bun run dev
> ```
>
> **함정**: `SPYGLASS_DIAG_ENABLED=1 & bun run dev` (← 백그라운드 `&`)는 환경변수가 다른 프로세스로 빠져 `bun run dev`에 전달되지 않습니다. 반드시 공백 한 칸으로 prefix 하세요.
>
> 부팅 배너에서 현재 상태를 확인할 수 있습니다 (`diag-log.ts:137`).

### 10.5 로그 회전

spyglass는 자체 회전을 하지 않습니다.

- 진단 로그(`*.log`, `*.jsonl`)는 서버 시작 시 자동으로 `truncate(0)`됩니다 (`diag-log.ts:165`).
- 운영 로그(`server.log`)는 수동:

```bash
truncate -s 0 "${HOME}/.spyglass/logs/server.log"
# 또는 보관 후
mv "${HOME}/.spyglass/logs/server.log" "${HOME}/.spyglass/logs/server.log.$(date +%Y%m%d)"
bun run dev   # stdio-mirror가 새 파일을 만들도록 재시작
```

---

## 11. 데이터 정합성 경고

`doctor`의 후반부 체크는 ADR-001 P1의 turn 무결성을 검증합니다 (`cli/checks/integrity.ts`). **warn**은 알려진 비결정적 케이스, **fail**은 코드 회귀를 시사합니다.

| 체크 | 임계값 | 의미 |
|---|---|---|
| `orphan_rows` | warn @ >0 | tool_call/response의 `turn_id`가 NULL |
| `zero_response_turns` | warn @ >0 | prompt만 있고 response 0 — tool-only 정상 가능 |
| `long_proxy_responses` | warn @ >0 | `response_time_ms > 120000` — 정보성 |
| `duplicate_responses` | **fail @ >0** | 같은 메시지가 두 행 — 회귀 |
| `mismatched_turn_ids` | **fail @ >0** | tool_call/response가 잘못된 turn에 묶임 |
| `unlinked_tool_calls` | warn @ pct≥10 | 최근 1시간 `api_request_id` 미매칭 |
| `orphan_proxy_tool_uses` | info | 보통 사용자 취소된 tool_use |

### 11.1 자동 보정

```bash
bun run doctor --fix
```

`applyFixes()`가 수행하는 것 (`cli/fix.ts:57`):

1. **중복 response 제거** — 같은 session, preview 동일, 1초 이내인 두 행 중 `source = 'claude-code-hook'` 삭제, `transcript-assistant-text` 보존
2. **mismatched turn_id 교정** — 자기 timestamp 이전의 가장 최근 prompt turn_id로 갱신
3. **orphan turn_id retroactive 매핑** — prompt 이전 도착 행을 이후 첫 prompt에 묶음

### 11.2 fail이 다시 떨어지면

코드 회귀입니다. 다음을 점검하세요.

- 최근 변경된 collect.ts / proxy-handler 코드
- `resp-msg-${msgid}` ID 통일 로직 (P1-A)
- `getTurnIdAt()` 헬퍼의 timestamp 기준 매칭

### 11.3 long_proxy_responses 누적

대부분 실제로 오래 걸린 응답입니다. v23 이후 `proxy_tool_uses` 정확 매칭을 사용하므로 누락 위험 없는 정보성 경고. 개별 확인은 `proxy_requests` 테이블의 `response_time_ms > 120000` 행을 직접 조회.

---

## 12. 흔한 에러 메시지

| 메시지 | 위치 | 가이드 |
|---|---|---|
| `[Server] Already running (PID: NNNN)` | start | [2.1](#21-포트가-이미-사용-중)/[2.2](#22-pid-파일-잔존-stale) |
| `[Server] Port 9999 is already in use` | start | [2.1](#21-포트가-이미-사용-중) |
| `[Server] Failed to release port 9999. Please check manually.` | restart | 수동 `lsof -iTCP:9999 -sTCP:LISTEN` |
| `[Collect] No stdin payload received` | 훅 | [3.5](#35-no-stdin-payload-received) |
| `[migrator] Error applying NNN-xxx.sql: ...` | 마이그레이션 | [5.1](#51-마이그레이션-도중-sql-오류) |
| `SQLiteError: disk I/O error` | DB | [8.1](#81-db-wal--db-shm-잔존) |
| `[VersionChecker] GitHub API failed: 403` | 버전 체커 | [9.2](#92-github-api-rate-limit--네트워크-차단) — 무시 가능 |
| `[VersionChecker] Failed to fetch latest tag: fetch failed` | 버전 체커 | [9.2](#92-github-api-rate-limit--네트워크-차단) — 무시 가능 |
| `[Server] meta-docs bootstrap sync failed: ...` | 부팅 | try/catch 격리, 부팅은 성공 |
| `Failed to send data: HTTP NNN (endpoint=...)` | 훅 | [4](#4-데이터가-들어오지-않음) |
| `[SpyglassDB] Warning: Failed to set file permissions: ...` | DB chmod | `/tmp`·readonly fs면 정상. 일반 경로면 [2.4](#24-spyglass-디렉토리-권한) |

---

## 13. 환경 변수 참조

### 서버 측

| 변수 | 기본 | 설명 |
|---|---|---|
| `SPGLASS_PORT` | `9999` | 서버 바인딩 포트 (코드 그대로의 키, 오타 아님) |
| `SPGLASS_HOST` | `127.0.0.1` | 서버 바인딩 호스트 |
| `SPGLASS_DB_PATH` | `~/.spyglass/spyglass.db` | DB 파일 경로 |
| `SPYGLASS_PID_FILE` | `~/.spyglass/server.pid` | PID 파일 경로 |
| `SPYGLASS_SERVER_LOG` | `~/.spyglass/logs/server.log` | 서버 stdio 미러 경로 |
| `SPYGLASS_LANG` | (시스템) | UI 언어 (`ko`/`en`/`ja`/`zh`) |
| `SPYGLASS_DIAG_ENABLED` | (off) | `1`/`true` 시 진단 로그 활성 |
| `SPYGLASS_DIAG_LOG_DIR` | `<cwd>/.claude/.tmp/logs` | 진단 로그 디렉토리 |
| `SPYGLASS_DIAG_RAW_SSE` | (off) | 프록시 SSE 본문 raw 캡처 |

### 훅 (`~/.claude/settings.json`의 `env`)

| 변수 | 기본 | 설명 |
|---|---|---|
| `SPYGLASS_DIR` | (필수) | 클론된 spyglass 절대 경로 |
| `SPYGLASS_HOST` | `localhost` | 훅 → 서버 호스트 |
| `SPYGLASS_PORT` | `9999` | 훅 → 서버 포트 |
| `SPYGLASS_TIMEOUT` | `1` | 훅 curl 타임아웃 (초) |

### 프록시 upstream

| 변수 | 기본 | 설명 |
|---|---|---|
| `ANTHROPIC_BASE_URL` | (unset) | 클라이언트 측 — spyglass 경유 활성 |
| `ANTHROPIC_UPSTREAM_URL` | `https://api.anthropic.com` | 서버 측 기본 upstream |
| `MOONSHOT_UPSTREAM_URL` | `https://api.moonshot.ai/anthropic` | `kimi-` prefix 모델 |
| `CUSTOM_UPSTREAMS` | (unset) | `prefix1=url1,prefix2=url2` |

### TUI

| 변수 | 기본 | 설명 |
|---|---|---|
| `COLORTERM` | (시스템) | `truecolor`/`24bit` 포함 시 truecolor |
| `TERM` | (시스템) | `256` 포함 시 256색; `linux`이면 색·유니코드 비활성 |
| `LANG` / `LC_ALL` | (시스템) | UTF-8 포함 시 유니코드 박스 활성 |
| `NO_COLOR` | (unset) | 비어있지 않으면 16색 고정 |
| `SPYGLASS_NO_MOTION` | (unset) | `1`이면 모든 transition 비활성 |

---

## 14. FAQ

**Q1. `bun run dev`와 `bun run start`의 차이는?**
`start`는 이미 실행 중이면 즉시 종료(`Already running`), `dev`는 기존을 죽이고 재기동(`restart`). 평소 `dev`만 쓰세요.

**Q2. 글로벌과 프로젝트 단위 settings.json, 어디에 등록?**
**반드시 글로벌 `~/.claude/settings.json`만.** 프로젝트 단위에 등록하면 다른 프로젝트에서 데이터 공백이 발생합니다.

**Q3. 서버를 끄면 Claude Code가 느려지나?**
훅은 비동기 백그라운드 POST(`curl &`)에 1초 타임아웃이라 거의 영향 없습니다 (`hooks/spyglass-collect.sh:73`). 단, 프록시(`ANTHROPIC_BASE_URL`)를 켜둔 상태면 서버가 꺼졌을 때 API 호출 자체가 실패하므로, 설치 가이드의 조건부 셸 함수(방법 A) 권장.

**Q4. 외부 머신에서 대시보드를 보고 싶다.**
spyglass는 보안상 `127.0.0.1`에만 바인딩. SSH 포워딩으로 접근하세요. `ssh -L 9999:127.0.0.1:9999 user@host`.

**Q5. 여러 spyglass 인스턴스를 동시에 띄울 수 있나?**
`SPYGLASS_PID_FILE`, `SPGLASS_PORT`, `SPGLASS_DB_PATH`를 분리하면 가능. 단, 훅은 한 곳으로만 보내므로 테스트/디버그 한정.

**Q6. proxy_requests 테이블이 비어있다.**
프록시는 선택사항. `ANTHROPIC_BASE_URL`을 설정해 클라이언트가 spyglass를 경유하게 하세요. 설치 가이드 [5절](./install-guide.md#5-claude-code-프록시-설정) 참조.

**Q7. 통계가 깨졌다.**
`stats_hourly`, `stats_proxy_hourly`는 trigger로 동기 갱신됩니다(v028+). BULK DELETE 후 검증이 필요하면 `bun run rebuild-stats`, `bun run rebuild-stats-proxy`.

**Q8. macOS에서 `chmod 600`이 풀린다.**
iCloud/Dropbox 동기화 폴더에 `~/.spyglass`가 있으면 권한이 재설정됩니다. 동기화 제외 또는 `SPGLASS_DB_PATH`로 경로를 옮기세요.

---

## 15. 최후의 수단 — 완전 초기화

> ⚠️ **경고**: 수집된 모든 데이터를 영구 삭제합니다.

```bash
# 1. 백업
cp -R "${HOME}/.spyglass" "${HOME}/.spyglass.bak-$(date +%Y%m%d-%H%M%S)"

# 2. 중지
bun run stop

# 3. 데이터 삭제 (settings.json은 손대지 않음)
rm -rf "${HOME}/.spyglass"

# 4. 재기동 → 빈 DB로부터 마이그레이션 전부 적용
bun run dev

# 5. 검증
bun run doctor
```

훅 설정 자체를 제거하려면 백업으로 복원:

```bash
ls -1t "${HOME}/.claude/settings.json.bak-"* 2>/dev/null | head -1 \
  | xargs -I{} cp {} "${HOME}/.claude/settings.json"
```

---

## 참고

- [설치 가이드](./install-guide.md)
- [doctor 검사 코드](../packages/server/src/cli/checks/)
- [자동 수정 코드](../packages/server/src/cli/fix.ts)
- [서버 라이프사이클](../packages/server/src/runtime/lifecycle.ts)
- [훅 스크립트](../hooks/spyglass-collect.sh)
- [마이그레이션 SQL](../packages/storage/migrations/)
