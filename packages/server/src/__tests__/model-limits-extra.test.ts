/**
 * model-limits — getAllModelLimits 표면 + _seedCache 라이프사이클 특성화 테스트
 * (T02 storage 선반출 사전 단계)
 *
 * @description
 *   `packages/server/src/model-limits.ts` 의 동작을 고정한다. 기존
 *   `__tests__/model-limits.test.ts`(T01) 는 getModelMaxTokens 의 추론 로직(suffix/beta/
 *   seed+observed 결합/observed 캐시 invalidate)을 충분히 덮는다. 본 파일은 그와 중복되지 않는
 *   두 공백만 메운다:
 *
 *   1. getAllModelLimits(db) 반환 shape — router.ts:125 (`model_limits: getAllModelLimits(db)`)
 *      가 클라이언트로 그대로 노출하는 표면. 선반출 시 동일 shape 유지가 계약.
 *   2. _seedCache 라이프사이클 — 시드는 첫 호출 시 1회만 로드되고 이후 캐시된다. observed 캐시와
 *      별개로 시드 캐시 자체의 1회-로드/invalidate 재로딩을 직접 고정(T01 은 observed 캐시만 다룸).
 *
 *   storage(@spyglass/storage) 선반출 후 import 경로만 바뀌고 동작은 동일해야 한다.
 *
 * @see packages/server/src/model-limits.ts
 * @see packages/server/src/__tests__/model-limits.test.ts (getModelMaxTokens 추론 커버리지)
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  getAllModelLimits,
  getModelMaxTokens,
  invalidateModelLimitsCache,
  DEFAULT_MAX_TOKENS,
  EXTENDED_MAX_TOKENS,
} from '../model-limits';

function newDb(): Database {
  const db = new Database(':memory:');
  db.run(`
    CREATE TABLE model_limits (
      pattern    TEXT PRIMARY KEY,
      max_tokens INTEGER NOT NULL,
      notes      TEXT
    );
  `);
  db.run(`
    INSERT INTO model_limits (pattern, max_tokens, notes) VALUES
      ('claude-opus-4-7', 1000000, '1M GA'),
      ('kimi-k2',         128000,  'Kimi K2 series 기본 128K'),
      ('claude-haiku-4',  200000,  NULL);
  `);
  return db;
}

beforeEach(() => {
  invalidateModelLimitsCache();
});
afterEach(() => {
  invalidateModelLimitsCache();
});

// =============================================================================
// getAllModelLimits — 클라이언트 노출 shape (router.ts:125)
// =============================================================================

describe('getAllModelLimits — 반환 shape', () => {
  it('default/extended/context_1m_beta 상수 + seeds 배열을 노출', () => {
    const db = newDb();
    const out = getAllModelLimits(db);

    expect(out.default).toBe(DEFAULT_MAX_TOKENS); // 200_000
    expect(out.extended).toBe(EXTENDED_MAX_TOKENS); // 1_000_000
    // 현재 동작 고정 — 레거시 1M opt-in beta 토큰 문자열.
    expect(out.context_1m_beta).toBe('context-1m-2025-08-07');
    expect(Array.isArray(out.seeds)).toBe(true);
  });

  it('seeds 는 model_limits 행을 length(pattern) DESC 정렬로 노출 (최장 우선 매칭 보장)', () => {
    const db = newDb();
    const seeds = getAllModelLimits(db).seeds;

    // 3개 시드 행 모두 포함.
    expect(seeds.length).toBe(3);
    // 정렬: 가장 긴 pattern('claude-opus-4-7' = 15자) 이 선두.
    expect(seeds[0]?.pattern).toBe('claude-opus-4-7');
    // 각 행은 pattern/max_tokens/notes 형태.
    const opus = seeds.find((s) => s.pattern === 'claude-opus-4-7');
    expect(opus?.max_tokens).toBe(1_000_000);
    // NULL notes 는 null 로 보존.
    const haiku = seeds.find((s) => s.pattern === 'claude-haiku-4');
    expect(haiku?.notes).toBeNull();
  });

  it('반환 seeds 는 캐시 사본 — 호출자 변형이 캐시를 오염시키지 않음', () => {
    const db = newDb();
    const first = getAllModelLimits(db).seeds;
    first.length = 0; // 반환 배열 변형.
    // 캐시(_seedCache)는 그대로 → 다음 호출은 여전히 3건.
    expect(getAllModelLimits(db).seeds.length).toBe(3);
  });

  it('model_limits 테이블이 비어도 상수는 노출하고 seeds 는 빈 배열', () => {
    const db = new Database(':memory:');
    db.run(`CREATE TABLE model_limits (pattern TEXT PRIMARY KEY, max_tokens INTEGER NOT NULL, notes TEXT);`);
    const out = getAllModelLimits(db);
    expect(out.default).toBe(DEFAULT_MAX_TOKENS);
    expect(out.seeds).toEqual([]);
  });
});

// =============================================================================
// _seedCache 라이프사이클 — 1회 로드 + invalidate 재로딩 (observed 캐시와 별개)
// =============================================================================

describe('_seedCache 라이프사이클', () => {
  it('시드는 첫 호출 시 1회 로드되어 캐시 — 이후 model_limits UPDATE 는 invalidate 전까지 미반영', () => {
    const db = newDb();
    // 첫 호출로 시드 캐시 채움 (proxy_requests 없음 → 순수 시드 경로).
    expect(getModelMaxTokens(db, 'kimi-k2.6')).toBe(128_000);

    // 시드 직접 UPDATE — 무효화 전엔 이전 시드 유지.
    db.run(`UPDATE model_limits SET max_tokens = 999_000 WHERE pattern = 'kimi-k2'`);
    expect(getModelMaxTokens(db, 'kimi-k2.6')).toBe(128_000);
    // getAllModelLimits 도 동일 캐시를 보므로 옛 값.
    expect(getAllModelLimits(db).seeds.find((s) => s.pattern === 'kimi-k2')?.max_tokens).toBe(128_000);

    // 무효화 후 재로딩 → 새 시드 반영.
    invalidateModelLimitsCache();
    expect(getModelMaxTokens(db, 'kimi-k2.6')).toBe(999_000);
    expect(getAllModelLimits(db).seeds.find((s) => s.pattern === 'kimi-k2')?.max_tokens).toBe(999_000);
  });

  it('새로 INSERT 된 시드 행도 invalidate 후에야 매칭에 반영', () => {
    const db = newDb();
    // 미매칭 모델 → DEFAULT 폴백.
    expect(getModelMaxTokens(db, 'glm-4-6')).toBe(DEFAULT_MAX_TOKENS);

    // 시드 추가 — 무효화 전엔 여전히 DEFAULT.
    db.run(`INSERT INTO model_limits (pattern, max_tokens, notes) VALUES ('glm-4', 256000, 'Zhipu GLM')`);
    expect(getModelMaxTokens(db, 'glm-4-6')).toBe(DEFAULT_MAX_TOKENS);

    invalidateModelLimitsCache();
    expect(getModelMaxTokens(db, 'glm-4-6')).toBe(256_000);
  });
});
