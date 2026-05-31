// app/browse-data.ts — BrowseLayout 데이터 population 파생 (P4-07)
//
// 원본: assets/js/api.js fetchDashboard(:276-292) 의 render 직전 데이터 가공만 추출(render 호출 0).
//   renderProjects(d.projects)           → projects 통과
//   setTypeData((d.types||[]).sort(...))  → donutType (count 내림차순, api.js:277 1:1)
//
// BrowseLayout 의 useEffect 가 fetchDashboard(P3-03) 결과를 본 함수로 가공해 컨트롤드 props
//   (Sidebar.projects / Chart.dataByKind.type) 로 세팅한다. 모델 도넛(fetchModelUsage)·타임라인
//   버킷(30분 sliding SSE 버퍼)은 별도 소스라 본 파생 범위 밖(호출처가 합성 — Chart prop 으로 주입).
//
// 레이어: app leaf(순수 변환, 무전역/무스토어). SSR 안전(effect 미발화 시 호출 안 됨).

import type { DashboardData } from '../schema/api-schema';
import type { ProjectLike } from '../features/browse/Sidebar';
import type { DonutDatum } from '../components/chart-data';

/** BrowseLayout 컨트롤드 props 로 흘러갈 파생 결과. */
export interface BrowseDerived {
  /** Sidebar.projects — dashboard.projects 통과(renderProjects 입력 1:1). */
  projects: ProjectLike[];
  /** Chart dataByKind.type — types count 내림차순(setTypeData sort 1:1). */
  donutType: DonutDatum[];
}

/** 빈 결과 — null dashboard/누락 필드 시 컨트롤드 기본값과 동치. */
const EMPTY: BrowseDerived = { projects: [], donutType: [] };

/**
 * fetchDashboard 결과 → {projects, donutType}. null/누락 안전(빈 결과).
 * 입력 불변(복사 후 정렬 — api.js 의 .sort 는 새 배열 sort 였으므로 동치 안전).
 */
export function deriveBrowseData(dashboard: DashboardData | null): BrowseDerived {
  if (!dashboard) return EMPTY;

  // projects — passthrough(서버 행이 project_name/total_tokens/active_count 포함). 좁히기 캐스팅(any 미사용).
  const projects = Array.isArray(dashboard.projects)
    ? (dashboard.projects as unknown as ProjectLike[])
    : [];

  // types — count 내림차순(api.js:277). 입력 변형 회피 위해 복사 후 정렬.
  const types = Array.isArray(dashboard.types) ? dashboard.types : [];
  const donutType = [...types].sort(
    (a, b) => ((b as { count?: number }).count ?? 0) - ((a as { count?: number }).count ?? 0),
  ) as unknown as DonutDatum[];

  return { projects, donutType };
}
