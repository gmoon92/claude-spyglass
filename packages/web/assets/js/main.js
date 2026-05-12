// 진입점 — 초기화, 이벤트 위임, SSE, selectProject
import { initTypeColors, recordRequest, drawTimeline, advanceBuckets, initBuckets } from './chart.js';
import { clearError, updateScrollLockBanner, jumpToLatest, resetScrollLockCount } from './infra.js';
import {
  getAllSessions, getAllProjects, renderBrowserProjects, renderBrowserSessions, showSkeletonSessions,
} from './left-panel.js';
import {
  getRightView, setRightView, setDetailTab, getDetailTab,
  getSelectedProject, getSelectedSession, setSelectedProject, setSelectedSession,
  setDetailFilterBar,
  getAppMode, setAppMode,
  getPrevState, setPrevState, clearPrevState,
} from './state.js';
import { initAppRail, setRailActive } from './app-rail.js';
import { loadMetaDocsLibrary, enterMetaDocsMode, openMetaDocViaDeepLink } from './meta-docs-view.js';
import {
  setDetailFilter, applyDetailFilter, setDetailView, toggleTurn,
  refreshDetailSession, initDetailSearch,
  toggleCardExpand,
} from './session-detail.js';
import {
  fetchDashboard, fetchRequests, fetchAllSessions, fetchSessionsByProject,
  fetchCacheStats, setActiveRange, setIsSSEConnected,
} from './api.js';
import { fmtToken } from './formatters.js';
import { togglePromptExpand } from './renderers.js';
import { renderLlmInput } from './llm-input-view.js';
import { initColResize } from './col-resize.js';
import { initPanelResize } from './panel-resize.js';
import { initPanelVerticalResize, initPanelBottomResize } from './left-panel-vertical-resize.js';
import { initContextChart } from './context-chart.js';
import { createFilterBar } from './components/filter-bar.js';
import { initToolColors } from './tool-colors.js';
import { initToolStats } from './tool-stats.js';
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
  setAppMode(mode);
  document.body.dataset.appMode = mode;
  setRailActive(mode);
  // 메타 모드 진입 시 카탈로그 lazy 로드 — 가시성은 body[data-app-mode] CSS 룰이 처리.
  // browse 복귀 시는 별도 cleanup 불필요(컨테이너만 hidden, 데이터/상태 유지).
  if (mode === 'metadocs') {
    enterMetaDocsMode();
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

// ── 메타 문서 Top N 헬퍼 ─────────────────────────────────────────────────────

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
 * 프로젝트 선택 시 메타 문서 호출 수 Top 5 fetch → renderToolCategoriesCard에 전달.
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
  // 프로젝트 전환(또는 해제) 시 Tool Categories 카드 모드를 초기화.
  // renderMetaDocsTopForProject가 성공하면 'meta-docs'로 재진입하고,
  // 새 프로젝트에 메타 문서 호출이 없으면 다음 fetchObservability 배열 payload가 정상 렌더링된다.
  resetToolCategoriesMode();

  localStorage.setItem(STORAGE_KEY, name);
  setSelectedProject(name);

  // ADR-003 left-rail-meta-docs: 메타 문서 모드(appMode === 'metadocs')에서 좌측 프로젝트만 바꾼 경우는
  // 메타 카탈로그만 새 프로젝트 기준으로 다시 그린다. browse 모드면 기존처럼 detail을 닫고 default로 복귀.
  const isMetaDocsActive = getAppMode() === 'metadocs';

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
    // 좌측 프로젝트 라벨이 갱신된 직후 카탈로그 재조회 — 새 source_root로 자동 매핑
    loadMetaDocsLibrary();
  }

  // dashboard-ui-enhancements: 프로젝트 선택 시 하단 Tool Categories 카드를
  // 해당 프로젝트 메타 문서 호출 Top 5로 교체 (비동기, 실패 시 silent)
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
        if (getSelectedSession() === req.session_id) refreshDetailSession(req.session_id);
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

