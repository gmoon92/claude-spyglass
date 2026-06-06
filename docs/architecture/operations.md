# 운영(Operations)

> 환경 변수, 빌드, 배포, 유지보수, 문제 해결.

---

## 문서 기준

| 항목 | 값 |
|------|-----|
| 시각 | 2026-06-06 16:44:03 KST |
| 커밋 | `4ea9686` |
| 태그 | `v4.4.0` |

---

## 1. 환경 변수

### 1.1 서버 런타임

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `SPGLASS_PORT` | `9999` | 서버 포트 (키에 'Y' 없음) |
| `SPGLASS_HOST` | `127.0.0.1` | 서버 호스트 (키에 'Y' 없음) |
| `SPGLASS_DB_PATH` | `~/.spyglass/spyglass.db` | DB 경로 (키에 'Y' 없음) |
| `SPYGLASS_PID_FILE` | `~/.spyglass/server.pid` | PID 파일 경로 |
| `SPYGLASS_API_URL` | `http://127.0.0.1:9999` | TUI가 연결할 서버 URL |
| `SPYGLASS_ALL_PROJECTS` | `0` | `1`이면 TUI에서 모든 프로젝트 표시 |
| `SPYGLASS_DIAG_ENABLED` | (없음) | `1`/`true`만 활성 — 진단 jsonl |
| `SPYGLASS_DIAG_LOG_DIR` | `<cwd>/.claude/.tmp/logs` | 진단 로그 디렉토리 override |
| `SPYGLASS_DIAG_RAW_SSE` | (없음) | `1`이면 proxy raw SSE 본문도 jsonl에 포함 |
| `SPYGLASS_GRAPH_MODE` | `primary` | 그래프 sync 모드 (`off`\|`shadow`\|`primary`) |
| `SPYGLASS_RETENTION_DAYS` | `30` | RDB·그래프 retention cutoff. 0/음수/non-numeric은 default 폴백 |
| `SPYGLASS_ENCRYPTION` | (없음) | `1`/`true`/`yes`/`on` 시 at-rest 암호화 활성 |
| `SPYGLASS_ENCRYPTION_KEY` | (없음) | base64 32B 암호화 키 (우선) |
| `ANTHROPIC_BASE_URL` | (없음) | 설정 시 `/v1/*` 프록시 미러링 활성화 |

### 1.2 Hook 수집 스크립트

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `SPYGLASS_HOST` | `localhost` | 서버 호스트 (스크립트 측, 'Y' 포함) |
| `SPYGLASS_PORT` | `9999` | 서버 포트 (스크립트 측, 'Y' 포함) |
| `SPYGLASS_TIMEOUT` | `1` (초) | curl 타임아웃 |

> **키 철자 주의**: 서버 런타임 설정(`SPGLASS_*`)과 hook 스크립트 설정(`SPYGLASS_*`)은 서로 다른 변수군입니다.

### 1.3 TUI 전용

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `SPYGLASS_PROJECT` | (cwd basename) | 표시할 프로젝트명 |
| `SPYGLASS_LANG` | (시스템 로케일) | `ko`/`en`/`ja`/`zh`. CLI `--lang`이 우선 |
| `SPYGLASS_NO_MOTION` | (없음) | `1`이면 스피너·플래시 끔 |
| `NO_COLOR` | (없음) | 표준. 비어 있지 않으면 16색 강제 |

---

## 2. npm Scripts

```bash
# 서버 라이프사이클
bun start         # 서버 기동
bun run dev       # restart — 기존 프로세스 종료 후 재기동
bun run stop      # PID 파일 기준 SIGTERM
bun run status    # PID · 포트 · 헬스 한 줄 요약

# 진단
bun run doctor    # 자동 점검 — Bun / settings.json hook / DB / 포트 / 무결성

# TUI
bun run tui       # Ink 터미널 대시보드

# 품질·테스트
bun test          # 워크스페이스 전체 bun test
bun run typecheck # tsc --noEmit

# 데이터 유지보수
bun run rebuild-stats              # stats_hourly 재집계
bun run rebuild-stats-proxy        # stats_proxy_hourly 재집계
bun run backfill:system-prompts    # 과거 system_prompts 해시 백필
bun run backfill:subagent-parents  # 서브에이전트 parent_tool_use_id 백필

# 웹 (Vite)
bun run web:dev     # Vite dev server (5173)
bun run web:build   # production dist/

# 데스크톱 (Electron)
bun run desktop:dev        # Electron 개발 모드
bun run desktop:build:mac  # macOS 패키지 빌드
bun run desktop:pack:mac   # macOS 디렉토리 팩(미서명)
```

