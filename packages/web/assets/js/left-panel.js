// 좌측 패널 모듈 — 프로젝트/세션 렌더링
// (툴 통계는 left-panel-observability-revamp ADR-001로 obs-panel.js 위젯으로 이동.
//  detail view 도구 매트릭스는 ts-mx 가 단일 진실 소스.)
import { fmt, fmtToken, escHtml } from './formatters.js';
import { makeSessionRow, skSessionRows } from './renderers.js';
import { getSelectedProject, getSelectedSession, getAppMode } from './state.js';

let _allProjects     = [];
let _allSessions     = [];
// meta-docs feedback ADR (2026-05-14): 메타 모드에서 프로젝트별 항목 수를 좌측 패널에
// 표시하기 위한 카운트 스토어. meta-docs-view.js가 카탈로그 fetch 후 setMetaDocsCounts로 채운다.
// 키 규칙: projects[project_name] = N, global/total은 별도 필드. 시작 시 빈 객체.
let _metaCounts      = { projects: Object.create(null), global: 0, total: 0 };

/** 가상 '전체 (user global)' 행을 가리키는 식별자. metadocs 모드 전용. */
export const GLOBAL_PROJECT_KEY = '__global__';

export function getAllSessions()  { return _allSessions; }
export function setAllSessions(list) { _allSessions = list; }
export function getAllProjects()  { return _allProjects; }

/**
 * anomaly-bloated-sys T-13: 사이드바 critical dot 보강.
 *  - /api/sessions 목록 응답에는 bloated_sys 필드가 없다(서버 SSoT는 단건 /api/sessions/:id).
 *  - detail-view.js의 단건 fetch가 끝나면 `session-anomalies-loaded` 이벤트를 받아
 *    해당 세션 객체에 bloated_sys를 주입하고 사이드바를 재렌더한다.
 *  - 이벤트 detail: { sessionId, bloatedSys }
 *  - SessionEnd 누락 stale dot과 충돌 회피: bloated_sys--dot은 별도 위치(`makeSessionRow`에서
 *    sess-row-status 뒤에 부착)이므로 두 dot이 시각적으로 공존.
 *
 * 등록 위치: 모듈 부수효과 — 앱 라이프사이클 동안 유지.
 */
document.addEventListener('session-anomalies-loaded', (e) => {
  const { sessionId, bloatedSys } = e.detail || {};
  if (!sessionId) return;
  const target = _allSessions.find(s => s.id === sessionId);
  if (!target) return;
  // critical만 사이드바 dot 노출 (ADR-005), 그 외 단계는 미노출. null도 같이 캐시해
  // 응답 변동 시 stale dot이 잘못 남는 것을 막는다.
  target.bloated_sys = bloatedSys || null;
  // 선택한 프로젝트의 사이드바만 다시 그린다 — 무관한 프로젝트면 영향 없음.
  if (getSelectedProject() && target.project_name === getSelectedProject()) {
    renderBrowserSessions();
  }
});

/**
 * meta-docs-view.js에서 카탈로그 fetch 직후 호출 — 프로젝트별/글로벌 항목 수를 주입.
 * 호출 후 metadocs 모드일 때만 즉시 재렌더(browse 모드 영향 없음).
 *
 * @param {{ projects?: Record<string, number>, global?: number, total?: number }} counts
 */
export function setMetaDocsCounts(counts) {
  const safe = counts && typeof counts === 'object' ? counts : {};
  _metaCounts = {
    projects: safe.projects && typeof safe.projects === 'object' ? safe.projects : Object.create(null),
    global:   Number.isFinite(safe.global) ? safe.global : 0,
    total:    Number.isFinite(safe.total)  ? safe.total  : 0,
  };
  if (getAppMode() === 'metadocs') renderBrowserProjects();
}

export function renderBrowserProjects() {
  const body = document.getElementById('browserProjectsBody');
  if (!body) return;
  const isMetaMode = getAppMode() === 'metadocs';
  const t = window.I18n?.t ?? ((k) => k);

  if (!_allProjects.length && !isMetaMode) {
    body.innerHTML = `<tr><td colspan="3" class="table-empty">${t('ui.left-panel.no-data')}</td></tr>`;
    return;
  }

  const rows = [];
  // metadocs 모드: 최상단 가상 'user (global)' 행 (scopeMode='all' 진입점)
  if (isMetaMode) rows.push(renderMetaGlobalRow());

  const maxT = Math.max(..._allProjects.map(p => p.total_tokens || 0), 1);
  for (const p of _allProjects) {
    rows.push(isMetaMode ? renderMetaProjectRow(p) : renderBrowseProjectRow(p, maxT));
  }
  body.innerHTML = rows.join('');
}

