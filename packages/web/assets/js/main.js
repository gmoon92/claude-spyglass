// 진입점 — 초기화, 이벤트 위임, SSE, selectProject/Session
import { initTypeColors, recordRequest, drawTimeline, drawDonut, advanceBuckets, initBuckets } from './chart.js';
import { togglePromptExpand, makeRequestRow, makeTargetCell } from './renderers.js';
import { clearError, updateScrollLockBanner, jumpToLatest, addScrollLockCount, resetScrollLockCount } from './infra.js';
import {
  getSelectedProject, getSelectedSession,
  setSelectedProject, setSelectedSession,
  getAllSessions, getAllProjects, renderBrowserProjects, renderBrowserSessions, showSkeletonSessions,
} from './left-panel.js';
import {
  setDetailFilter, applyDetailFilter, setDetailView, toggleTurn,
  refreshDetailSession, loadSessionDetail,
} from './session-detail.js';
import {
  fetchDashboard, fetchRequests, fetchAllSessions, fetchSessionsByProject,
  setActiveRange, setReqFilter, setIsSSEConnected,
} from './api.js';
import { fmtToken, fmtDate, formatDuration } from './formatters.js';
import { initColResize } from './col-resize.js';
import { initPanelResize } from './panel-resize.js';
import { initCacheTooltip } from './cache-tooltip.js';
import { initStatTooltip } from './stat-tooltip.js';

// ── localStorage ─────────────────────────────────────────────────────────────
const STORAGE_KEY = 'spyglass:lastProject';

// ── UI 상태 ──────────────────────────────────────────────────────────────────
const uiState = { rightView: 'default', detailTab: 'flat', isTransitioning: false };

function renderRightPanel() {
  const isDetail = uiState.rightView === 'detail';
  document.getElementById('defaultView').classList.toggle('active', !isDetail);
  document.getElementById('detailView').classList.toggle('active', isDetail);
}

// ── 자동 프로젝트 활성화 ──────────────────────────────────────────────────────
function autoActivateProject() {
  if (getSelectedProject()) return;
  const projects = getAllProjects();
  if (!projects.length) return;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && projects.some(p => p.project_name === saved)) {
    selectProject(saved);
    return;
  }
  const sessions = getAllSessions();
  if (sessions.length) {
    const latest = sessions.reduce((a, b) => ((a.started_at || 0) > (b.started_at || 0) ? a : b));
    if (latest.project_name) { selectProject(latest.project_name); return; }
  }
  selectProject(projects[0].project_name);
}

// ── 프로젝트 선택 ────────────────────────────────────────────────────────────
function selectProject(name) {
  localStorage.setItem(STORAGE_KEY, name);
  setSelectedProject(name);
  setSelectedSession(null);
  if (uiState.rightView === 'detail') {
    uiState.rightView = 'default';
    renderRightPanel();
  }
  renderBrowserProjects();
  document.getElementById('sessionPaneHint').textContent = `${name} · …`;
  showSkeletonSessions();
  fetchSessionsByProject(name);
}

// ── 세션 선택 ────────────────────────────────────────────────────────────────
async function selectSession(id) {
  if (uiState.isTransitioning) return;
  setSelectedSession(id);
  renderBrowserSessions();

  uiState.rightView   = 'detail';
  uiState.detailTab   = 'flat';
  uiState.isTransitioning = true;
  renderRightPanel();

  document.getElementById('detailLoading').style.display  = 'block';
  document.getElementById('detailFlatView').style.display = 'none';
  document.getElementById('detailTurnView').style.display = 'none';

  document.getElementById('detailView').addEventListener(
    'transitionend',
    () => { uiState.isTransitioning = false; },
    { once: true }
  );

  const session    = getAllSessions().find(s => s.id === id);
  const detailIdEl = document.getElementById('detailSessionId');
  detailIdEl.textContent = id.slice(0, 8) + '…';
  detailIdEl.title       = id;
  document.getElementById('detailProject').textContent  = session ? session.project_name : '';
  document.getElementById('detailTokens').textContent   = session ? `총 ${fmtToken(session.total_tokens)} 토큰` : '';
  document.getElementById('detailEndedAt').textContent  = session?.ended_at
    ? `종료: ${fmtDate(session.ended_at)}`
    : '';

  setDetailFilter('all');
  document.querySelectorAll('#detailTypeFilterBtns .type-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.detailFilter === 'all');
  });

  try {
    await loadSessionDetail(id);
  } catch {
    applyDetailFilter();
  }

  document.getElementById('detailLoading').style.display = 'none';
  setDetailView(uiState.detailTab);
}

