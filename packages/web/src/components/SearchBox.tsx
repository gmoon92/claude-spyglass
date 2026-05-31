/**
 * components/SearchBox.tsx — 검색 박스 컴포넌트 (P2-08)
 *
 * 원본: assets/js/components/search-box.js createSearchBox.
 *  - 구조: span.feed-search-icon(svgSearch) + input.feed-search-input + button.feed-search-clear.ds-close-btn.
 *  - clear 버튼은 질의가 비어있지 않을 때만 .visible (search-box.js:25,30).
 *  - 입력 정규화: trim().toLowerCase() 후 onSearch 통지 (search-box.js:24,37). normalizeQuery 로 추출.
 *
 * 원본 대비 변경(신규 계약):
 *  - 명령형 createSearchBox(controller 반환) → controlled React 컴포넌트(value + onSearch props).
 *    상태 SSoT 는 호출처(app-store searchQuery 슬라이스). 컴포넌트는 표현 + 통지만.
 *  - 전역 window.I18n 의존 제거 → clearLabel 을 명시 prop 으로 주입(레이어 규칙: 컴포넌트 무전역).
 *  - SSoT 우회 회피: 검색 아이콘 SVG/클리어 글리프는 원본 svgSearch/feed-search-clear 마크업을
 *    1:1 재현(동시작업 중인 icons/primitives barrel 미참조 — churn 내성). 색은 currentColor 상속.
 *
 * 셀렉터 계약 유지(arch §2.2): feed-search-icon / feed-search-input / feed-search-clear / data-action="clear".
 *
 * @module components/SearchBox
 */

/** 원본 search-box.js 의 입력 정규화 — trim + lowercase (검색 매칭 SSoT). */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface SearchBoxProps {
  /** 현재 질의(controlled). 호출처가 app-store.searchQuery 를 주입. */
  value: string;
  /** placeholder 텍스트(i18n 은 호출처 책임). */
  placeholder?: string;
  /** 정규화된 질의 통지(입력/클리어 모두 단일 진입점). */
  onSearch: (query: string) => void;
  /** 클리어 버튼 aria-label(원본 window.I18n.t('ui.search-box.clear-label') 대체). */
  clearLabel: string;
}

export function SearchBox({ value, placeholder = '', onSearch, clearLabel }: SearchBoxProps) {
  const hasValue = value.length > 0;
  // 원본 svgSearch({ size:14, className:'feed-search-icon-svg' }) 마크업 1:1 (circle r=4.5 + 손잡이 line).
  return (
    <>
      <span className="feed-search-icon">
        <svg
          className="feed-search-icon-svg"
          aria-hidden="true"
          viewBox="0 0 16 16"
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
      </span>
      <input
        className="feed-search-input"
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        onChange={(e) => onSearch(normalizeQuery(e.currentTarget.value))}
      />
      <button
        className={hasValue ? 'feed-search-clear ds-close-btn visible' : 'feed-search-clear ds-close-btn'}
        type="button"
        data-size="sm"
        aria-label={clearLabel}
        data-action="clear"
        onClick={() => onSearch('')}
      >
        ×
      </button>
    </>
  );
}
