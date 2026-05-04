// 좌측 패널 모듈 — 프로젝트/세션 렌더링
// (툴 통계는 left-panel-observability-revamp ADR-001로 obs-panel.js 위젯으로 이동.
//  detail view 도구 매트릭스는 ts-mx 가 단일 진실 소스.)
import { fmt, fmtToken, escHtml } from './formatters.js';
import { makeSkeletonRows, makeSessionRow } from './renderers.js';
import { getSelectedProject, getSelectedSession } from './state.js';

let _allProjects     = [];
let _allSessions     = [];

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
    const isSelected = getSelectedProject() === p.project_name;
    const pct        = Math.max(1, Math.round((p.total_tokens || 0) / maxT * 100));
    // 세션 컬럼: "활성/전체" 형태. 활성 0이면 전체만 표시 (시각 노이즈 최소화).
    // tooltip으로 의미 명시 — 컬럼 헤더 "세션" 단어로는 둘 다 같이 표현하기 어려움.
    const total  = p.session_count || 0;
    const active = p.active_count ?? 0;
    const sessLabel = active > 0
      ? `<span class="proj-active">${fmt(active)}</span><span class="proj-sess-sep">/</span>${fmt(total)}`
      : fmt(total);
    const sessTitle = active > 0
      ? `라이브 ${active}개 / 전체 ${total}개`
      : `전체 ${total}개`;
    return `<tr class="clickable${isSelected ? ' row-selected' : ''}" data-project="${escHtml(p.project_name)}">
      <td class="cell-proj-name" title="${escHtml(p.project_name || '')}">${escHtml(p.project_name || '—')}</td>
      <td class="num cell-proj-sess" style="text-align:right" title="${sessTitle}">${sessLabel}</td>
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
  if (!getSelectedProject()) {
    body.innerHTML = '<tr><td colspan="4" class="table-empty">—</td></tr>';
    hint.textContent = '프로젝트를 선택하세요';
    return;
  }
  const list = _allSessions
    .filter(s => s.project_name === getSelectedProject())
    .sort((a, b) => {
      const aActive = a.ended_at == null ? 1 : 0;
      const bActive = b.ended_at == null ? 1 : 0;
      if (bActive !== aActive) return bActive - aActive;
      const aLast = a.last_activity_at || a.started_at || 0;
      const bLast = b.last_activity_at || b.started_at || 0;
      if (bLast !== aLast) return bLast - aLast;
      return (b.started_at || 0) - (a.started_at || 0);
    });
  hint.textContent = `${getSelectedProject()} · ${list.length}개`;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="4" class="table-empty">데이터가 없습니다</td></tr>';
    return;
  }
  body.innerHTML = list.map(s => makeSessionRow(s, getSelectedSession() === s.id)).join('');
}

export function renderProjects(list) {
  _allProjects = list;
  renderBrowserProjects();
}

// renderTools (4컬럼 툴 통계 테이블 렌더러)는
// left-panel-observability-revamp ADR-001에 따라 obs-panel.js의 위젯 5종으로 대체되어
// 제거되었습니다. 정밀 통계는 detail view ts-mx (tool-stats.js) 단일 진실 소스를 사용하세요.

export function showSkeletonSessions() {
  document.getElementById('browserSessionsBody').innerHTML = makeSkeletonRows(4, 2);
}
