/**
 * router.test.ts — metricsRouter 특성화 테스트 (T01).
 *
 * @description
 *   현재 프로덕션 동작 고정용 characterization test. 동작 변경 금지.
 *
 *   metricsRouter(req, db): GET /api/metrics/* 만 처리, 그 외 null 반환(api.ts fall-through).
 *   매칭 시 { success, data, meta } 봉투를 가진 JSON Response 반환.
 *   meta는 _shared.buildMeta(parseTimeWindow(url)) 결과 — range/from/to/generated_at.
 *
 *   DB는 SpyglassDatabase autoInit — 전체 스키마 + model_limits 시드(Migration 026) 포함.
 *
 * @see packages/server/src/metrics/router.ts
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SpyglassDatabase, closeDatabase, createSession, createRequest } from '@spyglass/storage';
import { metricsRouter } from '../router';

const TEST_DB_PATH = `/tmp/spyglass-metrics-router-${Date.now()}.db`;
const HOUR = 3_600_000;
const T0 = 1778904000000;
const SESSION = 'router-sess';

let db: SpyglassDatabase;

beforeEach(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  createSession(db.instance, { id: SESSION, project_name: 'router', started_at: T0 - 48 * HOUR });
});

afterEach(() => {
  closeDatabase();
  for (const ext of ['', '-wal', '-shm']) {
    try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
});

function get(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

async function call(path: string): Promise<Response | null> {
  return metricsRouter(get(path), db.instance);
}

// =============================================================================
// 라우팅 게이트 (엣지)
// =============================================================================

describe('metricsRouter — 라우팅 게이트', () => {
  it('GET이 아닌 메서드 → null', async () => {
    const req = new Request('http://localhost/api/metrics/model-usage', { method: 'POST' });
    expect(await metricsRouter(req, db.instance)).toBeNull();
  });

  it('/api/metrics/ 접두사 아님 → null', async () => {
    expect(await call('/api/dashboard')).toBeNull();
    expect(await call('/api/stats/overview')).toBeNull();
    expect(await call('/health')).toBeNull();
  });

  it('/api/metrics/ 접두사이나 미정의 경로 → null (fall-through)', async () => {
    expect(await call('/api/metrics/does-not-exist')).toBeNull();
    // 접두사만 있고 비어있음
    expect(await call('/api/metrics/')).toBeNull();
  });
});

// =============================================================================
// 응답 봉투 / meta (성공)
// =============================================================================

describe('metricsRouter — 응답 봉투', () => {
  it('정의된 경로 → Response, { success, data, meta } 봉투', async () => {
    const res = await call('/api/metrics/model-usage');
    expect(res).not.toBeNull();
    expect(res!.headers.get('Content-Type')).toBe('application/json');
    expect(res!.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await res!.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('meta');
    expect(body.meta).toHaveProperty('range');
    expect(body.meta).toHaveProperty('generated_at');
    expect(typeof body.meta.generated_at).toBe('number');
  });

  it('range 기본값 24h, 명시 range 반영', async () => {
    const def = await (await call('/api/metrics/model-usage'))!.json();
    expect(def.meta.range).toBe('24h');

    const wk = await (await call('/api/metrics/model-usage?range=7d'))!.json();
    expect(wk.meta.range).toBe('7d');

    const all = await (await call('/api/metrics/model-usage?range=all'))!.json();
    expect(all.meta.range).toBe('all');
    // range=all → from/to undefined (JSON에서 키 누락)
    expect(all.meta.from).toBeUndefined();
    expect(all.meta.to).toBeUndefined();
  });

  it('from/to 명시 → range=custom', async () => {
    const body = await (await call(`/api/metrics/model-usage?from=${T0}&to=${T0 + HOUR}`))!.json();
    expect(body.meta.range).toBe('custom');
    expect(body.meta.from).toBe(T0);
    expect(body.meta.to).toBe(T0 + HOUR);
  });
});

// =============================================================================
// 엔드포인트별 빈 데이터 형태 (현재 동작 고정)
// =============================================================================

describe('metricsRouter — 빈 데이터 응답 형태', () => {
  async function data(path: string): Promise<any> {
    return (await (await call(path))!.json()).data;
  }

  it('model-usage: 빈 배열', async () => {
    expect(await data('/api/metrics/model-usage?range=all')).toEqual([]);
  });

  it('cache-matrix: 빈 배열', async () => {
    expect(await data('/api/metrics/cache-matrix?range=all')).toEqual([]);
  });

  it('context-usage: buckets 4개 + total 0 + model_limits 배열', async () => {
    const d = await data('/api/metrics/context-usage?range=all');
    expect(d.buckets).toHaveLength(4);
    expect(d.buckets.map((b: any) => b.label)).toEqual(['<50%', '50-80%', '80-95%', '>95%']);
    for (const b of d.buckets) expect(b.session_count).toBe(0);
    expect(d.total).toBe(0);
    // 현재 동작 고정: model_limits는 배열이 아니라 getAllModelLimits 객체
    // { default, extended, context_1m_beta, seeds[] }
    expect(d.model_limits).toHaveProperty('default');
    expect(d.model_limits).toHaveProperty('extended');
    expect(d.model_limits).toHaveProperty('context_1m_beta');
    expect(Array.isArray(d.model_limits.seeds)).toBe(true);
  });

  it('activity-heatmap: 7×24 격자 + weekday_labels', async () => {
    const d = await data('/api/metrics/activity-heatmap?range=all');
    expect(d.cells).toHaveLength(7);
    expect(d.cells[0]).toHaveLength(24);
    expect(d.total).toBe(0);
    expect(d.weekday_labels).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('turn-distribution: 5개 버킷 + compaction_rate 0', async () => {
    const d = await data('/api/metrics/turn-distribution?range=all');
    expect(d.turn_distribution.map((b: any) => b.bucket)).toEqual(['1-3', '4-10', '11-25', '26-50', '51+']);
    expect(d.compaction_rate).toBe(0);
    expect(d.total_sessions).toBe(0);
  });

  it('agent-depth: 빈 distribution + summary 0', async () => {
    const d = await data('/api/metrics/agent-depth?range=all');
    expect(d.distribution).toEqual([]);
    expect(d.summary).toEqual({ no_agent: 0, single_agent: 0, multi_agent: 0, total: 0 });
  });

  it('tool-categories: 모든 카테고리 0건', async () => {
    const d = await data('/api/metrics/tool-categories?range=all');
    expect(Array.isArray(d)).toBe(true);
    for (const c of d) {
      expect(c.request_count).toBe(0);
      expect(c.percentage).toBe(0);
    }
  });

  it('anomalies-timeseries: 빈 배열', async () => {
    expect(await data('/api/metrics/anomalies-timeseries?range=all')).toEqual([]);
  });

  it('burn-rate: 위임 결과 봉투 형태', async () => {
    const d = await data(`/api/metrics/burn-rate?from=${T0}&to=${T0 + HOUR}`);
    expect(d).toHaveProperty('buckets');
    expect(d.current_total).toBe(0);
    expect(d.delta_pct).toBeNull();
  });

  it('cache-trend: 위임 결과 봉투 형태', async () => {
    const d = await data(`/api/metrics/cache-trend?from=${T0}&to=${T0 + HOUR}`);
    expect(d).toHaveProperty('buckets');
    expect(d.hit_rate_now).toBeNull();
    expect(d.savings_tokens_total).toBe(0);
  });

  it('proxy-trend: 위임 결과 봉투 형태', async () => {
    const d = await data(`/api/metrics/proxy-trend?from=${T0}&to=${T0 + HOUR}`);
    expect(d).toHaveProperty('buckets');
    expect(d.total_requests).toBe(0);
    expect(d.total_cost_usd).toBe(0);
  });
});

// =============================================================================
// 데이터 있는 대표 시나리오
// =============================================================================

describe('metricsRouter — 데이터 반영', () => {
  it('model-usage: percentage 비율 산출 + 봉투', async () => {
    createRequest(db.instance, {
      id: 'm1', session_id: SESSION, timestamp: T0, type: 'prompt',
      model: 'alpha', tokens_input: 100, tokens_total: 100,
    });
    createRequest(db.instance, {
      id: 'm2', session_id: SESSION, timestamp: T0 + 1000, type: 'prompt',
      model: 'alpha', tokens_input: 100, tokens_total: 100,
    });
    createRequest(db.instance, {
      id: 'm3', session_id: SESSION, timestamp: T0 + 2000, type: 'prompt',
      model: 'beta', tokens_input: 50, tokens_total: 50,
    });
    const d = (await (await call(`/api/metrics/model-usage?from=${T0 - HOUR}&to=${T0 + HOUR}`))!.json()).data;
    // request_count 내림차순/구현 순서와 무관하게 model→pct 매핑으로 검증
    const byModel: Record<string, any> = {};
    for (const row of d) byModel[row.model] = row;
    expect(byModel.alpha.request_count).toBe(2);
    expect(byModel.beta.request_count).toBe(1);
    // total=3 → alpha 66.7, beta 33.3 (round(x*1000)/10)
    expect(byModel.alpha.percentage).toBe(66.7);
    expect(byModel.beta.percentage).toBe(33.3);
  });

  it('model-usage: project 파라미터로 프로젝트별 스코프', async () => {
    // 두 프로젝트의 세션 — 같은 model 이지만 다른 프로젝트.
    createSession(db.instance, { id: 'sess-a', project_name: 'proj-a', started_at: T0 - HOUR });
    createSession(db.instance, { id: 'sess-b', project_name: 'proj-b', started_at: T0 - HOUR });
    createRequest(db.instance, {
      id: 'pa1', session_id: 'sess-a', timestamp: T0, type: 'prompt',
      model: 'alpha', tokens_input: 100, tokens_total: 100,
    });
    createRequest(db.instance, {
      id: 'pa2', session_id: 'sess-a', timestamp: T0 + 1000, type: 'prompt',
      model: 'alpha', tokens_input: 100, tokens_total: 100,
    });
    createRequest(db.instance, {
      id: 'pb1', session_id: 'sess-b', timestamp: T0 + 2000, type: 'prompt',
      model: 'beta', tokens_input: 50, tokens_total: 50,
    });

    const win = `from=${T0 - HOUR}&to=${T0 + HOUR}`;
    // project 미지정 → 전역(두 모델 모두).
    const all = (await (await call(`/api/metrics/model-usage?${win}`))!.json()).data;
    expect(all.map((r: any) => r.model).sort()).toEqual(['alpha', 'beta']);
    // project=proj-a → alpha 만, request_count=2, percentage=100.
    const a = (await (await call(`/api/metrics/model-usage?${win}&project=proj-a`))!.json()).data;
    expect(a.map((r: any) => r.model)).toEqual(['alpha']);
    expect(a[0].request_count).toBe(2);
    expect(a[0].percentage).toBe(100);
    // project=proj-b → beta 만.
    const b = (await (await call(`/api/metrics/model-usage?${win}&project=proj-b`))!.json()).data;
    expect(b.map((r: any) => r.model)).toEqual(['beta']);
    expect(b[0].request_count).toBe(1);
    // 미존재 프로젝트 → 빈 배열.
    const none = (await (await call(`/api/metrics/model-usage?${win}&project=nope`))!.json()).data;
    expect(none).toEqual([]);
  });

  it('anomalies-timeseries: bucket=day 파라미터 전달 동작', async () => {
    // 데이터 없어도 라우팅·파라미터 경로가 깨지지 않음을 고정
    const res = await call('/api/metrics/anomalies-timeseries?range=all&bucket=day');
    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
