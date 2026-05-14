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
import { getSelectedProject, getMetaSubTab, setMetaSubTab as stateSetMetaSubTab } from './state.js';
import { toolIconHtml } from './render/badges.js';
import { skMetaDocList } from './render/skeleton.js';
import { svgTrash, svgWarn, svgRefresh } from './render/icons.js';
// meta-docs-table-view ADR-004 (2026-05-14): 로그/syslib 테이블과 동일한 col-resize 핸들을 부착.
import { initColResize } from './col-resize.js';
// meta-docs feedback ADR (2026-05-14): 좌측 패널에 프로젝트별 Behavior Definitions 항목 수를 주입.
import { setMetaDocsCounts } from './left-panel.js';
// ADR-004 meta-docs-tool-stats: 프로젝트 단위 도구 통계 진입점.
import { loadProjectToolStats } from './tool-stats.js';

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
  // 마지막 동기화 결과 메타 (다음 렌더에서 합계 라벨에 노출)
  lastRefresh: null,       // { cwdsCount, summaryText } | null
  // 마지막으로 결정된 source_root 매칭 결과 (헤더 표시 + 빈 상태 처리)
  resolvedSource: null,    // { project, sourceRoot, matched } | null
  // ADR-003 left-rail-meta-docs: 딥링크 검색어. 행 가시성 필터(이름 부분일치, 대소문자 무시).
  searchTerm: '',
};

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
  await loadMetaDocsLibrary();
  applyMetaSubTab(getMetaSubTab());
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
 * 서브 탭 가시성·aria·active 클래스 적용 + 'tools' 데이터 로드.
 * setMetaSubTab과 enterMetaDocsMode 둘 다 호출하는 내부 헬퍼.
 */
