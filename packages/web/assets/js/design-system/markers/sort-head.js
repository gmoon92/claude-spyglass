/**
 * @module markers/sort-head
 *
 * 책임: 테이블 헤더 정렬 표지 단일 컴포넌트.
 *       정렬 상태(idle/asc/desc)를 시각적 화살표와 aria-sort 속성으로 표현하는
 *       <button> HTML 문자열을 생성한다.
 *
 * 흡수 대상:
 *   - meta-docs-view.js: sortIndicator() — ↕/↑/↓ + sort-asc/sort-desc 클래스
 *   - system-prompt-library.js: sortIndicator() — 동일 패턴
 *   - tool-stats.js: sortIndicator() — 동일 패턴
 *   (호출처 치환은 다음 wave에서 진행)
 *
 * 의존:
 *   - packages/web/assets/js/formatters.js (escHtml)
 *   - packages/web/assets/css/design-system/markers/sort-head.css
 *
 * 호출처: 다음 wave에서 meta-docs-view.js, system-prompt-library.js, tool-stats.js 교체 예정
 */

import { escHtml } from '../../formatters.js';

/** @typedef {'idle' | 'asc' | 'desc'} SortState */

/**
 * 정렬 상태에 따른 화살표 글리프를 반환한다.
 * @param {SortState} sort
 * @returns {string}
 */
function arrowGlyph(sort) {
  if (sort === 'asc') return '↑';
  if (sort === 'desc') return '↓';
  return '↕';
}

/**
 * 정렬 상태에 따른 aria-sort 값을 반환한다.
 * @param {SortState} sort
 * @returns {string}
 */
function ariaSort(sort) {
  if (sort === 'asc') return 'ascending';
  if (sort === 'desc') return 'descending';
  return 'none';
}

/**
 * 테이블 헤더 정렬 표지 버튼 HTML 문자열을 생성한다.
 *
 * @param {object} opts
 * @param {string} opts.label       - 헤더 텍스트 (escHtml 처리됨)
 * @param {SortState} [opts.sort='idle'] - 현재 정렬 상태
 * @param {string} opts.key         - data-sort-key 속성값 (컬럼 식별자)
 * @returns {string} HTML 문자열
 *
 * @example
 * renderSortHead({ label: 'Name', sort: 'asc', key: 'name' })
 * // => '<button class="ds-sort-head" data-sort="asc" data-sort-key="name" aria-sort="ascending" type="button">Name <span class="arrow">↑</span></button>'
 */
export function renderSortHead({ label, sort = 'idle', key }) {
  const safeLabel = escHtml(String(label ?? ''));
  const safeKey   = escHtml(String(key   ?? ''));
  const safeSortState = ['idle', 'asc', 'desc'].includes(sort) ? sort : 'idle';

  return `<button class="ds-sort-head" data-sort="${safeSortState}" data-sort-key="${safeKey}" aria-sort="${ariaSort(safeSortState)}" type="button">${safeLabel} <span class="arrow">${arrowGlyph(safeSortState)}</span></button>`;
}
