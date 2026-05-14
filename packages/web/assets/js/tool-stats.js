// Project Tool Stats — 프로젝트 단위 도구별 성능 매트릭스 (ADR-007 + ADR-004)
//
// 책임:
//   - 메타 모드의 [도구 통계] 서브 탭에 마운트되는 단일 매트릭스 뷰.
//   - 1행 1도구, 6컬럼 (Tool/Avg/Calls/Tokens/%/Err).
//   - 정렬은 헤더 컬럼 클릭으로 토글(Behavior Definitions·syslib 테이블과 동일 패턴).
//   - 컨테이너: #metaToolStatsBody — meta-docs-view.js 가 가시성/aria/진입 시점을 관리.
//
// 호출 진입:
//   - loadProjectToolStats(projectName)  — 메타 모드 [도구 통계] 탭 진입 / 좌측 프로젝트 변경 시.
//   - clearProjectToolStats()            — 메타 모드 이탈 시 호출 가능. 현재 미사용.
//
// 정리 이력:
//  - ADR-004 후속: 세션 detail [도구] 탭이 메타 모드 [도구 통계]와 중복이라 제거됨.
//    이전에 공존하던 세션 스코프 진입(loadToolStats / clearToolStats / outbound 링크)도 모두 정리됨.
//    renderMatrix는 더 이상 scope 분기를 받지 않는다 — 프로젝트 단위 매트릭스 SSoT.
//  - sort-toolbar-cleanup: 상단 "도구별 통계" 라벨이 서브탭 헤더("도구 통계")와 중복이라 제거.
//    상단 정렬 버튼 그룹도 함께 제거하고, 헤더 셀 클릭으로 정렬을 토글한다.
//    SSoT는 SORTABLE_KEYS / DEFAULT_DIR / COMPARATORS 세 상수 — Behavior Definitions 패턴과 동형.
//
// 정렬 상태(_sortKey/_sortDir)는 모듈 전역으로 보관 — 탭 재진입 시 사용자 선호 유지.

import { fmtToken, escHtml } from './formatters.js';
import { toolIconHtml } from './renderers.js';
import { skToolMatrix } from './render/skeleton.js';
import { renderSortHead } from './design-system/markers/sort-head.js';
import { renderBadge } from './design-system/badges/badge.js';

export const API = '';

// ── 프로젝트 스코프 상태 ──
let _projectContainer    = null;   // #metaToolStatsBody (lazy 조회)
let _projectStats        = [];     // 마지막 fetch 결과 (정렬 변경 시 재렌더에 재사용)
let _currentProjectName  = null;   // 마지막으로 fetch한 프로젝트명 (retry 버튼용)

// ── 정렬 상태 ──
//   'tool'   : tool_name 문자열   (asc 기본)
//   'avg'    : avg_duration_ms     (desc 기본)
//   'calls'  : call_count          (desc 기본)
//   'tokens' : total_tokens        (desc 기본)  — "토큰" 컬럼
//   'pct'    : pct_of_total_tokens (desc 기본)  — "기여도" 컬럼 (시각만 다른 같은 데이터)
//   'errors' : error_count         (desc 기본)
const SORTABLE_KEYS = new Set(['tool', 'avg', 'calls', 'tokens', 'pct', 'errors']);
const DEFAULT_DIR = {
  tool:   'asc',
  avg:    'desc',
  calls:  'desc',
  tokens: 'desc',
  pct:    'desc',
  errors: 'desc',
};

let _sortKey = 'tokens';
let _sortDir = 'desc';

/**
 * 프로젝트 범위 도구 통계 로드.
 *  메타 모드의 [도구 통계] 서브 탭 진입 또는 좌측 프로젝트 변경 시 호출.
 *  `#metaToolStatsBody`에 skeleton → 매트릭스 → empty/error 상태 렌더.
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
    renderMatrix(_projectContainer, _projectStats);
  } catch {
    _projectContainer.innerHTML = `
      <div class="state-error">
        <div class="state-error-message">데이터를 불러올 수 없습니다</div>
        <button class="state-error-retry" data-retry-project-tools>다시 시도</button>
      </div>`;
    _projectContainer.querySelector('[data-retry-project-tools]')?.addEventListener('click', () => loadProjectToolStats(_currentProjectName));
  }
}

/** 프로젝트 도구 통계 컨테이너 초기화 — 메타 모드 이탈 시 호출 가능. 현재 미사용. */
export function clearProjectToolStats() {
  if (_projectContainer) _projectContainer.innerHTML = '';
  _projectStats = [];
  _currentProjectName = null;
}

