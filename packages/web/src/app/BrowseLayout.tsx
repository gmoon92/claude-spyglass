// app/BrowseLayout.tsx — browse 모드 레이아웃 셸 + 우측 콘텐츠 조립 (P4-06 셸 / P4-07 결선 / right-panel content-switcher)
//
// 원본: index.html 의 .left-panel + .right-panel 골격.
//   right-panel(2ae3c39:index.html :269~):
//     #chartSection(.view-section.card.card--compact) — 헤더 + .charts-inner(타임라인/도넛/캐시)
//     .content-switcher
//       #defaultView(.right-view.active) — .view-section.fill.card → .feed-body#feedBody → table#requestsBody
//       #detailView(.right-view.card)    — 세션 상세(턴뷰/로그)
//   본 파일은 그 구조/클래스를 그대로 재현해 default-view.css / detail-view.css / table.css 가 적용되게 한다.
//
// 데이터 population:
//   - 마운트 시 fetchDashboard(projects/types) + fetchModelUsage(model 도넛) + fetchAllSessions(세션 시드)
//     + fetchRequests(피드 시드)를 호출해 컨트롤드 props 로 세팅한다.
//   - 좌측 세션 캐시는 sse-store.sessions(P4-05) 가 SSoT(라이브 갱신). 초기 history 는
//     fetchAllSessions → setSessions 로 시드하고, 이후 SSE 가 patch 한다.
//   - 피드(#requestsBody)는 sse-store.feed(라이브) + 초기 fetchRequests 시드를 id-dedup 병합해 렌더한다.
//     원본 feed-live.js prependRequest 의 DOM 행을 RequestRow(showSession:true) 선언적 렌더로 대체.
//   - default↔detail 전환은 app-store.rightView/selectedSession. Sidebar 세션 클릭 →
//     setSelectedSession + setRightView('detail'). 프로젝트 클릭 → setSelectedProject.
//
// 비책임(후속 결선):
//   - DetailView 의 턴/로그 데이터(turns/activeTurn) population — 세션 단건 turns fetch + useSessionLoad
//     오케스트레이션은 후속. 본 페이즈는 detailView 구조 마운트 + default↔detail 전환까지.
//   - 타임라인 버킷(30분 sliding SSE 버퍼) / 도넛 cache 셋 / date-filter 전파는 별도 소스(빈 값 유지).
//
// 레이어(architecture.md §1.3): app → features(browse/dashboard/session-detail) + stores 정방향.

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Sidebar, type ProjectLike, type SidebarLabeler } from '../features/browse/Sidebar';
import { Chart, type ChartTokens } from '../components/Chart';
import type { DataByKind, DonutDatum } from '../components/chart-data';
import { RequestRow } from '../components/render/RequestRow';
import { DetailView } from '../features/session-detail';
import { useSSEStore } from '../stores/sse-store';
import { useAppStore } from '../stores/app-store';
import { makeI18nLabeler } from './i18n-labeler';
import { deriveBrowseData } from './browse-data';
import { fetchDashboard, fetchAllSessions, fetchRequests, type RequestRow as RequestRowData } from '../api/fetchers';
import { fetchModelUsage } from '../features/dashboard/metrics-fetchers';

/**
 * Chart 색 토큰 폴백 — design-tokens.css 주입 전(SSR/초기) 안전 기본.
 */
const FALLBACK_TOKENS: ChartTokens = {
  modelTokens: { haiku: '#7dd3fc', sonnet: '#d97757', opus: '#a78bfa', external: '#f472b6', synthetic: '#6e7681', unknown: '#6e7681' },
  cacheTokens: { read: '#10B981', creation: '#B794F6', others: '#6E7681' },
  typeColors: { prompt: '#d97757', tool_call: '#4ade80', system: '#f59e0b' },
};

/** 타임라인 버킷 폴백(빈) — 안정 ref(모듈 상수). 30분 sliding SSE 버퍼 결선은 후속(별도 소스). */
const EMPTY_TIMELINE_BUCKETS: number[] = [];

/** RequestRow 가 받는 RowLike 최소 형태(피드 이벤트/REST 행 공용). */
type FeedRowLike = { id?: string | null; [k: string]: unknown };

