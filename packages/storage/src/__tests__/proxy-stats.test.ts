/**
 * getProxyHourlyStats / getProxyHourlyStatsByModel 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  getProxyHourlyStats,
  getProxyHourlyStatsByModel,
} from '../index';

const TEST_DB_PATH = `/tmp/spyglass-proxy-stats-${Date.now()}.db`;
const T0 = 1778904000000;

function insertProxy(db: SpyglassDatabase, id: string, fields: Record<string, number | string | null>): void {
  db.instance.prepare(
    `INSERT INTO proxy_requests (
      id, timestamp, method, path, status_code, response_time_ms, first_token_ms,
      model, tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens,
      cost_usd, is_stream, error_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    (fields.timestamp as number) ?? T0,
    'POST',
    '/v1/messages',
    (fields.status_code as number) ?? 200,
    (fields.response_time_ms as number | null) ?? null,
    (fields.first_token_ms as number | null) ?? null,
    (fields.model as string | null) ?? null,
    (fields.tokens_input as number) ?? 0,
    (fields.tokens_output as number) ?? 0,
    0,
    0,
    (fields.cost_usd as number) ?? 0,
    (fields.is_stream as number) ?? 0,
    (fields.error_type as string | null) ?? null
  );
}

describe('getProxyHourlyStats', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    insertProxy(db, 'a1', { model: 'opus', status_code: 200, response_time_ms: 1000, first_token_ms: 100, tokens_input: 50, tokens_output: 100, cost_usd: 0.01, is_stream: 1 });
    insertProxy(db, 'a2', { model: 'opus', status_code: 500, response_time_ms: 2000, tokens_input: 10, error_type: 'overloaded' });
    insertProxy(db, 'b1', { model: 'haiku', status_code: 200, response_time_ms: 300, first_token_ms: 50, tokens_input: 20, tokens_output: 40, cost_usd: 0.001, is_stream: 1 });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  });

  it('전체 합산: total/error/stream/tokens/avg/cost', () => {
    const s = getProxyHourlyStats(db.instance);
    expect(s.total_requests).toBe(3);
    expect(s.error_count).toBe(1);
    expect(s.stream_count).toBe(2);
    expect(s.error_rate).toBeCloseTo(1 / 3, 3);
    expect(s.stream_rate).toBeCloseTo(2 / 3, 3);
    expect(s.total_tokens_input).toBe(80);
    expect(s.total_tokens_output).toBe(140);
    // avg_response_time: (1000+2000+300)/3 = 1100
    expect(s.avg_response_time_ms).toBeCloseTo(1100, 1);
    // avg_first_token: (100+50)/2 = 75
    expect(s.avg_first_token_ms).toBeCloseTo(75, 1);
    expect(s.total_cost_usd).toBeCloseTo(0.011, 6);
  });

  it('빈 DB: 0 값 반환', () => {
    db.instance.run('DELETE FROM proxy_requests');
    db.instance.run('DELETE FROM stats_proxy_hourly');
    const s = getProxyHourlyStats(db.instance);
    expect(s.total_requests).toBe(0);
    expect(s.error_rate).toBe(0);
    expect(s.avg_response_time_ms).toBe(0);
  });

  it('from/to 필터: 시간 범위 제한', () => {
    insertProxy(db, 'old', { timestamp: T0 - 7200 * 1000, model: 'opus', tokens_input: 9999 });
    // T0 이후만 포함
    const s = getProxyHourlyStats(db.instance, T0);
    expect(s.total_tokens_input).toBe(80); // 9999는 제외
  });
});

describe('getProxyHourlyStatsByModel', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    insertProxy(db, 'a1', { model: 'opus', tokens_input: 100, tokens_output: 200, response_time_ms: 1000 });
    insertProxy(db, 'a2', { model: 'opus', tokens_input: 200, tokens_output: 300, response_time_ms: 2000 });
    insertProxy(db, 'b1', { model: 'haiku', tokens_input: 50, tokens_output: 80, response_time_ms: 200 });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  });

  it('모델별 분리 + request_count DESC 정렬', () => {
    const stats = getProxyHourlyStatsByModel(db.instance);
    expect(stats).toHaveLength(2);
    expect(stats[0].model).toBe('opus');
    expect(stats[0].request_count).toBe(2);
    expect(stats[0].total_tokens_input).toBe(300);
    expect(stats[0].avg_response_time_ms).toBeCloseTo(1500, 1);

    expect(stats[1].model).toBe('haiku');
    expect(stats[1].request_count).toBe(1);
  });
});
