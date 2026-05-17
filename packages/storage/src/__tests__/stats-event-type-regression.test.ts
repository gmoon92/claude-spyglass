/**
 * stats-event-type-dim 회귀 검증 (ADR-007).
 *
 * 검증 전략:
 *  - fixture를 적재 후, getRequestStats / getRequestStatsByType의 stats_hourly 기반
 *    반환값이 원본 requests에서 직접 계산한 값과 정확히 일치하는지 비교
 *  - 컬럼별 절대값 비교 (회귀 0)
 *  - avg_duration_ms는 부동소수점 ±0.01 허용 (실수 나눗셈 정밀도)
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createRequest,
  getRequestStats,
  getRequestStatsByType,
} from '../index';

const TEST_DB_PATH = `/tmp/spyglass-event-type-reg-${Date.now()}.db`;
const T0 = 1778904000000; // 2026-05-16 04:00 UTC

interface Reference {
  total_requests: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens: number;
  avg_tokens_per_request: number;
  avg_duration_ms: number;
}

function getReferenceFromRequests(db: SpyglassDatabase, fromTs?: number, toTs?: number): Reference {
  const conditions: string[] = ["(event_type IS NULL OR event_type = 'tool')"];
  const params: number[] = [];
  if (fromTs) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs)   { conditions.push('timestamp <= ?'); params.push(toTs); }
  return db.instance
    .query(
      `SELECT
         COUNT(*) AS total_requests,
         COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0) AS total_tokens_input,
         COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_output ELSE 0 END), 0) AS total_tokens_output,
         COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) AS total_tokens,
         COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) AS avg_tokens_per_request,
         COALESCE(AVG(duration_ms), 0) AS avg_duration_ms
       FROM requests
       WHERE ${conditions.join(' AND ')}`
    )
    .get(...params) as Reference;
}

describe('stats-event-type-dim 회귀 검증', () => {
  let db: SpyglassDatabase;
  let sessionId: string;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'reg-test',
      started_at: T0,
    });

    // 다양한 event_type 조합 fixture
    // tool (4건), prompt (2건), assistant_response (2건), pre_tool (1건 — 트리거 skip)
    const fixtures = [
      // tool — high confidence 3개 + low 1개
      { id: 'tool-1', event_type: 'tool',  tokens_input: 100, tokens_output: 200, tokens_total: 300, duration_ms: 1000, tokens_confidence: 'high' },
      { id: 'tool-2', event_type: 'tool',  tokens_input: 50,  tokens_output: 80,  tokens_total: 130, duration_ms: 500,  tokens_confidence: 'high' },
      { id: 'tool-3', event_type: 'tool',  tokens_input: 20,  tokens_output: 30,  tokens_total: 50,  duration_ms: 0,    tokens_confidence: 'high' },
      { id: 'tool-4', event_type: 'tool',  tokens_input: 999, tokens_output: 999, tokens_total: 1998, duration_ms: 200, tokens_confidence: 'low'  },
      // prompt
      { id: 'pr-1',   event_type: 'prompt', tokens_input: 10, tokens_output: 0, tokens_total: 10, duration_ms: 50, tokens_confidence: 'high' },
      { id: 'pr-2',   event_type: 'prompt', tokens_input: 20, tokens_output: 0, tokens_total: 20, duration_ms: 60, tokens_confidence: 'high' },
      // assistant_response
      { id: 'ar-1',   event_type: 'assistant_response', tokens_input: 0, tokens_output: 500, tokens_total: 500, duration_ms: 800, tokens_confidence: 'high' },
      { id: 'ar-2',   event_type: 'assistant_response', tokens_input: 0, tokens_output: 700, tokens_total: 700, duration_ms: 1200, tokens_confidence: 'high' },
      // pre_tool (skip 검증)
      { id: 'pre-1',  event_type: 'pre_tool', tokens_input: 99999, tokens_output: 99999, tokens_total: 99999, duration_ms: 0, tokens_confidence: 'low' },
    ];
    for (const f of fixtures) {
      createRequest(db.instance, {
        id: f.id,
        session_id: sessionId,
        timestamp: T0,
        type: f.event_type === 'pre_tool' ? 'tool_call'
              : f.event_type === 'tool' ? 'tool_call'
              : f.event_type === 'prompt' ? 'prompt'
              : 'response',
        event_type: f.event_type,
        model: 'reg-m',
        tokens_input: f.tokens_input,
        tokens_output: f.tokens_output,
        tokens_total: f.tokens_total,
        duration_ms: f.duration_ms,
        tokens_confidence: f.tokens_confidence,
      });
    }
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  });

  it('getRequestStats: 회귀 0 — 원본 requests 직접 계산과 정확히 일치', () => {
    const reference = getReferenceFromRequests(db);
    const actual = getRequestStats(db.instance);

    // 회귀 0 보장 (정수 컬럼)
    expect(actual.total_requests).toBe(reference.total_requests);
    expect(actual.total_tokens_input).toBe(reference.total_tokens_input);
    expect(actual.total_tokens_output).toBe(reference.total_tokens_output);
    expect(actual.total_tokens).toBe(reference.total_tokens);
    // 부동소수점 ±0.01 허용
    expect(actual.avg_tokens_per_request).toBeCloseTo(reference.avg_tokens_per_request, 2);
    expect(actual.avg_duration_ms).toBeCloseTo(reference.avg_duration_ms, 2);
  });

  it('getRequestStats: pre_tool은 stats_hourly에 미반영 → 99999가 합산되지 않음', () => {
    const stats = getRequestStats(db.instance);
    // pre_tool 행의 99999 토큰이 포함되면 total_tokens가 100000을 넘어가야 함
    expect(stats.total_tokens).toBeLessThan(10000);
  });

  it('getRequestStats: tokens_confidence=low인 tool-4 행은 토큰 합에서 제외', () => {
    const stats = getRequestStats(db.instance);
    // tool 4건 중 high 3건 (tool-1, tool-2, tool-3) 합산:
    //   tokens_input = 100 + 50 + 20 = 170
    //   tokens_output = 200 + 80 + 30 = 310
    //   tokens_total = 300 + 130 + 50 = 480
    expect(stats.total_tokens_input).toBe(170);
    expect(stats.total_tokens_output).toBe(310);
    expect(stats.total_tokens).toBe(480);
    // total_requests는 high/low 무관 — tool 4건 모두 카운트
    expect(stats.total_requests).toBe(4);
  });

  it('getRequestStatsByType: type별 GROUP BY 결과가 stats_hourly 기준', () => {
    const stats = getRequestStatsByType(db.instance);
    const byType = Object.fromEntries(stats.map((s) => [s.type, s]));

    // type='tool_call' (tool 4건만 — pre_tool은 stats_hourly에 없음)
    expect(byType['tool_call'].count).toBe(4);
    // type='prompt' (2건)
    expect(byType['prompt'].count).toBe(2);
    // type='response' (assistant_response 2건)
    expect(byType['response'].count).toBe(2);
  });

  it('event_type 차원 검증: stats_hourly에 tool/prompt/assistant_response 별개 행', () => {
    const rows = db.instance
      .query(
        `SELECT event_type, SUM(request_count) AS n
           FROM stats_hourly
          WHERE model = 'reg-m'
          GROUP BY event_type
          ORDER BY event_type ASC`
      )
      .all() as Array<{ event_type: string; n: number }>;

    expect(rows.length).toBe(3); // tool, prompt, assistant_response
    expect(rows.find((r) => r.event_type === 'tool')!.n).toBe(4);
    expect(rows.find((r) => r.event_type === 'prompt')!.n).toBe(2);
    expect(rows.find((r) => r.event_type === 'assistant_response')!.n).toBe(2);
  });
});
