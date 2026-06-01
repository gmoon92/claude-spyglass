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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ProjectLike, SidebarLabeler } from '../features/browse/Sidebar';
import { BrowseSidebar } from '../features/browse';
import { type ChartTokens, type ChartLegendLabeler } from '../components/Chart';
import { TimelineChart } from '../components/TimelineChart';
import { useColResize } from '../components/use-col-resize';
import { type DataByKind, type DonutDatum } from '../components/chart-data';
import { RequestRow, buildSearchHaystack } from '../components/render/RequestRow';
import { SearchBox } from '../components/SearchBox';
import { FilterBar, type FilterBarLabeler } from '../components/FilterBar';
import { subTypeOf, SUB_TYPES } from '../features/dashboard/request-types';
import { SessionDetailContainer, useSessionDetail } from '../features/session-detail';
import { ContextChart } from '../features/dashboard/ContextChart';
import { toContextTurns, buildCacheDonut, type SessionTurnLike } from '../features/dashboard/detail-chart-data';
import { DateRangeDropdown, type DateRangeLabeler } from '../components/DateRangeDropdown';
import { useSSEStore } from '../stores/sse-store';
import { useAppStore } from '../stores/app-store';
import type { PresetValue } from '../stores/app-store';
import { makeI18nLabeler, tt } from './i18n-labeler';
import { deriveBrowseData } from './browse-data';
import { rangeToParams, rangeToMetricParams } from './compute-range';
import {
  fetchDashboard,
  fetchAllSessions,
  fetchRequests,
  fetchCacheStats,
  type RequestRow as RequestRowData,
} from '../api/fetchers';
import { fetchModelUsage } from '../features/dashboard/metrics-fetchers';
import { CachePanel } from '../features/dashboard/CachePanel';
import type { CacheStats } from '../features/dashboard/cache-stats';
import type { DashboardSummary } from '../schema/api-schema';
import { TimelineMeta } from '../components/TimelineMeta';
import { LangSwitcherSlot } from '../components/LangSwitcherSlot';

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
  // 좌측 세션 목록 초기/전환 로딩 — 첫 시드 fetch 전(또는 프로젝트 전환 중) 빈 목록을 "데이터 없음" 대신
  //   스켈레톤으로 보여주기 위한 표지. 초기값 true(마운트 직후 population fetch 예정).
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const feed = useSSEStore((s) => s.feed);

  const selectedProject = useAppStore((s) => s.selectedProject);
  const selectedSession = useAppStore((s) => s.selectedSession);
  const rightView = useAppStore((s) => s.rightView);
  const donutMode = useAppStore((s) => s.donutMode);
  const setChartMode = useAppStore((s) => s.setChartMode);
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
  // 차트 헤더 timeline-meta 통계(/api/dashboard summary) — 레거시 fetchDashboard stat 쓰기 복원.
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  // cache-panel-overall(/api/stats/cache) — 레거시 fetchCacheStats→renderCachePanel 복원.
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);

  const labeler: SidebarLabeler = useMemo(() => makeI18nLabeler(), []);

  // detail 활성 판정 — rightView==='detail' && 선택 세션 존재.
  const detailActive = rightView === 'detail' && !!selectedSession;

  // ── 이슈1: detail 모드 차트 데이터 — 선택 세션 turns 에서 파생 ──
  //   레거시 setChartMode('detail')(chart-policy.ts) + flat-view.ts(DETAIL_FILTER_CHANGED)가
  //   세션 turns/requests 로 cache 도넛 + #contextGrowthChart 를 채우던 경로 복원.
  //   useSessionDetail(read import)로 선택 세션 turns 를 가져온다. selectedSession 이 없으면 빈 turns.
  //   (SessionDetailContainer 도 동일 훅을 쓰지만 turns-fetcher 가 AbortController + silent 폴백이라
  //    중복 호출은 안전 — projection 캐시 없는 legacy read 경로의 read-only 조회.)
  const { turns: detailTurns, loading: detailLoading } = useSessionDetail(detailActive ? selectedSession : null);

  // ContextChart 입력(누적 토큰) — turns 의 prompt 통과(toContextTurns). default 모드엔 빈 배열.
  const contextTurns = useMemo(
    () => (detailActive ? toContextTurns(detailTurns as unknown as SessionTurnLike[]) : []),
    [detailActive, detailTurns],
  );

  // cache 도넛 2-슬라이스(레거시 flat-view.ts SSoT) — i18n 라벨 주입. default 모드엔 빈 배열.
  const donutCache: DonutDatum[] = useMemo(
    () =>
      detailActive
        ? buildCacheDonut(detailTurns as unknown as SessionTurnLike[], {
            cache: tt('ui.chart.label.cache'),
            others: tt('ui.chart.label.others'),
          })
        : [],
    [detailActive, detailTurns],
  );

  // 차트 모드 → 도넛 모드 SSoT 동기(레거시 setChartMode: detail→cache / default→model).
  //   store.donutMode 를 단일 진실로 유지하기 위해 detailActive 변화 시 setChartMode 로 흘린다
  //   (Chart 는 donutMode prop 컨트롤드 — dataByKind 와 함께 모드별 활성셋 선택).
  useEffect(() => {
    setChartMode(detailActive ? 'detail' : 'default');
  }, [detailActive, setChartMode]);

  const dataByKind: DataByKind = useMemo(
    () => ({ type: donutType, model: donutModel, cache: donutCache }),
    [donutType, donutModel, donutCache],
  );

  // 피드 행 — 라이브 feed(head=최신) + 초기 시드 병합. 동일 id 는 라이브 우선.
  const feedRows: FeedRowLike[] = useMemo(() => {
    const liveIds = new Set(feed.map((r) => r.id));
    const seedTail = seedRequests.filter((r) => !liveIds.has(r.id as string));
    return [...(feed as unknown as FeedRowLike[]), ...(seedTail as unknown as FeedRowLike[])];
  }, [feed, seedRequests]);

  // 타임라인 버킷 입력(feed timestamp epoch ms 배열) — feed 변경 시에만 갱신(ref 안정).
  //   30초 sliding window tick 과 bucketizeByMinute 파생은 TimelineChart 가 로컬 소유한다(병목 #2):
  //   tick state 를 여기서 빼내 30초 갱신이 BrowseLayout(=피드 테이블)을 재렌더하지 않게 한다.
  const feedTimestamps: number[] = useMemo(
    () =>
      feedRows
        .map((r) => (typeof r.timestamp === 'number' ? r.timestamp : Number(r.timestamp)))
        .filter((n) => Number.isFinite(n)) as number[],
    [feedRows],
  );

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

  // BrowseSidebar 콜백 — useCallback으로 안정화해 MemoProjectList/SessionList 의 memo를 보호.
  const handleSelectProject = useCallback((p: string) => setSelectedProject(p), [setSelectedProject]);
  const handleSelectSession = useCallback(
    (id: string) => {
      setSelectedSession(id);
      setRightView('detail');
    },
    [setSelectedSession, setRightView],
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

  // 도넛 범례/하단 total i18n 라벨러(레거시 renderTypeLegend 복원) — Chart 가 무전역 leaf 라 주입.
  //   cacheLabel: cache 슬라이스 안정 id → ui.chart.label.<id>(cache='캐시'/others='그 외').
  //   countUnit: 하단 #typeTotal — ui.chart.count-unit('{count}건'). noData: ui.chart.no-data.
  const donutLegendLabeler: ChartLegendLabeler = useMemo(
    () => ({
      cacheLabel: (id) => tt(`ui.chart.label.${id}`),
      countUnit: (countText) => tt('ui.chart.count-unit', { count: countText }),
      noData: () => tt('ui.chart.no-data'),
    }),
    [],
  );

  // timeline-meta i18n 라벨러 — 원본 index.html data-i18n 키(ui.html.timeline-meta.*) 1:1.
  const timelineMetaLabeler = useMemo(
    () => ({
      aria: () => tt('ui.html.timeline-meta.aria'),
      qualityGroupAria: () => tt('ui.html.timeline-meta.quality-group-aria'),
      qualityGroupLabel: () => tt('ui.html.timeline-meta.quality-group-label'),
      avgLabel: () => tt('ui.html.timeline-meta.avg-label'),
      errorRateLabel: () => tt('ui.html.timeline-meta.error-rate-label'),
      volumeGroupAria: () => tt('ui.html.timeline-meta.volume-group-aria'),
      volumeGroupLabel: () => tt('ui.html.timeline-meta.volume-group-label'),
      sessionsLabel: () => tt('ui.html.timeline-meta.sessions-label'),
      requestsLabel: () => tt('ui.html.timeline-meta.requests-label'),
      tokensLabel: () => tt('ui.html.timeline-meta.tokens-label'),
    }),
    [],
  );


  // population — activeRange 기준 로드. 마운트 1회 + activeRange 변경 시 재조회(date-filter-propagation).
  //   레거시 api.js: range 변경 → cs:active-range-changed → buildQuery(getDateRange()) 로 요청/통계/세션
  //   재조회. React 에선 activeRange 를 effect 의존성으로 두어 동일 재조회를 선언적으로 재현한다.
  //   range→params 변환은 compute-range(app 계층 어댑터, 레거시 computeRange/getMetricRangeParams 1:1):
  //     - REST(requests/dashboard/sessions/stats/cache): rangeToParams → {} | {from,to}
  //     - metrics(model-usage donut): rangeToMetricParams → {from,to} | {range:'all'}
  //   'all'/null 은 {} (전체) — 서버 기본. 재조회 결과가 빈 배열이어도 셸/피드 테이블 구조는 유지되어
  //   콘텐츠가 사라지지 않는다(행만 0개). fetcher 는 실패 시 안전 폴백([]/null)이라 throw 로 언마운트 없음.
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const restRange = rangeToParams(activeRange);
    const metricRange = rangeToMetricParams(activeRange);
    // 도넛 모델 분포 프로젝트 스코프(이슈2) — selectedProject 를 metrics 파라미터로 전파.
    //   서버 /api/metrics/model-usage 가 project 를 sessions JOIN 으로 스코프(미지정 시 전역).
    const modelUsageParams = selectedProject ? { ...metricRange, project: selectedProject } : metricRange;
    (async () => {
      const [dashboard, modelUsage, allSessions, requests, cache] = await Promise.all([
        fetchDashboard(restRange, signal),
        fetchModelUsage(modelUsageParams),
        fetchAllSessions(restRange, 500, signal),
        fetchRequests({ limit: 200, range: restRange }, signal),
        fetchCacheStats(restRange, signal),
      ]);
      if (signal.aborted) return;
      const derived = deriveBrowseData(dashboard);
      setProjects(derived.projects);
      setDonutType(derived.donutType);
      setDonutModel((modelUsage as DonutDatum[]) ?? []);
      setSessions(allSessions as unknown as Parameters<typeof setSessions>[0]);
      setSeedRequests(requests);
      // timeline-meta 통계 — fetchDashboard summary 재사용(별도 /api/stats 불요, api.js 와 동일 SoT).
      setSummary((dashboard?.summary as DashboardSummary | undefined) ?? null);
      // cache-panel-overall — /api/stats/cache 응답(camelCase hitRate/cacheReadTokens/cacheCreationTokens).
      setCacheStats((cache as unknown as CacheStats | null) ?? null);
    })()
      .catch(() => {
        /* silent — fetcher 가 이미 안전 폴백(null/[]). UI 는 빈 상태 유지(원본 silent catch 동치). */
      })
      .finally(() => {
        if (!signal.aborted) setSessionsLoading(false);
      });
    return () => ctrl.abort();
  }, [setSessions, activeRange, selectedProject]);

  // 진입 시 프로젝트 auto-select — 레거시 autoActivateProject(main.js:242) 1:1.
  //   selectedProject 가 비어있고 데이터가 도착하면 가장 최근 활동 프로젝트를 선택해 세션 리스트를 노출한다
  //   (미선택 → '프로젝트를 선택하세요' 빈 상태 회귀 방지). 우선순위:
  //     1) 가장 최근 활동(last_activity_at || started_at) 세션의 project_name
  //     2) 폴백: 첫 프로젝트(projects[0])
  //   (레거시의 localStorage 저장 키는 app-store 가 selectedProject 를 persist 하지 않으므로 생략 — 매 진입
  //    시 최근 활동 기준으로 재선택. stores 불변 유지.)
  //   detail 뷰로의 전환은 하지 않는다(세션은 사용자가 클릭) — 좌측 세션 리스트 노출이 목적.
  useEffect(() => {
    if (selectedProject) return;
    if (!projects.length) return;
    const latest = sessions.reduce<(typeof sessions)[number] | null>((best, s) => {
      const act = Number(s.last_activity_at ?? s.started_at ?? 0) || 0;
      const bestAct = best ? Number(best.last_activity_at ?? best.started_at ?? 0) || 0 : -1;
      return act > bestAct ? s : best;
    }, null);
    const target = latest?.project_name || projects[0]?.project_name;
    if (target) setSelectedProject(target);
  }, [selectedProject, projects, sessions, setSelectedProject]);

  return (
    // Fragment — .main-layout(AppShell) grid 직계 자식으로 left-panel·right-panel 전개.
    <>
      <BrowseSidebar
        projects={projects}
        sessions={sessions}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        sessionsLoading={sessionsLoading}
        labeler={labeler}
        onSelectProject={handleSelectProject}
        onSelectSession={handleSelectSession}
      />

      <main className="right-panel" data-testid="browse-main">
        {/* ── chartSection(원본 :395) — 차트 섹션 카드. CSS 는 #chartSection/.view-section 키. ──
            이슈1: detail 모드(세션 선택) 시 chart-mode-detail 클래스 부여(레거시 setChartMode).
            CSS(default-view.css :88~95,:254~258)가 이 클래스로 timeline/timeline-meta/chart-default-meta 를
            숨기고 #contextGrowthChart 를 노출 + 도넛은 아래 donutMode(cache)로 전환. */}
        <div
          className={`view-section card card--compact${chartCollapsed ? ' chart-collapsed' : ''}${detailActive ? ' chart-mode-detail' : ''}`}
          id="chartSection"
        >
          <div className="view-section-header">
            {/* default-meta(원본 chart-default-meta) — 30분 sliding 타임라인 고정 라벨. */}
            <div className="chart-default-meta">
              <span className="panel-label">{tt('ui.html.chart-section.label')}</span>
              <span className="panel-hint" id="chartSubtitle">{tt('ui.html.chart-section.subtitle')}</span>
            </div>
            {/* detail-meta(원본 chart-detail-meta) — 세션 선택 시 세션ID/프로젝트 노출.
                레거시 setChartMode 가 hidden 속성을 토글(default-view.css :87 .chart-detail-meta[hidden]).
                default 모드에선 hidden 으로 숨기고 detail 모드에서 노출(chart-default-meta 와 자리 교대). */}
            <div className="chart-detail-meta" hidden={!detailActive}>
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
              {/* lang-switcher(레거시 복원) — index.html 정적 classic island(#lang-switcher, lang-switcher.js 바인딩)을
                  여기 슬롯으로 DOM 이동해 차트 헤더에 노출한다(중복 id 회피 + 바인딩 보존). LangSwitcherSlot 참조. */}
              <LangSwitcherSlot />
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
            <TimelineChart
              dataByKind={dataByKind}
              donutMode={donutMode}
              feedTimestamps={feedTimestamps}
              tokens={FALLBACK_TOKENS}
              timelineMeta={<TimelineMeta summary={summary} labeler={timelineMetaLabeler} />}
              contextSlot={
                <ContextChart
                  turns={contextTurns}
                  loading={detailActive && detailLoading && contextTurns.length === 0}
                  sessionKey={selectedSession}
                />
              }
              legendLabeler={donutLegendLabeler}
            />
            {/* cache-panel-overall(원본 index.html :520~543) — charts-inner 3번째 행(.cache-panel grid 1/-1 전체폭).
                fetchCacheStats 결과 결선. CachePanel 이 .cache-panel 래퍼까지 출력하므로 추가 래핑하지 않는다. */}
            <CachePanel data={cacheStats} />
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
                    {filteredFeedRows.map((r, i) => (
                      <RequestRow
                        key={(r.id as string) ?? i}
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
