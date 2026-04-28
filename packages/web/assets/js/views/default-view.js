// views/default-view.js — DefaultView 피드·차트·UI 초기화

import { formatDuration } from '../formatters.js';
import { makeRequestRow, makeTargetCell, togglePromptExpand } from '../renderers.js';
import { addScrollLockCount, updateScrollLockBanner, resetScrollLockCount } from '../infra.js';
import { fetchModelUsage } from '../metrics-api.js';
import { fetchRequests, setReqFilter, getReqFilter } from '../api.js';
import { drawTimeline, drawDonut, setSourceData, setDonutMode, hasSourceData, renderTypeLegend } from '../chart.js';
import { SUB_TYPES } from '../request-types.js';
import { createFilterBar } from '../components/filter-bar.js';
import { createSearchBox } from '../components/search-box.js';
import {
  getSelectedProject, setSelectedProject,
  getRightView,
  getFeedFilterBar, setFeedFilterBar,
  getDetailFilterBar,
} from '../state.js';
import { renderBrowserProjects } from '../left-panel.js';
import { detailSearchBox } from '../session-detail.js';

const STORAGE_KEY        = 'spyglass:lastProject';
const CHART_COLLAPSED_KEY = 'spyglass:chart-collapsed';
const PANEL_HIDDEN_KEY   = 'spyglass:left-panel-hidden';
const KBD_HELP_BACKDROP_ID = 'kbdHelpBackdrop';

// ── 공통 뷰 전환 ─────────────────────────────────────────────────────────────
export function renderRightPanel() {
  const isDetail = getRightView() === 'detail';
  document.getElementById('defaultView').classList.toggle('active', !isDetail);
  document.getElementById('detailView').classList.toggle('active', isDetail);
}

// ── 차트 모드 ─────────────────────────────────────────────────────────────────
export async function setChartMode(mode) {
  const chartSection = document.getElementById('chartSection');
  const rightPanel  = document.querySelector('.right-panel');
  if (!chartSection) return;
  if (mode === 'detail') {
    chartSection.classList.add('chart-mode-detail');
    chartSection.querySelector('.chart-detail-meta')?.removeAttribute('hidden');
    chartSection.querySelectorAll('.chart-detail-only').forEach(el => el.removeAttribute('hidden'));
    rightPanel?.classList.add('is-detail-mode');
    setDonutMode('type');
  } else {
    chartSection.classList.remove('chart-mode-detail');
    chartSection.querySelector('.chart-detail-meta')?.setAttribute('hidden', '');
    chartSection.querySelectorAll('.chart-detail-only').forEach(el => el.setAttribute('hidden', ''));
    rightPanel?.classList.remove('is-detail-mode');
    setDonutMode('model');
    if (!hasSourceData('model')) {
      try {
        const data = await fetchModelUsage({ range: '24h' });
        setSourceData('model', data || []);
      } catch { /* silent */ }
    }
    drawDonut();
    renderTypeLegend();
  }
}

