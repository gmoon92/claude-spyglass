// 진입점 — 초기화, 이벤트 위임, SSE, selectProject
import { initTypeColors, recordRequest, drawTimeline, advanceBuckets, initBuckets } from './chart.js';
import { clearError, updateScrollLockBanner, jumpToLatest, resetScrollLockCount } from './infra.js';
import {
  getAllSessions, getAllProjects, renderBrowserProjects, renderBrowserSessions, showSkeletonSessions,
  GLOBAL_PROJECT_KEY,
} from './left-panel.js';
import {
  getRightView, setRightView, setDetailTab, getDetailTab,
  getSelectedProject, getSelectedSession, setSelectedProject, setSelectedSession,
  setDetailFilterBar,
  getAppMode, setAppMode,
  getPrevState, setPrevState, clearPrevState,
} from './state.js';
import { initAppRail, setRailActive } from './app-rail.js';
// ADR-turn-view-revamp-003: Agent/Skill 칩 → 메타 모드 딥링크 진입 위임이 폐기되어
// `openMetaDocViaDeepLink` import 제거. 사용자가 메타 모드로 진입하는 동선은 좌측 rail의
// `enterMetaDocsMode` 단일 경로로 통합. 메타 모드 내부 검색은 사이드바에서 직접 입력.
import { enterMetaDocsMode, setMetaSubTab, refreshMetaActiveSubTab, initMetaDocsLeftNav, setMetaScopeMode, initMetaSubTabs } from './meta-docs-view.js';
import {
  setDetailFilter, applyDetailFilter, setDetailView, toggleTurn,
  refreshDetailSession, initDetailSearch,
  toggleCardExpand, openLlmInputForTurn,
  initDetailTabBar,
} from './session-detail.js';
import {
  fetchDashboard, fetchRequests, fetchAllSessions, fetchSessionsByProject,
  fetchCacheStats, setIsSSEConnected,
} from './api.js';
import { fmtToken } from './formatters.js';
import { mountDateRangeDropdown } from './components/date-range-dropdown.js';
import { initDateRangeStorage } from './util/date-range-storage.js';
import { togglePromptExpand, resolveExpandTarget } from './renderers.js';
import { renderLlmInput } from './llm-input-view.js';
import { initColResize } from './col-resize.js';
import { initPanelResize } from './panel-resize.js';
import { initPanelVerticalResize, initPanelBottomResize } from './left-panel-vertical-resize.js';
import { initContextChart } from './context-chart.js';
import { createFilterBar } from './components/filter-bar.js';
import { initToolColors } from './tool-colors.js';
// ADR-004 후속: 세션 [도구] 탭이 제거되어 tool-stats 세션 init 진입점 없음 (메타 모드 [도구 통계]는 lazy 로드).
// v21 (system-reminder-badge): 칩 ↔ 팝오버 인터랙션 단일 부트스트랩.
import { initSystemReminderPopover } from './session-detail/system-reminder-popover.js';
import { initCacheTooltip } from './cache-tooltip.js';
import { initStatTooltip } from './stat-tooltip.js';
import { initCachePanelTooltip } from './cache-panel-tooltip.js';
import { initObsTooltip } from './obs-tooltip.js';
import { connectSSE } from './sse.js';
import {
  setChartMode, prependRequest, renderRightPanel,
  initDefaultView, toggleChartCollapse, restoreChartCollapsedState,
  migrateLocalStorage, restorePanelHiddenState, toggleLeftPanel,
  applyRangeLabels,
} from './views/default-view.js';
import { loadSession, abortCurrentSession } from './views/detail-view.js';
import { renderToolCategoriesCard, resetToolCategoriesMode } from './obs-panel.js';
import { initVersionCheck } from './version-check.js';

const STORAGE_KEY = 'spyglass:lastProject';

// ── 앱 모드 라우팅 (ADR-003 left-rail-meta-docs) ─────────────────────────────

/**
 * appMode 적용 — rail 버튼 동기화 + body 속성 부여 + view 가시성 결정.
 *
 * 책임: 단일 진입점 — rail 클릭 / sessionStorage 복원 / 딥링크 / ESC 복귀 모두 이 함수 호출.
 * 가시성 결정은 view 자체가 아니라 body[data-app-mode] CSS 룰로 처리 (선언적, 재진입 안전).
 *
 * @param {'browse' | 'metadocs'} mode
 */
function applyAppMode(mode) {
  if (mode !== 'browse' && mode !== 'metadocs') return;

  // browse 복귀 — meta-docs feedback ADR (2026-05-14):
  //   가상 'user (global)' 선택은 metadocs 전용이므로 mode 전환 BEFORE에 즉시 실제 프로젝트로 복원.
  //   순서가 중요: selectedProject를 먼저 실제 프로젝트로 바꾼 다음 setAppMode/body.dataset를 갱신해야
  //   renderBrowserProjects가 다시 호출되더라도 GLOBAL 잔존 행이 절대 그려지지 않는다.
  //   세션 hint('__global__ · 0개') 정정도 selectProject 흐름이 한꺼번에 처리.
  let pendingSelect = null;
  if (mode === 'browse' && getSelectedProject() === GLOBAL_PROJECT_KEY) {
    const projects = getAllProjects();
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved !== GLOBAL_PROJECT_KEY && projects.some(p => p.project_name === saved)) {
      pendingSelect = saved;
    } else if (projects.length > 0) {
      pendingSelect = projects[0].project_name;
    } else {
      // 데이터 없음 — GLOBAL 표식만 즉시 제거(이후 fetchDashboard가 채우면 자동 selectProject)
      setSelectedProject(null);
    }
  }

  setAppMode(mode);
  document.body.dataset.appMode = mode;
  setRailActive(mode);

  if (mode === 'metadocs') {
    enterMetaDocsMode();
    return;
  }

  // 항상 즉시 좌측 패널을 재렌더 — 메타 모드의 tbody 잔존(가상 행 / 항목수 컬럼)을 무조건 비움.
  //   selectProject는 fetchSessionsByProject 등 부수 흐름이 있어 GLOBAL 복원 케이스에서만 사용.
  if (pendingSelect) {
    selectProject(pendingSelect);
  } else {
    renderBrowserProjects();
  }
}

/**
 * ADR-003: 메타 모드 진입 직전의 browse 상태를 snapshot — ESC 복귀용.
 * 이미 metadocs인 상태에서 재진입 시는 snapshot 덮어쓰지 않음 (사용자 직전 browse 상태 보존).
 */
