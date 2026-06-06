-- =============================================================================
-- 063 — requests.payload / payload_algo 컬럼 DROP (storage-payload-detach 단계 C, R7 파괴적)
-- =============================================================================
-- ⚠️ BACKWARD-INCOMPATIBLE (R7) · 롤백 불가 · 사용자 승인 후 적용.
--
-- 배경 (plan: .claude/docs/plans/storage-payload-detach/payload-detach-plan.md):
--   061(테이블)·062(백필) 로 request_payloads 가 requests.payload 와 완전 일치(8159=8159 검증).
--   write 는 single-write(request_payloads 만), read 는 payload 필요 경로(getRequestById·
--   getChildRequests*·conversation·turn)가 request_payloads LEFT JOIN 으로 전환 완료(같은 커밋 코드).
--   이제 requests 본체에서 payload(57MB)·payload_algo 를 제거해 메인 B-tree 를 81MB→~25MB 로 축소한다.
--
-- 효과:
--   - requests 테이블 페이지에서 BLOB 제거 → 피드 `SELECT *` 가 payload 미포함(전송 1.5MB→~60KB),
--     /api/sessions·집계 등 모든 스칼라 스캔의 콜드 폴트인 감소.
--   - extract.ts 는 payload 부재 시 preview/tool_detail fallback(prompt/response preview 100% 보유,
--     tool_call 은 tool_detail) → 피드 미리보기 회귀 없음. payload 상세는 getRequestById lazy 회수.
--
-- 자동 적용 단계적 안전성(사용자 요구):
--   - 본 마이그레이션은 read JOIN + write single-write 코드와 **같은 커밋**에 묶인다.
--   - migrator 는 DB 연결 직후(connection.ts runMigrations) 첫 쿼리 전에 적용하므로, 부팅 시
--     063(DROP)이 먼저 실행되고 이후 read JOIN 쿼리(r.* + p.payload)가 정합한다(컬럼 충돌 없음).
--   - 062 까지만 적용된 구버전 DB 에 신버전 코드가 붙어도, 마이그레이션이 선행되어 정합.
--
-- 안전성: payload·payload_algo 를 참조하는 인덱스 없음(idx_requests_toolstats_covering 은
--         tool_name/tokens_*/duration_ms/tool_detail 만, striperr 는 tool_detail 만). DROP 가능.
--         preview·preview_algo 는 requests 에 유지(피드 미리보기 직접 사용 — 분리 대상 아님).
-- 멱등성: SQLite 는 DROP COLUMN 에 IF EXISTS 미지원. migrator 가 "no such column" 류 에러를
--         이미-적용으로 간주해 skip(057 선례) — 재실행 안전. user_version 63 으로 1회만 전진.
-- 롤백: 불가(컬럼·데이터 제거). 복구하려면 request_payloads 에서 payload 컬럼을 재생성+백필해야 함.
-- =============================================================================

-- 안전벨트: DROP 직전 최종 재백필(멱등) — 062 이후 dual-write 누락분이 혹시 있어도 커버.
--   request_payloads 에 없는 payload 보유 행을 마지막으로 한 번 더 복사한 뒤 컬럼을 제거하므로
--   payload 데이터는 request_payloads 에 100% 보존된다(컬럼 구조만 롤백 불가, 데이터 손실 없음).
INSERT OR IGNORE INTO request_payloads (request_id, payload, payload_algo)
SELECT id, payload, payload_algo FROM requests WHERE payload IS NOT NULL;

ALTER TABLE requests DROP COLUMN payload;
ALTER TABLE requests DROP COLUMN payload_algo;
