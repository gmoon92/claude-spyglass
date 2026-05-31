/**
 * browse-data.test.ts — BrowseLayout 데이터 population 파생 로직 (P4-07, TDD)
 *
 * 원본: assets/js/api.js fetchDashboard(:276-292) 의 render 직전 데이터 가공.
 *   renderProjects(d.projects) / setTypeData((d.types||[]).sort(count desc)) 의 "데이터 가공"만
 *   순수 함수로 추출한다(render 호출 0). BrowseLayout 의 useEffect 가 fetchDashboard 결과를
 *   본 함수로 가공해 projects/donut(type) state 로 세팅한다.
 *
 * 검증 관점(SSR 환경 — useEffect 미발화이므로 파생 로직만 단위 검증):
 *   1) projects: dashboard.projects 를 ProjectLike[] 로 통과(빈/누락 안전).
 *   2) donut type: dashboard.types 를 count desc 정렬(api.js:277 1:1) DonutDatum[] 로.
 *   3) null/누락 dashboard → 빈 결과(컨트롤드 기본값과 동치).
 */
import { describe, it, expect } from 'vitest';
import { deriveBrowseData } from '../browse-data';
import type { DashboardData } from '../../schema/api-schema';

function dash(over: Partial<DashboardData> = {}): DashboardData {
  return {
    summary: {
      totalSessions: 0, totalRequests: 0, totalTokens: 0, activeSessions: 0,
      avgDurationMs: null, p95DurationMs: null, errorRate: null,
    },
    requests: null,
    projects: [],
    types: [],
    active: [],
    ...over,
  } as DashboardData;
}

describe('deriveBrowseData — fetchDashboard 결과 → {projects, donutType}', () => {
  it('null dashboard → 빈 projects/donutType (컨트롤드 기본값 동치)', () => {
    const d = deriveBrowseData(null);
    expect(d.projects).toEqual([]);
    expect(d.donutType).toEqual([]);
  });

  it('projects 를 그대로 통과 (renderProjects 입력 1:1)', () => {
    const d = deriveBrowseData(dash({
      projects: [
        { project_name: 'p1', total_tokens: 50, active_count: 2 },
        { project_name: 'p2', total_tokens: 10, active_count: 0 },
      ] as DashboardData['projects'],
    }));
    expect(d.projects.map((p) => p.project_name)).toEqual(['p1', 'p2']);
    expect(d.projects[0].total_tokens).toBe(50);
  });

  it('types 를 count 내림차순 정렬 (api.js:277 setTypeData sort 1:1)', () => {
    const d = deriveBrowseData(dash({
      types: [
        { type: 'system', count: 2 },
        { type: 'prompt', count: 9 },
        { type: 'tool_call', count: 5 },
      ] as DashboardData['types'],
    }));
    expect(d.donutType.map((t) => t.type)).toEqual(['prompt', 'tool_call', 'system']);
    expect(d.donutType[0].count).toBe(9);
  });

  it('types 누락 → 빈 donutType (안전)', () => {
    const d = deriveBrowseData(dash({ types: undefined as unknown as DashboardData['types'] }));
    expect(d.donutType).toEqual([]);
  });
});