function initEventDelegation() {
  document.querySelector('.left-panel').addEventListener('click', e => {
    const projRow = e.target.closest('[data-project]');
    if (projRow) { selectProject(projRow.dataset.project); return; }
    const sessRow = e.target.closest('[data-session-id]');
    if (sessRow)  { loadSession(sessRow.dataset.sessionId); }
  });

  // ADR-003 left-rail-meta-docs: Agent/Skill 배지 단일 클릭 → 메타 문서 딥링크.
  // 글로벌 위임 — 턴 카드/세션 plain row 등 모든 chip에서 동작.
  document.body.addEventListener('click', e => {
    const chip = e.target.closest('[data-meta-doc-type][data-meta-doc-id]');
    if (!chip) return;
    e.preventDefault();
    e.stopPropagation();
    const type = chip.dataset.metaDocType;
    const id   = chip.dataset.metaDocId;
    if (!type || !id) return;
    // 현재 browse 상태이면 스냅샷 후 metadocs 진입
    if (getAppMode() === 'browse') {
      snapshotBrowseState();
      applyAppMode('metadocs');
    }
    // metadocs 이미 진입 상태든 신규 진입이든 동일하게 딥링크 호출 (검색어 적용 + flash)
    openMetaDocViaDeepLink({ type, id });
  });

  // Keyboard activation for chips with role="button" — Space/Enter
  document.body.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const chip = e.target.closest('[data-meta-doc-type][data-meta-doc-id][role="button"]');
    if (!chip) return;
    e.preventDefault();
    chip.click();
  });

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

  document.getElementById('dateFilter').addEventListener('click', e => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setActiveRange(btn.dataset.range);
    // chart-section-filter-sync ADR-001 — timeline-meta 라벨은 SSoT 함수로 갱신.
    // chartSubtitle은 ADR-002에 따라 timelineChart 본질 고정 — 여기서 갱신하지 않는다.
    applyRangeLabels(btn.dataset.range);
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
    ?.setAttribute('title', 'System 라이브러리 탭으로 이동');

  document.getElementById('detailView').addEventListener('click', e => {
    const turnBtn  = e.target.closest('[data-toggle-turn]');
    if (turnBtn) { toggleTurn(turnBtn.dataset.toggleTurn); return; }

    if (e.target.closest('.turn-card-expanded')) {
      const groupRow = e.target.closest('[data-toggle-group]');
      if (groupRow) {
        groupRow.classList.toggle('open');
        return;
      }
      const promptEl = e.target.closest('[data-expand-id]');
      if (promptEl) {
        const container = promptEl.closest('tr') || promptEl.closest('.turn-row');
        if (container) togglePromptExpand(promptEl.dataset.expandId, container);
      }
      return;
    }

    const cardBtn = e.target.closest('[data-toggle-card]');
    if (cardBtn) { toggleCardExpand(cardBtn.dataset.toggleCard); return; }

    const promptEl = e.target.closest('[data-expand-id]');
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

function init() {
  migrateLocalStorage();

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
  restorePanelHiddenState();
  restoreChartCollapsedState();
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
  initColResize(document.querySelector('#detailRequestsView table'));
  initPanelResize(document.querySelector('.left-panel'), document.querySelector('.panel-resize-handle'));
  initPanelVerticalResize(
    document.getElementById('panelVerticalHandle'),
    document.getElementById('browserProjectsSection'),
    document.getElementById('browserSessionsSection'),
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
  initToolStats();
  initDetailSearch();
  setInterval(() => { advanceBuckets(); drawTimeline(); }, 60000);
  setInterval(() => fetchAllSessions(), 30000);
}

// 키보드 단축키 모달 — index.html 다이어트로 JS 주입
document.body.insertAdjacentHTML('beforeend', `
  <div class="kbd-help-backdrop" id="kbdHelpBackdrop" role="dialog" aria-modal="true" aria-labelledby="kbdHelpTitle">
    <div class="kbd-help-modal" role="document">
      <div class="kbd-help-header">
        <span class="kbd-help-title" id="kbdHelpTitle">키보드 단축키</span>
        <button class="kbd-help-close" id="kbdHelpClose" aria-label="닫기">×</button>
      </div>
      <div class="kbd-help-body">
        <div class="kbd-help-section">
          <div class="kbd-help-section-title">탐색</div>
          <div class="kbd-help-row"><span class="kbd-key">/</span><span class="kbd-help-desc">검색창에 포커스</span></div>
          <div class="kbd-help-row"><span class="kbd-key">Esc</span><span class="kbd-help-desc">모달 / 확장 패널 / 검색 / 상세 뷰 닫기</span></div>
          <div class="kbd-help-row"><span class="kbd-key">⌘F</span><span class="kbd-help-desc">검색창 포커스 (Ctrl+F)</span></div>
        </div>
        <div class="kbd-help-section">
          <div class="kbd-help-section-title">필터</div>
          <div class="kbd-help-row"><span class="kbd-key">1</span><span class="kbd-help-desc">All</span></div>
          <div class="kbd-help-row"><span class="kbd-key">2</span><span class="kbd-help-desc">prompt</span></div>
          <div class="kbd-help-row"><span class="kbd-key">3</span><span class="kbd-help-desc">system</span></div>
          <div class="kbd-help-row"><span class="kbd-key">4</span><span class="kbd-help-desc">tool_call</span></div>
          <div class="kbd-help-row"><span class="kbd-key">5</span><span class="kbd-help-desc">Agent</span></div>
          <div class="kbd-help-row"><span class="kbd-key">6</span><span class="kbd-help-desc">Skill</span></div>
          <div class="kbd-help-row"><span class="kbd-key">7</span><span class="kbd-help-desc">MCP</span></div>
        </div>
        <div class="kbd-help-section">
          <div class="kbd-help-section-title">도움말</div>
          <div class="kbd-help-row"><span class="kbd-key">?</span><span class="kbd-help-desc">이 도움말 토글</span></div>
        </div>
      </div>
    </div>
  </div>
`);

document.addEventListener('DOMContentLoaded', init);
