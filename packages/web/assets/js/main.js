// 진입점 — 초기화, 이벤트 위임, SSE, selectProject/Session
import { initTypeColors, recordRequest, drawTimeline, advanceBuckets, initBuckets } from './chart.js';
import { clearError, updateScrollLockBanner, jumpToLatest, resetScrollLockCount } from './infra.js';
import {
  getAllSessions, getAllProjects, renderBrowserProjects, renderBrowserSessions, showSkeletonSessions,
} from './left-panel.js';
import {
  getRightView, setRightView, getDetailTab, setDetailTab,
  getSelectedProject, getSelectedSession, setSelectedProject, setSelectedSession,
  setDetailFilterBar, getDetailFilterBar,
} from './state.js';
import {
  setDetailFilter, applyDetailFilter, setDetailView, toggleTurn,
  refreshDetailSession, loadSessionDetail, initDetailSearch, initGanttNavigation,
  toggleCardExpand,
} from './session-detail.js';
import {
  fetchDashboard, fetchRequests, fetchAllSessions, fetchSessionsByProject,
  fetchCacheStats, setActiveRange, setIsSSEConnected,
} from './api.js';
import { fmtToken, fmtDate } from './formatters.js';
import { togglePromptExpand } from './renderers.js';
import { initColResize } from './col-resize.js';
import { initPanelResize } from './panel-resize.js';
import { initContextChart } from './context-chart.js';
import { createFilterBar } from './components/filter-bar.js';
import { initGantt } from './turn-gantt.js';
import { initToolStats } from './tool-stats.js';
import { initCacheTooltip } from './cache-tooltip.js';
import { initStatTooltip } from './stat-tooltip.js';
import { initCachePanelTooltip } from './cache-panel-tooltip.js';
import { connectSSE } from './sse.js';
import {
  setChartMode, prependRequest,
  initDefaultView, toggleChartCollapse, restoreChartCollapsedState,
  migrateLocalStorage, restorePanelHiddenState, toggleLeftPanel,
} from './views/default-view.js';

const STORAGE_KEY = 'spyglass:lastProject';
let sessionAbortController = null;

function renderRightPanel() {
  const isDetail = getRightView() === 'detail';
  document.getElementById('defaultView').classList.toggle('active', !isDetail);
  document.getElementById('detailView').classList.toggle('active', isDetail);
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

async function selectSession(id) {
  if (id === getSelectedSession()) return;
  sessionAbortController?.abort();
  const controller = new AbortController();
  sessionAbortController = controller;
  const { signal } = controller;
  setSelectedSession(id);
  renderBrowserSessions();
  setRightView('detail');
  setDetailTab('flat');
  document.getElementById('detailView').classList.remove('detail-collapsed');
  setChartMode('detail');
  renderRightPanel();
  document.getElementById('detailLoading').style.display = 'block';
  document.getElementById('detailFlatView').style.display = 'none';
  document.getElementById('detailTurnView').style.display = 'none';
  const session = getAllSessions().find(s => s.id === id);
  const detailIdEl = document.getElementById('detailSessionId');
  detailIdEl.textContent = id.slice(0, 8) + '…';
  detailIdEl.title = id;
  document.getElementById('detailProject').textContent = session ? session.project_name : '';
  document.getElementById('detailTokens').textContent = session ? `총 ${fmtToken(session.total_tokens)} 토큰` : '';
  document.getElementById('detailEndedAt').textContent = session?.ended_at ? `종료: ${fmtDate(session.ended_at)}` : '';
  setDetailFilter('all');
  getDetailFilterBar()?.setActive('all');
  try {
    await loadSessionDetail(id, { signal });
  } catch (e) {
    if (e.name === 'AbortError') return;
    applyDetailFilter();
  } finally {
    if (!signal.aborted) {
      document.getElementById('detailLoading').style.display = 'none';
      setDetailView(getDetailTab());
    }
    if (sessionAbortController === controller) sessionAbortController = null;
  }
}

function closeDetail() {
  sessionAbortController?.abort();
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
    if (sessRow)  { selectSession(sessRow.dataset.sessionId); }
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
    const subtitles = { all: '전체 기간', today: '오늘', week: '이번 주' };
    const chartSubtitle = document.getElementById('chartSubtitle');
    if (chartSubtitle && subtitles[btn.dataset.range]) {
      chartSubtitle.textContent = subtitles[btn.dataset.range];
    }
    fetchDashboard(); fetchRequests(); fetchCacheStats(); fetchAllSessions();
  });

  const detailFilterBar = createFilterBar('detailTypeFilterBtns', {
    dataAttr: 'detail-filter',
    onChange(filter) {
      setDetailFilter(filter);
      applyDetailFilter();
    },
  });
  setDetailFilterBar(detailFilterBar);

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
  initDefaultView({
    onSelectSession: selectSession,
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
  initColResize(document.querySelector('#detailFlatView table'));
  initPanelResize(document.querySelector('.left-panel'), document.querySelector('.panel-resize-handle'));
  initCacheTooltip();
  initStatTooltip();
  initCachePanelTooltip();
  initContextChart();
  initGantt();
  initToolStats();
  initDetailSearch();
  initGanttNavigation();
  setInterval(() => { advanceBuckets(); drawTimeline(); }, 60000);
  setInterval(() => fetchAllSessions(), 30000);
}

document.addEventListener('DOMContentLoaded', init);
