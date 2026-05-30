-- Migration 056: at-rest 컬럼 암호화 algo 마커 (R3)
--
-- Purpose:
--   본문 컬럼을 AES-256-GCM으로 at-rest 암호화하기 위한 algo 마커 컬럼을 추가한다.
--   읽기 경로가 payload_algo/content_algo로 평문/zstd/암호문 혼재를 분기 디코드하므로
--   (silent corruption 방지), algo 마커가 없는 두 TEXT 테이블에만 컬럼을 추가한다.
--
-- 대상별 현황:
--   - proxy_requests.payload : 이미 BLOB + payload_algo (021) → 변경 없음. 코드가 algo에
--                              'zstd+aes256gcm' 신규 값을 기록(additive).
--   - requests.payload       : TEXT + payload_algo 존재(021, 그동안 미사용/dead) → 변경 없음.
--                              암호문은 base64-in-TEXT로 in-place 저장(string→BLOB 변경 없음).
--   - claude_events.payload  : TEXT NOT NULL(006), algo 컬럼 없음 → payload_algo 추가.
--   - system_prompts.content : TEXT NOT NULL(022), algo 컬럼 없음 → content_algo 추가.
--
-- 안전성:
--   - ADD COLUMN (NULL 기본) — 기존 데이터 무손실. 기존 행은 algo=NULL = 평문으로 해석되어
--     종전과 100% 동일하게 읽힌다. 암호화는 옵트인(SPYGLASS_ENCRYPTION)이라 OFF면 무변경.
--   - 신규 컬럼명(payload_algo on claude_events / content_algo on system_prompts)은
--     각 테이블에 기존재하지 않음 — migrator의 duplicate-column silent-skip 회피.
--   - migrator.ts가 본 파일을 db.transaction으로 감싸 원자 적용.
--   - 파괴적 변경(컬럼 삭제/타입 변경) 없음. system_prompts.hash(dedup PK)는 평문 기준 유지.
--
-- 함께 변경되는 곳 (코드):
--   - packages/storage/src/{crypto,payload-codec}.ts, runtime/encryption.ts (codec/키 SSoT)
--   - 쓰기: proxy/handler, events.ts, queries/{request/write,system-prompt,event}.ts
--   - 읽기: routes/{proxy,system-prompts}.ts, request-normalizer.ts, domain/session-status.ts,
--           queries/{event,system-prompt}.ts, cli/analyze.ts, scripts/backfill-system-prompts.ts
--
-- @see docs/architecture/stabilization/adr-r3-at-rest-encryption.md (D2, D6)

ALTER TABLE claude_events ADD COLUMN payload_algo TEXT;
ALTER TABLE system_prompts ADD COLUMN content_algo TEXT;

-- requests.payload_algo의 죽은 DEFAULT 'zstd' 정리(Q1): 021이 requests에 payload_algo TEXT
-- DEFAULT 'zstd'를 넣었으나, 같은 021의 `payload BLOB` 추가가 중복명으로 silent-skip되어
-- requests.payload는 실제로 zstd 압축된 적이 없는 평문 TEXT다. 따라서 기존 행의 'zstd' 마커는
-- 거짓이며 평문을 의미한다. 평문 마커(NULL)로 정리해 read 분기를 명확히 한다(payload 값은 불변).
-- proxy_requests.payload_algo의 'zstd'는 실제 압축이므로 건드리지 않는다.
UPDATE requests SET payload_algo = NULL WHERE payload_algo = 'zstd';
