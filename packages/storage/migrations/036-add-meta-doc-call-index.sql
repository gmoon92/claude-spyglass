-- =============================================================================
-- 036 — meta-doc call-edge 부모 후보 조회용 부분 인덱스
-- =============================================================================
-- 배경 (meta-docs-flow-call-graph feature):
--   ego-graph에 parent_tool_use_id 기반 직접 호출(call) 관계를 추가한다.
--   center가 skill/agent일 때 부모 후보 tool_use_id 집합을 구하는 쿼리:
--
--     SELECT tool_use_id FROM requests
--     WHERE tool_name IN ('Skill','Agent')
--       AND tool_detail = ?            -- center 이름
--       AND tool_use_id IS NOT NULL    -- 호출 ID가 있어야 자식과 연결 가능
--       AND turn_id IS NOT NULL
--       AND timestamp BETWEEN ? AND ?  -- 윈도우
--       AND session_id IN (...)        -- project 필터 (선택)
--
--   기존 인덱스 검토(EXPLAIN QUERY PLAN):
--     - idx_requests_meta_doc(tool_name, tool_detail) WHERE tool_name IN ('Agent','Skill')
--         → tool_name='Skill' 동등 비교 + timestamp BETWEEN 조합에서 옵티마이저가
--           idx_requests_timestamp(timestamp DESC)를 우선 선택. tool_detail 조건은
--           인덱스에서 제외돼 부분 인덱스로의 SEARCH 솔루션이 잡히지 않음
--           (INDEXED BY 힌트로도 "no query solution" 에러).
--     - 결과: 행 수가 적은 현 상황(2.5K rows)은 빠르지만, 데이터 증가 시 timestamp
--           range 안에서 tool_name+tool_detail 동등 필터를 추가 적용해 비효율 증대 우려.
--
-- 결정:
--   - timestamp를 선두 컬럼으로 두지 않는다 — 윈도우는 보통 7일로 거의 모든 행 포함.
--   - (tool_name, tool_detail) 동등 필터에 정확히 매핑되는 부분 인덱스를 신설.
--   - 부분 조건에 tool_use_id IS NOT NULL을 명시해 자식 연결 가능한 행만 인덱싱.
--   - timestamp는 후행 컬럼으로 포함 — 인덱스 only scan에서 range 컷오프 가능.
--
-- 기존 idx_requests_meta_doc(tool_name, tool_detail) WHERE tool_name IN ('Agent','Skill')
-- 는 listMetaDocsWithUsage 같은 카탈로그 조회에서 여전히 유용하므로 삭제하지 않는다.
--
-- 트랜잭션:
--   - 본 파일은 migrator.transaction() 안에서 실행됨 — 파일 내부 BEGIN/COMMIT 금지.
--
-- @see packages/storage/src/queries/meta-document.ts getMetaFlowEgo callEdges 산출
-- @see .claude/docs/plans/meta-docs-flow-call-graph/adr.md
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_requests_meta_doc_call
  ON requests(tool_name, tool_detail, timestamp)
  WHERE tool_name IN ('Skill', 'Agent')
    AND tool_detail IS NOT NULL
    AND tool_use_id IS NOT NULL;
