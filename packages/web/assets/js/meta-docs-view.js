/**
 * meta-docs-view.js — Behavior Definitions 카탈로그 + 히팅률 패널 (v26, meta-docs-table-view)
 *
 * 책임:
 *  - GET /api/meta-docs 로 카탈로그 + 사용 집계 받아 정렬·리사이즈 가능한 <table>로 노출.
 *  - 타입 필터(agent/skill/command/all), 스코프, 표시(전체/미사용/orphan), 정렬.
 *  - 직교 토글: includeDeleted — 디스크에서 사라진 soft-deleted 정의 포함 여부.
 *    의미 축이 다르므로 display 라디오와 분리한다 (ADR-001 meta-docs-filter).
 *  - thead 클릭 정렬 (↕/↑/↓ + aria-sort + accent active) + 우측 5px 드래그 핸들로 너비 조절
 *    (col-resize.js initColResize 재사용 — syslib 테이블과 동일 패턴).
 *  - 행 상태 시각 어휘(unused/deleted/orphan)는 meta-docs.css `.meta-doc-row.meta-doc-*` 룰에 위임.
 *  - "동기화" 버튼: POST /api/meta-docs/refresh — 비차단 토스트로 시작/완료/실패 단계 노출.
 *
 * 호출자: session-detail/turn-views.js setDetailView('metadocs')
 *
 * 의존성: formatters.js (escHtml, fmtTime), col-resize.js (initColResize), 기본 fetch.
 *
 * 캡슐화 원칙(CLAUDE.md):
 *  - 정렬/필터 판단 로직은 각자의 함수 한 곳에서만 처리. 호출 측은 raw 인자만 전달.
 *  - 렌더 함수는 escHtml/fmtTime/shortenPath/formatTokens/metaDocTypeBadge 기존 헬퍼를 우선 재사용.
 */

import { escHtml, fmtTime } from './formatters.js';
import { getCollator } from './i18n-utils.js';
import { getDateRange } from './api.js';
import { getSelectedProject, getMetaSubTab, setMetaSubTab as stateSetMetaSubTab } from './state.js';
import { toolIconHtml } from './render/badges.js';
import { skMetaDocList } from './render/skeleton.js';
import { svgTrash, svgWarn, svgRefresh } from './render/icons.js';
import { renderSortHead } from './design-system/markers/sort-head.js';
import { renderFilterBtn } from './design-system/primitives/filter-button.js';
import { renderTab } from './design-system/primitives/tab.js';
// meta-docs-table-view ADR-004 (2026-05-14): 로그/syslib 테이블과 동일한 col-resize 핸들을 부착.
import { initColResize } from './col-resize.js';
import { initMetaDocsFlowResize } from './left-panel-vertical-resize.js';
// meta-docs feedback ADR (2026-05-14): 좌측 패널에 프로젝트별 Behavior Definitions 항목 수를 주입.
import { setMetaDocsCounts } from './left-panel.js';
// ADR-004 meta-docs-tool-stats: 프로젝트 단위 도구 통계 진입점.
import { loadProjectToolStats } from './tool-stats.js';
// migration-plan §C: 통합 Flow 단일 모듈 — ego + sequential 토글 폐기.
//   `#metaDocsFlowRegion` 영역에 unified flow (좌 ancestor + center + 우 descendant) 렌더.
import { loadFlow, reloadLast } from './meta-docs-flow.js';
// meta-tabs-shared-date-filter (view-mode-reentry-filter-button-regression 2026-05-21):
//   chart-actions의 #dateFilter element를 metaTabsDateRange 슬롯으로 DOM 이동시켜
//   메타 모드에서도 노출. mountDateRangeDropdown은 main.js initDateFilter()가 1회 호출
//   (단일 인스턴스 보장) — 본 모듈은 element 이동/복귀만 책임진다.

const CONTAINER_ID = 'metaDocsBody';

// 필터/정렬 상태 — 모듈 단위로 보관 (탭 재진입 시 유지).
// meta-docs feedback ADR (2026-05-14): state.scope(legacy source 라벨 필터) 제거.
//   좌측 패널의 user(global)/프로젝트 행 선택이 scopeMode SSoT를 가져감.
const state = {
  type:    'all',          // 'all' | 'agent' | 'skill' | 'command'
  sort:    'invocations',  // 'invocations' | 'last_used_at' | 'name'
  sortDir: 'desc',         // 'asc' | 'desc'
  scopeMode: 'selected',   // 'selected' | 'all'
                           //   'selected' = 좌측 프로젝트 선택값을 따라 source_root로 필터
                           //   'all'      = 모든 프로젝트 카탈로그 합쳐서 표시
  display: 'all',          // 'all' | 'unused' | 'orphan' — 행 부분집합 선택 (단일 책임)
  includeDeleted: false,   // boolean — soft-deleted(디스크 사라진) 정의 포함 여부.
                           //   display와 직교(orthogonal). ADR-001 meta-docs-filter.
  // 마지막으로 결정된 source_root 매칭 결과 (헤더 표시 + 빈 상태 처리)
  resolvedSource: null,    // { project, sourceRoot, matched } | null
  // ADR-003 left-rail-meta-docs: 딥링크 검색어. 행 가시성 필터(이름 부분일치, 대소문자 무시).
  searchTerm: '',
};

/**
 * Wave 5 — meta-tab 2종 동적 생성.
 *
 * 책임:
 *  - #metaTabBar 컨테이너에 meta-tab 버튼 2개를 renderTab()으로 주입한다.
 *  - renderTab 기본 출력(ds-tab)에 기존 클래스(meta-tab / active), id,
 *    data-meta-subtab, aria-controls 를 .replace로 삽입하여 이중 클래스 패턴을 유지한다.
 *  - 이벤트 위임은 main.js의 body [data-meta-subtab] 셀렉터가 그대로 처리한다 — 변경 없음.
 *  - applyMetaSubTab의 aria-selected 동기화는 그대로 유지(id 기반 getElementById).
 *
 * 호출자: main.js init() — DOMContentLoaded 시 1회.
 */
export function initMetaSubTabs() {
  const container = document.getElementById('metaTabBar');
  if (!container) return;

  /** @type {{ value: string, label: string, id: string, controls: string, selected: boolean }[]} */
  // meta-docs-flow ego-graph (2026-05-21 rev): 'flow' 탭 제거.
  //   ego-graph는 docs 탭 상단 영역(#metaDocsFlowRegion)에서 인라인으로 표시되므로
  //   서브 탭은 docs / tools 2종으로 회귀한다.
  const t = window.I18n.t.bind(window.I18n);
  const TABS = [
    { value: 'docs',  label: t('ui.meta-docs-view.tab-docs-label')  || 'Behavior Definitions', id: 'metaTabDocs',      controls: 'metaDocsBody',      selected: true  },
    { value: 'tools', label: t('ui.meta-docs-view.tab-tools-label') || 'Tools',                 id: 'metaTabToolStats', controls: 'metaToolStatsBody', selected: false },
  ];

  const tabsHtml = TABS.map(({ value, label, id, controls, selected }) => {
    // renderTab 출력: <button class="ds-tab" type="button" role="tab" aria-selected="..." data-tab-value="...">label</button>
    // → class="ds-tab meta-tab [active]" id="..." aria-controls="..." data-meta-subtab="..." 로 확장.
    const activeCls = selected ? ' active' : '';
    return renderTab({ label, selected, value })
      .replace('class="ds-tab"', `class="ds-tab meta-tab${activeCls}"`)
      .replace(`data-tab-value="${value}"`, `id="${id}" aria-controls="${controls}" data-meta-subtab="${value}" data-tab-value="${value}"`);
  }).join('');

  // meta-tabs-shared-date-filter:
  //   - 좌측 .meta-tabs-list: 탭 버튼 그룹 (기존 .meta-tab 룰 그대로 적용)
  //   - 우측 .meta-tabs-actions: 공유 date-filter 슬롯 (#metaTabsDateRange) + lang-switcher 슬롯 (#metaTabsLangSwitcher)
  //   메타 모드에서는 chart-actions(.right-panel)가 숨겨지므로 두 위젯 모두 이 슬롯으로 이동한다.
  //   레이아웃은 meta-docs.css에서 .meta-tabs flex justify-content로 처리.
  container.innerHTML =
    `<div class="meta-tabs-list" role="presentation">${tabsHtml}</div>` +
    `<div class="meta-tabs-actions">` +
      `<div id="metaTabsDateRange" class="meta-tabs-date-range"></div>` +
      `<div id="metaTabsLangSwitcher" class="meta-tabs-lang-switcher"></div>` +
    `</div>`;
}

