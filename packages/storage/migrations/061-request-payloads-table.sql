-- =============================================================================
-- 061 — request_payloads off-row 테이블 신설 (storage-payload-detach 단계 A, additive)
-- =============================================================================
-- 배경 (실측 — 2026-06-07):
--   requests.payload(TEXT, 총 57MB)가 행에 인라인 저장되어 requests 메인 B-tree 가 81MB.
--   피드/세션목록/집계의 모든 SELECT 가 BLOB 페이지를 콜드 폴트인 → /api/requests 1.5MB 전송,
--   /api/sessions 콜드 329ms 등. payload 를 1:1 별 테이블로 분리해 메인 B-tree 를 ~25MB 로 축소,
--   payload 가 실제 필요한 상세/펼침/대화재구성/sub-transcript 경로만 JOIN 으로 회수한다.
--
-- 설계 (plan: .claude/docs/plans/storage-payload-detach/payload-detach-plan.md):
--   - request_payloads(request_id PK → requests.id, payload, payload_algo).
--   - payload_algo 를 함께 이전 — R3 codec SSoT 보존(decodeText 가 algo 로 평문/AES 분기).
--     algo 누락 시 암호화 ON 경로에서 silent corruption(CLAUDE.md 경고).
--   - WITHOUT ROWID: request_id(TEXT PK) 단일 조회/JOIN 이 지배적이라 클러스터드 PK 가 효율적.
--   - FK + ON DELETE CASCADE: requests 행 삭제(retention deleteOldData) 시 payload 동반 정리.
--     (단 SQLite FK 는 PRAGMA foreign_keys=ON 일 때만 강제 — retention 은 명시 DELETE 도 병행, 062+ 단계.)
--
-- 본 단계는 스키마만 생성(동작 변화 0). 백필은 062, write dual-write 는 코드, read 전환/DROP 은 063(R7).
-- 멱등성: CREATE TABLE IF NOT EXISTS — 재실행 안전. 안전성: additive, R7 비대상.
-- =============================================================================

CREATE TABLE IF NOT EXISTS request_payloads (
  request_id   TEXT PRIMARY KEY,
  payload      TEXT NOT NULL,
  payload_algo TEXT,
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
) WITHOUT ROWID;