function snapshotBrowseState() {
  if (getAppMode() === 'metadocs' && getPrevState() != null) return;
  setPrevState({
    rightView: getRightView(),
    detailTab: getDetailTab(),
    sessionId: getSelectedSession(),
  });
}

/**
 * ADR-003: ESC 누름 시 호출 — metadocs → browse 복귀 + 직전 view/tab/session 복원.
 * snapshot이 없으면 단순 browse 복귀(default-view).
 */
function restorePrevState() {
  const prev = getPrevState();
  applyAppMode('browse');
  if (!prev) {
    clearPrevState();
    return;
  }
  // session/detail 복원은 loadSession이 SSE/fetch 흐름을 관리하므로 단순 view 토글로 충분.
  // sessionId만 보존하면 사용자가 직접 클릭하지 않고도 같은 detail 화면 유지.
  if (prev.rightView === 'detail' && prev.sessionId) {
    // 세션 ID는 selectSession에 의해 이미 set되어 있을 가능성 — view만 토글하면 detail 그대로 노출.
    setRightView('detail');
    if (prev.detailTab) setDetailTab(prev.detailTab);
    renderRightPanel();
  } else {
    setRightView('default');
    renderRightPanel();
  }
  clearPrevState();
}

// ── Behavior Definitions Top N 헬퍼 ─────────────────────────────────────────────────────

/**
 * 프로젝트 이름으로 /api/meta-docs 전체 목록에서 source_root를 매핑.
 * meta-docs-view.js의 findSourceRootByProject와 동일 로직 — 단일 책임 분리.
 * (호출 측은 raw rows + projectName만 전달, 판단은 이 함수 내부)
 */
