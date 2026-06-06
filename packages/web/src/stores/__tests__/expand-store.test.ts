/**
 * expand-store.test.ts — 펼침 행 레지스트리 단위 검증.
 *
 * keyboard-shortcuts 의 ESC DOM 우회(querySelector('[data-expand-for]').click()) 를 대체하는
 * collapseTopExpanded() 의미를 검증한다:
 *  - register/unregister 로 펼친 행의 collapse 콜백을 관리.
 *  - collapseTopExpanded 는 가장 최근 등록(LIFO) 행 하나만 닫고, 닫을 게 있었는지 boolean 반환.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useExpandStore } from '../expand-store';

beforeEach(() => {
  useExpandStore.setState({ collapsers: new Map(), expanders: new Map() });
});

describe('expand-store — collapseTopExpanded', () => {
  it('등록 행이 없으면 false 반환(ESC 다음 우선순위로 진행)', () => {
    expect(useExpandStore.getState().collapseTopExpanded()).toBe(false);
  });

  it('펼친 행 1개면 그 collapse 콜백을 호출하고 true 반환', () => {
    let hits = 0;
    useExpandStore.getState().register('req-1', () => { hits++; });
    expect(useExpandStore.getState().collapseTopExpanded()).toBe(true);
    expect(hits).toBe(1);
  });

  it('다중 펼침 시 가장 최근 등록(LIFO) 행만 닫는다', () => {
    const order: string[] = [];
    useExpandStore.getState().register('a', () => order.push('a'));
    useExpandStore.getState().register('b', () => order.push('b'));
    useExpandStore.getState().register('c', () => order.push('c'));
    expect(useExpandStore.getState().collapseTopExpanded()).toBe(true);
    expect(order).toEqual(['c']);
  });

  it('unregister 후에는 해당 행을 닫지 않는다', () => {
    let hits = 0;
    useExpandStore.getState().register('req-1', () => { hits++; });
    useExpandStore.getState().unregister('req-1');
    expect(useExpandStore.getState().collapseTopExpanded()).toBe(false);
    expect(hits).toBe(0);
  });

  it('register 갱신 — 같은 rid 재등록 시 최신 콜백을 호출', () => {
    let which = '';
    useExpandStore.getState().register('req-1', () => { which = 'old'; });
    useExpandStore.getState().register('req-1', () => { which = 'new'; });
    useExpandStore.getState().collapseTopExpanded();
    expect(which).toBe('new');
  });
});

describe('expand-store — expandByRid (chip-jump 정공법: 합성 click 대체)', () => {
  it('등록된 expander 가 없으면 false 반환(silent no-op)', () => {
    expect(useExpandStore.getState().expandByRid('none')).toBe(false);
  });

  it('등록된 expander 를 호출하고 true 반환', () => {
    let hits = 0;
    useExpandStore.getState().registerExpander('req-1', () => { hits++; });
    expect(useExpandStore.getState().expandByRid('req-1')).toBe(true);
    expect(hits).toBe(1);
  });

  it('unregisterExpander 후에는 호출하지 않는다(언마운트 누수 차단)', () => {
    let hits = 0;
    useExpandStore.getState().registerExpander('req-1', () => { hits++; });
    useExpandStore.getState().unregisterExpander('req-1');
    expect(useExpandStore.getState().expandByRid('req-1')).toBe(false);
    expect(hits).toBe(0);
  });

  it('재등록 시 최신 콜백을 호출(rid 동일 행 재마운트 대응)', () => {
    let which = '';
    useExpandStore.getState().registerExpander('req-1', () => { which = 'old'; });
    useExpandStore.getState().registerExpander('req-1', () => { which = 'new'; });
    useExpandStore.getState().expandByRid('req-1');
    expect(which).toBe('new');
  });

  it('idempotent — expander 가 set-true 면 반복 호출해도 펼침 유지(토글 닫힘 회피)', () => {
    // RequestRow 의 expander 는 () => setExpanded(true) 라 토글이 아니다. 같은 의미를 모킹.
    let state = false;
    useExpandStore.getState().registerExpander('req-1', () => { state = true; });
    useExpandStore.getState().expandByRid('req-1');
    useExpandStore.getState().expandByRid('req-1');
    expect(state).toBe(true);
  });

  it('collapse 와 expand 레지스트리는 독립 — expander 호출이 collapser 에 영향 없음', () => {
    let collapsed = 0;
    useExpandStore.getState().register('req-1', () => { collapsed++; });
    useExpandStore.getState().registerExpander('req-1', () => {});
    useExpandStore.getState().expandByRid('req-1');
    expect(collapsed).toBe(0); // expand 는 collapse 콜백을 건드리지 않는다.
    expect(useExpandStore.getState().collapseTopExpanded()).toBe(true); // collapser 는 여전히 살아있다.
  });
});
