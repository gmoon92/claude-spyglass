# claude-spyglass CLI

claude-spyglass CLI는 모니터링 서버 데몬 제어와 환경 진단을 담당합니다. 모든 명령은 Bun 런타임으로 실행되며, 별도 설치 없이 저장소 루트에서 호출합니다.

## 목차

- [개요](#개요)
- [실행 방식](#실행-방식)
- [명령 인덱스](#명령-인덱스)
- [명령별 상세](#명령별-상세)
  - [`start` — 서버 기동](#start--서버-기동)
  - [`stop` — 서버 중지](#stop--서버-중지)
  - [`restart` — 서버 재기동](#restart--서버-재기동)
  - [`status` — 상태 조회](#status--상태-조회)
  - [`doctor` — 진단](#doctor--진단)
  - [`doctor --fix` — 자동 수정](#doctor---fix--자동-수정)
  - [`analyze` — 운영자 수동 백필](#analyze--운영자-수동-백필)
  - [foreground (default) — 포그라운드 실행](#foreground-default--포그라운드-실행)
- [doctor 체크 상세](#doctor-체크-상세)
- [데이터 보조 스크립트](#데이터-보조-스크립트)
  - [`rebuild-stats`](#rebuild-stats)
  - [`rebuild-stats-proxy`](#rebuild-stats-proxy)
  - [`backfill:system-prompts`](#backfillsystem-prompts)
- [환경 변수](#환경-변수)
- [종료 코드](#종료-코드)
- [자주 쓰는 시나리오](#자주-쓰는-시나리오)

---

## 개요

CLI 진입점과 기본 동작을 요약합니다. 데몬은 `lsof -sTCP:LISTEN` 기반 포트 점유 확인으로 싱글톤을 보장합니다.

CLI는 두 개의 진입점으로 나뉩니다.

| 진입점 | 역할 | 파일 |
|--------|------|------|
| 데몬 디스패처 | `start` / `stop` / `restart` / `status` (+ 포그라운드 폴백) | `packages/server/src/index.ts` → `runtime/daemon.ts` |
| 진단 CLI | `doctor` (옵션: `--fix`) / `analyze` | `packages/server/src/cli.ts` → `cli/doctor.ts` / `cli/analyze.ts` |

**기본값**

| 항목 | 값 |
|------|-----|
| PID 파일 | `~/.spyglass/server.pid` |
| 포트 | `9999` |
| 호스트 | `127.0.0.1` |
| DB 파일 | `~/.spyglass/spyglass.db` |
| 미러 로그 | `~/.spyglass/logs/server.log` |

서버 stdout/stderr는 미러 로그에 함께 기록되므로 비정상 종료를 사후 추적할 수 있습니다. `package.json` 의 `scripts` 가 모든 명령의 표준 엔트리입니다.

## 실행 방식

모든 명령은 Bun으로 실행합니다(`engines.bun >= 1.2.0`). 다음 두 호출 방식은 동등합니다.

```bash
# 권장 — npm-script 경유
bun run start

# 진입점 직접 호출
bun run packages/server/src/index.ts start
bun run packages/server/src/cli.ts doctor --fix
```

데몬 명령은 비대화식이며, 서버는 호출자 셸이 종료되어도 백그라운드에서 살아남습니다. `SIGINT`(Ctrl+C)·`SIGTERM` 수신 시 graceful shutdown 시퀀스(스케줄러 → SSE 브로드캐스트 → `server.stop()` → in-flight 대기 → DB close)를 거쳐 종료하고 PID 파일을 정리합니다.

## 명령 인덱스

카테고리별로 정리한 전체 명령 목록입니다.

**데몬 제어**

| 명령 | 설명 | 호출 예시 |
|------|------|-----------|
| `start` | `lsof -sTCP:LISTEN` 로 LISTEN 확인, 포트 가용 시 서버 기동 | `bun run start` |
| `stop` | `lsof -sTCP:LISTEN` 로 LISTEN PID 탐색 후 SIGTERM 송신 | `bun run stop` |
| `restart` | 포트 LISTEN 프로세스를 SIGTERM 후 재기동 | `bun run dev` |
| `status` | `lsof -sTCP:LISTEN` 로 실제 LISTEN 여부 확인 | `bun run status` |
| (인자 없음) | 포그라운드 실행 (`Ctrl+C` 종료) | `bun run packages/server/src/index.ts` |

**진단**

| 명령 | 설명 | 호출 예시 |
|------|------|-----------|
| `doctor` | 15개 환경/DB/서버/무결성 체크 실행 | `bun run doctor` |
| `doctor --fix` | 자동 수정 가능한 항목(권한, 데이터 정합성) 보정 | `bun run doctor --fix` |
| `analyze --backfill <범위>` | 기간 범위 지정 운영자 수동 백필 (system_byte_size / parent_tool_use_id 진단) | `bun run packages/server/src/cli.ts analyze --backfill 2026-05-01:2026-05-18` |

**데이터 보조 스크립트**

| 명령 | 설명 | 호출 예시 |
|------|------|-----------|
| `rebuild-stats` | `stats_hourly` 집계 테이블 재구축 | `bun run rebuild-stats` |
| `rebuild-stats-proxy` | `stats_proxy_hourly` 집계 테이블 재구축 | `bun run rebuild-stats-proxy` |
| `backfill:system-prompts` | 누락된 시스템 프롬프트 백필 | `bun run backfill:system-prompts` |

**TUI**

| 명령 | 설명 | 호출 예시 |
|------|------|-----------|
| `tui` | 별도 TUI 패키지 실행 | `bun run tui` |

> `bun run dev` 는 `restart` 의 alias입니다. 점유된 포트를 정리한 뒤 새로 띄우므로 로컬 개발 루프에서 가장 자주 쓰입니다.

---

## 명령별 상세

### `start` — 서버 기동

포트 점유 여부를 `lsof -sTCP:LISTEN` 으로 확인한 뒤 새 데몬을 띄웁니다 (`runtime/daemon.ts#commandStart`).

**동작 순서**

1. `lsof -sTCP:LISTEN` 으로 포트 9999 를 LISTEN 중인 PID 탐색.
   - LISTEN PID 가 있으면 `Already running (PID: …)` 출력 후 `exit 0`.
   - 없으면 stale PID 파일이 남아 있어도 제거 후 다음 단계로 진행.
2. `isPortAvailable()` 로 포트 가용성 재확인. TIME_WAIT 등으로 불가 시 `exit 1`.
3. `startServer()` 호출 — DB 연결, 진단 로그 디렉터리 정리, 유지보수/버전 체크 스케줄 등록, `meta-docs` 부팅 동기화, HTTP listen.
4. PID 파일 기록 + `SIGINT`/`SIGTERM` 핸들러 설치.

**옵션**: 없음. 동작은 [환경 변수](#환경-변수) 로 조정합니다.

**예시 출력**

```text
# 정상 기동
[Server] Database connected: /Users/me/.spyglass/spyglass.db
[Server] meta-docs known cwds discovered: 4
[Server] Running on http://127.0.0.1:9999
[Server] Health check: http://127.0.0.1:9999/health
```

```text
# 이미 실행 중인 경우
[Server] Already running (PID: 28341)
```

```text
# 포트가 점유된 경우
[Server] Port 9999 is already in use
[Server] Blocking process(es): PID 28341
[Server] Run 'bun run dev' to restart with auto-cleanup
```

**종료 코드**

| 코드 | 의미 |
|------|------|
| `0` | 정상 기동 또는 이미 실행 중 |
| `1` | 포트 점유 |

---

### `stop` — 서버 중지

`lsof -sTCP:LISTEN` 으로 포트 9999 를 LISTEN 중인 PID를 찾아 SIGTERM을 보냅니다 (`runtime/daemon.ts#commandStop`).

**동작 순서**

1. `lsof -sTCP:LISTEN` 으로 LISTEN PID 탐색. 없으면 `Not running` 출력 후 `exit 0`. 잔여 stale PID 파일도 정리.
2. 있으면 각 PID 에 `process.kill(pid, 'SIGTERM')` 송신 후 PID 파일 삭제. 실패 시 `exit 1`.

서버 측은 `SIGTERM` 핸들러에서 유지보수/버전 체크 스케줄 정지 → SSE `server_shutdown` 브로드캐스트 → `server.stop()` → in-flight 완료 대기 → `closeDatabase()` 를 거쳐 정상 종료합니다.

**예시 출력**

```text
# 정상 종료
[Server] Stopped (PID: 28341)

# 이미 정지 상태
[Server] Not running
```

**종료 코드**

| 코드 | 의미 |
|------|------|
| `0` | 정상 종료 또는 이미 정지 |
| `1` | SIGTERM 송신 실패 |

---

### `restart` — 서버 재기동

기존 인스턴스 유무와 무관하게 안전하게 재기동합니다 (`runtime/daemon.ts#commandRestart`).

**동작 순서**

1. `lsof -sTCP:LISTEN` 로 LISTEN PID 탐색. 없으면 곧장 새 서버 기동.
2. LISTEN PID 들에 `SIGTERM`. `SHUTDOWN_TIMEOUT_MS`(기본 10초) 내 종료되지 않으면 `SIGKILL`.
3. 포트가 OS 레벨에서 해제될 때까지 최대 5초 대기 (TIME_WAIT 등). 실패 시 `exit 1`.
4. `startServer()` + PID 파일 기록 + 시그널 핸들러 설치.

LISTEN 필터(`-sTCP:LISTEN`)가 핵심입니다. 필터가 없으면 `9999` 포트로 ESTABLISHED 연결 중인 Claude Code/TUI 클라이언트 PID 까지 잡혀 사용자 세션이 함께 종료됩니다.

**예시 출력**

```text
# 점유 → 정리 → 재기동
[Server] Port 9999 is in use, attempting to free it...
[Server] Stopping process (PID: 28341)...
[Server] Waiting for port 9999 to be released...
[Server] Port 9999 is now available
[Server] Running on http://127.0.0.1:9999
[Server] Restarted (PID: 28510)
```

**종료 코드**

| 코드 | 의미 |
|------|------|
| `0` | 재기동 성공 |
| `1` | 포트 해제 실패 |

---

### `status` — 상태 조회

`lsof -sTCP:LISTEN` 으로 포트 점유를 실제로 확인합니다 (`runtime/daemon.ts#commandStatus`). PID 파일은 stale 정리 보조 용도에만 사용합니다.

**동작 순서**

1. `lsof -sTCP:LISTEN` 으로 LISTEN PID 탐색.
   - LISTEN PID 가 있으면 `Running (PID: …)` + 엔드포인트 출력. in-flight 백그라운드 태스크가 있으면 건 수도 표시.
   - 없으면 stale PID 파일이 남아 있으면 삭제하고 `Not running (stale PID file)` 출력.
   - PID 파일도 없으면 `Not running` 출력.

**예시 출력**

```text
# 실행 중
[Server] Running (PID: 28510)
[Server] Endpoint: http://127.0.0.1:9999
```

```text
# PID 파일은 있으나 프로세스가 죽음
[Server] Not running (stale PID file)
```

```text
# PID 파일 자체가 없음
[Server] Not running
```

**종료 코드**: 항상 `0`.

---

### `doctor` — 진단

설치/환경/DB/turn 무결성을 한 번에 점검합니다. `cli/doctor.ts` 가 15개 체크를 순차 실행하여 `✓` / `⚠` / `✗` 으로 출력합니다.

**호출**

```bash
bun run doctor
bun run packages/server/src/cli.ts doctor
```

**옵션**

| 옵션 | 의미 |
|------|------|
| `--fix` | 권한·데이터 정합성 자동 보정 후 결과 요약 (다음 절 참고) |

**예시 출력**

```text
# 모두 통과
🔍 spyglass 환경 검증

✓ Bun 1.2.5
✓ settings.json 정상
✓ 훅 등록됨 (SPYGLASS_DIR: /Users/me/IdeaProjects/claude-spyglass)
✓ 훅 스크립트 실행 권한 OK
✓ DB 권한: 600
✓ DB 스키마 v23
✓ 포트 9999 가용
✓ 최근 5분 내 수집 활동 있음
... (무결성 체크 7건 ok) ...

✓ 모든 검사 통과!
```

```text
# warn + fail 이 섞인 경우
⚠ DB 권한: 644 (권장: 600)
  → chmod 600 /Users/me/.spyglass/spyglass.db
⚠ 최근 수집: 42분 전
✗ 중복 response 7쌍 — 같은 메시지가 두 행으로 저장됨
  → ADR-001 P1-A 수정 후엔 0이어야 한다. 코드 회귀 가능성 — 변경 이력 확인

✗ 1개 항목 실패, 3개 항목 경고
  → 위의 힌트를 따라 문제를 해결하세요
```

**종료 코드**

| 코드 | 의미 |
|------|------|
| `0` | 실패(`fail`) 0건. 경고가 있어도 0으로 종료 |
| `1` | 실패(`fail`) 1건 이상. 또는 알 수 없는 서브명령(`cli.ts <unknown>`) |

---

### `doctor --fix` — 자동 수정

진단 출력 후 `cli/fix.ts#applyFixes()` 가 다음 항목을 시도합니다.

| 항목 | 보정 |
|------|------|
| DB 파일 권한 (`mode & 0o077 != 0`) | `chmod 600 <path>` |
| 훅 스크립트 권한 (실행 비트 없음) | `chmod +x <SPYGLASS_DIR>/hooks/spyglass-collect.sh` |
| 중복 response (같은 세션 · `preview` 동일 · 1초 이내) | `claude-code-hook` 소스 행 DELETE (transcript 행 보존) |
| mismatched turn_id | timestamp 이전 최신 prompt 의 `turn_id` 로 UPDATE |
| orphan turn_id (`= NULL`) | 같은 세션의 첫 prompt `turn_id` 로 retroactive 매핑 |

수정이 한 건이라도 적용되면 끝에 `✓ 자동 수정 완료. 다시 doctor를 실행하세요` 가 출력됩니다. 안내대로 `--fix` 없이 한 번 더 `doctor` 를 돌려 잔여 항목을 확인하세요.

`--fix` 는 권한·정합성만 건드립니다. Bun 설치, 훅 등록, 포트 해제는 사용자가 직접 처리해야 합니다.

---

### `analyze` — 운영자 수동 백필

`cli/analyze.ts` 가 기간 범위를 받아 두 가지 보정 작업을 수행합니다. **자동 실행이 금지된 수동 트리거 전용** 명령입니다.

**호출**

```bash
bun run packages/server/src/cli.ts analyze --backfill 2026-05-01:2026-05-18
bun run packages/server/src/cli.ts analyze --backfill 2026-05-01:2026-05-18 --dry-run
```

**옵션**

| 옵션 | 의미 |
|------|------|
| `--backfill <YYYY-MM-DD:YYYY-MM-DD>` | 처리 기간 지정 (필수). 시작일 00:00:00Z ~ 종료일 23:59:59.999Z |
| `--dry-run` | DB 변경 없이 처리 예상 건수만 출력 |
| `--help` / `-h` | 사용법 출력 |

**백필 대상**

| 대상 | 설명 |
|------|------|
| `proxy_requests.system_byte_size` | payload(zstd) 를 복호하여 body.system 정규화 후 byte_size 채움. `system_hash IS NULL` 행만 대상 (멱등). |
| `requests.parent_tool_use_id` | `source='subagent-transcript'` 중 `parent_tool_use_id IS NULL` 행 수 보고 (현재 라운드는 진단만; 실제 UPDATE 는 후속 패치). |

**예시 출력**

```text
analyze [DRY-RUN]  2026-05-01T00:00:00.000Z → 2026-05-18T23:59:59.999Z

[proxy] system_byte_size 대상: 312건
[proxy] 처리 완료: 312 / 312
---
proxy_requests.system_byte_size
  대상: 312  처리: 312  갱신: 308  디코드오류: 4  system없음: 0
requests.parent_tool_use_id
  후보: 0  적용: 0

dry-run 완료. 실제 적용하려면 --dry-run 없이 재실행하세요.
```

**종료 코드**

| 코드 | 의미 |
|------|------|
| `0` | 정상 완료 (도움말 출력 포함) |
| `1` | `--backfill` 범위 누락 또는 파싱 오류 |

---

### foreground (default) — 포그라운드 실행

진입점에 서브명령을 주지 않으면 `commandForeground()` 가 호출되어 PID 파일 없이 서버를 띄웁니다. `Ctrl+C` 한 번으로 종료할 수 있어 디버깅에 유용합니다.

```bash
bun run packages/server/src/index.ts
```

`package.json` 의 표준 script에는 노출되어 있지 않습니다. 일시적 디버깅 외에는 `start` / `dev` 를 사용하세요.

---

## doctor 체크 상세

`doctor` 가 실행하는 체크는 네 묶음으로 정리됩니다. 위반 등급은 `fail`(실패) / `warn`(경고) / `ok`(통과) 입니다.

### 1. 환경 체크 (`cli/checks/environment.ts`)

런타임·설정·훅 등록 상태를 검사합니다.

| 함수 | 점검 내용 | 위반 시 |
|------|-----------|---------|
| `checkBunVersion` | `bun --version` major `>= 1` | `fail` |
| `checkSettingsJson` | `~/.claude/settings.json` 존재 + JSON 파싱 | `fail` |
| `checkHooksRegistered` | settings.json 6개 훅(`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`SessionStart`/`SessionEnd`/`Stop`) 중 하나라도 `spyglass-collect.sh` 를 가리키는지 + `env.SPYGLASS_DIR` 설정 여부 | 미등록 `fail`, `SPYGLASS_DIR` 만 없으면 `warn` |
| `checkHookExecutable` | `${SPYGLASS_DIR}/hooks/spyglass-collect.sh` 존재 + 실행 비트 | `fail` (`SPYGLASS_DIR` 없으면 `warn`) |

### 2. 데이터베이스 체크 (`cli/checks/database.ts`)

DB 파일 권한, 스키마 버전, 최근 수집 활동을 검사합니다.

| 함수 | 점검 내용 | 위반 시 |
|------|-----------|---------|
| `checkDbPermissions` | DB 파일 `mode & 0o077 == 0` (그룹/타인 권한 차단) | `warn` (`--fix` 가능) |
| `checkDbSchemaVersion` | `PRAGMA user_version >= 12` | `warn` |
| `checkRecentActivity` | 최근 5분 내 `requests` 수집 존재 (없으면 마지막 수집 시각 안내) | `warn` |

### 3. 서버 체크 (`cli/checks/server.ts`)

포트 가용성을 검사합니다.

| 함수 | 점검 내용 | 위반 시 |
|------|-----------|---------|
| `checkServerPort` | `127.0.0.1:9999` 에 `Bun.serve` 테스트 바인딩 가능 여부 | `warn` (서버 운영 중이면 정상이므로 `status` 와 함께 해석) |

### 4. Turn 무결성 체크 (`cli/checks/integrity.ts` · ADR-001 P1)

prompt-response 매핑과 통계 데이터 정합성을 검사합니다.

| 함수 | 점검 내용 | 임계 |
|------|-----------|------|
| `checkOrphanRows` | `requests.turn_id IS NULL` 행 수 | `> 0` → `warn` |
| `checkZeroResponseTurns` | prompt 있는데 response 0건인 turn 수 | `> 0` → `warn` |
| `checkLongProxyResponses` | `proxy_requests.response_time_ms > 120000` 행 수 | `> 0` → `warn` |
| `checkDuplicateResponses` | 같은 세션 · `preview` 동일 · `timestamp` 1초 이내 response 쌍 | `> 0` → **`fail`** (회귀) |
| `checkMismatchedTurnIds` | timestamp 기반 매핑과 실제 `turn_id` 불일치 행 | `> 0` → **`fail`** (회귀) |
| `checkUnlinkedToolCalls` | 최근 1시간 `tool_call` 중 `api_request_id IS NULL` 비율 (표본 `< 5` skip, `pct < 10%` 는 `ok`) | `pct >= 10%` → `warn` |
| `checkOrphanProxyToolUses` | 매칭 없는 `proxy_tool_uses` 행 (사용자 취소 가능, 정보성) | 항상 `ok` |

`fail` 로 분류되는 두 항목은 회귀 검출용입니다. 발생 시 우선 `--fix` 로 보정하고, 다시 잡히면 변경 이력을 확인하세요.

---

## 데이터 보조 스크립트

서버 라이프사이클과 별개로 동작하는 일회성 보정 스크립트입니다. 단일 트랜잭션으로 작성되어 서버를 멈추지 않고 안전하게 호출할 수 있습니다.

### `rebuild-stats`

`stats_hourly` 집계 테이블을 `requests` 원본에서 재구축합니다. 산식 변경, 외부 정정, 대량 DELETE 후 일관성 회복에 사용합니다. `DELETE + INSERT` 단일 트랜잭션이므로 멱등합니다.

```bash
# 전체 재집계
bun run rebuild-stats

# hour_ts >= sec 만 재집계
bun run rebuild-stats --since=<unix_s>
```

**예시 출력**

```text
[rebuild-stats] sinceTs=<all> rowsInserted=4218 elapsedMs=87
```

### `rebuild-stats-proxy`

`stats_proxy_hourly` 집계 테이블을 `proxy_requests` 원본에서 재구축합니다 (proxy-hourly ADR-005). 인자와 멱등성은 `rebuild-stats` 와 동일합니다.

```bash
bun run rebuild-stats-proxy
bun run rebuild-stats-proxy --since=<unix_s>
```

### `backfill:system-prompts`

세션 prologue 의 시스템 프롬프트가 누락된 과거 행을 transcript 재스캔으로 채워 넣습니다. 이미 채워진 행은 건너뜁니다.

```bash
bun run backfill:system-prompts
```

---

## 환경 변수

런타임 동작을 조정하는 환경 변수 목록입니다. 변수명에 `SPGLASS_` (약어) 와 `SPYGLASS_` 가 섞여 있으니 정확히 입력하세요.

**서버 런타임**

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `SPGLASS_PORT` | `9999` | HTTP 포트 |
| `SPGLASS_HOST` | `127.0.0.1` | 바인딩 호스트 |
| `SPGLASS_DB_PATH` | `~/.spyglass/spyglass.db` | DB 파일 경로 |
| `SPYGLASS_PID_FILE` | `~/.spyglass/server.pid` | PID 파일 위치 (임시 인스턴스 분리용) |
| `SPYGLASS_SERVER_LOG` | `~/.spyglass/logs/server.log` | stdout/stderr 미러 로그 |
| `SPYGLASS_RETENTION_DAYS` | `30` | 일별 유지보수 보존 일수 |
| `SPYGLASS_LANG` | `LANG` / `LC_ALL` / `ko` | CLI 메시지 언어 (ko/en/ja/zh) |

**훅 / 프록시**

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `SPYGLASS_DIR` | — | `settings.json` 의 `env` 값. 훅 스크립트 위치 |
| `ANTHROPIC_BASE_URL` | — | 설정 시 Claude Code 가 `/v1/*` 프록시로 요청을 라우팅 |

**진단 로그 (`diag-log.ts`)**

서버 재시작 시 플래그가 고정됩니다(모듈 로드 시점 1회 평가). 변경 후에는 서버를 재시작해야 반영됩니다.

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `SPYGLASS_DIAG_ENABLED` | — (비활성) | `'1'` 또는 `'true'` 로 설정 시 진단 jsonl 로그 활성화. 기본값은 비활성(no-op) — 운영 시 디스크 사용량 0 |
| `SPYGLASS_DIAG_LOG_DIR` | `<cwd>/.claude/.tmp/logs` | 진단 로그 디렉터리 경로 override |
| `SPYGLASS_DIAG_RAW_SSE` | — (비활성) | `'1'` 로 설정 시 proxy SSE 응답 본문 raw 를 jsonl 에 포함 (최대 200KB, 파일 비대 주의) |

**출력 카테고리** (`SPYGLASS_DIAG_ENABLED=1` 활성 시):

| 파일 | 내용 |
|------|------|
| `model-trace.log` | 모델 추출/분기 추적 (사람-읽기 한 줄 trace) |
| `hook-payload.jsonl` | 훅 진입 시 raw payload (1줄/이벤트) |
| `proxy-payload.jsonl` | 프록시 진입+종료 시 raw 본문/헤더 (1줄/단계) |

**활성화 예시**

```bash
# inline prefix (권장 — 공백으로 연결, '&' 사용 금지)
SPYGLASS_DIAG_ENABLED=1 bun run dev

# 로그 위치 override
SPYGLASS_DIAG_ENABLED=1 SPYGLASS_DIAG_LOG_DIR=/tmp/spyglass-diag bun run dev

# SSE raw body 포함
SPYGLASS_DIAG_ENABLED=1 SPYGLASS_DIAG_RAW_SSE=1 bun run dev
```

---

## 종료 코드

모든 명령은 정상일 때 `0` 을 반환합니다. `1` 은 다음 상황에서 발생합니다.

| 명령 | `1` 발생 조건 |
|------|---------------|
| `start` | 포트 점유 (사용자 개입 필요) |
| `stop` | SIGTERM 송신 실패 |
| `restart` | 5초 내 포트 해제 실패 |
| `doctor` | `fail` 1건 이상 또는 알 수 없는 서브명령 |
| `cli.ts` 공통 | 예외 발생 시 `오류:` prefix 와 함께 `exit 1` |

---

## 자주 쓰는 시나리오

상황별 명령 조합을 "이럴 때 → 이렇게" 형태로 정리했습니다.

### 시나리오 1: 처음 시작하는 경우

**이럴 때**: 저장소를 클론하고 처음으로 spyglass 를 띄울 때.

**이렇게**:

```bash
bun install
bun run doctor          # Bun, settings.json, 훅, 포트, DB 한 번에 확인
bun run doctor --fix    # 권한·정합성 자동 보정 (필요 시)
bun run start
bun run status          # 다른 터미널에서 정상 기동 확인
```

### 시나리오 2: 개발 루프

**이럴 때**: 코드 수정 → 재기동을 반복하며 디버깅할 때.

**이렇게**:

```bash
# 포트 자동 정리 후 재기동 (가장 흔한 흐름)
bun run dev

# 로그를 실시간으로 보며 디버깅
bun run packages/server/src/index.ts     # 포그라운드, Ctrl+C 로 종료
```

### 시나리오 3: 비정상 동작 디버깅

**이럴 때**: 데이터가 안 들어오거나, UI 가 비어 있거나, 통계가 어긋날 때.

**이렇게**:

```bash
bun run status                       # 1) 서버가 살아 있는지 확인
bun run doctor                       # 2) 무엇이 비정상인지 진단
tail -f ~/.spyglass/logs/server.log  # 3) 미러 로그로 최근 에러 확인
bun run rebuild-stats                # 4-A) 집계가 어긋난 경우
bun run rebuild-stats-proxy          # 4-B) 프록시 집계가 어긋난 경우
bun run backfill:system-prompts      # 4-C) 시스템 프롬프트가 비어 있을 때
```

### 시나리오 4: 깨끗한 상태로 되돌리기

**이럴 때**: DB 가 꼬였거나 PID 파일이 stale 상태가 반복되어 초기화하고 싶을 때.

**이렇게**:

```bash
bun run stop && rm -rf ~/.spyglass && bun run start
```

DB만 삭제해도 다음 기동 시 마이그레이션이 새로 돌지만, PID 파일과 로그까지 정리하려면 디렉터리 전체를 지우는 편이 단순합니다.

### 시나리오 5: 임시 인스턴스를 운영과 격리

**이럴 때**: 운영 데몬을 끄지 않고 별도 포트로 실험용 인스턴스를 띄우고 싶을 때.

**이렇게**:

```bash
SPGLASS_PORT=9998 \
SPYGLASS_PID_FILE=/tmp/spyglass-tmp.pid \
SPGLASS_DB_PATH=/tmp/spyglass-tmp.db \
bun run packages/server/src/index.ts start
```

PID·포트·DB를 모두 분리하면 운영 데몬과 충돌 없이 별도 인스턴스를 띄울 수 있습니다.
