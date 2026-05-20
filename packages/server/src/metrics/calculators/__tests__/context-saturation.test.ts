/**
 * context-saturation — 세션 단위 컨텍스트 사용률 anomaly 단위 테스트.
 *
 * 검증 핵심:
 *  - normal/warn/critical 분기 (70/85 임계)
 *  - 동적 windowMax 반영: max(seed, observed) 정책과 결합되어 모델별 임계 토큰 자동 산출
 *  - 세션에 proxy 행이 없으면 no-data → normal(null), pct=0/window_max=0
 *  - 1M opt-in beta 헤더는 windowMax를 1M로 단락 → 같은 토큰이라도 saturation pct 다름
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  detectContextSaturation,
  toContextSaturationField,
  __test,
} from '../anomaly';
import { invalidateModelLimitsCache } from '../../../model-limits';

function createTestDb(): Database {
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
      ('claude-haiku-4',  200000,  '200K standard'),
      ('kimi-k2',         128000,  'Kimi K2 base 128K');
  `);
  // proxy_requests — getMaxContextProxyForSession 입력.
  db.run(`
    CREATE TABLE proxy_requests (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      session_id TEXT,
      model TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      anthropic_beta TEXT
    );
  `);
  return db;
}

function insertProxy(
  db: Database,
  overrides: Partial<{
    id: string;
    timestamp: number;
    session_id: string;
    model: string;
    tokens_input: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    anthropic_beta: string;
  }>,
): void {
  db.prepare(
    `INSERT INTO proxy_requests
     (id, timestamp, session_id, model, tokens_input, cache_creation_tokens, cache_read_tokens, anthropic_beta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    overrides.id ?? `r-${Math.random().toString(36).slice(2, 8)}`,
    overrides.timestamp ?? Date.now(),
    overrides.session_id ?? 'sess-1',
    overrides.model ?? null,
    overrides.tokens_input ?? 0,
    overrides.cache_creation_tokens ?? 0,
    overrides.cache_read_tokens ?? 0,
    overrides.anthropic_beta ?? null,
  );
}

beforeEach(() => {
  invalidateModelLimitsCache();
});

describe('detectContextSaturation — 임계 분기', () => {
  it('proxy 행 없는 세션 → no-data normal(stage null, pct 0)', () => {
    const db = createTestDb();
    const r = detectContextSaturation(db, 'empty-session');
    expect(r.stage).toBeNull();
    expect(r.context_tokens).toBe(0);
    expect(r.window_max).toBe(0);
    expect(r.pct).toBe(0);
    expect(r.threshold_warn).toBe(__test.CTX_SAT_WARN_PCT / 100);
    expect(r.threshold_critical).toBe(__test.CTX_SAT_CRITICAL_PCT / 100);
  });

  it('70% 미만 → normal(stage null)', () => {
    const db = createTestDb();
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 100_000 }); // 200K seed, 50%
    const r = detectContextSaturation(db, 's');
    expect(r.stage).toBeNull();
    expect(r.window_max).toBe(200_000);
    expect(r.context_tokens).toBe(100_000);
    expect(r.pct).toBeCloseTo(0.5, 3);
  });

  it('70% 이상 85% 미만 → warn', () => {
    const db = createTestDb();
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 150_000 }); // 75%
    const r = detectContextSaturation(db, 's');
    expect(r.stage).toBe('warn');
    expect(r.pct).toBeCloseTo(0.75, 3);
  });

  it('85% 이상 → critical', () => {
    const db = createTestDb();
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 180_000 }); // 90%
    const r = detectContextSaturation(db, 's');
    expect(r.stage).toBe('critical');
    expect(r.pct).toBeCloseTo(0.9, 3);
  });

  it('context_tokens는 input + cache_read + cache_creation 합산', () => {
    const db = createTestDb();
    insertProxy(db, {
      session_id: 's', model: 'claude-haiku-4-5',
      tokens_input: 100_000, cache_creation_tokens: 30_000, cache_read_tokens: 25_000,
    });
    const r = detectContextSaturation(db, 's');
    // 155K / 200K = 77.5% → warn
    expect(r.context_tokens).toBe(155_000);
    expect(r.stage).toBe('warn');
  });
});

describe('detectContextSaturation — 동적 windowMax 반영', () => {
  it('관측이 시드를 초과하면 한도가 자동 보정 → 같은 토큰이라도 pct 달라짐', () => {
    const db = createTestDb();
    // kimi-k2.6 시드 매칭: 128K. 관측을 시드 초과(140K)로 올려 동적 보정 발동.
    insertProxy(db, { session_id: 's-prev', model: 'kimi-k2.6', tokens_input: 140_000 });
    // 검사 세션은 80K — kimi-k2.6 한도가 보정되어 140K가 되면 pct = 80/140 ≈ 57% → normal
    insertProxy(db, { session_id: 's', model: 'kimi-k2.6', tokens_input: 80_000 });
    const r = detectContextSaturation(db, 's');
    expect(r.window_max).toBe(140_000); // max(128K seed, 140K observed)
    expect(r.stage).toBeNull(); // 57% < 70%
  });

  it('1M opt-in beta 헤더 → windowMax 1M로 단락', () => {
    const db = createTestDb();
    insertProxy(db, {
      session_id: 's', model: 'claude-haiku-4-5',
      tokens_input: 150_000,
      anthropic_beta: 'a,context-1m-2025-08-07,b',
    });
    const r = detectContextSaturation(db, 's');
    // 200K seed였다면 warn이지만, 1M opt-in으로 분모 1M → 15% → normal
    expect(r.window_max).toBe(1_000_000);
    expect(r.stage).toBeNull();
  });
});

describe('toContextSaturationField', () => {
  it('shape 보존 (앞 결과 그대로 직렬화)', () => {
    const db = createTestDb();
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 150_000 });
    const r = detectContextSaturation(db, 's');
    const f = toContextSaturationField(r);
    expect(f).toEqual(r);
  });
});
