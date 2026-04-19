import { fmtToken } from './formatters.js';

export const API = '';

let _container = null;

export function initToolStats() {
  _container = document.getElementById('detailToolsView');
}

export async function loadToolStats(sessionId) {
  if (!_container) return;
  _container.innerHTML = '<div class="tool-stats-empty">로딩 중…</div>';
  try {
    const res  = await fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/tool-stats`);
    const json = await res.json();
    renderToolStats(json.data || []);
  } catch {
    _container.innerHTML = '<div class="tool-stats-empty">데이터를 불러올 수 없습니다</div>';
  }
}

export function clearToolStats() {
  if (_container) _container.innerHTML = '';
}

function fmtDur(ms) {
  if (!ms || ms === 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

function renderToolStats(stats) {
  if (!_container) return;
  if (!stats.length) {
    _container.innerHTML = '<div class="tool-stats-empty">tool_call 데이터 없음</div>';
    return;
  }

  const maxDur   = Math.max(...stats.map(s => s.avg_duration_ms || 0), 1);
  const maxCalls = Math.max(...stats.map(s => s.call_count || 0), 1);

  const byDur    = [...stats].sort((a, b) => (b.avg_duration_ms || 0) - (a.avg_duration_ms || 0));
  const byCalls  = [...stats].sort((a, b) => b.call_count - a.call_count);
  const byTokens = [...stats].sort((a, b) => (b.pct_of_total_tokens || 0) - (a.pct_of_total_tokens || 0));

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  const durRows = byDur.map(s => {
    const pct = maxDur > 0 ? Math.round((s.avg_duration_ms || 0) / maxDur * 100) : 0;
    return `<div class="ts-row">
      <span class="ts-name" title="${escHtml(s.tool_name)}">${escHtml(s.tool_name)}</span>
      <div class="ts-bar-wrap"><div class="ts-bar ts-bar-dur" style="width:${pct}%"></div></div>
      <span class="ts-val">${fmtDur(s.avg_duration_ms)}</span>
      <span class="ts-sub">max ${fmtDur(s.max_duration_ms)}</span>
    </div>`;
  }).join('');

  const callRows = byCalls.map(s => {
    const pct = maxCalls > 0 ? Math.round(s.call_count / maxCalls * 100) : 0;
    const errBadge = s.error_count > 0
      ? `<span class="ts-err-badge">오류 ${s.error_count}</span>` : '';
    return `<div class="ts-row">
      <span class="ts-name" title="${escHtml(s.tool_name)}">${escHtml(s.tool_name)}</span>
      <div class="ts-bar-wrap"><div class="ts-bar ts-bar-call" style="width:${pct}%"></div></div>
      <span class="ts-val">${s.call_count}회</span>
      ${errBadge}
    </div>`;
  }).join('');

  const tokenRows = byTokens.map(s => {
    const pct = s.pct_of_total_tokens || 0;
    return `<div class="ts-row">
      <span class="ts-name" title="${escHtml(s.tool_name)}">${escHtml(s.tool_name)}</span>
      <div class="ts-bar-wrap"><div class="ts-bar ts-bar-tok" style="width:${Math.min(pct, 100)}%"></div></div>
      <span class="ts-val">${pct.toFixed(1)}%</span>
      <span class="ts-sub">${fmtToken(s.total_tokens)}</span>
    </div>`;
  }).join('');

  _container.innerHTML = `
    <div class="tool-stats-panel">
      <div class="ts-section">
        <div class="ts-section-title">평균 응답시간</div>
        ${durRows}
      </div>
      <div class="ts-section">
        <div class="ts-section-title">호출 횟수</div>
        ${callRows}
      </div>
      <div class="ts-section">
        <div class="ts-section-title">토큰 기여도</div>
        ${tokenRows}
      </div>
    </div>
  `;
}
