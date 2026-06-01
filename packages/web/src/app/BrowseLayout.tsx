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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ProjectLike, SidebarLabeler } from '../features/browse/Sidebar';
import { BrowseSidebar } from '../features/browse';
import { Chart, type ChartTokens } from '../components/Chart';
import { useColResize } from '../components/use-col-resize';
import { bucketizeByMinute, type DataByKind, type DonutDatum } from '../components/chart-data';
import { RequestRow, buildSearchHaystack } from '../components/render/RequestRow';
import { SearchBox } from '../components/SearchBox';
import { FilterBar, type FilterBarLabeler } from '../components/FilterBar';
import { subTypeOf, SUB_TYPES } from '../features/dashboard/request-types';
import { SessionDetailContainer } from '../features/session-detail';
import { DateRangeDropdown, type DateRangeLabeler } from '../components/DateRangeDropdown';
import { useSSEStore } from '../stores/sse-store';
import { useAppStore } from '../stores/app-store';
import type { PresetValue } from '../stores/app-store';
import { makeI18nLabeler, tt } from './i18n-labeler';
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
  // 피드 type 필터 / 검색 질의 — app-store SSoT(P2-08). 빈 div 였던 #feedSearchContainer·#typeFilterBtns 결선.
  const feedFilter = useAppStore((s) => s.feedFilter);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setFeedFilter = useAppStore((s) => s.setFeedFilter);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  // 차트 헤더 date-filter — activeRange SSoT(app-store, persist cs.dateRange).
  const activeRange = useAppStore((s) => s.activeRange);
  const setActiveRange = useAppStore((s) => s.setActiveRange);

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

  // 타임라인 sliding window tick — 1분마다 now 갱신해 버킷이 좌로 흐르게(원본 advanceBuckets 의 시간경과 대응).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // 30분 sliding 타임라인 버킷 — feed timestamp 를 현재 분 기준 30버킷에 분배(원본 recordRequest 증분 → 파생).
  const timelineBuckets: number[] = useMemo(() => {
    const ts = feedRows
      .map((r) => (typeof r.timestamp === 'number' ? r.timestamp : Number(r.timestamp)))
      .filter((n) => Number.isFinite(n)) as number[];
    return bucketizeByMinute(ts, nowTick);
  }, [feedRows, nowTick]);

  // 피드 type 필터 + 검색 — 원본 feed-interactions.js: sub-type 키는 data-sub-type, 그 외는 data-type 매칭 + haystack.includes.
  const filteredFeedRows: FeedRowLike[] = useMemo(() => {
    const isSubType = (SUB_TYPES as readonly string[]).includes(feedFilter);
    const q = searchQuery; // app-store 가 이미 normalize(trim+lowercase) 한 값.
    return feedRows.filter((r) => {
      if (feedFilter !== 'all') {
        const ok = isSubType
          ? subTypeOf(r as never) === feedFilter
          : ((r.type as string) ?? '') === feedFilter;
        if (!ok) return false;
      }
      if (q && !buildSearchHaystack(r as never).includes(q)) return false;
      return true;
    });
  }, [feedRows, feedFilter, searchQuery]);

  // FilterBar 라벨러 — window.I18n 키를 계약 형태로(무전역). 원본 filter-bar.js getFilterGroups SSoT 1:1.
  //   key 'tool_call'(data-type 계약) → i18n 키는 하이픈 'tool-call'(locale ui.filter-bar.tool-call). 그 외 동일.
  //   그룹 aria: request→request-type, tool→tool-category(원본 filter-bar.js:15,23).
  const filterLabeler: FilterBarLabeler = useMemo(() => {
    const i18nKey = (key: string) => key.replace(/_/g, '-');
    return {
      groupAria: (group) =>
        tt(group === 'request' ? 'ui.filter-bar.request-type' : 'ui.filter-bar.tool-category'),
      itemLabel: (key) => tt(`ui.filter-bar.${i18nKey(key)}`),
      itemTitle: (key) => tt(`ui.filter-bar.${i18nKey(key)}-title`),
    };
  }, []);

  // 피드 Session 셀(sess-id-link) 클릭 → 상세 이동(원본 feed-interactions.js#wireDefaultViewClicks).
  //   프로젝트 전환 분기 포함(레거시: data-goto-project 가 현재와 다르면 프로젝트도 전환).
  const onGotoSession = useMemo(
    () => (id: string, project: string) => {
      if (project && project !== selectedProject) setSelectedProject(project);
      setSelectedSession(id);
      setRightView('detail');
    },
    [selectedProject, setSelectedProject, setSelectedSession, setRightView],
  );

  // 피드 테이블 컬럼 리사이즈(원본 col-resize.js) — useColResize 가 th 핸들 부착/드래그/영속.
  const feedTableRef = useRef<HTMLTableElement>(null);
  useColResize(feedTableRef, { storageKey: 'feed' });

  // ── 차트 헤더 chart-actions(원본 index.html chart-actions) ──
  // 차트 접기 토글(#btnToggleChart) — 로컬 state → #chartSection collapsed 클래스.
  const [chartCollapsed, setChartCollapsed] = useState(false);
  // date-filter 드롭다운 열림(트리거 클릭 토글 + 바깥클릭 닫기). 데이터 refilter 는 store activeRange 소비처 책임.
  const [dateOpen, setDateOpen] = useState(false);

  // date-filter 바깥 클릭 시 닫기(원본 dropdown outside-close).
  useEffect(() => {
    if (!dateOpen) return;
    const onDocDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest('#dateFilter')) setDateOpen(false);
    };
    const doc = (globalThis as { document?: Document }).document;
    doc?.addEventListener('mousedown', onDocDown);
    return () => doc?.removeEventListener('mousedown', onDocDown);
  }, [dateOpen]);

  // date-filter i18n 라벨러 — 원본 date-range-dropdown.js 키(ui.main.date-filter.*) 1:1.
  const dateLabeler: DateRangeLabeler = useMemo(
    () => ({
      presetLabel: (v) => tt(`ui.main.date-filter.${v}.label`),
      presetTitle: (v) => tt(`ui.main.date-filter.${v}.title`),
      triggerAria: () => tt('ui.main.date-filter.trigger-aria'),
      customFrom: () => tt('ui.main.date-filter.custom.from'),
      customTo: () => tt('ui.main.date-filter.custom.to'),
      customApply: () => tt('ui.main.date-filter.custom.apply'),
      customLabel: () => tt('ui.main.date-filter.custom.label'),
      formatCustom: (from, to) => {
        const fmt = (ms: number): string => {
          const d = new Date(ms);
          return Number.isFinite(ms) ? d.toISOString().slice(0, 10) : '';
        };
        return `${fmt(from)} ~ ${fmt(to)}`;
      },
    }),
    [],
  );

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
      <BrowseSidebar
        projects={projects}
        sessions={sessions}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        labeler={labeler}
        onSelectProject={(p) => setSelectedProject(p)}
        onSelectSession={(id) => {
          setSelectedSession(id);
          setRightView('detail');
        }}
      />

      <main className="right-panel" data-testid="browse-main">
        {/* ── chartSection(원본 :395) — 차트 섹션 카드. CSS 는 #chartSection/.view-section 키. ── */}
        <div className={`view-section card card--compact${chartCollapsed ? ' chart-collapsed' : ''}`} id="chartSection">
          <div className="view-section-header">
            {/* default-meta(원본 chart-default-meta) — 30분 sliding 타임라인 고정 라벨. */}
            <div className="chart-default-meta">
              <span className="panel-label">{tt('ui.html.chart-section.label')}</span>
              <span className="panel-hint" id="chartSubtitle">{tt('ui.html.chart-section.subtitle')}</span>
            </div>
            {/* detail-meta(원본 chart-detail-meta) — 세션 선택 시 세션ID/프로젝트 노출(CSS 가 모드별 토글). */}
            <div className="chart-detail-meta">
              <span className="detail-session-id" id="detailSessionId" title={selectedSession ?? ''}>
                {selectedSession ? `${selectedSession.slice(0, 8)}…` : ''}
              </span>
              <span className="detail-project" id="detailProject">{selectedProject ?? ''}</span>
              <span className="detail-tokens" id="detailTokens" />
              <span className="detail-ended-at" id="detailEndedAt" />
              <div className="detail-agg-badges" id="detailBadges" />
            </div>
            {/* actions(원본 chart-actions) — date-filter + lang-switcher + 차트 접기. */}
            <div className="chart-actions">
              <div
                className="date-filter"
                id="dateFilter"
                onClick={(e) => {
                  // 트리거 클릭 → 열림 토글(원본 dropdown trigger). 메뉴 내부 클릭은 토글하지 않음.
                  if ((e.target as HTMLElement).closest('.ds-dropdown-trigger')) setDateOpen((v) => !v);
                }}
              >
                <DateRangeDropdown
                  activeRange={activeRange}
                  labeler={dateLabeler}
                  open={dateOpen}
                  onSelectPreset={(v: PresetValue) => {
                    setActiveRange({ type: 'preset', value: v });
                    setDateOpen(false);
                  }}
                  onApplyCustom={(from, to) => {
                    setActiveRange({ type: 'custom', from, to });
                    setDateOpen(false);
                  }}
                />
              </div>
              {/* lang-switcher 는 index.html 정적 classic i18n island(#lang-switcher, lang-switcher.js 바인딩)이
                  SSoT — 여기서 중복 렌더하면 동일 id 충돌로 island 바인딩이 깨진다. 따라서 미렌더(island 유지). */}
              <button
                className="btn-toggle"
                id="btnToggleChart"
                type="button"
                title={tt('ui.html.chart-section.toggle-title')}
                aria-label={tt('ui.html.chart-section.toggle-aria')}
                onClick={() => setChartCollapsed((v) => !v)}
              >
                <svg className="ds-chevron" data-dir={chartCollapsed ? 'up' : 'down'} aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
          {/* charts-inner(원본 default-view.css) — grid 2fr/1fr. Chart 가 .chart-wrap(timeline) +
              .donut-section>.donut-wrap(donut) 2-셀을 직접 출력하므로 여기서 추가 래핑하지 않는다
              (래핑하면 직계 자식이 1개 → 2fr/1fr grid 붕괴, 도넛이 타임라인 아래로 어긋남 — WP14 버그). */}
          <div className="charts-inner">
            <Chart
              dataByKind={dataByKind}
              donutMode={donutMode}
              timelineBuckets={timelineBuckets}
              tokens={FALLBACK_TOKENS}
            />
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
                  <div id="feedSearchContainer" className="feed-search">
                    <SearchBox
                      value={searchQuery}
                      placeholder="model / tool / message"
                      clearLabel={tt('ui.search-box.clear-label')}
                      onSearch={setSearchQuery}
                    />
                  </div>
                  <div id="typeFilterBtns" className="type-filter-btns">
                    <FilterBar
                      dataAttr="feed-filter"
                      active={feedFilter}
                      labeler={filterLabeler}
                      onChange={setFeedFilter}
                    />
                  </div>
                </div>
              </div>
              <div className="feed-body" id="feedBody">
                <div className="scroll-lock-banner" id="scrollLockBanner" />
                <table ref={feedTableRef}>
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
                    {filteredFeedRows.map((r) => (
                      <RequestRow
                        key={(r.id as string) ?? Math.random()}
                        r={r}
                        opts={{ showSession: true, onGotoSession }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* detailView(원본 :644) — 세션 상세(헤더 + 턴뷰/로그). selectedSession 있을 때 마운트. */}
          <div id="detailView" className={detailActive ? 'right-view card active' : 'right-view card'}>
            {selectedSession ? (
              <SessionDetailContainer
                sessionId={selectedSession}
                projectName={selectedProject ?? ''}
              />
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
