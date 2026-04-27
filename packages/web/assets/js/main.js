// 진입점 — 초기화, 이벤트 위임, SSE, selectProject/Session
import { initTypeColors, recordRequest, drawTimeline, drawDonut, advanceBuckets, initBuckets, setSourceData, setDonutMode, hasSourceData, renderTypeLegend } from './chart.js';
import { fetchModelUsage } from './metrics-api.js';
import { togglePromptExpand, makeRequestRow, makeTargetCell } from './renderers.js';
import { clearError, updateScrollLockBanner, jumpToLatest, addScrollLockCount, resetScrollLockCount } from './infra.js';
import {
  getSelectedProject, getSelectedSession,
  setSelectedProject, setSelectedSession,
  getAllSessions, getAllProjects, renderBrowserProjects, renderBrowserSessions, showSkeletonSessions,
} from './left-panel.js';
import {
  setDetailFilter, applyDetailFilter, setDetailView, toggleTurn,
  refreshDetailSession, loadSessionDetail, initDetailSearch, initGanttNavigation,
  toggleCardExpand,
} from './session-detail.js';
import {
  fetchDashboard, fetchRequests, fetchAllSessions, fetchSessionsByProject,
  fetchCacheStats, setActiveRange, setReqFilter, getReqFilter, setIsSSEConnected,
} from './api.js';
import { fmtToken, fmtDate, formatDuration } from './formatters.js';
import { initColResize } from './col-resize.js';
import { initPanelResize } from './panel-resize.js';
import { initContextChart } from './context-chart.js';
import { initGantt } from './turn-gantt.js';
import { initToolStats } from './tool-stats.js';
import { initCacheTooltip } from './cache-tooltip.js';
import { initStatTooltip } from './stat-tooltip.js';
import { initCachePanelTooltip } from './cache-panel-tooltip.js';

// ── localStorage ─────────────────────────────────────────────────────────────
const STORAGE_KEY = 'spyglass:lastProject';

// ── UI 상태 ──────────────────────────────────────────────────────────────────
const uiState = { rightView: 'default', detailTab: 'flat' };

// 세션 선택 작업 취소용 AbortController
let sessionAbortController = null;

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
  // 동일 세션 클릭 무시
  if (id === getSelectedSession()) return;

  // 이전 요청 즉시 취소, 로컬 변수로 스코프 격리
  sessionAbortController?.abort();
  const controller = new AbortController();
  sessionAbortController = controller;
  const { signal } = controller;

  setSelectedSession(id);
  renderBrowserSessions();

  uiState.rightView = 'detail';
  uiState.detailTab = 'flat';
  document.getElementById('detailView').classList.remove('detail-collapsed');
  setChartMode('detail');                  // ADR-017: 차트가 세션 모드로 전환
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
  document.getElementById('detailEndedAt').textContent = session?.ended_at
    ? `종료: ${fmtDate(session.ended_at)}`
    : '';

  setDetailFilter('all');
  document.querySelectorAll('#detailTypeFilterBtns .type-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.detailFilter === 'all');
  });

  try {
    // 데이터 로드 즉시 시작 (transitionend 기다리지 않음)
    await loadSessionDetail(id, { signal });
  } catch (e) {
    // AbortError는 사용자가 새 선택을 한 경우이므로 조용히 종료
    if (e.name === 'AbortError') return;
    applyDetailFilter();
  } finally {
    // 취소된 경우가 아닐 때만 UI 정리
    if (!signal.aborted) {
      document.getElementById('detailLoading').style.display = 'none';
      setDetailView(uiState.detailTab);
    }
    // 이 호출의 컨트롤러가 여전히 현재 컨트롤러인 경우에만 null 처리
    if (sessionAbortController === controller) {
      sessionAbortController = null;
    }
  }
}

