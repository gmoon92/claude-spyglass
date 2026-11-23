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
import { invalidateModelLimitsCache } from '@spyglass/storage';

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
      anthropic_beta TEXT,
      tools_count INTEGER DEFAULT 0
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
    tools_count: number;
  }>,
): void {
  db.prepare(
    `INSERT INTO proxy_requests
     (id, timestamp, session_id, model, tokens_input, cache_creation_tokens, cache_read_tokens, anthropic_beta, tools_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    overrides.id ?? `r-${Math.random().toString(36).slice(2, 8)}`,
    overrides.timestamp ?? Date.now(),
    overrides.session_id ?? 'sess-1',
    overrides.model ?? null,
    overrides.tokens_input ?? 0,
    overrides.cache_creation_tokens ?? 0,
    overrides.cache_read_tokens ?? 0,
    overrides.anthropic_beta ?? null,
    overrides.tools_count ?? 10, // 기본: 도구를 가진 대화 본체 요청
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

describe('detectContextSaturation — latest_* (세션의 현재 컨텍스트)', () => {
  it('proxy 행 없는 세션 → latest 0 / null', () => {
    const db = createTestDb();
    const r = detectContextSaturation(db, 'empty-session');
    expect(r.latest_context_tokens).toBe(0);
    expect(r.latest_pct).toBe(0);
    expect(r.latest_at).toBeNull();
    expect(r.latest_model).toBeNull();
  });

  it('/compact 뒤처럼 컨텍스트가 줄면 context_tokens(최고점)은 그대로, latest 는 내려간다', () => {
    const db = createTestDb();
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 180_000, timestamp: 1_000 });
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 20_000, timestamp: 2_000 });
    const r = detectContextSaturation(db, 's');
    expect(r.context_tokens).toBe(180_000); // 기존 계약 — 최고점 유지
    expect(r.stage).toBe('critical');
    expect(r.latest_context_tokens).toBe(20_000);
    expect(r.latest_pct).toBeCloseTo(0.1, 3);
    expect(r.latest_at).toBe(2_000);
    expect(r.latest_model).toBe('claude-haiku-4-5');
  });

  it('latest 도 input + cache_read + cache_creation 합산', () => {
    const db = createTestDb();
    insertProxy(db, {
      session_id: 's', model: 'claude-haiku-4-5', timestamp: 1_000,
      tokens_input: 100_000, cache_creation_tokens: 30_000, cache_read_tokens: 25_000,
    });
    expect(detectContextSaturation(db, 's').latest_context_tokens).toBe(155_000);
  });

  it('도구 없는 부가 질의(tools_count 0)가 더 최근이어도 건너뛴다', () => {
    const db = createTestDb();
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 150_000, timestamp: 1_000 });
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 500, timestamp: 2_000, tools_count: 0 });
    const r = detectContextSaturation(db, 's');
    expect(r.latest_context_tokens).toBe(150_000);
    expect(r.latest_at).toBe(1_000);
  });

  it('도구를 가진 행이 하나도 없으면 가장 최근 행으로 폴백', () => {
    const db = createTestDb();
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 40_000, timestamp: 1_000, tools_count: 0 });
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 60_000, timestamp: 2_000, tools_count: 0 });
    const r = detectContextSaturation(db, 's');
    expect(r.latest_context_tokens).toBe(60_000);
    expect(r.latest_at).toBe(2_000);
  });

  it('latest_pct 의 분모는 최고점 행이 아니라 그 요청의 모델 한도', () => {
    const db = createTestDb();
    // 최고점: haiku(200K) 150K / 최근: opus-4-7(1M) 100K → latest_pct = 0.1
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 150_000, timestamp: 1_000 });
    insertProxy(db, { session_id: 's', model: 'claude-opus-4-7', tokens_input: 100_000, timestamp: 2_000 });
    const r = detectContextSaturation(db, 's');
    expect(r.window_max).toBe(200_000);
    expect(r.latest_pct).toBeCloseTo(0.1, 3);
    expect(r.latest_model).toBe('claude-opus-4-7');
  });

  it('다른 세션의 행은 섞이지 않는다', () => {
    const db = createTestDb();
    insertProxy(db, { session_id: 'other', model: 'claude-haiku-4-5', tokens_input: 190_000, timestamp: 9_000 });
    insertProxy(db, { session_id: 's', model: 'claude-haiku-4-5', tokens_input: 10_000, timestamp: 1_000 });
    expect(detectContextSaturation(db, 's').latest_context_tokens).toBe(10_000);
  });
});
