/**
 * meta-docs-view.js — 메타 문서 카탈로그 + 히팅률 패널 (v24, Migration 024)
 *
 * 책임:
 *  - GET /api/meta-docs 로 카탈로그 + 사용 집계 받아 표 형태로 노출.
 *  - 타입 필터(agent/skill/command/all), 정렬(호출수/마지막사용/이름).
 *  - "호출 0건" 행은 정리 후보로 시각 구분, "카탈로그에 없는 호출"(orphan)은 별도 라벨.
 *  - "동기화" 버튼: POST /api/meta-docs/refresh로 강제 재스캔.
 *
 * 호출자: session-detail/turn-views.js setDetailView('metadocs')
 *
 * 의존성: formatters.js (escHtml, fmtTime), 기본 fetch.
 */

import { escHtml, fmtTime } from './formatters.js';

const CONTAINER_ID = 'metaDocsBody';

// 필터/정렬 상태 — 모듈 모듈 단위로 보관 (탭 재진입 시 유지)
const state = {
  type: 'all',     // 'all' | 'agent' | 'skill' | 'command'
  sort: 'invocations', // 'invocations' | 'last_used_at' | 'name'
  scope: 'all',    // 'all' | 'project' | 'global'
};

/** 탭 진입 시 호출 — fetch + 렌더. */
export async function loadMetaDocsLibrary() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  container.innerHTML = `<div class="state-loading"><div class="state-loading-spinner"></div><span>메타 문서 카탈로그 조회 중…</span></div>`;

  try {
    const params = new URLSearchParams();
    if (state.type !== 'all') params.set('type', state.type);
    const qs = params.toString();
    const url = '/api/meta-docs' + (qs ? `?${qs}` : '');
    const res = await fetchJson(url);
    const list = Array.isArray(res?.data) ? res.data : [];

    const filtered = applyScopeFilter(list, state.scope);
    const sorted = applySort(filtered, state.sort);

    container.innerHTML = renderHtml(sorted);
    bindEvents(container);
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
}

// =============================================================================
// 내부 — 렌더
// =============================================================================