/** 응답시간 포맷터 — 단일 책임. 0/누락은 '—' 처리해 max 산정 왜곡을 호출 측에서 막는다. */
function fmtDur(ms) {
  if (!ms || ms === 0) return '—';
  if (ms < 1000)   return `${Math.round(ms)}ms`;
  if (ms < 60000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * 정렬 토글 — 같은 키 재클릭이면 방향 토글, 다른 키 클릭이면 컬럼 기본 방향 진입.
 * Behavior Definitions 테이블의 applyFilterChange 'sort' 분기와 동일 규칙.
 */
function applySortChange(key) {
  if (!SORTABLE_KEYS.has(key)) return;
  if (_sortKey === key) {
    _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _sortKey = key;
    _sortDir = DEFAULT_DIR[key] ?? 'desc';
  }
  if (_projectContainer) renderMatrix(_projectContainer, _projectStats);
}

// 한국어 collator — tool name은 영문이 주류이나 안전하게 통일.
const koCollator = (typeof Intl !== 'undefined' && Intl.Collator)
  ? new Intl.Collator('ko', { sensitivity: 'base', numeric: true })
  : null;
function cmpString(a, b) {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  return koCollator ? koCollator.compare(sa, sb) : sa.localeCompare(sb);
}
function cmpNumber(a, b) {
  return (a ?? 0) - (b ?? 0);
}

const COMPARATORS = {
  tool:   (a, b) => cmpString(a.tool_name, b.tool_name),
  avg:    (a, b) => cmpNumber(a.avg_duration_ms, b.avg_duration_ms),
  calls:  (a, b) => cmpNumber(a.call_count, b.call_count),
  tokens: (a, b) => cmpNumber(a.total_tokens, b.total_tokens),
  pct:    (a, b) => cmpNumber(a.pct_of_total_tokens, b.pct_of_total_tokens),
  errors: (a, b) => cmpNumber(a.error_count, b.error_count),
};

function applySort(rows, key, dir = 'desc') {
  const cmp = COMPARATORS[key] ?? COMPARATORS.tokens;
  const factor = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => factor * cmp(a, b));
}

/**
 * 헤더 active 클래스
 * @deprecated Wave 2 이후 renderSortHead 통합으로 대체 예정. 다른 wave 호출처가 있을 수 있으므로 유지.
 */
function sortHeaderCls(key) {
  if (_sortKey !== key) return '';
  return _sortDir === 'asc' ? 'sort-asc' : 'sort-desc';
}
/**
 * 헤더 ↓/↑ 표기자
 * @deprecated Wave 2 이후 renderSortHead 통합으로 대체 예정. 다른 wave 호출처가 있을 수 있으므로 유지.
 */
function sortIndicator(key) {
  if (_sortKey !== key) return '<span class="sort-arrow sort-arrow-idle">↕</span>';
  return _sortDir === 'asc'
    ? '<span class="sort-arrow">↑</span>'
    : '<span class="sort-arrow">↓</span>';
}
/**
 * 헤더 aria-sort 속성 값 — WAI-ARIA 표준
 * @deprecated Wave 2 이후 renderSortHead 통합으로 대체 예정. 다른 wave 호출처가 있을 수 있으므로 유지.
 */
function ariaSortValue(key) {
  if (_sortKey !== key) return 'none';
  return _sortDir === 'asc' ? 'ascending' : 'descending';
}

/**
 * 헤더 셀 한 개 빌더 — 클래스/속성 공통화.
 * Wave 2 치환: 내부에서 renderSortHead를 사용해 ds-sort-head 컴포넌트를 포함한다.
 * 외부 <div data-ts-sort> 래퍼와 sortable/sort-asc/sort-desc 클래스는 기존 클릭 바인딩·CSS와
 * 시각 호환을 위해 보존 (이중 클래스 패턴 — 시각 변화 0).
 */
function headerCellHtml(key, label, extraCls = '') {
  const sortState = _sortKey !== key ? 'idle' : (_sortDir === 'asc' ? 'asc' : 'desc');
  const cls = `ts-mx-cell ${extraCls} sortable ${sortHeaderCls(key)}`.trim();
  return `<div data-ts-sort="${key}"
               class="${cls}"
               tabindex="0"
               role="columnheader"
               aria-sort="${ariaSortValue(key)}">${renderSortHead({ label, sort: sortState, key })}</div>`;
}

/**
 * 도구별 성능 매트릭스 렌더러 (프로젝트 단위 SSoT).
 *
 * @param {HTMLElement} container — 마운트 대상 (#metaToolStatsBody)
 * @param {Array} stats — `getProjectToolStats` 결과
 */
function renderMatrix(container, stats) {
  if (!container) return;
  if (!stats || !stats.length) {
    container.innerHTML = '<div class="state-empty"><span class="state-empty-title">데이터가 없습니다</span></div>';
    return;
  }

  const sorted = applySort(stats, _sortKey, _sortDir);

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
    // Wave 2 치환: mini-badge/badge-error 클래스는 보존 + ds-badge data-tone="error" 추가 (이중 클래스).
    // renderBadge import 보관 — 다음 wave에서 완전 교체 시 직접 호출로 전환.
    const errBadge = s.error_count > 0
      ? `<span class="ts-err-cell"><span class="mini-badge badge-error ds-badge" data-tone="error">${s.error_count}</span></span>`
      : `<span class="ts-err-cell ts-err-cell--none">—</span>`;

    return `<div class="ts-mx-row">
      <div class="ts-mx-cell ts-mx-tool">
        ${icon}<span class="ts-mx-tool-name" title="${escHtml(s.tool_name)}">${escHtml(s.tool_name)}${confMark}</span>
      </div>
      <div class="ts-mx-cell ts-mx-num"${durAttr}>
        <span class="ts-mx-val">${fmtDur(durMs)}</span>
        <span class="ts-mx-bar ds-bar-track"><span class="ts-mx-bar-fill ts-mx-bar-fill--avg ds-bar-fill" data-tone="warn" style="width:${durBarPct}%"></span></span>
      </div>
      <div class="ts-mx-cell ts-mx-num">
        <span class="ts-mx-val">${s.call_count || 0}</span>
        <span class="ts-mx-bar ds-bar-track"><span class="ts-mx-bar-fill ts-mx-bar-fill--calls ds-bar-fill" data-tone="success" style="width:${callPct}%"></span></span>
      </div>
      <div class="ts-mx-cell ts-mx-num">
        <span class="ts-mx-val">${fmtToken(s.total_tokens)}</span>
        <span class="ts-mx-sub">${tokPct.toFixed(1)}%</span>
      </div>
      <div class="ts-mx-cell ts-mx-num">
        <span class="ts-mx-bar ds-bar-track"><span class="ts-mx-bar-fill ts-mx-bar-fill--tokens ds-bar-fill" data-tone="brand" style="width:${Math.min(tokPct, 100)}%"></span></span>
      </div>
      <div class="ts-mx-cell ts-mx-err">${errBadge}</div>
    </div>`;
  }).join('');

  // sort-toolbar-cleanup: 상단 "도구별 통계" 라벨 + 정렬 버튼 그룹 제거.
  // 정렬은 헤더 셀 클릭(또는 Enter/Space)으로 토글된다.
  container.innerHTML = `
    <div class="ts-mx">
      <div class="ts-mx-head">
        ${headerCellHtml('tool',   'Tool',     'ts-mx-tool')}
        ${headerCellHtml('avg',    '평균 응답', 'ts-mx-num')}
        ${headerCellHtml('calls',  '호출',     'ts-mx-num')}
        ${headerCellHtml('tokens', '토큰',     'ts-mx-num')}
        ${headerCellHtml('pct',    '기여도',   'ts-mx-num')}
        ${headerCellHtml('errors', '오류',     'ts-mx-err')}
      </div>
      <div class="ts-mx-body">${rows}</div>
    </div>`;

  bindHeaderEvents(container);
}

/**
 * 헤더 셀 click / keydown(Enter, Space) → 정렬 토글.
 * 컨테이너는 매 renderMatrix마다 innerHTML로 새로 그려지므로 datasetFlag로 중복 부착 방지.
 */
function bindHeaderEvents(container) {
  if (container.dataset.tsBound === '1') return;
  container.dataset.tsBound = '1';
  container.addEventListener('click', (e) => {
    const head = e.target.closest('[data-ts-sort]');
    if (!head) return;
    applySortChange(head.dataset.tsSort);
  });
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const head = e.target.closest('[data-ts-sort]');
    if (!head) return;
    e.preventDefault();
    applySortChange(head.dataset.tsSort);
  });
}
