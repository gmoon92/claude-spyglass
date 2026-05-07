/**
 * Meta Document CRUD — Claude Code 메타 문서 카탈로그 (v24, Migration 024)
 *
 * 책임:
 *  - .claude/{agents,skills,commands} 디렉토리에서 발견된 메타 문서 정의를
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
 * 메타 문서 1건 upsert. 동일 (type,name,source,source_root)가 있으면
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
