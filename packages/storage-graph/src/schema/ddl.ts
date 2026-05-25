/**
 * ddl.ts — LadybugDB 그래프 스키마 SSoT
 *
 * 책임:
 *   Spyglass 도메인의 그래프 모델 (7 노드 × 8 엣지) 을 openCypher / Kuzu DDL
 *   문법으로 정의한다. 컬럼 의미·SQLite 대응 관계는 통합 보고서를 단일 진실로
 *   참조 (`doc-source-ref` 룰).
 *
 * 의존성:
 *   - 없음 (순수 상수 정의 모듈).
 *
 * 호출 흐름:
 *   1) `client.ts::connect()` 직후 `schema/apply.ts::applySchema()` 호출.
 *   2) `applySchema` 가 본 모듈의 `NODE_TABLES`, `REL_TABLES`, `SCHEMA_VERSION` 을
 *      순서대로 실행/확인.
 *
 * 디자인 결정:
 *   - 본 파일은 *순수 데이터*. 실행 로직(`apply.ts`)과 분리해 SQL 변경 review가 쉽도록.
 *   - 각 컬럼 옆 주석은 **SQLite source column** 을 가리킨다 — 추후 enricher가 어떤
 *     쿼리로 채우는지 1초 만에 추적 가능.
 *   - PRIMARY KEY 는 모두 STRING (Spyglass의 id 패턴이 모두 텍스트 합성 키).
 *   - payload BLOB / 긴 텍스트는 그래프에 복제하지 않는다 — `payload_ref` 포인터로
 *     SQLite 행을 가리킬 뿐 (보고서 §3.3 원칙).
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/01-database-architecture.md
 *   §3.1 노드 / §3.2 엣지 / §3.3 SQLite ↔ Kuzu 매핑 (SSoT).
 */

// =============================================================================
// 스키마 버전 — schema/apply.ts 가 변경 감지 시 throw-away rebuild
// =============================================================================

/**
 * 본 모듈의 DDL 합 (노드/엣지/타입) 이 바뀔 때마다 1씩 증가시킨다. apply.ts 가 LadybugDB
 * 안의 `_SchemaMeta.version` 과 본 상수를 비교하여 mismatch면 폴더 rename 후 처음부터
 * 재빌드 — SQLite SSoT 가 있으므로 데이터 손실 0.
 */
export const SCHEMA_VERSION = 1;

// =============================================================================
// 노드 7개 — 보고서 §3.1 그대로
// =============================================================================

/**
 * CREATE NODE TABLE DDL 모음. apply.ts 가 배열 순서대로 실행 — 외래 의존이 없으므로
 * 어떤 순서로 실행해도 무방하지만, 보고서 표 순서와 동일하게 유지해 가독성 확보.
 */