// ── ADR-017 + ADR-008: chartSection 모드 전환 (default ↔ detail) ──────────────────────
// ADR-008: donut-mode-toggle 폐기로 setChartMode가 도넛 모드를 자동 결정.
//   default → setDonutMode('model') + (캐시 미스 시) fetchModelUsage → setSourceData('model', data)
//   detail  → setDonutMode('type')  (session-detail.js의 setTypeData(sessionTypeData) 호환)
async function setChartMode(mode) {
  const chartSection = document.getElementById('chartSection');
  const rightPanel  = document.querySelector('.right-panel');
  if (!chartSection) return;
  if (mode === 'detail') {
    chartSection.classList.add('chart-mode-detail');
    chartSection.querySelector('.chart-detail-meta')?.removeAttribute('hidden');
    chartSection.querySelectorAll('.chart-detail-only').forEach(el => el.removeAttribute('hidden'));
    rightPanel?.classList.add('is-detail-mode');
    // detail: 세션 단위 type 분포 도넛 (session-detail.js가 setTypeData로 데이터 공급)
    setDonutMode('type');
  } else {
    chartSection.classList.remove('chart-mode-detail');
    chartSection.querySelector('.chart-detail-meta')?.setAttribute('hidden', '');
    chartSection.querySelectorAll('.chart-detail-only').forEach(el => el.setAttribute('hidden', ''));
    rightPanel?.classList.remove('is-detail-mode');
    // default: 전역 model 사용량 도넛 — 캐시 미스 시 fetch
    setDonutMode('model');
    if (!hasSourceData('model')) {
      try {
        const data = await fetchModelUsage({ range: '24h' });
        setSourceData('model', data || []);
      } catch (e) {
        // network failure는 silent — 기존 typeData 유지
      }
    }
    drawDonut();
    renderTypeLegend();
  }
}

// ── 세션 상세 닫기 (ADR-010 A-1) ─────────────────────────────────────────────
function closeDetail() {
  sessionAbortController?.abort();
  setSelectedSession(null);
  uiState.rightView = 'default';
  setChartMode('default');                              // ADR-017: 차트 default 모드 복귀
  renderRightPanel();
  renderBrowserSessions();
  // detail 닫힘 후 전역 데이터 재적용 (donut/cache 즉시 복귀)
  fetchDashboard();
  fetchCacheStats();
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
      // ADR-011: 인플레이스 업데이트 후 anomaly 재적용
      reapplyFeedAnomalies();
      document.dispatchEvent(new CustomEvent('feed:updated'));
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
  // ADR-011: 새 행에 anomaly 즉시 반영
  reapplyFeedAnomalies();
  // 스크롤 조정 완료 후 검색·유형 필터 재적용
  document.dispatchEvent(new CustomEvent('feed:updated'));
}