// ─── meta-tabs-shared-date-filter: chart-actions의 #dateFilter element DOM 이동 ──
//
// view-mode-reentry-filter-button-regression (2026-05-21):
//   기존 구현은 metaTabsDateRange 슬롯에 mountDateRangeDropdown으로 별도 dropdown
//   인스턴스를 mount했지만, main.js initDateFilter()가 이미 chart-actions의 #dateFilter
//   에 동일 컴포넌트를 mount해놓아 동일 id(cs-date-range-trigger 등)가 DOM에 2개 존재.
//   id 중복은 getElementById/aria-controls/이벤트 처리에 잠재 버그를 만들고,
//   메타 모드 ↔ browse 전환 시 두 인스턴스의 활성 range 동기화가 어긋날 수 있다.
//
//   해결: lang-switcher와 동일한 DOM 이동 패턴으로 통합.
//   chart-actions의 #dateFilter element 자체를 metaTabsDateRange 슬롯으로 이동시키고
//   메타 모드 종료 시 원위치로 복귀. 단일 dropdown 인스턴스 + 단일 id가 유지된다.
let _dateFilterOrigParent = null;
let _dateFilterOrigNext = null;
function moveDateFilterToMetaTabs() {
  const dateFilter = document.getElementById('dateFilter');
  const slot = document.getElementById('metaTabsDateRange');
  if (!dateFilter || !slot) return;
  // 이미 슬롯 안에 있으면 noop — idempotent.
  if (dateFilter.parentElement === slot) return;
  // 원위치 정보 보관 (최초 이동 시점에만).
  if (!_dateFilterOrigParent) {
    _dateFilterOrigParent = dateFilter.parentElement;
    _dateFilterOrigNext = dateFilter.nextSibling;
  }
  slot.appendChild(dateFilter);
}
function restoreDateFilterToChartActions() {
  const dateFilter = document.getElementById('dateFilter');
  if (!dateFilter || !_dateFilterOrigParent) return;
  if (dateFilter.parentElement === _dateFilterOrigParent) return;
  _dateFilterOrigParent.insertBefore(dateFilter, _dateFilterOrigNext || null);
}

// ─── meta-tabs-shared-lang-switcher: 기존 .lang-switcher-wrap을 DOM 이동 ──
//
// chart-actions에 정의된 단일 #lang-switcher select element를 통째로 metaTabsLangSwitcher 슬롯으로
// 옮긴다. element 자체를 이동하므로 lang-switcher.js에서 등록한 change 리스너와
// I18n.onChange 콜백이 보존된다(이벤트 리스너는 element에 묶여 있어 부모 변경과 무관).
// 원위치 복귀를 위해 원래 부모와 다음 형제 노드를 보관한다.
let _langSwitcherOrigParent = null;
let _langSwitcherOrigNext = null;
function moveLangSwitcherToMetaTabs() {
  const wrap = document.querySelector('.lang-switcher-wrap');
  const slot = document.getElementById('metaTabsLangSwitcher');
  if (!wrap || !slot) return;
  // 이미 슬롯 안에 있으면 noop — idempotent.
  if (wrap.parentElement === slot) return;
  // 원위치 정보 보관 (최초 이동 시점에만).
  if (!_langSwitcherOrigParent) {
    _langSwitcherOrigParent = wrap.parentElement;
    _langSwitcherOrigNext = wrap.nextSibling;
  }
  slot.appendChild(wrap);
}
function restoreLangSwitcherToChartActions() {
  const wrap = document.querySelector('.lang-switcher-wrap');
  if (!wrap || !_langSwitcherOrigParent) return;
  if (wrap.parentElement === _langSwitcherOrigParent) return;
  _langSwitcherOrigParent.insertBefore(wrap, _langSwitcherOrigNext || null);
}

/**
 * 좌측 패널 thead 동기화 셀 초기화 — 앱 부트스트랩 시 1회 호출.
 *
 *  - meta-docs feedback ADR (2026-05-14): [프로젝트][전체] 토글은 좌측 프로젝트 리스트의
 *    가상 'user (global)' 행으로 이관됨. 본 함수는 thead 우측 셀의 [동기화] 버튼만 담당.
 *  - 클릭 이벤트는 body 위임으로 캡처(thead가 renderBrowserProjects로 재렌더되지 않더라도
 *    [data-meta-left-refresh] 셀렉터가 동일하게 매칭되도록).
 */
export function initMetaDocsLeftNav() {
  // body 위임 — thead가 한 번도 다시 렌더되지 않지만, 안전성/일관성을 위해 body 레벨로 둔다.
  document.body.addEventListener('click', async (e) => {
    const syncBtn = e.target.closest('[data-meta-left-refresh]');
    if (!syncBtn) return;
    // 메타 모드 전용 — browse 모드에서는 무시(thead가 hidden이지만 보호 분기).
    if (document.body.dataset.appMode !== 'metadocs') return;
    await runRefresh(syncBtn);
  });
  // thead 동기화 버튼에 SVG 아이콘 1회 주입(정적 thead).
  const icon = document.querySelector('.thead-sync-icon');
  if (icon && !icon.dataset.injected) {
    icon.innerHTML = svgRefresh({ size: 12 });
    icon.dataset.injected = '1';
  }
}

/**
 * 외부(main.js selectProject) 진입점 — scopeMode 변경 + 카탈로그 재로드.
 *
 *  - 'selected' = 좌측에서 선택된 프로젝트(getSelectedProject())의 source_root로 필터.
 *  - 'all'      = 전체 카탈로그(글로벌 + 모든 cwd).
 *  - 이미 동일 모드면 재호출하지 않음(중복 fetch 방지).
 *
 * @param {'selected' | 'all'} mode
 */
export function setMetaScopeMode(mode) {
  if (mode !== 'selected' && mode !== 'all') return;
  if (state.scopeMode === mode) return;
  state.scopeMode = mode;
  // 즉시 카탈로그 재로드 — 결과적으로 좌측 카운트(setMetaDocsCounts)도 재계산되어 동기화.
  loadMetaDocsLibrary();
}

/**
 * ADR-003 left-rail-meta-docs: 좌측 rail '📚 Behavior Definitions' 클릭 시 진입점.
 *
 *  - applyAppMode('metadocs')는 main.js에서 호출되어 body[data-app-mode] 토글.
 *  - 본 함수는 카탈로그 lazy 로드만 책임 — 가시성은 CSS 룰이 처리.
 *
 * @returns {Promise<void>}
 */
export async function enterMetaDocsMode() {
  // ADR-004 meta-docs-tool-stats: 마지막 서브 탭 복원 (기본 'docs').
  //   - 카탈로그 로드는 두 탭 모두에서 좌측 요약 카드를 위해 항상 수행.
  //   - 'tools' 탭이라면 추가로 프로젝트 도구 통계도 로드.
  // meta-tabs-shared-date-filter (view-mode-reentry-filter-button-regression 2026-05-21):
  //   chart-actions의 #dateFilter element 자체를 metaTabsDateRange 슬롯으로 DOM 이동.
  //   별도 인스턴스 mount가 아니라 element 이동이므로 동일 id 중복이 발생하지 않고,
  //   글로벌 _activeRange 구독자도 단일이라 메타 ↔ browse 토글 시 라벨/상태가 항상 일치.
  moveDateFilterToMetaTabs();
  // 메타 모드에서는 .right-panel(chart-actions 포함)이 숨겨져 .lang-switcher-wrap이 가려진다.
  // 동일 element를 metaTabsLangSwitcher 슬롯으로 DOM 이동 — 기존 이벤트 리스너 보존.
  moveLangSwitcherToMetaTabs();
  // meta-docs-date-range-filter (2026-05-21): 글로벌 active-range가 바뀌면 카탈로그도 재로드.
  //   flow 모듈과 동일 패턴 — document에 1회만 등록(중복 가드).
  ensureMetaDocsRangeHandler();
  await loadMetaDocsLibrary();
  applyMetaSubTab(getMetaSubTab());
}

// ─── meta-docs-date-range-filter (2026-05-21): 글로벌 active-range 구독 ────────
//
// 화면 상단 #dateFilter가 발행하는 'cs:active-range-changed' 이벤트에 반응해
// 카탈로그를 재 fetch한다. 메타 모드에서만 의미가 있어 body[data-app-mode]로 게이트.
// document 레벨 1회 등록 — flow 모듈(meta-docs-flow-view.js)이 사용하는 동일 패턴.
let _rangeHandlerBound = false;
function ensureMetaDocsRangeHandler() {
  if (_rangeHandlerBound) return;
  _rangeHandlerBound = true;
  document.addEventListener('cs:active-range-changed', () => {
    if (document.body.dataset.appMode !== 'metadocs') return;
    // 'docs' 서브 탭에서만 카탈로그 fetch 의미가 있다. 'tools' 탭은 별도 모듈이 처리.
    if (getMetaSubTab() !== 'docs') return;
    loadMetaDocsLibrary();
    // 흐름 차트도 동일 range 로 재렌더 — fetchUnifiedFlow 가 getDateRange() 를 읽으므로
    //   마지막 center 인자(_lastArgs)로 재호출하면 새 fromTs/toTs 가 자동 반영된다.
    reloadLast();
  });
}