function resolveMetaDocsSourceRoot(rows, projectName) {
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

/**
 * 프로젝트 선택 시 Behavior Definitions 호출 수 Top 5 fetch → renderToolCategoriesCard에 전달.
 * 실패 시 카드 상태 변경 없음 (silent fallback).
 */
async function renderMetaDocsTopForProject(projectName) {
  try {
    const probeRes = await fetch('/api/meta-docs');
    if (!probeRes.ok) return;
    const probeJson = await probeRes.json();
    const allRows = Array.isArray(probeJson?.data) ? probeJson.data : [];

    const sourceRoot = resolveMetaDocsSourceRoot(allRows, projectName);
    if (!sourceRoot) return;

    const url = `/api/meta-docs?source_root=${encodeURIComponent(sourceRoot)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];

    // invocations 내림차순 정렬 → 상위 5건 (호출 없는 행 제외)
    const top5 = rows
      .filter(r => r.id != null && (r.invocations ?? 0) > 0)
      .sort((a, b) => (b.invocations ?? 0) - (a.invocations ?? 0))
      .slice(0, 5)
      .map(r => ({ name: r.name, invocations: r.invocations ?? 0 }));

    renderToolCategoriesCard({ mode: 'meta-docs', items: top5 });
  } catch { /* silent — 카드 상태 유지 */ }
}

/**
 * 가상 user(global) 선택 시 전역 Behavior Definitions 호출 수 Top 5 렌더.
 * 동일 name이 여러 source_root에 존재하면 invocations 합산. orphan(id=null) 제외.
 * 실패 시 silent — Tool Categories 카드의 기존 상태 유지.
 */
async function renderMetaDocsTopForGlobal() {
  try {
    const res = await fetch('/api/meta-docs');
    if (!res.ok) return;
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];

    const sumByName = new Map();
    for (const r of rows) {
      if (r.id == null) continue;
      const inv = r.invocations ?? 0;
      if (inv <= 0) continue;
      sumByName.set(r.name, (sumByName.get(r.name) ?? 0) + inv);
    }
    const top5 = [...sumByName.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, invocations]) => ({ name, invocations }));

    renderToolCategoriesCard({ mode: 'meta-docs', items: top5 });
  } catch { /* silent — 카드 상태 유지 */ }
}

function autoActivateProject() {
  if (getSelectedProject()) return;
  const projects = getAllProjects();
  if (!projects.length) return;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && projects.some(p => p.project_name === saved)) { selectProject(saved); return; }
  const sessions = getAllSessions();
  if (sessions.length) {
    const latest = sessions.reduce((a, b) => ((a.started_at || 0) > (b.started_at || 0) ? a : b));
    if (latest.project_name) { selectProject(latest.project_name); return; }
  }
  selectProject(projects[0].project_name);
}

function selectProject(name) {
  const isMetaDocsActive = getAppMode() === 'metadocs';

  // meta-docs feedback ADR (2026-05-14): 메타 모드 좌측 패널의 가상 'user (global)' 행 처리.
  //   - data-project="__global__" 클릭 → state.scopeMode='all' 로 전환 후 카탈로그 재로드.
  //   - localStorage에는 가상 키를 저장하지 않는다(브라우저 모드로 돌아갔을 때 무효 키 회피).
  //   - browse 모드에서는 이 분기가 절대 발생하지 않음(가상 행이 렌더되지 않으므로).
  if (isMetaDocsActive && name === GLOBAL_PROJECT_KEY) {
    setSelectedProject(GLOBAL_PROJECT_KEY);
    setMetaScopeMode('all');         // 카탈로그 fetch + 좌측 카운트 동기 갱신은 setMetaScopeMode가 책임
    renderBrowserProjects();          // 선택 표시(row-selected) 즉시 갱신
    // tool-stats-relocate: cardToolCategories가 metadocs 좌측으로 이전됐으므로,
    // 글로벌 선택에서도 잔존 데이터가 남지 않도록 전역 Top 5로 갱신.
    // resetToolCategoriesMode를 호출하지 않는 이유: meta-docs 모드 페이로드를 직접 덮어쓰므로 가드와 무관.
    renderMetaDocsTopForGlobal();
    return;
  }

  // 프로젝트 전환(또는 해제) 시 Tool Categories 카드 모드를 초기화.
  // renderMetaDocsTopForProject가 성공하면 'meta-docs'로 재진입하고,
  // 새 프로젝트에 Behavior Definitions 호출이 없으면 다음 fetchObservability 배열 payload가 정상 렌더링된다.
  resetToolCategoriesMode();

  localStorage.setItem(STORAGE_KEY, name);
  setSelectedProject(name);

  // ADR-003 left-rail-meta-docs: Behavior Definitions 모드(appMode === 'metadocs')에서 좌측 프로젝트만 바꾼 경우는
  // 메타 카탈로그만 새 프로젝트 기준으로 다시 그린다. browse 모드면 기존처럼 detail을 닫고 default로 복귀.

  if (!isMetaDocsActive) {
    setSelectedSession(null);
    if (getRightView() === 'detail') {
      setRightView('default');
      renderRightPanel();
    }
  }

  renderBrowserProjects();
  document.getElementById('sessionPaneHint').textContent = `${name} · …`;
  showSkeletonSessions();
  fetchSessionsByProject(name);

  if (isMetaDocsActive) {
    // meta-docs feedback ADR: 실제 프로젝트 선택 시 scopeMode='selected' 보장.
    //   user(global) → 프로젝트 전환 시에도 scope가 일관되게 'selected'로 정정된다.
    setMetaScopeMode('selected');
    // ADR-004 meta-docs-tool-stats: 활성 서브 탭에 따라 분기 갱신.
    //   - 'docs' 활성 → loadMetaDocsLibrary (기존 동작)
    //   - 'tools' 활성 → loadProjectToolStats (새 프로젝트로 매트릭스 재 fetch)
    refreshMetaActiveSubTab();
  }

  // dashboard-ui-enhancements: 프로젝트 선택 시 하단 Tool Categories 카드를
  // 해당 프로젝트 Behavior Definitions 호출 Top 5로 교체 (비동기, 실패 시 silent)
  renderMetaDocsTopForProject(name);
}

function closeDetail() {
  abortCurrentSession();
  setSelectedSession(null);
  setRightView('default');
  setChartMode('default');
  renderRightPanel();
  renderBrowserSessions();
  fetchDashboard();
  fetchCacheStats();
}

function manualRefresh() {
  fetchDashboard();
  fetchRequests();
  fetchCacheStats();
}

// SSE 이벤트로 fetchDashboard를 호출할 때 사용하는 debounce + maxWait.
// 기존 단순 debounce는 활발한 세션(이벤트 1초 미만 간격)에서 timer가 영원히 reset되어
// _allProjects/_allSessions가 빈 상태로 고정 → 사이드바·도넛이 무한 로딩처럼 보이는 버그.
// 첫 예약으로부터 MAX_WAIT 경과 시 강제 실행하고, 응답 후 autoActivateProject를 재시도해
// 빈 DB → 데이터 도착 시점의 race도 함께 복구한다.
let refreshDebounce = null;
let refreshScheduledAt = 0;
const REFRESH_DEBOUNCE_MS = 1000;
const REFRESH_MAX_WAIT_MS = 3000;

function scheduleDashboardRefresh() {
  const now = Date.now();
  if (refreshScheduledAt === 0) refreshScheduledAt = now;

  const fire = async () => {
    refreshScheduledAt = 0;
    refreshDebounce = null;
    await fetchDashboard();
    autoActivateProject();
  };

  clearTimeout(refreshDebounce);
  if (now - refreshScheduledAt >= REFRESH_MAX_WAIT_MS) { fire(); return; }
  refreshDebounce = setTimeout(fire, REFRESH_DEBOUNCE_MS);
}

function startSSE() {
  connectSSE({
    onNewRequest(e) {
      recordRequest();
      drawTimeline();
      try {
        const evt = JSON.parse(e.data);
        const req = evt.data;
        const sess = getAllSessions().find(s => s.id === req.session_id);
        if (sess) {
          sess.total_tokens = req.session_total_tokens;
          const sessRow = document.querySelector(`[data-session-id="${CSS.escape(req.session_id)}"]`);
          const tokEl   = sessRow?.querySelector('.sess-row-tokens');
          if (tokEl) tokEl.textContent = fmtToken(req.session_total_tokens);
          else renderBrowserSessions();
        } else {
          fetchAllSessions();
        }
        prependRequest(req);

        // ADR-turn-view-revamp-§3.6 (Option α — active turn only):
        //   1) 활성 턴이면 turn-spine + flow-head IN/OUT 카운터를 in-place 패치 (DOM 패치 단위 `data-cell`).
        //   2) in-place 패치 성공 + 활성 턴 변동만 있는 케이스는 전체 fetch를 생략 — 사용자 시각 잡음/네트워크 최소화.
        //   3) 패치 불가(비활성 턴, WT2 미머지 상태, 새 turn 생성 등) → 기존 refreshDetailSession 폴백 유지.
        //
        //   본 분기는 회귀 안전 — patchActiveTurnFromSSE가 false면 동작이 기존과 동일.
        if (getSelectedSession() === req.session_id) {
          const patched = patchActiveTurnFromSSE(req);
          if (!patched) refreshDetailSession(req.session_id);
        }
      } catch { /* silent */ }

      scheduleDashboardRefresh();
    },
    // 프록시 데이터 SSE 채널 — 후방 호환을 위해 옵션 콜백.
    // 현재 웹 대시보드에는 proxy 패널이 없으므로 'spyglass:proxy-request' 커스텀 이벤트로
    // 디스패치해 후속 패널 도입 시 1줄로 구독할 수 있게 한다.
    // @see ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/proxy-sse-integration/adr.md ADR-003
    //
    // v21 fix: 메인 세션이 다른 곳에서 활동하여 hook은 안 들어오고 proxy만 들어오는 시나리오
    //   (예: 자동 백그라운드 호출, 다른 세션의 동시 진행)에서도 도넛/옵저빌리티 패널이 갱신되도록
    //   debounce 후 fetchDashboard 트리거. hook 채널과 동일한 1초 debounce 큐를 공유.
    onNewProxyRequest(e) {
      try {
        const evt = JSON.parse(e.data);
        // window 레벨 커스텀 이벤트로 디스패치 (구독자가 없으면 no-op)
        document.dispatchEvent(new CustomEvent('spyglass:proxy-request', {
          detail: evt.data,
        }));
      } catch { /* silent */ }

      scheduleDashboardRefresh();
    },
    // v22: 세션 활성/비활성 전환 — SessionStart/SessionEnd 시 즉시 사이드바 마커 갱신
    // payload.action: 'started' | 'ended' | 'token_update'
    onSessionUpdate(e) {
      try {
        const evt = JSON.parse(e.data);
        const d = evt.data || {};
        const sess = getAllSessions().find(s => s.id === d.session_id);
        if (sess) {
          if (d.action === 'ended' && d.ended_at != null)   sess.ended_at = d.ended_at;
          if (d.action === 'started')                        sess.ended_at = null;
          renderBrowserSessions();
        } else {
          // 캐시에 없는 새 세션이면 전체 갱신 (started 케이스)
          fetchAllSessions();
        }
      } catch { /* silent */ }
    },
    onOpen() {
      clearError();
      setIsSSEConnected(true);
      const loadMoreBtn = document.getElementById('loadMoreBtn');
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      Promise.all([fetchDashboard(), fetchAllSessions()]).then(() => autoActivateProject());
      fetchRequests();
    },
    onError() {
      setIsSSEConnected(false);
      resetScrollLockCount();
      updateScrollLockBanner();
    },
  });
}

/**
 * date-range-filter (Wave 9) — #dateFilter 컨테이너에 드롭다운 컴포넌트 mount.
 *
 * 책임:
 *  - components/date-range-dropdown.js (combobox+listbox, ADR-005) 1개 mount.
 *  - 클릭/키보드 이벤트는 컴포넌트 내부에서 직접 처리 — main.js 위임 핸들러 제거 (flood 방지).
 *  - range 변경 통지는 'cs:active-range-changed' 단일 이벤트로 — fetchAll/라벨 갱신은
 *    init() 내부의 단일 구독 리스너에서 처리 (ADR-003).
 *
 * 호출자: init() — DOMContentLoaded 시 1회.
 */
function initDateFilter() {
  const container = document.getElementById('dateFilter');
  if (!container) return;
  mountDateRangeDropdown(container);
}

// ── ADR-turn-view-revamp-003: 칩 ↔ 행 점프 헬퍼 ─────────────────────────────────
//
// 책임:
//   - 칩의 `data-chip-key` 값을 받아 동일 키를 가진 매칭 노드를 찾아 스크롤 + flash.
//   - 칩 키 형식은 turn-rows.js `chipKey()`가 결정한다 — 본 모듈은 키 형식 비의존.
//   - 매칭 우선순위: log-pane 행(`tbody tr[data-chip-key]`) → 일반 셀(`[data-chip-key]`).
//   - 일치 노드가 없으면 silent fail (사용자 입력은 받지만 부수효과 없음).
//
// 호출자: `handleChipActivation` (click/keydown 위임의 단일 진입점)
// 의존성: 없음 (순수 DOM 조회 + CSS 클래스 토글)

/** flash 클래스 노출 시간 — 점프 시각 피드백을 더 명확하게 인지하도록 2.2초로 확장.
 *  CSS keyframe(row-flash) 지속(2.0s) + 100ms 여유. 같은 행을 연타할 때 reflow 강제로
 *  애니메이션이 재시작되므로 길이 자체가 사용자 인지에 직결된다. */
const CHIP_FLASH_MS = 2200;

/**
 * 칩 키와 매칭되는 행/셀을 찾는다 (chip-key 기반 폴백 경로).
 *
 * 1순위: 활성 턴 log-pane(`#turnLogBody` tbody) 내부의 `tr[data-chip-key="..."]`
 * 2순위: 같은 키를 가진 일반 노드(turn-spine 칩끼리 점프하는 경우 등)
 *
 * ADR-turn-view-revamp-004: 레거시 `#detailRequestsView`(세션 전체 평면 표) 제거 →
 *   활성 턴 단일 SSoT(`#turnLogBody`)에서만 행 매칭.
 *
 * 주의 (#46 group-jump 정확도):
 *   chip-key 는 중복 가능(예: 동명 도구가 여러 번 등장). DOM 첫 매칭이 반환되므로
 *   NEUTRAL 윈도우 묶음 칩처럼 "그룹 내 첫 항목" 이 타깃인 경우엔 본 함수가 부적합.
 *   그 경우는 `findChipTargetByRequestId` 를 먼저 사용한다.
 *
 * @param {string} key chip-key (예: "tool:Bash", "resp:3")
 * @returns {Element|null}
 */
function findChipTarget(key) {
  if (!key) return null;
  const safe = CSS.escape(key);
  // log-pane 우선 — plan §3.6 Option α (활성 턴 좁힘)
  const logBody = document.getElementById('turnLogBody');
  const row = logBody?.querySelector(`tr[data-chip-key="${safe}"]`);
  if (row) return row;
  // 폴백 — turn-spine / flow-head 일반 노드 (자기 칩 클릭 시 자기 행이 없으면 silent)
  return document.querySelector(`#detailView [data-chip-key="${safe}"]`);
}

/**
 * request id 로 활성 턴 log-pane 안의 정확한 행을 찾는다 (그룹 칩 우선 경로).
 *
 * 사용처: NEUTRAL 윈도우 묶음 칩(turn-views.js#chipHtml isGroup 분기)이
 *   `data-target-request-id="<items[0].id>"` 를 부착 — chip-key 중복으로 인한
 *   오점프(같은 도구명이 그룹 앞쪽에 또 있는 경우)를 차단한다.
 *
 * @param {string} rid request.id
 * @returns {Element|null}
 */
function findChipTargetByRequestId(rid) {
  if (!rid) return null;
  const logBody = document.getElementById('turnLogBody');
  return logBody?.querySelector(`tr[data-request-id="${CSS.escape(rid)}"]`) || null;
}

/**
 * 노드를 화면 중앙으로 smooth scroll + `row-highlight-flash` 클래스 1.5초 부여.
 * 클래스는 turn-view.css `@keyframes row-flash` 가 시각 책임 (SSoT).
 *
 * 같은 노드에 flash가 이미 적용 중이면 클래스 재부여로 애니메이션이 끊겨 보일 수 있으므로
 * 일단 제거 후 다시 부여 — reflow 강제로 애니메이션을 재시작한다.
 *
 * @param {Element|null} el
 */
function flashChipTarget(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('row-highlight-flash');
  // eslint-disable-next-line no-unused-expressions — reflow 강제 (애니메이션 재시작)
  void el.offsetWidth;
  el.classList.add('row-highlight-flash');
  setTimeout(() => el.classList.remove('row-highlight-flash'), CHIP_FLASH_MS);
}

/**
 * 칩 활성화(클릭 또는 Enter/Space) 시 호출 — 단일 진입점.
 *
 * 타깃 결정 우선순위:
 *   1) chip.dataset.targetRequestId 가 있으면 그 id 의 행으로 점프 (그룹 칩 등 정확 지정).
 *   2) chip.dataset.chipKey 로 첫 매칭 행/노드 검색 (단일 도구·응답·task 칩 등).
 *   3) 둘 다 없거나 매칭 실패면 silent.
 *
 * 자동 펼침 정책 (#46 — 사용자 요청 broaden):
 *   기존엔 `task:` prefix 만 자동 펼침 대상이었으나, 사용자가 "뱃지 클릭시 로그 이동 +
 *   펼치기 기능이 몇개 누락" 으로 보고 → 모든 칩(타깃이 log-pane `<tr>` 인 경우)에 대해
 *   data-expand-id 를 가진 prompt-preview 가 있으면 `togglePromptExpand` 로 펼친다.
 *   이미 펼쳐져 있으면(dataset.expanded === rid) no-op — 토글 닫힘 회피 가드.
 *
 * 칩 자체에 `tabindex="0"` / `role="button"` / `aria-label` 부여는 칩 빌더(turn-views.js)
 * 책임 (SSoT). 본 함수는 동작만 책임.
 *
 * @param {Element} chip `[data-chip-key]` 노드 (선택적으로 `data-target-request-id` 동반)
 */
function handleChipActivation(chip) {
  const key = chip?.dataset?.chipKey || '';
  const targetRid = chip?.dataset?.targetRequestId || '';
  // 1) request-id 우선 (그룹 칩 정확 지정), 2) chip-key 폴백.
  const target = (targetRid && findChipTargetByRequestId(targetRid))
              || (key && findChipTarget(key))
              || null;
  if (!target) return;
  flashChipTarget(target);

  // 모든 log-pane 행 타깃 — 점프 후 상세 메시지 자동 펼치기.
  if (target.tagName === 'TR') {
    const preview = target.querySelector('[data-expand-id]');
    const rid = preview?.dataset?.expandId;
    if (rid && target.dataset.expanded !== rid) {
      togglePromptExpand(rid, target);
    }
  }
}

/**
 * `#detailView` 컨테이너에 칩 클릭/키보드 위임을 1회 등록.
 *
 * 핸들러 1개로 click + keydown(Enter/Space)을 모두 처리해 turn-spine / flow-head /
 * log-pane 어디에 칩이 박혀도 동작한다 — 칩 컨테이너가 늘어나도 위임 등록을 늘리지 않는다.
 *
 * 호출자: initEventDelegation()
 */
function initChipActivationDelegation() {
  const root = document.getElementById('detailView');
  if (!root) return;

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip-key]');
    if (!chip) return;
    // log-pane 표 행(`tr`)은 행 자체에 chip-key가 박혀있어도 클릭 시 점프 동작을
    // 트리거하지 않는다 — 표 행 클릭은 prompt-expand 등 다른 핸들러의 영역.
    if (chip.tagName === 'TR') return;
    e.preventDefault();
    e.stopPropagation();
    handleChipActivation(chip);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const chip = e.target.closest('[data-chip-key][role="button"]');
    if (!chip) return;
    if (chip.tagName === 'TR') return;
    e.preventDefault();
    handleChipActivation(chip);
  });
}

// ── ADR-turn-view-revamp-004 §3.6: SSE 활성 턴 in-place 갱신 ─────────────────────
//
// 책임:
//   - SSE로 도착한 신규 request가 "활성 턴"에 속하면 turn-spine 칩 + flow-head IN/OUT
//     카운터를 in-place 갱신한다 (DOM 패치 최소화 — 전체 재렌더 회피).
//   - 비활성 턴(접힌 턴)에는 갱신을 시도하지 않는다 — 다음 활성화 시점에 일괄 재렌더.
//   - DOM 패치 단위는 `data-cell` 속성이 박힌 노드(예: `data-cell="in"`, `data-cell="out"`,
//     `data-cell="cache"`, `data-cell="duration"`).
//   - log-pane 본문(`#turnLogBody`)에 새 행 append는 본 모듈이 담당하지 않는다.
//     turn-rows.js의 `makeTurnLogRows` 또는 row builder를 호출하는 turn-views.js 영역.
//
// 동작 정책:
//   - "활성 턴" 식별은 turn-spine 또는 flow-head DOM의 dataset(`data-active-turn-id`)으로
//     판단한다. WT2 머지 전(현재 코드)에는 해당 속성이 없으므로 본 함수는 false 반환 →
//     `refreshDetailSession` fallback이 자동 동작 (회귀 0).
//   - 패치 가능 셀이 하나라도 없으면 false 반환 — caller가 fallback으로 전체 fetch를 트리거.

/**
 * 활성 턴 컨테이너(turn-spine의 활성 turn-line 또는 flow-head)를 찾는다.
 *
 * 후보 셀렉터(우선순위 순):
 *   1) `#detailTurnView [data-active-turn-id="${turnId}"]` — turn-spine SSoT
 *   2) `#detailTurnView .flow-head[data-turn-id="${turnId}"]` — flow-head 폴백
 *
 * @param {string} turnId
 * @returns {Element|null}
 */
function findActiveTurnContainer(turnId) {
  if (!turnId) return null;
  const safe = CSS.escape(turnId);
  return (
    document.querySelector(`#detailTurnView [data-active-turn-id="${safe}"]`) ||
    document.querySelector(`#detailTurnView .flow-head[data-turn-id="${safe}"]`) ||
    null
  );
}

/**
 * 단일 셀(`[data-cell="<name>"]`)의 텍스트만 갈아끼운다 (in-place 패치).
 * 셀이 없으면 silent fail — 호출자(`patchActiveTurnFromSSE`)가 셀 보강 시점을 판단한다.
 */
function patchCell(container, cellName, text) {
  if (!container || text == null) return false;
  const cell = container.querySelector(`[data-cell="${cellName}"]`);
  if (!cell) return false;
  cell.textContent = text;
  return true;
}

/**
 * SSE 신규 request → 활성 턴 turn-spine + flow-head IN/OUT 카운터 in-place 갱신.
 *
 * 처리 흐름:
 *   1) `req.turn_id`로 활성 턴 컨테이너 검색 → 없으면 false (비활성 턴 또는 WT2 미머지 상태).
 *   2) `data-cell="in"` / `"out"` / `"cache"` / `"duration"` 셀을 텍스트로 패치.
 *   3) 패치한 셀이 1개 이상이면 true (호출자는 추가 fetch 생략 가능).
 *
 * 패치 실패(셀 미존재)는 정상 폴백 시나리오 — 호출자가 `refreshDetailSession`을 부른다.
 *
 * @param {object} req 신규 request payload (server normalized)
 * @returns {boolean} in-place 패치 성공 여부
 */
function patchActiveTurnFromSSE(req) {
  if (!req || !req.turn_id) return false;
  const container = findActiveTurnContainer(req.turn_id);
  if (!container) return false;

  // 누적 합계가 컨테이너 dataset(`data-in-sum`, `data-out-sum`)으로 들어와 있으면 그 위에 누적한다.
  // 없으면 단일 request의 토큰만 노출 (첫 SSE 도착 시점 — turn-views.js 첫 렌더가 미완 케이스).
  const sumIn  = (parseInt(container.dataset.inSum  || '0', 10) || 0) + (req.tokens_input  || 0);
  const sumOut = (parseInt(container.dataset.outSum || '0', 10) || 0) + (req.tokens_output || 0);
  container.dataset.inSum  = String(sumIn);
  container.dataset.outSum = String(sumOut);

  const inText  = fmtToken(sumIn);
  const outText = fmtToken(sumOut);

  let patched = 0;
  if (patchCell(container, 'in',  inText))  patched += 1;
  if (patchCell(container, 'out', outText)) patched += 1;
  // cache / duration 셀은 SSE 단건으로 누적 합계를 신뢰하기 어려워(서버 SSoT 의존) 패치 생략.
  // 추후 server 측 summary 필드가 동봉되면 동일 패턴으로 확장.
  return patched > 0;
}

function initEventDelegation() {
  document.querySelector('.left-panel').addEventListener('click', e => {
    const projRow = e.target.closest('[data-project]');
    if (projRow) { selectProject(projRow.dataset.project); return; }
    const sessRow = e.target.closest('[data-session-id]');
    if (sessRow)  { loadSession(sessRow.dataset.sessionId); }
  });

  // ── ADR-turn-view-revamp-003: 칩 클릭 → 매칭 행 스크롤 + flash (통합 위임) ──
  //
  // 책임:
  //   - 모든 칩(`[data-chip-key]`)의 클릭 + 키보드 활성화를 단일 핸들러로 처리.
  //   - 칩 키 SSoT는 session-detail/turn-rows.js의 `chipKey()` / `chipKeyForRequest()`.
  //     본 위임은 셀렉터·키 형식을 알 필요가 없다 — 칩 측이 박은 key 그대로 매칭.
  //   - 활성 턴 / 비활성 턴 구분은 turn-views.js의 setActive 로직이 책임 (본 위임은
  //     "키가 박힌 행 또는 셀로 스크롤 + flash" 만 수행).
  //
  // 통합 이력:
  //   - 기존 Agent/Skill 칩의 메타 모드 딥링크(`data-meta-doc-type`/`data-meta-doc-id`) 진입은
  //     ADR-turn-view-revamp-003 결정에 따라 본 통합 위임으로 흡수·폐기.
  //   - 메타 모드 진입은 좌측 rail 또는 사이드바를 통해 유지 (사용자 동선 보존).
  //
  // 위치: `#detailView` 한 곳에 위임 — turn-spine / flow-head / log-pane 모두 후손에 포함.
  initChipActivationDelegation();

  // ADR-004 meta-docs-tool-stats:
  //   메타 모드 서브 탭 [메타 문서] / [도구 통계] 클릭 위임.
  //   [data-meta-subtab] 단일 SSoT — meta-docs-view.js의 setMetaSubTab이 가시성/aria/데이터 로드 일원화.
  //   meta-docs-flow ego-graph (2026-05-21 rev): 'flow' 탭 제거 — 흐름은 'docs' 탭 상단 영역으로 흡수.
  document.body.addEventListener('click', e => {
    const tab = e.target.closest('[data-meta-subtab]');
    if (!tab) return;
    const which = tab.dataset.metaSubtab;
    if (which !== 'docs' && which !== 'tools') return;
    setMetaSubTab(which);
  });

  // ADR-004 후속: 세션 [도구] 탭이 제거되면서 outbound 링크("↗ 프로젝트 전체로 보기")도 함께 제거됨.
  //   세션→프로젝트 도구 통계 전환 경로는 좌측 rail + 셀렉터 조합으로 일원화.

  // ADR-003: ESC → metadocs 모드일 때 browse 복귀 (input/textarea focus 시는 무시)
  // stopImmediatePropagation으로 keyboard.js의 기본 ESC 핸들러(detail 닫기)와 충돌 방지 —
  // metadocs 모드의 ESC는 "메타 모드 종료 + 직전 browse 복귀"가 1차 의미이며,
  // 직전 browse 상태가 detail이었으면 그대로 detail에 머무는 것이 사용자 기대.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (getAppMode() !== 'metadocs') return;
    const ae = document.activeElement;
    const tag = ae?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || ae?.isContentEditable) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    restorePrevState();
  }, { capture: true });

  document.getElementById('detailTabBar').addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { setDetailTab(tab.dataset.tab); setDetailView(tab.dataset.tab); }
  });

  document.getElementById('retryBtn').addEventListener('click', manualRefresh);
  document.getElementById('scrollLockBanner').addEventListener('click', jumpToLatest);

  // date-range-filter ADR-003 — 활성 range 변경 단일 구독.
  // 드롭다운 컴포넌트가 setActiveRange()를 호출 → 'cs:active-range-changed' 이벤트 발행 →
  // 여기서 차트 라벨 + 4 fetch를 일괄 트리거. 위임 핸들러 폐기로 flood 방지.
  document.addEventListener('cs:active-range-changed', (e) => {
    const ar = e.detail;
    const labelKey = ar.type === 'custom' ? 'custom' : ar.value;
    applyRangeLabels(labelKey);
    fetchDashboard(); fetchRequests(); fetchCacheStats(); fetchAllSessions();
  });

  const detailFilterBar = createFilterBar('detailTypeFilterBtns', {
    dataAttr: 'detail-filter',
    onChange(filter) {
      // ── ADR-008: 'system' 필터 클릭 시 System 라이브러리 탭으로 자동 전환 ──
      // 카운트의 의미(distinct system_hash 수 = 카탈로그 크기)와 동작 위치(라이브러리 탭)를 일치.
      // filter 상태는 변경하지 않음 — 사용자가 라이브러리 → 평면 탭 복귀 시 이전 컨텍스트 보존.
      if (filter === 'system') {
        setDetailTab('syslib');
        setDetailView('syslib');
        return;
      }
      setDetailFilter(filter);
      applyDetailFilter();
    },
  });
  setDetailFilterBar(detailFilterBar);
  // ADR-008 시각 hint — 외부 이동 어휘를 다른 필터와 분리 (↗ glyph는 syslib.css의 ::after).
  document.querySelector('[data-detail-filter="system"]')
    ?.setAttribute('title', window.I18n.t('ui.main.system-filter.title'));

  document.getElementById('detailView').addEventListener('click', e => {
    // 턴 카드의 "API 페이로드" 액션 (deeplink pass) — toggle-card 가드보다 먼저 매칭해
    // 카드 펼침이 함께 발생하지 않도록 분기 + stopPropagation 불필요(return).
    const payloadBtn = e.target.closest('[data-payload-ts]');
    if (payloadBtn) {
      const ts = parseInt(payloadBtn.dataset.payloadTs, 10);
      if (Number.isFinite(ts)) openLlmInputForTurn(ts);
      return;
    }

    // ADR-turn-view-revamp-004: 신 모델에서는 turn-spine .turn-line[data-turn] 마커가 활성 턴 전환의 SSoT.
    //   레거시 [data-toggle-turn](접힘/펼침 카드)도 호환을 위해 함께 처리한다.
    //   활성 턴 전환 후 applyDetailFilter()를 호출해 필터 chip 카운트를 새 활성 턴 기준으로 재계산
    //   (turn-view-tab fix: "활성 턴 좁힘" 정책 — flat-view.js applyDetailFilter 참조).
    const turnMarker = e.target.closest('.turn-line[data-turn]');
    if (turnMarker) { toggleTurn(turnMarker.dataset.turn); applyDetailFilter(); return; }
    const turnBtn  = e.target.closest('[data-toggle-turn]');
    if (turnBtn) { toggleTurn(turnBtn.dataset.toggleTurn); applyDetailFilter(); return; }

    if (e.target.closest('.turn-card-expanded')) {
      const groupRow = e.target.closest('[data-toggle-group]');
      if (groupRow) {
        groupRow.classList.toggle('open');
        return;
      }
      const promptEl = resolveExpandTarget(e.target);
      if (promptEl) {
        const container = promptEl.closest('tr') || promptEl.closest('.turn-row');
        if (container) togglePromptExpand(promptEl.dataset.expandId, container);
      }
      return;
    }

    const cardBtn = e.target.closest('[data-toggle-card]');
    if (cardBtn) { toggleCardExpand(cardBtn.dataset.toggleCard); return; }

    const promptEl = resolveExpandTarget(e.target);
    if (promptEl) {
      const container = promptEl.closest('tr') || promptEl.closest('.turn-row');
      if (container) togglePromptExpand(promptEl.dataset.expandId, container);
    }
  });

  // 평면 행 더블클릭 → LLM Input 탭 라우팅 (system-prompt-exposure 후속)
  // 단클릭은 prompt-preview expand로 보존, 더블클릭만 라우팅 — 충돌 회피.
  // tr.dataset.requestId는 makeRequestRow가 부여 (data-request-id).
  document.getElementById('detailView').addEventListener('dblclick', e => {
    const tr = e.target.closest('tr[data-request-id]');
    if (!tr || !tr.dataset.requestId) return;
    setDetailTab('llm');
    setDetailView('llm');
    renderLlmInput(tr.dataset.requestId);
  });

  document.getElementById('detailView').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cardBtn = e.target.closest('[data-toggle-card]');
    if (cardBtn) {
      e.preventDefault();
      toggleCardExpand(cardBtn.dataset.toggleCard);
    }
  });
}