// ── 세션 상세 닫기 ───────────────────────────────────────────────────────────
function closeDetail() {
  uiState.rightView = 'default';
  setSelectedSession(null);
  renderRightPanel();
  renderBrowserSessions();
  const badgesEl = document.getElementById('detailBadges');
  if (badgesEl) badgesEl.style.display = 'none';
}

// ── prependRequest ───────────────────────────────────────────────────────────
function prependRequest(r) {
  const body      = document.getElementById('requestsBody');
  const feedBody  = document.getElementById('feedBody');
  const isNearTop = !feedBody || feedBody.scrollTop < 80;

  const prevScrollTop    = feedBody ? feedBody.scrollTop    : 0;
  const prevScrollHeight = feedBody ? feedBody.scrollHeight : 0;

  // 같은 request ID의 기존 행이 있으면 인플레이스 업데이트 (행 위치·순서 보존)
  if (r.id) {
    const existing = body.querySelector(`tr[data-request-id="${CSS.escape(r.id)}"]`);
    if (existing) {
      const targetCell = existing.querySelector('.cell-target');
      if (targetCell) targetCell.outerHTML = makeTargetCell(r);
      const tokenCells = existing.querySelectorAll('.cell-token.num');
      const durationCell = tokenCells[tokenCells.length - 1];
      if (durationCell) durationCell.textContent = formatDuration(r.duration_ms);
      return;
    }
  }
  while (body.rows.length >= 200) body.deleteRow(body.rows.length - 1);
  const tmp = document.createElement('tbody');
  tmp.innerHTML = makeRequestRow(r, { showSession: true });
  body.insertBefore(tmp.firstElementChild, body.firstChild);

  if (!isNearTop && feedBody) {
    const addedHeight = feedBody.scrollHeight - prevScrollHeight;
    feedBody.scrollTop = prevScrollTop + addedHeight;
    addScrollLockCount();
    updateScrollLockBanner();
  } else {
    resetScrollLockCount();
    updateScrollLockBanner();
  }
}

// ── 수동 갱신 ────────────────────────────────────────────────────────────────
function manualRefresh() {
  Promise.all([fetchDashboard(), fetchRequests(), fetchAllSessions()]);
}

// ── SSE ──────────────────────────────────────────────────────────────────────
let sseSource       = null;
let retryTimer      = null;
let refreshDebounce = null;

function connectSSE() {
  if (sseSource) { sseSource.close(); sseSource = null; }
  try {
    sseSource = new EventSource('/events');

    sseSource.addEventListener('new_request', (e) => {
      recordRequest();
      drawTimeline();
      try {
        const evt = JSON.parse(e.data);
        const req = evt.data;
        const sess = getAllSessions().find(s => s.id === req.session_id);
        if (sess) {
          sess.total_tokens = req.session_total_tokens;
          // 해당 세션 행의 토큰만 직접 갱신 — full re-render 방지
          const sessRow = document.querySelector(`[data-session-id="${CSS.escape(req.session_id)}"]`);
          const tokEl   = sessRow?.querySelector('.sess-row-tokens');
          if (tokEl) tokEl.textContent = fmtToken(req.session_total_tokens);
          else renderBrowserSessions();
        }
        prependRequest(req);
        if (getSelectedSession() === req.session_id) refreshDetailSession(req.session_id);
      } catch { /* silent */ }

      clearTimeout(refreshDebounce);
      refreshDebounce = setTimeout(() => fetchDashboard(), 1000);
    });

    sseSource.onopen = () => {
      clearError();
      clearTimeout(retryTimer);
      setIsSSEConnected(true);
      const loadMoreBtn = document.getElementById('loadMoreBtn');
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      fetchDashboard();
      fetchRequests();
      fetchAllSessions();
    };

    sseSource.onerror = () => {
      setIsSSEConnected(false);
      sseSource.close(); sseSource = null;
      resetScrollLockCount();
      updateScrollLockBanner();
      retryTimer = setTimeout(connectSSE, 5000);
    };
  } catch {
    retryTimer = setTimeout(connectSSE, 5000);
  }
}

