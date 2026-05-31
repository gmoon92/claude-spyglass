// app/BrowseLayout.tsx — browse 모드 레이아웃 셸 + 데이터 population 결선 (P4-06 셸 / P4-07 결선)
//
// 원본: index.html 의 .left-panel + .right-panel 골격 + main.js init 의 좌측 패널/차트 마운트 +
//   api.js fetchDashboard(:240) render 결선.
//   3컬럼 골격(좌측 Sidebar / 우측 Chart + default·detail)을 React 셸로 조립한다.
//
// 데이터 population (P4-07 — P4-06 boundary 닫기):
//   - 마운트 시 fetchDashboard(projects/types) + fetchModelUsage(model 도넛) + fetchAllSessions(세션 시드)
//     를 호출해 컨트롤드 props 로 세팅한다. 파생은 deriveBrowseData(순수, browse-data.ts).
//   - 좌측 세션 캐시는 sse-store.sessions(P4-05) 가 SSoT(라이브 갱신). 초기 history 는
//     fetchAllSessions → setSessions 로 시드하고, 이후 SSE 가 patch 한다(needsSessionsRefetch 신호 닫기).
//   - 도넛 cache 셋·타임라인 버킷(30분 sliding SSE 버퍼)·date-filter 전파는 별도 소스라
//     본 결선 범위 밖(빈 값 유지 — 후속 결선이 호출처에서 합성). 회귀 0 게이트(수동 verify).
//   - fetch 사이드이펙트는 useEffect 안에서만(SSR effect 미발화). AbortController 로 언마운트 cleanup.
//
// 레이어(architecture.md §1.3): app → features(browse/dashboard) + stores 정방향.

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Sidebar, type ProjectLike, type SidebarLabeler } from '../features/browse/Sidebar';
import { Chart, type ChartTokens } from '../components/Chart';
import type { DataByKind, DonutDatum } from '../components/chart-data';
import { useSSEStore } from '../stores/sse-store';
import { useAppStore } from '../stores/app-store';
import { makeI18nLabeler } from './i18n-labeler';
import { deriveBrowseData } from './browse-data';
import { fetchDashboard, fetchAllSessions } from '../api/fetchers';
import { fetchModelUsage } from '../features/dashboard/metrics-fetchers';

/**
 * Chart 색 토큰 폴백 — design-tokens.css 주입 전(SSR/초기) 안전 기본.
 *   readToolColorsFromCss(dashboard) 결선은 후속 결선에서 호출처가 주입한다(본 페이즈 폴백 유지).
 */
const FALLBACK_TOKENS: ChartTokens = {
  modelTokens: { haiku: '#7dd3fc', sonnet: '#d97757', opus: '#a78bfa', external: '#f472b6', synthetic: '#6e7681', unknown: '#6e7681' },
  cacheTokens: { read: '#10B981', creation: '#B794F6', others: '#6E7681' },
  typeColors: { prompt: '#d97757', tool_call: '#4ade80', system: '#f59e0b' },
};

/**
 * 타임라인 버킷 폴백(빈) — 안정 ref(모듈 상수). 30분 sliding SSE 버퍼 결선은 후속(별도 소스).
 *
 * P5-04 성능: 인라인 `timelineBuckets={[]}` 는 매 렌더 새 배열 신원을 만들어 React.memo(Chart)의
 *   shallow 비교를 매번 깨고, Chart 의 timeline effect(dep=[timelineBuckets])를 SSE 이벤트마다
 *   재실행 + ResizeObserver 재등록 churn(5-20/s)을 유발했다. 안정 ref 로 교체해 memo 가 작동한다.
 */
const EMPTY_TIMELINE_BUCKETS: number[] = [];

export function BrowseLayout(): ReactElement {
  // 좌측 세션 캐시 — sse-store SSoT(라이브 갱신). 초기 history 는 아래 effect 가 setSessions 로 시드.
  const sessions = useSSEStore((s) => s.sessions);
  const setSessions = useSSEStore((s) => s.setSessions);

  const selectedProject = useAppStore((s) => s.selectedProject);
  const selectedSession = useAppStore((s) => s.selectedSession);
  const donutMode = useAppStore((s) => s.donutMode);

  // 데이터 population 상태 — fetchDashboard/fetchModelUsage 결과를 컨트롤드 props 로.
  const [projects, setProjects] = useState<ProjectLike[]>([]);
  const [donutType, setDonutType] = useState<DonutDatum[]>([]);
  const [donutModel, setDonutModel] = useState<DonutDatum[]>([]);

  const labeler: SidebarLabeler = useMemo(() => makeI18nLabeler(), []);

  // 도넛 데이터셋 — type(dashboard) + model(metrics) + cache(빈, 별도 소스). Chart 가 donutMode 로 활성셋 선택.
  const dataByKind: DataByKind = useMemo(
    () => ({ type: donutType, model: donutModel, cache: [] }),
    [donutType, donutModel],
  );

  // 마운트 1회 population — 전체 기간({}) 기준 초기 로드. range-filter 전파는 후속(별도 소스).
  // SSR(renderToStaticMarkup)에서는 미발화 → 컨트롤드 기본값(빈)으로 결정적 렌더.
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    (async () => {
      const [dashboard, modelUsage, allSessions] = await Promise.all([
        fetchDashboard({}, signal),
        fetchModelUsage({}),
        fetchAllSessions({}, 500, signal),
      ]);
      if (signal.aborted) return;
      const derived = deriveBrowseData(dashboard);
      setProjects(derived.projects);
      setDonutType(derived.donutType);
      setDonutModel((modelUsage as DonutDatum[]) ?? []);
      // 세션 캐시 시드 — sse-store SSoT(이후 SSE patch). needsSessionsRefetch 신호도 내려감.
      setSessions(allSessions as unknown as Parameters<typeof setSessions>[0]);
    })().catch(() => {
      /* silent — fetcher 가 이미 안전 폴백(null/[]). UI 는 빈 상태 유지(원본 silent catch 동치). */
    });
    return () => ctrl.abort();
  }, [setSessions]);

  return (
    <div className="browse-layout" data-testid="browse-layout">
      <aside className="left-panel" data-testid="browse-sidebar">
        <table className="browser-projects-table">
          <tbody>
            <Sidebar
              projects={projects}
              sessions={sessions}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              isMetaMode={false}
              metaCounts={null}
              labeler={labeler}
            />
          </tbody>
        </table>
      </aside>

      <main className="right-panel" data-testid="browse-main">
        <section className="chart-section">
          <Chart
            dataByKind={dataByKind}
            donutMode={donutMode}
            timelineBuckets={EMPTY_TIMELINE_BUCKETS}
            tokens={FALLBACK_TOKENS}
          />
        </section>
        {/* default/detail 뷰 전환은 app-store.rightView/selectedSession 기준 — DetailView 데이터
            결선(useSessionLoad)은 후속 결선에서 호출처가 주입한다. */}
      </main>
    </div>
  );
}
