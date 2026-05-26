-- Migration 052: 서브에이전트 자식 호출 parent_tool_use_id 자동 백필 + 그래프 재동기
-- Purpose: 자동 업데이트로 v3.0.1 을 받는 다른 사용자의 기존 데이터까지 일괄 복원.
--
-- 배경 (2026-05-26 사용자 보고):
--   Claude Code 는 서브에이전트 내부 도구 호출도 메인 세션 PreToolUse/PostToolUse hook 으로
--   발사. 그 hook payload 에는 agent_id/agent_type 라벨만 있고 parent_tool_use_id 는 없다 →
--   SQLite 적재 시 NULL. 나중에 Agent('xx') PostToolUse 시점에 persistSubagentChildren 이
--   transcript 파싱으로 자식들을 INSERT 하려 해도 이미 존재해 skip → parent NULL 잔존.
--
--   결과: 그래프 enrich 가 PARENT_OF 엣지 미생성 → flow chart ancestor 단절.
--
-- 해결 (이 마이그레이션 + persist.ts 의 작업 A 콤보):
--   1) (이 파일) 기존 NULL parent 행을 같은 session 안의 가장 가까운 직전 Agent ToolCall 로
--      매핑해 일괄 UPDATE.
--   2) 복원된 행 id 를 kuzu_outbox 에 op='update' 로 발행 → 다음 sync tick 에 그래프 갱신.
--   3) (persist.ts) 신규 데이터는 race 자동 복원.
--
-- 안전성:
--   - idempotent: 두 번 실행해도 결과 동일 (이미 채워진 행은 WHERE 절에서 제외).
--   - 트랜잭션: migrator 가 단일 트랜잭션으로 감쌈 — 실패 시 전체 롤백.
--   - 휴리스틱 한계: 같은 session 안에 같은 agent_type 의 Agent 호출이 없는 케이스 (사용자가
--     /slash 로 직접 호출 등) 는 매칭 안 됨 — 진짜 부모가 없으므로 정상.
--   - outbox 행이 늘어 graph sync 가 일시적으로 분주해지지만 enrich 가 idempotent MERGE 라
--     중복 무해. backfill 양이 큰 사용자(예: 1000+ 행)도 cold rebuild 와 합쳐 수 분 내 처리.
--
-- Rollback (수동):
--   해당 마이그레이션을 되돌리려면 _migrations 에서 row 삭제 + PRAGMA user_version=51 로 복귀.
--   백필된 parent_tool_use_id 자체는 그래프 정합성 손상 없이 그대로 둬도 무해 — 새로
--   적재되는 정확한 데이터와 동일한 형태이므로 강제 NULL 화 불요.

-- =============================================================================
-- 1단계: 매칭 가능한 백필 대상을 임시 테이블에 저장
-- =============================================================================
-- 각 NULL parent 행에 대해 *같은 session* 안에서 *직전에* 발생한 같은 agent_type 의
-- Agent ToolCall 1개 (가장 가까운 직전) 를 부모로 채택. 그 부모는 자식과 다른 agent_id
-- (= 메인 세션 호출자) 여야 함 — 같은 인스턴스가 자기 자신을 spawn 하는 케이스 회피.
CREATE TEMP TABLE _bf052_targets AS
SELECT r.id AS row_id,
       (SELECT p.tool_use_id
          FROM requests p
         WHERE p.session_id = r.session_id
           AND p.tool_name = 'Agent'
           AND p.tool_detail = r.agent_type
           AND p.timestamp <= r.timestamp
           AND p.tool_use_id IS NOT NULL
           AND p.tool_use_id != ''
           AND (p.agent_id IS NULL OR p.agent_id = '' OR p.agent_id != r.agent_id)
         ORDER BY p.timestamp DESC
         LIMIT 1) AS new_parent
  FROM requests r
 WHERE (r.parent_tool_use_id IS NULL OR r.parent_tool_use_id = '')
   AND r.agent_id IS NOT NULL AND r.agent_id != ''
   AND r.agent_type IS NOT NULL AND r.agent_type != ''
   AND r.tool_use_id IS NOT NULL AND r.tool_use_id != ''
   AND r.source = 'claude-code-hook';

-- =============================================================================
-- 2단계: 매칭이 있는 행만 UPDATE
-- =============================================================================
UPDATE requests
   SET parent_tool_use_id = (
     SELECT new_parent FROM _bf052_targets WHERE _bf052_targets.row_id = requests.id
   )
 WHERE id IN (SELECT row_id FROM _bf052_targets WHERE new_parent IS NOT NULL);

-- =============================================================================
-- 3단계: 복원된 행을 kuzu_outbox 에 발행 → graph sync 가 PARENT_OF 엣지 새로 생성
-- =============================================================================
-- kuzu_outbox 의 op='update' 는 049 마이그레이션의 CHECK 제약에서 이미 허용. enrich.ts 의
-- enrichOutboxRow 가 'insert'/'update' 동일 path 처리 (idempotent MERGE).
INSERT INTO kuzu_outbox(source, event_id, op)
SELECT 'requests', row_id, 'update'
  FROM _bf052_targets
 WHERE new_parent IS NOT NULL;

-- =============================================================================
-- 4단계: 임시 테이블 정리 — TEMP TABLE 은 connection-scoped 라 다음 사용자 영향 없도록 DROP
-- =============================================================================
DROP TABLE _bf052_targets;