async function init() {
  // 레이아웃 시프트 방지 — 인라인 스크립트(index.html)가 부여한 preinit-* 클래스를 정상 클래스로 즉시 인계.
  // 세 호출 모두 i18n에 의존하지 않으므로 fetch 대기 전에 처리해 .app-ready를 빠르게 부여.
  // app-ready 직후 :not(.app-ready) 룰이 비활성화되며 preinit 효과는 동등 효과의 정상 클래스(.left-panel-hidden / .chart-collapsed)가 이미 부여돼 있어 시각 변화 0.
  migrateLocalStorage();
  restorePanelHiddenState();
  restoreChartCollapsedState();
  document.documentElement.classList.add('app-ready');

  // i18n 리소스 fetch 완료 보장 — main 모듈 내 모든 t() 호출이 키가 아닌 번역값을 받도록.
  // I18n.init()은 idempotent하며 동일 lang+ns에 대해 메모리 캐시 재사용.
  try { await window.I18n.init(); } catch { /* i18n 실패해도 UI는 계속 — 키가 노출되지만 동작 차단 안 함 */ }

  // date-range-filter ADR-004 — localStorage hydrator를 SSE/fetch보다 먼저 실행.
  // preset만 복원(custom 휘발). custom 잔존 시 console.warn으로 안내.
  initDateRangeStorage((msg) => { if (msg) console.warn('[date-range]', msg); });

  // ADR-003 left-rail-meta-docs: 앱 모드 rail 초기화 + sessionStorage 복원 적용.
  // applyAppMode를 콜백으로 주입 — rail 모듈은 모드 값만 전달, view 조작은 main 책임.
  applyAppMode(getAppMode());
  initAppRail((mode) => {
    // rail 클릭으로 metadocs 진입 시 직전 browse 상태 snapshot — ESC 복귀용
    if (mode === 'metadocs' && getAppMode() === 'browse') snapshotBrowseState();
    if (mode === 'browse' && getAppMode() === 'metadocs') {
      // rail에서 직접 browse로 — prevState가 있으면 그대로 복원, 없으면 단순 전환
      restorePrevState();
      return;
    }
    applyAppMode(mode);
  });

  initTypeColors();
  initBuckets();
  drawTimeline();
  setChartMode('default');
  fetchRequests();
  fetchCacheStats();
  // _allProjects(fetchDashboard)와 _allSessions(fetchAllSessions) 둘 다 채워진 뒤
  // autoActivateProject를 호출해야 빈 DB → 데이터 도착 시 race로 자동 선택이 누락되지 않음.
  Promise.all([fetchDashboard(), fetchAllSessions()]).then(() => autoActivateProject());
  startSSE();
  // restorePanelHiddenState() / restoreChartCollapsedState() 호출은 i18n 대기 전(init 최상단)으로 이동.
  // 인라인 스크립트(index.html)가 preinit-* 클래스로 첫 paint를 보호하고, 본 init 진입 즉시 정상 클래스로 인계해야 시프트가 없다.
  initVersionCheck();
  document.getElementById('btnPanelCollapse').addEventListener('click', toggleLeftPanel);
  document.getElementById('btnToggleChart').addEventListener('click', toggleChartCollapse);

  // panel-collapse-redesign 5라운드 회의: 키보드 단축키 ⌘B / Ctrl+B.
  // input/textarea/contenteditable 포커스 시는 무시 — 텍스트 편집과 충돌 방지.
  document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return;
    const ae = document.activeElement;
    const tag = ae?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || ae?.isContentEditable) return;
    e.preventDefault();
    toggleLeftPanel();
  });
  initEventDelegation();
  // chart-section-filter-sync ADR-001 — 초기 활성 범위에 맞춰 timeline-meta 라벨 동기화.
  // 인자 생략 시 default-view 내부에서 getActiveRange()로 SSoT 일치.
  applyRangeLabels();
  initDefaultView({
    onSelectSession: loadSession,
    onCloseDetail: closeDetail,
    onGoHome: () => {
      if (getRightView() === 'detail') closeDetail();
      setSelectedSession(null);
      setSelectedProject(null);
      localStorage.removeItem(STORAGE_KEY);
      renderBrowserSessions();
      renderBrowserProjects();
      document.querySelector('.right-panel')?.scrollTo({ top: 0, behavior: 'smooth' });
      autoActivateProject();
    },
  });
  initColResize(document.querySelector('#feedBody table'));
  // #turnLogTable 은 renderTurnCards 가 동적으로 매번 새로 생성한다(필터 변경/SSE 갱신마다).
  //   따라서 init() 시점이 아니라 turn-views.js 안에서 매 렌더 직후 initColResize 를 호출한다
  //   (syslib / meta-docs 와 동일 패턴).
  initPanelResize(document.querySelector('.left-panel'), document.querySelector('.panel-resize-handle'));
  initPanelVerticalResize(
    document.getElementById('panelVerticalHandle'),
    document.getElementById('browserProjectsSection'),
    // 메타 모드에서는 동일 핸들이 [프로젝트 ↔ 요약 카드] 분할을 담당.
    // 드래그 시점에 visible한 bottom 섹션을 동적으로 resolve.
    () => (document.body.dataset.appMode === 'metadocs'
      ? document.getElementById('metaDocsSummaryCards')
      : document.getElementById('browserSessionsSection')),
  );
  initPanelBottomResize(
    document.getElementById('panelVerticalHandleBottom'),
    document.getElementById('browserSessionsSection'),
    document.getElementById('panelTools'),
  );
  initCacheTooltip();
  initStatTooltip();
  initCachePanelTooltip();
  initObsTooltip();
  initContextChart();
  initToolColors();
  initSystemReminderPopover();
  initDetailSearch();
  initDetailTabBar();   // ADR-turn-view-revamp-004: view-tab 3종 (로그/LLM/SysLib) 동적 생성
  setDetailView('log');  // 초기 aria-selected 동기화 — initDetailTabBar 직후 강제 싱크.
                         // renderTab이 HTML 문자열로 aria-selected="true"를 생성하지만,
                         // 명시적 호출로 .active 클래스와 aria-selected 양쪽 SSoT를 보장.
  initMetaSubTabs();    // Wave 5: meta-tab 2종 동적 생성
  initDateFilter();     // Wave 5: date-filter 3종 동적 생성
  initMetaDocsLeftNav();
  setInterval(() => { advanceBuckets(); drawTimeline(); }, 60000);
  setInterval(() => fetchAllSessions(), 30000);
}

