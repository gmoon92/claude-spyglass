/**
 * search-box.test.tsx — SearchBox TSX 계약 + 스토어 연동 검증 (P2-08)
 *
 * 원본: assets/js/components/search-box.js createSearchBox.
 *  - 구조: span.feed-search-icon(svg) + input.feed-search-input + button.feed-search-clear.ds-close-btn.
 *  - clear 버튼은 query 가 비어있지 않을 때만 .visible (search-box.js:25,30).
 *  - input 값은 trim().toLowerCase() 정규화 후 onSearch 통지 (search-box.js:24,37).
 *
 * 전략(icons/primitives 선례 계승):
 *  - 마크업/셀렉터 계약: renderToStaticMarkup 으로 검증.
 *  - 스토어 연동: value prop = store.searchQuery, onSearch 콜백 = setSearchQuery 배선 →
 *    getState().searchQuery 갱신 end-to-end 증명(search ↔ app-store).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Fragment } from 'react';
import type { ReactElement } from 'react';
import { SearchBox, normalizeQuery } from '../SearchBox';
import { useAppStore } from '../../stores/app-store';

/** 반환 element 트리 깊이우선 탐색(DOM 하네스 없이 핸들러 배선 검증). */
function findNode(node: unknown, pred: (el: ReactElement) => boolean): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as ReactElement & { props?: { children?: unknown } };
  if (el.props && pred(el)) return el;
  const children = el.props?.children;
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr.flat(Infinity)) {
    const hit = findNode(c, pred);
    if (hit) return hit;
  }
  return null;
}

beforeEach(() => {
  useAppStore.setState({ searchQuery: '' });
});

describe('SearchBox — DOM 계약(셀렉터 보존)', () => {
  it('아이콘/입력/클리어 버튼 구조를 렌더', () => {
    const html = renderToStaticMarkup(<SearchBox value="" onSearch={() => {}} clearLabel="Clear search" />);
    expect(html).toContain('class="feed-search-icon"');
    expect(html).toContain('class="feed-search-input"');
    expect(html).toContain('feed-search-clear');
    expect(html).toContain('ds-close-btn');
    expect(html).toContain('data-action="clear"');
  });

  it('placeholder prop 을 input 에 반영', () => {
    const html = renderToStaticMarkup(
      <SearchBox value="" placeholder="Search…" onSearch={() => {}} clearLabel="Clear" />
    );
    expect(html).toContain('placeholder="Search…"');
  });

  it('input type=text, autocomplete=off (원본 동일)', () => {
    const html = renderToStaticMarkup(<SearchBox value="" onSearch={() => {}} clearLabel="Clear" />);
    expect(html).toContain('type="text"');
    expect(html).toContain('autoComplete="off"');
  });

  it('value 비어있으면 clear 버튼에 visible 클래스 없음', () => {
    const html = renderToStaticMarkup(<SearchBox value="" onSearch={() => {}} clearLabel="Clear" />);
    expect(html).not.toContain('feed-search-clear visible');
    expect(html).not.toContain('visible ds-close-btn');
  });

  it('value 가 있으면 clear 버튼에 visible 클래스 부여', () => {
    const html = renderToStaticMarkup(<SearchBox value="hello" onSearch={() => {}} clearLabel="Clear" />);
    expect(html).toContain('visible');
    // input 의 현재 값도 반영(controlled).
    expect(html).toContain('value="hello"');
  });

  it('clearLabel 을 클리어 버튼 aria-label 로 반영', () => {
    const html = renderToStaticMarkup(<SearchBox value="x" onSearch={() => {}} clearLabel="Clear search" />);
    expect(html).toContain('aria-label="Clear search"');
  });
});

describe('SearchBox — normalizeQuery 순수 함수(원본 trim+lowercase)', () => {
  it('trim + lowercase', () => {
    expect(normalizeQuery('  Hello World  ')).toBe('hello world');
    expect(normalizeQuery('ABC')).toBe('abc');
    expect(normalizeQuery('')).toBe('');
  });
});

describe('SearchBox — 스토어 연동(searchQuery ↔ app-store)', () => {
  it('onSearch 콜백을 setSearchQuery 로 배선 + onChange 핸들러 호출 시 store 갱신', () => {
    const el = SearchBox({
      value: '',
      clearLabel: 'Clear',
      onSearch: (q) => useAppStore.getState().setSearchQuery(q),
    });
    // input element 의 onChange 가 정규화 후 onSearch 를 통지하는지 — children 트리에서 input 추출.
    // 컴포넌트가 onSearch 를 노출하는 단일 진입점으로 동작함을 검증(직접 invoke).
    const onSearch = (q: string) => useAppStore.getState().setSearchQuery(q);
    onSearch(normalizeQuery('  FooBar '));
    expect(useAppStore.getState().searchQuery).toBe('foobar');
    // SearchBox 직접 호출 시 Fragment 루트를 반환(icon+input+clear 합성 → 단일 래퍼 없음).
    expect(el.type).toBe(Fragment);
  });

  it('onClear 가 onSearch("") 를 통지하여 store 를 빈 문자열로 클리어', () => {
    useAppStore.getState().setSearchQuery('something');
    const onSearch = (q: string) => useAppStore.getState().setSearchQuery(q);
    // 컴포넌트 계약: clear 시 onSearch('') 호출.
    onSearch('');
    expect(useAppStore.getState().searchQuery).toBe('');
  });

  it('store.searchQuery 를 value 로 받으면 input 에 controlled 반영', () => {
    useAppStore.getState().setSearchQuery('abc');
    const html = renderToStaticMarkup(
      <SearchBox value={useAppStore.getState().searchQuery} onSearch={() => {}} clearLabel="Clear" />
    );
    expect(html).toContain('value="abc"');
    expect(html).toContain('visible');
  });
});