---

## 3. 빌드 및 실행

- TypeScript는 Bun이 직접 실행(`bun run *.ts`).
- **웹은 Vite 빌드 필요** (`bun run web:build` → `packages/web/dist/`). 서버는 `dist/`를 정적 서빙.
- 패키지 의존성은 `workspace:*`로 심볼릭 링크.

### Docker (선택)

```bash
docker-compose up --build
```

`docker-compose.yml`과 `Dockerfile`이 루트에 제공됩니다.

---

## 4. 파일시스템 위치

| 경로 | 내용 |
|------|------|
| `~/.spyglass/spyglass.db` | SQLite DB (WAL 모드, 0o600) |
| `~/.spyglass/spyglass.db-wal` | WAL 저널 |
| `~/.spyglass/spyglass.db-shm` | shared memory 인덱스 |
| `~/.spyglass/graph/` | Ladybug 그래프 투영 |
| `~/.spyglass/server.pid` | 데몬 PID 파일 |
| `~/.spyglass/logs/server.log` | stdout/stderr 미러 |
| `~/.spyglass/logs/collect.log` | hook 스크립트 로그 |
| `~/.spyglass/logs/hook-raw.jsonl` | hook 원장 |
| `~/.spyglass/logs/diag/*.jsonl` | 진단 jsonl |
| `~/.spyglass/pricing.json` | 모델별 단가 설정 |
| `~/.spyglass/encryption.key` | at-rest 암호화 키 (0600) |
| `<cwd>/.claude/` | 프로젝트별 Behavior Definitions |
| `~/.claude/` | 글로벌 Behavior Definitions |

---

## 5. 유지보수

### 5.1 사전 집계 재구성

```bash
# stats_hourly 전체 재집계
bun run rebuild-stats

# 특정 시점 이후만 재집계
bun run rebuild-stats --since=1735603200   # unix epoch sec

# proxy 사전 집계 재구성
bun run rebuild-stats-proxy
```

### 5.2 SQLite 최적화

```bash
# WAL → main 머지
sqlite3 ~/.spyglass/spyglass.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 디스크 공간 회수 (락 발생, 서버 중단 필요)
sqlite3 ~/.spyglass/spyglass.db "VACUUM;"

# 옵티마이저 통계 갱신
sqlite3 ~/.spyglass/spyglass.db "ANALYZE;"

# 안전한 백업
sqlite3 ~/.spyglass/spyglass.db ".backup /backup/spyglass-$(date +%Y%m%d).db"
```

### 5.3 검증 쿼리

```sql
PRAGMA user_version;            -- 마이그레이션 버전
PRAGMA integrity_check;         -- DB 무결성
PRAGMA foreign_key_check;       -- FK 위반 row

-- stats_hourly ↔ requests 동기화 검증
SELECT
  (SELECT SUM(tokens_total) FROM stats_hourly) -
  (SELECT SUM(tokens_total) FROM requests WHERE event_type IS NULL OR event_type != 'pre_tool') AS drift;
```

drift ≠ 0이면 `rebuild-stats` 실행.

---

## 6. 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| 서버 기동 실패 | 포트 점유 | `bun run status` 또는 `lsof -i :9999` 확인 |
| DB `disk I/O error` | WAL/shm 잔존 | 서버 중단 후 `PRAGMA wal_checkpoint(TRUNCATE)` |
| 훅 미수집 | settings.json 미등록 | `bun run doctor`로 hook 상태 확인 |
| 프록시 502 | upstream 불능 | `ANTHROPIC_BASE_URL` 및 네트워크 확인 |
| TUI 색상 흑백 | `NO_COLOR` 설정 | `echo $NO_COLOR` 확인 |
| statsHourly drift | 대량 DELETE 후 트리거 누락 | `bun run rebuild-stats` |
| 그래프 sync 중단 | circuit OPEN 또는 Ladybug 미설치 | `/api/settings/graph-db/status` 확인 후 `install` |

---

> **문서 기준**
> - 시각: 2026-06-06 16:44:03 KST
> - 커밋: `4ea9686`
> - 태그: `v4.4.0`