/**
 * 메타 모드 → browse 복귀 hook. main.js applyAppMode('browse') 분기에서 호출.
 * 현재 책임 (view-mode-reentry-filter-button-regression 2026-05-21):
 *  - #dateFilter element를 chart-actions 원위치로 복귀 → browse 모드 차트 헤더에서 다시 노출.
 *  - .lang-switcher-wrap을 chart-actions 원위치로 복귀.
 *  두 element 모두 DOM 이동 패턴이므로 인스턴스/이벤트 리스너가 보존된다.
 */
export function exitMetaDocsMode() {
  restoreDateFilterToChartActions();
  restoreLangSwitcherToChartActions();
}

/**
 * ADR-004 meta-docs-tool-stats: 메타 모드 서브 탭 전환 SSoT.
 *
 *  - DOM: #metaDocsBody / #metaToolStatsBody 가시성 토글, .meta-tab[aria-selected/active] 동기화.
 *  - state: setMetaSubTab(tab) — sessionStorage 영속화.
 *  - 데이터: 'tools' 진입 시 loadProjectToolStats(getSelectedProject()) 호출.
 *  - 'docs'로 돌아갈 때는 카탈로그 이미 로드되어 있으므로 재 fetch 불필요.
 *
 *  호출자: main.js 서브 탭 버튼 click 위임, enterMetaDocsMode 끝부분.
 *
 * @param {'docs'|'tools'} tab
 */
export function setMetaSubTab(tab) {
  if (tab !== 'docs' && tab !== 'tools') return;
  stateSetMetaSubTab(tab);
  applyMetaSubTab(tab);
}

/**
 * 서브 탭 가시성·aria·active 클래스 적용 + 활성 탭별 데이터 로드.
 * setMetaSubTab과 enterMetaDocsMode 둘 다 호출하는 내부 헬퍼.
 *
 * meta-docs-flow ego-graph (2026-05-21 rev):
 *   별도 'flow' 탭을 두지 않고 'docs' 탭 상단 영역에 ego-graph가 들어간다.
 *   따라서 PANELS 배열에는 docs/tools 두 항목만 남는다. ego-graph 자체의 자동 로드는
 *   loadMetaDocsLibrary가 카탈로그 정렬 후 첫 행을 기준으로 호출한다.
 */
