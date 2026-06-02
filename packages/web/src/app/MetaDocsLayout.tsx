// app/MetaDocsLayout.tsx — metadocs 모드 레이아웃 조립 (P4-06 셸 / P4-07 결선 / meta-docs-view 콘텐츠)
//
// 원본: index.html 의 좌측 .left-panel(metadocs 축약: 프로젝트 + 요약 카드) + #metaDocsRoot(:779).
//   #metaDocsRoot(2ae3c39:index.html :779~):
//     .meta-tabs(#metaTabBar) — .meta-tabs-list(docs/tools 탭) + .meta-tabs-actions(date/lang 슬롯)
//     #metaDocsBody(.meta-docs-body, role=tabpanel) — docs 탭 본문:
//       #metaDocsFlowRegion(ego-graph) + #metaDocsFlowHandle(resize) + .meta-docs-catalog-area(filters+search+table)
//     #metaToolStatsBody(.meta-tool-stats-body, role=tabpanel) — tools 탭 본문(매트릭스)
//   meta-docs-view.js renderHtml(:647)/renderFilters(:836)/initMetaSubTabs(:82)/applyMetaSubTab(:309)
//     /autoLoadFirstRowFlow(:557) 의 DOM 조립을 React 선언 렌더로 1:1 재현 — meta-docs.css/flow-diagram.css 적용.
//
// 결선:
//   - 카탈로그 population: 마운트/프로젝트 변경 시 fetchMetaDocs(project) → rows. SSR effect 미발화 → 빈 결정적 렌더.
//   - 좌측 패널(left-panel): browse 와 동형 Sidebar 를 isMetaMode=true 로. projects 는 fetchDashboard 시드,
//     metaCounts 는 카탈로그 rows 에서 동기 계산(원본 pushLeftCounts:580 동치 — source_root basename 그룹핑).
//   - 서브탭(docs/tools): app-store.metaSubTab SSoT. 탭 클릭 → setMetaSubTab. tools 본문은 hidden 토글(원본 applyMetaSubTab).
//   - 카탈로그 컨트롤(type/display/includeDeleted/sort/search/activeRow)은 레이아웃 로컬 상태(원본 모듈 state 동치).
//     정렬 클릭 → nextSort 전이. 검색 → searchText. 행 클릭 → activeRow(flow 재중심).
//   - flow ego-graph: 정렬 결과 첫 "초점" 행 자동 중심(원본 autoLoadFirstRowFlow:557 우선순위 — id!=null && inv>0 → id!=null).
//     행 클릭/재중심(onRecenter)으로 activeRow 갱신(loadFlow re-fetch 동치).
//
// tools 탭 결선(vanilla→React 배선 완료):
//   - 도구 통계 매트릭스: fetchProjectToolStats(meta-docs colocated) → toolStats state → MetaDocsToolStats 주입.
//     탭 진입('tools')/프로젝트 변경 시 AbortController fetch(원본 loadProjectToolStats onActivate:311 동치).
//     정렬은 컨트롤드(toolSort + nextToolSort — tool-stats-sort SSoT).
//   - 좌측 요약 카드: MetaDocsSummaryCards(사용/미사용/orphan + behavior mini-bar). 카탈로그 rows 에서 파생
//     (computeRowCounts SSoT). 카드 클릭 → display 필터 전환(setDisplay).
//
// 비책임(후속 결선):
//   - date-filter/lang-switcher DOM 이동(원본 meta-tabs-actions 슬롯)은 별도 chrome(빈 슬롯 유지).
//   - tool-stats range 필터(원본 from/to)는 카탈로그 fetch 와 동형으로 전체 기간 — app-level range resolver 결선은 후속.
//
// 레이어(architecture.md §1.3): app → features(meta-docs/browse/dashboard) + stores 정방향.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MetaDocsCatalog,
  MetaDocsFilterBar,
  MetaDocsSearch,
  MetaDocsFlow,
  MetaDocsToolStats,
  MetaDocsSummaryCards,
  MetaDocsBehaviorBars,
  fetchProjectToolStats,
  nextSort,
  DEFAULT_SORT,
  applyDisplayFilter,
  filterMetaDocsByProject,
  isGlobalMetaDoc,
  type MetaDocRow,
  type MetaDocSortKey,
  type SortDir,
  type DisplayFilter,
  type TypeFilter,
  type MetaFilterGroup,
  type FlowActiveRow,
} from '../features/meta-docs';
import { useColResize } from '../components/use-col-resize';
import { useMetaDocsPanelResize } from '../features/browse/use-panel-resize';
import {
  nextSort as nextToolSort,
  DEFAULT_SORT as DEFAULT_TOOL_SORT,
  type ToolStatRow,
  type ToolStatsSortKey,
  type SortDir as ToolSortDir,
} from '../features/dashboard/tool-stats-sort';
import { MetaProjectList, type ProjectLike, type SidebarLabeler, type MetaCounts } from '../features/browse/Sidebar';
import { useAppStore } from '../stores/app-store';
import type { PresetValue } from '../stores/app-store';
import { tt, makeI18nLabeler } from './i18n-labeler';
import { deriveBrowseData } from './browse-data';
import { rangeToParams } from './compute-range';
import { fetchMetaDocs, fetchDashboard } from '../api/fetchers';
import { DateRangeDropdown, type DateRangeLabeler } from '../components/DateRangeDropdown';
import { useFloatingMenuPosition } from '../components/use-floating-menu-position';
import { LangSwitcherSlot } from '../components/LangSwitcherSlot';

