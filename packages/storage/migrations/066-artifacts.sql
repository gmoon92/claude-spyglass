-- =============================================================================
-- 066 — Content-Addressed Storage(CAS) 기반 구조 (Artifact Layer, roadmap Phase 2)
-- =============================================================================
-- 배경 (실측 — 2026-06-30, storage profiler):
--   proxy_requests.payload(conversation JSON)는 document(통짜) 단위로는 dedup 0%지만,
--   system/message/tool '블록' 단위로 쪼개면 dev 95.2%(264MB)가 중복이다. append 구조라
--   매 요청이 직전 턴을 통째로 다시 담기 때문. → payload를 청크로 쪼개 content-addressed로
--   저장하면 대부분의 중복을 제거할 수 있다(로드맵 storage-evolution-roadmap.md Phase 2/3).
--
-- 이 마이그레이션의 책임 (구조만 — 동작 변경 없음):
--   1) artifacts            : 청크 1개 = 1행. hash(평문 SHA-256) PK, ref_count 참조카운팅.
--                             system_prompts(022)의 CAS 패턴을 그대로 따르되 content가 아니라
--                             stored_bytes(BLOB, zstd±암호화)를 담는다.
--   2) proxy_request_chunks : proxy_requests ↔ 청크 순서 매핑(manifest). seq로 재조립 순서 보존.
--   3) proxy_requests.payload_manifest_algo : 신호 컬럼. 'chunks/v1'=CAS 재조립, NULL=레거시
--                             (기존 payload BLOB 직접 디코드). 두 방식이 행 단위로 공존한다.
--
-- FK 정책 (022와 동일): proxy_request_chunks.chunk_hash → artifacts(hash),
--   proxy_request_chunks.request_id → proxy_requests(id) 모두 인덱스만 두고 FOREIGN KEY는
--   강제하지 않는다. 이유 — GC(retention)에서 참조/피참조를 코드로 제어하며(ref_count),
--   삭제 순서를 애플리케이션이 원자 트랜잭션으로 관장하므로 CASCADE 불필요.
--
-- 안전성/멱등성:
--   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS — 재실행 안전.
--   - ADD COLUMN은 migrator가 'duplicate column' 감지 시 skip(migrator.ts) — 재적용 안전.
--   - 순수 additive. 기존 읽기/쓰기 경로는 payload_manifest_algo=NULL로 100% 기존 동작.
-- =============================================================================

-- =============================================================================
-- artifacts: content-addressed 청크 저장소 (청크 1개 = 1행)
-- =============================================================================
CREATE TABLE IF NOT EXISTS artifacts (
  hash          TEXT PRIMARY KEY NOT NULL,                            -- SHA-256(평문 청크) hex 64자 — content address (dedup PK)
  stored_bytes  BLOB NOT NULL,                                        -- encodeBlob(평문): zstd(raw) 또는 encrypt(zstd(raw))
  algo          TEXT,                                                 -- payload_algo 마커: 'zstd' | 'zstd+aes256gcm' (NULL 불가하나 코덱 계약상 넓게)
  raw_size      INTEGER NOT NULL,                                     -- 평문 청크 byte 길이 (dedup 절감량 산출·UI)
  ref_count     INTEGER NOT NULL DEFAULT 1,                           -- 이 청크를 참조하는 proxy_request_chunks 수 (UPSERT +1, GC -N)
  first_seen_at INTEGER NOT NULL,                                     -- 최초 INSERT timestamp(ms)
  last_seen_at  INTEGER NOT NULL,                                     -- 마지막 참조 timestamp(ms) — UPSERT마다 갱신
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_last_seen ON artifacts(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_ref_count ON artifacts(ref_count DESC);

-- =============================================================================
-- proxy_request_chunks: proxy_requests → 청크 순서 매핑 (manifest)
-- =============================================================================
CREATE TABLE IF NOT EXISTS proxy_request_chunks (
  request_id  TEXT NOT NULL,                                          -- proxy_requests(id)
  seq         INTEGER NOT NULL,                                       -- 0-based 순번. seq0=envelope, 이후 블록. 재조립 순서 SSoT
  chunk_hash  TEXT NOT NULL,                                          -- artifacts(hash)
  PRIMARY KEY (request_id, seq)                                       -- 요청 내 seq 유일 + 순서 보장
);

-- GC 역조회: 특정 청크를 참조하는 요청들(ref_count 재계산·정합 검증용)
CREATE INDEX IF NOT EXISTS idx_prc_chunk_hash ON proxy_request_chunks(chunk_hash);

-- =============================================================================
-- proxy_requests 신호 컬럼: CAS 행 vs 레거시 행 구분
-- =============================================================================
-- 'chunks/v1' = proxy_request_chunks로 재조립. NULL = 기존 payload BLOB 직접 디코드(레거시).
-- CAS 행은 기존 payload 컬럼을 NULL로 두어 중복 저장을 피한다(payload 컬럼은 DROP하지 않음 — 레거시 공존).
ALTER TABLE proxy_requests ADD COLUMN payload_manifest_algo TEXT;