// ── ADR-011: 피드 anomaly 재계산 + 모든 행에 배지 적용 (in-DOM 데이터로) ──────
function reapplyFeedAnomalies() {
  const body = document.getElementById('requestsBody');
  if (!body) return;
  // DOM에서 현재 행들의 핵심 데이터 재구성 (request 객체 형태)
  // 단순화: data-request-id, data-type만으로 anomaly 재계산은 어려움
  // → 대신 클래스 기반 마커: spike/loop는 SSE prepend 시점에 알 수 없으므로
  //    fetchRequests 갱신을 1초 debounce로 트리거 (이미 SSE 흐름에 존재)
  // 여기서는 별도 작업 없음. 실제 anomaly는 다음 fetchRequests 응답 시 적용된다.
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
        } else {
          // 세션 목록에 없는 새 세션 — 세션 목록 재조회 후 재렌더링 (/clear 직후 등)
          fetchAllSessions();
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

  // ADR-008: btn-close 제거. closeDetail은 Esc 키 / 로고 클릭으로만 트리거.

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
    fetchDashboard(); fetchRequests(); fetchCacheStats(); fetchAllSessions();
  });

  // Agent/Skill/MCP는 서버 type 컬럼이 아닌 tool_name 기반 클라이언트 필터 전용 (ADR-004)
  const SUB_TYPES = ['agent', 'skill', 'mcp'];

  document.getElementById('typeFilterBtns').addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    setReqFilter(btn.dataset.filter);
    document.querySelectorAll('#typeFilterBtns .type-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (SUB_TYPES.includes(btn.dataset.filter)) {
      // 서버에 agent/skill/mcp 타입이 없으므로 재조회 스킵 — 현재 DOM에서 data-sub-type 필터만 재적용
      applyFeedSearch();
    } else {
      fetchRequests(false);
    }
  });

  document.getElementById('loadMoreBtn').addEventListener('click', () => fetchRequests(true));

  const feedSearchInput = document.getElementById('feedSearchInput');
  const feedSearchClear = document.getElementById('feedSearchClear');
  function applyFeedSearch() {
    const q = feedSearchInput.value.trim().toLowerCase();
    feedSearchClear.classList.toggle('visible', q.length > 0);
    const rows = document.querySelectorAll('#requestsBody tr[data-type]');
    const typeFilter = getReqFilter();
    rows.forEach(tr => {
      const typeFiltered = typeFilter !== 'all' && (
        SUB_TYPES.includes(typeFilter)
          ? tr.dataset.subType !== typeFilter
          : tr.dataset.type !== typeFilter
      );
      if (!q) { tr.style.display = typeFiltered ? 'none' : ''; return; }
      const text = [
        tr.querySelector('.model-name')?.textContent,
        tr.querySelector('.action-name')?.textContent,
        tr.querySelector('.prompt-preview')?.textContent,
        tr.querySelector('.target-role-badge')?.textContent,
      ].filter(Boolean).join(' ').toLowerCase();
      tr.style.display = (!text.includes(q) || typeFiltered) ? 'none' : '';
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

    // 카드 expanded 내부 클릭 — 버블링 차단 (카드 토글과 충돌 방지)
    if (e.target.closest('.turn-card-expanded')) {
      // 연속 도구 그룹 헤더 토글
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

    // 카드 헤더 클릭 → accordion 토글
    const cardBtn = e.target.closest('[data-toggle-card]');
    if (cardBtn) { toggleCardExpand(cardBtn.dataset.toggleCard); return; }

    const promptEl = e.target.closest('[data-expand-id]');
    if (promptEl) {
      const container = promptEl.closest('tr') || promptEl.closest('.turn-row');
      if (container) togglePromptExpand(promptEl.dataset.expandId, container);
    }
  });

  // 카드 accordion 키보드 접근성 — Enter/Space
  document.getElementById('detailView').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cardBtn = e.target.closest('[data-toggle-card]');
    if (cardBtn) {
      e.preventDefault();
      toggleCardExpand(cardBtn.dataset.toggleCard);
    }
  });

  document.getElementById('defaultView').addEventListener('click', e => {
    const sessEl = e.target.closest('[data-goto-session]');
    if (sessEl && sessEl.dataset.gotoSession) {
      const proj = sessEl.dataset.gotoProject;
      if (proj && proj !== getSelectedProject()) {
        localStorage.setItem(STORAGE_KEY, proj);
        setSelectedProject(proj);
        renderBrowserProjects();
      }
      selectSession(sessEl.dataset.gotoSession);
      return;
    }
    const promptEl = e.target.closest('[data-expand-id]');
    if (promptEl) {
      const tr = promptEl.closest('tr');
      if (tr) togglePromptExpand(promptEl.dataset.expandId, tr);
    }
  });
}


// ── CHART SECTION COLLAPSE TOGGLE ────────────────────────────────────────────
const CHART_COLLAPSED_KEY = 'spyglass:chart-collapsed';

function toggleChartCollapse() {
  const chartSection = document.getElementById('chartSection');
  const btn = document.getElementById('btnToggleChart');
  chartSection.classList.toggle('chart-collapsed');
  const collapsed = chartSection.classList.contains('chart-collapsed');
  localStorage.setItem(CHART_COLLAPSED_KEY, JSON.stringify(collapsed));
  if (btn) btn.setAttribute('aria-label', collapsed ? '펼치기' : '접기');
}

function restoreChartCollapsedState() {
  const collapsed = JSON.parse(localStorage.getItem(CHART_COLLAPSED_KEY) || 'false');
  if (collapsed) {
    const chartSection = document.getElementById('chartSection');
    const btn = document.getElementById('btnToggleChart');
    chartSection.classList.add('chart-collapsed');
    if (btn) btn.setAttribute('aria-label', '펼치기');
  }
}

// ── LEFT PANEL COLLAPSE TOGGLE ─────────────────────────────────────────────
const PANEL_HIDDEN_KEY = 'spyglass:left-panel-hidden';