function renderHtml(rows) {
  const total = rows.length;
  const used   = rows.filter(r => (r.invocations ?? 0) > 0).length;
  const unused = rows.filter(r => r.id != null && (r.invocations ?? 0) === 0).length;
  const orphan = rows.filter(r => r.id == null).length;

  const summary = `
    <div class="meta-docs-summary">
      <span><strong>${total}</strong> 항목</span>
      <span class="sep">·</span>
      <span title="호출이 1회 이상 발생한 메타 문서">사용 <strong>${used}</strong></span>
      <span class="sep">·</span>
      <span title="카탈로그엔 있으나 호출 0건">미사용 <strong>${unused}</strong></span>
      ${orphan ? `<span class="sep">·</span><span title="호출은 있는데 현재 카탈로그에 없음 (외부/삭제된 정의)">기타 <strong>${orphan}</strong></span>` : ''}
      <span class="meta-docs-actions">
        <button type="button" data-meta-refresh="1" title="현재 cwd + 글로벌 재스캔">동기화</button>
      </span>
    </div>
  `;

  const filters = renderFilters();

  if (rows.length === 0) {
    return `${summary}${filters}<div class="state-empty"><span class="state-empty-title">메타 문서가 없습니다 — SessionStart 이후 자동 동기화됩니다</span></div>`;
  }

  const tbody = rows.map(rowHtml).join('');

  return `
    ${summary}
    ${filters}
    <div class="meta-docs-table-wrap">
      <table class="meta-docs-table">
        <colgroup>
          <col style="width:80px">
          <col>
          <col style="width:130px">
          <col style="width:80px"><col style="width:130px"><col style="width:90px">
          <col style="width:36px">
        </colgroup>
        <thead><tr>
          <th>타입</th>
          <th>이름</th>
          <th>출처</th>
          <th data-sort="invocations" class="num">호출수</th>
          <th data-sort="last_used_at" class="num">마지막 사용</th>
          <th class="num">토큰합</th>
          <th></th>
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

  const sourceLabel = orphan ? '<span class="meta-doc-source-orphan">호출만 존재</span>' : escHtml(r.source ?? '-');
  const desc = r.description ? `<div class="meta-doc-desc" title="${escHtml(r.description)}">${escHtml(r.description)}</div>` : '';
  const filePath = r.file_path
    ? `<div class="meta-doc-path" title="${escHtml(r.file_path)}">${escHtml(shortenPath(r.file_path))}</div>`
    : '';
  const lastUsed = r.last_used_at ? escHtml(fmtTime(r.last_used_at)) : '<span class="meta-doc-na">—</span>';
  const tokens = formatTokens(r.total_tokens ?? 0);

  return `
    <tr class="meta-doc-row ${cls}" data-type="${escHtml(r.type)}" data-name="${escHtml(r.name)}">
      <td><span class="meta-doc-type meta-doc-type-${escHtml(r.type)}">${escHtml(r.type)}</span></td>
      <td>
        <div class="meta-doc-name">${escHtml(r.name)}</div>
        ${desc}
        ${filePath}
      </td>
      <td>${sourceLabel}</td>
      <td class="num">${(r.invocations ?? 0).toLocaleString()}</td>
      <td class="num">${lastUsed}</td>
      <td class="num">${tokens}</td>
      <td>${deleted ? '<span title="현재 디스크에서 사라진 정의 (soft-deleted)">⚠</span>' : ''}</td>
    </tr>
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
  const sorts = [
    { v: 'invocations',  label: '호출수↓' },
    { v: 'last_used_at', label: '최근↓'  },
    { v: 'name',         label: '이름' },
  ];

  const btn = (group, opts, active) => opts.map(o =>
    `<button type="button" data-meta-filter="${group}" data-value="${o.v}"
       class="meta-doc-filter-btn ${o.v === active ? 'active' : ''}">${escHtml(o.label)}</button>`
  ).join('');

  return `
    <div class="meta-docs-filters">
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">타입</span>${btn('type', types, state.type)}</div>
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">스코프</span>${btn('scope', scopes, state.scope)}</div>
      <div class="meta-docs-filter-group"><span class="meta-docs-filter-label">정렬</span>${btn('sort', sorts, state.sort)}</div>
    </div>
  `;
}

// =============================================================================
// 이벤트 바인딩
// =============================================================================

function bindEvents(container) {
  container.addEventListener('click', async (e) => {
    const filterBtn = e.target.closest('[data-meta-filter]');
    if (filterBtn) {
      const group = filterBtn.dataset.metaFilter;
      const value = filterBtn.dataset.value;
      if (group === 'type')  state.type  = value;
      if (group === 'scope') state.scope = value;
      if (group === 'sort')  state.sort  = value;
      await loadMetaDocsLibrary();
      return;
    }

    const refresh = e.target.closest('[data-meta-refresh]');
    if (refresh) {
      refresh.disabled = true;
      refresh.textContent = '동기화 중…';
      try {
        await fetchJson('/api/meta-docs/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'all', force: true }),
        });
      } catch {
        /* refresh 실패해도 재조회는 시도 */
      } finally {
        await loadMetaDocsLibrary();
      }
      return;
    }
  });
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

function applySort(rows, sort) {
  const out = rows.slice();
  if (sort === 'name') {
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } else if (sort === 'last_used_at') {
    out.sort((a, b) => (b.last_used_at ?? 0) - (a.last_used_at ?? 0));
  } else {
    // invocations
    out.sort((a, b) => (b.invocations ?? 0) - (a.invocations ?? 0)
      || (b.last_used_at ?? 0) - (a.last_used_at ?? 0));
  }
  return out;
}

function shortenPath(p) {
  if (!p) return '';
  // ~/ 치환
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
