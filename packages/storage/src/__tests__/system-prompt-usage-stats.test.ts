/**
 * getSystemPromptUsageStats 단위 테스트 — ref 칩 캐시 효율 신호의 SSoT.
 *
 * 핵심 검증: cache_hit_pct = cache_read / (cache_read + cache_create + input) · 100.
 * 저효율(낮은 pct)이 "비용 누수" 신호라 정확도가 중요 — 운영 DB 실측에서 0.2% 케이스가 나왔다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SpyglassDatabase, closeDatabase, getSystemPromptUsageStats } from '../index';

const TEST_DB_PATH = `/tmp/spyglass-sys-usage-${Date.now()}.db`;
const T0 = 1778904000000;
const HASH_A = 'a'.repeat(64);
const HASH_MISS = 'f'.repeat(64);

function insertProxy(
  db: SpyglassDatabase,
  id: string,
  f: {
    timestamp?: number;
    model?: string | null;
    tokens_input?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
    system_hash?: string | null;
    session_id?: string | null;
  },
): void {
  db.instance
    .prepare(
      `INSERT INTO proxy_requests (
        id, timestamp, method, path, status_code,
        model, tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens,
        system_hash, session_id
      ) VALUES (?, ?, 'POST', '/v1/messages', 200, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      f.timestamp ?? T0,
      f.model ?? null,
      f.tokens_input ?? 0,
      f.cache_creation_tokens ?? 0,
      f.cache_read_tokens ?? 0,
      f.system_hash ?? null,
      f.session_id ?? null,
    );
}

describe('getSystemPromptUsageStats', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  });

  it('캐시 잘 타는 프롬프트: pct=90, distinct 세션/모델 집계', () => {
    // 2건: 각 input=100, cache_read=900 → inputSide=2000, cache_read=1800 → 90%
    insertProxy(db, 'r1', { system_hash: HASH_A, session_id: 's1', model: 'opus', tokens_input: 100, cache_read_tokens: 900, timestamp: T0 });
    insertProxy(db, 'r2', { system_hash: HASH_A, session_id: 's1', model: 'opus', tokens_input: 100, cache_read_tokens: 900, timestamp: T0 + 1000 });

    const s = getSystemPromptUsageStats(db.instance, HASH_A);
    expect(s.reqs).toBe(2);
    expect(s.total_input_tokens).toBe(200);
    expect(s.total_cache_read).toBe(1800);
    expect(s.total_cache_create).toBe(0);
    expect(s.cache_hit_pct).toBeCloseTo(90, 1);
    expect(s.distinct_sessions).toBe(1);
    expect(s.distinct_models).toBe(1);
    expect(s.first_seen_at).toBe(T0);
    expect(s.last_seen_at).toBe(T0 + 1000);
  });

  it('캐시 안 타는 프롬프트(비용 누수): pct≈0', () => {
    // input 만 큼, cache_read=0 → 거의 0%
    insertProxy(db, 'r1', { system_hash: HASH_A, session_id: 's1', model: 'opus', tokens_input: 1000, cache_read_tokens: 0 });
    insertProxy(db, 'r2', { system_hash: HASH_A, session_id: 's2', model: 'sonnet', tokens_input: 1000, cache_read_tokens: 0 });

    const s = getSystemPromptUsageStats(db.instance, HASH_A);
    expect(s.reqs).toBe(2);
    expect(s.cache_hit_pct).toBe(0);
    expect(s.distinct_sessions).toBe(2);
    expect(s.distinct_models).toBe(2);
  });

  it('미참조 hash: reqs=0, pct=null', () => {
    insertProxy(db, 'r1', { system_hash: HASH_A, tokens_input: 100, cache_read_tokens: 900 });

    const s = getSystemPromptUsageStats(db.instance, HASH_MISS);
    expect(s.reqs).toBe(0);
    expect(s.cache_hit_pct).toBeNull();
    expect(s.first_seen_at).toBeNull();
    expect(s.last_seen_at).toBeNull();
  });

  it('cache_creation 도 입력측 분모에 포함', () => {
    // input=0, cache_create=200, cache_read=800 → inputSide=1000, read=800 → 80%
    insertProxy(db, 'r1', { system_hash: HASH_A, session_id: 's1', tokens_input: 0, cache_creation_tokens: 200, cache_read_tokens: 800 });

    const s = getSystemPromptUsageStats(db.instance, HASH_A);
    expect(s.cache_hit_pct).toBeCloseTo(80, 1);
  });
});