// ── localStorage 마이그레이션 (ADR-014 — prefix 통일) ──────────────────────
function migrateKey(oldKey, newKey) {
  const v = localStorage.getItem(oldKey);
  if (v != null && localStorage.getItem(newKey) == null) {
    localStorage.setItem(newKey, v);
    localStorage.removeItem(oldKey);
  }
}
function migrateLocalStorage() {
  migrateKey('left-panel-hidden', 'spyglass:left-panel-hidden');
  migrateKey('left-panel-state', 'spyglass:left-panel-state');
}

function savePanelHiddenState(isHidden) {
  localStorage.setItem(PANEL_HIDDEN_KEY, JSON.stringify(isHidden));
}

function restorePanelHiddenState() {
  const isHidden = JSON.parse(localStorage.getItem(PANEL_HIDDEN_KEY) || 'false');
  const mainLayout = document.querySelector('.main-layout');
  if (isHidden) {
    mainLayout.classList.add('left-panel-hidden');
  }
}

function toggleLeftPanel() {
  const mainLayout = document.querySelector('.main-layout');
  mainLayout.classList.toggle('left-panel-hidden');
  const isHidden = mainLayout.classList.contains('left-panel-hidden');
  savePanelHiddenState(isHidden);
}

// ── Keyboard Shortcuts (ADR-012, 1차) ────────────────────────────────────────

const KBD_HELP_BACKDROP_ID = 'kbdHelpBackdrop';

function isKbdHelpVisible() {
  return document.getElementById(KBD_HELP_BACKDROP_ID)?.classList.contains('visible');
}

function showKbdHelp() {
  document.getElementById(KBD_HELP_BACKDROP_ID)?.classList.add('visible');
}

function hideKbdHelp() {
  document.getElementById(KBD_HELP_BACKDROP_ID)?.classList.remove('visible');
}

function toggleKbdHelp() {
  if (isKbdHelpVisible()) hideKbdHelp();
  else showKbdHelp();
}

// 현재 활성 뷰의 검색 input
function activeSearchInput() {
  if (uiState.rightView === 'detail') return document.getElementById('detailSearchInput');
  return document.getElementById('feedSearchInput');
}

// 현재 활성 뷰의 type filter 버튼 컨테이너
function activeTypeFilterButtons() {
  const id = uiState.rightView === 'detail' ? 'detailTypeFilterBtns' : 'typeFilterBtns';
  return document.querySelectorAll(`#${id} .type-filter-btn`);
}

// 입력 중에는 단축키 가로채지 않음 (검색 input 등)
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

// ESC 우선순위: 모달 → 확장 패널 → 검색 클리어 → detail 닫기
function handleEscape() {
  if (isKbdHelpVisible()) { hideKbdHelp(); return; }
  // 확장 패널 닫기
  const expandRow = document.querySelector('[data-expand-for]');
  if (expandRow) { expandRow.remove(); return; }
  // 검색 클리어 (값이 있을 때)
  const searchInput = activeSearchInput();
  if (searchInput && searchInput.value) {
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  // detail 뷰 닫기
  if (uiState.rightView === 'detail') {
    closeDetail();
    return;
  }
}

function focusActiveSearch() {
  const el = activeSearchInput();
  if (el) {
    el.focus();
    el.select?.();
  }
}

function triggerFilterByIndex(idx) {
  const btns = activeTypeFilterButtons();
  if (idx >= 0 && idx < btns.length) btns[idx].click();
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // ESC는 input 안에서도 동작 (검색 클리어용)
    if (e.key === 'Escape') {
      handleEscape();
      // 입력 중이면 추가 동작은 막고, blur는 안함 (사용자 흐름 보존)
      e.preventDefault();
      return;
    }

    // Cmd/Ctrl+F → 검색 포커스 (브라우저 기본 가로채기)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      focusActiveSearch();
      return;
    }

    // 입력 중에는 나머지 단축키 비활성화
    if (isTypingTarget(e.target)) return;

    // / 키 → 검색 포커스
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      focusActiveSearch();
      return;
    }

    // ? 키 → 도움말 모달 토글
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      toggleKbdHelp();
      return;
    }

    // 1~7 → 타입 필터
    if (/^[1-7]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      triggerFilterByIndex(parseInt(e.key, 10) - 1);
      return;
    }
  });
}