function applyMetaSubTab(tab) {
  /**
   * 탭 정의 — 가시성·aria·로더를 한 곳에서 선언적으로 표현.
   * 새 탭을 추가할 때는 본 배열에 항목 하나만 추가하면 된다(스파게티 방지).
   */
  const PANELS = [
    { value: 'docs',  bodyId: 'metaDocsBody',      tabId: 'metaTabDocs',      onActivate: () => { /* 카탈로그/흐름 이미 loadMetaDocsLibrary가 처리 */ } },
    { value: 'tools', bodyId: 'metaToolStatsBody', tabId: 'metaTabToolStats', onActivate: () => loadProjectToolStats(getSelectedProject()) },
  ];

  for (const p of PANELS) {
    const isActive = p.value === tab;
    const body    = document.getElementById(p.bodyId);
    const tabBtn  = document.getElementById(p.tabId);
    if (body) body.hidden = !isActive;
    if (tabBtn) {
      tabBtn.classList.toggle('active', isActive);
      tabBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    if (isActive) p.onActivate();
  }
}

/**
 * ADR-004: 좌측 프로젝트 변경 시 호출 — 활성 서브 탭의 데이터 동기 재 fetch.
 *
 *  - 'docs' 활성: 기존 loadMetaDocsLibrary가 알아서 scope 필터(selectedProject) 반영.
 *    main.js에서 별도 호출 흐름이 이미 있으면 본 함수는 'tools'일 때만 의미 있음.
 *  - 'tools' 활성: loadProjectToolStats(newProjectName) 즉시 호출.
 *
 *  본 함수는 main.js에서 selectedProject 변경 콜백으로 호출되어
 *  "프로젝트 변경 시 활성 탭만 갱신" 단일 책임을 충족한다.
 */
export function refreshMetaActiveSubTab() {
  const tab = getMetaSubTab();
  if (tab === 'tools') {
    loadProjectToolStats(getSelectedProject());
  } else {
    // 'docs' — loadMetaDocsLibrary가 selectedProject 변경에 반응 + 상단 ego-flow 영역도 자동 재렌더.
    loadMetaDocsLibrary();
  }
}

/**
 * ADR-003 left-rail-meta-docs: Agent/Skill 배지 단일 클릭 → Behavior Definitions 정의로 딥링크.
 *
 * 흐름:
 *  1. state.searchTerm 설정 (예: 'designer')
 *  2. loadMetaDocsLibrary 호출 — 정상 렌더 + 검색어 입력 보전
 *  3. 매칭 행에 data-flash="1" 부여 → CSS `@keyframes meta-docs-flash` 1.5s 노출
 *  4. scrollIntoView({block:'center'})
 *
 * 호출자: main.js 글로벌 클릭 위임 [data-meta-doc-type] 핸들러.
 *
 * @param {{type:'agent'|'skill', id:string}} link
 */
export async function openMetaDocViaDeepLink(link) {
  if (!link || !link.id) return;
  state.searchTerm = String(link.id || '').trim();
  state.type = link.type === 'agent' || link.type === 'skill' ? link.type : 'all';
  // 매칭 정확도 향상 — 사용자 모드/검색 양쪽 다 설정 후 재렌더
  await loadMetaDocsLibrary();
  highlightDeepLinkRow();
}

/**
 * 현재 state.searchTerm과 일치하는 첫 Behavior Definitions 행에 flash 트리거 + scrollIntoView.
 * loadMetaDocsLibrary 직후 호출 — 행은 이미 DOM에 존재.
 *
 * meta-docs-table-view (2026-05-14): 셀렉터를 카드(.meta-doc-card) → 테이블 행(tr.meta-doc-row)으로 이전.
 * CSS의 .meta-doc-row[data-flash="1"] 룰이 1.5s 동안 accent 배경 깜빡임을 적용.
 */
function highlightDeepLinkRow() {
  const term = (state.searchTerm || '').toLowerCase();
  if (!term) return;
  const rows = document.querySelectorAll('.meta-docs-table tbody tr.meta-doc-row[data-name]');
  let target = null;
  for (const r of rows) {
    const name = String(r.dataset.name || '').toLowerCase();
    if (name === term) { target = r; break; }
    if (!target && name.includes(term)) target = r;
  }
  if (!target) return;
  target.dataset.flash = '1';
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // animation 종료 후 속성 제거 — 재진입 시 다시 트리거 가능
  setTimeout(() => { target.removeAttribute('data-flash'); }, 1700);
}

/**
 * 좌측 축약 패널의 요약 카드 3개(사용/미사용/orphan) 렌더.
 * loadMetaDocsLibrary() 성공 후 자동 호출됨 (rows 카운트 SSoT 일관).
 *
 * @param {{used:number, unused:number, orphan:number}} counts
 */
function renderLeftSummaryCards(counts) {
  const root = document.getElementById('metaDocsSummaryCards');
  if (!root) return;
  const t = window.I18n.t.bind(window.I18n);
  root.innerHTML = `
    <div class="meta-docs-summary-card meta-docs-summary-card--used" data-meta-filter="display" data-value="all" title="${t('ui.meta-docs-view.card-used-title')}">
      <span class="meta-docs-summary-card-value">${counts.used}</span>
      <span class="meta-docs-summary-card-label">${t('ui.meta-docs-view.card-used-label')}</span>
    </div>
    <div class="meta-docs-summary-card meta-docs-summary-card--unused" data-meta-filter="display" data-value="unused" title="${t('ui.meta-docs-view.card-unused-title')}">
      <span class="meta-docs-summary-card-value">${counts.unused}</span>
      <span class="meta-docs-summary-card-label">${t('ui.meta-docs-view.card-unused-label')}</span>
    </div>
    <div class="meta-docs-summary-card meta-docs-summary-card--orphan" data-meta-filter="display" data-value="orphan" title="${t('ui.meta-docs-view.card-orphan-title')}">
      <span class="meta-docs-summary-card-value">${counts.orphan}</span>
      <span class="meta-docs-summary-card-label">orphan</span>
    </div>
  `;
  if (root.dataset.metaBound === '1') return;
  root.dataset.metaBound = '1';
  root.addEventListener('click', (e) => {
    const card = e.target.closest('[data-meta-filter]');
    if (!card) return;
    applyFilterChange(card.dataset.metaFilter, card.dataset.value);
  });
}

/**
 * rows 배열에서 사용/미사용/orphan 카운트 계산 — 단일 책임.
 * renderHtml의 인라인 계산과 동일 로직 — DRY를 위해 추출.
 */
function computeRowCounts(rows) {
  return {
    used:   rows.filter(r => (r.invocations ?? 0) > 0).length,
    unused: rows.filter(r => r.id != null && (r.invocations ?? 0) === 0).length,
    orphan: rows.filter(r => r.id == null).length,
  };
}

/** 탭 진입 시 호출 — fetch + 렌더. */
export async function loadMetaDocsLibrary() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  // skeleton-loading T-09: 카탈로그 row 8개로 구조 유지. fetch 응답 후 정상 테이블로 교체.
  container.innerHTML = skMetaDocList(8);

  try {
    // 1) 선택 프로젝트 결정 — scopeMode + 좌측 패널 selectedProject 결합
    const project = state.scopeMode === 'selected' ? (getSelectedProject() || null) : null;

    // meta-docs-date-range-filter (2026-05-21): 글로벌 active-range(api.js _activeRange)를
    // probe/본 fetch 양쪽에 공통 적용. 빈 객체({})면 fromTs/toTs 파라미터를 보내지 않아
    // 서버는 v_meta_doc_usage VIEW(전체 기간) 폴백을 사용한다.
    const dr = getDateRange();
    const rangeQs = new URLSearchParams();
    if (dr.from !== undefined) rangeQs.set('fromTs', String(dr.from));
    if (dr.to   !== undefined) rangeQs.set('toTs',   String(dr.to));
    const rangeQsStr = rangeQs.toString();

    // 2) 전체 카탈로그 probe — 항상 1회 fetch.
    //    meta-docs feedback ADR (2026-05-14): selected 모드 + 매칭 실패에서도 좌측 카운트가
    //    0으로 떨어지지 않도록 type/includeDeleted 필터 무관한 raw 카탈로그를 받아 둔다.
    //    좌측 카운트 + project source_root 매칭에 공통으로 사용. range 필터는 동일 적용.
    const probeUrl = rangeQsStr ? `/api/meta-docs?${rangeQsStr}` : '/api/meta-docs';
    const probeRes = await fetchJson(probeUrl);
    const probeList = Array.isArray(probeRes?.data) ? probeRes.data : [];

    // 좌측 thead '항목' 컬럼 카운트 즉시 동기 — 본 fetch 결과를 기다리지 않고 먼저 채워서
    // user(global)/프로젝트 행이 0으로 깜빡이는 문제를 방지.
    pushLeftCounts(probeList);

    let resolvedSourceRoot = null;
    let matched = false;
    if (project) {
      resolvedSourceRoot = findSourceRootByProject(probeList, project);
      matched = !!resolvedSourceRoot;
    }
    state.resolvedSource = project ? { project, sourceRoot: resolvedSourceRoot, matched } : null;

    // 3) 본 fetch — 매칭된 source_root가 있으면 ?source_root= 부착. type/includeDeleted 필터 포함.
    //    'all' 모드 + type='all' + includeDeleted=false + 동일 range 면 probe 결과를 그대로 재사용해 fetch 절감.
    //    range는 probe와 본 fetch에 동일 적용되므로 추가 분기 없이 그대로 부착하면 된다.
    //
    //    meta-docs-project-filter-parity (2026-05-21):
    //      ego-graph 와 카탈로그 호출 집계 단위를 맞추기 위해 project 가 매칭되면
    //      ?project= 도 함께 부착한다. 서버는 sessions JOIN 으로 사용 집계를 좁혀
    //      해당 project_name 외 세션(orphan 포함) 호출은 invocations 에서 제외한다.
    //      probe(전체 카탈로그) 단계에는 project 를 붙이지 않는다 — 좌측 카운트는
    //      카탈로그 size 만 보장하면 충분하고, project 매칭 자체가 probe 결과를 토대로 수행된다.
    const params = new URLSearchParams(rangeQsStr);
    if (state.type !== 'all') params.set('type', state.type);
    if (state.includeDeleted) params.set('includeDeleted', '1');
    if (resolvedSourceRoot) params.set('source_root', resolvedSourceRoot);
    if (project && matched) params.set('project', project);
    const qs = params.toString();
    // probe와 동일한 쿼리(=range만 있는 경우)면 재 fetch 없이 결과 재사용.
    const sameAsProbe = qs === rangeQsStr;

    let list = [];
    if (!project || matched) {
      if (sameAsProbe) {
        list = probeList;
      } else {
        const res = await fetchJson('/api/meta-docs?' + qs);
        list = Array.isArray(res?.data) ? res.data : [];
      }
    }

    // 4) 프로젝트 모드에서는 orphan(id null) 자동 숨김 — source_root 정보가 없어 어떤
    //    프로젝트 호출인지 단정 불가하기 때문.
    //    legacy applyScopeFilter는 제거됨 — scopeMode SSoT가 좌측 패널로 이관(스코프 라디오 그룹 삭제).
    let scoped = list;
    if (project && matched) scoped = scoped.filter(r => r.id != null);

    const filtered = applyDisplayFilter(scoped, state.display);
    const sorted   = applySort(filtered, state.sort, state.sortDir);

    container.innerHTML = renderHtml(sorted, { project, matched, resolvedSourceRoot });
    bindEvents(container);
    ensureToastHost();
    // meta-docs-table-view ADR-004 (2026-05-14): syslib와 동일 패턴 — 매 렌더마다 호출.
    //   table DOM이 매번 새로 만들어지므로 5px 드래그 핸들도 재부착해야 한다.
    //   table이 없는 빈 상태 분기에서는 querySelector가 null → initColResize가 no-op.
    initColResize(container.querySelector('.meta-docs-table'));
    // resize-handle (2026-05-21): 시각화 ↔ 카탈로그 상하 분할 핸들. 매 렌더마다 새 DOM이
    //   생성되므로 동일 패턴(col-resize)으로 매 렌더 직후 재바인딩. 저장된 비율은 함수 내부에서 복원.
    initMetaDocsFlowResize(
      container.querySelector('#metaDocsFlowHandle'),
      container.querySelector('#metaDocsFlowRegion'),
      container.querySelector('.meta-docs-catalog-area'),
    );
    // ADR-003: 좌측 요약 카드(사용/미사용/orphan) 동기 갱신
    renderLeftSummaryCards(computeRowCounts(sorted));

    // meta-docs-flow ego-graph (2026-05-21 rev): 상단 흐름 영역 자동 로드.
    //   사용자가 명시 요청한 동선 — "흐름 영역의 시각화 정보는 메타 문서 최종 많이 처음 노출된 행에 대한 정보를 노출".
    //   정렬 결과의 첫 행을 중심으로 ego-graph 렌더. 첫 행이 orphan(id null)이면 첫 hit 행으로 fallback.
    autoLoadFirstRowFlow(sorted, project);
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
}

/**
 * meta-docs-flow ego-graph (2026-05-21 rev): 상단 흐름 영역 자동 로드 진입점.
 *
 *  - 정렬된 카탈로그의 첫 "초점이 될 만한" 행을 골라 loadFlow(...)을 호출한다.
 *  - 우선순위: 발견 가능한(id != null) + 호출 수 > 0 인 첫 행. 없으면 첫 id != null 행.
 *  - rows가 비었거나 모두 orphan이면 흐름 영역에 안내(빈 상태)를 그리도록 centerName=null.
 *  - loadFlow은 자체 컨테이너(#metaDocsFlowRegion)를 찾지 못하면 no-op이므로 가드 불필요.
 */
function autoLoadFirstRowFlow(rows, project) {
  let pick = rows.find(r => r.id != null && (r.invocations ?? 0) > 0);
  if (!pick) pick = rows.find(r => r.id != null);
  // meta-docs-flow.js::loadFlow 시그니처는 `centerKind` 를 요구. 카탈로그의 `type`
  // 컬럼 값('agent'|'skill'|'command')이 그대로 MetaDocKind 와 호환.
  const centerKind = pick?.type ?? null;
  const centerName = pick?.name ?? null;
  loadFlow({ centerKind, centerName, project });
}

/**
 * 좌측 프로젝트 카운트 주입 — 전체 카탈로그(probe rows)를 기반으로 즉시 계산.
 *
 *  - rows를 source_root basename별로 그룹핑하여 projects[name] = count 맵 구성.
 *  - userSettings 소스(글로벌)는 global 키로 별도 집계.
 *  - meta-docs feedback ADR (2026-05-14): 동기 함수로 단순화 — 호출자가 raw 카탈로그를 직접 전달.
 *
 * @param {Array} rows - 전체 카탈로그 (필터 적용 전)
 */
function pushLeftCounts(rows) {
  if (!Array.isArray(rows)) rows = [];
  const projects = Object.create(null);
  let globalCount = 0;
  for (const r of rows) {
    if (r.source === 'userSettings' || r.source_root == null) {
      globalCount += 1;
      continue;
    }
    const base = String(r.source_root).split('/').filter(Boolean).pop();
    if (!base) continue;
    projects[base] = (projects[base] ?? 0) + 1;
  }
  setMetaDocsCounts({
    projects,
    global: globalCount,
    total: rows.length,
  });
}

/**
 * distinct source_root 중 basename이 project_name과 일치하는 첫 항목 반환.
 * 단일 책임 — 호출 측은 raw rows + project name만 전달.
 */
function findSourceRootByProject(rows, projectName) {
  if (!rows || !projectName) return null;
  const seen = new Set();
  for (const r of rows) {
    const root = r?.source_root;
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const base = String(root).split('/').filter(Boolean).pop();
    if (base === projectName) return root;
  }
  return null;
}

// =============================================================================
// 내부 — 렌더
// =============================================================================

function renderHtml(rows, ctx = {}) {
  const filters = renderFilters();
  // meta-docs-flow ego-graph (2026-05-21 rev): 상단 ego-graph 영역.
  //   - meta-docs-flow-view.js loadFlow이 본 영역에 toolbar+SVG를 inject한다.
  //   - 사용자 요청: "메타 문서 탭 상단에 흐름 영역을 만들어두고 하단에 기존 메타문서 테이블을 재배치".
  //   - rows가 비어도 노출 — 빈 상태 안내를 loadFlow이 직접 그린다(빈 자리 깜빡임 방지).
  // split-scroll (2026-05-21): 시각화 영역과 카탈로그 영역의 스크롤을 분리한다.
  //   - .meta-docs-body는 overflow:hidden flex column.
  //   - .meta-docs-flow-region는 자기 고정 높이(CSS 변수 --meta-docs-flow-height) — 함께 스크롤되지 않음.
  //   - .meta-docs-catalog-area가 1fr + overflow-y:auto — 필터/표만 내부 스크롤.
  //   - 두 영역 사이 시각 갭은 .meta-docs-body bg(surface) ↔ 자식 bg(surface-alt) 대비로 형성.
  // resize-handle (2026-05-21): 좌측 패널 vertical-handle과 동일한 드래그 핸들을
  //   #metaDocsFlowHandle로 삽입. left-panel-vertical-resize.js의 initMetaDocsFlowResize가
  //   바인딩하여 --meta-docs-flow-height CSS 변수를 갱신. tooltip i18n은 좌측 패널과 동일 키 재사용.
  const flowRegion = `<div id="metaDocsFlowRegion" class="meta-docs-flow-region" aria-label="Behavior call flow" data-i18n-attr-aria-label="ui.html.meta-docs.flow-aria"></div>`;
  const flowHandle = `<div class="panel-vertical-handle meta-docs-flow-handle" id="metaDocsFlowHandle" title="Drag to resize height" data-i18n-attr-title="ui.html.left-panel.vertical-handle-title"></div>`;

  // 빈 상태 — 프로젝트 미등록/미동기화 안내
  if (rows.length === 0) {
    const t = window.I18n.t.bind(window.I18n);
    const empty = (ctx.project && !ctx.matched)
      ? `<div class="state-empty">
           <span class="state-empty-title">${t('ui.meta-docs-view.empty-project-title', { project: escHtml(ctx.project) })}</span>
           <span class="state-empty-hint">${t('ui.meta-docs-view.empty-project-hint')}</span>
         </div>`
      : `<div class="state-empty"><span class="state-empty-title">${t('ui.meta-docs-view.empty-global-title')}</span></div>`;
    return `${flowRegion}${flowHandle}<div class="meta-docs-catalog-area">${filters}${empty}</div>`;
  }

  // meta-docs-table-view ADR-001/004 (2026-05-14): 카드 리스트 → 정렬·리사이즈 테이블.
  //  - colgroup 초기 폭: 타입 96 / 이름 180 / 경로 280 / 횟수 70 / 최근 적용 150 / 누적 토큰 100
  //    합계 876px — 메타 모드 메인 영역(좌측 패널 분량 제외) 폭에 가로 스크롤 없이 들어감.
  //  - thead th는 system-prompt-library와 동일하게 sortable + sort-asc/desc + aria-sort + ↕↑↓ 화살표.
  //  - col-resize 핸들은 bindEvents 마지막에 initColResize(table)로 자동 부착.
  const t = window.I18n.t.bind(window.I18n);
  const head = `
    <table class="meta-docs-table">
      <colgroup>
        <col style="width:96px">
        <col style="width:180px">
        <col style="width:280px">
        <col style="width:70px">
        <col style="width:150px">
        <col style="width:100px">
      </colgroup>
      <thead>
        <tr>
          ${thHtml('type',         t('ui.meta-docs-view.col-type'))}
          ${thHtml('name',         t('ui.meta-docs-view.col-name'))}
          ${thHtml('source',       t('ui.meta-docs-view.col-source'))}
          ${thHtml('invocations',  t('ui.meta-docs-view.col-invocations'), 'num')}
          ${thHtml('last_used_at', t('ui.meta-docs-view.col-last-used'))}
          ${thHtml('total_tokens', t('ui.meta-docs-view.col-total-tokens'), 'num')}
        </tr>
      </thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>
  `;
  return `${flowRegion}${flowHandle}<div class="meta-docs-catalog-area">${filters}${head}</div>`;
}

/**
 * meta-docs-table-view ADR-001 (2026-05-14): sortable thead 셀 1개 생성.
 * system-prompt-library의 th() 헬퍼와 동일 구조 — SORTABLE_KEYS 키 + ↕/↑/↓ 화살표 + aria-sort.
 * data-meta-sort 속성은 onMetaContainerClick / onMetaContainerKeydown이 동일 분기로 처리한다.
 *
 * ds-sort-head 통합 (Wave 1): <th> 내부 콘텐츠를 renderSortHead() 로 위임.
 *  - <th> 자체의 이벤트 속성(data-meta-sort / tabindex / role / aria-sort)은 그대로 유지.
 *  - 내부 텍스트 + 화살표 span 은 ds-sort-head 마크업으로 교체. 시각 변화 없음.
 */
function thHtml(key, label, extraCls = '') {
  const sortState = sortThState(key);
  const cls = `${extraCls} sortable ${sortHeaderCls(key)}`.trim();
  return `<th data-meta-sort="${key}"
              class="${cls}"
              tabindex="0"
              role="columnheader"
              aria-sort="${ariaSortValue(key)}">${renderSortHead({ label, sort: sortState, key })}</th>`;
}

/**
 * 현재 state 기준 컬럼의 정렬 상태를 renderSortHead SortState('idle'|'asc'|'desc')로 변환.
 * 단일 책임 — sortHeaderCls / ariaSortValue 와 동일 판단 로직.
 * @param {string} key
 * @returns {'idle'|'asc'|'desc'}
 */
function sortThState(key) {
  if (state.sort !== key) return 'idle';
  return state.sortDir === 'asc' ? 'asc' : 'desc';
}

/** 헤더 active 클래스 — 단일 책임 (state.sort/sortDir 기준) */
function sortHeaderCls(key) {
  if (state.sort !== key) return '';
  return state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc';
}
/** WAI-ARIA aria-sort 속성 값 */
function ariaSortValue(key) {
  if (state.sort !== key) return 'none';
  return state.sortDir === 'asc' ? 'ascending' : 'descending';
}

/**
 * meta-docs-table-view ADR-001/002/003 (2026-05-14): 카탈로그 행 1개 — <tr> 마크업.
 *
 *  - 상태 클래스(meta-doc-unused/deleted/orphan)는 .meta-doc-row.meta-doc-* CSS 룰이
 *    행 배경/좌측 보더/이름 line-through 처리를 담당 (캡슐화).
 *  - 카드 시절 description 1줄 미리보기는 행 자체의 title 속성으로 hover 노출 (ADR-001 옵션 B).
 *  - 경로 셀은 ADR-003 — file_path 우선, orphan 행은 "호출만 존재" 라벨.
 *  - deleted 행은 마지막 셀(누적 토큰) 끝에 svgWarn 배지(soft-deleted 안내).
 */
function rowHtml(r) {
  const orphan  = r.id == null;
  const deleted = r.deleted_at != null;
  const unused  = !orphan && (r.invocations ?? 0) === 0;
  const cls = ['meta-doc-row',
    orphan  ? 'meta-doc-orphan'  : '',
    deleted ? 'meta-doc-deleted' : '',
    unused  ? 'meta-doc-unused'  : '',
  ].filter(Boolean).join(' ');

  const inv      = (r.invocations ?? 0);
  const lastUsed = r.last_used_at ? escHtml(fmtTime(r.last_used_at)) : '<span class="meta-doc-na">—</span>';
  const tokens   = formatTokens(r.total_tokens ?? 0);

  const pathCell = orphan
    ? `<span class="meta-doc-source-orphan" title="${escHtml(window.I18n.t('ui.meta-docs-view.orphan-tooltip'))}" tabindex="0">${window.I18n.t('ui.meta-docs-view.orphan-path-label')}</span>`
    : pathCellHtml(r);

  // description은 행 title 속성으로 hover 노출 — 별도 컬럼화하지 않음 (ADR-001).
  const titleAttr = r.description
    ? ` title="${escHtml(r.description)}"`
    : '';

  const deletedBadge = deleted
    ? ` <span class="meta-doc-deleted-badge" title="${escHtml(window.I18n.t('ui.meta-docs-view.deleted-badge-title'))}">${svgWarn({ size: 12 })}</span>`
    : '';

  return `
    <tr class="${cls}" data-type="${escHtml(r.type)}" data-name="${escHtml(r.name)}"${titleAttr}>
      <td>${metaDocTypeBadge(r.type)}</td>
      <td><span class="meta-doc-name">${escHtml(r.name)}</span></td>
      <td>${pathCell}</td>
      <td class="num">${inv.toLocaleString()}</td>
      <td>${lastUsed}</td>
      <td class="num">${tokens}${deletedBadge}</td>
    </tr>
  `;
}

/**
 * Behavior Definitions 타입 뱃지 — 턴 뷰의 Agent/Skill 칩과 동일 시각 언어로 렌더.
 *
 * SSoT 재사용:
 *  - 머리표시 ◎/◉ + 색상 그라디언트는 render/badges.js의 toolIconHtml(toolName)을 그대로 호출.
 *  - 칩 보더+radius는 turn-view.css의 .tool-chip을, agent 톤은 .agent-chip을 그대로 활용.
 *  - command도 Agent/Skill과 동일 주황 — meta 문서는 "정의된 행동 단위"로 의미가 같다는 사용자 결정.
 *
 * type 값: 'agent' | 'skill' | 'command' — 정규식이 대문자 시작을 요구하므로 'Agent'로 통일해서 넘긴다.
 */
function metaDocTypeBadge(type) {
  const safe = String(type || '').toLowerCase();
  // 모든 Behavior Definitions 타입은 Agent/Skill 칩과 동일 톤. 정규식 매칭을 위해 'Agent'로 정규화.
  const icon = toolIconHtml('Agent');
  const label = safe.toUpperCase();
  return `<span class="tool-chip agent-chip meta-doc-type meta-doc-type-${escHtml(safe)}">
    ${icon}<span class="agent-chip-name">${escHtml(label)}</span>
  </span>`;
}

/**
 * meta-docs-table-view ADR-003 (2026-05-14): 경로 셀 — file_path 우선, 없으면 source_root.
 *  - shortenPath로 단축 표시, 풀 경로는 title 속성에 보존.
 *  - source 라벨(userSettings/projectSettings)은 좌측 패널 user(global)/프로젝트 행이 SSoT를
 *    가지므로 본 셀에서 별도 노출하지 않음 — 시각 위계 단순화.
 *  - 둘 다 없으면 '—' (meta-doc-na 톤).
 */
function pathCellHtml(r) {
  const path = r.file_path || r.source_root || null;
  if (!path) return `<span class="meta-doc-na">—</span>`;
  return `<span class="meta-doc-source-root" title="${escHtml(path)}">${escHtml(shortenPath(path))}</span>`;
}

function renderFilters() {
  const t = window.I18n.t.bind(window.I18n);
  const types = [
    { v: 'all',     label: t('ui.meta-docs-view.filter-all') },
    { v: 'agent',   label: 'Agent'   },
    { v: 'skill',   label: 'Skill'   },
    { v: 'command', label: 'Command' },
  ];
  // meta-docs feedback ADR (2026-05-14): 스코프 라디오 그룹 제거.
  //   좌측 패널의 [user(global) | 프로젝트] 행 선택이 scope SSoT를 가져감.
  //   기존 state.scope는 source 라벨(userSettings/projectSettings) 기준 추가 필터였으나
  //   좌측 진입점과 의미 축이 겹쳐 사용자 혼동 유발 → 제거.
  const displays = [
    { v: 'all',    label: t('ui.meta-docs-view.filter-all') },
    { v: 'unused', label: t('ui.meta-docs-view.filter-unused') },
    { v: 'orphan', label: t('ui.meta-docs-view.filter-orphan') },
  ];

  // ds-filter-btn 통합 (Wave 1): renderFilterBtn() 으로 내부 마크업 위임.
  //  - 이벤트 바인딩용 data-meta-filter / data-value 를 <button> 에 직접 추가한다.
  //  - 기존 .meta-doc-filter-btn + .active 클래스도 이중 클래스 패턴으로 함께 부여 (시각 변화 0).
  //  - strength: 'strong' — meta-docs 필터 버튼은 강한 강조 계열.
  const btn = (group, opts, active) => opts.map(o => {
    const isActive = o.v === active;
    // renderFilterBtn 기본 출력: <button class="ds-filter-btn" type="button" aria-pressed="..." data-strength="strong" data-value="...">label</button>
    const base = renderFilterBtn({ label: o.label, active: isActive, strength: 'strong', value: o.v });
    // data-meta-filter 와 기존 클래스(meta-doc-filter-btn / active)를 삽입.
    // <button class="ds-filter-btn" 을 <button class="ds-filter-btn meta-doc-filter-btn [active]" data-meta-filter="..." 으로 확장.
    return base
      .replace(
        'class="ds-filter-btn"',
        `class="ds-filter-btn meta-doc-filter-btn${isActive ? ' active' : ''}"`,
      )
      .replace(
        'type="button"',
        `type="button" data-meta-filter="${escHtml(group)}"`,
      );
  }).join('');

  // 직교 토글 — display와 의미 축이 다르므로 라디오 그룹 외부에 체크박스로 분리.
  // 라벨 능동형 + 휴지통 SVG(stroke-only) + title 툴팁의 3중 시각 단서로 학습 비용 ↓.
  //  - 사용자 피드백(2026-05-14): emoji 🗑 → SVG trash 로 디자인 톤 일치.
  const includeDeletedHtml = `
    <label class="meta-docs-include-deleted"
           title="${t('ui.meta-docs-view.include-deleted-title')}">
      <input type="checkbox"
             data-meta-include-deleted
             ${state.includeDeleted ? 'checked' : ''} />
      <span class="meta-docs-include-deleted-icon" aria-hidden="true">${svgTrash({ size: 12 })}</span>
      <span class="meta-docs-include-deleted-label">${t('ui.meta-docs-view.include-deleted-label')}</span>
    </label>
  `;

  // 정렬 컨트롤은 더 이상 상단 필터 바에 두지 않는다 — 표 헤더 클릭으로 일원화.
  return `
    <div class="meta-docs-filters">
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">${t('ui.meta-docs-view.filter-type-label')}</span>${btn('type', types, state.type)}</div>
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">${t('ui.meta-docs-view.filter-display-label')}</span>${btn('display', displays, state.display)}</div>
      ${includeDeletedHtml}
    </div>
  `;
}

// =============================================================================
// 이벤트 바인딩
// =============================================================================

/**
 * 컨테이너 클릭 핸들러 — bindEvents가 매 렌더마다 호출되더라도 리스너 중복 부착을
 * 막기 위해 컨테이너 datasetFlag로 1회만 등록한다. 그렇지 않으면 N번째 렌더에서
 * 한 클릭이 N번 처리되어 sort 토글이 의도와 어긋난다.
 */
function bindEvents(container) {
  if (container.dataset.metaBound === '1') return;
  container.dataset.metaBound = '1';
  container.addEventListener('click', onMetaContainerClick);
  container.addEventListener('keydown', onMetaContainerKeydown);
  // change 이벤트는 click과 의미 축이 달라 별도 리스너로 등록.
  //   - click  : 라디오/정렬/스코프/동기화 등 "값 선택" 액션
  //   - change : 체크박스 토글 등 "boolean 상태 전환" 액션
  container.addEventListener('change', onMetaContainerChange);
}

/**
 * 키보드 접근성 — sortable 헤더에 포커스가 있고 Enter/Space 입력 시 토글.
 * 단일 책임 — th[data-meta-sort] 외에는 무시.
 */
async function onMetaContainerKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const sortHeader = e.target.closest('[data-meta-sort]');
  if (!sortHeader) return;
  e.preventDefault();
  applyFilterChange('sort', sortHeader.dataset.metaSort);
  await loadMetaDocsLibrary();
}

