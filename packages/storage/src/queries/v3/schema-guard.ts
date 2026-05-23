/**
 * v3 schema 존재 여부 1회 캐시 검사 — 운영 안전 가드.
 *
 * 배경 (2026-05-23 사후 보강):
 *   운영 DB 가 다른 브랜치(origin/phase/1-storage)의 v3 마이그레이션을 이미 적용한
 *   상태였다. PRAGMA user_version=46 이라 main 의 040~045 마이그레이션이 전부
 *   스킵되어 events_v3 테이블 자체가 만들어지지 않았다.
 *   그 상태에서 dualWriteToV3 / projection-worker / projection-lag 라우터가 모두
 *   "no such table: events_v3" 로 실패하면서 [WARN] 폭증.
 *
 * 결정 — 빠른 noop 가드:
 *   - 부팅 시점에 events_v3 테이블 존재 여부 1회 확인하고 결과 캐시.
 *   - 없으면 v3 코드 경로 전부 noop. 동일 DB 핸들 안에서 schema 가 새로 만들어지는
 *     일은 없으므로 (마이그레이션은 부팅 1회만) 캐시 안전.
 *   - 같은 프로세스 안에서 DB 가 바뀌는 시나리오는 connection-per-call 이라 cache 가
 *     싫으면 resetV3SchemaCache() 로 비울 수 있다 (테스트용).
 *
 * 이 가드는 R5(격리) 의도를 운영 환경에서 실제로 강제하는 마지막 방어선.
 */

import type { Database } from 'bun:sqlite';

let cached: WeakMap<Database, boolean> = new WeakMap();

/**
 * events_v3 테이블 존재 여부 확인. 1회 검사 후 결과 캐시.
 *
 * @returns events_v3 가 존재하면 true. v3 코드 경로 활성 가능.
 */
export function v3SchemaAvailable(db: Database): boolean {
  const hit = cached.get(db);
  if (hit !== undefined) return hit;

  let exists = false;
  try {
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='events_v3' LIMIT 1")
      .get() as { name: string } | undefined;
    exists = !!row;
  } catch {
    exists = false;
  }
  cached.set(db, exists);
  return exists;
}

/** 테스트용 — 캐시 비움. */
export function resetV3SchemaCache(): void {
  cached = new WeakMap();
}
