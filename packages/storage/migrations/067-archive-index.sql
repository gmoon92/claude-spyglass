-- =============================================================================
-- 067 — Archive/ELK 계층 인덱스 + 집계 아카이브 (roadmap Phase 5-6, ADR storage-evolution-adr-archive.md)
-- =============================================================================
-- 배경:
--   Hot SQLite가 retention(30일) 삭제 전까지 성장한다. Warm Archive는 오래된 행 본문을
--   날짜단위 압축파일(~/.spyglass/archive/YYYY-MM-DD.<table>.jsonl.zst)로 옮기고, SQLite에는
--   위치 인덱스(archive_index)와 집계 버킷(archive_stats_*)만 남긴다(로드맵 §5-6).
--
-- 이 마이그레이션의 책임 (구조만 — 동작 변경 없음, 이주는 SPYGLASS_ARCHIVE_DAYS 설정 시에만):
--   1) archive_index          : archive 파일 내 행 위치. timestamp/session 범위 조회로 필요한 파일만 로드(Loki 방식).
--   2) archive_stats_hourly    : stats_hourly와 '동일 컬럼'(sum/count 가법). 오래된 hour 버킷을 이주받아
--                                집계 쿼리가 Hot+archive UNION으로 정확히(exact) 재집계(ADR A6). P95는 비가법이라
--                                duration_ms_sketch(BLOB)에 hour별 근사 스케치를 저장.
--   3) archive_stats_proxy_hourly : stats_proxy_hourly와 동일 컬럼.
--
-- 안전성/멱등성:
--   - CREATE TABLE/INDEX IF NOT EXISTS — 재실행 안전. 순수 additive(기존 읽기/쓰기 무영향).
--   - 이 테이블들이 비어 있으면(골격 기본) Query Layer 병합은 0행 = Hot-only와 완전 동일.
-- =============================================================================

-- =============================================================================
-- archive_index: archive 파일 내 행 위치 인덱스 (본문은 파일, 여기엔 메타만)
-- =============================================================================
CREATE TABLE IF NOT EXISTS archive_index (
  src_table    TEXT    NOT NULL,   -- 'requests' | 'proxy_requests' | 'claude_events' | 'sessions'
  row_id       TEXT    NOT NULL,   -- source PK (requests.id, sessions.id 등)
  session_id   TEXT,               -- sessions 행은 NULL(자기 자신이 세션)
  timestamp    INTEGER NOT NULL,   -- requests/events.timestamp, sessions.started_at
  type         TEXT,               -- requests.type — 파일 열지 않고 by-type 스킵 판단용(비정규화)
  archive_file TEXT    NOT NULL,   -- 예: '2026-06-01.requests.jsonl.zst'
  PRIMARY KEY (src_table, row_id)  -- 멱등 이주(재INSERT 차단) + 안전측 실패(중복→손실0) 근거
);

-- 목록 조회 파일 선택 (getAllRequests 등 timestamp DESC + limit 모양 미러)
CREATE INDEX IF NOT EXISTS idx_archive_index_ts ON archive_index(src_table, timestamp DESC);
-- 대화 조회 (getConversationRows: session_id, timestamp ASC 모양 미러)
CREATE INDEX IF NOT EXISTS idx_archive_index_session ON archive_index(src_table, session_id, timestamp);
-- retention 경계 도달 시 archive 파일 단위 GC 역조회
CREATE INDEX IF NOT EXISTS idx_archive_index_file ON archive_index(archive_file);

-- =============================================================================
-- archive_stats_hourly: stats_hourly 동일 컬럼 + P95 스케치 (집계는 archive 파일 무접촉 — ADR A6)
-- =============================================================================
CREATE TABLE IF NOT EXISTS archive_stats_hourly (
  hour_ts                INTEGER NOT NULL,
  model                  TEXT    NOT NULL DEFAULT '',
  type                   TEXT    NOT NULL,
  event_type             TEXT    NOT NULL DEFAULT '',    -- stats_hourly 차원(ADR-004). UNIQUE/PK에 포함
  request_count          INTEGER NOT NULL DEFAULT 0,
  tokens_input           INTEGER NOT NULL DEFAULT 0,
  tokens_output          INTEGER NOT NULL DEFAULT 0,
  tokens_total           INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  duration_ms_sum        INTEGER NOT NULL DEFAULT 0,
  duration_ms_count      INTEGER NOT NULL DEFAULT 0,
  tokens_input_high_sum  INTEGER NOT NULL DEFAULT 0,     -- confidence=high 토큰 가법 합(stats_hourly와 동일)
  tokens_output_high_sum INTEGER NOT NULL DEFAULT 0,
  tokens_total_high_sum  INTEGER NOT NULL DEFAULT 0,
  tokens_high_count      INTEGER NOT NULL DEFAULT 0,
  duration_ms_sketch     BLOB,                           -- P95 근사(hour별 t-digest/히스토그램). 단계2에서 채움. NULL 허용
  updated_at             INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (hour_ts, model, type, event_type)         -- stats_hourly UNIQUE(hour_ts,model,type,event_type)와 정합
);
CREATE INDEX IF NOT EXISTS idx_archive_stats_hourly_ts ON archive_stats_hourly(hour_ts DESC);

-- =============================================================================
-- archive_stats_proxy_hourly: stats_proxy_hourly 동일 컬럼
-- =============================================================================
CREATE TABLE IF NOT EXISTS archive_stats_proxy_hourly (
  hour_ts                INTEGER NOT NULL,
  model                  TEXT    NOT NULL DEFAULT '',
  request_count          INTEGER NOT NULL DEFAULT 0,
  error_count            INTEGER NOT NULL DEFAULT 0,
  stream_count           INTEGER NOT NULL DEFAULT 0,
  tokens_input           INTEGER NOT NULL DEFAULT 0,
  tokens_output          INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  response_time_ms_sum   INTEGER NOT NULL DEFAULT 0,
  response_time_ms_count INTEGER NOT NULL DEFAULT 0,
  first_token_ms_sum     INTEGER NOT NULL DEFAULT 0,
  first_token_ms_count   INTEGER NOT NULL DEFAULT 0,
  cost_usd_sum           REAL    NOT NULL DEFAULT 0.0,
  updated_at             INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (hour_ts, model)                           -- stats_proxy_hourly UNIQUE(hour_ts,model)와 정합
);
CREATE INDEX IF NOT EXISTS idx_archive_stats_proxy_hourly_ts ON archive_stats_proxy_hourly(hour_ts DESC);
