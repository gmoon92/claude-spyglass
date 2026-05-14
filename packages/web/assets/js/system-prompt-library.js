/**
 * system-prompt-library.js — System Prompt 라이브러리 패널
 *
 * 책임:
 *  - dedup된 system_prompts 카탈로그를 표 형태로 노출.
 *  - 행 클릭 시 본문 lazy-fetch + 모달/사이드 패널로 전체 본문 표시.
 *  - 헤더 클릭 정렬 (Behavior Definitions 테이블과 동일 패턴): hash / byte_size / segment_count / ref_count / first_seen_at / last_seen_at.
 *    - 같은 컬럼 재클릭 → 방향 토글.
 *    - 다른 컬럼 클릭 → 컬럼별 기본 방향(텍스트 asc / 숫자·시간 desc) 적용.
 *    - 키보드 접근성: Enter/Space로도 토글.
 *    - 시각 표식: ↕(idle) / ↑(asc) / ↓(desc) + aria-sort 동기화.
 *
 * 데이터 소스:
 *  - GET /api/system-prompts?orderBy=last_seen_at&limit=100  → 메타 목록 (본문 미포함)
 *  - GET /api/system-prompts/:hash                           → 본문 lazy-fetch (행 클릭 시)
 *
 * 정렬 처리 방침:
 *  - 서버는 초기 fetch에서만 정렬(last_seen_at desc)을 적용한다 — 표는 100개 한도라 클라이언트 정렬이 충분히 가볍다.
 *  - 헤더 클릭으로 발생하는 정렬 변경은 캐시된 _rows를 다시 sort하여 재렌더 (네트워크 호출 없음).
 *  - 정렬 상태(_sortKey/_sortDir)는 모듈 전역이라 탭 재진입 시 사용자 선호가 유지된다.
 *
 * 호출자: turn-views.js setDetailView('syslib') — 탭 진입 시 자동 로드
 */

import { escHtml } from './formatters.js';
import { skSysLibCards, skBlock } from './render/skeleton.js';
import { initColResize } from './col-resize.js';
import { renderSortHead } from './design-system/markers/sort-head.js';
import { renderCloseBtn } from './design-system/primitives/close-button.js';

const CONTAINER_ID = 'sysLibBody';
const DEFAULT_LIMIT = 100;
const INITIAL_FETCH_ORDER = 'last_seen_at';   // 서버 fetch 시 1회 적용 — 이후 정렬은 클라이언트로 처리.

// ──────────────────────────────────────────────────────────────────────────
// 임계 분기 SSoT (web-design-balance-pass ADR-007)
// ──────────────────────────────────────────────────────────────────────────
//  - REF_HOT_RATIO  : ref_count Top N% — 자주 쓰이는 페르소나 부각.
//                     sort key가 'ref_count'일 때만 상위 행에 .syslib-ref-hot 부여.
//                     (다른 sort key일 땐 의미 없음 — 노이즈만 됨).
//  - SIZE_WARN/LARGE: byte_size 절대 임계 — cache miss 비용 신호.
//                     sort key 무관. >32KB는 warn보다 우선해 .syslib-size-large만 부여.
//
// CSS 변수가 아닌 JS 상수로 캡슐화한 이유: CSS는 px 단위라 byte 임계 부적절.
// 단일 판단 로직(재계산 없음) — CLAUDE.md "동일 판단 로직은 한 곳에만" 원칙 준수.
const SIZE_WARN_THRESHOLD  = 16 * 1024;   // 16 KB
const SIZE_LARGE_THRESHOLD = 32 * 1024;   // 32 KB
const REF_HOT_RATIO        = 0.25;        // 상위 25%

// ──────────────────────────────────────────────────────────────────────────
// 정렬 메타 — 컬럼키, 라벨, 기본 방향
// ──────────────────────────────────────────────────────────────────────────
const SORTABLE_KEYS = new Set([
  'hash', 'byte_size', 'segment_count', 'ref_count', 'first_seen_at', 'last_seen_at',
]);
/** 컬럼별 기본 정렬 방향 — 텍스트는 asc, 숫자/시간은 desc가 자연스럽다. */
const DEFAULT_DIR = {
  hash:           'asc',
  byte_size:      'desc',
  segment_count:  'desc',
  ref_count:      'desc',
  first_seen_at:  'desc',
  last_seen_at:   'desc',
};

