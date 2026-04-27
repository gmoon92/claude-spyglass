// 좌측 패널 모듈 — 프로젝트/세션/툴 렌더링
import { fmt, fmtToken, escHtml } from './formatters.js';
import { makeSkeletonRows, makeSessionRow } from './renderers.js';

// ADR-016: tool-categories 6 카테고리 색상 매핑
const CATEGORY_COLORS = {
  FileOps: '#34d399',
  Search:  '#fbbf24',
  Bash:    '#fb923c',
  MCP:     '#22d3ee',
  Agent:   '#f59e0b',
  Other:   '#94a3b8',
};

/**
 * ADR-016 — Tool 카테고리 분포 렌더 (api-spec §7).
 * 6 카테고리, 가로 막대 + percentage.
 */
export function renderToolCategories(categories) {
  const el = document.getElementById('toolCategories');
  if (!el) return;
  if (!Array.isArray(categories) || !categories.length || categories.every(c => !c.request_count)) {
    el.innerHTML = '<div class="state-empty" style="padding:0;font-size:var(--font-meta)">데이터가 없습니다</div>';
    return;
  }
  const max = Math.max(1, ...categories.map(c => c.request_count || 0));
  el.innerHTML = categories.map(c => {
    const pct = Math.round((c.request_count || 0) / max * 100);
    const color = CATEGORY_COLORS[c.category] || CATEGORY_COLORS.Other;
    return `<div class="cat-row">
      <span class="cat-name">${escHtml(c.category)}</span>
      <div class="cat-bar"><div class="cat-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="cat-count num">${c.request_count}</span>
      <span class="cat-pct">${(c.percentage ?? 0).toFixed(1)}%</span>
    </div>`;
  }).join('');
}

let _selectedProject = null;
let _selectedSession = null;
let _allProjects     = [];
let _allSessions     = [];

export function getSelectedProject() { return _selectedProject; }
export function getSelectedSession() { return _selectedSession; }
export function setSelectedProject(p) { _selectedProject = p; }
export function setSelectedSession(s) { _selectedSession = s; }
export function getAllSessions()  { return _allSessions; }
export function setAllSessions(list) { _allSessions = list; }
export function getAllProjects()  { return _allProjects; }

export function renderBrowserProjects() {
  const body = document.getElementById('browserProjectsBody');
  if (!_allProjects.length) {
    body.innerHTML = '<tr><td colspan="3" class="table-empty">데이터가 없습니다</td></tr>';
    return;
  }
  const maxT = Math.max(..._allProjects.map(p => p.total_tokens || 0), 1);
  body.innerHTML = _allProjects.map(p => {
    const isSelected = _selectedProject === p.project_name;
    const pct        = Math.max(1, Math.round((p.total_tokens || 0) / maxT * 100));
    return `<tr class="clickable${isSelected ? ' row-selected' : ''}" data-project="${escHtml(p.project_name)}">
      <td class="cell-proj-name" title="${escHtml(p.project_name || '')}">${escHtml(p.project_name || '—')}</td>
      <td class="num" style="text-align:right">${fmt(p.session_count)}</td>
      <td>
        <div class="bar-cell" style="justify-content:flex-end;gap:4px">
          <div class="bar-track" style="min-width:36px"><div class="bar-fill" style="width:${pct}%"></div></div>
          <span class="bar-label num-hi" style="min-width:30px">${fmtToken(p.total_tokens)}</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

export function renderBrowserSessions() {
  const body = document.getElementById('browserSessionsBody');
  const hint = document.getElementById('sessionPaneHint');
  if (!_selectedProject) {
    body.innerHTML = '<tr><td colspan="4" class="table-empty">—</td></tr>';
    hint.textContent = '프로젝트를 선택하세요';
    return;
  }
  const list = _allSessions
    .filter(s => s.project_name === _selectedProject)
    .sort((a, b) => {
      const aActive = a.ended_at == null ? 1 : 0;
      const bActive = b.ended_at == null ? 1 : 0;
      if (bActive !== aActive) return bActive - aActive;
      const aLast = a.last_activity_at || a.started_at || 0;
      const bLast = b.last_activity_at || b.started_at || 0;
      if (bLast !== aLast) return bLast - aLast;
      return (b.started_at || 0) - (a.started_at || 0);
    });
  hint.textContent = `${_selectedProject} · ${list.length}개`;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="4" class="table-empty">데이터가 없습니다</td></tr>';
    return;
  }
  body.innerHTML = list.map(s => makeSessionRow(s, _selectedSession === s.id)).join('');
}

export function renderProjects(list) {
  _allProjects = list;
  renderBrowserProjects();
}

export function renderTools(list) {
  if (!list.length) {
    document.getElementById('toolCount').textContent = '—';
    document.getElementById('toolsBody').innerHTML   = makeSkeletonRows(4, 2);
    return;
  }
  document.getElementById('toolCount').textContent = `${list.length}개`;
  const body = document.getElementById('toolsBody');
  const maxC = Math.max(...list.map(t => t.call_count || 0), 1);

  function toolIconHtml(toolName) {
    const isAgent = toolName && /^(Agent|Skill|Task)/.test(toolName);
    return isAgent
      ? '<span class="tool-icon tool-icon-agent">◎</span>'
      : '<span class="tool-icon tool-icon-default">◉</span>';
  }

  body.innerHTML = list.map(t => {
    const detailText = t.tool_detail
      ? (t.tool_detail.length > 50 ? t.tool_detail.slice(0, 50) + '…' : t.tool_detail)
      : '';
    return `<tr>
      <td><div class="tool-cell">
        <span class="tool-main">${toolIconHtml(t.tool_name)}${escHtml(t.tool_name || '—')}</span>
        ${detailText ? `<span class="tool-sub" title="${escHtml(t.tool_detail)}">${escHtml(detailText)}</span>` : ''}
      </div></td>
      <td class="num num-hi cell-token">${fmt(t.call_count)}</td>
      <td class="num cell-token">${t.avg_tokens > 0 ? fmtToken(Math.round(t.avg_tokens)) : '—'}</td>
      <td><div class="bar-cell">
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((t.call_count || 0) / maxC * 100)}%;background:var(--green)"></div></div>
        <span class="bar-label">${Math.round((t.call_count || 0) / maxC * 100)}%</span>
      </div></td>
    </tr>`;
  }).join('');
}

export function showSkeletonSessions() {
  document.getElementById('browserSessionsBody').innerHTML = makeSkeletonRows(4, 2);
}