function initKbdHelpModal() {
  const backdrop = document.getElementById(KBD_HELP_BACKDROP_ID);
  if (!backdrop) return;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideKbdHelp();
  });
  document.getElementById('kbdHelpClose')?.addEventListener('click', hideKbdHelp);
  document.getElementById('btnHelpOpen')?.addEventListener('click', toggleKbdHelp);
}

// ── ADR-008: Donut 모드 토글 / Cache 모드 토글 / cache-matrix 모두 제거.
//   도넛 모드는 setChartMode가 자동 결정 (default→model, detail→type).
//   cache panel은 cache 효율 단일 책임으로 복귀 (Hit Rate / Cost / Creation·Read).

// ── ADR-016: Tool 모드 토글 (도구별 / 카테고리별) ─────────────────────────
let _toolCategoriesCache = null;

function initToolModeToggle() {
  const wrap = document.getElementById('toolModeToggle');
  if (!wrap) return;
  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tool-mode]');
    if (!btn) return;
    const mode = btn.dataset.toolMode;
    wrap.querySelectorAll('.tool-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
    const tableEl = document.getElementById('toolsByName');
    const catsEl  = document.getElementById('toolCategories');
    if (mode === 'category') {
      tableEl?.setAttribute('hidden', '');
      catsEl?.removeAttribute('hidden');
      if (!_toolCategoriesCache) {
        const { fetchToolCategories } = await import('./metrics-api.js');
        _toolCategoriesCache = await fetchToolCategories({ range: '24h' });
      }
      const { renderToolCategories } = await import('./left-panel.js');
      renderToolCategories(_toolCategoriesCache);
    } else {
      catsEl?.setAttribute('hidden', '');
      tableEl?.removeAttribute('hidden');
    }
  });
}

// ── ADR-018: 로고 홈 복귀 ───────────────────────────────────────────────────
function initLogoHome() {
  const logo = document.querySelector('.logo');
  if (!logo) return;
  logo.setAttribute('role', 'button');
  logo.setAttribute('tabindex', '0');
  logo.setAttribute('aria-label', '홈으로 이동');
  logo.style.cursor = 'pointer';

  const goHome = () => {
    if (uiState.rightView === 'detail') closeDetail();
    setSelectedSession(null);
    setSelectedProject(null);
    localStorage.removeItem('spyglass:lastProject');
    renderBrowserSessions();
    renderBrowserProjects();
    document.querySelector('.right-panel')?.scrollTo({ top: 0, behavior: 'smooth' });
    autoActivateProject();
  };
  logo.addEventListener('click', goHome);
  logo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goHome();
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
  // ADR-014: localStorage 키 prefix 마이그레이션 (다른 init 보다 먼저)
  migrateLocalStorage();

  initTypeColors();
  initBuckets();
  drawTimeline();
  drawDonut();
  // ADR-008: 초기 진입은 default 모드 — setChartMode가 setDonutMode('model') + fetchModelUsage 자동 처리
  setChartMode('default');
  fetchDashboard();
  fetchRequests();
  fetchCacheStats();
  fetchAllSessions().then(() => autoActivateProject());
  connectSSE();
  restorePanelHiddenState();
  restoreChartCollapsedState();
  document.getElementById('btnPanelCollapse').addEventListener('click', toggleLeftPanel);
  document.getElementById('btnToggleChart').addEventListener('click', toggleChartCollapse);
  initEventDelegation();
  initCharts();
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
  // ADR-012: 키보드 단축키 + 도움말 모달
  initKeyboardShortcuts();
  initKbdHelpModal();
  // ADR-008: donut-mode-toggle / cache-mode-toggle 폐기. setChartMode가 도넛 모드 자동 결정.
  initToolModeToggle();   // ADR-016 Tool 카테고리 토글 — 유지
  // ADR-018: 로고 홈 복귀
  initLogoHome();
  setInterval(() => { advanceBuckets(); drawTimeline(); }, 60000);
  setInterval(() => fetchAllSessions(), 30000);
}

document.addEventListener('DOMContentLoaded', init);
