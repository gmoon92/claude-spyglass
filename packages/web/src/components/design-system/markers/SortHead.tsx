/**
 * design-system/markers/SortHead.tsx — 테이블 헤더 정렬 표지 버튼 (P2-03)
 *
 * 원본: assets/js/design-system/markers/sort-head.js renderSortHead.
 *  - 정렬 상태(idle/asc/desc)를 화살표 글리프(↕/↑/↓) + aria-sort 속성으로 표현.
 *  - 출력 HTML(class·data-sort·data-sort-key·aria-sort·type 속성/순서, 라벨·화살표 구조)을
 *    원본 문자열과 **동치**로 유지.
 *
 * 동치 비교 주의:
 *  - 원본은 label/key 를 formatters.escHtml 로 이스케이프하고 문자열 보간한다.
 *  - 본 컴포넌트는 동일 텍스트를 JSX children/attr 로 전달 → React 가 동등 이스케이프 수행.
 *  - 라벨과 arrow span 사이 공백 1칸(원본 `${label} <span...`)을 children 으로 명시 보존.
 *
 * @module design-system/markers/SortHead
 */

/** 정렬 상태 — 원본 SortState 와 동일. */
export type SortState = 'idle' | 'asc' | 'desc';

/**
 * SortHead 컴포넌트 props — 원본 renderSortHead opts 와 1:1.
 *
 * 주의: 원본 JS 의 `key` 옵션은 React 예약 prop(`key`)과 충돌하므로 `sortKey` 로 이름을 바꾼다.
 * 의미·출력(data-sort-key)은 동일하며, prop 명만 React 관례에 맞춘 것이다.
 */
export interface SortHeadProps {
  /** 헤더 텍스트. JSX children 으로 전달돼 React 가 이스케이프(원본 escHtml 대응). */
  label?: string;
  /** 현재 정렬 상태. 미지정/비유효 → 'idle'(원본 fallback 동일). */
  sort?: SortState;
  /** data-sort-key 속성값(컬럼 식별자). 원본 escHtml 대응. (원본 opts.key 에 대응) */
  sortKey?: string;
}

/** 정렬 상태별 화살표 글리프(원본 arrowGlyph 와 1:1). */
function arrowGlyph(sort: SortState): string {
  if (sort === 'asc') return '↑';
  if (sort === 'desc') return '↓';
  return '↕';
}

/** aria-sort 속성 허용 값(React ButtonHTMLAttributes 의 aria-sort 유니온과 정합). */
type AriaSort = 'none' | 'ascending' | 'descending' | 'other';

/** 정렬 상태별 aria-sort 값(원본 ariaSort 와 1:1). */
function ariaSortValue(sort: SortState): AriaSort {
  if (sort === 'asc') return 'ascending';
  if (sort === 'desc') return 'descending';
  return 'none';
}

const VALID_SORTS: readonly SortState[] = ['idle', 'asc', 'desc'];

/**
 * 테이블 헤더 정렬 표지 버튼 — 원본 renderSortHead 의 속성/순서/구조를 그대로 재현.
 *
 * 속성 순서(동치 핵심):
 *   class → data-sort → data-sort-key → aria-sort → type.
 * 내부 구조: `{label} <span class="arrow">{glyph}</span>` (라벨·화살표 사이 공백 1칸 보존).
 */
export function SortHead({ label, sort = 'idle', sortKey }: SortHeadProps) {
  const safeLabel = String(label ?? '');
  const safeKey = String(sortKey ?? '');
  const safeSort: SortState = VALID_SORTS.includes(sort) ? sort : 'idle';
  return (
    <button
      className="ds-sort-head"
      data-sort={safeSort}
      data-sort-key={safeKey}
      aria-sort={ariaSortValue(safeSort)}
      type="button"
    >
      {safeLabel} <span className="arrow">{arrowGlyph(safeSort)}</span>
    </button>
  );
}
