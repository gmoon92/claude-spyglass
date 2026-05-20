/**
 * Meta Document CRUD — Claude Code Behavior Definitions 카탈로그 (v24, Migration 024)
 *
 * 책임:
 *  - .claude/{agents,skills,commands} 디렉토리에서 발견된 Behavior Definitions 정의를
 *    DB에 보존 (multi-source row 모델 — 동일 이름이 여러 source에 있을 수 있음).
 *  - cwd → 호출 매핑(meta_doc_resolutions)을 함께 관리.
 *  - 집계 VIEW(v_meta_doc_usage)와 카탈로그를 LEFT JOIN한 결과 조회 함수 제공.
 *
 * 데이터 모델 (meta_documents 테이블):
 *  - type        : 'agent' | 'skill' | 'command'
 *  - name        : agentType / skill name / 슬래시 커맨드 이름
 *  - source      : 'built-in' | 'plugin' | 'userSettings' | 'projectSettings'
 *                  | 'policySettings' | 'bundled' | 'unknown'
 *  - source_root : project면 git root realpath, user면 ~/.claude 절대경로, 그 외 NULL
 *  - file_path   : .md 절대경로 (null = built-in/bundled)
 *  - description : frontmatter description 또는 첫 줄
 *  - user_invocable : skill의 user-invocable 플래그 (1/0)
 *  - frontmatter_json : 원본 frontmatter (JSON 직렬화)
 *  - first_seen_at / last_seen_at / deleted_at (ms)
 *
 * 호출자:
 *  - server/meta-docs/synchronizer.ts: upsert + soft delete
 *  - server/meta-docs/aggregator.ts:   listWithUsage 등 조회
 *  - server/routes/meta-docs.ts:       API 응답
 *
 * 의존성: bun:sqlite Database
 */

import type { Database } from 'bun:sqlite';

// =============================================================================
// 타입 정의
// =============================================================================

export type MetaDocType = 'agent' | 'skill' | 'command';

export type MetaDocSource =
  | 'built-in'
  | 'plugin'
  | 'userSettings'
  | 'projectSettings'
  | 'policySettings'
  | 'bundled'
  | 'unknown';

/** meta_documents 행 (스캔/upsert 단위). */
export interface MetaDocumentRow {
  id: number;
  type: MetaDocType;
  name: string;
  source: MetaDocSource;
  source_root: string | null;
  file_path: string | null;
  description: string | null;
  user_invocable: number;
  frontmatter_json: string | null;
  first_seen_at: number;
  last_seen_at: number;
  deleted_at: number | null;
}

/** 카탈로그 upsert 입력 — 스캐너가 만들어 주는 형태. */
export interface UpsertMetaDocParams {
  type: MetaDocType;
  name: string;
  source: MetaDocSource;
  source_root: string | null;
  file_path: string | null;
  description: string | null;
  user_invocable: boolean;
  frontmatter_json: string | null;
  /** 동기화 시각 (ms). last_seen_at 갱신 + deleted_at 클리어 키. */
  seen_at: number;
}

/** 카탈로그+집계 LEFT JOIN 결과 (UI 표 한 행). */
export interface MetaDocUsageRow {
  id: number | null;            // 카탈로그 미존재(=호출만 있고 카탈로그에 없음) 시 null
  type: MetaDocType;
  name: string;
  source: MetaDocSource | null;
  source_root: string | null;
  description: string | null;
  user_invocable: number | null;
  file_path: string | null;
  invocations: number;
  total_tokens: number;
  total_duration_ms: number;
  last_used_at: number | null;
  first_used_at: number | null;
  deleted_at: number | null;
}

// =============================================================================
// CRUD — 카탈로그
// =============================================================================

const SQL_UPSERT_META_DOC = `
  INSERT INTO meta_documents (
    type, name, source, source_root, file_path, description,
    user_invocable, frontmatter_json, first_seen_at, last_seen_at, deleted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT(type, name, source, source_root) DO UPDATE SET
    file_path        = excluded.file_path,
    description      = excluded.description,
    user_invocable   = excluded.user_invocable,
    frontmatter_json = excluded.frontmatter_json,
    last_seen_at     = excluded.last_seen_at,
    deleted_at       = NULL
  RETURNING id
`;