/** GLOBAL_PROJECT_KEY(left-panel.js:17 / fetchers GLOBAL_PROJECT_KEY) — userSettings 글로벌 집계 키. */
const GLOBAL_PROJECT_KEY = '__global__';

/**
 * 좌측 프로젝트 카운트 계산 — 원본 pushLeftCounts(meta-docs-view.js:580) 동치(순수).
 *   source==='userSettings' || source_root==null → global. 그 외 source_root basename 그룹핑.
 */
function computeMetaCounts(rows: MetaDocRow[]): MetaCounts {
  const projects: Record<string, number> = Object.create(null);
  let global = 0;
  for (const r of rows) {
    // isGlobalMetaDoc / source_root basename 그룹핑은 project-filter.ts SSoT 와 동일 판정을 공유한다
    // (좌측 카운트와 우측 노출 행이 어긋나지 않도록).
    if (isGlobalMetaDoc(r)) {
      global += 1;
      continue;
    }
    const base = String(r.source_root).split('/').filter(Boolean).pop();
    if (!base) continue;
    projects[base] = (projects[base] ?? 0) + 1;
  }
  return { projects, global, total: rows.length };
}

/**
 * 정렬 결과 첫 "초점" 행 → flow activeRow 변환 — 원본 autoLoadFirstRowFlow(meta-docs-view.js:557) 우선순위.
 *   1) id!=null && invocations>0  2) id!=null. 둘 다 없으면 null(빈 flow).
 */
/** MetaDocRow.id(number|string|null) → FlowActiveRow.id(number|null) 정규화. 비수치/null → null. */
function toFlowId(id: number | string | null | undefined): number | null {
  if (typeof id === 'number') return Number.isFinite(id) ? id : null;
  if (typeof id === 'string') {
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickFlowRow(rows: MetaDocRow[]): FlowActiveRow | null {
  let pick = rows.find((r) => r.id != null && (r.invocations ?? 0) > 0);
  if (!pick) pick = rows.find((r) => r.id != null);
  if (!pick || !pick.name || !pick.type) return null;
  return { type: pick.type, name: pick.name, id: toFlowId(pick.id) };
}

/**
 * 동기화 아이콘 — 원본 svgRefresh({size:12})(design-system/icons/refresh.ts) 1:1 JSX 이식.
 *   stroke-only currentColor, viewBox 0 0 16 16. is-loading 클래스에서 meta-docs-spin 회전(CSS).
 *   MetaDocsFilterBar.TrashIcon 선례와 동일하게 dangerouslySetInnerHTML 대신 선언 JSX.
 */
function RefreshIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9" />
      <path d="M9.5 4.5h2.5V2" />
      <path d="M6.5 11.5H4V14" />
    </svg>
  );
}