let _sortKey = 'last_seen_at';
let _sortDir = 'desc';
let _rows    = [];   // 마지막 fetch 결과 캐시 — 정렬만 변경할 때 재 fetch 회피.

/**
 * 라이브러리 목록 로드 + 렌더 — 탭 진입 시 호출.
 * 정렬 변경은 fetch를 다시 호출하지 않고 applySortChange로 처리.
 */
export async function loadSystemPromptLibrary() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  // skeleton-loading T-11: dedup 카드 4개로 구조 유지. fetch 응답 후 정상 표로 교체.
  container.innerHTML = skSysLibCards(4);

  try {
    const res = await fetchJson(`/api/system-prompts?orderBy=${encodeURIComponent(INITIAL_FETCH_ORDER)}&limit=${DEFAULT_LIMIT}`);
    _rows = Array.isArray(res?.data) ? res.data : [];
    renderContainer(container);
  } catch (err) {
    container.innerHTML = `<div class="state-empty"><span class="state-empty-title">불러오기 실패: ${escHtml(String(err?.message ?? err))}</span></div>`;
  }
}

// =============================================================================
// 내부 helper
// =============================================================================

/**
 * 캐시된 _rows를 현재 정렬 상태로 재렌더 + 이벤트 바인딩.
 * 정렬 토글이든 최초 fetch 직후든 동일 진입점.
 *
 * col-resize: Behavior Definitions 테이블과 동일하게 initColResize 재사용 — 헤더 우측 5px 핸들
 * 드래그(<col>.style.width 직접 조정) + 더블클릭 Auto-fit. table-layout:fixed가
 * 글로벌(table.css)이라 colgroup의 width가 즉시 반영된다.
 */
function renderContainer(container) {
  container.innerHTML = renderHtml(applySort(_rows, _sortKey, _sortDir));
  bindEvents(container);
  initColResize(container.querySelector('.syslib-table'));
}

