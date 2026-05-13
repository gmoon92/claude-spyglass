// Detail Tools View — 단일 매트릭스 뷰 (ADR-007)
// 1행 1도구, 6컬럼 (Tool/Avg/Calls/Tokens/%/Err) + 정렬 토글
//
// ADR-004 meta-docs-tool-stats:
//   - 세션 단위 (loadToolStats / #detailToolsView) ↔ 프로젝트 단위 (loadProjectToolStats / #metaToolStatsBody)
//     두 스코프가 같은 renderMatrix를 공유하여 시각 일관성 보장. 호출 측은 raw data만 전달.
//   - 세션 도구 탭 우상단 outbound 링크(.ts-mx-outbound) — 클릭 시 메타 모드 + 도구 통계 탭으로 위임.
//   - 정렬 상태(_sortKey)는 모듈 전역으로 보관 — 사용자 컨텍스트(선호 정렬)를 두 스코프에서 공유.

import { fmtToken, escHtml } from './formatters.js';
import { toolIconHtml } from './renderers.js';
import { skToolMatrix } from './render/skeleton.js';

export const API = '';

// ── 세션 스코프(기존) ──
let _container = null;             // 세션 detail 컨테이너 (#detailToolsView)
let _stats     = [];               // 세션 detail 매트릭스 데이터
let _currentSessionId = null;
let _currentSessionProjectName = null; // 현재 세션의 project_name (outbound 링크용)

// ── 프로젝트 스코프(ADR-004 신규) ──
let _projectContainer    = null;   // #metaToolStatsBody (lazy 조회)
let _projectStats        = [];
let _currentProjectName  = null;

// ── 공통 정렬 상태 ──
let _sortKey   = 'tokens';         // 'avg' | 'calls' | 'tokens' (기본: 토큰 기여도)

export function initToolStats() {
  _container = document.getElementById('detailToolsView');
}

/**
 * 세션 범위 도구 통계 로드. 세션 detail의 [도구] 탭 진입 시 호출.
 *
 * @param {string} sessionId
 * @param {string|null} [projectName=null] outbound 링크에 사용. 현재 세션의 project_name.
 *   누락 시 outbound 링크 비노출(방어).
 */