async function onMetaContainerClick(e) {
  // 1) 필터 버튼 (타입/스코프/표시/정렬)
  const filterBtn = e.target.closest('[data-meta-filter]');
  if (filterBtn) {
    applyFilterChange(filterBtn.dataset.metaFilter, filterBtn.dataset.value);
    await loadMetaDocsLibrary();
    return;
  }

  // 2) 표 헤더 정렬 (data-meta-sort) — 상단 정렬 버튼과 동일 분기로 통합
  const sortHeader = e.target.closest('[data-meta-sort]');
  if (sortHeader) {
    applyFilterChange('sort', sortHeader.dataset.metaSort);
    await loadMetaDocsLibrary();
    return;
  }

  // 3) 카탈로그 행 클릭 — 상단 ego-flow 영역을 클릭된 행 중심으로 재렌더.
  //    meta-docs-flow ego-graph (2026-05-21 rev): orphan 행(id 없음)은 흐름 추적 불가 → 무시.
  //    re-render 비용을 줄이기 위해 loadMetaDocsLibrary 전체를 다시 부르지 않고
  //    상단 영역만 loadFlow으로 교체. 활성 행 시각 표시는 [data-flow-active] 토글.
  const row = e.target.closest('.meta-doc-row[data-name]');
  if (row) {
    if (!row.dataset.type || row.classList.contains('meta-doc-orphan')) return;
    const project = state.scopeMode === 'selected' ? (getSelectedProject() || null) : null;
    setActiveFlowRow(row);
    loadFlow({
      centerKind: row.dataset.type,
      centerName: row.dataset.name,
      project,
    });
    return;
  }

  // 동기화 버튼은 좌측 thead 셀(.thead-sync-btn)로 이관되어 본 핸들러에서 직접 처리하지 않음.
  // (initMetaDocsLeftNav가 body 위임으로 [data-meta-left-refresh] 셀렉터를 캐치 — single source.)
}

