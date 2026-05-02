/**
 * system-prompt-library.js — System Prompt 라이브러리 패널 (v22 ADR-004 옵션 B)
 *
 * 책임:
 *  - dedup된 system_prompts 카탈로그를 표 형태로 노출.
 *  - 행 클릭 시 본문 lazy-fetch + 모달/사이드 패널로 전체 본문 표시.
 *  - 정렬 토글: ref_count / last_seen_at / byte_size / first_seen_at.
 *
 * 데이터 소스:
 *  - GET /api/system-prompts?orderBy=&limit=  → 메타 목록 (본문 미포함)
 *  - GET /api/system-prompts/:hash            → 본문 lazy-fetch (행 클릭 시)
 *
 * 호출자: turn-views.js setDetailView('syslib') — 탭 진입 시 자동 로드
 *
 * 골격 구현 — 시각 폴리싱(테이블 스타일·모달 디자인)은 designer 후속.
 */

import { escHtml } from './formatters.js';

const CONTAINER_ID = 'sysLibBody';
const DEFAULT_LIMIT = 100;
const ALLOWED_ORDER = ['last_seen_at', 'ref_count', 'byte_size', 'first_seen_at'];

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
const REF_HOT_RATIO        = 0.25;         // 상위 25%

let _currentOrder = 'last_seen_at';

/**
 * 라이브러리 목록 로드 + 렌더 — 탭 진입 시 호출.
 * 정렬 토글 클릭 시 같은 함수 재호출 (orderBy만 다름).
 */
export async function loadSystemPromptLibrary(orderBy) {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  if (orderBy && ALLOWED_ORDER.includes(orderBy)) {
    _currentOrder = orderBy;
  }

  container.innerHTML = `<div class="state-loading"><div class="state-loading-spinner"></div><span>카탈로그 조회 중…</span></div>`;

  try {
    const res = await fetchJson(`/api/system-prompts?orderBy=${encodeURIComponent(_currentOrder)}&limit=${DEFAULT_LIMIT}`);
    const list = Array.isArray(res?.data) ? res.data : [];
    container.innerHTML = renderHtml(list, _currentOrder);
    bindEvents(container);
  } catch (err) {
    container.innerHTML = `<div class="state-empty"><span class="state-empty-title">불러오기 실패: ${escHtml(String(err?.message ?? err))}</span></div>`;
  }
}

// =============================================================================
// 내부 helper
// =============================================================================

function renderHtml(rows, orderBy) {
  if (rows.length === 0) {
    return `<div class="state-empty"><span class="state-empty-title">시스템 프롬프트가 없습니다 (아직 dedup 카탈로그 비어있음)</span></div>`;
  }

  const sortBar = renderSortBar(orderBy);

  // ref_count Top N% 산출 — sort key가 ref_count일 때만 의미 있음 (rows는 이미 서버 정렬 완료).
  // (web-design-balance-pass ADR-007)
  const refHotCutoff = orderBy === 'ref_count'
    ? Math.max(1, Math.ceil(rows.length * REF_HOT_RATIO))
    : 0;

  const tableRows = rows.map((r, idx) => {
    const refClass  = (orderBy === 'ref_count' && idx < refHotCutoff) ? ' syslib-ref-hot' : '';
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

  return `
    ${sortBar}
    <table class="syslib-table">
      <thead>
        <tr>
          <th>Hash</th>
          <th class="num">Size</th>
          <th class="num">Seg</th>
          <th class="num">Ref</th>
          <th>First Seen</th>
          <th>Last Seen</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
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

function renderSortBar(active) {
  const labels = {
    last_seen_at: '최근 사용',
    ref_count: '빈도',
    byte_size: '크기',
    first_seen_at: '최초 등장',
  };
  const buttons = ALLOWED_ORDER.map(k => `
    <button class="syslib-sort-btn ${k === active ? 'active' : ''}" data-syslib-sort="${k}" type="button">
      ${escHtml(labels[k])}
    </button>
  `).join('');
  return `<div class="syslib-sort-bar" role="toolbar" aria-label="정렬">
    <span class="syslib-sort-label">정렬:</span>
    ${buttons}
  </div>`;
}

function bindEvents(container) {
  // 정렬 버튼 클릭
  container.querySelectorAll('[data-syslib-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      loadSystemPromptLibrary(btn.dataset.syslibSort);
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
  modal.innerHTML = `<div class="syslib-detail-inner"><div class="state-loading"><div class="state-loading-spinner"></div><span>본문 로딩 중…</span></div></div>`;

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
  return `<div class="syslib-detail-inner">
    <button class="syslib-detail-close" data-syslib-close type="button" aria-label="닫기">×</button>
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