function renderHtml(rows) {
  if (rows.length === 0) {
    return `<div class="state-empty"><span class="state-empty-title">시스템 프롬프트가 없습니다 (아직 dedup 카탈로그 비어있음)</span></div>`;
  }

  // ref_count Top N% 산출 — sort key가 ref_count일 때만 의미 있음 (rows는 이미 현재 정렬 적용 완료).
  // (web-design-balance-pass ADR-007)
  const refHotCutoff = _sortKey === 'ref_count'
    ? Math.max(1, Math.ceil(rows.length * REF_HOT_RATIO))
    : 0;

  const tableRows = rows.map((r, idx) => {
    const refClass  = (_sortKey === 'ref_count' && idx < refHotCutoff) ? ' syslib-ref-hot' : '';
    const sizeClass = sizeClassFor(r.byte_size);
    return `
    <tr class="syslib-row" data-syslib-hash="${escHtml(r.hash)}" tabindex="0" role="button" aria-label="시스템 프롬프트 본문 보기">
      <td class="syslib-hash"><code>${escHtml(r.hash.slice(0, 12))}…</code></td>
      <td class="num${sizeClass ? ' ' + sizeClass : ''}">${formatBytes(r.byte_size)}</td>
      <td class="num">${escHtml(String(r.segment_count ?? '-'))}</td>
      <td class="num${refClass}"><strong>${escHtml(String(r.ref_count ?? 0))}</strong></td>
      <td>${formatTime(r.first_seen_at)}</td>
      <td>${formatTime(r.last_seen_at)}</td>
    </tr>
  `;
  }).join('');

  // 모든 sortable 컬럼은 동일 패턴으로 — SORTABLE_KEYS 기준 단일 정의.
  // renderSortHead: ds-sort-head 이중 클래스 패턴 — 기존 data-syslib-sort/aria-sort/<th> 속성 보존.
  const th = (key, label, extraCls = '') => {
    const cls = `${extraCls} sortable ${sortHeaderCls(key)}`.trim();
    const sortState = _sortKey !== key ? 'idle' : (_sortDir === 'asc' ? 'asc' : 'desc');
    return `<th data-syslib-sort="${key}"
                class="${cls}"
                tabindex="0"
                role="columnheader"
                aria-sort="${ariaSortValue(key)}">${renderSortHead({ label, sort: sortState, key })}</th>`;
  };

  // colgroup — initColResize가 cols[i].style.width 직접 조정. 초기 폭은
  // 요청 탭(detailRequestsView)의 colgroup과 비슷한 시각 균형으로 부여한다.
  // table-layout:fixed가 글로벌이라 width가 즉시 컬럼 너비로 반영됨.
  return `
    <table class="syslib-table">
      <colgroup>
        <col style="width:200px">
        <col style="width:120px">
        <col style="width:80px">
        <col style="width:90px">
        <col style="width:170px">
        <col style="width:170px">
      </colgroup>
      <thead>
        <tr>
          ${th('hash',          'Hash')}
          ${th('byte_size',     'Size',       'num')}
          ${th('segment_count', 'Seg',        'num')}
          ${th('ref_count',     'Ref',        'num')}
          ${th('first_seen_at', 'First Seen')}
          ${th('last_seen_at',  'Last Seen')}
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
}

/** 헤더 active 클래스 — 단일 책임 */
function sortHeaderCls(key) {
  if (_sortKey !== key) return '';
  return _sortDir === 'asc' ? 'sort-asc' : 'sort-desc';
}
/** 헤더 aria-sort 속성 값 — WAI-ARIA 표준 */
function ariaSortValue(key) {
  if (_sortKey !== key) return 'none';
  return _sortDir === 'asc' ? 'ascending' : 'descending';
}

/**
 * 모달 div를 body 직속으로 ensure — 부모 컨테이너의 transform/filter/will-change가
 * `position: fixed`의 viewport 기준을 깨뜨리는 회피책. (web-design-balance-pass ADR-007 보조)
 *
 * 한 번만 생성. 이후엔 동일 노드를 재사용해 backdrop이 항상 viewport 전체를 덮는다.
 */
function ensureDetailModal() {
  let modal = document.getElementById('sysLibDetailModal');
  if (modal && modal.parentElement === document.body) return modal;
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sysLibDetailModal';
    modal.className = 'syslib-detail-modal';
    modal.hidden = true;
  } else {
    modal.remove();
  }
  document.body.appendChild(modal);
  return modal;
}

/**
 * 정렬 변경 적용 — 같은 컬럼이면 방향 토글, 다른 컬럼이면 기본 방향 진입.
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
}

function bindEvents(container) {
  // 헤더 클릭/키보드 → 정렬 변경 후 재렌더 (재 fetch 없음)
  container.querySelectorAll('[data-syslib-sort]').forEach(th => {
    const onActivate = () => {
      applySortChange(th.dataset.syslibSort);
      renderContainer(container);
    };
    th.addEventListener('click', onActivate);
    th.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      onActivate();
    });
  });

  // 행 클릭 → 본문 lazy-fetch 후 모달 표시
  container.querySelectorAll('.syslib-row').forEach(row => {
    const open = () => showDetailModal(row.dataset.syslibHash);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

async function showDetailModal(hash) {
  const modal = ensureDetailModal();
  if (!modal) return;

  modal.hidden = false;
  // skeleton-loading T-11: 본문 큰 블록 영역으로 모달 높이 유지.
  modal.innerHTML = `<div class="syslib-detail-inner" data-skeleton="1">${skBlock({ height: 320 })}</div>`;

  try {
    const res = await fetchJson(`/api/system-prompts/${encodeURIComponent(hash)}`);
    const row = res?.data;
    if (!row) {
      modal.innerHTML = renderModalShell(`<p class="syslib-dim">본문을 찾을 수 없습니다.</p>`);
    } else {
      modal.innerHTML = renderModalShell(`
        <header class="syslib-detail-head">
          <code class="syslib-detail-hash">${escHtml(row.hash)}</code>
          <span>${formatBytes(row.byte_size)}</span>
          <span>seg=${escHtml(String(row.segment_count ?? '?'))}</span>
          <span>ref=${escHtml(String(row.ref_count ?? '?'))}</span>
        </header>
        <pre class="syslib-detail-content">${escHtml(row.content ?? '')}</pre>
      `);
    }
  } catch (err) {
    modal.innerHTML = renderModalShell(`<p class="syslib-dim">불러오기 실패: ${escHtml(String(err?.message ?? err))}</p>`);
  }

  // ── 닫기 동작: × 버튼 / 외부 클릭(backdrop) / ESC ── (web-design-balance-pass ADR-007)
  // body 직속 모달이라 backdrop 클릭 = modal 자기 자신 클릭(자식 영역만 inner).
  const close = () => {
    modal.hidden = true;
    modal.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  modal.querySelector('[data-syslib-close]')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();   // backdrop 영역 직접 클릭 시
  });
  document.addEventListener('keydown', onKey);
}

function renderModalShell(inner) {
  // renderCloseBtn: ds-close-btn 이중 클래스 패턴 — 기존 syslib-detail-close / data-syslib-close / aria-label 보존.
  const closeBtn = renderCloseBtn({ size: 'lg', label: '닫기', dataAttrs: { 'syslib-close': '' } })
    .replace('class="ds-close-btn"', 'class="syslib-detail-close ds-close-btn"');
  return `<div class="syslib-detail-inner">
    ${closeBtn}
    ${inner}
  </div>`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function formatBytes(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * byte_size 임계 분기 — 절대 임계 신호 (sort key 무관).
 * 단일 판단 로직 SSoT — 호출 측에서 boolean 재계산 금지.
 * (web-design-balance-pass ADR-007)
 *
 * @param {number} n  byte_size
 * @returns {string}  '' (정상) | 'syslib-size-warn' (>16KB) | 'syslib-size-large' (>32KB)
 */
function sizeClassFor(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '';
  if (n > SIZE_LARGE_THRESHOLD) return 'syslib-size-large';
  if (n > SIZE_WARN_THRESHOLD)  return 'syslib-size-warn';
  return '';
}

function formatTime(ms) {
  if (typeof ms !== 'number' || !isFinite(ms)) return '-';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// =============================================================================
// 정렬 — COMPARATORS 맵 + dispatcher (Behavior Definitions 패턴 동일 SSoT)
//
// 캡슐화 원칙:
//  - 컬럼별 비교는 작은 함수로 분리한다.
//  - dispatcher(applySort)는 dir에 따라 부호만 뒤집는다.
//  - null/누락값 정책은 비교 함수 내부에서만 결정 (호출 측이 분기를 떠안지 않음).
// =============================================================================

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
  hash:          (a, b) => cmpString(a.hash, b.hash),
  byte_size:     (a, b) => cmpNumber(a.byte_size, b.byte_size),
  segment_count: (a, b) => cmpNumber(a.segment_count, b.segment_count),
  ref_count:     (a, b) => cmpNumber(a.ref_count, b.ref_count),
  first_seen_at: (a, b) => cmpNumber(a.first_seen_at, b.first_seen_at),
  last_seen_at:  (a, b) => cmpNumber(a.last_seen_at, b.last_seen_at),
};

/**
 * 정렬 dispatcher — sort 키와 dir만 받아 새 배열을 반환한다 (원본 _rows 불변 유지).
 * COMPARATORS에 없는 키는 last_seen_at으로 fallback.
 */
function applySort(rows, key, dir = 'desc') {
  const cmp = COMPARATORS[key] ?? COMPARATORS.last_seen_at;
  const factor = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => factor * cmp(a, b));
}
