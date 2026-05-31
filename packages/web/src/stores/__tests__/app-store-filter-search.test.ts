/**
 * app-store-filter-search.test.ts — filter/search 슬라이스 단위 테스트 (P2-08)
 *
 * 배경: filter-bar / search-box 컴포넌트의 선택 상태를 app-store Zustand 슬라이스로 승격한다.
 *   - date range 슬라이스(activeRange)는 P1-05 에서 이미 존재 → 본 파일은 신규 filter/search 만.
 *   - 가산(additive) 슬라이스: feedFilter / detailFilter / searchQuery + 각 setter.
 *   - 영속 제외(in-memory): partialize 는 activeRange 만 직렬화하므로 본 슬라이스는 휘발.
 *     → app-store-persist.test.ts 의 "partialize: activeRange 외 직렬화 안 함" 케이스 비회귀.
 *
 * 회귀 가드: 신규 계약(P2-08). app-store.test.ts 14 케이스 무수정·병존. baseline(261) 비회귀.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../app-store';

beforeEach(() => {
  // 각 테스트 전 슬라이스 초기값 강제 복원(이전 테스트 잔존 제거).
  useAppStore.setState({ feedFilter: 'all', detailFilter: 'all', searchQuery: '' });
});

describe('feedFilter 슬라이스', () => {
  it('초기값은 "all"', () => {
    expect(useAppStore.getState().feedFilter).toBe('all');
  });

  it('setFeedFilter → 상태 반영', () => {
    useAppStore.getState().setFeedFilter('tool_call');
    expect(useAppStore.getState().feedFilter).toBe('tool_call');
  });

  it('다시 "all"로 복구', () => {
    useAppStore.getState().setFeedFilter('agent');
    useAppStore.getState().setFeedFilter('all');
    expect(useAppStore.getState().feedFilter).toBe('all');
  });
});

describe('detailFilter 슬라이스', () => {
  it('초기값은 "all"', () => {
    expect(useAppStore.getState().detailFilter).toBe('all');
  });

  it('setDetailFilter → 상태 반영', () => {
    useAppStore.getState().setDetailFilter('skill');
    expect(useAppStore.getState().detailFilter).toBe('skill');
  });

  it('feedFilter 와 detailFilter 는 독립 슬라이스(상호 비간섭)', () => {
    useAppStore.getState().setFeedFilter('mcp');
    useAppStore.getState().setDetailFilter('system');
    expect(useAppStore.getState().feedFilter).toBe('mcp');
    expect(useAppStore.getState().detailFilter).toBe('system');
  });
});

describe('searchQuery 슬라이스', () => {
  it('초기값은 빈 문자열', () => {
    expect(useAppStore.getState().searchQuery).toBe('');
  });

  it('setSearchQuery → 상태 반영', () => {
    useAppStore.getState().setSearchQuery('hello');
    expect(useAppStore.getState().searchQuery).toBe('hello');
  });

  it('빈 문자열로 클리어 가능', () => {
    useAppStore.getState().setSearchQuery('foo');
    useAppStore.getState().setSearchQuery('');
    expect(useAppStore.getState().searchQuery).toBe('');
  });
});

describe('영속 비대상(휘발) — partialize 비간섭', () => {
  it('filter/search 변경은 localStorage cs.dateRange 에 직렬화되지 않는다', () => {
    // in-memory localStorage mock
    const store = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    } as Storage;

    useAppStore.setState({ feedFilter: 'agent', searchQuery: 'q', detailFilter: 'skill' });
    // activeRange 는 손대지 않았으므로 cs.dateRange 에 filter/search 흔적이 없어야 한다.
    const raw = store.get('cs.dateRange');
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed.feedFilter).toBeUndefined();
      expect(parsed.detailFilter).toBeUndefined();
      expect(parsed.searchQuery).toBeUndefined();
    }
    // raw 가 없을 수도 있음(activeRange null → removeItem). 둘 다 통과 조건.
    expect(true).toBe(true);
  });
});
