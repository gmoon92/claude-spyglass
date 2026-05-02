// 진입점 — 초기화, 이벤트 위임, SSE, selectProject
import { initTypeColors, recordRequest, drawTimeline, advanceBuckets, initBuckets } from './chart.js';
import { clearError, updateScrollLockBanner, jumpToLatest, resetScrollLockCount } from './infra.js';
import {
  getAllSessions, getAllProjects, renderBrowserProjects, renderBrowserSessions, showSkeletonSessions,
} from './left-panel.js';
import {
  getRightView, setRightView, setDetailTab,
  getSelectedProject, getSelectedSession, setSelectedProject, setSelectedSession,
  setDetailFilterBar,
} from './state.js';
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

const STORAGE_KEY = 'spyglass:lastProject';

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
  localStorage.setItem(STORAGE_KEY, name);
  setSelectedProject(name);
  setSelectedSession(null);
  if (getRightView() === 'detail') {
    setRightView('default');
    renderRightPanel();
  }
  renderBrowserProjects();
  document.getElementById('sessionPaneHint').textContent = `${name} · …`;
  showSkeletonSessions();
  fetchSessionsByProject(name);
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

let refreshDebounce = null;

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

      clearTimeout(refreshDebounce);
      refreshDebounce = setTimeout(() => fetchDashboard(), 1000);
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

      clearTimeout(refreshDebounce);
      refreshDebounce = setTimeout(() => fetchDashboard(), 1000);
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
      fetchDashboard();
      fetchRequests();
      fetchAllSessions();
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

  initTypeColors();
  initBuckets();
  drawTimeline();
  setChartMode('default');
  fetchDashboard();
  fetchRequests();
  fetchCacheStats();
  fetchAllSessions().then(() => autoActivateProject());
  startSSE();
  restorePanelHiddenState();
  restoreChartCollapsedState();
  document.getElementById('btnPanelCollapse').addEventListener('click', toggleLeftPanel);
  document.getElementById('btnToggleChart').addEventListener('click', toggleChartCollapse);
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
