/**
 * fetchers.test.ts — api.js 데이터 흐름 역전 검증 (P3-03, TDD)
 *
 * @description
 *   assets/js/api.js 의 render-coupled fetcher(fetchDashboard:240 / fetchRequests:304 /
 *   fetchAllSessions:344 / fetchCacheStats:354 / fetchSessionsByProject:364 /
 *   fetchObservability:388 / fetchProxyRequests:423 / fetchProxyStats:434)를
 *   src/api/fetchers.ts 로 이식하되 **fetch 후 직접 render 호출(9개 사이드이펙트)을 제거**하고
 *   **raw data 만 반환**함을 검증한다. 호출처(후속 React 계층)가 setState 를 담당한다.
 *
 *   검증 관점:
 *     1) raw data 반환 — fetcher 는 json.data(또는 P1-07 Zod 파싱 결과)만 반환.
 *     2) 스키마 검증(any 금지) — 무효 페이로드는 throw 없이 안전 폴백(null/[]),
 *        유효 페이로드는 정규화된 data 반환.
 *     3) render 사이드이펙트 0 — 소스에 left-panel/chart/obs-panel/cache-panel render
 *        호출·import 가 없고 document/store 참조가 없음(정적 검증).
 *     4) URL/params/abort 계약 — 엔드포인트·range·pagination·signal 전달.
 *
 *   하네스: hooks-api.test.ts(P2-06) 의 globalThis.fetch mock 패턴을 그대로 따른다.
 *
 * @see packages/web/assets/js/api.js
 * @see packages/web/src/schema/api-schema.ts (P1-07 Zod 재사용)
 * @see packages/web/docs/react-migration/_panel/dependency-safety.md §5 위험 #1
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fetchDashboard,
  fetchRequests,
  fetchAllSessions,
  fetchSessionsByProject,
  fetchCacheStats,
  fetchObservability,
  fetchProxyRequests,
  fetchProxyStats,
} from '../fetchers';

// ── fetch mock 하네스 (hooks-api.test.ts 1:1) ──────────────────────────────────
type MockCall = { url: string; init?: RequestInit };
let calls: MockCall[] = [];
let responder: (url: string, init?: RequestInit) => unknown;
let respondOk: (url: string) => boolean;

const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  responder = () => ({ data: {} });
  respondOk = () => true;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = responder(url, init);
    return Promise.resolve({
      ok: respondOk(url),
      status: respondOk(url) ? 200 : 500,
      json: () => Promise.resolve(body),
    } as Response);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── 픽스처 ─────────────────────────────────────────────────────────────────────

function validDashboardEnvelope() {
  return {
    data: {
      summary: {
        totalSessions: 3,
        totalRequests: 10,
        totalTokens: 100,
        activeSessions: 1,
        avgDurationMs: 5,
        p95DurationMs: 9,
        errorRate: 0,
      },
      requests: { avg_duration_ms: 5 },
      projects: [{ project_name: 'p1' }],
      types: [{ count: 4, type: 'prompt' }],
      active: [],
    },
  };
}

// /api/sessions 행 — wire 는 session_id 를 싣지만 도메인 Session(@spyglass/types)은 id.
// fetcher 반환 타입은 Session[] 이므로 도메인 필드(id/project_name)로 검증한다.
function validSession() {
  return { id: 's1', session_id: 's1', project_name: 'p1' };
}

// =============================================================================
// 1. fetchDashboard — raw DashboardData 반환 (render 사이드이펙트 제거)
// =============================================================================

describe('fetchDashboard (api.js:240 데이터 역전)', () => {
  it('GET /api/dashboard → DashboardData(raw) 반환 (render 호출 없이)', async () => {
    responder = () => validDashboardEnvelope();
    const data = await fetchDashboard();
    expect(calls[0].url).toContain('/api/dashboard');
    // raw data — summary/projects/types 를 그대로 반환, render 결과가 아님.
    expect(data?.summary.totalSessions).toBe(3);
    expect(data?.projects[0].project_name).toBe('p1');
    expect(data?.types[0].count).toBe(4);
  });

  it('range 파라미터 → from/to 쿼리 부착', async () => {
    responder = () => validDashboardEnvelope();
    await fetchDashboard({ from: 111, to: 222 });
    expect(calls[0].url).toContain('from=111');
    expect(calls[0].url).toContain('to=222');
  });

  it('무효 payload(summary 누락) → Zod 거부, null 안전 폴백(throw 금지)', async () => {
    responder = () => ({ data: { projects: [], types: [] } }); // summary 없음
    const data = await fetchDashboard();
    expect(data).toBeNull();
  });

  it('HTTP 실패 → null 폴백', async () => {
    respondOk = () => false;
    const data = await fetchDashboard();
    expect(data).toBeNull();
  });

  it('signal 전달 — 언마운트 cleanup 계약', async () => {
    responder = () => validDashboardEnvelope();
    const ctrl = new AbortController();
    await fetchDashboard(undefined, ctrl.signal);
    expect(calls[0].init?.signal).toBe(ctrl.signal);
  });
});

// =============================================================================
// 2. fetchRequests — raw list 반환 (FEED_UPDATED dispatch / DOM 쓰기 제거)
// =============================================================================

describe('fetchRequests (api.js:304 데이터 역전)', () => {
  it("filter='all' → GET /api/requests + limit/offset, raw list 반환", async () => {
    responder = () => ({ data: [{ id: 'r1' }, { id: 'r2' }] });
    const list = await fetchRequests({ filter: 'all', limit: 200, offset: 0 });
    expect(calls[0].url).toContain('/api/requests');
    expect(calls[0].url).toContain('limit=200');
    expect(calls[0].url).toContain('offset=0');
    expect(list.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it("filter !== 'all' → by-type 엔드포인트 + 인코딩", async () => {
    responder = () => ({ data: [] });
    await fetchRequests({ filter: 'tool call', limit: 50, offset: 100 });
    expect(calls[0].url).toContain('/api/requests/by-type/tool%20call');
    expect(calls[0].url).toContain('offset=100');
  });

  it('range 파라미터 부착', async () => {
    responder = () => ({ data: [] });
    await fetchRequests({ filter: 'all', range: { from: 5, to: 9 } });
    expect(calls[0].url).toContain('from=5');
    expect(calls[0].url).toContain('to=9');
  });

  it('HTTP 실패 → 빈 배열 폴백(throw 금지)', async () => {
    respondOk = () => false;
    const list = await fetchRequests({ filter: 'all' });
    expect(list).toEqual([]);
  });
});

// =============================================================================
// 3. fetchAllSessions / fetchSessionsByProject — raw Session[] (merge·render 제거)
// =============================================================================

describe('fetchAllSessions (api.js:344 데이터 역전)', () => {
  it('GET /api/sessions → raw Session[] 반환 (setAllSessions/render 없이)', async () => {
    responder = () => ({ data: [validSession(), validSession()] });
    const list = await fetchAllSessions();
    expect(calls[0].url).toContain('/api/sessions');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('s1');
    expect(list[0].project_name).toBe('p1');
  });

  it('HTTP 실패 → 빈 배열 폴백', async () => {
    respondOk = () => false;
    expect(await fetchAllSessions()).toEqual([]);
  });
});

describe('fetchSessionsByProject (api.js:364 데이터 역전)', () => {
  it('GET project sessions → raw Session[] 반환 (merge 는 호출처 책임)', async () => {
    responder = () => ({ data: [validSession()] });
    const list = await fetchSessionsByProject('my proj');
    expect(calls[0].url).toContain('/api/projects/my%20proj/sessions');
    expect(list).toHaveLength(1);
  });

  it('HTTP 실패 → 빈 배열 폴백', async () => {
    respondOk = () => false;
    expect(await fetchSessionsByProject('p')).toEqual([]);
  });
});

// =============================================================================
// 4. fetchCacheStats — raw CacheStats|null (renderCachePanel 제거)
// =============================================================================

describe('fetchCacheStats (api.js:354 데이터 역전)', () => {
  it('GET /api/stats/cache → raw data 반환', async () => {
    responder = () => ({ data: { hit_rate: 0.42 } });
    const data = await fetchCacheStats();
    expect(calls[0].url).toContain('/api/stats/cache');
    expect(data?.hit_rate).toBe(0.42);
  });

  it('HTTP 실패 → null 폴백', async () => {
    respondOk = () => false;
    expect(await fetchCacheStats()).toBeNull();
  });
});

// =============================================================================
// 5. fetchObservability — 4 payload 묶음 raw 반환 (5개 render 제거)
// =============================================================================

describe('fetchObservability (api.js:388 데이터 역전)', () => {
  it('4 엔드포인트 병렬 호출 → raw payload 묶음 반환 (render 없이)', async () => {
    responder = (url) => {
      if (url.includes('burn-rate')) return { data: { rate: 1 } };
      if (url.includes('cache-trend')) return { data: { trend: 2 } };
      if (url.includes('tool-categories')) return { data: [{ k: 'a' }] };
      if (url.includes('sessions/active')) return { data: [{ last_activity_at: 5 }] };
      return { data: null };
    };
    const obs = await fetchObservability();
    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.includes('/api/metrics/burn-rate'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/metrics/cache-trend'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/metrics/tool-categories'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/sessions/active'))).toBe(true);
    // raw payload 그대로 — render 호출 결과(void)가 아니라 4 필드 객체.
    expect(obs.burnRate).toEqual({ rate: 1 });
    expect(obs.cacheTrend).toEqual({ trend: 2 });
    expect(obs.toolCategories).toEqual([{ k: 'a' }]);
    expect(obs.activeSessions).toEqual([{ last_activity_at: 5 }]);
  });

  it('개별 엔드포인트 실패 → 해당 필드 null/[] 안전 폴백 (다른 필드 영향 없음)', async () => {
    respondOk = (url) => !url.includes('burn-rate'); // burn-rate 만 실패
    responder = () => ({ data: [] });
    const obs = await fetchObservability();
    expect(obs.burnRate).toBeNull();
    expect(Array.isArray(obs.toolCategories)).toBe(true);
  });
});

// =============================================================================
// 6. fetchProxyRequests / fetchProxyStats — 이미 raw 반환 (사이드이펙트 없음, 이식 검증)
// =============================================================================

describe('fetchProxyRequests / fetchProxyStats (이미 pure, 이식 동일성)', () => {
  it('fetchProxyRequests → raw 행 배열, limit 부착', async () => {
    responder = () => ({ data: [{ id: 'px1', timestamp: 1 }] });
    const list = await fetchProxyRequests(25);
    expect(calls[0].url).toContain('/api/proxy-requests?limit=25');
    expect(list[0].id).toBe('px1');
  });

  it('fetchProxyRequests HTTP 실패 → 빈 배열', async () => {
    respondOk = () => false;
    expect(await fetchProxyRequests()).toEqual([]);
  });

  it('fetchProxyStats → raw data 반환, since 부착', async () => {
    responder = () => ({ data: { total_requests: 7 } });
    const data = await fetchProxyStats(123);
    expect(calls[0].url).toContain('since=123');
    expect(data?.total_requests).toBe(7);
  });

  it('fetchProxyStats HTTP 실패 → null', async () => {
    respondOk = () => false;
    expect(await fetchProxyStats()).toBeNull();
  });
});

// =============================================================================
// 7. ★데이터 역전 정적 검증★ — render 사이드이펙트 0 + store 역참조 0
//    (dependency-safety.md §5 위험 #1 — fetch 와 DOM 변이 분리 증명)
// =============================================================================

describe('데이터 흐름 역전 — render 사이드이펙트/store 역참조 부재', () => {
  const RAW = readFileSync(
    fileURLToPath(new URL('../fetchers.ts', import.meta.url)),
    'utf8',
  );
  // 주석을 제거한 **실행 코드만** 검사한다. 문서 헤더는 "제거한 9개 사이드이펙트"를
  // 의도적으로 이름으로 나열하므로, 코드 호출/import 부재를 보려면 주석을 걷어내야 한다.
  const SRC = RAW
    .replace(/\/\*[\s\S]*?\*\//g, '') // 블록 주석
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 라인 주석(URL '://' 보존)

  // dependency-safety.md §5 가 명시한 9개 render 사이드이펙트.
  const RENDER_SIDE_EFFECTS = [
    'renderProjects',
    'setTypeData',
    'setSourceData',
    'drawDonut',
    'renderTypeLegend',
    'setAllSessions',
    'renderBrowserSessions',
    'renderCachePanel',
    'renderBurnRate',
    'renderCacheHealth',
    'renderToolCategoriesCard',
    'renderLivePulse',
    'renderAnomalyBadge',
  ];

  it.each(RENDER_SIDE_EFFECTS)('render 호출/import 없음: %s', (sym) => {
    expect(SRC.includes(sym)).toBe(false);
  });

  it('render 모듈 import 없음 (left-panel/chart/obs-panel/cache-panel)', () => {
    expect(SRC).not.toMatch(/from\s+['"][^'"]*left-panel/);
    expect(SRC).not.toMatch(/from\s+['"][^'"]*\/chart/);
    expect(SRC).not.toMatch(/from\s+['"][^'"]*obs-panel/);
    expect(SRC).not.toMatch(/from\s+['"][^'"]*cache-panel/);
  });

  it('store 역참조 0 (api/→stores/ 금지, done_criteria)', () => {
    expect(SRC).not.toMatch(/from\s+['"][^'"]*stores?\//);
    expect(SRC.includes('useAppStore')).toBe(false);
  });

  it('DOM 사이드이펙트 없음 (document/window 미참조)', () => {
    expect(SRC.includes('document.')).toBe(false);
    expect(SRC.includes('dispatchEvent')).toBe(false);
  });
});
