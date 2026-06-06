-- =============================================================================
-- 060 — v_meta_doc_usage VIEW IN-form 재정의 (read-perf, meta-docs range='all' 콜드 가속)
-- =============================================================================
-- 배경 (실측 — 2026-06-07):
--   listMetaDocsWithUsage 의 range='all' 경로는 v_meta_doc_usage VIEW 를 집계 소스로 쓴다.
--   기존 VIEW(024)의 agent/skill 분기는 `tool_name = 'Agent'` / `tool_name = 'Skill'` 단일 등치라
--   부분 인덱스 idx_requests_meta_doc(tool_name IN ('Agent','Skill')) 의 가드를 구문적으로 함의하지
--   못해 옵티마이저가 `SCAN requests + USE TEMP B-TREE FOR GROUP BY`(풀스캔)로 떨어졌다.
--   11K 행이라 웜은 ~5ms 지만, 콜드에서는 payload BLOB(57MB)이 섞인 행 페이지를 폴트인해 370ms.
--   range 가 걸린 인라인 경로는 이미 057+에서 IN-form CTE 로 covering 인덱스를 타도록 고쳤으나
--   (meta-document.ts), VIEW 경로(range='all', 초기 로드 기본)는 본 마이그레이션으로 정렬한다.
--
-- 변경 — agent/skill 를 tool_name IN ('Agent','Skill') + GROUP BY tool_name, tool_detail 로 통합:
--   - covering idx_requests_meta_doc(tool_name, tool_detail) 채택 → 행 페이지(BLOB) 미접근.
--   - GROUP BY 가 인덱스 정렬을 따라 TEMP B-TREE 제거.
--   - VIEW 의 컬럼 셰이프(type/name/invocations/total_tokens/total_duration_ms/last_used_at/
--     first_used_at)와 type 리터럴('agent'/'skill'/'command')은 CASE tool_name 매핑으로 100% 보존 →
--     호출부(meta-document.ts: SELECT * FROM v_meta_doc_usage)는 변경 불필요.
--   - command 분기는 기존대로 idx_requests_slash 활용(이미 최적) — 그대로 유지.
--
-- 안전성: VIEW 재정의(데이터 무손실, 테이블 불변). DROP VIEW + CREATE VIEW 2 statement.
--         migrator 가 db.transaction 으로 원자 적용. 컬럼 셰이프 불변이라 R7 비대상.
-- 멱등성: DROP VIEW IF EXISTS — 재실행 안전.
-- =============================================================================

DROP VIEW IF EXISTS v_meta_doc_usage;

CREATE VIEW v_meta_doc_usage AS
    SELECT
        CASE tool_name WHEN 'Agent' THEN 'agent' ELSE 'skill' END AS type,
        tool_detail       AS name,
        COUNT(*)          AS invocations,
        COALESCE(SUM(tokens_total), 0)    AS total_tokens,
        COALESCE(SUM(duration_ms), 0)     AS total_duration_ms,
        MAX(timestamp)    AS last_used_at,
        MIN(timestamp)    AS first_used_at
    FROM requests
    WHERE tool_name IN ('Agent', 'Skill') AND tool_detail IS NOT NULL
    GROUP BY tool_name, tool_detail
    UNION ALL
    SELECT
        'command', slash_command, COUNT(*),
        COALESCE(SUM(tokens_total), 0),
        COALESCE(SUM(duration_ms), 0),
        MAX(timestamp), MIN(timestamp)
    FROM requests
    WHERE slash_command IS NOT NULL AND slash_command != ''
    GROUP BY slash_command;
