/**
 * model-limits — 동적 한도 산출 정책(getModelMaxTokens) 단위 테스트.
 *
 * 검증 핵심:
 *  - [1m] suffix / context-1m-2025-08-07 beta 헤더는 즉시 EXTENDED(1M)로 단락.
 *  - 시드 매칭값과 proxy_requests 관측 최대를 max()로 결합.
 *  - 시드가 관측을 초과하면 시드 채택 (Anthropic 정확 시드 케이스).
 *  - 관측이 시드를 초과하면 관측 채택 (Kimi K2.6처럼 시드가 잘못된 케이스).
 *  - proxy_requests 부재(테이블 없음) 시 graceful 폴백 — 시드만 사용.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  getModelMaxTokens,
  invalidateModelLimitsCache,
  DEFAULT_MAX_TOKENS,
  EXTENDED_MAX_TOKENS,
} from '../model-limits';

function newDb(opts: { withProxyRequests: boolean }): Database {
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
      ('claude-haiku-4',  200000,  '200K');
  `);
  if (opts.withProxyRequests) {
    db.run(`
      CREATE TABLE proxy_requests (
        id TEXT PRIMARY KEY,
        model TEXT,
        tokens_input INTEGER DEFAULT 0,
        cache_creation_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0
      );
    `);
  }
  return db;
}

function insertProxy(
  db: Database,
  model: string,
  parts: { tokens_input?: number; cache_creation_tokens?: number; cache_read_tokens?: number },
): void {
  db.prepare(
    `INSERT INTO proxy_requests (id, model, tokens_input, cache_creation_tokens, cache_read_tokens)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    `r-${Math.random().toString(36).slice(2, 8)}`,
    model,
    parts.tokens_input ?? 0,
    parts.cache_creation_tokens ?? 0,
    parts.cache_read_tokens ?? 0,
  );
}

beforeEach(() => {
  invalidateModelLimitsCache();
});

describe('getModelMaxTokens — 시드 단독 (proxy_requests 없음)', () => {
  it('model 미상은 DEFAULT 200K 폴백', () => {
    const db = newDb({ withProxyRequests: false });
    expect(getModelMaxTokens(db, null)).toBe(DEFAULT_MAX_TOKENS);
    expect(getModelMaxTokens(db, '')).toBe(DEFAULT_MAX_TOKENS);
  });

  it('[1m] suffix는 즉시 EXTENDED 1M (시드/관측 무시)', () => {
    const db = newDb({ withProxyRequests: false });
    expect(getModelMaxTokens(db, 'claude-haiku-4-5[1m]')).toBe(EXTENDED_MAX_TOKENS);
  });

  it('context-1m-2025-08-07 beta 토큰 → 1M', () => {
    const db = newDb({ withProxyRequests: false });
    expect(
      getModelMaxTokens(db, 'some-future-model', 'other,context-1m-2025-08-07,more'),
    ).toBe(EXTENDED_MAX_TOKENS);
  });

  it('시드 매칭(최장 우선) — proxy_requests 부재면 시드 그대로', () => {
    const db = newDb({ withProxyRequests: false });
    expect(getModelMaxTokens(db, 'claude-opus-4-7')).toBe(1_000_000);
    expect(getModelMaxTokens(db, 'kimi-k2.6')).toBe(128_000); // prefix 매칭 (관측 없음)
  });

  it('시드 미매칭도 DEFAULT 200K', () => {
    const db = newDb({ withProxyRequests: false });
    expect(getModelMaxTokens(db, 'unknown-model-xyz')).toBe(DEFAULT_MAX_TOKENS);
  });
});

describe('getModelMaxTokens — 시드 + 관측 결합', () => {
  it('관측 ≤ 시드 → 시드 채택 (Anthropic 정확 케이스)', () => {
    const db = newDb({ withProxyRequests: true });
    insertProxy(db, 'claude-opus-4-7', { tokens_input: 500_000 }); // 1M 시드 안쪽
    expect(getModelMaxTokens(db, 'claude-opus-4-7')).toBe(1_000_000);
  });

  it('관측 > 시드 → 관측 채택 (Kimi K2.6 시나리오)', () => {
    const db = newDb({ withProxyRequests: true });
    insertProxy(db, 'kimi-k2.6', { tokens_input: 138_526 }); // 시드 128K 초과
    expect(getModelMaxTokens(db, 'kimi-k2.6')).toBe(138_526);
  });

  it('관측 = tokens_input + cache_creation + cache_read 합산', () => {
    const db = newDb({ withProxyRequests: true });
    insertProxy(db, 'kimi-k2.6', { tokens_input: 100_000, cache_creation_tokens: 30_000, cache_read_tokens: 20_000 });
    expect(getModelMaxTokens(db, 'kimi-k2.6')).toBe(150_000);
  });

  it('관측 exact model 매칭 — 다른 model 행은 영향 없음', () => {
    const db = newDb({ withProxyRequests: true });
    insertProxy(db, 'kimi-k2.5', { tokens_input: 999_999 });
    expect(getModelMaxTokens(db, 'kimi-k2.6')).toBe(128_000); // k2.5 관측은 k2.6에 영향 X
  });

  it('1M opt-in beta 시그널이 있으면 관측이 작아도 1M 단락', () => {
    const db = newDb({ withProxyRequests: true });
    insertProxy(db, 'claude-haiku-4-5', { tokens_input: 50_000 });
    expect(
      getModelMaxTokens(db, 'claude-haiku-4-5', 'a,context-1m-2025-08-07,b'),
    ).toBe(EXTENDED_MAX_TOKENS);
  });
});

describe('invalidateModelLimitsCache', () => {
  it('관측 캐시 invalidation 후 신규 관측치가 반영된다', () => {
    const db = newDb({ withProxyRequests: true });
    insertProxy(db, 'kimi-k2.6', { tokens_input: 130_000 });
    expect(getModelMaxTokens(db, 'kimi-k2.6')).toBe(130_000);

    // 캐시 없이 더 큰 신규 관측 — TTL 안이라 캐시된 130_000이 그대로일 수 있음
    insertProxy(db, 'kimi-k2.6', { tokens_input: 200_000 });
    invalidateModelLimitsCache();
    expect(getModelMaxTokens(db, 'kimi-k2.6')).toBe(200_000);
  });
});