// 키보드 단축키 모달 — index.html 다이어트로 JS 주입
function renderKbdHelpModal() {
  const t = k => window.I18n.t(k);
  const existing = document.getElementById('kbdHelpBackdrop');
  const html = `
  <div class="kbd-help-backdrop" id="kbdHelpBackdrop" role="dialog" aria-modal="true" aria-labelledby="kbdHelpTitle">
    <div class="kbd-help-modal" role="document">
      <div class="kbd-help-header">
        <span class="kbd-help-title" id="kbdHelpTitle">${t('ui.main.kbd-help.title')}</span>
        <button class="kbd-help-close ds-close-btn" id="kbdHelpClose" aria-label="${t('ui.main.kbd-help.close')}" data-size="lg">×</button>
      </div>
      <div class="kbd-help-body">
        <div class="kbd-help-section">
          <div class="kbd-help-section-title">${t('ui.main.kbd-help.section.nav')}</div>
          <div class="kbd-help-row"><span class="kbd-key">/</span><span class="kbd-help-desc">${t('ui.main.kbd-help.focus-search')}</span></div>
          <div class="kbd-help-row"><span class="kbd-key">Esc</span><span class="kbd-help-desc">${t('ui.main.kbd-help.close-modal')}</span></div>
          <div class="kbd-help-row"><span class="kbd-key">⌘F</span><span class="kbd-help-desc">${t('ui.main.kbd-help.focus-search-cmd')}</span></div>
        </div>
        <div class="kbd-help-section">
          <div class="kbd-help-section-title">${t('ui.main.kbd-help.section.filter')}</div>
          <div class="kbd-help-row"><span class="kbd-key">1</span><span class="kbd-help-desc">All</span></div>
          <div class="kbd-help-row"><span class="kbd-key">2</span><span class="kbd-help-desc">prompt</span></div>
          <div class="kbd-help-row"><span class="kbd-key">3</span><span class="kbd-help-desc">system</span></div>
          <div class="kbd-help-row"><span class="kbd-key">4</span><span class="kbd-help-desc">tool_call</span></div>
          <div class="kbd-help-row"><span class="kbd-key">5</span><span class="kbd-help-desc">Agent</span></div>
          <div class="kbd-help-row"><span class="kbd-key">6</span><span class="kbd-help-desc">Skill</span></div>
          <div class="kbd-help-row"><span class="kbd-key">7</span><span class="kbd-help-desc">MCP</span></div>
        </div>
        <div class="kbd-help-section">
          <div class="kbd-help-section-title">${t('ui.main.kbd-help.section.help')}</div>
          <div class="kbd-help-row"><span class="kbd-key">?</span><span class="kbd-help-desc">${t('ui.main.kbd-help.help-toggle')}</span></div>
        </div>
      </div>
    </div>
  </div>
`;
  if (existing) {
    existing.outerHTML = html;
  } else {
    document.body.insertAdjacentHTML('beforeend', html);
  }
}
// renderKbdHelpModal은 i18n 준비 후 init() 안에서 첫 호출. onChange는 언어 전환 시 재렌더.
window.I18n.onChange(renderKbdHelpModal);

document.addEventListener('DOMContentLoaded', () => {
  // 키보드 모달은 i18n 로딩 완료 후에 첫 렌더.
  window.I18n.init().then(renderKbdHelpModal).catch(() => renderKbdHelpModal());
  init();
});
