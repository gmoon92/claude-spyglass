/**
 * features/meta-docs/MetaDocsSearch.tsx — 카탈로그 이름 검색 입력 (P4-02)
 *
 * 원본: assets/js/meta-docs-view.js searchHtml(view.js:890) + applySearchFilter(view.js:1014).
 *  - P2-08 SearchBox(controlled) 재사용 — 검색 아이콘/클리어 버튼/정규화(trim+lower) SSoT 공유(arch §2.1).
 *  - 원본 input value 는 raw(state.searchTerm) 였으나, 가시성 매칭은 trim+lower(view.js:1015).
 *    SearchBox onSearch 는 normalizeQuery(trim+lower) 통지 — 호출처(셸)가 store searchText 갱신 +
 *    MetaDocsCatalog searchTerm prop 로 주입(re-fetch 없이 hidden 토글, view.js:1019 동치).
 *  - 무전역: placeholder/clearLabel 명시 prop(원본 window.I18n.t 대체).
 *
 * @module features/meta-docs/MetaDocsSearch
 */
import type { ReactElement } from 'react';
import { SearchBox } from '../../components/SearchBox';

export interface MetaDocsSearchProps {
  /** 현재 검색어(컨트롤드). 호출처가 store searchText 주입. */
  value: string;
  /** placeholder(원본 ui.meta-docs-view.search-placeholder). */
  placeholder: string;
  /** 클리어 버튼 aria-label. */
  clearLabel: string;
  /** 정규화된 질의 통지(입력/클리어 단일 진입점). */
  onSearch: (query: string) => void;
}

export function MetaDocsSearch({ value, placeholder, clearLabel, onSearch }: MetaDocsSearchProps): ReactElement {
  // 원본 .meta-docs-search-wrap 컨테이너 유지(셀렉터 계약) + 내부는 P2-08 SearchBox.
  return (
    <div className="meta-docs-search-wrap">
      <SearchBox value={value} placeholder={placeholder} clearLabel={clearLabel} onSearch={onSearch} />
    </div>
  );
}
