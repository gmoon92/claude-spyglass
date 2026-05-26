/**
 * apply.ts — Ladybug 스키마 idempotent 적용 + 버전 mismatch 감지
 *
 * 책임:
 *   - 첫 connect 직후 NODE_TABLES × 7 + REL_TABLES × 8 을 idempotent 하게 실행.
 *   - `_SchemaMeta.version` 과 코드 상수 `SCHEMA_VERSION` 비교 → mismatch면
 *     `SchemaMismatchError` throw. **본 모듈은 데이터 폴더를 삭제/rename 하지 않는다.**
 *     호출자(client.connect) 가 에러를 잡고 *데이터를 보존한 채* graph 를 비활성화한다.
 *
 * 의존성:
 *   - client.ts (LadybugClient.query)
 *   - schema/ddl.ts (NODE_TABLES, REL_TABLES, SCHEMA_VERSION)
 *
 * 호출 흐름:
 *   LadybugClient.connect()
 *     → applySchema(client)
 *         → readCurrentVersion()
 *         → if mismatch: throw SchemaMismatchError (데이터 보존, 호출자 게이팅)
 *         → 그렇지 않으면 DDL idempotent 실행 → _SchemaMeta upsert
 *
 * 디자인 결정:
 *   - 정책 (사용자 명시): graph DB 데이터는 RDB retention 과 동일 cutoff 로만 정리되며,
 *     폴더 자체를 자동/수동 삭제하는 경로는 본 시스템에 없다. schema mismatch 가 발생하면
 *     데이터를 보존한 채 graph 를 이번 세션 동안 비활성화한다 (마이그레이션은 운영자 책임).
 *   - 모든 DDL 은 `CREATE ... IF NOT EXISTS` 로 작성됐지만, fork에 따라 미지원일 수
 *     있어 try/catch 로 흡수.
 */

import type { LadybugClient } from '../client';
import { NODE_TABLES, REL_TABLES, SCHEMA_VERSION } from './ddl';

// =============================================================================
// 메인 진입점
// =============================================================================

/**
 * 스키마 idempotent 적용. 다음 순서:
 *   1) `_SchemaMeta` 테이블이 없을 수 있으므로 우선 CREATE 부터.
 *   2) 현재 저장된 version 조회.
 *   3) mismatch면 `SchemaMismatchError` throw. **데이터는 그대로 보존** — 호출자가 graph 를
 *      비활성화하고 운영자에게 마이그레이션을 안내한다.
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
    // 호출자(client.connect) 가 본 에러를 잡고 데이터 보존 + circuit OPEN 분기로 진입.
    throw new SchemaMismatchError(current, SCHEMA_VERSION);
  }

  for (const ddl of NODE_TABLES) await safeDdl(client, ddl);
  for (const ddl of REL_TABLES) await safeDdl(client, ddl);

  // version 기록 — upsert 패턴.
  await upsertSchemaVersion(client, SCHEMA_VERSION);
}

// =============================================================================
// 내부 헬퍼
// =============================================================================

/**
 * 스키마 버전 mismatch — client.ts::connect 가 본 에러를 잡고 *데이터를 보존* 한 채
 * graph DB 를 이번 세션 동안 비활성화한다. instanceof 매칭과 `err.name ===
 * 'SchemaMismatchError'` 둘 다 안전하게 동작하도록 name 도 명시.
 */
export class SchemaMismatchError extends Error {
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
    // 우선 MERGE 시도 (Ladybug 표준).
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