export async function loadToolStats(sessionId, projectName = null) {
  if (!_container) return;
  _currentSessionId = sessionId;
  _currentSessionProjectName = projectName || null;
  // skeleton-loading T-12: 매트릭스 헤더 + 6 row 흉내. renderMatrix 호출 시 innerHTML 교체.
  _container.innerHTML = skToolMatrix(6);
  try {
    const res  = await fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/tool-stats`);
    const json = await res.json();
    _stats = json.data || [];
    renderMatrix(_container, _stats, 'session');
  } catch {
    _container.innerHTML = `
      <div class="state-error">
        <div class="state-error-message">데이터를 불러올 수 없습니다</div>
        <button class="state-error-retry" data-retry-tools>다시 시도</button>
      </div>`;
    _container.querySelector('[data-retry-tools]')?.addEventListener('click', () => loadToolStats(_currentSessionId, _currentSessionProjectName));
  }
}

/**
 * ADR-004 meta-docs-tool-stats: 프로젝트 범위 도구 통계 로드.
 *
 *  메타 모드의 [도구 통계] 서브 탭 진입 또는 좌측 프로젝트 변경 시 호출.
 *  `#metaToolStatsBody`에 skeleton → 매트릭스 → empty/error 상태 렌더.
 *  세션 detail의 loadToolStats와 동일 renderMatrix를 공유하여 시각 일관성을 보장한다.
 *
 *  프로젝트명이 null이면 "프로젝트를 선택하세요" 빈 상태를 표시한다.
 *
 * @param {string|null} projectName
 */
export async function loadProjectToolStats(projectName) {
  if (!_projectContainer) _projectContainer = document.getElementById('metaToolStatsBody');
  if (!_projectContainer) return;
  _currentProjectName = projectName || null;

  if (!_currentProjectName) {
    _projectContainer.innerHTML = `
      <div class="state-empty">
        <span class="state-empty-title">프로젝트를 선택하세요</span>
        <span class="state-empty-hint">좌측 패널에서 프로젝트를 선택하면 도구별 성능 매트릭스가 표시됩니다.</span>
      </div>`;
    _projectStats = [];
    return;
  }

  _projectContainer.innerHTML = skToolMatrix(6);
  try {
    const res  = await fetch(`${API}/api/projects/${encodeURIComponent(_currentProjectName)}/tool-stats`);
    const json = await res.json();
    _projectStats = json.data || [];
    renderMatrix(_projectContainer, _projectStats, 'project');
  } catch {
    _projectContainer.innerHTML = `
      <div class="state-error">
        <div class="state-error-message">데이터를 불러올 수 없습니다</div>
        <button class="state-error-retry" data-retry-project-tools>다시 시도</button>
      </div>`;
    _projectContainer.querySelector('[data-retry-project-tools]')?.addEventListener('click', () => loadProjectToolStats(_currentProjectName));
  }
}

export function clearToolStats() {
  if (_container) _container.innerHTML = '';
  _stats = [];
}

/** ADR-004: 프로젝트 도구 통계 컨테이너 초기화 — 메타 모드 이탈 시 호출 가능. 현재 미사용. */
export function clearProjectToolStats() {
  if (_projectContainer) _projectContainer.innerHTML = '';
  _projectStats = [];
  _currentProjectName = null;
}

function fmtDur(ms) {
  if (!ms || ms === 0) return '—';
  if (ms < 1000)   return `${Math.round(ms)}ms`;
  if (ms < 60000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * 정렬 토글. scope에 따라 활성 데이터 셋을 재렌더한다.
 * 두 스코프가 _sortKey를 공유 — 한 곳에서 정렬을 바꾸면 다음 진입 시 같은 기준 유지.
 */
function setSort(key, scope) {
  _sortKey = key;
  if (scope === 'project' && _projectContainer) {
    renderMatrix(_projectContainer, _projectStats, 'project');
  } else if (_container) {
    renderMatrix(_container, _stats, 'session');
  }
}

/**
 * 도구별 성능 매트릭스 SSoT 렌더러.
 *
 * @param {HTMLElement} container — 마운트 대상 (#detailToolsView 또는 #metaToolStatsBody)
 * @param {Array} stats — `SessionToolStats[]` (세션) 또는 `getProjectToolStats` 결과(프로젝트)
 * @param {'session'|'project'} scope — outbound 링크 노출 여부 + 정렬 버튼 dispatch scope
 *
 *  scope='session' + _currentSessionProjectName 가 있으면 우상단 outbound 링크 노출.
 *  scope='project'면 outbound 링크 비노출(이미 프로젝트 view 안).
 */
function renderMatrix(container, stats, scope) {
  if (!container) return;
  if (!stats || !stats.length) {
    container.innerHTML = '<div class="state-empty"><span class="state-empty-title">데이터가 없습니다</span></div>';
    return;
  }

  const sortFns = {
    avg:    (a, b) => (b.avg_duration_ms || 0) - (a.avg_duration_ms || 0),
    calls:  (a, b) => (b.call_count || 0) - (a.call_count || 0),
    tokens: (a, b) => (b.pct_of_total_tokens || 0) - (a.pct_of_total_tokens || 0),
  };
  const sorted = [...stats].sort(sortFns[_sortKey] || sortFns.tokens);

  const maxCalls = Math.max(...stats.map(s => s.call_count || 0), 1);
  // data-honesty-ui (ADR-003): duration 0 행은 max 산정에서 제외 (왜곡 방지)
  const maxDur   = Math.max(...stats.map(s => s.avg_duration_ms || 0).filter(v => v > 0), 1);

  const rows = sorted.map(s => {
    // SSoT: renderers.toolIconHtml 재사용 (Agent/Skill/Task → ◎ orange, 그 외 → ◉ green)
    const icon = toolIconHtml(s.tool_name);
    const callPct = Math.round((s.call_count || 0) / maxCalls * 100);
    const durMs   = s.avg_duration_ms || 0;
    const durPct  = Math.round(durMs / maxDur * 100);
    const tokPct  = s.pct_of_total_tokens || 0;

    // data-honesty-ui (ADR-003): duration 0 → '—' + title 툴팁 (행 단위 data 속성)
    const durUnavailable = !durMs;
    const durAttr = durUnavailable ? ' data-duration-unavailable="true" title="duration unavailable for older data"' : '';
    const durBarPct = durUnavailable ? 0 : durPct;

    // data-honesty-ui (ADR-002): tokens_confidence 비-high → '*' 마크 + title 툴팁
    const errCount = s.confidence_error_count || 0;
    const lowCount = s.confidence_low_count || 0;
    const hasLowConf = !!s.has_low_confidence || (errCount + lowCount) > 0;
    const confTip = errCount > 0
      ? '토큰 신뢰도 오류 (수집 실패)'
      : '토큰 신뢰도 낮음 (transcript 파싱 실패 또는 proxy fallback)';
    const confMark = hasLowConf
      ? `<sup class="confidence-low-mark" title="${escHtml(confTip)}">*</sup>`
      : '';

    // error 컬럼: SQL의 error_count는 이미 confidence_error_count도 합산함 (T-02 보강).
    const errBadge = s.error_count > 0
      ? `<span class="ts-err-cell"><span class="mini-badge badge-error">${s.error_count}</span></span>`
      : `<span class="ts-err-cell ts-err-cell--none">—</span>`;

    return `<div class="ts-mx-row">
      <div class="ts-mx-cell ts-mx-tool">
        ${icon}<span class="ts-mx-tool-name" title="${escHtml(s.tool_name)}">${escHtml(s.tool_name)}${confMark}</span>
      </div>
      <div class="ts-mx-cell ts-mx-num"${durAttr}>
        <span class="ts-mx-val">${fmtDur(durMs)}</span>
        <span class="ts-mx-bar"><span class="ts-mx-bar-fill ts-mx-bar-fill--avg" style="width:${durBarPct}%"></span></span>
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

  // ADR-004: 세션 스코프이고 현재 세션의 project_name이 있으면 우상단 outbound 링크 노출.
  // 프로젝트 스코프면 자기 자신이라 비노출.
  const outboundHtml = (scope === 'session' && _currentSessionProjectName)
    ? `<a class="ts-mx-outbound"
         data-outbound-project="${escHtml(_currentSessionProjectName)}"
         role="button" tabindex="0"
         title="이 프로젝트의 모든 세션을 합산한 도구 통계로 이동">↗ 프로젝트 전체로 보기</a>`
    : '';

  container.innerHTML = `
    <div class="ts-mx">
      <div class="ts-mx-toolbar">
        <span class="ts-mx-title">도구별 통계</span>
        <div class="ts-mx-sort">
          <span class="ts-mx-sort-label">정렬</span>
          <button class="ts-mx-sort-btn ${_sortKey === 'avg'    ? 'active' : ''}" data-sort="avg">응답시간</button>
          <button class="ts-mx-sort-btn ${_sortKey === 'calls'  ? 'active' : ''}" data-sort="calls">호출 횟수</button>
          <button class="ts-mx-sort-btn ${_sortKey === 'tokens' ? 'active' : ''}" data-sort="tokens">토큰 기여도</button>
        </div>
        ${outboundHtml}
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

  // 정렬 버튼 이벤트 — scope를 클로저로 캡처하여 올바른 데이터 셋을 재렌더.
  container.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => setSort(btn.dataset.sort, scope));
  });
}
