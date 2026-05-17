/**
 * stats_proxy_hourly 통합 회귀 검증.
 *
 * 시나리오:
 *  - 다양한 model/error/stream/cost fixture 적재 후
 *  - 원본 proxy_requests에서 직접 계산한 값과 stats_proxy_hourly 합산이 정확히 일치
 *  - 응답시간/TTFT 평균이 AVG와 일치
 *  - 백필 idempotent (DELETE+INSERT 단일 트랜잭션)
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SpyglassDatabase, closeDatabase } from '../index';
import { rebuildStatsProxyHourly } from '../queries/stats/build-proxy-aggregate';

const TEST_DB_PATH = `/tmp/spyglass-proxy-int-${Date.now()}.db`;
const T0 = 1778904000000;

interface ProxyFixture {
  id: string;
  timestamp?: number;
  method?: string;
  path?: string;
  status_code?: number | null;
  response_time_ms?: number | null;
  first_token_ms?: number | null;
  model?: string | null;
  tokens_input?: number;
  tokens_output?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  cost_usd?: number | null;
  is_stream?: number;
  error_type?: string | null;
}

function insertProxy(db: SpyglassDatabase, row: ProxyFixture): void {
  db.instance.prepare(
    `INSERT INTO proxy_requests (
      id, timestamp, method, path, status_code, response_time_ms, first_token_ms,
      model, tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens,
      cost_usd, is_stream, error_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
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

interface Reference {
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

function referenceFromRequests(db: SpyglassDatabase): Reference {
  return db.instance
    .query(
      `SELECT
         COUNT(*)                                                                       AS request_count,
         SUM(CASE WHEN (status_code >= 400 OR error_type IS NOT NULL) THEN 1 ELSE 0 END) AS error_count,
         SUM(CASE WHEN is_stream = 1 THEN 1 ELSE 0 END)                                  AS stream_count,
         SUM(COALESCE(tokens_input,0))           AS tokens_input,
         SUM(COALESCE(tokens_output,0))          AS tokens_output,
         SUM(COALESCE(cache_creation_tokens,0))  AS cache_creation_tokens,
         SUM(COALESCE(cache_read_tokens,0))      AS cache_read_tokens,
         SUM(CASE WHEN response_time_ms IS NOT NULL THEN response_time_ms ELSE 0 END) AS response_time_ms_sum,
         SUM(CASE WHEN response_time_ms IS NOT NULL THEN 1 ELSE 0 END)                AS response_time_ms_count,
         SUM(CASE WHEN first_token_ms   IS NOT NULL THEN first_token_ms   ELSE 0 END) AS first_token_ms_sum,
         SUM(CASE WHEN first_token_ms   IS NOT NULL THEN 1 ELSE 0 END)                AS first_token_ms_count,
         SUM(COALESCE(cost_usd,0.0))                                                  AS cost_usd_sum
       FROM proxy_requests`
    )
    .get() as Reference;
}

function aggregateFromStats(db: SpyglassDatabase): Reference {
  return db.instance
    .query(
      `SELECT
         COALESCE(SUM(request_count), 0)          AS request_count,
         COALESCE(SUM(error_count), 0)            AS error_count,
         COALESCE(SUM(stream_count), 0)           AS stream_count,
         COALESCE(SUM(tokens_input), 0)           AS tokens_input,
         COALESCE(SUM(tokens_output), 0)          AS tokens_output,
         COALESCE(SUM(cache_creation_tokens), 0)  AS cache_creation_tokens,
         COALESCE(SUM(cache_read_tokens), 0)      AS cache_read_tokens,
         COALESCE(SUM(response_time_ms_sum), 0)   AS response_time_ms_sum,
         COALESCE(SUM(response_time_ms_count), 0) AS response_time_ms_count,
         COALESCE(SUM(first_token_ms_sum), 0)     AS first_token_ms_sum,
         COALESCE(SUM(first_token_ms_count), 0)   AS first_token_ms_count,
         COALESCE(SUM(cost_usd_sum), 0.0)         AS cost_usd_sum
       FROM stats_proxy_hourly`
    )
    .get() as Reference;
}

describe('stats_proxy_hourly 통합 회귀', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });

    // 다양한 fixture — 4 model × 다양한 케이스
    insertProxy(db, { id: 'a1', model: 'opus', status_code: 200, response_time_ms: 1500, first_token_ms: 200, tokens_input: 1000, tokens_output: 500, cost_usd: 0.015, is_stream: 1 });
    insertProxy(db, { id: 'a2', model: 'opus', status_code: 200, response_time_ms: 2500, first_token_ms: 300, tokens_input: 800, tokens_output: 400, cost_usd: 0.012 });
    insertProxy(db, { id: 'a3', model: 'opus', status_code: 500, error_type: 'overloaded', response_time_ms: 500, tokens_input: 100, cost_usd: 0.0 });
    insertProxy(db, { id: 'b1', model: 'sonnet', status_code: 200, response_time_ms: 800, first_token_ms: 100, tokens_input: 500, tokens_output: 200, cost_usd: 0.003, is_stream: 1 });
    insertProxy(db, { id: 'b2', model: 'sonnet', status_code: 200, response_time_ms: 1000, tokens_input: 600, tokens_output: 300, cost_usd: 0.004 });
    insertProxy(db, { id: 'c1', model: 'haiku', status_code: 429, error_type: 'rate_limit', response_time_ms: 200, tokens_input: 0 });
    insertProxy(db, { id: 'c2', model: 'haiku', status_code: 200, response_time_ms: 300, first_token_ms: 50, tokens_input: 200, tokens_output: 100, cost_usd: 0.0005 });
    insertProxy(db, { id: 'd1', model: null,   status_code: 200, response_time_ms: null, tokens_input: 50, cost_usd: 0.0001 });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  });

  it('회귀 0: 트리거 누적이 원본 proxy_requests 직접 계산과 정확히 일치', () => {
    const ref = referenceFromRequests(db);
    const actual = aggregateFromStats(db);

    expect(actual.request_count).toBe(ref.request_count);
    expect(actual.error_count).toBe(ref.error_count);
    expect(actual.stream_count).toBe(ref.stream_count);
    expect(actual.tokens_input).toBe(ref.tokens_input);
    expect(actual.tokens_output).toBe(ref.tokens_output);
    expect(actual.cache_creation_tokens).toBe(ref.cache_creation_tokens);
    expect(actual.cache_read_tokens).toBe(ref.cache_read_tokens);
    expect(actual.response_time_ms_sum).toBe(ref.response_time_ms_sum);
    expect(actual.response_time_ms_count).toBe(ref.response_time_ms_count);
    expect(actual.first_token_ms_sum).toBe(ref.first_token_ms_sum);
    expect(actual.first_token_ms_count).toBe(ref.first_token_ms_count);
    expect(actual.cost_usd_sum).toBeCloseTo(ref.cost_usd_sum, 6);
  });

  it('회귀 0: AVG(response_time_ms) FROM proxy_requests와 stats sum/count가 일치', () => {
    const expected = db.instance
      .query('SELECT COALESCE(AVG(response_time_ms), 0) AS avg FROM proxy_requests WHERE response_time_ms IS NOT NULL')
      .get() as { avg: number };
    const stats = aggregateFromStats(db);
    const actualAvg = stats.response_time_ms_count > 0
      ? stats.response_time_ms_sum / stats.response_time_ms_count
      : 0;

    expect(actualAvg).toBeCloseTo(expected.avg, 4);
  });

  it('rebuildStatsProxyHourly idempotent: 두 번 호출 결과 동일', () => {
    const before = aggregateFromStats(db);

    db.instance.transaction(() => { rebuildStatsProxyHourly(db.instance, { truncate: true }); })();
    const afterFirst = aggregateFromStats(db);

    db.instance.transaction(() => { rebuildStatsProxyHourly(db.instance, { truncate: true }); })();
    const afterSecond = aggregateFromStats(db);

    expect(afterFirst).toEqual(before);
    expect(afterSecond).toEqual(afterFirst);
  });

  it('NULL model: 빈 문자열로 정규화되어 별개 행', () => {
    const rows = db.instance
      .query("SELECT model, request_count FROM stats_proxy_hourly WHERE model=''")
      .all() as Array<{ model: string; request_count: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].request_count).toBe(1); // 'd1' 1건
  });

  it('cost_usd 부동소수점 누적: 원본과 6자리 정밀도 일치', () => {
    const refCost = db.instance
      .query('SELECT SUM(COALESCE(cost_usd, 0)) AS s FROM proxy_requests')
      .get() as { s: number };
    const statsCost = db.instance
      .query('SELECT SUM(cost_usd_sum) AS s FROM stats_proxy_hourly')
      .get() as { s: number };

    expect(statsCost.s).toBeCloseTo(refCost.s, 6);
  });

  it('백필 후 stats 행 수 = 고유 (hour, model) 조합 수', () => {
    db.instance.run('DELETE FROM stats_proxy_hourly');
    db.instance.transaction(() => { rebuildStatsProxyHourly(db.instance); })();

    // 고유 (hour, model) 조합 수를 서브쿼리로 산출
    const distinctCombos = db.instance
      .query(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT (timestamp/1000/3600)*3600 AS hr, COALESCE(model,'') AS m
             FROM proxy_requests
         )`
      )
      .get() as { n: number };
    const statsRows = db.instance
      .query('SELECT COUNT(*) AS n FROM stats_proxy_hourly')
      .get() as { n: number };

    expect(statsRows.n).toBe(distinctCombos.n);
  });
});