/**
 * meta-docs-flow ego-graph (2026-05-21 rev): 표 내 활성 ego 중심 행 시각 표시.
 *
 *  - 동일 tbody에서 기존 [data-flow-active] 속성 제거 후 새 행에 부여.
 *  - 실제 색상/배경은 CSS의 .meta-doc-row[data-flow-active="1"] 룰이 담당(캡슐화).
 */
function setActiveFlowRow(rowEl) {
  if (!rowEl || !rowEl.parentElement) return;
  const tbody = rowEl.parentElement;
  for (const r of tbody.querySelectorAll('.meta-doc-row[data-flow-active="1"]')) {
    r.removeAttribute('data-flow-active');
  }
  rowEl.setAttribute('data-flow-active', '1');
}

/**
 * change 이벤트 핸들러 — boolean 상태 전환만 처리.
 * 현재는 includeDeleted 토글 1건. 향후 동일 패턴 토글이 늘어나면 data-* 분기를 확장.
 */
async function onMetaContainerChange(e) {
  const toggle = e.target.closest('[data-meta-include-deleted]');
  if (toggle) {
    setIncludeDeleted(!!toggle.checked);
    await loadMetaDocsLibrary();
    return;
  }
}

/**
 * includeDeleted 진입점 — applyFilterChange와 의미 축이 다르므로 별도 헬퍼.
 * (ADR-001 meta-docs-filter: 단일 책임 원칙 유지)
 */