/**
 * 카탈로그 테이블 컬럼 리사이즈 결선기 — useColResize(`[]` deps, 마운트 1회 부착)를
 *   테이블이 실제 존재할 때만 마운트시키기 위한 얇은 래퍼. 호출처가 present(테이블 존재) 토글에
 *   따라 key 를 바꿔 remount → 테이블 등장/구조 변화 시 핸들을 재부착(레거시 매-렌더 initColResize 동치).
 *   storageKey='metadocs' 로 피드('feed')·syslib('syslib') 와 영속 분리.
 */
function MetaCatalogColResize({ tableRef }: { tableRef: RefObject<HTMLTableElement> }): null {
  useColResize(tableRef, { storageKey: 'metadocs' });
  return null;
}

export function MetaDocsLayout(): ReactElement {
  // i18n(태스크 #12) — 언어 변경 구독. i18n.language 를 labeler 의존성으로 memo 된 자식(MetaProjectList 등)
  //   갱신 + 직접 tt() 는 재렌더로 재평가(window.I18n 동기). reload 불요.
  const { i18n } = useTranslation();
  // 라우팅/스코프 SSoT — app-store.
  const metaSubTab = useAppStore((s) => s.metaSubTab);
  const setMetaSubTab = useAppStore((s) => s.setMetaSubTab);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  // 날짜 필터 SSoT — browse 차트 헤더와 동일 app-store.activeRange(persist cs.dateRange) 공유.
  //   과거 vanilla(6341d2b)는 글로벌 #dateFilter 를 메타 모드에서도 노출(meta-tabs-actions 슬롯)했으나
  //   React 이식에서 슬롯이 빈 채로 남아 누락 — 카탈로그/도구 통계가 같은 기간 분모를 쓰도록 복원한다.
  const activeRange = useAppStore((s) => s.activeRange);
  const setActiveRange = useAppStore((s) => s.setActiveRange);

  // 카탈로그 데이터 + 좌측 프로젝트 시드.
  const [rows, setRows] = useState<MetaDocRow[]>([]);
  const [projects, setProjects] = useState<ProjectLike[]>([]);
  // 카탈로그 fetch 대기 — true 면 빈 상태 대신 스켈레톤(프로젝트 전환/초기 로딩 오해 방지).
  const [catalogLoading, setCatalogLoading] = useState(false);

  // 카탈로그 컨트롤 — 원본 모듈 state(meta-docs-view.js:46) 동치(레이아웃 로컬).
  const [type, setType] = useState<TypeFilter>('all');
  const [display, setDisplay] = useState<DisplayFilter>('all');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [sort, setSort] = useState<{ key: MetaDocSortKey; dir: SortDir }>(DEFAULT_SORT);
  const [searchTerm, setSearchTerm] = useState('');
  // flow 활성 행 — null 이면 첫 행 자동 중심(pickFlowRow). 행 클릭/재중심 시 명시 지정.
  const [activeRow, setActiveRow] = useState<FlowActiveRow | null>(null);

  // 동기화(재스캔) 트리거 — 원본 thead-sync-btn[data-meta-left-refresh] runRefresh(meta-docs-view.js:1001).
  //   레거시는 POST /api/meta-docs/refresh(재스캔) 후 loadMetaDocsLibrary(카탈로그 재조회). fetchers.ts 는
  //   본 작업 범위 밖(수정 금지)이라 refresh 엔드포인트 호출은 두지 않고, 카탈로그 재fetch 만 동치로 결선한다
  //   (refreshKey 증가 → 카탈로그 useEffect 재실행 = "알려진 cwd 재조회" 동등 — CLAUDE 지침).
  //   syncing 은 in-flight 동안 버튼 disabled + .is-loading(스피너) 표시(레거시 runRefresh 의 disabled/is-loading 동치).
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // tools 탭 도구 통계 — null=미로드(빈 매트릭스). 정렬은 컨트롤드(원본 tool-stats.js 전역 폐기).
  const [toolStats, setToolStats] = useState<ToolStatRow[] | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolSort, setToolSort] = useState<{ key: ToolStatsSortKey; dir: ToolSortDir }>(DEFAULT_TOOL_SORT);

  const labeler: SidebarLabeler = useMemo(() => makeI18nLabeler(), [i18n.language]);

  // date-filter 드롭다운 열림(트리거 토글 + 바깥클릭 닫기) — BrowseLayout 과 동일 패턴.
  const [dateOpen, setDateOpen] = useState(false);
  // 메뉴(fixed) 위치 계산 — 트리거 기준 우측 정렬. #metaDocsRoot overflow:hidden 클리핑 회피용 fixed.
  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  const dateMenuRef = useRef<HTMLDivElement>(null);
  useFloatingMenuPosition(dateOpen, dateTriggerRef, dateMenuRef);
  useEffect(() => {
    if (!dateOpen) return undefined;
    const onDocDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest('#dateFilter')) setDateOpen(false);
    };
    const doc = (globalThis as { document?: Document }).document;
    doc?.addEventListener('mousedown', onDocDown);
    return () => doc?.removeEventListener('mousedown', onDocDown);
  }, [dateOpen]);

  // date-filter i18n 라벨러 — BrowseLayout dateLabeler(ui.main.date-filter.*) 1:1.
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

  // 리사이저 결선(레거시 미결선 갭 — react-resize.md §2.2) — browse 와 동일 메커니즘 재사용.
  //   vTopHandleRef → #panelVerticalHandle(프로젝트 ↔ 요약카드), flowHandleRef → #metaDocsFlowHandle
  //   (flow ↔ 카탈로그), catalogAreaRef → .meta-docs-catalog-area. vProjectsRef → #browserProjectsSection.
  const { vTopHandleRef, vProjectsRef, flowHandleRef, catalogAreaRef } = useMetaDocsPanelResize();
  // 카탈로그 테이블 컬럼 리사이즈(원본 col-resize.js, storageKey='metadocs') — 테이블 ref 는 레이아웃 소유.
  const catalogTableRef = useRef<HTMLTableElement>(null);

  // 프로젝트(source_root) 필터 — 좌측에서 특정 프로젝트 선택 시 그 경로 문서로 좁힌다.
  //   서버 project 파라미터는 usage 집계만 좁히고 행 목록은 전체 source_root 를 반환하므로
  //   (다른 프로젝트의 동명 문서 혼입), 행 자체를 source_root basename 기준으로 추가로 좁힌다.
  //   전체/전역키 선택 시 통과(filterMetaDocsByProject SSoT).
  const projectFiltered = useMemo(
    () => filterMetaDocsByProject(rows, selectedProject, GLOBAL_PROJECT_KEY),
    [rows, selectedProject],
  );

  // 타입 필터 적용 — 원본 state.type(meta-docs-view.js:858) 동치. all 이면 통과.
  const typeFiltered = useMemo(
    () => (type === 'all' ? projectFiltered : projectFiltered.filter((r) => String(r.type ?? '') === type)),
    [projectFiltered, type],
  );

  // 좌측 카운트 — 전체 카탈로그(프로젝트/type 필터 전) 기준(원본 pushLeftCounts 는 probe rows 전체).
  const metaCounts = useMemo(() => computeMetaCounts(rows), [rows]);

  // flow 활성 행 — 명시 지정 우선, 없으면 정렬 대상 첫 초점 행 자동 선택.
  const flowRow = activeRow ?? pickFlowRow(typeFiltered);

  // 카탈로그 테이블 렌더 여부(MetaDocsCatalog 가 표시필터 적용 후 행이 있으면 <table>, 없으면 empty-state).
  //   col-resize 결선기(MetaCatalogColResize)는 테이블이 실제 존재할 때만 마운트해야 핸들이 thead 에 붙는다.
  const catalogHasRows = useMemo(
    () => applyDisplayFilter(typeFiltered, display).length > 0,
    [typeFiltered, display],
  );

  // 카탈로그 population — 프로젝트 변경/동기화 클릭(refreshKey) 시 재조회(전체 기간).
  //   SSR 미발화 → 빈 rows 결정적 렌더. refreshKey 증가도 본 effect 를 재실행해 카탈로그를 재조회한다
  //   (원본 runRefresh→loadMetaDocsLibrary 동치 — 재스캔 결과를 카탈로그/좌측 카운트에 반영).
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    setCatalogLoading(true);
    (async () => {
      const [list, dashboard] = await Promise.all([
        fetchMetaDocs({ project: selectedProject, range: rangeToParams(activeRange), signal }),
        fetchDashboard({}, signal),
      ]);
      if (signal.aborted) return;
      setRows(list as unknown as MetaDocRow[]);
      setProjects(deriveBrowseData(dashboard).projects);
      setActiveRow(null); // 프로젝트 변경 시 자동 첫 행 중심으로 리셋.
    })()
      .catch(() => {
        /* silent — fetcher 가 이미 안전 폴백([]/null). 빈 카탈로그 유지(원본 silent catch 동치). */
      })
      .finally(() => {
        if (!signal.aborted) {
          setSyncing(false); // in-flight 완료 → 버튼 복원(레거시 finally 동치).
          setCatalogLoading(false);
        }
      });
    return () => ctrl.abort();
  }, [selectedProject, refreshKey, activeRange]);

  // tools 탭 도구 통계 population — 원본 tool-stats.js loadProjectToolStats(view.js:311 onActivate).
  //   탭 진입('tools') / 프로젝트 변경 시 재조회(전체 기간 — 카탈로그 fetch 와 동형, range 미부착).
  //   AbortController 로 in-flight 취소. project null → fetcher 가 [] 반환(원본 select-project 빈 상태).
  useEffect(() => {
    if (metaSubTab !== 'tools') return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    setToolsLoading(true);
    (async () => {
      const range = rangeToParams(activeRange);
      const rows = await fetchProjectToolStats({ project: selectedProject, from: range.from, to: range.to, signal });
      if (signal.aborted) return;
      setToolStats(rows);
    })()
      .catch(() => {
        /* silent — fetcher 가 이미 [] 안전 폴백. 미로드 유지(원본 silent catch 동치). */
      })
      .finally(() => {
        if (!signal.aborted) setToolsLoading(false);
      });
    return () => ctrl.abort();
  }, [selectedProject, metaSubTab, activeRange]);

  // 정렬 헤더 클릭 → nextSort 전이(meta-docs-sort SSoT).
  const onSort = (key: MetaDocSortKey): void => setSort((prev) => nextSort(prev, key));

  // tools 매트릭스 정렬 헤더 클릭 → nextSort 전이(tool-stats-sort SSoT).
  const onToolSort = (key: ToolStatsSortKey): void => setToolSort((prev) => nextToolSort(prev, key));

  // 필터 버튼 클릭 → 그룹별 상태 갱신(원본 onMetaContainerClick 분기 동치).
  const onFilterChange = (group: MetaFilterGroup, value: string): void => {
    if (group === 'type') setType(value as TypeFilter);
    else setDisplay(value as DisplayFilter);
  };

  // 행 클릭 → flow 재중심(orphan 은 catalog 가 무시 — id null). 명시 activeRow 지정.
  const onRowClick = (row: MetaDocRow): void => {
    if (row.id == null || !row.name || !row.type) return;
    setActiveRow({ type: row.type, name: row.name, id: toFlowId(row.id) });
  };

  // 동기화 버튼 클릭 → 카탈로그 재조회 트리거(원본 runRefresh 재스캔+재조회 동치).
  //   in-flight(syncing) 중 중복 클릭은 무시(레거시 buttonEl.disabled 가드 동치).
  const onSync = (): void => {
    if (syncing) return;
    setSyncing(true);
    setRefreshKey((k) => k + 1);
  };

  const showTools = metaSubTab === 'tools';

  return (
    // Fragment — .main-layout grid 직계 자식으로 left-panel·metaDocsRoot 전개(원본 grid-column 3/4).
    <>
      {/* 좌측 패널(left-panel) — metadocs 모드 grid 골격을 레거시 index.html(:167~) 과 1:1 정합.
          left-panel.css 의 .left-panel 은 6-row CSS grid 이고, meta-docs.css(:688) 가 metadocs 모드에서
          grid-template-rows 를 `var(--projects-panel-height,220px) auto auto auto 1fr auto` 로 재정의한다.
          이 grid 는 위치형(positional) 자식 6벌(프로젝트섹션 → 핸들 → 요약카드 → 툴스탯 → filler → footer)을
          전제하므로, 자식이 2개뿐이면(이전 회귀) 테이블이 220px 트랙에 잘리고 요약카드가 auto 트랙에서 stretch 된다.
          따라서 레거시와 동일하게 #browserProjectsSection(panel-section flex-section > panel-body) +
          #panelVerticalHandle + #metaDocsSummaryCards 순서로 조립한다. */}
      <aside className="left-panel" data-testid="meta-docs-sidebar">
        {/* ── 프로젝트 섹션(원본 #browserProjectsSection) — panel-body 가 flex:1 + overflow-y:auto 로
            220px 고정 트랙 안에서 자체 스크롤(레거시 동치). 테이블을 직접 grid 자식으로 두면 self-scroll 이
            사라지고 row1 에 박혀 잘리던 회귀를 본 래퍼가 해소. ── */}
        <div className="panel-section flex-section" id="browserProjectsSection" ref={vProjectsRef}>
          <div className="panel-body">
            <table className="browser-projects-table">
              {/* colgroup — 원본 index.html(:178) 3컬럼 폭(이름 가변 | 항목 52px | 동기화 92px). */}
              <colgroup>
                <col />
                <col style={{ width: '52px' }} />
                <col style={{ width: '92px' }} />
              </colgroup>
              {/* metadocs thead(원본 tr.thead-metadocs, index.html:192) — [프로젝트 | 항목 | 동기화].
                  browse thead 는 metadocs 전용 레이아웃이라 미렌더(원본은 body[data-app-mode] CSS 로 단일 행만
                  노출했지만 본 컴포넌트는 metadocs 모드 전용이므로 metadocs thead 만 직접 렌더). 마지막 th 가
                  동기화 셀(.thead-sync-cell) — 재스캔/재조회 버튼(원본 data-meta-left-refresh runRefresh). */}
              <thead>
                <tr className="thead-metadocs">
                  <th>{tt('ui.html.left-panel.th-project') || 'Project'}</th>
                  <th style={{ textAlign: 'right' }}>{tt('ui.html.left-panel.th-item') || 'Items'}</th>
                  <th className="thead-sync-cell">
                    <button
                      type="button"
                      className={syncing ? 'thead-sync-btn is-loading' : 'thead-sync-btn'}
                      data-meta-left-refresh="1"
                      title={tt('ui.html.left-panel.sync-title')}
                      aria-label={tt('ui.html.left-panel.sync-title')}
                      disabled={syncing}
                      onClick={onSync}
                    >
                      <span className="thead-sync-icon" aria-hidden="true">
                        <RefreshIcon />
                      </span>
                      <span className="thead-sync-label">{tt('ui.html.left-panel.sync-label') || 'Sync'}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              {/* metadocs 전용 프로젝트 리스트 — 가상 global 행 + MetaProjectRow 만(SessionList 없음).
                  공유 Sidebar(ProjectList+SessionList)를 쓰면 SessionList 의 colSpan=4 빈 행이
                  3-col colgroup 의 fixed 레이아웃에 phantom 컬럼을 끼워 이름 col 을 절반으로 깎아
                  'claude-code-system' 이 잘렸다. 세션 행이 없는 metadocs 좌측을 전용 컴포넌트로 분리해
                  이름 col 이 가변 폭(나머지 전부)을 그대로 차지하도록 한다(레거시 1:1, browse 불변). */}
              <tbody>
                <MetaProjectList
                  projects={projects}
                  selectedProject={selectedProject}
                  metaCounts={metaCounts}
                  labeler={labeler}
                  onSelectProject={(p) => setSelectedProject(p)}
                />
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 프로젝트 ↔ 요약카드 상하 분할 핸들(원본 #panelVerticalHandle, :260). metadocs grid row2(8px).
            useMetaDocsPanelResize(vTopHandleRef)가 드래그 결선 — --projects-panel-height + spyglass:panel-split,
            computeAvailable metadocs 분기로 .left-panel 전체 높이 clamp(원본 initPanelVerticalResize 동치). ── */}
        <div
          className="panel-vertical-handle"
          id="panelVerticalHandle"
          title="Drag to resize height"
          ref={vTopHandleRef}
        />

        {/* 좌측 요약 카드(원본 #metaDocsSummaryCards / renderLeftSummaryCards:399) — 사용/미사용/orphan + behavior mini-bar.
            카드 클릭 → display 필터 전환(원본 data-meta-filter="display" 동치). 카운트 SSoT 는 전체 카탈로그 rows.
            컴포넌트 root 가 id=metaDocsSummaryCards 를 부여 — meta-docs.css 의 #metaDocsSummaryCards{display:flex}
            (id 셀렉터) 가 가로 1줄 배치를 적용하므로 grid row3(auto) 에 콘텐츠 높이만 차지. */}
        <MetaDocsSummaryCards rows={rows} onSelectDisplay={setDisplay} t={tt} />

        {/* behavior mini-bar(원본 #metaDocsToolStats / cardToolCategories, :274) — grid row4(auto).
            요약 카드와 별도 컨테이너여야 가로폭 전체를 써 막대가 노출된다(둘을 한 flex-row 에 같이 두면 카드 옆에
            붙어 눌리던 회귀). rows 비면 미렌더(트랙 0px). */}
        <MetaDocsBehaviorBars rows={rows} />
      </aside>

      {/* ── metaDocsRoot(원본 :779) — Behavior Definitions 카탈로그 컨테이너(grid-column 3/4). ── */}
      <section
        id="metaDocsRoot"
        className="meta-docs-root"
        aria-label="Behavior Definitions catalog"
        data-testid="meta-docs-root"
        data-meta-subtab={metaSubTab}
      >
        {/* meta-tabs(원본 :794 / initMetaSubTabs:82) — docs/tools 서브탭 + actions 슬롯. */}
        <div className="meta-tabs" role="tablist" aria-label="Behavior Definitions sub-tabs" id="metaTabBar">
          <div className="meta-tabs-list" role="presentation">
            <button
              type="button"
              className={metaSubTab === 'docs' ? 'ds-tab meta-tab active' : 'ds-tab meta-tab'}
              id="metaTabDocs"
              role="tab"
              aria-selected={metaSubTab === 'docs' ? 'true' : 'false'}
              aria-controls="metaDocsBody"
              data-meta-subtab="docs"
              data-tab-value="docs"
              onClick={() => setMetaSubTab('docs')}
            >
              {tt('ui.meta-docs-view.tab-docs-label') || 'Behavior Definitions'}
            </button>
            <button
              type="button"
              className={metaSubTab === 'tools' ? 'ds-tab meta-tab active' : 'ds-tab meta-tab'}
              id="metaTabToolStats"
              role="tab"
              aria-selected={metaSubTab === 'tools' ? 'true' : 'false'}
              aria-controls="metaToolStatsBody"
              data-meta-subtab="tools"
              data-tab-value="tools"
              onClick={() => setMetaSubTab('tools')}
            >
              {tt('ui.meta-docs-view.tab-tools-label') || 'Tools'}
            </button>
          </div>
          <div className="meta-tabs-actions">
            {/* date-filter(원본 meta-tabs-shared-date-filter, 6341d2b) — 글로벌 activeRange 를 메타 모드에서도
                노출. 카탈로그/도구 통계가 같은 기간 분모를 쓴다(위 fetch effect 에 range 전달). */}
            <div
              id="dateFilter"
              className="meta-tabs-date-range"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('.ds-dropdown-trigger')) setDateOpen((v) => !v);
              }}
            >
              <DateRangeDropdown
                activeRange={activeRange}
                labeler={dateLabeler}
                open={dateOpen}
                triggerRef={dateTriggerRef}
                menuRef={dateMenuRef}
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
            {/* lang-switcher — 전역 classic island 를 메타 탭 액션 슬롯으로 DOM 이동(BrowseLayout 과 동일 컴포넌트). */}
            <div id="metaTabsLangSwitcher" className="meta-tabs-lang-switcher">
              <LangSwitcherSlot />
            </div>
          </div>
        </div>

        {/* docs 본문(원본 :797) — flow region + 핸들 + .meta-docs-catalog-area(filters+search+table). */}
        <div
          id="metaDocsBody"
          className="meta-docs-body"
          role="tabpanel"
          aria-labelledby="metaTabDocs"
          aria-label="Behavior Definitions body"
          {...(showTools ? { hidden: true } : {})}
        >
          {/* flow ego-graph(원본 renderHtml flowRegion:661) — MetaDocsFlow 가 #metaDocsFlowRegion 내부 SVG 빌드. */}
          <MetaDocsFlow
            activeRow={flowRow}
            project={selectedProject}
            onRecenter={(row) => setActiveRow(row)}
            t={tt}
          />
          {/* resize 핸들(원본 flowHandle:662) — useMetaDocsPanelResize(flowHandleRef)가 드래그 결선.
              --meta-docs-flow-height + spyglass:meta-docs-flow-split, top=#metaDocsFlowRegion / bottom=.meta-docs-catalog-area
              (원본 initMetaDocsFlowResize 동치 — topEl 이 .left-panel 자손이 아니라 normal-path 가용높이). */}
          <div
            className="panel-vertical-handle meta-docs-flow-handle"
            id="metaDocsFlowHandle"
            title="Drag to resize height"
            ref={flowHandleRef}
          />
          {/* 카탈로그 영역(원본 .meta-docs-catalog-area:673) — 1fr + overflow-y:auto. */}
          <div className="meta-docs-catalog-area" ref={catalogAreaRef}>
            {/* 필터 바(원본 renderFilters:836) — type/display/includeDeleted + 검색(.meta-docs-filters 내부). */}
            <div className="meta-docs-filters">
              <MetaDocsFilterBar
                type={type}
                display={display}
                includeDeleted={includeDeleted}
                onFilterChange={onFilterChange}
                onIncludeDeletedChange={setIncludeDeleted}
                t={tt}
              />
              <MetaDocsSearch
                value={searchTerm}
                placeholder={tt('ui.meta-docs-view.search-placeholder')}
                clearLabel={tt('ui.meta-docs-view.search-placeholder')}
                onSearch={setSearchTerm}
              />
            </div>
            {/* 카탈로그 테이블(원본 head:680) — 정렬/표시필터/검색 위임(meta-docs-sort).
                tableRef 로 컬럼 리사이즈(useColResize) 부착(원본 col-resize.js, storageKey='metadocs'). */}
            <MetaDocsCatalog
              rows={typeFiltered}
              sort={sort}
              display={display}
              searchTerm={searchTerm}
              project={selectedProject}
              matched={typeFiltered.length > 0}
              onSort={onSort}
              onRowClick={onRowClick}
              activeRowName={flowRow?.name ?? null}
              tableRef={catalogTableRef}
              loading={catalogLoading}
              t={tt}
            />
            {/* col-resize 결선기 — 테이블이 실제 존재할 때만 마운트(catalogHasRows key 로 등장 시 재부착). */}
            {catalogHasRows ? (
              <MetaCatalogColResize
                key={`metadocs-colresize-${String(catalogHasRows)}`}
                tableRef={catalogTableRef}
              />
            ) : null}
          </div>
        </div>

        {/* tools 본문(원본 :809) — 도구 통계 매트릭스. stats=null(미로드) — fetcher 미존재(후속 결선). */}
        <div
          id="metaToolStatsBody"
          className="meta-tool-stats-body"
          role="tabpanel"
          aria-labelledby="metaTabToolStats"
          aria-label="Project tool stats"
          {...(showTools ? {} : { hidden: true })}
        >
          {showTools ? (
            <MetaDocsToolStats stats={toolStats} sort={toolSort} onSort={onToolSort} t={tt} loading={toolsLoading} />
          ) : null}
        </div>
      </section>
    </>
  );
}