/**
 * Behavior Definitions 1건 upsert. 동일 (type,name,source,source_root)가 있으면
 * 메타 정보를 갱신하고 last_seen_at을 새로 찍으며 deleted_at을 NULL로 복원.
 *
 * @returns 해당 행의 id
 */
export function upsertMetaDocument(db: Database, params: UpsertMetaDocParams): number {
  const row = db.query(SQL_UPSERT_META_DOC).get(
    params.type,
    params.name,
    params.source,
    params.source_root,
    params.file_path,
    params.description,
    params.user_invocable ? 1 : 0,
    params.frontmatter_json,
    params.seen_at,
    params.seen_at,
  ) as { id: number } | null;

  if (!row) throw new Error('upsertMetaDocument: no row returned');
  return row.id;
}

/**
 * 특정 source(+선택적 source_root)에서 seen_at 이전에 발견됐던 행 중
 * 이번 스캔에서 갱신되지 않은 것을 soft delete.
 *
 * SessionStart 동기화 끝에 호출 — 카탈로그에서 사라진 파일을 deleted_at으로 마킹.
 */
export function markMissingAsDeleted(
  db: Database,
  filter: { source: MetaDocSource; source_root: string | null; before: number },
): number {
  const useNullRoot = filter.source_root === null;
  const sql = useNullRoot
    ? `UPDATE meta_documents
         SET deleted_at = ?
       WHERE source = ?
         AND source_root IS NULL
         AND deleted_at IS NULL
         AND last_seen_at < ?`
    : `UPDATE meta_documents
         SET deleted_at = ?
       WHERE source = ?
         AND source_root = ?
         AND deleted_at IS NULL
         AND last_seen_at < ?`;

  const now = Date.now();
  const result = useNullRoot
    ? db.query(sql).run(now, filter.source, filter.before)
    : db.query(sql).run(now, filter.source, filter.source_root, filter.before);

  return Number(result.changes ?? 0);
}

// =============================================================================
// CRUD — 해소 매핑
// =============================================================================

/**
 * 특정 cwd에 대한 resolution을 한 번에 교체.
 *
 * 기존 cwd의 (type, name) 매핑을 모두 삭제 → 새 매핑 일괄 INSERT.
 * SessionStart 동기화 끝에 호출.
 */
export function replaceResolutionsForCwd(
  db: Database,
  cwd: string,
  rows: Array<{ type: MetaDocType; name: string; meta_document_id: number }>,
): void {
  const tx = db.transaction(() => {
    db.query('DELETE FROM meta_doc_resolutions WHERE cwd = ?').run(cwd);
    if (rows.length === 0) return;
    const stmt = db.prepare(
      'INSERT INTO meta_doc_resolutions (cwd, type, name, meta_document_id) VALUES (?, ?, ?, ?)',
    );
    for (const r of rows) {
      stmt.run(cwd, r.type, r.name, r.meta_document_id);
    }
  });
  tx();
}

// =============================================================================
// 조회 — 카탈로그 + 사용 집계
// =============================================================================

export interface ListMetaDocsFilter {
  /** 카탈로그 source_root 매칭 (project 스코프 한정). 미지정 시 전체. */
  source_root?: string | null;
  /** 'agent' | 'skill' | 'command' 필터. */
  type?: MetaDocType;
  /** soft-deleted 포함 여부 (기본 false). */
  includeDeleted?: boolean;
}

/**
 * 카탈로그를 v_meta_doc_usage VIEW와 LEFT JOIN하여 한 표로 반환.
 *
 * - 카탈로그에만 있고 호출 0건 → invocations=0, last_used_at=null (정리 후보)
 * - 호출만 있고 카탈로그 미존재 → 카탈로그 컬럼이 null인 행 (id=null로 식별)
 * - source_root 필터: 'NULL' 의미가 글로벌이므로 함수 인자에서 'globalOnly' 키 따로 처리하지 않고
 *   호출자가 source_root='~/.claude' 같은 절대 경로를 넘기면 글로벌만 보임.
 */