function setIncludeDeleted(value) {
  state.includeDeleted = !!value;
}

/** 필터 변경 단일 진입점 — sort 그룹은 dir 토글 규칙 처리 */
function applyFilterChange(group, value) {
  if (group === 'type')    { state.type    = value; return; }
  // 'scope' 분기는 우측 스코프 라디오 그룹 제거(2026-05-14)와 함께 삭제됨.
  // scope SSoT는 좌측 패널(user(global)/프로젝트 행 클릭)이 가짐 → setMetaScopeMode 진입점.
  if (group === 'sort') {
    if (!SORTABLE_KEYS.has(value)) return;
    if (state.sort === value) {
      // 같은 키 재클릭 — 방향 토글
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      // 다른 키 — 컬럼별 의미 있는 기본 방향 적용 (텍스트 asc, 숫자/시간 desc)
      state.sort = value;
      state.sortDir = DEFAULT_DIR[value] ?? 'desc';
    }
    return;
  }
  if (group === 'display') {
    // 'orphan만' 표시 필터는 source_root 정보가 없는 행을 보여주므로 프로젝트 모드와
    // 의미 충돌. 사용자가 누르면 자동으로 전체 프로젝트 모드로 전환하고 안내 토스트.
    if (value === 'orphan' && state.scopeMode === 'selected' && getSelectedProject()) {
      state.scopeMode = 'all';
      pushToast({
        kind: 'info',
        message: window.I18n.t('ui.meta-docs-view.orphan-scope-switch'),
        ttl: 5000,
      });
    }
    state.display = value;
    return;
  }
}

// =============================================================================
// 동기화 + 토스트
// =============================================================================

async function runRefresh(buttonEl) {
  // 진행 중 UI — disabled + 스피너 (finally의 loadMetaDocsLibrary가 컨테이너를 다시
  // 그리므로 버튼 자체가 새 DOM으로 교체됨 → 별도 라벨 복원 불필요)
  buttonEl.disabled = true;
  buttonEl.classList.add('is-loading');
  const labelEl = buttonEl.querySelector('.meta-docs-refresh-label');
  if (labelEl) labelEl.textContent = window.I18n.t('ui.meta-docs-view.syncing-label');

  const startToast = pushToast({ kind: 'info', message: window.I18n.t('ui.meta-docs-view.toast-sync-start'), ttl: 3000 });

  try {
    const body = buildRefreshBody();
    const res = await fetchJson('/api/meta-docs/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const norm = normalizeRefreshResult(res);

    // 시작 토스트 정리 후 완료 토스트
    closeToast(startToast);
    pushToast({ kind: 'success', message: window.I18n.t('ui.meta-docs-view.toast-sync-done', { summary: norm.summaryText }), ttl: 5000 });
  } catch (err) {
    closeToast(startToast);
    const msg = err?.message ? String(err.message) : String(err);
    pushToast({ kind: 'error', message: window.I18n.t('ui.meta-docs-view.toast-sync-failed', { message: msg }), ttl: 7000 });
  } finally {
    // 결과 토스트는 별도 영역. 패널은 즉시 재조회.
    await loadMetaDocsLibrary();
    // 좌측 패널 동기화 버튼은 loadMetaDocsLibrary가 detach하지 않으므로 직접 복원
    if (buttonEl.isConnected) {
      buttonEl.disabled = false;
      buttonEl.classList.remove('is-loading');
      const labelEl = buttonEl.querySelector('.meta-docs-refresh-label');
      if (labelEl) labelEl.textContent = window.I18n.t('ui.meta-docs-view.sync-restore-label');
    }
  }
}

/** 동기화 호출 본문 빌더 — 단일 책임 */
function buildRefreshBody() {
  const body = { scope: 'all', includeKnownCwds: true, force: true };
  // window.__SPYGLASS_CWD__ 가 어딘가(메인 부트스트랩)에서 노출돼 있으면 첨부.
  // 미존재 시 서버는 cwd 없이 includeKnownCwds로 기존 cwd를 전부 스캔.
  const cwd = (typeof window !== 'undefined' && typeof window.__SPYGLASS_CWD__ === 'string')
    ? window.__SPYGLASS_CWD__
    : null;
  if (cwd) body.cwd = cwd;
  return body;
}

/** 응답 정규화 — global/project/cwds graceful skip */
function normalizeRefreshResult(res) {
  const t = window.I18n.t.bind(window.I18n);
  const data = res?.data ?? {};
  const parts = [];
  const fmt = (s) => {
    if (!s || typeof s !== 'object') return null;
    const up  = s.upserted ?? s.added ?? 0;
    const del = s.softDeleted ?? s.deleted ?? 0;
    if (up === 0 && del === 0) return t('ui.meta-docs-view.refresh-no-change');
    const out = [];
    if (up) out.push(t('ui.meta-docs-view.refresh-add', { n: up }));
    if (del) out.push(t('ui.meta-docs-view.refresh-del', { n: del }));
    return out.join(', ');
  };

  const g = fmt(data.global);
  if (g) parts.push(t('ui.meta-docs-view.refresh-global', { detail: g }));
  const p = fmt(data.project);
  if (p) parts.push(t('ui.meta-docs-view.refresh-project', { detail: p }));

  const cwds = Array.isArray(data.cwds) ? data.cwds : [];
  const cwdsCount = cwds.length;
  if (cwdsCount) {
    parts.push(t('ui.meta-docs-view.refresh-workspaces', { n: cwdsCount }));
  }

  return {
    summaryText: parts.length ? parts.join(', ') : t('ui.meta-docs-view.refresh-no-result'),
  };
}

// 토스트 단일 호스트 (탭 재마운트에도 1개만 유지)
function ensureToastHost() {
  if (document.getElementById('metaDocsToastHost')) return;
  const host = document.createElement('div');
  host.id = 'metaDocsToastHost';
  host.className = 'meta-docs-toast-host';
  document.body.appendChild(host);
}

/** pushToast({kind, message, ttl}) → toast element (close 핸들 용) */
function pushToast({ kind = 'info', message = '', ttl = 4000 } = {}) {
  ensureToastHost();
  const host = document.getElementById('metaDocsToastHost');
  if (!host) return null;

  const el = document.createElement('div');
  el.className = `meta-docs-toast meta-docs-toast-${kind}`;
  el.innerHTML = `
    <span class="meta-docs-toast-icon" aria-hidden="true"></span>
    <span class="meta-docs-toast-msg">${escHtml(message)}</span>
  `;
  el.addEventListener('click', () => closeToast(el));
  host.appendChild(el);

  // entry 애니메이션:
  // 더블 rAF로 "append → 첫 paint(초기 상태) → 다음 프레임에 is-shown"을 보장한다.
  // 단발 rAF만 쓰면 첫 paint 전에 클래스가 붙어 브라우저가 초기/최종 상태를 한 프레임에 합쳐버리고
  // transition이 통째로 스킵되어 토스트가 "뿅" 나타나는 끊김이 발생할 수 있음.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('is-shown'));
  });

  if (ttl > 0) {
    setTimeout(() => closeToast(el), ttl);
  }
  return el;
}

