/**
 * apply.ts — Ladybug 스키마 적용 + 버전 mismatch 시 throw-away rebuild
 *
 * 책임:
 *   - 첫 connect 직후 NODE_TABLES × 7 + REL_TABLES × 8 을 idempotent 하게 실행.
 *   - `_SchemaMeta.version` 과 코드 상수 `SCHEMA_VERSION` 비교 → mismatch면
 *     데이터 폴더를 rename(`graph.bad.<ts>/`) 하고 새 폴더에 처음부터 다시 빌드.
 *
 * 의존성:
 *   - client.ts (LadybugClient.query)
 *   - schema/ddl.ts (NODE_TABLES, REL_TABLES, SCHEMA_VERSION)
 *   - runtime/paths.ts (getGraphDir — rename 대상 식별)
 *
 * 호출 흐름:
 *   LadybugClient.connect()
 *     → applySchema(client)
 *         → readCurrentVersion()
 *         → if mismatch: throwAwayAndRebuild()
 *         → 그렇지 않으면 DDL idempotent 실행 → _SchemaMeta upsert
 *
 * 디자인 결정:
 *   - rebuild 는 *클라이언트를 닫고 폴더를 옮긴 뒤 호출자에게 재실행을 요청* 하는
 *     형태. 그래프 데이터는 SQLite SSoT 로부터 sync worker 가 다시 채울 것이므로
 *     본 모듈은 데이터 복구를 책임지지 않는다.
 *   - 모든 DDL 은 `CREATE ... IF NOT EXISTS` 로 작성됐지만, fork에 따라 미지원일 수
 *     있어 try/catch 로 흡수.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/05-migration-strategy.md
 *   §3.1 Kuzu DB Corruption — rename → rebuild 단순화 원칙.
 */

import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { LadybugClient } from '../client';
import { NODE_TABLES, REL_TABLES, SCHEMA_VERSION } from './ddl';
import { getGraphDir } from '../runtime/paths';

// =============================================================================
// 메인 진입점
// =============================================================================

/**
 * 스키마 idempotent 적용. 다음 순서:
 *   1) `_SchemaMeta` 테이블이 없을 수 있으므로 우선 CREATE 부터.
 *   2) 현재 저장된 version 조회.
 *   3) mismatch면 throw-away rebuild 요청 (LadybugUnavailableError throw → 호출자가
 *      `throwAwayAndRebuild()` 실행 후 재시도).
 *   4) DDL × 15 idempotent 실행.
 *   5) `_SchemaMeta.version = SCHEMA_VERSION` upsert.
 */
export async function applySchema(client: LadybugClient): Promise<void> {
  // _SchemaMeta 는 NODE_TABLES 에 포함되어 있지만, version 조회를 먼저 해야 하므로 그
  // 자체를 가장 먼저 만든다. NODE_TABLES 첫 패스에서 다시 실행되어도 IF NOT EXISTS 라
  // 안전.
  await safeDdl(client, NODE_TABLES.find((d) => d.includes('_SchemaMeta')) ?? '');

  const current = await readCurrentVersion(client);
  if (current !== null && current !== SCHEMA_VERSION) {
    // 호출자(client.connect) 가 본 에러를 잡고 throwAwayAndRebuild() 후 재시도하도록 신호.
    throw new SchemaMismatchError(current, SCHEMA_VERSION);
  }

  for (const ddl of NODE_TABLES) await safeDdl(client, ddl);
  for (const ddl of REL_TABLES) await safeDdl(client, ddl);

  // version 기록 — upsert 패턴.
  await upsertSchemaVersion(client, SCHEMA_VERSION);
}

/**
 * 스키마 mismatch 시 호출 — graph 폴더를 안전한 이름으로 rename 한다. 호출 후 sync
 * worker 가 다시 cold start 빌드를 수행하면 자연스럽게 새 폴더가 생성됨.
 *
 * 안전성:
 *   - 항상 rename 만 한다 (`rm` 하지 않음) — 사용자가 디버깅을 위해 보존 가능.
 *   - 같은 이름의 backup 이 이미 있으면 timestamp 추가하여 충돌 회피.
 *   - 모든 실패는 console.warn 로만 보고하고 throw 하지 않는다 — 회로가 OPEN 되더라도
 *     서버는 살아있어야 한다.
 */
export function throwAwayAndRebuild(): void {
  try {
    const dir = getGraphDir();
    if (!existsSync(dir)) return;
    const parent = dir.substring(0, dir.lastIndexOf('/'));
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    let target = join(parent, `graph.bad.${ts}`);
    // 충돌 회피 — 매우 드물지만 동시 호출 대비.
    let suffix = 0;
    while (existsSync(target)) {
      suffix++;
      target = join(parent, `graph.bad.${ts}.${suffix}`);
    }
    renameSync(dir, target);
    console.warn(
      `[graph-schema] throw-away rebuild — old data moved to ${target}. ` +
        `Sync worker will rebuild from SQLite on next tick.`,
    );
  } catch (err) {
    console.warn(`[graph-schema] failed to rename graph dir during rebuild: ${err}`);
  }
}

// =============================================================================
// 내부 헬퍼
// =============================================================================

class SchemaMismatchError extends Error {
  constructor(
    public readonly currentVersion: number,
    public readonly expectedVersion: number,
  ) {
    super(`schema version mismatch: stored=${currentVersion} expected=${expectedVersion}`);
    this.name = 'SchemaMismatchError';
  }
}

/**
 * 저장된 _SchemaMeta.version 을 조회. 행이 없으면 null (첫 부팅).
 */
async function readCurrentVersion(client: LadybugClient): Promise<number | null> {
  try {
    const r = await client.query(`MATCH (m:_SchemaMeta {key: 'main'}) RETURN m.version AS v`);
    if (r.rows.length === 0) return null;
    const v = (r.rows[0] as Record<string, unknown>).v;
    return typeof v === 'number' ? v : Number(v);
  } catch {
    // 테이블 자체가 아직 없을 수 있다 — 그 경우 null 처럼 처리.
    return null;
  }
}

/**
 * version upsert. 본 시점에는 _SchemaMeta 테이블이 보장됨. row 가 있으면 SET, 없으면
 * CREATE. fork 의 MERGE 지원 여부에 따라 두 패턴 모두 시도.
 */
async function upsertSchemaVersion(client: LadybugClient, version: number): Promise<void> {
  const appliedAt = Date.now();
  try {
    // 우선 MERGE 시도 (Kuzu/Ladybug 표준).
    await client.query(
      `MERGE (m:_SchemaMeta {key: 'main'})
       SET m.version = $version, m.applied_at = $appliedAt`,
      { version, appliedAt },
    );
  } catch {
    // MERGE 미지원 폴백 — DELETE + CREATE.
    try {
      await client.query(`MATCH (m:_SchemaMeta {key: 'main'}) DELETE m`);
    } catch {
      // 행이 없으면 무시.
    }
    await client.query(
      `CREATE (:_SchemaMeta {key: 'main', version: $version, applied_at: $appliedAt})`,
      { version, appliedAt },
    );
  }
}

/**
 * DDL 실행 — `already exists` / `duplicate` 등 idempotent 에러는 무시. 단, IF NOT EXISTS
 * 미지원 fork 와 호환되도록 try/catch 가 필요.
 */
async function safeDdl(client: LadybugClient, ddl: string): Promise<void> {
  if (!ddl) return;
  try {
    await client.query(ddl);
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      return; // idempotent — 무시.
    }
    throw err;
  }
}
