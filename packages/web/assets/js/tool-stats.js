// Detail Tools View — 단일 매트릭스 뷰 (ADR-007)
// 1행 1도구, 6컬럼 (Tool/Avg/Calls/Tokens/%/Err) + 정렬 토글

import { fmtToken, escHtml } from './formatters.js';
import { toolIconHtml } from './renderers.js';

export const API = '';

let _container = null;
let _stats     = [];
let _sortKey   = 'tokens';   // 'avg' | 'calls' | 'tokens' (기본: 토큰 기여도)
let _currentSessionId = null;

export function initToolStats() {
  _container = document.getElementById('detailToolsView');
}

export async function loadToolStats(sessionId) {
  if (!_container) return;
  _currentSessionId = sessionId;
  _container.innerHTML = `
    <div class="state-loading">
      <div class="state-loading-spinner"></div>
      <span>불러오는 중…</span>
    </div>`;
  try {
    const res  = await fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/tool-stats`);
    const json = await res.json();
    _stats = json.data || [];
    renderMatrix();
  } catch {
    _container.innerHTML = `
      <div class="state-error">
        <div class="state-error-message">데이터를 불러올 수 없습니다</div>
        <button class="state-error-retry" data-retry-tools>다시 시도</button>
      </div>`;
    _container.querySelector('[data-retry-tools]')?.addEventListener('click', () => loadToolStats(_currentSessionId));
  }
}

export function clearToolStats() {
  if (_container) _container.innerHTML = '';
  _stats = [];
}

function fmtDur(ms) {
  if (!ms || ms === 0) return '—';
  if (ms < 1000)   return `${Math.round(ms)}ms`;
  if (ms < 60000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

function setSort(key) {
  _sortKey = key;
  renderMatrix();
}

function renderMatrix() {
  if (!_container) return;
  if (!_stats.length) {
    _container.innerHTML = '<div class="state-empty"><span class="state-empty-title">데이터가 없습니다</span></div>';
    return;
  }

  const sortFns = {
    avg:    (a, b) => (b.avg_duration_ms || 0) - (a.avg_duration_ms || 0),
    calls:  (a, b) => (b.call_count || 0) - (a.call_count || 0),
    tokens: (a, b) => (b.pct_of_total_tokens || 0) - (a.pct_of_total_tokens || 0),
  };
  const sorted = [..._stats].sort(sortFns[_sortKey] || sortFns.tokens);

  const maxCalls = Math.max(..._stats.map(s => s.call_count || 0), 1);
  const maxDur   = Math.max(..._stats.map(s => s.avg_duration_ms || 0), 1);

  const rows = sorted.map(s => {
    // SSoT: renderers.toolIconHtml 재사용 (Agent/Skill/Task → ◎ orange, 그 외 → ◉ green)
    const icon = toolIconHtml(s.tool_name);
    const callPct = Math.round((s.call_count || 0) / maxCalls * 100);
    const durPct  = Math.round((s.avg_duration_ms || 0) / maxDur * 100);
    const tokPct  = s.pct_of_total_tokens || 0;
    const errBadge = s.error_count > 0
      ? `<span class="ts-err-cell"><span class="mini-badge badge-error">${s.error_count}</span></span>`
      : `<span class="ts-err-cell ts-err-cell--none">—</span>`;

    return `<div class="ts-mx-row">
      <div class="ts-mx-cell ts-mx-tool">
        ${icon}<span class="ts-mx-tool-name" title="${escHtml(s.tool_name)}">${escHtml(s.tool_name)}</span>
      </div>
      <div class="ts-mx-cell ts-mx-num">
        <span class="ts-mx-val">${fmtDur(s.avg_duration_ms)}</span>
        <span class="ts-mx-bar"><span class="ts-mx-bar-fill ts-mx-bar-fill--avg" style="width:${durPct}%"></span></span>
      </div>
      <div class="ts-mx-cell ts-mx-num">
        <span class="ts-mx-val">${s.call_count || 0}</span>
        <span class="ts-mx-bar"><span class="ts-mx-bar-fill ts-mx-bar-fill--calls" style="width:${callPct}%"></span></span>
      </div>
      <div class="ts-mx-cell ts-mx-num">
        <span class="ts-mx-val">${fmtToken(s.total_tokens)}</span>
        <span class="ts-mx-sub">${tokPct.toFixed(1)}%</span>
      </div>
      <div class="ts-mx-cell ts-mx-num">
        <span class="ts-mx-bar"><span class="ts-mx-bar-fill ts-mx-bar-fill--tokens" style="width:${Math.min(tokPct, 100)}%"></span></span>
      </div>
      <div class="ts-mx-cell ts-mx-err">${errBadge}</div>
    </div>`;
  }).join('');

  _container.innerHTML = `
    <div class="ts-mx">
      <div class="ts-mx-toolbar">
        <span class="ts-mx-title">도구별 통계</span>
        <div class="ts-mx-sort">
          <span class="ts-mx-sort-label">정렬</span>
          <button class="ts-mx-sort-btn ${_sortKey === 'avg'    ? 'active' : ''}" data-sort="avg">응답시간</button>
          <button class="ts-mx-sort-btn ${_sortKey === 'calls'  ? 'active' : ''}" data-sort="calls">호출 횟수</button>
          <button class="ts-mx-sort-btn ${_sortKey === 'tokens' ? 'active' : ''}" data-sort="tokens">토큰 기여도</button>
        </div>
      </div>
      <div class="ts-mx-head">
        <div class="ts-mx-cell ts-mx-tool">Tool</div>
        <div class="ts-mx-cell ts-mx-num">평균 응답</div>
        <div class="ts-mx-cell ts-mx-num">호출</div>
        <div class="ts-mx-cell ts-mx-num">토큰</div>
        <div class="ts-mx-cell ts-mx-num">기여도</div>
        <div class="ts-mx-cell ts-mx-err">오류</div>
      </div>
      <div class="ts-mx-body">${rows}</div>
    </div>`;

  // 정렬 버튼 이벤트
  _container.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => setSort(btn.dataset.sort));
  });
}
