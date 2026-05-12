/**
 * meta-docs-view.js — 메타 문서 카탈로그 + 히팅률 패널 (v25, meta-docs-enhance)
 *
 * 책임:
 *  - GET /api/meta-docs 로 카탈로그 + 사용 집계 받아 표 형태로 노출.
 *  - 타입 필터(agent/skill/command/all), 스코프, 표시(전체/미사용/orphan), 정렬.
 *  - 직교 토글: includeDeleted — 디스크에서 사라진 soft-deleted 정의 포함 여부.
 *    의미 축이 다르므로 display 라디오와 분리한다 (ADR-001 meta-docs-filter).
 *  - 헤더 클릭 정렬 ↔ 상단 정렬 버튼 양방향 동기화 (단일 분기).
 *  - "호출 0건" 행은 정리 후보로 시각 구분, "카탈로그에 없는 호출"(orphan)은 호버 안내.
 *  - "동기화" 버튼: POST /api/meta-docs/refresh — 비차단 토스트로 시작/완료/실패 단계 노출.
 *
 * 호출자: session-detail/turn-views.js setDetailView('metadocs')
 *
 * 의존성: formatters.js (escHtml, fmtTime), 기본 fetch.
 *
 * 캡슐화 원칙(CLAUDE.md):
 *  - 정렬/필터 판단 로직은 각자의 함수 한 곳에서만 처리. 호출 측은 raw 인자만 전달.
 *  - 렌더 함수는 escHtml/fmtTime/shortenPath/formatTokens 기존 헬퍼를 우선 재사용.
 */

import { escHtml, fmtTime } from './formatters.js';
import { getSelectedProject } from './state.js';
import { toolIconHtml } from './render/badges.js';
import { skMetaDocList } from './render/skeleton.js';
import { initColResize } from './col-resize.js';

const CONTAINER_ID = 'metaDocsBody';

// 필터/정렬 상태 — 모듈 단위로 보관 (탭 재진입 시 유지)
const state = {
  type:    'all',          // 'all' | 'agent' | 'skill' | 'command'
  sort:    'invocations',  // 'invocations' | 'last_used_at' | 'name'
  sortDir: 'desc',         // 'asc' | 'desc'
  scope:   'all',          // 'all' | 'project' | 'global' (legacy source 라벨 기준 필터)
  scopeMode: 'selected',   // 'selected' | 'all'
                           //   'selected' = 좌측 프로젝트 선택값을 따라 source_root로 필터
                           //   'all'      = 모든 프로젝트 카탈로그 합쳐서 표시
  display: 'all',          // 'all' | 'unused' | 'orphan' — 행 부분집합 선택 (단일 책임)
  includeDeleted: false,   // boolean — soft-deleted(디스크 사라진) 정의 포함 여부.
                           //   display와 직교(orthogonal). ADR-001 meta-docs-filter.
  // 마지막 동기화 결과 메타 (다음 렌더에서 합계 라벨에 노출)
  lastRefresh: null,       // { cwdsCount, summaryText } | null
  // 마지막으로 결정된 source_root 매칭 결과 (헤더 표시 + 빈 상태 처리)
  resolvedSource: null,    // { project, sourceRoot, matched } | null
};

/** 탭 진입 시 호출 — fetch + 렌더. */
export async function loadMetaDocsLibrary() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  // skeleton-loading T-09: 카탈로그 row 8개로 구조 유지. fetch 응답 후 정상 테이블로 교체.
  container.innerHTML = skMetaDocList(8);

  try {
    // 1) 선택 프로젝트 결정 — scopeMode + 좌측 패널 selectedProject 결합
    const project = state.scopeMode === 'selected' ? (getSelectedProject() || null) : null;

    // 2) 프로젝트 모드: 전체 카탈로그를 한번 받아 distinct source_root에서 basename 매칭
    let resolvedSourceRoot = null;
    let matched = false;

    if (project) {
      const probe = await fetchJson('/api/meta-docs');
      const probeList = Array.isArray(probe?.data) ? probe.data : [];
      resolvedSourceRoot = findSourceRootByProject(probeList, project);
      matched = !!resolvedSourceRoot;
    }
    state.resolvedSource = project ? { project, sourceRoot: resolvedSourceRoot, matched } : null;

    // 3) 본 fetch — 매칭된 source_root가 있으면 ?source_root= 부착, 아니면 전체
    const params = new URLSearchParams();
    if (state.type !== 'all') params.set('type', state.type);
    if (state.includeDeleted) params.set('includeDeleted', '1');
    if (resolvedSourceRoot) params.set('source_root', resolvedSourceRoot);
    const qs = params.toString();
    const url = '/api/meta-docs' + (qs ? `?${qs}` : '');

    let list = [];
    // 매칭 실패한 프로젝트 모드는 fetch 자체를 생략 — 빈 상태 분기로 진입
    if (!project || matched) {
      const res = await fetchJson(url);
      list = Array.isArray(res?.data) ? res.data : [];
    }

    // 4) 프로젝트 모드에서는 orphan(id null) 자동 숨김 — source_root 정보가 없어 어떤
    //    프로젝트 호출인지 단정 불가하기 때문.
    let scoped = applyScopeFilter(list, state.scope);
    if (project && matched) scoped = scoped.filter(r => r.id != null);

    const filtered = applyDisplayFilter(scoped, state.display);
    const sorted   = applySort(filtered, state.sort, state.sortDir);

    container.innerHTML = renderHtml(sorted, { project, matched, resolvedSourceRoot });
    bindEvents(container);
    ensureToastHost();
    // ADR-001: 기존 initColResize 재사용 — 신규 코드 없이 동일 UX 적용
    initColResize(container.querySelector('.meta-docs-table'));
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
}

