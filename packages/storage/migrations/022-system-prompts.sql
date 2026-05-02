-- v22: system prompt dedup 정규화 테이블 + proxy_requests cross-link
--
-- 책임:
--  - 매 LLM 요청에 함께 전송되는 body.system 본문을 hash 기반 정규화 dedup 저장.
--  - proxy_requests에 system_hash(참조)·system_byte_size(UI hot data) 추가.
--
-- ADR 매핑:
--  - ADR-001: content-addressable system_prompts 테이블 + proxy_requests 컬럼 2개
--  - ADR-007: v21 system_reminder(user 메시지 안 reminder) ⊥ v22 system_hash(body.system 본문) — 직교 책임
--
-- FK 정책: proxy_requests.system_hash → system_prompts(hash) 참조는 인덱스만 두고 FOREIGN KEY는 강제 안 함.
--          이유 — backfill을 옵션으로 두므로 일부 행이 NULL/미존재 가능, system_prompts는 절대 삭제 안 함이라 CASCADE 의미 없음.

-- =============================================================================
-- system_prompts: 정규화된 system 본문 카탈로그
-- =============================================================================
CREATE TABLE IF NOT EXISTS system_prompts (
  hash             TEXT PRIMARY KEY NOT NULL,                              -- SHA-256(normalized) hex 64자
  content          TEXT NOT NULL,                                          -- 정규화된 system 본문 (idx[0] billing-header 제외, idx[1]+ join)
  byte_size        INTEGER NOT NULL,                                       -- length(content) — UI 'X KB' 라벨용 캐시
  segment_count    INTEGER NOT NULL DEFAULT 1,                             -- 정규화에 사용된 text 항목 수 (보통 2: idx[1]+idx[2])
  first_seen_at    INTEGER NOT NULL,                                       -- 최초 INSERT timestamp(ms) — proxy_requests.timestamp와 동일 단위
  last_seen_at     INTEGER NOT NULL,                                       -- 마지막 사용 timestamp(ms)
  ref_count        INTEGER NOT NULL DEFAULT 1,                             -- 참조된 proxy_requests 수 (UPSERT마다 +1)
  created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- 라이브러리 패널 정렬용
CREATE INDEX IF NOT EXISTS idx_system_prompts_last_seen ON system_prompts(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_prompts_ref_count ON system_prompts(ref_count DESC);

-- =============================================================================
-- proxy_requests cross-link
-- =============================================================================
ALTER TABLE proxy_requests ADD COLUMN system_hash TEXT;          -- system_prompts(hash) 참조 (NULL 허용 — backfill 옵션)
ALTER TABLE proxy_requests ADD COLUMN system_byte_size INTEGER;  -- system 본문 크기 캐시 (preview 미사용 시 UI 라벨용)

CREATE INDEX IF NOT EXISTS idx_proxy_requests_system_hash ON proxy_requests(system_hash);