/**
 * browse 모드 프로젝트 행 — [프로젝트 | 활성 세션 | 토큰 바].
 *  - 세션 컬럼은 활성 세션 수만 노출.
 *  - active가 0이면 dash.
 */
function renderBrowseProjectRow(p, maxT) {
  const isSelected = getSelectedProject() === p.project_name;
  const pct        = Math.max(1, Math.round((p.total_tokens || 0) / maxT * 100));
  const active = p.active_count ?? 0;
  const sessCls = active > 0 ? ' proj-active' : '';
  const t = window.I18n?.t ?? ((k) => k);
  const sessTitle = t('ui.left-panel.live-count', { count: active });
  const sessCellHtml = active === 0
    ? '—'
    : `<span class="proj-sess-active">${fmt(active)}</span>`;
  return `<tr class="clickable${isSelected ? ' row-selected' : ''}" data-project="${escHtml(p.project_name)}">
    <td class="cell-proj-name" title="${escHtml(p.project_name || '')}">${escHtml(p.project_name || '—')}</td>
    <td class="num cell-proj-sess${sessCls}" style="text-align:right" title="${sessTitle}">${sessCellHtml}</td>
    <td>
      <div class="bar-cell" style="justify-content:flex-end;gap:4px">
        <div class="bar-track" style="min-width:36px"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="bar-label num-hi" style="min-width:30px">${fmtToken(p.total_tokens)}</span>
      </div>
    </td>
  </tr>`;
}

/**
 * metadocs 모드 프로젝트 행 — [프로젝트 | 항목 수 | (빈 셀)].
 *  - 항목 수는 setMetaDocsCounts로 주입된 _metaCounts.projects에서 조회. 미주입 시 0.
 *  - 클릭 시 main.js selectProject가 scopeMode='selected'로 전환하여 해당 프로젝트만 표시.
 *  - 동기화 버튼은 thead 셀에 단독 배치되므로 행 우측 셀은 비워둔다(컬럼 폭은 colgroup 공유).
 */
function renderMetaProjectRow(p) {
  const isSelected = getSelectedProject() === p.project_name;
  const count = _metaCounts.projects?.[p.project_name] ?? 0;
  return `<tr class="clickable${isSelected ? ' row-selected' : ''}" data-project="${escHtml(p.project_name)}">
    <td class="cell-proj-name" title="${escHtml(p.project_name || '')}">${escHtml(p.project_name || '—')}</td>
    <td class="num cell-proj-meta-count" style="text-align:right">${fmt(count)}</td>
    <td class="cell-proj-meta-spacer"></td>
  </tr>`;
}

/**
 * 가상 'user (global)' 행 — metadocs 모드 전용 최상단 행.
 *  - data-project="__global__" (GLOBAL_PROJECT_KEY) — main.js selectProject가 분기.
 *  - 클릭 시 meta-docs-view.js의 scopeMode를 'all'로 전환하고 전체 카탈로그를 표시.
 *  - 선택 표시는 getSelectedProject()가 GLOBAL_PROJECT_KEY와 일치할 때 활성.
 */
function renderMetaGlobalRow() {
  const isSelected = getSelectedProject() === GLOBAL_PROJECT_KEY;
  const total = _metaCounts.total ?? 0;
  const t = window.I18n?.t ?? ((k) => k);
  return `<tr class="clickable cell-proj-global${isSelected ? ' row-selected' : ''}" data-project="${GLOBAL_PROJECT_KEY}"
              title="${t('ui.left-panel.global-row-title')}">
    <td class="cell-proj-name"><span class="cell-proj-global-tag">global</span></td>
    <td class="num cell-proj-meta-count" style="text-align:right">${fmt(total)}</td>
    <td class="cell-proj-meta-spacer"></td>
  </tr>`;
}

export function renderBrowserSessions() {
  const body = document.getElementById('browserSessionsBody');
  const hint = document.getElementById('sessionPaneHint');
  const t = window.I18n?.t ?? ((k) => k);
  if (!getSelectedProject()) {
    body.innerHTML = '<tr><td colspan="4" class="table-empty">—</td></tr>';
    hint.textContent = t('ui.left-panel.select-project');
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
  hint.textContent = t('ui.left-panel.session-count', { project: getSelectedProject(), count: list.length });
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="4" class="table-empty">${t('ui.left-panel.no-data')}</td></tr>`;
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
  // skeleton-loading T-13: 세션 행 4 컬럼 구조(상태 dot + 이름 + 활성 표시 + 토큰) 흉내.
  // 4 row 로 평균 세션 리스트 높이를 유지 → 프로젝트 클릭 후 fetch 동안 CLS 0.
  document.getElementById('browserSessionsBody').innerHTML = skSessionRows(4);
}