export function BrowseLayout(): ReactElement {
  // 좌측 세션 캐시 + 라이브 피드 — sse-store SSoT.
  const sessions = useSSEStore((s) => s.sessions);
  const setSessions = useSSEStore((s) => s.setSessions);
  const feed = useSSEStore((s) => s.feed);

  const selectedProject = useAppStore((s) => s.selectedProject);
  const selectedSession = useAppStore((s) => s.selectedSession);
  const rightView = useAppStore((s) => s.rightView);
  const donutMode = useAppStore((s) => s.donutMode);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const setSelectedSession = useAppStore((s) => s.setSelectedSession);
  const setRightView = useAppStore((s) => s.setRightView);

  // 데이터 population 상태.
  const [projects, setProjects] = useState<ProjectLike[]>([]);
  const [donutType, setDonutType] = useState<DonutDatum[]>([]);
  const [donutModel, setDonutModel] = useState<DonutDatum[]>([]);
  // 피드 시드 — 초기 /api/requests. 이후 SSE feed 가 우선(id-dedup 병합).
  const [seedRequests, setSeedRequests] = useState<RequestRowData[]>([]);

  const labeler: SidebarLabeler = useMemo(() => makeI18nLabeler(), []);

  const dataByKind: DataByKind = useMemo(
    () => ({ type: donutType, model: donutModel, cache: [] }),
    [donutType, donutModel],
  );

  // 피드 행 — 라이브 feed(head=최신) + 초기 시드 병합. 동일 id 는 라이브 우선.
  const feedRows: FeedRowLike[] = useMemo(() => {
    const liveIds = new Set(feed.map((r) => r.id));
    const seedTail = seedRequests.filter((r) => !liveIds.has(r.id as string));
    return [...(feed as unknown as FeedRowLike[]), ...(seedTail as unknown as FeedRowLike[])];
  }, [feed, seedRequests]);

  // detail 활성 판정 — rightView==='detail' && 선택 세션 존재.
  const detailActive = rightView === 'detail' && !!selectedSession;

  // 마운트 1회 population — 전체 기간({}) 기준 초기 로드.
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    (async () => {
      const [dashboard, modelUsage, allSessions, requests] = await Promise.all([
        fetchDashboard({}, signal),
        fetchModelUsage({}),
        fetchAllSessions({}, 500, signal),
        fetchRequests({ limit: 200 }, signal),
      ]);
      if (signal.aborted) return;
      const derived = deriveBrowseData(dashboard);
      setProjects(derived.projects);
      setDonutType(derived.donutType);
      setDonutModel((modelUsage as DonutDatum[]) ?? []);
      setSessions(allSessions as unknown as Parameters<typeof setSessions>[0]);
      setSeedRequests(requests);
    })().catch(() => {
      /* silent — fetcher 가 이미 안전 폴백(null/[]). UI 는 빈 상태 유지(원본 silent catch 동치). */
    });
    return () => ctrl.abort();
  }, [setSessions]);

  return (
    // Fragment — .main-layout(AppShell) grid 직계 자식으로 left-panel·right-panel 전개.
    <>
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
              onSelectProject={(p) => setSelectedProject(p)}
              onSelectSession={(id) => {
                setSelectedSession(id);
                setRightView('detail');
              }}
            />
          </tbody>
        </table>
      </aside>

      <main className="right-panel" data-testid="browse-main">
        {/* ── chartSection(원본 :395) — 차트 섹션 카드. CSS 는 #chartSection/.view-section 키. ── */}
        <div className="view-section card card--compact" id="chartSection">
          <div className="view-section-header">
            <div className="chart-default-meta">
              <span className="panel-label">Request trend (live)</span>
              <span className="panel-hint" id="chartSubtitle">Last 30 min · live</span>
            </div>
          </div>
          <div className="charts-inner">
            <div className="chart-wrap" data-ctx-tooltip="context-growth">
              <Chart
                dataByKind={dataByKind}
                donutMode={donutMode}
                timelineBuckets={EMPTY_TIMELINE_BUCKETS}
                tokens={FALLBACK_TOKENS}
              />
            </div>
          </div>
        </div>

        {/* ── content-switcher(원본 :547) — default ↔ detail 뷰 전환 컨테이너. ── */}
        <div className="content-switcher">
          {/* defaultView(원본 :549) — 통계 차트(상단 chartSection) + 최근 요청 피드 테이블. */}
          <div id="defaultView" className={detailActive ? 'right-view' : 'right-view active'}>
            <div className="view-section fill card">
              <div className="view-section-header">
                <span className="panel-label">Recent requests</span>
                <div className="feed-controls">
                  <div id="feedSearchContainer" className="feed-search" />
                  <div id="typeFilterBtns" className="type-filter-btns" />
                </div>
              </div>
              <div className="feed-body" id="feedBody">
                <div className="scroll-lock-banner" id="scrollLockBanner" />
                <table>
                  <colgroup>
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '88px' }} />
                    <col style={{ width: '120px' }} />
                    <col style={{ width: '130px' }} />
                    <col />
                    <col style={{ width: '48px' }} />
                    <col style={{ width: '48px' }} />
                    <col style={{ width: '52px' }} />
                    <col style={{ width: '68px' }} />
                    <col style={{ width: '88px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Model</th>
                      <th>Message</th>
                      <th style={{ textAlign: 'right' }}>in</th>
                      <th style={{ textAlign: 'right' }}>out</th>
                      <th style={{ textAlign: 'right' }}>Cache</th>
                      <th style={{ textAlign: 'right' }}>Duration</th>
                      <th>Session</th>
                    </tr>
                  </thead>
                  <tbody id="requestsBody">
                    {feedRows.map((r) => (
                      <RequestRow key={(r.id as string) ?? Math.random()} r={r} opts={{ showSession: true }} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* detailView(원본 :644) — 세션 상세(헤더 + 턴뷰/로그). selectedSession 있을 때 마운트. */}
          <div id="detailView" className={detailActive ? 'right-view card active' : 'right-view card'}>
            {selectedSession ? (
              <DetailView
                sessionId={selectedSession}
                projectName={selectedProject ?? ''}
                totalTokens={null}
                endedAt={null}
                turns={[]}
                activeTurnId={null}
              />
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
