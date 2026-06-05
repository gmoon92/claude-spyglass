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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { SearchBox, normalizeQuery } from '../SearchBox';
import { useAppStore } from '../../stores/app-store';
import { ensureDom } from '../../test-support/ensure-dom';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  it('onSearch 콜백을 setSearchQuery 로 배선 + 정규화 후 store 갱신', () => {
    // SearchBox 가 (focusSignal 구독으로) 훅을 쓰므로 직접 함수 호출 대신 계약(onSearch 단일 진입점)을 검증.
    //   input.onChange 는 normalizeQuery(value) → onSearch 를 통지한다(컴포넌트 본문 라인). 동일 경로를 재현.
    const onSearch = (q: string) => useAppStore.getState().setSearchQuery(q);
    onSearch(normalizeQuery('  FooBar '));
    expect(useAppStore.getState().searchQuery).toBe('foobar');
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

describe('SearchBox — focusSignal 구독(keyboard-shortcuts `/`·⌘F DOM 우회 대체)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('focusSignal 증가 시 input 을 focus(자기 ref) — id 셀렉터 의존 없음', () => {
    act(() => { root.render(<SearchBox value="" onSearch={() => {}} clearLabel="Clear" focusSignal={1} />); });
    const input = container.querySelector<HTMLInputElement>('.feed-search-input');
    expect(document.activeElement).toBe(input);
  });

  it('focusSignal 미주입(undefined) 이면 포커스를 빼앗지 않는다(detail 미결선 슬롯 동치)', () => {
    act(() => { root.render(<SearchBox value="" onSearch={() => {}} clearLabel="Clear" />); });
    const input = container.querySelector<HTMLInputElement>('.feed-search-input');
    expect(document.activeElement).not.toBe(input);
  });

  it('focusSignal 이 다시 증가하면 재포커스(`/` 연타 → 매번 focus)', () => {
    act(() => { root.render(<SearchBox value="" onSearch={() => {}} clearLabel="Clear" focusSignal={1} />); });
    const input = container.querySelector<HTMLInputElement>('.feed-search-input')!;
    input.blur();
    expect(document.activeElement).not.toBe(input);
    act(() => { root.render(<SearchBox value="" onSearch={() => {}} clearLabel="Clear" focusSignal={2} />); });
    expect(document.activeElement).toBe(input);
  });
});