export function listMetaDocsWithUsage(
  db: Database,
  filter: ListMetaDocsFilter = {},
): MetaDocUsageRow[] {
  // SQLite는 FULL OUTER JOIN을 지원 안 함 → LEFT JOIN + UNION ALL로 시뮬레이션.
  // 두 SELECT가 각자 자체 WHERE를 쓰기 때문에 파라미터를 두 번 바인딩해야 한다.
  const leftConds: string[] = [];
  const leftParams: (string | number)[] = [];

  if (!filter.includeDeleted) {
    leftConds.push('d.deleted_at IS NULL');
  }
  if (filter.type) {
    leftConds.push('d.type = ?');
    leftParams.push(filter.type);
  }
  if (filter.source_root !== undefined) {
    if (filter.source_root === null) {
      leftConds.push('d.source_root IS NULL');
    } else {
      leftConds.push('d.source_root = ?');
      leftParams.push(filter.source_root);
    }
  }
  const leftWhere = leftConds.length ? `WHERE ${leftConds.join(' AND ')}` : '';

  // UNION 뒤쪽(orphan 호출 — 카탈로그에 없음)은 type만 추가 필터로 적용.
  const orphanFilter = filter.type ? 'AND u.type = ?' : '';
  const orphanParams: (string | number)[] = filter.type ? [filter.type] : [];

  // source_root 필터가 있으면 orphan은 source 정보가 없으므로 매칭 불가 → 비활성.
  // (카탈로그에 없는 호출은 어디 source인지 모르므로 source_root 필터 시 자동 제외)
  const includeOrphans = filter.source_root === undefined;

  const sql = `
    SELECT
      d.id              AS id,
      d.type            AS type,
      d.name            AS name,
      d.source          AS source,
      d.source_root     AS source_root,
      d.description     AS description,
      d.user_invocable  AS user_invocable,
      d.file_path       AS file_path,
      COALESCE(u.invocations, 0)        AS invocations,
      COALESCE(u.total_tokens, 0)       AS total_tokens,
      COALESCE(u.total_duration_ms, 0)  AS total_duration_ms,
      u.last_used_at    AS last_used_at,
      u.first_used_at   AS first_used_at,
      d.deleted_at      AS deleted_at
    FROM meta_documents d
    LEFT JOIN v_meta_doc_usage u
      ON u.type = d.type AND u.name = d.name
    ${leftWhere}
    ${includeOrphans ? `
    UNION ALL
    SELECT
      NULL, u.type, u.name, NULL, NULL, NULL, NULL, NULL,
      u.invocations, u.total_tokens, u.total_duration_ms,
      u.last_used_at, u.first_used_at, NULL
    FROM v_meta_doc_usage u
    WHERE NOT EXISTS (
      SELECT 1 FROM meta_documents d2
       WHERE d2.type = u.type
         AND d2.name = u.name
         AND d2.deleted_at IS NULL
    )
    ${orphanFilter}
    ` : ''}
    ORDER BY invocations DESC, last_used_at DESC
  `;

  const allParams = includeOrphans ? [...leftParams, ...orphanParams] : leftParams;
  return db.query(sql).all(...allParams) as unknown as MetaDocUsageRow[];
}

/**
 * 카탈로그 단일 항목 조회 (file_path로 식별).
 * synchronizer가 mtime 비교 등에 쓸 수도 있어 노출.
 */
export function getMetaDocByFilePath(db: Database, filePath: string): MetaDocumentRow | null {
  const row = db.query('SELECT * FROM meta_documents WHERE file_path = ? LIMIT 1').get(filePath);
  return (row as MetaDocumentRow | null) ?? null;
}