function closeToast(el) {
  if (!el || !el.parentNode) return;
  el.classList.add('is-leaving');
  // CSS leave transition(transform 200ms / opacity 180ms)이 끝난 뒤 DOM에서 제거
  setTimeout(() => { try { el.remove(); } catch { /* noop */ } }, 240);
}

// =============================================================================
// 필터 / 정렬 / 포맷
//   (applyScopeFilter는 2026-05-14 스코프 라디오 제거와 함께 삭제됨.
//    scopeMode SSoT는 좌측 패널 user(global)/프로젝트 행 클릭이 가져감.)
// =============================================================================

/**
 * 표시 필터 — 행 부분집합 선택만 담당 (단일 책임).
 *
 * ADR-001 meta-docs-filter: with_deleted 분기는 state.includeDeleted로 분리되어
 * fetch 쿼리 파라미터(includeDeleted=1)에서만 의미를 가진다. 이 함수는 서버 응답이
 * 이미 적용된 상태의 list를 받아 "어떤 행을 화면에 표시할지"만 결정한다.
 */
function applyDisplayFilter(rows, display) {
  if (display === 'all') return rows;
  if (display === 'unused') {
    return rows.filter(r => r.id != null && (r.invocations ?? 0) === 0);
  }
  if (display === 'orphan') {
    return rows.filter(r => r.id == null);
  }
  return rows;
}

// =============================================================================
// 정렬 — COMPARATORS 맵 + dispatcher (단일 책임)
//
// 캡슐화 원칙:
//  - 컬럼별 비교 로직은 각각 작은 함수로 분리한다.
//  - applySort는 dispatcher 역할만 — 어느 컬럼이든 동일한 dir 적용.
//  - null/누락값 정책은 비교 함수 내부에서만 결정 (호출 측이 분기를 떠안지 않음).
//
// 비교 함수 반환값은 "asc 기준" — dispatcher에서 desc일 때 부호를 뒤집는다.
// 단, "데이터 없는 행은 항상 끝" 정책이 필요한 컬럼은 비교 함수 내부에서 dir과
// 무관한 보호 분기를 별도로 처리한다 (asc/desc 어느 쪽이든 끝으로).
// =============================================================================

const SORTABLE_KEYS = new Set([
  'type', 'name', 'source', 'invocations', 'last_used_at', 'total_tokens',
]);

/** 컬럼별 기본 정렬 방향 — 텍스트는 asc, 숫자/시간은 desc가 자연스럽다. */
const DEFAULT_DIR = {
  type:         'asc',
  name:         'asc',
  source:       'asc',
  invocations:  'desc',
  last_used_at: 'desc',
  total_tokens: 'desc',
};

/** 문자열 비교 — 활성 i18n 언어 기반 collator (i18n-utils.js SSoT 재사용) */
function cmpString(a, b) {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  const collator = getCollator();
  return collator ? collator.compare(sa, sb) : sa.localeCompare(sb);
}
/** 숫자 비교 (asc 기준). null/undefined는 0으로 처리 — 토큰합/호출수에 적합. */
function cmpNumber(a, b) {
  return (a ?? 0) - (b ?? 0);
}

/**
 * 컬럼별 비교 함수 맵 — 각 함수는 (a, b, dir)을 받아 asc 기준 부호를 반환한다.
 * dir을 인자로 받는 이유: "데이터 없는 행은 항상 끝" 같은 dir 무관 정책을 컬럼이 직접
 * 처리해야 할 때 dispatcher에서 일괄 부호 반전이 어긋나기 때문.
 *  - 이런 컬럼(last_used_at)은 내부에서 nullGuard를 dir-aware로 적용한다.
 *  - 그 외 컬럼은 단순 asc 비교만 하고 dispatcher가 desc일 때 부호를 뒤집는다.
 */
const COMPARATORS = {
  type: (a, b) => {
    const primary = cmpString(a.type, b.type);
    if (primary !== 0) return primary;
    // 동률 시 invocations desc 보조 — 사용자 안내대로
    return -cmpNumber(a.invocations, b.invocations);
  },
  name: (a, b) => cmpString(a.name, b.name),
  source: (a, b, dir) => {
    // orphan(source null)은 dir 무관하게 항상 마지막
    // dispatcher가 factor를 곱해도 끝 자리가 유지되도록 dir-aware 부호를 반환한다.
    const orphanA = a.source == null;
    const orphanB = b.source == null;
    if (orphanA && orphanB) return 0;
    if (orphanA || orphanB) {
      // a를 끝으로 보내고 싶을 때: asc(factor=+1)면 +1, desc(factor=-1)면 -1
      const sign = (dir === 'desc') ? -1 : 1;
      return orphanA ? sign : -sign;
    }
    const primary = cmpString(a.source, b.source);
    if (primary !== 0) return primary;
    return cmpString(a.source_root ?? '', b.source_root ?? '');
  },
  invocations: (a, b) => {
    const primary = cmpNumber(a.invocations, b.invocations);
    if (primary !== 0) return primary;
    // 동률 시 last_used_at 보조 — 더 최근에 사용된 행이 위
    return cmpNumber(a.last_used_at, b.last_used_at);
  },
  last_used_at: (a, b, dir) => {
    // null은 dir 무관하게 항상 끝 — dispatcher의 factor 반전을 흡수하도록 dir-aware 부호.
    const va = a.last_used_at;
    const vb = b.last_used_at;
    const nullA = va == null;
    const nullB = vb == null;
    if (nullA && nullB) return 0;
    if (nullA || nullB) {
      const sign = (dir === 'desc') ? -1 : 1;
      return nullA ? sign : -sign;
    }
    // 둘 다 값이 있으면 dispatcher가 일관 적용할 수 있도록 asc 기준 반환
    return cmpNumber(va, vb);
  },
  total_tokens: (a, b) => cmpNumber(a.total_tokens, b.total_tokens),
};

/**
 * 정렬 dispatcher — sort 키와 dir만 받아 결과 반환.
 * COMPARATORS에 없는 키는 invocations로 fallback.
 */
function applySort(rows, sort, dir = 'desc') {
  const cmp = COMPARATORS[sort] ?? COMPARATORS.invocations;
  const factor = dir === 'asc' ? 1 : -1;
  // last_used_at처럼 dir 무관 보호 분기를 직접 처리하는 컬럼은 비교 함수 내부에서
  // dir에 영향 받지 않는 부호(±1)를 반환한다 — dispatcher에서 factor를 곱해도
  // null 행은 그대로 끝으로 유지된다 (정책: 항상 끝).
  return rows.slice().sort((a, b) => factor * cmp(a, b, dir));
}

function shortenPath(p) {
  if (!p) return '';
  // ~/ 치환 — 사용자 홈 하위면 ~/.../<rest>
  const home = (typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac'))
    ? '/Users/' : '/home/';
  const idx = p.indexOf(home);
  if (idx >= 0) {
    const rest = p.slice(idx + home.length);
    const slash = rest.indexOf('/');
    if (slash > 0) return '~' + rest.slice(slash);
  }
  // 너무 길면 가운데 …
  return p.length > 60 ? p.slice(0, 28) + '…' + p.slice(-30) : p;
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function errorHtml(err) {
  return `<div class="state-empty"><span class="state-empty-title">${window.I18n.t('ui.meta-docs-view.load-failed', { message: escHtml(String(err?.message ?? err)) })}</span></div>`;
}

// 작은 fetch 래퍼 — sysLib 방식 동일
async function fetchJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