export const NODE_TABLES: readonly string[] = [
  // 1. Session — Spyglass의 최상위 컨테이너. requests.session_id 의 distinct 집합.
  `CREATE NODE TABLE IF NOT EXISTS Session (
     id              STRING,
     project_name    STRING,
     cwd             STRING,
     started_at      INT64,
     ended_at        INT64,
     total_tokens    INT64,
     PRIMARY KEY (id)
   )`,

  // 2. Turn — prompt 1회 + 그에 따른 모든 tool/system 응답. requests.turn_id 단위.
  `CREATE NODE TABLE IF NOT EXISTS Turn (
     id              STRING,
     session_id      STRING,
     ordinal         INT32,
     prompt_id       STRING,
     started_at      INT64,
     PRIMARY KEY (id)
   )`,

  // 3. Agent — root agent("main") 또는 subagent. requests.agent_id 단위.
  `CREATE NODE TABLE IF NOT EXISTS Agent (
     id              STRING,
     type            STRING,
     parent_tool_use STRING,
     session_id      STRING,
     PRIMARY KEY (id)
   )`,

  // 4. ToolCall — tool_use_id 단위. mig-037 가상 slash:<turn_id> 포함.
  `CREATE NODE TABLE IF NOT EXISTS ToolCall (
     tool_use_id        STRING,
     request_id         STRING,
     session_id         STRING,
     turn_id            STRING,
     agent_id           STRING,
     tool_name          STRING,
     tool_detail        STRING,
     slash_command      STRING,
     is_virtual_slash   BOOLEAN,
     started_at         INT64,
     duration_ms        INT32,
     tokens_total       INT64,
     interrupted        BOOLEAN,
     PRIMARY KEY (tool_use_id)
   )`,

  // 5. Event — hook 페이로드 단위 raw event. payload BLOB 은 SQLite에 남고 ref만 보관.
  `CREATE NODE TABLE IF NOT EXISTS Event (
     id              STRING,
     event_type      STRING,
     tool_use_id     STRING,
     turn_id         STRING,
     session_id      STRING,
     timestamp       INT64,
     payload_ref     STRING,
     PRIMARY KEY (id)
   )`,

  // 6. MetaDocument — agent / skill / command 카탈로그. meta_documents 테이블.
  `CREATE NODE TABLE IF NOT EXISTS MetaDocument (
     id              INT64,
     type            STRING,
     name            STRING,
     source          STRING,
     source_root     STRING,
     PRIMARY KEY (id)
   )`,

  // 7. Badge — anomaly / interrupted / user_modified 등 시그널 마커.
  `CREATE NODE TABLE IF NOT EXISTS Badge (
     id              STRING,
     kind            STRING,
     severity        STRING,
     created_at      INT64,
     PRIMARY KEY (id)
   )`,

  // 부가 — _SchemaMeta 단일 행 (version 추적용). 사용자 도메인 아님, 메타데이터.
  `CREATE NODE TABLE IF NOT EXISTS _SchemaMeta (
     key             STRING,
     version         INT32,
     applied_at      INT64,
     PRIMARY KEY (key)
   )`,
];

// =============================================================================
// 엣지 8개 — 보고서 §3.2 그대로
// =============================================================================

/**
 * CREATE REL TABLE DDL. Kuzu/Ladybug 는 walk semantic 이므로 `*1..k` 사용 시 upper
 * bound 명시 필수. 본 DDL 자체는 무방향/방향성만 지정하고 traversal 시 limit 부여.
 */
export const REL_TABLES: readonly string[] = [
  // 세션 → 턴 (1:N)
  `CREATE REL TABLE IF NOT EXISTS CONTAINS (FROM Session TO Turn)`,

  // 턴의 시간 순서 (T1 → T2 → T3 ...)
  `CREATE REL TABLE IF NOT EXISTS NEXT (FROM Turn TO Turn, gap_ms INT64)`,

  // 턴이 spawn한 agent — root agent와 subagent 모두 연결.
  `CREATE REL TABLE IF NOT EXISTS SPAWNED (FROM Turn TO Agent)`,

  // Agent → ToolCall (직접 호출)
  `CREATE REL TABLE IF NOT EXISTS CALLED (FROM Agent TO ToolCall, sequence_no INT32)`,

  // ToolCall 트리 — parent_tool_use_id 기반. subagent 자식 tool_use도 포함.
  `CREATE REL TABLE IF NOT EXISTS PARENT_OF (FROM ToolCall TO ToolCall)`,

  // ToolCall → Event (pre/tool/post 다중 Event)
  `CREATE REL TABLE IF NOT EXISTS PRODUCED (FROM ToolCall TO Event)`,

  // ToolCall → MetaDocument (Skill/Agent/Command resolution)
  `CREATE REL TABLE IF NOT EXISTS USES (FROM ToolCall TO MetaDocument, resolution_cwd STRING)`,

  // Event → Badge (이상치/플래그)
  `CREATE REL TABLE IF NOT EXISTS CARRIES (FROM Event TO Badge)`,
];