/** 카탈로그 전체 카운트 (디버깅/헬스체크용). */
export function countMetaDocs(db: Database): { total: number; active: number; deleted: number } {
  const row = db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted
    FROM meta_documents
  `).get() as { total: number; active: number; deleted: number };
  return row;
}

// =============================================================================
// 호출 흐름 (Call Flow) — Behavior Definitions 메타 모드의 [Flow] 탭 (ADR meta-docs-flow 2026-05-21)
// =============================================================================
//
// 책임:
//  - 특정 project_name 범위의 requests를 시간 윈도우로 잘라
//    노드(트리거/커맨드/스킬/서브에이전트/도구) + 에지 카운트를 산출.
//  - 라우트 핸들러(routes/meta-docs.ts)가 받아 노드 좌표·시각 변형을 입혀
//    프론트(meta-docs-flow-view.js) 스키마로 매핑한다.
//
// 의존성:
//  - sessions(project_name) ← idx_sessions_project로 효율적 매칭.
//  - requests(turn_id, slash_command, tool_name, tool_detail, timestamp).
//
// 데이터 정의:
//  - 트리거 = 사용자 prompt 턴 = DISTINCT turn_id (시간 윈도우 내).
//  - 커맨드 = slash_command IS NOT NULL인 첫 행을 turn 시작점으로 간주.
//             동일 turn 내 다중 row가 있어도 DISTINCT(turn_id, slash_command)로 1회 카운트.
//  - 스킬   = tool_name='Skill' AND tool_detail IS NOT NULL.
//  - 서브에이전트 = tool_name='Agent' AND tool_detail IS NOT NULL.
//  - 도구   = type='tool_call' AND tool_name NOT IN ('Skill','Agent')
//             AND tool_name NOT LIKE 'mcp__%' (mcp는 별도 kind).
//  - MCP    = tool_name LIKE 'mcp__%'. 표시는 tool_name 그대로(과도한 가공 지양).
//
// 정렬:
//  - 모든 항목 count DESC. 라우트 핸들러가 topN(기본 5)으로 슬라이스해 카드 폭주를 막는다.

export interface MetaFlowAggregate {
  /** project_name 필터에 매칭된 turn(=DISTINCT turn_id) 수. 백분율 계산의 분모. */
  totalTurns: number;
  /** 슬래시 커맨드 사용 빈도. */
  commands: Array<{ name: string; turns: number }>;
  /** Skill 호출 빈도(invocations 기준). */
  skills:   Array<{ name: string; invocations: number }>;
  /** Agent 호출 빈도(invocations 기준). 메인 에이전트 ≠ 서브 에이전트 — 여기는 서브만 잡힌다. */
  agents:   Array<{ name: string; invocations: number }>;
  /** Read/Bash/Edit 등 내장 도구. */
  tools:    Array<{ name: string; invocations: number }>;
  /** MCP 도구. tool_name='mcp__<server>__<tool>' 그대로 노출. */
  mcps:     Array<{ name: string; invocations: number }>;
}

export interface MetaFlowFilter {
  /** sessions.project_name 매칭. null/undefined면 전체 합산. */
  project?: string | null;
  /** 시간 윈도우(일). 기본 7일. */
  windowDays?: number;
  /** 명시적 from/to 우선. 둘 다 주어지면 windowDays는 무시. */
  fromTs?: number;
  toTs?: number;
}

/**
 * 호출 흐름 집계 — Flow 탭의 노드/에지 위상에 필요한 raw count를 반환.
 *
 *  - 단일 함수에 5개 GROUP BY 쿼리를 묶어 한 번에 호출(라운드트립 최소화).
 *  - 빈 프로젝트/윈도우는 모든 배열이 빈 [] 로 채워져 반환되며 totalTurns=0.
 *  - 라우트 핸들러는 결과를 받아 좌표 산출 + 백분율 + nodes/edges로 변형한다.
 *
 * @returns MetaFlowAggregate — 라우트가 시각 스키마로 매핑하기 전 단계 데이터.
 */
export function getMetaFlowAggregate(db: Database, filter: MetaFlowFilter = {}): MetaFlowAggregate {
  const windowDays = filter.windowDays && filter.windowDays > 0 ? filter.windowDays : 7;
  const nowMs = Date.now();
  const fromTs = filter.fromTs ?? (filter.toTs ?? nowMs) - windowDays * 24 * 60 * 60 * 1000;
  const toTs   = filter.toTs   ?? nowMs;

  // 공통 WHERE 조각 — requests 행이 매칭해야 할 조건.
  //   - project 필터는 session_id IN (SELECT id FROM sessions WHERE project_name=?) 패턴(SSoT: getProjectToolStats).
  //   - 시간 윈도우는 timestamp 양 끝 inclusive.
  const projectClause = filter.project
    ? 'AND session_id IN (SELECT id FROM sessions WHERE project_name = ?)'
    : '';
  const projectParam: string[] = filter.project ? [filter.project] : [];

  // turn 분모 — DISTINCT turn_id. tool_call/prompt 무관하게 turn_id가 있는 행을 기준으로 잡는다.
  const totalTurnsRow = db.query(`
    SELECT COUNT(DISTINCT turn_id) AS turns
    FROM requests
    WHERE turn_id IS NOT NULL
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
  `).get(fromTs, toTs, ...projectParam) as { turns: number } | null;

  const commands = db.query(`
    SELECT slash_command AS name, COUNT(DISTINCT turn_id) AS turns
    FROM requests
    WHERE slash_command IS NOT NULL AND slash_command != ''
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
    GROUP BY slash_command
    ORDER BY turns DESC
  `).all(fromTs, toTs, ...projectParam) as Array<{ name: string; turns: number }>;

  const skills = db.query(`
    SELECT tool_detail AS name, COUNT(*) AS invocations
    FROM requests
    WHERE tool_name = 'Skill' AND tool_detail IS NOT NULL
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
    GROUP BY tool_detail
    ORDER BY invocations DESC
  `).all(fromTs, toTs, ...projectParam) as Array<{ name: string; invocations: number }>;

  const agents = db.query(`
    SELECT tool_detail AS name, COUNT(*) AS invocations
    FROM requests
    WHERE tool_name = 'Agent' AND tool_detail IS NOT NULL
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
    GROUP BY tool_detail
    ORDER BY invocations DESC
  `).all(fromTs, toTs, ...projectParam) as Array<{ name: string; invocations: number }>;

  // 내장 도구 — Skill/Agent/MCP를 제외한 tool_call.
  const tools = db.query(`
    SELECT tool_name AS name, COUNT(*) AS invocations
    FROM requests
    WHERE type = 'tool_call'
      AND tool_name IS NOT NULL
      AND tool_name NOT IN ('Skill', 'Agent')
      AND tool_name NOT LIKE 'mcp__%'
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
    GROUP BY tool_name
    ORDER BY invocations DESC
  `).all(fromTs, toTs, ...projectParam) as Array<{ name: string; invocations: number }>;

  const mcps = db.query(`
    SELECT tool_name AS name, COUNT(*) AS invocations
    FROM requests
    WHERE tool_name LIKE 'mcp__%'
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
    GROUP BY tool_name
    ORDER BY invocations DESC
  `).all(fromTs, toTs, ...projectParam) as Array<{ name: string; invocations: number }>;

  return {
    totalTurns: totalTurnsRow?.turns ?? 0,
    commands,
    skills,
    agents,
    tools,
    mcps,
  };
}

// =============================================================================
// Meta Flow Ego-Graph — 단일 메타 문서 중심 공출현 집계 (v24+)
// =============================================================================
//
// 책임:
//  - 특정 메타 문서(슬래시 커맨드 / 스킬 / 서브에이전트) 하나를 "중심"으로 잡고,
//    동일 turn에 함께 등장한 다른 메타 문서·도구·MCP 사용 빈도를 산출한다.
//  - 라우트 핸들러(routes/meta-docs.ts)가 받아 nodes/edges 시각 스키마로 매핑한다.
//
// 데이터 정의:
//  - centerTurns = (centerType, centerName)이 발견된 DISTINCT turn_id 집합 (시간 윈도우 + project 필터).
//      • command : slash_command = centerName
//      • skill   : tool_name='Skill' AND tool_detail=centerName
//      • agent   : tool_name='Agent' AND tool_detail=centerName
//  - triggers     = centerTurns 안에서 발견된 slash_command (center가 command면 자기 자신 제외).
//  - cooccurrence = centerTurns 안의 Skill/Agent/일반 도구/MCP 항목 (center와 같은 항목은 제외).
//  - pct          = 각 항목 / centerTurns 비율 (백분율, 소수 첫째자리는 라우트에서 가공).
//
// 정렬:
//  - 모든 배열 invocations(또는 turns) DESC. 라우트가 topN(기본 5)으로 슬라이스.

/** ego-graph의 중심으로 클릭 가능한 메타 문서 타입. */
export type MetaFlowEgoCenterType = 'command' | 'skill' | 'agent';

export interface MetaFlowEgoFilter {
  centerType: MetaFlowEgoCenterType;
  /** 중심 노드 이름 — slash_command 이름 또는 tool_detail(스킬/에이전트 이름). */
  centerName: string;
  /** sessions.project_name 필터. null/undefined면 전체. */
  project?: string | null;
  /** 시간 윈도우(일). 기본 7. */
  windowDays?: number;
  /** 명시적 from/to가 주어지면 windowDays 무시. */
  fromTs?: number;
  toTs?: number;
}

/** ego-graph spoke — 중심 주변 노드 단위. */
export interface MetaFlowEgoSpoke {
  name: string;
  /** 호출 횟수(공출현 turn 내 행 수, 도구는 무한 가능). triggers는 turns로 의미 매핑. */
  count: number;
  /** centerTurns 분모 대비 비율(0~1, 소수). 라우트가 %로 가공. */
  pct: number;
}

export interface MetaFlowEgo {
  center: {
    type: MetaFlowEgoCenterType;
    name: string;
    /** 중심이 발견된 DISTINCT turn 수. 공출현 비율 분모. */
    turns: number;
  };
  /** 동일 윈도우의 전체 DISTINCT turn 수(centerTurns가 아닌 분모와 대조 용도). */
  totalTurns: number;
  /** 중심 turn 집합 안에서 함께 발화된 슬래시 커맨드(좌측 spokes). */
  triggers: MetaFlowEgoSpoke[];
  /** 중심 turn 집합 안에서 함께 호출된 항목들(우측 spokes). */
  cooccurrence: {
    skills: MetaFlowEgoSpoke[];
    agents: MetaFlowEgoSpoke[];
    tools:  MetaFlowEgoSpoke[];
    mcps:   MetaFlowEgoSpoke[];
  };
}

/**
 * 단일 메타 문서를 중심으로 한 공출현 집계.
 *
 *  - 1차 쿼리: centerTurns(turn_id 집합)와 그 카운트를 구함.
 *  - 2차 쿼리: 5종(GROUP BY) 모두 turn_id IN (centerTurns subquery)로 좁힘.
 *  - 자기 자신은 동일 종류에서 제외(중심 카드와 spoke가 중복되지 않도록).
 *  - centerTurns=0이면 모든 spoke 배열이 [] 이고 turns/pct=0.
 *
 * @returns MetaFlowEgo — 라우트가 노드/에지로 매핑하기 전 단계 데이터.
 */
export function getMetaFlowEgo(db: Database, filter: MetaFlowEgoFilter): MetaFlowEgo {
  const windowDays = filter.windowDays && filter.windowDays > 0 ? filter.windowDays : 7;
  const nowMs = Date.now();
  const fromTs = filter.fromTs ?? (filter.toTs ?? nowMs) - windowDays * 24 * 60 * 60 * 1000;
  const toTs   = filter.toTs   ?? nowMs;

  // 공통 시간 + project 필터 조각.
  const projectClause = filter.project
    ? 'AND session_id IN (SELECT id FROM sessions WHERE project_name = ?)'
    : '';
  const projectParam: string[] = filter.project ? [filter.project] : [];

  // ── 1) center가 발견된 turn_id 집합 + 카운트 ──────────────────────────────
  // centerType별로 매칭 컬럼이 다르므로 분기.
  let centerWhere = '';
  const centerParams: (string | number)[] = [];
  if (filter.centerType === 'command') {
    centerWhere = `slash_command = ?`;
    centerParams.push(filter.centerName);
  } else if (filter.centerType === 'skill') {
    centerWhere = `tool_name = 'Skill' AND tool_detail = ?`;
    centerParams.push(filter.centerName);
  } else {
    centerWhere = `tool_name = 'Agent' AND tool_detail = ?`;
    centerParams.push(filter.centerName);
  }

  const centerTurnsSql = `
    SELECT DISTINCT turn_id
    FROM requests
    WHERE ${centerWhere}
      AND turn_id IS NOT NULL
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
  `;
  const centerTurnsArgs = [...centerParams, fromTs, toTs, ...projectParam];

  const centerTurnsRow = db.query(`
    SELECT COUNT(*) AS turns FROM (${centerTurnsSql})
  `).get(...centerTurnsArgs) as { turns: number } | null;
  const centerTurns = centerTurnsRow?.turns ?? 0;

  // ── 전체 turn 수(같은 윈도우/프로젝트) — 참고용 ────────────────────────────
  const totalTurnsRow = db.query(`
    SELECT COUNT(DISTINCT turn_id) AS turns
    FROM requests
    WHERE turn_id IS NOT NULL
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
  `).get(fromTs, toTs, ...projectParam) as { turns: number } | null;
  const totalTurns = totalTurnsRow?.turns ?? 0;

  // ── 빈 ego — 중심 발견 0회 ─────────────────────────────────────────────────
  if (centerTurns === 0) {
    return {
      center: { type: filter.centerType, name: filter.centerName, turns: 0 },
      totalTurns,
      triggers: [],
      cooccurrence: { skills: [], agents: [], tools: [], mcps: [] },
    };
  }

  // pct 헬퍼 — centerTurns 분모 (0이 아님은 위에서 보장).
  const toPct = (n: number) => centerTurns > 0 ? n / centerTurns : 0;

  // ── 2) triggers — 같은 turn에서 발화된 slash_command ──────────────────────
  const triggersSelfFilter = filter.centerType === 'command'
    ? 'AND slash_command != ?'
    : '';
  const triggersSelfParam = filter.centerType === 'command' ? [filter.centerName] : [];
  const triggersRows = db.query(`
    SELECT slash_command AS name, COUNT(DISTINCT turn_id) AS turns
    FROM requests
    WHERE slash_command IS NOT NULL AND slash_command != ''
      AND turn_id IN (${centerTurnsSql})
      ${triggersSelfFilter}
    GROUP BY slash_command
    ORDER BY turns DESC
  `).all(...centerTurnsArgs, ...triggersSelfParam) as Array<{ name: string; turns: number }>;
  const triggers: MetaFlowEgoSpoke[] = triggersRows.map(r => ({
    name: r.name,
    count: r.turns,
    pct: toPct(r.turns),
  }));

  // ── 3) cooccurrence — skills/agents/tools/mcps (turn_id IN center subquery) ──
  const skillsSelfFilter = filter.centerType === 'skill' ? 'AND tool_detail != ?' : '';
  const skillsSelfParam  = filter.centerType === 'skill' ? [filter.centerName]   : [];
  const skillsRows = db.query(`
    SELECT tool_detail AS name, COUNT(*) AS invocations
    FROM requests
    WHERE tool_name = 'Skill' AND tool_detail IS NOT NULL
      AND turn_id IN (${centerTurnsSql})
      ${skillsSelfFilter}
    GROUP BY tool_detail
    ORDER BY invocations DESC
  `).all(...centerTurnsArgs, ...skillsSelfParam) as Array<{ name: string; invocations: number }>;

  const agentsSelfFilter = filter.centerType === 'agent' ? 'AND tool_detail != ?' : '';
  const agentsSelfParam  = filter.centerType === 'agent' ? [filter.centerName]   : [];
  const agentsRows = db.query(`
    SELECT tool_detail AS name, COUNT(*) AS invocations
    FROM requests
    WHERE tool_name = 'Agent' AND tool_detail IS NOT NULL
      AND turn_id IN (${centerTurnsSql})
      ${agentsSelfFilter}
    GROUP BY tool_detail
    ORDER BY invocations DESC
  `).all(...centerTurnsArgs, ...agentsSelfParam) as Array<{ name: string; invocations: number }>;

  const toolsRows = db.query(`
    SELECT tool_name AS name, COUNT(*) AS invocations
    FROM requests
    WHERE type = 'tool_call'
      AND tool_name IS NOT NULL
      AND tool_name NOT IN ('Skill', 'Agent')
      AND tool_name NOT LIKE 'mcp__%'
      AND turn_id IN (${centerTurnsSql})
    GROUP BY tool_name
    ORDER BY invocations DESC
  `).all(...centerTurnsArgs) as Array<{ name: string; invocations: number }>;

  const mcpsRows = db.query(`
    SELECT tool_name AS name, COUNT(*) AS invocations
    FROM requests
    WHERE tool_name LIKE 'mcp__%'
      AND turn_id IN (${centerTurnsSql})
    GROUP BY tool_name
    ORDER BY invocations DESC
  `).all(...centerTurnsArgs) as Array<{ name: string; invocations: number }>;

  const toSpoke = (r: { name: string; invocations: number }): MetaFlowEgoSpoke => ({
    name: r.name,
    count: r.invocations,
    pct: toPct(r.invocations),
  });

  return {
    center: { type: filter.centerType, name: filter.centerName, turns: centerTurns },
    totalTurns,
    triggers,
    cooccurrence: {
      skills: skillsRows.map(toSpoke),
      agents: agentsRows.map(toSpoke),
      tools:  toolsRows.map(toSpoke),
      mcps:   mcpsRows.map(toSpoke),
    },
  };
}
