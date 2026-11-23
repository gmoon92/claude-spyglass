/**
 * project-alias — 프로젝트 이름 변경 시 사용 이력을 합쳐 조회하기 위한 별칭 (Migration 070).
 *
 * 책임:
 *  - 별칭(옛 이름 → 현재 이름) 등록·조회·삭제 (한 단계만 허용)
 *  - `project_name` 필터가 별칭까지 포함하도록 이름 집합으로 풀어쓰는 헬퍼(resolveProjectNames, projectNameIn)
 *  - 프로젝트 단위 GROUP BY 가 별칭을 대표 이름으로 합치는 SQL 식(canonicalProjectNameExpr)
 *
 * 설계: 읽을 때 풀어쓴다. sessions 행은 고치지 않으므로 등록 즉시 과거 이력이 합쳐지고 삭제하면 원복된다.
 *  기존 인덱스(idx_sessions_project)를 그대로 쓰도록 `= ?` 를 `IN (?, ?, …)` 로만 바꾼다.
 *
 * 호출자:
 *  - 필터: meta-document.ts, request/aggregate-tool.ts(getProjectToolStats), request/conversation.ts,
 *          metrics/usage.ts, session/read.ts, domain/session-status.ts
 *  - 관리: server routes/project-aliases.ts (GET/POST/DELETE /api/projects/aliases)
 *
 * 테이블이 없는 최소 스키마(일부 단위 테스트의 인메모리 DB)에서는 별칭 없음으로 동작한다 — 기존 동작 그대로.
 */

import type { Database } from 'bun:sqlite';

export interface ProjectAliasRow {
  alias: string;
  project_name: string;
  note: string | null;
  created_at: number;
}

export type UpsertProjectAliasResult =
  | { ok: true }
  | { ok: false; error: string };

/** 이름 길이 상한. 프로젝트 이름은 cwd 마지막 경로 세그먼트라 이보다 길 일이 거의 없다. */
const MAX_NAME_LENGTH = 256;

/** project_aliases 테이블 존재 여부 — 최소 스키마 DB 에서 별칭 기능을 조용히 끄기 위함. */
function hasAliasTable(db: Database): boolean {
  return db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_aliases'`).get() != null;
}

/**
 * 프로젝트 이름 하나를 "같은 프로젝트로 묶이는 이름 전부" 로 풀어쓴다.
 *
 * - 옛 이름(별칭)을 줘도 현재 이름으로 정규화한 뒤 그 별칭 전부를 모은다 → 어느 쪽으로 조회해도 결과가 같다.
 * - 별칭이 없거나 테이블이 없으면 `[name]`.
 * - 첫 원소가 대표(현재) 이름이다.
 */
export function resolveProjectNames(db: Database, name: string): string[] {
  if (!hasAliasTable(db)) return [name];
  const canonical =
    (db.query('SELECT project_name FROM project_aliases WHERE alias = ?').get(name) as { project_name: string } | null)
      ?.project_name ?? name;
  const aliases = db
    .query('SELECT alias FROM project_aliases WHERE project_name = ? ORDER BY alias')
    .all(canonical) as Array<{ alias: string }>;
  const names = [canonical, ...aliases.map((a) => a.alias)];
  return names.includes(name) ? names : [...names, name];
}

/**
 * `column IN (?, ?, …)` 조각과 바인딩 값. project 필터의 `column = ?` 를 이것으로 바꾼다.
 *
 * @param column 비교할 컬럼식(예: `s.project_name`, `project_name`)
 */
export function projectNameIn(db: Database, column: string, name: string): { sql: string; params: string[] } {
  const names = resolveProjectNames(db, name);
  return { sql: `${column} IN (${names.map(() => '?').join(', ')})`, params: names };
}

/**
 * 프로젝트 단위 GROUP BY 용 SQL 식 — 별칭이면 대표 이름으로 바꿔 한 그룹으로 합친다.
 * 테이블이 없으면 컬럼 그대로.
 */
export function canonicalProjectNameExpr(db: Database, column: string): string {
  if (!hasAliasTable(db)) return column;
  return `COALESCE((SELECT a.project_name FROM project_aliases a WHERE a.alias = ${column}), ${column})`;
}

export function listProjectAliases(db: Database): ProjectAliasRow[] {
  if (!hasAliasTable(db)) return [];
  return db
    .query('SELECT alias, project_name, note, created_at FROM project_aliases ORDER BY project_name, alias')
    .all() as ProjectAliasRow[];
}

/**
 * 별칭 등록(같은 alias 면 대표 이름·메모를 덮어쓴다).
 *
 * 한 단계 규칙 — 체인을 막아 "어느 이름으로 조회해도 같은 묶음" 이 항상 성립하게 한다:
 *  - alias 와 project_name 은 비어 있지 않고 서로 달라야 한다
 *  - project_name 은 이미 다른 이름의 별칭이면 안 된다
 *  - alias 는 이미 다른 별칭들의 대표 이름이면 안 된다(별칭이 별칭을 거느리게 되므로)
 */
export function upsertProjectAlias(
  db: Database,
  input: { alias: string; project_name: string; note?: string | null },
): UpsertProjectAliasResult {
  const alias = input.alias?.trim();
  const target = input.project_name?.trim();
  if (!alias || !target) return { ok: false, error: 'alias and project_name are required' };
  if (alias.length > MAX_NAME_LENGTH || target.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `names must be at most ${MAX_NAME_LENGTH} characters` };
  }
  if (alias === target) return { ok: false, error: 'alias must differ from project_name' };
  if (!hasAliasTable(db)) return { ok: false, error: 'project_aliases table is missing (migration 070 not applied)' };

  const targetIsAlias = db.query('SELECT 1 FROM project_aliases WHERE alias = ?').get(target) != null;
  if (targetIsAlias) return { ok: false, error: `project_name "${target}" is itself an alias` };
  const aliasHasAliases = db.query('SELECT 1 FROM project_aliases WHERE project_name = ?').get(alias) != null;
  if (aliasHasAliases) return { ok: false, error: `alias "${alias}" already has aliases of its own` };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).run(
    `INSERT INTO project_aliases (alias, project_name, note) VALUES (?, ?, ?)
     ON CONFLICT(alias) DO UPDATE SET project_name = excluded.project_name, note = excluded.note`,
    alias,
    target,
    input.note ?? null,
  );
  return { ok: true };
}

/** 별칭 삭제. @returns 삭제됐으면 true */
export function deleteProjectAlias(db: Database, alias: string): boolean {
  if (!hasAliasTable(db)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).run('DELETE FROM project_aliases WHERE alias = ?', alias).changes > 0;
}