// ── 이벤트 위임 ──────────────────────────────────────────────────────────────
function initEventDelegation() {
  document.querySelector('.left-panel').addEventListener('click', e => {
    const projRow = e.target.closest('[data-project]');
    if (projRow) { selectProject(projRow.dataset.project); return; }
    const sessRow = e.target.closest('[data-session-id]');
    if (sessRow)  { selectSession(sessRow.dataset.sessionId); }
  });

  document.getElementById('btnCloseDetail').addEventListener('click', closeDetail);

  document.getElementById('detailTabBar').addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { uiState.detailTab = tab.dataset.tab; setDetailView(tab.dataset.tab); }
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
    fetchDashboard(); fetchRequests(); fetchAllSessions();
  });

  document.getElementById('typeFilterBtns').addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    setReqFilter(btn.dataset.filter);
    document.querySelectorAll('#typeFilterBtns .type-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    fetchRequests(false);
  });

  document.getElementById('loadMoreBtn').addEventListener('click', () => fetchRequests(true));

  const feedSearchInput = document.getElementById('feedSearchInput');
  const feedSearchClear = document.getElementById('feedSearchClear');
  function applyFeedSearch() {
    const q = feedSearchInput.value.trim().toLowerCase();
    feedSearchClear.classList.toggle('visible', q.length > 0);
    const rows = document.querySelectorAll('#requestsBody tr[data-type]');
    rows.forEach(tr => {
      if (!q) { tr.style.display = ''; return; }
      const text = [
        tr.querySelector('.model-name')?.textContent,
        tr.querySelector('.action-name')?.textContent,
        tr.querySelector('.prompt-preview')?.textContent,
        tr.querySelector('.target-role-badge')?.textContent,
      ].filter(Boolean).join(' ').toLowerCase();
      tr.style.display = text.includes(q) ? '' : 'none';
    });
  }
  feedSearchInput.addEventListener('input', applyFeedSearch);
  feedSearchClear.addEventListener('click', () => { feedSearchInput.value = ''; applyFeedSearch(); feedSearchInput.focus(); });
  document.addEventListener('feed:updated', applyFeedSearch);

  document.getElementById('detailTypeFilterBtns').addEventListener('click', e => {
    const btn = e.target.closest('[data-detail-filter]');
    if (!btn) return;
    setDetailFilter(btn.dataset.detailFilter);
    document.querySelectorAll('#detailTypeFilterBtns .type-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyDetailFilter();
  });

  document.getElementById('detailView').addEventListener('click', e => {
    const turnBtn  = e.target.closest('[data-toggle-turn]');
    if (turnBtn) { toggleTurn(turnBtn.dataset.toggleTurn); return; }
    const promptEl = e.target.closest('[data-expand-id]');
    if (promptEl) {
      const container = promptEl.closest('tr') || promptEl.closest('.turn-row');
      if (container) togglePromptExpand(promptEl.dataset.expandId, container);
    }
  });

  document.getElementById('defaultView').addEventListener('click', e => {
    const promptEl = e.target.closest('[data-expand-id]');
    if (promptEl) {
      const tr = promptEl.closest('tr');
      if (tr) togglePromptExpand(promptEl.dataset.expandId, tr);
    }
  });
}

// ── Canvas ResizeObserver ─────────────────────────────────────────────────────
function initCharts() {
  let _rafId = null;
  const timelineWrap = document.querySelector('#timelineChart').parentElement;
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      cancelAnimationFrame(_rafId);
      _rafId = requestAnimationFrame(() => drawTimeline());
    }).observe(timelineWrap);
  } else {
    window.addEventListener('resize', drawTimeline);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  initTypeColors();
  initBuckets();
  drawTimeline();
  drawDonut();
  fetchDashboard();
  fetchRequests();
  fetchAllSessions().then(() => autoActivateProject());
  connectSSE();
  initEventDelegation();
  initCharts();
  initColResize(document.querySelector('#feedBody table'));
  initColResize(document.querySelector('#detailFlatView table'));
  initPanelResize(document.querySelector('.left-panel'), document.querySelector('.panel-resize-handle'));
  initCacheTooltip();
  initStatTooltip();
  setInterval(() => { advanceBuckets(); drawTimeline(); }, 60000);
  setInterval(() => fetchAllSessions(), 30000);
}

document.addEventListener('DOMContentLoaded', init);
