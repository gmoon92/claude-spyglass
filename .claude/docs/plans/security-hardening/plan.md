# Track 1 — 보안·인덱스·가격 외부화

## 목표

1. SQLite DB 파일 및 로그 파일 권한 강화 (`chmod 700/600`)
2. V12 마이그레이션: `requests.timestamp` 단독 인덱스 + `visible_requests` VIEW
3. 모델 가격 외부화 (`~/.spyglass/pricing.json`)

## 배경

`.claude/docs/evaluation/final-evaluation.md`의 P1(4.4 일부)·P2 항목.

- 4.4 로그 권한: 기본 umask에 따라 DB 파일이 `644`로 생성되어 같은 시스템의 다른 사용자가 읽을 수 있음
- 4.3 가격 하드코딩: `MODEL_PRICING` 배열이 코드에 박혀 있어 Anthropic 가격 변경 시 재배포 필요
- P2 인덱스: `requests.timestamp` 단독 인덱스 부재로 시간 범위 조회 풀스캔
- P2 VIEW: `event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent'` 필터가 여러 쿼리에 중복 → VIEW로 캡슐화

## 작업 범위

### 1. 파일 권한 (chmod)

- `packages/storage/src/db.ts` (또는 DB 오픈 지점): DB 파일 생성 직후 `fs.chmodSync(dbPath, 0o600)` 적용
- 상위 디렉토리 `~/.spyglass/`는 `0o700`으로 설정
- 서버 기동 시점에 1회 적용하면 됨 (매번 적용 불필요)

### 2. V12 마이그레이션

`packages/storage/src/schema.ts`에 `MIGRATION_V12` 추가:

```sql
-- V12: timestamp 인덱스 + visible_requests VIEW
CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC);

DROP VIEW IF EXISTS visible_requests;
CREATE VIEW visible_requests AS
SELECT * FROM requests
WHERE event_type IS NULL
   OR event_type != 'pre_tool'
   OR tool_name = 'Agent';
```

`SCHEMA_VERSION` 상수를 11 → 12로 증가, `runMigrations`에 V12 분기 추가.

### 3. 가격 외부화

- 새 파일 `packages/server/src/pricing.ts`:
  - `loadPricing()`: `~/.spyglass/pricing.json` 로드 시도 → 실패 시 하드코딩 fallback
  - 파일 스키마: `[{"model": "claude-opus-4-7", "input": 15, "output": 75, "cacheCreate": 18.75, "cacheRead": 1.5}, ...]` (1M 토큰 단가)
- 기존 `MODEL_PRICING` 사용 지점을 `loadPricing()` 결과로 교체
- 최초 기동 시 파일 없으면 기본값으로 생성 (opt-in 편집 가능)

## 변경 파일

- `packages/storage/src/db.ts` (chmod)
- `packages/storage/src/schema.ts` (V12 migration)
- `packages/server/src/pricing.ts` (신규)
- `packages/server/src/` 중 `MODEL_PRICING` 참조 지점 (grep으로 탐색)

## 검증

- `PRAGMA user_version` → 12 확인
- DB/로그 파일 권한: `ls -l ~/.spyglass/*.db` → `-rw-------`
- `SELECT * FROM visible_requests LIMIT 1` 동작 확인
- `~/.spyglass/pricing.json` 편집 후 재시작 시 반영 확인

## 주의사항

- 기존 DB를 가진 사용자는 V11 → V12 마이그레이션이 자동 실행되어야 함
- DB 파일 권한 변경은 실수로 `root` 소유가 되면 사용자가 접근 불가 → 현재 프로세스 UID와 파일 UID 일치 여부 확인 후 적용
