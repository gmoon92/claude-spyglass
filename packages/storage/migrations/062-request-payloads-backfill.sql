-- =============================================================================
-- 062 — request_payloads 백필 (storage-payload-detach 단계 A, 비파괴적)
-- =============================================================================
-- 061 에서 만든 request_payloads 에 기존 requests.payload 를 1:1 복사한다.
--   - payload_algo 동반 복사 — R3 codec 의미 보존(평문/AES 분기 마커).
--   - payload IS NOT NULL 행만(피드 미리보기 전용 prompt/response/tool_call 모두 payload 보유).
--   - INSERT OR IGNORE: request_id PK 충돌 시 skip → 재실행 안전(멱등). 백필 중복 무해.
--
-- requests.payload 원본은 그대로 유지(063 DROP 전까지) → 본 단계는 완전 비파괴적·롤백 가능
--   (request_payloads 비우면 원복). read 경로는 아직 requests.payload 사용(동작 불변).
--
-- 실행비용: 운영 7GB DB 에서 payload 57MB / ~7,900 행(payload 보유) INSERT.
--   migrator 가 단일 트랜잭션으로 감싸므로 그 동안 writer 락(부팅 시 1회, 수십초 추정).
-- =============================================================================

INSERT OR IGNORE INTO request_payloads (request_id, payload, payload_algo)
SELECT id, payload, payload_algo
FROM requests
WHERE payload IS NOT NULL;