// ── 피드 ─────────────────────────────────────────────────────────────────────
export function prependRequest(r) {
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

export function reapplyFeedAnomalies() {
  // 별도 작업 없음. 실제 anomaly는 다음 fetchRequests 응답 시 적용된다.
}

// ── 차트 섹션 접힘 ────────────────────────────────────────────────────────────
export function toggleChartCollapse() {
  const chartSection = document.getElementById('chartSection');
  const btn = document.getElementById('btnToggleChart');
  chartSection.classList.toggle('chart-collapsed');
  const collapsed = chartSection.classList.contains('chart-collapsed');
  localStorage.setItem(CHART_COLLAPSED_KEY, JSON.stringify(collapsed));
  if (btn) btn.setAttribute('aria-label', collapsed ? '펼치기' : '접기');
}

export function restoreChartCollapsedState() {
  const collapsed = JSON.parse(localStorage.getItem(CHART_COLLAPSED_KEY) || 'false');
  if (collapsed) {
    const chartSection = document.getElementById('chartSection');
    const btn = document.getElementById('btnToggleChart');
    chartSection.classList.add('chart-collapsed');
    if (btn) btn.setAttribute('aria-label', '펼치기');
  }
}

// ── 좌측 패널 접힘 ────────────────────────────────────────────────────────────
function migrateKey(oldKey, newKey) {
  const v = localStorage.getItem(oldKey);
  if (v != null && localStorage.getItem(newKey) == null) {
    localStorage.setItem(newKey, v);
    localStorage.removeItem(oldKey);
  }
}

export function migrateLocalStorage() {
  migrateKey('left-panel-hidden', PANEL_HIDDEN_KEY);
  migrateKey('left-panel-state', 'spyglass:left-panel-state');
}

function savePanelHiddenState(isHidden) {
  localStorage.setItem(PANEL_HIDDEN_KEY, JSON.stringify(isHidden));
}

export function restorePanelHiddenState() {
  const isHidden = JSON.parse(localStorage.getItem(PANEL_HIDDEN_KEY) || 'false');
  if (isHidden) {
    document.querySelector('.main-layout')?.classList.add('left-panel-hidden');
  }
}

export function toggleLeftPanel() {
  const mainLayout = document.querySelector('.main-layout');
  mainLayout.classList.toggle('left-panel-hidden');
  const isHidden = mainLayout.classList.contains('left-panel-hidden');
  savePanelHiddenState(isHidden);
}

// ── 키보드 도움말 모달 ───────────────────────────────────────────────────────
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

// ── DefaultView 초기화 ────────────────────────────────────────────────────────
/**
 * @param {{
 *   onSelectSession: (id: string) => void,
 *   onCloseDetail: () => void,
 *   onGoHome: () => void,
 * }} opts
 */
export function initDefaultView({ onSelectSession, onCloseDetail, onGoHome }) {
  // Feed filter bar
  const feedFilterBar = createFilterBar('typeFilterBtns', {
    dataAttr: 'filter',
    onChange(filter) {
      setReqFilter(filter);
      if (SUB_TYPES.includes(filter)) {
        applyFeedSearch();
      } else {
        fetchRequests(false);
      }
    },
  });
  setFeedFilterBar(feedFilterBar);

  // Load more button
  document.getElementById('loadMoreBtn').addEventListener('click', () => fetchRequests(true));

  // Feed search
  let feedSearchBox = null;

  function applyFeedSearch() {
    const q = (feedSearchBox?.getValue() ?? '').toLowerCase();
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

  feedSearchBox = createSearchBox('feedSearchContainer', {
    placeholder: 'model / tool / message',
    onSearch: applyFeedSearch,
  });
  document.addEventListener('feed:updated', applyFeedSearch);

  // DefaultView click delegation
  document.getElementById('defaultView').addEventListener('click', e => {
    const sessEl = e.target.closest('[data-goto-session]');
    if (sessEl && sessEl.dataset.gotoSession) {
      const proj = sessEl.dataset.gotoProject;
      if (proj && proj !== getSelectedProject()) {
        localStorage.setItem(STORAGE_KEY, proj);
        setSelectedProject(proj);
        renderBrowserProjects();
      }
      onSelectSession(sessEl.dataset.gotoSession);
      return;
    }
    const promptEl = e.target.closest('[data-expand-id]');
    if (promptEl) {
      const tr = promptEl.closest('tr');
      if (tr) togglePromptExpand(promptEl.dataset.expandId, tr);
    }
  });

  // Keyboard shortcuts
  function activeSearchInput() {
    const box = getRightView() === 'detail' ? detailSearchBox : feedSearchBox;
    return box?.element() ?? null;
  }

  function activeTypeFilterButtons() {
    return (getRightView() === 'detail' ? getDetailFilterBar() : getFeedFilterBar())?.buttons()
      ?? document.querySelectorAll('.type-filter-btn-none');
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function focusActiveSearch() {
    const el = activeSearchInput();
    if (el) { el.focus(); el.select?.(); }
  }

  function triggerFilterByIndex(idx) {
    const btns = activeTypeFilterButtons();
    if (idx >= 0 && idx < btns.length) btns[idx].click();
  }

  // ESC 우선순위: 모달 → 확장 패널 → 검색 클리어 → detail 닫기
  function handleEscape() {
    if (isKbdHelpVisible()) { hideKbdHelp(); return; }
    const expandRow = document.querySelector('[data-expand-for]');
    if (expandRow) { expandRow.remove(); return; }
    const searchInput = activeSearchInput();
    if (searchInput && searchInput.value) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (getRightView() === 'detail') { onCloseDetail(); return; }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { handleEscape(); e.preventDefault(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); focusActiveSearch(); return;
    }
    if (isTypingTarget(e.target)) return;
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); focusActiveSearch(); return;
    }
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault(); toggleKbdHelp(); return;
    }
    if (/^[1-7]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); triggerFilterByIndex(parseInt(e.key, 10) - 1); return;
    }
  });

  // KBD help modal
  const backdrop = document.getElementById(KBD_HELP_BACKDROP_ID);
  if (backdrop) {
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) hideKbdHelp(); });
  }
  document.getElementById('kbdHelpClose')?.addEventListener('click', hideKbdHelp);
  document.getElementById('btnHelpOpen')?.addEventListener('click', toggleKbdHelp);

  // Logo home
  const logo = document.querySelector('.logo');
  if (logo) {
    logo.setAttribute('role', 'button');
    logo.setAttribute('tabindex', '0');
    logo.setAttribute('aria-label', '홈으로 이동');
    logo.style.cursor = 'pointer';
    logo.addEventListener('click', onGoHome);
    logo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoHome(); }
    });
  }

  // Tool mode toggle (ADR-016)
  let _toolCategoriesCache = null;
  const toolModeWrap = document.getElementById('toolModeToggle');
  if (toolModeWrap) {
    toolModeWrap.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-tool-mode]');
      if (!btn) return;
      const mode = btn.dataset.toolMode;
      toolModeWrap.querySelectorAll('.tool-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      const tableEl = document.getElementById('toolsByName');
      const catsEl  = document.getElementById('toolCategories');
      if (mode === 'category') {
        tableEl?.setAttribute('hidden', '');
        catsEl?.removeAttribute('hidden');
        if (!_toolCategoriesCache) {
          const { fetchToolCategories } = await import('../metrics-api.js');
          _toolCategoriesCache = await fetchToolCategories({ range: '24h' });
        }
        const { renderToolCategories } = await import('../left-panel.js');
        renderToolCategories(_toolCategoriesCache);
      } else {
        catsEl?.setAttribute('hidden', '');
        tableEl?.removeAttribute('hidden');
      }
    });
  }

  // Canvas ResizeObserver
  const timelineWrap = document.querySelector('#timelineChart')?.parentElement;
  if (timelineWrap) {
    if ('ResizeObserver' in window) {
      let _rafId = null;
      new ResizeObserver(() => {
        cancelAnimationFrame(_rafId);
        _rafId = requestAnimationFrame(() => drawTimeline());
      }).observe(timelineWrap);
    } else {
      window.addEventListener('resize', drawTimeline);
    }
  }
}
