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
  /**
   * 사용 집계 시간 윈도우(Unix ms). 둘 중 하나라도 지정되면 v_meta_doc_usage VIEW 대신
   * requests 테이블 인라인 GROUP BY로 invocations/tokens/last_used_at을 산출한다.
   * 미지정 시 전체 기간(VIEW 사용).
   *
   * meta-docs-date-range-filter (2026-05-21): 카탈로그 영역이 글로벌 date-range 필터에
   * 무관하게 노출되던 회귀를 수정. 화면 상단 #dateFilter가 발행하는 active-range를
   * 라우트 → 본 함수까지 전파한다.
   */
  fromTs?: number;
  toTs?: number;
  /**
   * 사용 집계 project_name 필터. 주어지면 sessions JOIN으로 좁혀
   * 해당 project_name 세션의 호출만 invocations/last_used_at 집계에 합산한다.
   *
   * meta-docs-project-filter-parity (2026-05-21):
   *   기존에는 ego-graph(getMetaFlowEgo)만 project 필터를 적용하고 카탈로그는
   *   sessions JOIN 없이 전체 집계를 노출해, 사이드바 project 필터가 켜진 상태에서
   *   카탈로그 invocations와 ego-graph centerTurns가 어긋나는 모순이 있었다.
   *   (대표 케이스: orphan session 호출이 카탈로그에는 2회로 잡히지만 ego-graph는
   *    0턴 안내로 빠지는 현상.)
   *   project가 지정되면 sessions에 매칭되지 않는 orphan session 호출은 카탈로그에서도
   *   제외되어 두 화면이 동일 집계를 보인다.
   *   미지정 시 sessions JOIN 없이 전체 호출을 그대로 집계(=기존 동작).
   */
  project?: string;
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

  // meta-docs-date-range-filter (2026-05-21):
  //   filter.fromTs/toTs 중 하나라도 주어지면 v_meta_doc_usage VIEW(=전체 기간 집계) 대신
  //   인라인 GROUP BY 서브쿼리를 사용해 시간 윈도우로 좁힌다.
  //   - VIEW의 컬럼 셰이프(type/name/invocations/total_tokens/total_duration_ms/
  //     last_used_at/first_used_at)와 동일하게 맞춰서 호출부 SQL은 변경 없이 사용.
  //   - usageParams는 인라인 사용 시 'fromTs ≤ timestamp ≤ toTs' 바인딩에 사용된다.
  //
  // meta-docs-project-filter-parity (2026-05-21):
  //   filter.project가 주어지면 위 VIEW는 sessions JOIN을 지원하지 않으므로 동일하게
  //   인라인 경로로 강제 전환하고, 각 분기 WHERE에 sessions(project_name=?) 제약을 끼운다.
  //   project만 주어지고 range는 없는 경우에도 인라인 경로를 타며, 이때 timestamp 절은
  //   [0, MAX_SAFE_INTEGER] 로 사실상 무효화된다.
  const hasRange = filter.fromTs !== undefined || filter.toTs !== undefined;
  const hasProject = filter.project !== undefined && filter.project !== '';
  const useInline = hasRange || hasProject;
  const rangeFrom = filter.fromTs !== undefined ? filter.fromTs : 0;
  const rangeTo   = filter.toTs   !== undefined ? filter.toTs   : Number.MAX_SAFE_INTEGER;
  const projectClause = hasProject
    ? 'AND session_id IN (SELECT id FROM sessions WHERE project_name = ?)'
    : '';
  // VIEW와 동일한 union — 'agent'/'skill'/'command' 3 분기.
  //   range 절은 각 SELECT의 WHERE에 적용되어 GROUP BY 결과가 시간 윈도우 안으로 좁혀진다.
  //   project 절은 동일 자리에 sessions JOIN 으로 들어가 사이드바 project 필터와
  //   ego-graph 의 session 제약을 일치시킨다.
  const usageInlineSql = useInline ? `(
    SELECT 'agent' AS type, tool_detail AS name,
      COUNT(*) AS invocations,
      COALESCE(SUM(tokens_total), 0)  AS total_tokens,
      COALESCE(SUM(duration_ms),  0)  AS total_duration_ms,
      MAX(timestamp) AS last_used_at,
      MIN(timestamp) AS first_used_at
    FROM requests
    WHERE tool_name = 'Agent' AND tool_detail IS NOT NULL
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
    GROUP BY tool_detail
    UNION ALL
    SELECT 'skill', tool_detail, COUNT(*),
      COALESCE(SUM(tokens_total), 0),
      COALESCE(SUM(duration_ms),  0),
      MAX(timestamp), MIN(timestamp)
    FROM requests
    WHERE tool_name = 'Skill' AND tool_detail IS NOT NULL
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
    GROUP BY tool_detail
    UNION ALL
    SELECT 'command', slash_command, COUNT(*),
      COALESCE(SUM(tokens_total), 0),
      COALESCE(SUM(duration_ms),  0),
      MAX(timestamp), MIN(timestamp)
    FROM requests
    WHERE slash_command IS NOT NULL AND slash_command != ''
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
    GROUP BY slash_command
  )` : 'v_meta_doc_usage';
  // 인라인 SQL은 3 분기 × (from, to, project?) 파라미터 = useInline 시 6~9개. LEFT JOIN과
  // orphan SELECT에서 각각 한 번씩 바인딩해야 한다(같은 서브쿼리가 두 번 등장).
  const branchParams: (string | number)[] = hasProject
    ? [rangeFrom, rangeTo, filter.project!, rangeFrom, rangeTo, filter.project!, rangeFrom, rangeTo, filter.project!]
    : [rangeFrom, rangeTo, rangeFrom, rangeTo, rangeFrom, rangeTo];
  const usageRangeParams: (string | number)[] = useInline ? branchParams : [];

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
    LEFT JOIN ${usageInlineSql} u
      ON u.type = d.type AND u.name = d.name
    ${leftWhere}
    ${includeOrphans ? `
    UNION ALL
    SELECT
      NULL, u.type, u.name, NULL, NULL, NULL, NULL, NULL,
      u.invocations, u.total_tokens, u.total_duration_ms,
      u.last_used_at, u.first_used_at, NULL
    FROM ${usageInlineSql} u
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

  // 바인딩 순서:
  //   1) LEFT JOIN의 usageInlineSql 파라미터 (useInline 시 range만이면 6개, project까지면 9개)
  //   2) 카탈로그 LEFT 조건 (type/source_root)
  //   3) (orphan) usageInlineSql 파라미터 (1)과 동일 크기로 한 번 더)
  //   4) (orphan) type 필터 파라미터
  const allParams: (string | number)[] = [
    ...usageRangeParams,
    ...leftParams,
    ...(includeOrphans ? usageRangeParams : []),
    ...(includeOrphans ? orphanParams : []),
  ];
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

  // 내장 도구 — Skill/Agent/MCP/내장 도구 denylist 제외한 tool_call.
  // denylist 적용 이유: 위 TOOL_DENYLIST 주석 참고.
  const tools = db.query(`
    SELECT tool_name AS name, COUNT(*) AS invocations
    FROM requests
    WHERE type = 'tool_call'
      AND tool_name IS NOT NULL
      AND tool_name NOT IN ('Skill', 'Agent')
      AND tool_name NOT LIKE 'mcp__%'
      AND tool_name NOT IN (${TOOL_DENYLIST_PLACEHOLDERS})
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
    GROUP BY tool_name
    ORDER BY invocations DESC
  `).all(...TOOL_DENYLIST_PARAMS, fromTs, toTs, ...projectParam) as Array<{ name: string; invocations: number }>;

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
// Meta Flow Ego-Graph — 단일 메타 문서 중심 BFS 호출 트리 (depth ≤ 3, meta-docs-flow-tree)
// =============================================================================
//
// 책임:
//  - 특정 메타 문서(슬래시 커맨드 / 스킬 / 서브에이전트) 하나를 "중심"으로 잡고,
//    parent_tool_use_id 체인을 BFS로 따라가며 직접 호출된 자식 트리(최대 3단)를
//    수집한다. "공출현(같은 turn에 등장)"이 아니라 "실제 호출 입증" 만 노출한다.
//  - 라우트 핸들러(routes/meta-docs.ts)가 받아 depth 컬럼 + nodes/edges 시각
//    스키마로 매핑한다.
//
// 데이터 정의:
//  - centerSeed = (centerType, centerName) 매칭 행의 tool_use_id 집합
//      • command : slash_command = centerName  (Migration 037으로 tool_use_id='slash:'||turn_id 부여)
//      • skill   : tool_name='Skill' AND tool_detail = centerName
//      • agent   : tool_name='Agent' AND tool_detail = centerName
//  - frontier(d) = depth d-1에서 새로 추가된 자식들의 tool_use_id 집합
//  - children(d) = parent_tool_use_id IN frontier(d) 인 requests 행 — 이 중 분류된 (kind,name)을
//                  카탈로그 화이트리스트로 통과시켜 노드/엣지에 누적
//  - centerTurns = 중심이 등장한 DISTINCT turn_id 수 (백분율 분모)
//
// 카탈로그 화이트리스트:
//  - kind='skill' / kind='agent' → meta_documents(type, name, deleted_at IS NULL) 매칭만 통과
//  - kind='mcp' → 무조건 통과 (외부 서버 도구는 meta_documents에 등록되지 않음)
//  - kind='tool' → 전체 제외 (내장 도구는 메타 문서가 아니라는 사용자 정책)
//
// 트리 dedup:
//  - 노드 키 = (kind, name) — 동일 자식이 여러 부모로부터 호출되면 가장 얕은 depth에 1개만 보존,
//    count는 distinct turn 수.
//  - 엣지 키 = (fromKind, fromName, toKind, toName) — 같은 부모→자식 호출도 distinct turn count.
//  - self 호출 제외 — center 자신과 동일 (kind, name)은 결과에서 제거.
//  - 사슬 보존(transit): 카탈로그 미등록 skill/agent, 내장 도구(Bash/Read/...)는 노드/엣지에
//    포함되지 않지만 frontier는 통과시켜 그 아래/위 실제 메타 문서까지 추적한다.
//  - 깊이 상한 = BFS_MAX_DEPTH (32) — 사실상 무제한, 무한 루프/사이클 방어용 안전 상한.

const BFS_MAX_DEPTH = 32;

/** SQLite IN(?,?,...) placeholder 폭주 방지용 chunk 크기. */
const BFS_FRONTIER_CHUNK = 800;

//
// Tool 컬럼 denylist:
//   getMetaFlowAggregate의 도구 카테고리는 거의 모든 turn에 등장하는 Claude Code
//   내장 도구(Read/Edit/Bash 등)로 채워져 시각적 노이즈가 심하다. 호출 흐름을 보고
//   싶은 사용자에게는 의미가 없으므로 쿼리 단계에서 제외해 불필요한 행을 가져오지
//   않는다. multi-agent 조정용 도구(TaskUpdate/TaskCreate/TaskGet)와 Skill/Agent/
//   MCP는 별도 컬럼이므로 본 denylist의 영향을 받지 않는다.
const TOOL_DENYLIST = [
  'Bash',
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'MultiEdit',
  'NotebookEdit',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
] as const;

/** SQL IN (...) placeholders + bind values for TOOL_DENYLIST. */
const TOOL_DENYLIST_PLACEHOLDERS = TOOL_DENYLIST.map(() => '?').join(',');
const TOOL_DENYLIST_PARAMS: readonly string[] = TOOL_DENYLIST;

/** ego-graph의 중심으로 클릭 가능한 메타 문서 타입. */
export type MetaFlowEgoCenterType = 'command' | 'skill' | 'agent';

/** 호출 트리 노드 카테고리. center 자신도 동일 어휘를 공유. */
export type MetaFlowEgoNodeKind = 'command' | 'skill' | 'agent' | 'tool' | 'mcp';

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

/**
 * 호출 트리 노드 — center 의 양방향 BFS + 같은 턴 후속.
 *
 * depth 부호 약속:
 *   - 음수(-1..-BFS_MAX_DEPTH): center 를 호출한 부모 체인 (parent_tool_use_id 위로)
 *   - 0: center 자신은 노드 목록에 포함되지 않음 (라우트가 별도 매핑)
 *   - 양수(1..BFS_MAX_DEPTH): center 가 호출한 자식 (parent_tool_use_id 아래로)
 *
 * depth 는 "실제 메타 문서 사슬상의 깊이" — transit(미등록/내장 도구)은 카운트하지 않는다.
 *   예) center → Bash → skill A 인 경우, A 의 depth = 1.
 *
 * timeline === 'after' 는 호출 인과 사슬과 무관하게 "같은 turn 안 center 이후 시점" 메타 문서.
 * depth 값은 어떤 의미도 없으므로 0 으로 둔다 (라우트가 timeline 으로 컬럼 결정).
 *
 * dedup 규칙:
 *   - 자식 컬럼(양수 depth) 내부: 가장 얕은 depth 1개만.
 *   - 부모 컬럼(음수 depth) 내부: 같은 약속.
 *   - 자식 ↔ 부모: 별도 컬럼이라 양쪽 등장 허용(루프 시각화 의미).
 *   - timeline='after' ↔ 자식/부모: 같은 (kind,name) 이면 인과 표현 우선, after 제거.
 */
export interface MetaFlowEgoNode {
  kind: MetaFlowEgoNodeKind;
  name: string;
  /** 실제 메타 문서 사슬상의 깊이. 음수는 부모, 양수는 자식. 0은 center(노드 목록 미포함). */
  depth: number;
  /** 'after' 면 같은 턴 후속 노드(시간 흐름). null 이면 호출 인과 노드. */
  timeline: 'after' | null;
  /** distinct turn count — 이 노드가 등장한 turn_id 수. */
  count: number;
  /** count / centerTurns (0~1, 소수). 모든 노드 단위가 distinct turn count 라 % ≤ 100 보장. */
  pct: number;
}

/** 호출 트리 엣지 — 부모→자식 호출 인과 또는 같은 턴 시간 흐름. */
export interface MetaFlowEgoEdge {
  fromKind: MetaFlowEgoNodeKind;
  fromName: string;
  toKind: MetaFlowEgoNodeKind;
  toName: string;
  /** 'call' = parent_tool_use_id 인과, 'turn-flow' = 같은 턴 timestamp 순서. */
  relation: 'call' | 'turn-flow';
  /** distinct turn count — 이 (from, to) 쌍이 등장한 turn_id 수. */
  count: number;
}

export interface MetaFlowEgo {
  center: {
    type: MetaFlowEgoCenterType;
    name: string;
    /** 중심이 발견된 DISTINCT turn 수. 분모. */
    turns: number;
    /** 중심 row 총 호출 수 (COUNT(*)) — v_meta_doc_usage.invocations 와 동일 단위. */
    invocations: number;
  };
  /** 동일 윈도우의 전체 DISTINCT turn 수(centerTurns와 비교용). */
  totalTurns: number;
  /**
   * 양방향 BFS 호출 트리 + 같은 턴 시간 후속.
   *
   * - nodes 는 (kind, name) dedup. center 자신은 포함되지 않는다.
   * - edges 는 (from, to, relation) 쌍 단위 dedup. 다이아몬드는 노드 1개 + 엣지 N개.
   * - centerTurns=0 이면 nodes/edges 모두 빈 배열.
   * - transit(미등록 skill/agent, 내장 도구)은 노드로 노출되지 않지만 사슬은 보존된다.
   * - 깊이는 BFS_MAX_DEPTH(32) 까지 — 그 이상은 무한 루프 방어를 위해 절단.
   */
  callTree: {
    nodes: MetaFlowEgoNode[];
    edges: MetaFlowEgoEdge[];
  };
}

/**
 * 단일 메타 문서를 중심으로 한 BFS 호출 트리 (depth ≤ 3).
 *
 *  - 1차 쿼리: centerTurns(분모)와 center seed tool_use_id 집합 수집.
 *  - 2차+ BFS: parent_tool_use_id IN frontier 자식을 depth 1~3까지 반복 조회.
 *  - 카탈로그 화이트리스트: skill/agent는 meta_documents 등록 이름만, mcp는 전부 통과, tool은 제외.
 *  - 자기 자신(center kind+name) 자식 제외, (kind,name) 단위 dedup(가장 얕은 depth 보존).
 *  - centerTurns=0이면 callTree 빈 배열로 반환.
 *
 * @returns MetaFlowEgo — 라우트가 depth 컬럼/엣지로 매핑하기 전 단계 데이터.
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

  // ── 1) center 매칭 조건 ──────────────────────────────────────────────────
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

  // centerTurns 분모 — 동일 윈도우/프로젝트 내 중심이 등장한 DISTINCT turn 수.
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

  // centerInvocations — 중심 매칭 row 총 호출 수(COUNT(*)). v_meta_doc_usage.invocations 와 동일 단위.
  //   distinct turn(centerTurns)과 차이가 나는 경우(같은 turn 안 다중 호출)를 UI 가
  //   "11 calls / 10 turns" 형태로 동시 노출할 수 있도록 두 값을 모두 반환한다.
  const centerInvocationsRow = db.query(`
    SELECT COUNT(*) AS n
    FROM requests
    WHERE ${centerWhere}
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
  `).get(...centerParams, fromTs, toTs, ...projectParam) as { n: number } | null;
  const centerInvocations = centerInvocationsRow?.n ?? 0;

  // 전체 turn 수(참고용).
  const totalTurnsRow = db.query(`
    SELECT COUNT(DISTINCT turn_id) AS turns
    FROM requests
    WHERE turn_id IS NOT NULL
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
  `).get(fromTs, toTs, ...projectParam) as { turns: number } | null;
  const totalTurns = totalTurnsRow?.turns ?? 0;

  // 빈 ego — 중심 발견 0회.
  if (centerTurns === 0) {
    return {
      center: {
        type: filter.centerType,
        name: filter.centerName,
        turns: 0,
        invocations: centerInvocations,
      },
      totalTurns,
      callTree: { nodes: [], edges: [] },
    };
  }

  // pct 헬퍼 — centerTurns 분모 (0이 아님은 위에서 보장).
  const toPct = (n: number) => centerTurns > 0 ? n / centerTurns : 0;

  // ── 2) BFS 호출 트리 (양방향 + 같은 턴 후속) ─────────────────────────────
  // 카탈로그 화이트리스트 — JS Set으로 한 번만 로드해 BFS 루프에서 O(1) 조회.
  const skillCatalog = new Set<string>(
    (db.query(`SELECT DISTINCT name FROM meta_documents WHERE type='skill' AND deleted_at IS NULL`)
      .all() as Array<{ name: string }>).map(r => r.name),
  );
  const agentCatalog = new Set<string>(
    (db.query(`SELECT DISTINCT name FROM meta_documents WHERE type='agent' AND deleted_at IS NULL`)
      .all() as Array<{ name: string }>).map(r => r.name),
  );

  // center seed — 중심 매칭 행들의 tool_use_id 집합.
  //   command : Migration 037 이후 'slash:'||turn_id 가 부여되어 있어야 정상.
  //   skill/agent : anthropic toolu_* (PreToolUseHandler가 채움).
  const centerSeedRows = db.query(`
    SELECT DISTINCT tool_use_id FROM requests
    WHERE ${centerWhere}
      AND tool_use_id IS NOT NULL
      AND timestamp >= ? AND timestamp <= ?
      ${projectClause}
  `).all(...centerParams, fromTs, toTs, ...projectParam) as Array<{ tool_use_id: string }>;

  // ── 사슬 보존 정책 ──────────────────────────────────────────────────────
  // chainRef = tool_use_id 가 BFS 사슬상 가장 가까운 "실제 메타 문서" 조상의 참조.
  //   - 실제 메타 문서(분류 통과)인 행은 자신의 (kind, name, depth) 를 저장.
  //   - transit 행(미등록 skill/agent, 내장 도구)은 부모의 chainRef 를 그대로 상속.
  //   - 자식 행은 이 chainRef 를 부모로 사용해 엣지를 만들고, depth = parent.depth ± 1.
  //   ⇒ 사슬 중간에 transit 가 있어도 메타 문서 노드끼리 정확히 이어진다.
  type ChainRef = {
    readonly kind: MetaFlowEgoNodeKind;
    readonly name: string;
    readonly depth: number;
  };
  const centerChainRef: ChainRef = { kind: filter.centerType, name: filter.centerName, depth: 0 };
  // 자식 방향(center → child): 양수 depth 진행. depth=0 = center.
  const childChainMap = new Map<string, ChainRef>();
  // 부모 방향(parent → center): 음수 depth 진행. depth=0 = center.
  const parentChainMap = new Map<string, ChainRef>();
  for (const r of centerSeedRows) {
    childChainMap.set(r.tool_use_id, centerChainRef);
    parentChainMap.set(r.tool_use_id, centerChainRef);
  }

  // 노드/엣지 누적 — (kind,name) / (parent,child) 단위 dedup. count = distinct turn 수.
  const nodeKey = (k: string, n: string) => `${k}${n}`;
  const edgeKey = (fk: string, fn: string, tk: string, tn: string) =>
    `${fk}${fn}${tk}${tn}`;
  const nodeMap = new Map<string, MetaFlowEgoNode>();
  const edgeMap = new Map<string, MetaFlowEgoEdge>();
  // turn-set 추적 — finalize 단계에서 count = turnSet.size 로 환산.
  const nodeTurnSet = new Map<string, Set<string>>();
  const edgeTurnSet = new Map<string, Set<string>>();

  // dedup 네임스페이스 — 자식 / 부모 / turn-after 가 같은 (kind,name) 으로 충돌하지 않게 prefix 부여.
  //   자식 ↔ 부모: 별도 컬럼이라 양쪽 등장 허용(루프 시각화).
  //   turn-after: 자식/부모와 이름 동일 시 인과 표현 우선 정책으로 제외(나중 단계에서 체크).
  const childNodeKey  = (k: string, n: string) => 'child:'  + nodeKey(k, n);
  const parentNodeKey = (k: string, n: string) => 'parent:' + nodeKey(k, n);
  const afterNodeKey  = (k: string, n: string) => 'after:'  + nodeKey(k, n);
  // Edge dedup — relation prefix 로 호출 인과와 시간 흐름 분리.
  const callEdgeKey     = (fk: string, fn: string, tk: string, tn: string) =>
    'call:' + edgeKey(fk, fn, tk, tn);
  const turnFlowEdgeKey = (fk: string, fn: string, tk: string, tn: string) =>
    'turn-flow:' + edgeKey(fk, fn, tk, tn);

  // 자식 분류 — Skill/Agent 는 카탈로그 통과 시에만 메타 문서. mcp__ 는 전부 메타 문서.
  // 그 외(내장 도구, 미등록 skill/agent)는 null → transit (사슬은 보존, 노드/엣지 미생성).
  const classifyAsMetaDocument = (
    toolName: string | null,
    toolDetail: string | null,
  ): { kind: MetaFlowEgoNodeKind; name: string } | null => {
    if (!toolName) return null;
    if (toolName === 'Skill') {
      if (!toolDetail || !skillCatalog.has(toolDetail)) return null;
      return { kind: 'skill', name: toolDetail };
    }
    if (toolName === 'Agent') {
      if (!toolDetail || !agentCatalog.has(toolDetail)) return null;
      return { kind: 'agent', name: toolDetail };
    }
    if (toolName.startsWith('mcp__')) {
      return { kind: 'mcp', name: toolName };
    }
    return null;
  };

  // 자식 BFS — center 의 tool_use_id 를 seed 로 parent_tool_use_id 체인을 따라 내려간다.
  let frontier = new Set<string>(centerSeedRows.map(r => r.tool_use_id));

  for (let hop = 1; hop <= BFS_MAX_DEPTH; hop++) {
    if (frontier.size === 0) break;
    const frontierArr = Array.from(frontier);

    type ChildRow = {
      parent_tool_use_id: string;
      tool_use_id: string | null;
      tool_name: string | null;
      tool_detail: string | null;
      turn_id: string | null;
    };
    const childRows: ChildRow[] = [];
    // chunk 단위로 IN(...) 바인딩 — 한 BFS 단계당 최대 수백~수천 행이라 비용 미미.
    for (let i = 0; i < frontierArr.length; i += BFS_FRONTIER_CHUNK) {
      const chunk = frontierArr.slice(i, i + BFS_FRONTIER_CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.query(`
        SELECT parent_tool_use_id, tool_use_id, tool_name, tool_detail, turn_id
        FROM requests
        WHERE parent_tool_use_id IN (${placeholders})
          AND tool_name IS NOT NULL
          AND (event_type IS NULL OR event_type != 'pre_tool')
          AND timestamp >= ? AND timestamp <= ?
          ${projectClause}
      `).all(...chunk, fromTs, toTs, ...projectParam) as ChildRow[];
      childRows.push(...rows);
    }

    const nextFrontier = new Set<string>();
    for (const row of childRows) {
      if (!row.parent_tool_use_id) continue;
      const parentRef = childChainMap.get(row.parent_tool_use_id);
      if (!parentRef) continue;

      const classified = classifyAsMetaDocument(row.tool_name, row.tool_detail);

      // self 호출은 transit 으로 격하 — 사슬은 끊지 않지만 노드/엣지는 만들지 않는다.
      const isSelf = !!classified
        && classified.kind === filter.centerType
        && classified.name === filter.centerName;

      if (classified && !isSelf) {
        // 실제 메타 문서 — 노드/엣지 등록. depth = 부모의 실제 depth + 1, 상한 BFS_MAX_DEPTH.
        const newDepth = Math.min(parentRef.depth + 1, BFS_MAX_DEPTH);
        const nk = childNodeKey(classified.kind, classified.name);
        if (!nodeMap.has(nk)) {
          nodeMap.set(nk, {
            kind: classified.kind,
            name: classified.name,
            depth: newDepth,
            timeline: null,
            count: 0,
            pct: 0,
          });
          nodeTurnSet.set(nk, new Set<string>());
        }
        if (row.turn_id) nodeTurnSet.get(nk)!.add(row.turn_id);

        const ek = callEdgeKey(parentRef.kind, parentRef.name, classified.kind, classified.name);
        if (!edgeMap.has(ek)) {
          edgeMap.set(ek, {
            fromKind: parentRef.kind,
            fromName: parentRef.name,
            toKind: classified.kind,
            toName: classified.name,
            relation: 'call',
            count: 0,
          });
          edgeTurnSet.set(ek, new Set<string>());
        }
        if (row.turn_id) edgeTurnSet.get(ek)!.add(row.turn_id);

        // frontier 확장 — 이 메타 문서가 자기 자신의 chainRef 가 되어 더 아래로 이어진다.
        if (row.tool_use_id && !childChainMap.has(row.tool_use_id)) {
          childChainMap.set(row.tool_use_id, {
            kind: classified.kind,
            name: classified.name,
            depth: newDepth,
          });
          nextFrontier.add(row.tool_use_id);
        }
      } else {
        // transit (내장 도구, 미등록 skill/agent, self 호출) —
        //   노드/엣지는 등록하지 않고 부모의 chainRef 를 그대로 상속해 사슬은 보존한다.
        if (row.tool_use_id && !childChainMap.has(row.tool_use_id)) {
          childChainMap.set(row.tool_use_id, parentRef);
          nextFrontier.add(row.tool_use_id);
        }
      }
    }

    frontier = nextFrontier;
  }

  // ── 3) 부모 BFS (depth -1..-3) — parent_tool_use_id 체인을 거슬러 올라감 ───
  //   parentFrontier: 현재 단계에서 부모 후보를 찾을 toolUseId 집합.
  //     - 시작점: center 의 tool_use_id 집합. 첫 단계는 center 의 parent_tool_use_id 를 찾음.
  //   parentChildMap: parent.tool_use_id → 그 부모가 호출한 직속 자식 (kind,name)
  //     → 엣지(parent→child) 를 만들 때 사용.
  const parentChildMap = new Map<string, { kind: MetaFlowEgoNodeKind; name: string }>();
  // 시작은 center 자신. 첫 부모 행 처리 시 center 가 자식이 됨.
  for (const r of centerSeedRows) {
    parentChildMap.set(r.tool_use_id, { kind: filter.centerType, name: filter.centerName });
  }
  let parentFrontier = new Set<string>(centerSeedRows.map(r => r.tool_use_id));

  for (let depth = -1 as -1 | -2 | -3; depth >= -BFS_MAX_DEPTH; depth = (depth - 1) as -1 | -2 | -3) {
    if (parentFrontier.size === 0) break;
    const frontierArr = Array.from(parentFrontier);

    type ParentRow = {
      tool_use_id: string;
      child_tool_use_id: string;
      tool_name: string | null;
      tool_detail: string | null;
      slash_command: string | null;
      /** 자식 행의 turn_id — 부모→자식 호출이 일어난 turn. distinct turn count 분자. */
      turn_id: string | null;
    };
    const parentRows: ParentRow[] = [];
    for (let i = 0; i < frontierArr.length; i += BFS_FRONTIER_CHUNK) {
      const chunk = frontierArr.slice(i, i + BFS_FRONTIER_CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      //   1) WHERE tool_use_id IN (child.parent_tool_use_id) 로 부모 행 매칭
      //   2) child_tool_use_id 는 어느 자식이 이 부모를 가리켰는지 식별 (엣지용)
      //   3) c.turn_id 는 이 부모→자식 호출이 일어난 turn — 자식 BFS의 row.turn_id 와 대칭.
      const rows = db.query(`
        SELECT
          p.tool_use_id        AS tool_use_id,
          c.tool_use_id        AS child_tool_use_id,
          p.tool_name          AS tool_name,
          p.tool_detail        AS tool_detail,
          p.slash_command      AS slash_command,
          c.turn_id            AS turn_id
        FROM requests c
        JOIN requests p ON p.tool_use_id = c.parent_tool_use_id
        WHERE c.tool_use_id IN (${placeholders})
          AND c.parent_tool_use_id IS NOT NULL
          AND c.timestamp >= ? AND c.timestamp <= ?
          AND p.timestamp >= ? AND p.timestamp <= ?
          AND (p.event_type IS NULL OR p.event_type != 'pre_tool')
          ${filter.project ? 'AND c.session_id IN (SELECT id FROM sessions WHERE project_name = ?)' : ''}
          ${filter.project ? 'AND p.session_id IN (SELECT id FROM sessions WHERE project_name = ?)' : ''}
      `).all(
        ...chunk, fromTs, toTs, fromTs, toTs,
        ...projectParam, ...projectParam,
      ) as ParentRow[];
      parentRows.push(...rows);
    }

    const nextFrontier = new Set<string>();
    for (const row of parentRows) {
      if (!row.tool_use_id) continue;

      // 부모 분류 — slash 가상 ID, Skill, Agent, mcp__ 만 통과.
      let kind: MetaFlowEgoNodeKind;
      let name: string;
      if (row.tool_use_id.startsWith('slash:')) {
        if (!row.slash_command) continue;
        kind = 'command'; name = row.slash_command;
      } else if (row.tool_name === 'Skill') {
        if (!row.tool_detail) continue;
        kind = 'skill'; name = row.tool_detail;
      } else if (row.tool_name === 'Agent') {
        if (!row.tool_detail) continue;
        kind = 'agent'; name = row.tool_detail;
      } else if (row.tool_name && row.tool_name.startsWith('mcp__')) {
        kind = 'mcp'; name = row.tool_name;
      } else {
        // 빌트인 도구가 부모인 경우는 거의 없지만 (Skill/Agent 만 자식을 가짐) 안전 차단.
        continue;
      }

      // 카탈로그 화이트리스트.
      if (kind === 'skill' && !skillCatalog.has(name)) continue;
      if (kind === 'agent' && !agentCatalog.has(name)) continue;

      // self 호출 제외 — center 와 동일.
      if (kind === filter.centerType && name === filter.centerName) continue;

      // 노드 dedup — 부모 컬럼 내부에서 가장 얕은(절댓값 작은) depth 1개.
      // count 는 turnSet.size 로 finalize 단계에서 환산되므로 0 으로 초기화한다.
      const nk = parentNodeKey(kind, name);
      if (!nodeMap.has(nk)) {
        nodeMap.set(nk, { kind, name, depth, timeline: null, count: 0, pct: 0 });
        nodeTurnSet.set(nk, new Set<string>());
      }
      if (row.turn_id) nodeTurnSet.get(nk)!.add(row.turn_id);

      // 엣지 — 부모 → 그 부모가 호출한 자식 (parentChildMap 에서 조회).
      const childRef = parentChildMap.get(row.child_tool_use_id);
      if (childRef) {
        const ek = callEdgeKey(kind, name, childRef.kind, childRef.name);
        if (!edgeMap.has(ek)) {
          edgeMap.set(ek, {
            fromKind: kind,
            fromName: name,
            toKind: childRef.kind,
            toName: childRef.name,
            relation: 'call',
            count: 0,
          });
          edgeTurnSet.set(ek, new Set<string>());
        }
        if (row.turn_id) edgeTurnSet.get(ek)!.add(row.turn_id);
      }

      // 다음 단계 seed — 이 부모의 tool_use_id 를 frontier 에 넣고,
      //   parentChildMap 에 (kind,name) 등록해 다음 단계에서 엣지 만들 때 참조.
      if (!parentChildMap.has(row.tool_use_id)) {
        parentChildMap.set(row.tool_use_id, { kind, name });
        nextFrontier.add(row.tool_use_id);
      }
    }

    parentFrontier = nextFrontier;
  }

  // ── 4) 같은 턴 시간 흐름 후속 (timeline='after') ──────────────────────────
  //   center 가 등장한 각 turn 의 max timestamp 이후에 나타난 메타 문서 행을 수집.
  //   인과 사슬(부모/자식)에 이미 잡힌 (kind,name) 은 dedup 제외.
  type AfterRow = {
    tool_name: string | null;
    tool_detail: string | null;
    slash_command: string | null;
    turn_id: string;
  };
  const afterRows = db.query(`
    WITH centerTurns AS (
      SELECT turn_id, MAX(timestamp) AS ts
      FROM requests
      WHERE ${centerWhere}
        AND turn_id IS NOT NULL
        AND timestamp >= ? AND timestamp <= ?
        ${projectClause}
      GROUP BY turn_id
    )
    SELECT r.tool_name, r.tool_detail, r.slash_command, r.turn_id
    FROM requests r
    JOIN centerTurns t ON r.turn_id = t.turn_id
    WHERE r.timestamp > t.ts
      AND (r.event_type IS NULL OR r.event_type != 'pre_tool')
      AND (
        (r.tool_name = 'Skill' AND r.tool_detail IS NOT NULL)
        OR (r.tool_name = 'Agent' AND r.tool_detail IS NOT NULL)
        OR (r.tool_name IS NOT NULL AND r.tool_name LIKE 'mcp__%')
        OR (r.slash_command IS NOT NULL AND r.slash_command != '')
      )
      ${filter.project ? 'AND r.session_id IN (SELECT id FROM sessions WHERE project_name = ?)' : ''}
    ORDER BY r.turn_id, r.timestamp ASC
  `).all(...centerParams, fromTs, toTs, ...projectParam, ...projectParam) as AfterRow[];

  // turn 별로 (kind,name) 카운트 — 같은 턴 중복은 1회로 처리(distinct turn 수).
  const afterTurnSet = new Map<string, Set<string>>();
  for (const row of afterRows) {
    let kind: MetaFlowEgoNodeKind;
    let name: string;
    if (row.slash_command) {
      kind = 'command'; name = row.slash_command;
    } else if (row.tool_name === 'Skill' && row.tool_detail) {
      kind = 'skill'; name = row.tool_detail;
    } else if (row.tool_name === 'Agent' && row.tool_detail) {
      kind = 'agent'; name = row.tool_detail;
    } else if (row.tool_name && row.tool_name.startsWith('mcp__')) {
      kind = 'mcp'; name = row.tool_name;
    } else {
      continue;
    }
    if (kind === 'skill' && !skillCatalog.has(name)) continue;
    if (kind === 'agent' && !agentCatalog.has(name)) continue;
    if (kind === filter.centerType && name === filter.centerName) continue;
    // 이미 인과(자식/부모)로 잡힌 노드는 인과 표현이 우선.
    if (nodeMap.has(childNodeKey(kind, name)) || nodeMap.has(parentNodeKey(kind, name))) continue;

    const k = `${kind}\x00${name}`;
    if (!afterTurnSet.has(k)) afterTurnSet.set(k, new Set<string>());
    afterTurnSet.get(k)!.add(row.turn_id);
  }

  // turn-after 노드 등록 + center → after 엣지 (relation='turn-flow').
  // distinct turn count 는 이미 afterTurnSet 에 있다 — nodeTurnSet/edgeTurnSet 에 직접 등록해
  // finalize 단계에서 일관되게 처리.
  for (const [k, turns] of afterTurnSet.entries()) {
    const sep = k.indexOf('\x00');
    const kind = k.slice(0, sep) as MetaFlowEgoNodeKind;
    const name = k.slice(sep + 1);
    const nk = afterNodeKey(kind, name);
    nodeMap.set(nk, {
      kind, name, depth: 0, timeline: 'after', count: 0, pct: 0,
    });
    nodeTurnSet.set(nk, turns);
    const ek = turnFlowEdgeKey(filter.centerType, filter.centerName, kind, name);
    edgeMap.set(ek, {
      fromKind: filter.centerType,
      fromName: filter.centerName,
      toKind: kind,
      toName: name,
      relation: 'turn-flow',
      count: 0,
    });
    edgeTurnSet.set(ek, turns);
  }

  // ── 5) count(distinct turn) 환산, pct 일괄 계산, 정렬 ────────────────────
  const nodes: MetaFlowEgoNode[] = [];
  for (const [nk, node] of nodeMap.entries()) {
    const turnSet = nodeTurnSet.get(nk);
    node.count = turnSet ? turnSet.size : 0;
    node.pct = toPct(node.count);
    nodes.push(node);
  }
  // 정렬 — timeline 후속은 맨 뒤, 호출 인과는 depth ASC(부모 → center → 자식), 같은 depth 내 count DESC.
  nodes.sort((a, b) => {
    const ta = a.timeline === 'after' ? 1 : 0;
    const tb = b.timeline === 'after' ? 1 : 0;
    if (ta !== tb) return ta - tb;
    return a.depth - b.depth
      || b.count - a.count
      || a.name.localeCompare(b.name);
  });

  const edges: MetaFlowEgoEdge[] = [];
  for (const [ek, edge] of edgeMap.entries()) {
    const turnSet = edgeTurnSet.get(ek);
    edge.count = turnSet ? turnSet.size : 0;
    edges.push(edge);
  }
  edges.sort((a, b) => b.count - a.count);

  return {
    center: {
      type: filter.centerType,
      name: filter.centerName,
      turns: centerTurns,
      invocations: centerInvocations,
    },
    totalTurns,
    callTree: { nodes, edges },
  };
}
