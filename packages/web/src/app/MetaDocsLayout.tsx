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

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
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
  type MetaDocRow,
  type MetaDocSortKey,
  type SortDir,
  type DisplayFilter,
  type TypeFilter,
  type MetaFilterGroup,
  type FlowActiveRow,
} from '../features/meta-docs';
import {
  nextSort as nextToolSort,
  DEFAULT_SORT as DEFAULT_TOOL_SORT,
  type ToolStatRow,
  type ToolStatsSortKey,
  type SortDir as ToolSortDir,
} from '../features/dashboard/tool-stats-sort';
import { Sidebar, type ProjectLike, type SidebarLabeler, type MetaCounts } from '../features/browse/Sidebar';
import { useAppStore } from '../stores/app-store';
import { tt, makeI18nLabeler } from './i18n-labeler';
import { deriveBrowseData } from './browse-data';
import { fetchMetaDocs, fetchDashboard } from '../api/fetchers';

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
    const src = (r as { source?: unknown }).source;
    const root = r.source_root;
    if (src === 'userSettings' || root == null) {
      global += 1;
      continue;
    }
    const base = String(root).split('/').filter(Boolean).pop();
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

export function MetaDocsLayout(): ReactElement {
  // 라우팅/스코프 SSoT — app-store.
  const metaSubTab = useAppStore((s) => s.metaSubTab);
  const setMetaSubTab = useAppStore((s) => s.setMetaSubTab);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);

  // 카탈로그 데이터 + 좌측 프로젝트 시드.
  const [rows, setRows] = useState<MetaDocRow[]>([]);
  const [projects, setProjects] = useState<ProjectLike[]>([]);

  // 카탈로그 컨트롤 — 원본 모듈 state(meta-docs-view.js:46) 동치(레이아웃 로컬).
  const [type, setType] = useState<TypeFilter>('all');
  const [display, setDisplay] = useState<DisplayFilter>('all');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [sort, setSort] = useState<{ key: MetaDocSortKey; dir: SortDir }>(DEFAULT_SORT);
  const [searchTerm, setSearchTerm] = useState('');
  // flow 활성 행 — null 이면 첫 행 자동 중심(pickFlowRow). 행 클릭/재중심 시 명시 지정.
  const [activeRow, setActiveRow] = useState<FlowActiveRow | null>(null);

  // tools 탭 도구 통계 — null=미로드(빈 매트릭스). 정렬은 컨트롤드(원본 tool-stats.js 전역 폐기).
  const [toolStats, setToolStats] = useState<ToolStatRow[] | null>(null);
  const [toolSort, setToolSort] = useState<{ key: ToolStatsSortKey; dir: ToolSortDir }>(DEFAULT_TOOL_SORT);

  const labeler: SidebarLabeler = useMemo(() => makeI18nLabeler(), []);

  // 타입 필터 적용 — 원본 state.type(meta-docs-view.js:858) 동치. all 이면 통과.
  const typeFiltered = useMemo(
    () => (type === 'all' ? rows : rows.filter((r) => String(r.type ?? '') === type)),
    [rows, type],
  );

  // 좌측 카운트 — 전체 카탈로그(type 필터 전) 기준(원본 pushLeftCounts 는 probe rows 전체).
  const metaCounts = useMemo(() => computeMetaCounts(rows), [rows]);

  // flow 활성 행 — 명시 지정 우선, 없으면 정렬 대상 첫 초점 행 자동 선택.
  const flowRow = activeRow ?? pickFlowRow(typeFiltered);

  // 카탈로그 population — 프로젝트 변경 시 재조회(전체 기간). SSR 미발화 → 빈 rows 결정적 렌더.
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    (async () => {
      const [list, dashboard] = await Promise.all([
        fetchMetaDocs({ project: selectedProject, signal }),
        fetchDashboard({}, signal),
      ]);
      if (signal.aborted) return;
      setRows(list as unknown as MetaDocRow[]);
      setProjects(deriveBrowseData(dashboard).projects);
      setActiveRow(null); // 프로젝트 변경 시 자동 첫 행 중심으로 리셋.
    })().catch(() => {
      /* silent — fetcher 가 이미 안전 폴백([]/null). 빈 카탈로그 유지(원본 silent catch 동치). */
    });
    return () => ctrl.abort();
  }, [selectedProject]);

  // tools 탭 도구 통계 population — 원본 tool-stats.js loadProjectToolStats(view.js:311 onActivate).
  //   탭 진입('tools') / 프로젝트 변경 시 재조회(전체 기간 — 카탈로그 fetch 와 동형, range 미부착).
  //   AbortController 로 in-flight 취소. project null → fetcher 가 [] 반환(원본 select-project 빈 상태).
  useEffect(() => {
    if (metaSubTab !== 'tools') return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    (async () => {
      const rows = await fetchProjectToolStats({ project: selectedProject, signal });
      if (signal.aborted) return;
      setToolStats(rows);
    })().catch(() => {
      /* silent — fetcher 가 이미 [] 안전 폴백. 미로드 유지(원본 silent catch 동치). */
    });
    return () => ctrl.abort();
  }, [selectedProject, metaSubTab]);

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
        <div className="panel-section flex-section" id="browserProjectsSection">
          <div className="panel-body">
            <table className="browser-projects-table">
              <tbody>
                <Sidebar
                  projects={projects}
                  sessions={[]}
                  selectedProject={selectedProject}
                  selectedSession={null}
                  isMetaMode={true}
                  metaCounts={metaCounts}
                  labeler={labeler}
                  onSelectProject={(p) => setSelectedProject(p)}
                  onSelectSession={() => {
                    /* metadocs 모드에는 세션 행이 없음(원본 좌측 축약). no-op. */
                  }}
                />
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 프로젝트 ↔ 요약카드 상하 분할 핸들(원본 #panelVerticalHandle, :260). metadocs grid row2(8px).
            드래그 결선(left-panel-vertical-resize)은 본 레이아웃 범위 밖 — 시각 핸들만(레거시도 동일 마크업). ── */}
        <div
          className="panel-vertical-handle"
          id="panelVerticalHandle"
          title="Drag to resize height"
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
            {/* date-filter / lang-switcher DOM 이동(원본 meta-tabs-actions) 은 별도 chrome — 빈 슬롯 유지. */}
            <div id="metaTabsDateRange" className="meta-tabs-date-range" />
            <div id="metaTabsLangSwitcher" className="meta-tabs-lang-switcher" />
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
          {/* resize 핸들(원본 flowHandle:662) — left-panel-vertical-resize 부착은 후속(시각 핸들만). */}
          <div
            className="panel-vertical-handle meta-docs-flow-handle"
            id="metaDocsFlowHandle"
            title="Drag to resize height"
          />
          {/* 카탈로그 영역(원본 .meta-docs-catalog-area:673) — 1fr + overflow-y:auto. */}
          <div className="meta-docs-catalog-area">
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
            {/* 카탈로그 테이블(원본 head:680) — 정렬/표시필터/검색 위임(meta-docs-sort). */}
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
              t={tt}
            />
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
            <MetaDocsToolStats stats={toolStats} sort={toolSort} onSort={onToolSort} t={tt} />
          ) : null}
        </div>
      </section>
    </>
  );
}