function applyMetaSubTab(tab) {
  const docsBody  = document.getElementById('metaDocsBody');
  const toolsBody = document.getElementById('metaToolStatsBody');
  const tabDocs   = document.getElementById('metaTabDocs');
  const tabTools  = document.getElementById('metaTabToolStats');
  const isTools = tab === 'tools';

  if (docsBody)  docsBody.hidden  = isTools;
  if (toolsBody) toolsBody.hidden = !isTools;
  if (tabDocs) {
    tabDocs.classList.toggle('active', !isTools);
    tabDocs.setAttribute('aria-selected', isTools ? 'false' : 'true');
  }
  if (tabTools) {
    tabTools.classList.toggle('active', isTools);
    tabTools.setAttribute('aria-selected', isTools ? 'true' : 'false');
  }
  if (isTools) {
    // 프로젝트명은 좌측 셀렉터의 selectedProject — 두 탭 공통 컨텍스트.
    loadProjectToolStats(getSelectedProject());
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
    // 'docs'는 loadMetaDocsLibrary가 selectedProject 변경에 반응함 (기존 흐름 유지)
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
  root.innerHTML = `
    <div class="meta-docs-summary-card meta-docs-summary-card--used" title="호출이 1회 이상 발생한 Behavior Definitions">
      <span class="meta-docs-summary-card-value">${counts.used}</span>
      <span class="meta-docs-summary-card-label">사용</span>
    </div>
    <div class="meta-docs-summary-card meta-docs-summary-card--unused" title="카탈로그엔 있으나 호출 0건">
      <span class="meta-docs-summary-card-value">${counts.unused}</span>
      <span class="meta-docs-summary-card-label">미사용</span>
    </div>
    <div class="meta-docs-summary-card meta-docs-summary-card--orphan" title="호출은 있는데 현재 카탈로그에 없음 (외부/삭제된 정의)">
      <span class="meta-docs-summary-card-value">${counts.orphan}</span>
      <span class="meta-docs-summary-card-label">orphan</span>
    </div>
  `;
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

    // 2) 전체 카탈로그 probe — 항상 1회 fetch.
    //    meta-docs feedback ADR (2026-05-14): selected 모드 + 매칭 실패에서도 좌측 카운트가
    //    0으로 떨어지지 않도록 type/includeDeleted 필터 무관한 raw 카탈로그를 받아 둔다.
    //    좌측 카운트 + project source_root 매칭에 공통으로 사용.
    const probeRes = await fetchJson('/api/meta-docs');
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
    //    'all' 모드 + type='all' + includeDeleted=false 면 probe 결과를 그대로 재사용해 fetch 절감.
    const params = new URLSearchParams();
    if (state.type !== 'all') params.set('type', state.type);
    if (state.includeDeleted) params.set('includeDeleted', '1');
    if (resolvedSourceRoot) params.set('source_root', resolvedSourceRoot);
    const qs = params.toString();

    let list = [];
    if (!project || matched) {
      if (!qs) {
        // 필터 동일 — probe 재사용
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
    // ADR-003: 좌측 요약 카드(사용/미사용/orphan) 동기 갱신
    renderLeftSummaryCards(computeRowCounts(sorted));
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
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
  // meta-docs feedback ADR (2026-05-14): 우측 패널 'N 항목' summary 제거 —
  //   좌측 프로젝트 thead의 '항목' 컬럼이 SSoT를 가져간다.
  //   lastRefresh 힌트(cwd N개 동기화)는 필터 바 아래 단독 행으로 보존.
  const refreshHint = state.lastRefresh && state.lastRefresh.cwdsCount
    ? `<div class="meta-docs-refresh-hint" title="${escHtml(state.lastRefresh.cwdsTitle ?? '')}">cwd <strong>${state.lastRefresh.cwdsCount}</strong>개 동기화</div>`
    : '';

  const filters = renderFilters();

  // 빈 상태 — 프로젝트 미등록/미동기화 안내
  if (rows.length === 0) {
    const empty = (ctx.project && !ctx.matched)
      ? `<div class="state-empty">
           <span class="state-empty-title">${escHtml(ctx.project)} 프로젝트에 등록된 Behavior Definitions가 없습니다</span>
           <span class="state-empty-hint">이 프로젝트가 SessionStart로 동기화된 적이 없을 수 있습니다. 좌측 thead의 <strong>동기화</strong> 버튼을 누르면 알려진 모든 cwd를 다시 스캔합니다.</span>
         </div>`
      : `<div class="state-empty"><span class="state-empty-title">Behavior Definitions가 없습니다 — SessionStart 이후 자동 동기화됩니다</span></div>`;
    return `${filters}${refreshHint}${empty}`;
  }

  // meta-docs-table-view ADR-001/004 (2026-05-14): 카드 리스트 → 정렬·리사이즈 테이블.
  //  - colgroup 초기 폭: 타입 96 / 이름 180 / 경로 280 / 횟수 70 / 최근 적용 150 / 누적 토큰 100
  //    합계 876px — 메타 모드 메인 영역(좌측 패널 분량 제외) 폭에 가로 스크롤 없이 들어감.
  //  - thead th는 system-prompt-library와 동일하게 sortable + sort-asc/desc + aria-sort + ↕↑↓ 화살표.
  //  - col-resize 핸들은 bindEvents 마지막에 initColResize(table)로 자동 부착.
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
          ${thHtml('type',         '타입')}
          ${thHtml('name',         '이름')}
          ${thHtml('source',       '경로')}
          ${thHtml('invocations',  '횟수',       'num')}
          ${thHtml('last_used_at', '최근 적용')}
          ${thHtml('total_tokens', '누적 토큰',  'num')}
        </tr>
      </thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>
  `;
  return `${filters}${refreshHint}${head}`;
}

/**
 * meta-docs-table-view ADR-001 (2026-05-14): sortable thead 셀 1개 생성.
 * system-prompt-library의 th() 헬퍼와 동일 구조 — SORTABLE_KEYS 키 + ↕/↑/↓ 화살표 + aria-sort.
 * data-meta-sort 속성은 onMetaContainerClick / onMetaContainerKeydown이 동일 분기로 처리한다.
 */
function thHtml(key, label, extraCls = '') {
  const cls = `${extraCls} sortable ${sortHeaderCls(key)}`.trim();
  return `<th data-meta-sort="${key}"
              class="${cls}"
              tabindex="0"
              role="columnheader"
              aria-sort="${ariaSortValue(key)}">${escHtml(label)}${sortIndicator(key)}</th>`;
}

/** 헤더 active 클래스 — 단일 책임 (state.sort/sortDir 기준) */
function sortHeaderCls(key) {
  if (state.sort !== key) return '';
  return state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc';
}
/** 헤더 ↕/↑/↓ 화살표 — 단일 책임 */
function sortIndicator(key) {
  if (state.sort !== key) return '<span class="sort-arrow sort-arrow-idle">↕</span>';
  return state.sortDir === 'asc'
    ? '<span class="sort-arrow">↑</span>'
    : '<span class="sort-arrow">↓</span>';
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
    ? `<span class="meta-doc-source-orphan" title="${escHtml(ORPHAN_TOOLTIP)}" tabindex="0">호출만 존재</span>`
    : pathCellHtml(r);

  // description은 행 title 속성으로 hover 노출 — 별도 컬럼화하지 않음 (ADR-001).
  const titleAttr = r.description
    ? ` title="${escHtml(r.description)}"`
    : '';

  const deletedBadge = deleted
    ? ` <span class="meta-doc-deleted-badge" title="현재 디스크에서 사라진 정의 (soft-deleted)">${svgWarn({ size: 12 })}</span>`
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
  const types = [
    { v: 'all',     label: '전체'    },
    { v: 'agent',   label: 'Agent'   },
    { v: 'skill',   label: 'Skill'   },
    { v: 'command', label: 'Command' },
  ];
  // meta-docs feedback ADR (2026-05-14): 스코프 라디오 그룹 제거.
  //   좌측 패널의 [user(global) | 프로젝트] 행 선택이 scope SSoT를 가져감.
  //   기존 state.scope는 source 라벨(userSettings/projectSettings) 기준 추가 필터였으나
  //   좌측 진입점과 의미 축이 겹쳐 사용자 혼동 유발 → 제거.
  const displays = [
    { v: 'all',    label: '전체' },
    { v: 'unused', label: '미사용만' },
    { v: 'orphan', label: '호출만존재' },
  ];

  const btn = (group, opts, active) => opts.map(o =>
    `<button type="button" data-meta-filter="${group}" data-value="${o.v}"
       class="meta-doc-filter-btn ${o.v === active ? 'active' : ''}">${escHtml(o.label)}</button>`
  ).join('');

  // 직교 토글 — display와 의미 축이 다르므로 라디오 그룹 외부에 체크박스로 분리.
  // 라벨 능동형 + 휴지통 SVG(stroke-only) + title 툴팁의 3중 시각 단서로 학습 비용 ↓.
  //  - 사용자 피드백(2026-05-14): emoji 🗑 → SVG trash 로 디자인 톤 일치.
  const includeDeletedHtml = `
    <label class="meta-docs-include-deleted"
           title="과거 호출 이력은 있으나 디스크에서 사라진 항목까지 포함합니다">
      <input type="checkbox"
             data-meta-include-deleted
             ${state.includeDeleted ? 'checked' : ''} />
      <span class="meta-docs-include-deleted-icon" aria-hidden="true">${svgTrash({ size: 12 })}</span>
      <span class="meta-docs-include-deleted-label">삭제된 정의도 표시</span>
    </label>
  `;

  // 정렬 컨트롤은 더 이상 상단 필터 바에 두지 않는다 — 표 헤더 클릭으로 일원화.
  return `
    <div class="meta-docs-filters">
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">타입</span>${btn('type', types, state.type)}</div>
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">표시</span>${btn('display', displays, state.display)}</div>
      ${includeDeletedHtml}
    </div>
  `;
}

const ORPHAN_TOOLTIP =
  '이 호출은 다른 워크스페이스(.claude/) 또는 빌트인/플러그인 정의에서 발생했을 수 있습니다. 동기화 시 다중 cwd를 함께 스캔하면 이 행이 카탈로그 행으로 합쳐집니다.';

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

  // 동기화 버튼은 좌측 thead 셀(.thead-sync-btn)로 이관되어 본 핸들러에서 직접 처리하지 않음.
  // (initMetaDocsLeftNav가 body 위임으로 [data-meta-left-refresh] 셀렉터를 캐치 — single source.)
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
        message: 'orphan은 어느 프로젝트 호출인지 단정할 수 없어 전체 프로젝트 모드로 전환했습니다.',
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
  if (labelEl) labelEl.textContent = '동기화 중…';

  const startToast = pushToast({ kind: 'info', message: '동기화 시작…', ttl: 3000 });

  try {
    const body = buildRefreshBody();
    const res = await fetchJson('/api/meta-docs/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const norm = normalizeRefreshResult(res);
    state.lastRefresh = norm.meta;

    // 시작 토스트 정리 후 완료 토스트
    closeToast(startToast);
    pushToast({ kind: 'success', message: '동기화 완료 — ' + norm.summaryText, ttl: 5000 });
  } catch (err) {
    closeToast(startToast);
    const msg = err?.message ? String(err.message) : String(err);
    pushToast({ kind: 'error', message: '동기화 실패: ' + msg, ttl: 7000 });
  } finally {
    // 결과 토스트는 별도 영역. 패널은 즉시 재조회.
    await loadMetaDocsLibrary();
    // 좌측 패널 동기화 버튼은 loadMetaDocsLibrary가 detach하지 않으므로 직접 복원
    if (buttonEl.isConnected) {
      buttonEl.disabled = false;
      buttonEl.classList.remove('is-loading');
      const labelEl = buttonEl.querySelector('.meta-docs-refresh-label');
      if (labelEl) labelEl.textContent = '동기화';
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
  const data = res?.data ?? {};
  const parts = [];
  const fmt = (s) => {
    if (!s || typeof s !== 'object') return null;
    const up  = s.upserted ?? s.added ?? 0;
    const del = s.softDeleted ?? s.deleted ?? 0;
    return `+${up} / -${del}`;
  };

  const g = fmt(data.global);
  if (g) parts.push('글로벌 ' + g);
  const p = fmt(data.project);
  if (p) parts.push('프로젝트 ' + p);

  const cwds = Array.isArray(data.cwds) ? data.cwds : [];
  let cwdsCount = cwds.length;
  let cwdsTitle = '';
  if (cwdsCount) {
    parts.push(`cwd ${cwdsCount}개`);
    cwdsTitle = cwds.map(c => c?.cwd ?? '').filter(Boolean).join('\n');
  }

  return {
    summaryText: parts.length ? parts.join(', ') : '결과 없음',
    meta: cwdsCount ? { cwdsCount, cwdsTitle } : null,
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

  // entry 애니메이션 다음 프레임
  requestAnimationFrame(() => el.classList.add('is-shown'));

  if (ttl > 0) {
    setTimeout(() => closeToast(el), ttl);
  }
  return el;
}

function closeToast(el) {
  if (!el || !el.parentNode) return;
  el.classList.add('is-leaving');
  setTimeout(() => { try { el.remove(); } catch { /* noop */ } }, 220);
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

/** 문자열 비교 (한/영 통합 ko collator) */
const koCollator = (typeof Intl !== 'undefined' && Intl.Collator)
  ? new Intl.Collator('ko', { sensitivity: 'base', numeric: true })
  : null;
function cmpString(a, b) {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  return koCollator ? koCollator.compare(sa, sb) : sa.localeCompare(sb);
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
  return `<div class="state-empty"><span class="state-empty-title">불러오기 실패: ${escHtml(String(err?.message ?? err))}</span></div>`;
}

// 작은 fetch 래퍼 — sysLib 방식 동일
async function fetchJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
