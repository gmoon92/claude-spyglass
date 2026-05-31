// app/BrowseLayout.tsx — browse 모드 레이아웃 셸 (P4-06)
//
// 원본: index.html 의 .left-panel + .right-panel 골격 + main.js init 의 좌측 패널/차트 마운트.
//   3컬럼 골격(좌측 Sidebar / 우측 Chart + default·detail)을 React 셸로 조립한다.
//
// 데이터 결선 경계(P4-07 boundary):
//   - 좌측 세션 캐시는 sse-store.sessions(P4-05) 를 SSoT 로 구독한다(라이브 갱신 정합).
//   - 프로젝트 목록/도넛 데이터/타임라인 버킷은 fetch 오케스트레이션(F3 역전, api.js)이
//     아직 legacy .js 에 있어 본 페이즈에서는 store-derived/빈 값으로 마운트한다.
//     실제 데이터 population(fetchDashboard/fetchAllSessions/autoActivateProject 결선)은
//     index.html 진입 전환(P4-07)과 함께 수행한다. 마커/구조 계약은 본 셸이 확정한다.
//
// 레이어(architecture.md §1.3): app → features(browse/dashboard) + stores 정방향.

import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { Sidebar, type ProjectLike, type SidebarLabeler } from '../features/browse/Sidebar';
import { Chart, type ChartTokens } from '../components/Chart';
import type { DataByKind } from '../components/chart-data';
import { useSSEStore } from '../stores/sse-store';
import { useAppStore } from '../stores/app-store';
import { makeI18nLabeler } from './i18n-labeler';

/** 빈 도넛 데이터 — fetch 역전(P4-07) 전까지의 컨트롤드 기본값. */
const EMPTY_DATA: DataByKind = { type: [], model: [], cache: [] };

/**
 * Chart 색 토큰 폴백 — design-tokens.css 주입 전(SSR/초기) 안전 기본.
 *   readToolColorsFromCss(dashboard) 결선은 데이터 역전(P4-07)에서 호출처가 주입한다.
 */
const FALLBACK_TOKENS: ChartTokens = {
  modelTokens: { haiku: '#7dd3fc', sonnet: '#d97757', opus: '#a78bfa', external: '#f472b6', synthetic: '#6e7681', unknown: '#6e7681' },
  cacheTokens: { read: '#10B981', creation: '#B794F6', others: '#6E7681' },
  typeColors: { prompt: '#d97757', tool_call: '#4ade80', system: '#f59e0b' },
};

export function BrowseLayout(): ReactElement {
  // 좌측 세션 캐시 — sse-store SSoT(라이브 갱신). 프로젝트 목록은 P4-07 fetch 역전 전까지 빈 배열.
  const sessions = useSSEStore((s) => s.sessions);
  const projects = useMemo<ProjectLike[]>(() => [], []);

  const selectedProject = useAppStore((s) => s.selectedProject);
  const selectedSession = useAppStore((s) => s.selectedSession);
  const donutMode = useAppStore((s) => s.donutMode);

  const labeler: SidebarLabeler = useMemo(() => makeI18nLabeler(), []);

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
            dataByKind={EMPTY_DATA}
            donutMode={donutMode}
            timelineBuckets={[]}
            tokens={FALLBACK_TOKENS}
          />
        </section>
        {/* default/detail 뷰 전환은 app-store.rightView/selectedSession 기준 — DetailView 데이터
            결선(useSessionLoad)은 P4-07 진입 전환에서 호출처가 주입한다(F3 역전 의존). */}
      </main>
    </div>
  );
}
