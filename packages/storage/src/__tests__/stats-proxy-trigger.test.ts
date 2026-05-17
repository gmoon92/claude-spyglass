/**
 * stats_proxy_hourly 트리거 + 재집계 단위 테스트 (proxy-hourly ADR-001~005).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SpyglassDatabase, closeDatabase } from '../index';
import { rebuildStatsProxyHourly } from '../queries/stats/build-proxy-aggregate';

const TEST_DB_PATH = `/tmp/spyglass-proxy-trg-${Date.now()}.db`;
const T0 = 1778904000000;
const BUCKET = 1778904000;

interface ProxyRow {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  status_code: number | null;
  response_time_ms: number | null;
  first_token_ms: number | null;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number | null;
  is_stream: number;
  error_type: string | null;
}

function insertProxy(db: SpyglassDatabase, row: Partial<ProxyRow> & { id: string }): void {
  db.instance
    .prepare(
      `INSERT INTO proxy_requests (
        id, timestamp, method, path, status_code, response_time_ms, first_token_ms,
        model, tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens,
        cost_usd, is_stream, error_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.timestamp ?? T0,
      row.method ?? 'POST',
      row.path ?? '/v1/messages',
      row.status_code ?? 200,
      row.response_time_ms ?? null,
      row.first_token_ms ?? null,
      row.model ?? null,
      row.tokens_input ?? 0,
      row.tokens_output ?? 0,
      row.cache_creation_tokens ?? 0,
      row.cache_read_tokens ?? 0,
      row.cost_usd ?? 0,
      row.is_stream ?? 0,
      row.error_type ?? null
    );
}

interface StatsRow {
  hour_ts: number;
  model: string;
  request_count: number;
  error_count: number;
  stream_count: number;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  response_time_ms_sum: number;
  response_time_ms_count: number;
  first_token_ms_sum: number;
  first_token_ms_count: number;
  cost_usd_sum: number;
}

function selectStats(db: SpyglassDatabase, model: string): StatsRow[] {
  return db.instance
    .query(
      `SELECT hour_ts, model, request_count, error_count, stream_count,
              tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens,
              response_time_ms_sum, response_time_ms_count,
              first_token_ms_sum, first_token_ms_count, cost_usd_sum
         FROM stats_proxy_hourly
        WHERE model = ?
        ORDER BY hour_ts ASC`
    )
    .all(model) as StatsRow[];
}

describe('stats_proxy_hourly trigger', () => {
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

  it('AFTER INSERT: 정상 200 응답 → stats 누적', () => {
    insertProxy(db, {
      id: 'p1', model: 'mx-1', status_code: 200,
      response_time_ms: 1500, first_token_ms: 200,
      tokens_input: 100, tokens_output: 200, cache_read_tokens: 50,
      cost_usd: 0.001, is_stream: 0,
    });

    const rows = selectStats(db, 'mx-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hour_ts: BUCKET, model: 'mx-1',
      request_count: 1, error_count: 0, stream_count: 0,
      tokens_input: 100, tokens_output: 200, cache_read_tokens: 50,
      response_time_ms_sum: 1500, response_time_ms_count: 1,
      first_token_ms_sum: 200, first_token_ms_count: 1,
    });
    expect(rows[0].cost_usd_sum).toBeCloseTo(0.001, 6);
  });

  it('error_count: status_code>=400 OR error_type IS NOT NULL', () => {
    insertProxy(db, { id: 'p-ok',  model: 'em', status_code: 200 });
    insertProxy(db, { id: 'p-400', model: 'em', status_code: 400 });
    insertProxy(db, { id: 'p-500', model: 'em', status_code: 500 });
    insertProxy(db, { id: 'p-err', model: 'em', status_code: 200, error_type: 'overloaded' });

    const stats = selectStats(db, 'em');
    expect(stats[0].request_count).toBe(4);
    expect(stats[0].error_count).toBe(3); // 400 + 500 + overloaded
  });

  it('stream_count: is_stream=1만 카운트', () => {
    insertProxy(db, { id: 's1', model: 'sm', is_stream: 1 });
    insertProxy(db, { id: 's2', model: 'sm', is_stream: 0 });
    insertProxy(db, { id: 's3', model: 'sm', is_stream: 1 });

    const stats = selectStats(db, 'sm');
    expect(stats[0].stream_count).toBe(2);
  });

  it('response_time_ms_count: NULL 제외 모든 행 (0 포함)', () => {
    insertProxy(db, { id: 'r-null', model: 'rt', response_time_ms: null });
    insertProxy(db, { id: 'r-zero', model: 'rt', response_time_ms: 0 });
    insertProxy(db, { id: 'r-100',  model: 'rt', response_time_ms: 100 });

    const stats = selectStats(db, 'rt');
    expect(stats[0].request_count).toBe(3);
    expect(stats[0].response_time_ms_count).toBe(2); // null만 제외, 0은 포함
    expect(stats[0].response_time_ms_sum).toBe(100);
  });

  it('hour bucket 분리: 다른 hour는 별개 행', () => {
    insertProxy(db, { id: 'h1', timestamp: T0,                  model: 'h' });
    insertProxy(db, { id: 'h2', timestamp: T0 + 3600 * 1000,    model: 'h' });

    const stats = selectStats(db, 'h');
    expect(stats).toHaveLength(2);
    expect(stats[0].hour_ts).toBe(BUCKET);
    expect(stats[1].hour_ts).toBe(BUCKET + 3600);
  });

  it('cost_usd_sum: 부동소수점 누적 (정밀도 6자리)', () => {
    insertProxy(db, { id: 'c1', model: 'c', cost_usd: 0.000123 });
    insertProxy(db, { id: 'c2', model: 'c', cost_usd: 0.000456 });
    insertProxy(db, { id: 'c3', model: 'c', cost_usd: 0.000789 });

    const stats = selectStats(db, 'c');
    expect(stats[0].cost_usd_sum).toBeCloseTo(0.001368, 6);
  });

  it('rebuildStatsProxyHourly: 트리거 결과와 동일', () => {
    insertProxy(db, { id: 'rb-1', model: 'rb', tokens_input: 100, response_time_ms: 500 });
    insertProxy(db, { id: 'rb-2', model: 'rb', tokens_input: 200, response_time_ms: 1500 });
    const before = selectStats(db, 'rb');

    db.instance.transaction(() => {
      rebuildStatsProxyHourly(db.instance, { truncate: true });
    })();

    const after = selectStats(db, 'rb');
    expect(after).toEqual(before);
  });
});