/**
 * distinct source_root 중 basename이 project_name과 일치하는 첫 항목 반환.
 * 단일 책임 — 호출 측은 raw rows + project name만 전달.
 */
function findSourceRootByProject(rows, projectName) {
  if (!rows || !projectName) return null;
  const seen = new Set();
  for (const r of rows) {
    const root = r?.source_root;
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const base = String(root).split('/').filter(Boolean).pop();
    if (base === projectName) return root;
  }
  return null;
}

// =============================================================================
// 내부 — 렌더
// =============================================================================

function renderHtml(rows, ctx = {}) {
  const total = rows.length;
  const used   = rows.filter(r => (r.invocations ?? 0) > 0).length;
  const unused = rows.filter(r => r.id != null && (r.invocations ?? 0) === 0).length;
  const orphan = rows.filter(r => r.id == null).length;

  const refreshMeta = state.lastRefresh && state.lastRefresh.cwdsCount
    ? `<span class="sep">·</span><span class="meta-docs-refresh-meta" title="${escHtml(state.lastRefresh.cwdsTitle ?? '')}">cwd <strong>${state.lastRefresh.cwdsCount}</strong>개 동기화</span>`
    : '';

  const scopeHeader = renderScopeHeader(ctx);

  const summary = `
    <div class="meta-docs-summary">
      <span><strong>${total}</strong> 항목</span>
      <span class="sep">·</span>
      <span title="호출이 1회 이상 발생한 메타 문서">사용 <strong>${used}</strong></span>
      <span class="sep">·</span>
      <span title="카탈로그엔 있으나 호출 0건">미사용 <strong>${unused}</strong></span>
      ${orphan ? `<span class="sep">·</span><span title="호출은 있는데 현재 카탈로그에 없음 (외부/삭제된 정의)">기타 <strong>${orphan}</strong></span>` : ''}
      ${refreshMeta}
      <span class="meta-docs-actions">
        <button type="button" data-meta-refresh="1" title="현재 cwd + 글로벌 + 알려진 모든 cwd 재스캔">
          <span class="meta-docs-refresh-icon" aria-hidden="true"></span>
          <span class="meta-docs-refresh-label">동기화</span>
        </button>
      </span>
    </div>
  `;

  const filters = renderFilters();

  // 빈 상태 — 프로젝트 모드에서 매칭 실패한 경우와 일반 빈 카탈로그를 구분 안내
  if (rows.length === 0) {
    const empty = (ctx.project && !ctx.matched)
      ? `<div class="state-empty">
           <span class="state-empty-title">${escHtml(ctx.project)} 프로젝트에 등록된 메타 문서가 없습니다</span>
           <span class="state-empty-hint">이 프로젝트가 SessionStart로 동기화된 적이 없을 수 있습니다. 위 <strong>동기화</strong> 버튼을 누르면 알려진 모든 cwd를 다시 스캔합니다.</span>
         </div>`
      : `<div class="state-empty"><span class="state-empty-title">메타 문서가 없습니다 — SessionStart 이후 자동 동기화됩니다</span></div>`;
    return `${scopeHeader}${summary}${filters}${empty}`;
  }

  const tbody = rows.map(rowHtml).join('');

  // 모든 sortable 컬럼은 동일 패턴으로 — 정의는 SORTABLE_COLUMNS 한 곳에서.
  const th = (key, label, extraCls = '') => {
    const cls = `${extraCls} sortable ${sortHeaderCls(key)}`.trim();
    return `<th data-meta-sort="${key}"
                class="${cls}"
                tabindex="0"
                role="columnheader"
                aria-sort="${ariaSortValue(key)}">${escHtml(label)}${sortIndicator(key)}</th>`;
  };

  return `
    ${scopeHeader}
    ${summary}
    ${filters}
    <div class="meta-docs-table-wrap">
      <table class="meta-docs-table">
        <colgroup>
          <col style="width:80px">
          <col style="width:220px">
          <col style="width:240px">
          <col style="width:80px"><col style="width:130px"><col style="width:90px">
          <col style="width:36px">
        </colgroup>
        <thead><tr>
          ${th('type',         '타입')}
          ${th('name',         '이름')}
          ${th('source',       '출처')}
          ${th('invocations',  '호출수',     'num')}
          ${th('last_used_at', '마지막 사용', 'num')}
          ${th('total_tokens', '토큰합',     'num')}
          <th aria-label="삭제 표시"></th>
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

function rowHtml(r) {
  const orphan = r.id == null;
  const deleted = r.deleted_at != null;
  const unused = !orphan && (r.invocations ?? 0) === 0;
  const cls = [
    orphan  ? 'meta-doc-orphan'  : '',
    deleted ? 'meta-doc-deleted' : '',
    unused  ? 'meta-doc-unused'  : '',
  ].filter(Boolean).join(' ');

  const sourceLabel = orphan
    ? `<span class="meta-doc-source-orphan" title="${escHtml(ORPHAN_TOOLTIP)}" tabindex="0">호출만 존재</span>`
    : sourceCellHtml(r);

  const descClean = cleanDescription(r.description);
  const desc = descClean
    ? `<div class="meta-doc-desc" title="${escHtml(r.description ?? '')}">${escHtml(descClean)}</div>`
    : '';
  const lastUsed = r.last_used_at ? escHtml(fmtTime(r.last_used_at)) : '<span class="meta-doc-na">—</span>';
  const tokens = formatTokens(r.total_tokens ?? 0);

  return `
    <tr class="meta-doc-row ${cls}" data-type="${escHtml(r.type)}" data-name="${escHtml(r.name)}">
      <td>${metaDocTypeBadge(r.type)}</td>
      <td>
        <div class="meta-doc-name">${escHtml(r.name)}</div>
        ${desc}
      </td>
      <td>${sourceLabel}</td>
      <td class="num">${(r.invocations ?? 0).toLocaleString()}</td>
      <td class="num">${lastUsed}</td>
      <td class="num">${tokens}</td>
      <td>${deleted ? '<span title="현재 디스크에서 사라진 정의 (soft-deleted)">⚠</span>' : ''}</td>
    </tr>
  `;
}

/**
 * description 미리보기 정제 — `>` blockquote, `|` 표 셀, 연속 공백/줄바꿈 등
 * markdown 마커를 단일 공백으로 정리해 한 줄 미리보기로 만든다.
 * 원본 description 전체는 tooltip(title 속성)에 그대로 보존.
 */
function cleanDescription(s) {
  if (!s) return '';
  return String(s)
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[>|#]+\s*/, '').trim())
    .filter(line => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 메타 문서 타입 뱃지 — 턴 뷰의 Agent/Skill 칩과 동일 시각 언어로 렌더.
 *
 * SSoT 재사용:
 *  - 머리표시 ◎/◉ + 색상 그라디언트는 render/badges.js의 toolIconHtml(toolName)을 그대로 호출.
 *  - 칩 보더+radius는 turn-view.css의 .tool-chip을, agent 톤은 .agent-chip을 그대로 활용.
 *  - command도 Agent/Skill과 동일 주황 — meta 문서는 "정의된 행동 단위"로 의미가 같다는 사용자 결정.
 *
 * type 값: 'agent' | 'skill' | 'command' — 정규식이 대문자 시작을 요구하므로 'Agent'로 통일해서 넘긴다.
 */
function metaDocTypeBadge(type) {
  const safe = String(type || '').toLowerCase();
  // 모든 메타 문서 타입은 Agent/Skill 칩과 동일 톤. 정규식 매칭을 위해 'Agent'로 정규화.
  const icon = toolIconHtml('Agent');
  const label = safe.toUpperCase();
  return `<span class="tool-chip agent-chip meta-doc-type meta-doc-type-${escHtml(safe)}">
    ${icon}<span class="agent-chip-name">${escHtml(label)}</span>
  </span>`;
}

/** 출처 셀 — 라벨(우선) + 실제 파일 경로(file_path, 없으면 source_root). 단일 책임 캡슐화.
 *  이름 컬럼에 file_path를 별도 노출하지 않고 출처 셀로 통합 — 시각 위계 단순화.
 */
function sourceCellHtml(r) {
  const label = r.source ? escHtml(r.source) : '-';
  const path = r.file_path || r.source_root || null;
  const pathHtml = path
    ? `<div class="meta-doc-source-root" title="${escHtml(path)}">${escHtml(shortenPath(path))}</div>`
    : '';
  return `<div class="meta-doc-source-label">${label}</div>${pathHtml}`;
}

/**
 * 스코프 헤더 — 현재 보기 범위(전체/특정 프로젝트) + 토글 버튼.
 * 단일 책임 캡슐화. 호출 측은 ctx({project, matched, resolvedSourceRoot})만 전달.
 */
function renderScopeHeader(ctx = {}) {
  const isProjectMode = state.scopeMode === 'selected' && !!ctx.project;
  const otherMode     = isProjectMode ? 'all' : 'selected';
  const otherLabel    = isProjectMode ? '전체 프로젝트 보기' : '선택 프로젝트만 보기';

  let scopeText;
  if (isProjectMode) {
    if (ctx.matched && ctx.resolvedSourceRoot) {
      scopeText = `<span class="meta-docs-scope-label">프로젝트</span>
                   <strong class="meta-docs-scope-name">${escHtml(ctx.project)}</strong>
                   <span class="meta-docs-scope-path" title="${escHtml(ctx.resolvedSourceRoot)}">${escHtml(shortenPath(ctx.resolvedSourceRoot))}</span>`;
    } else {
      scopeText = `<span class="meta-docs-scope-label">프로젝트</span>
                   <strong class="meta-docs-scope-name">${escHtml(ctx.project)}</strong>
                   <span class="meta-docs-scope-warn">카탈로그 미등록</span>`;
    }
  } else {
    scopeText = `<span class="meta-docs-scope-label">범위</span>
                 <strong class="meta-docs-scope-name">전체 프로젝트</strong>`;
  }

  return `
    <div class="meta-docs-scope">
      <div class="meta-docs-scope-text">${scopeText}</div>
      <button type="button" class="meta-docs-scope-toggle"
              data-meta-scope-toggle="${otherMode}"
              title="${escHtml(otherLabel)}">
        ${escHtml(otherLabel)}
      </button>
    </div>
  `;
}

function renderFilters() {
  const types = [
    { v: 'all',     label: '전체'    },
    { v: 'agent',   label: 'Agent'   },
    { v: 'skill',   label: 'Skill'   },
    { v: 'command', label: 'Command' },
  ];
  const scopes = [
    { v: 'all',     label: '전체'    },
    { v: 'project', label: '프로젝트'},
    { v: 'global',  label: '글로벌'  },
  ];
  // ADR-001 meta-docs-filter: with_deleted를 별도 boolean(state.includeDeleted)로
  // 승격. 라디오 그룹은 "행 부분집합 선택" 단일 책임만 담당.
  const displays = [
    { v: 'all',    label: '전체' },
    { v: 'unused', label: '미사용만' },
    { v: 'orphan', label: '호출만존재' },
  ];

  const btn = (group, opts, active) => opts.map(o =>
    `<button type="button" data-meta-filter="${group}" data-value="${o.v}"
       class="meta-doc-filter-btn ${o.v === active ? 'active' : ''}">${escHtml(o.label)}</button>`
  ).join('');

  // 직교 토글 — display와 의미 축이 다르므로 라디오 그룹 외부에 체크박스로 분리.
  // 라벨 능동형 + 🗑 아이콘 + title 툴팁의 3중 시각 단서로 학습 비용 ↓.
  const includeDeletedHtml = `
    <label class="meta-docs-include-deleted"
           title="과거 호출 이력은 있으나 디스크에서 사라진 항목까지 포함합니다">
      <input type="checkbox"
             data-meta-include-deleted
             ${state.includeDeleted ? 'checked' : ''} />
      <span class="meta-docs-include-deleted-label">🗑 삭제된 정의도 표시</span>
    </label>
  `;

  // 정렬 컨트롤은 더 이상 상단 필터 바에 두지 않는다 — 표 헤더 클릭으로 일원화.
  return `
    <div class="meta-docs-filters">
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">타입</span>${btn('type', types, state.type)}</div>
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">스코프</span>${btn('scope', scopes, state.scope)}</div>
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">표시</span>${btn('display', displays, state.display)}</div>
      ${includeDeletedHtml}
    </div>
  `;
}

/** 헤더 active 클래스 — 단일 책임 */
function sortHeaderCls(key) {
  if (state.sort !== key) return '';
  return state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc';
}
/** 헤더 ↓/↑ 표기자 — 단일 책임 */
function sortIndicator(key) {
  if (state.sort !== key) return '<span class="sort-arrow sort-arrow-idle">↕</span>';
  return state.sortDir === 'asc'
    ? '<span class="sort-arrow">↑</span>'
    : '<span class="sort-arrow">↓</span>';
}

const ORPHAN_TOOLTIP =
  '이 호출은 다른 워크스페이스(.claude/) 또는 빌트인/플러그인 정의에서 발생했을 수 있습니다. 동기화 시 다중 cwd를 함께 스캔하면 이 행이 카탈로그 행으로 합쳐집니다.';

// =============================================================================
// 이벤트 바인딩
// =============================================================================

/**
 * 컨테이너 클릭 핸들러 — bindEvents가 매 렌더마다 호출되더라도 리스너 중복 부착을
 * 막기 위해 컨테이너 datasetFlag로 1회만 등록한다. 그렇지 않으면 N번째 렌더에서
 * 한 클릭이 N번 처리되어 sort 토글이 의도와 어긋난다.
 */
function bindEvents(container) {
  if (container.dataset.metaBound === '1') return;
  container.dataset.metaBound = '1';
  container.addEventListener('click', onMetaContainerClick);
  container.addEventListener('keydown', onMetaContainerKeydown);
  // change 이벤트는 click과 의미 축이 달라 별도 리스너로 등록.
  //   - click  : 라디오/정렬/스코프/동기화 등 "값 선택" 액션
  //   - change : 체크박스 토글 등 "boolean 상태 전환" 액션
  container.addEventListener('change', onMetaContainerChange);
}

/**
 * 키보드 접근성 — sortable 헤더에 포커스가 있고 Enter/Space 입력 시 토글.
 * 단일 책임 — th[data-meta-sort] 외에는 무시.
 */
async function onMetaContainerKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const sortHeader = e.target.closest('[data-meta-sort]');
  if (!sortHeader) return;
  e.preventDefault();
  applyFilterChange('sort', sortHeader.dataset.metaSort);
  await loadMetaDocsLibrary();
}

async function onMetaContainerClick(e) {
  // 1) 필터 버튼 (타입/스코프/표시/정렬)
  const filterBtn = e.target.closest('[data-meta-filter]');
  if (filterBtn) {
    applyFilterChange(filterBtn.dataset.metaFilter, filterBtn.dataset.value);
    await loadMetaDocsLibrary();
    return;
  }

  // 2) 표 헤더 정렬 (data-meta-sort) — 상단 정렬 버튼과 동일 분기로 통합
  const sortHeader = e.target.closest('[data-meta-sort]');
  if (sortHeader) {
    applyFilterChange('sort', sortHeader.dataset.metaSort);
    await loadMetaDocsLibrary();
    return;
  }

  // 3) 스코프 토글 (selected ↔ all)
  const scopeToggle = e.target.closest('[data-meta-scope-toggle]');
  if (scopeToggle) {
    const next = scopeToggle.dataset.metaScopeToggle;
    state.scopeMode = (next === 'selected' || next === 'all') ? next : 'selected';
    await loadMetaDocsLibrary();
    return;
  }

  // 4) 동기화 버튼
  const refresh = e.target.closest('[data-meta-refresh]');
  if (refresh) {
    await runRefresh(refresh);
    return;
  }
}

/**
 * change 이벤트 핸들러 — boolean 상태 전환만 처리.
 * 현재는 includeDeleted 토글 1건. 향후 동일 패턴 토글이 늘어나면 data-* 분기를 확장.
 */
async function onMetaContainerChange(e) {
  const toggle = e.target.closest('[data-meta-include-deleted]');
  if (toggle) {
    setIncludeDeleted(!!toggle.checked);
    await loadMetaDocsLibrary();
    return;
  }
}

/**
 * includeDeleted 진입점 — applyFilterChange와 의미 축이 다르므로 별도 헬퍼.
 * (ADR-001 meta-docs-filter: 단일 책임 원칙 유지)
 */
function setIncludeDeleted(value) {
  state.includeDeleted = !!value;
}

/** 필터 변경 단일 진입점 — sort 그룹은 dir 토글 규칙 처리 */
function applyFilterChange(group, value) {
  if (group === 'type')    { state.type    = value; return; }
  if (group === 'scope')   { state.scope   = value; return; }
  if (group === 'sort') {
    if (!SORTABLE_KEYS.has(value)) return;
    if (state.sort === value) {
      // 같은 키 재클릭 — 방향 토글
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      // 다른 키 — 컬럼별 의미 있는 기본 방향 적용 (텍스트 asc, 숫자/시간 desc)
      state.sort = value;
      state.sortDir = DEFAULT_DIR[value] ?? 'desc';
    }
    return;
  }
  if (group === 'display') {
    // 'orphan만' 표시 필터는 source_root 정보가 없는 행을 보여주므로 프로젝트 모드와
    // 의미 충돌. 사용자가 누르면 자동으로 전체 프로젝트 모드로 전환하고 안내 토스트.
    if (value === 'orphan' && state.scopeMode === 'selected' && getSelectedProject()) {
      state.scopeMode = 'all';
      pushToast({
        kind: 'info',
        message: 'orphan은 어느 프로젝트 호출인지 단정할 수 없어 전체 프로젝트 모드로 전환했습니다.',
        ttl: 5000,
      });
    }
    state.display = value;
    return;
  }
}

// =============================================================================
// 동기화 + 토스트
// =============================================================================

async function runRefresh(buttonEl) {
  // 진행 중 UI — disabled + 스피너 (finally의 loadMetaDocsLibrary가 컨테이너를 다시
  // 그리므로 버튼 자체가 새 DOM으로 교체됨 → 별도 라벨 복원 불필요)
  buttonEl.disabled = true;
  buttonEl.classList.add('is-loading');
  const labelEl = buttonEl.querySelector('.meta-docs-refresh-label');
  if (labelEl) labelEl.textContent = '동기화 중…';

  const startToast = pushToast({ kind: 'info', message: '동기화 시작…', ttl: 3000 });

  try {
    const body = buildRefreshBody();
    const res = await fetchJson('/api/meta-docs/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const norm = normalizeRefreshResult(res);
    state.lastRefresh = norm.meta;

    // 시작 토스트 정리 후 완료 토스트
    closeToast(startToast);
    pushToast({ kind: 'success', message: '동기화 완료 — ' + norm.summaryText, ttl: 5000 });
  } catch (err) {
    closeToast(startToast);
    const msg = err?.message ? String(err.message) : String(err);
    pushToast({ kind: 'error', message: '동기화 실패: ' + msg, ttl: 7000 });
  } finally {
    // 결과 토스트는 별도 영역. 패널은 즉시 재조회.
    await loadMetaDocsLibrary();
    // loadMetaDocsLibrary가 컨테이너를 다시 그리므로 buttonEl은 detach됨 — 별도 정리 불필요
  }
}

/** 동기화 호출 본문 빌더 — 단일 책임 */
function buildRefreshBody() {
  const body = { scope: 'all', includeKnownCwds: true, force: true };
  // window.__SPYGLASS_CWD__ 가 어딘가(메인 부트스트랩)에서 노출돼 있으면 첨부.
  // 미존재 시 서버는 cwd 없이 includeKnownCwds로 기존 cwd를 전부 스캔.
  const cwd = (typeof window !== 'undefined' && typeof window.__SPYGLASS_CWD__ === 'string')
    ? window.__SPYGLASS_CWD__
    : null;
  if (cwd) body.cwd = cwd;
  return body;
}

/** 응답 정규화 — global/project/cwds graceful skip */
function normalizeRefreshResult(res) {
  const data = res?.data ?? {};
  const parts = [];
  const fmt = (s) => {
    if (!s || typeof s !== 'object') return null;
    const up  = s.upserted ?? s.added ?? 0;
    const del = s.softDeleted ?? s.deleted ?? 0;
    return `+${up} / -${del}`;
  };

  const g = fmt(data.global);
  if (g) parts.push('글로벌 ' + g);
  const p = fmt(data.project);
  if (p) parts.push('프로젝트 ' + p);

  const cwds = Array.isArray(data.cwds) ? data.cwds : [];
  let cwdsCount = cwds.length;
  let cwdsTitle = '';
  if (cwdsCount) {
    parts.push(`cwd ${cwdsCount}개`);
    cwdsTitle = cwds.map(c => c?.cwd ?? '').filter(Boolean).join('\n');
  }

  return {
    summaryText: parts.length ? parts.join(', ') : '결과 없음',
    meta: cwdsCount ? { cwdsCount, cwdsTitle } : null,
  };
}

// 토스트 단일 호스트 (탭 재마운트에도 1개만 유지)
function ensureToastHost() {
  if (document.getElementById('metaDocsToastHost')) return;
  const host = document.createElement('div');
  host.id = 'metaDocsToastHost';
  host.className = 'meta-docs-toast-host';
  document.body.appendChild(host);
}

/** pushToast({kind, message, ttl}) → toast element (close 핸들 용) */
function pushToast({ kind = 'info', message = '', ttl = 4000 } = {}) {
  ensureToastHost();
  const host = document.getElementById('metaDocsToastHost');
  if (!host) return null;

  const el = document.createElement('div');
  el.className = `meta-docs-toast meta-docs-toast-${kind}`;
  el.innerHTML = `
    <span class="meta-docs-toast-icon" aria-hidden="true"></span>
    <span class="meta-docs-toast-msg">${escHtml(message)}</span>
  `;
  el.addEventListener('click', () => closeToast(el));
  host.appendChild(el);

  // entry 애니메이션 다음 프레임
  requestAnimationFrame(() => el.classList.add('is-shown'));

  if (ttl > 0) {
    setTimeout(() => closeToast(el), ttl);
  }
  return el;
}

function closeToast(el) {
  if (!el || !el.parentNode) return;
  el.classList.add('is-leaving');
  setTimeout(() => { try { el.remove(); } catch { /* noop */ } }, 220);
}

// =============================================================================
// 필터 / 정렬 / 포맷
// =============================================================================

function applyScopeFilter(rows, scope) {
  if (scope === 'all') return rows;
  if (scope === 'global') {
    return rows.filter(r => r.source === 'userSettings' || r.source_root == null);
  }
  if (scope === 'project') {
    return rows.filter(r => r.source === 'projectSettings');
  }
  return rows;
}

/**
 * 표시 필터 — 행 부분집합 선택만 담당 (단일 책임).
 *
 * ADR-001 meta-docs-filter: with_deleted 분기는 state.includeDeleted로 분리되어
 * fetch 쿼리 파라미터(includeDeleted=1)에서만 의미를 가진다. 이 함수는 서버 응답이
 * 이미 적용된 상태의 list를 받아 "어떤 행을 화면에 표시할지"만 결정한다.
 */
function applyDisplayFilter(rows, display) {
  if (display === 'all') return rows;
  if (display === 'unused') {
    return rows.filter(r => r.id != null && (r.invocations ?? 0) === 0);
  }
  if (display === 'orphan') {
    return rows.filter(r => r.id == null);
  }
  return rows;
}

// =============================================================================
// 정렬 — COMPARATORS 맵 + dispatcher (단일 책임)
//
// 캡슐화 원칙:
//  - 컬럼별 비교 로직은 각각 작은 함수로 분리한다.
//  - applySort는 dispatcher 역할만 — 어느 컬럼이든 동일한 dir 적용.
//  - null/누락값 정책은 비교 함수 내부에서만 결정 (호출 측이 분기를 떠안지 않음).
//
// 비교 함수 반환값은 "asc 기준" — dispatcher에서 desc일 때 부호를 뒤집는다.
// 단, "데이터 없는 행은 항상 끝" 정책이 필요한 컬럼은 비교 함수 내부에서 dir과
// 무관한 보호 분기를 별도로 처리한다 (asc/desc 어느 쪽이든 끝으로).
// =============================================================================

const SORTABLE_KEYS = new Set([
  'type', 'name', 'source', 'invocations', 'last_used_at', 'total_tokens',
]);

/** 컬럼별 기본 정렬 방향 — 텍스트는 asc, 숫자/시간은 desc가 자연스럽다. */
const DEFAULT_DIR = {
  type:         'asc',
  name:         'asc',
  source:       'asc',
  invocations:  'desc',
  last_used_at: 'desc',
  total_tokens: 'desc',
};

/** 문자열 비교 (한/영 통합 ko collator) */
const koCollator = (typeof Intl !== 'undefined' && Intl.Collator)
  ? new Intl.Collator('ko', { sensitivity: 'base', numeric: true })
  : null;
function cmpString(a, b) {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  return koCollator ? koCollator.compare(sa, sb) : sa.localeCompare(sb);
}
/** 숫자 비교 (asc 기준). null/undefined는 0으로 처리 — 토큰합/호출수에 적합. */
function cmpNumber(a, b) {
  return (a ?? 0) - (b ?? 0);
}

/**
 * 컬럼별 비교 함수 맵 — 각 함수는 (a, b, dir)을 받아 asc 기준 부호를 반환한다.
 * dir을 인자로 받는 이유: "데이터 없는 행은 항상 끝" 같은 dir 무관 정책을 컬럼이 직접
 * 처리해야 할 때 dispatcher에서 일괄 부호 반전이 어긋나기 때문.
 *  - 이런 컬럼(last_used_at)은 내부에서 nullGuard를 dir-aware로 적용한다.
 *  - 그 외 컬럼은 단순 asc 비교만 하고 dispatcher가 desc일 때 부호를 뒤집는다.
 */
const COMPARATORS = {
  type: (a, b) => {
    const primary = cmpString(a.type, b.type);
    if (primary !== 0) return primary;
    // 동률 시 invocations desc 보조 — 사용자 안내대로
    return -cmpNumber(a.invocations, b.invocations);
  },
  name: (a, b) => cmpString(a.name, b.name),
  source: (a, b, dir) => {
    // orphan(source null)은 dir 무관하게 항상 마지막
    // dispatcher가 factor를 곱해도 끝 자리가 유지되도록 dir-aware 부호를 반환한다.
    const orphanA = a.source == null;
    const orphanB = b.source == null;
    if (orphanA && orphanB) return 0;
    if (orphanA || orphanB) {
      // a를 끝으로 보내고 싶을 때: asc(factor=+1)면 +1, desc(factor=-1)면 -1
      const sign = (dir === 'desc') ? -1 : 1;
      return orphanA ? sign : -sign;
    }
    const primary = cmpString(a.source, b.source);
    if (primary !== 0) return primary;
    return cmpString(a.source_root ?? '', b.source_root ?? '');
  },
  invocations: (a, b) => {
    const primary = cmpNumber(a.invocations, b.invocations);
    if (primary !== 0) return primary;
    // 동률 시 last_used_at 보조 — 더 최근에 사용된 행이 위
    return cmpNumber(a.last_used_at, b.last_used_at);
  },
  last_used_at: (a, b, dir) => {
    // null은 dir 무관하게 항상 끝 — dispatcher의 factor 반전을 흡수하도록 dir-aware 부호.
    const va = a.last_used_at;
    const vb = b.last_used_at;
    const nullA = va == null;
    const nullB = vb == null;
    if (nullA && nullB) return 0;
    if (nullA || nullB) {
      const sign = (dir === 'desc') ? -1 : 1;
      return nullA ? sign : -sign;
    }
    // 둘 다 값이 있으면 dispatcher가 일관 적용할 수 있도록 asc 기준 반환
    return cmpNumber(va, vb);
  },
  total_tokens: (a, b) => cmpNumber(a.total_tokens, b.total_tokens),
};

/**
 * 정렬 dispatcher — sort 키와 dir만 받아 결과 반환.
 * COMPARATORS에 없는 키는 invocations로 fallback.
 */
function applySort(rows, sort, dir = 'desc') {
  const cmp = COMPARATORS[sort] ?? COMPARATORS.invocations;
  const factor = dir === 'asc' ? 1 : -1;
  // last_used_at처럼 dir 무관 보호 분기를 직접 처리하는 컬럼은 비교 함수 내부에서
  // dir에 영향 받지 않는 부호(±1)를 반환한다 — dispatcher에서 factor를 곱해도
  // null 행은 그대로 끝으로 유지된다 (정책: 항상 끝).
  return rows.slice().sort((a, b) => factor * cmp(a, b, dir));
}

/** 헤더 aria-sort 속성 값 — WAI-ARIA 표준 */
function ariaSortValue(key) {
  if (state.sort !== key) return 'none';
  return state.sortDir === 'asc' ? 'ascending' : 'descending';
}

function shortenPath(p) {
  if (!p) return '';
  // ~/ 치환 — 사용자 홈 하위면 ~/.../<rest>
  const home = (typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac'))
    ? '/Users/' : '/home/';
  const idx = p.indexOf(home);
  if (idx >= 0) {
    const rest = p.slice(idx + home.length);
    const slash = rest.indexOf('/');
    if (slash > 0) return '~' + rest.slice(slash);
  }
  // 너무 길면 가운데 …
  return p.length > 60 ? p.slice(0, 28) + '…' + p.slice(-30) : p;
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function errorHtml(err) {
  return `<div class="state-empty"><span class="state-empty-title">불러오기 실패: ${escHtml(String(err?.message ?? err))}</span></div>`;
}

// 작은 fetch 래퍼 — sysLib 방식 동일
async function fetchJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
