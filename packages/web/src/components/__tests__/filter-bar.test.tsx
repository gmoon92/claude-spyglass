/**
 * filter-bar.test.tsx — FilterBar TSX 계약 + 스토어 연동 검증 (P2-08)
 *
 * 원본: assets/js/components/filter-bar.js createFilterBar.
 *  - 그룹 3개: all / request(prompt,system) / tool(tool_call,agent,skill,mcp). (filter-bar.js:9-32)
 *  - 버튼 마크업: ds-filter-btn type-filter-btn type-filter-{key}[ active], aria-pressed,
 *    data-{dataAttr}="{key}", data-strength="soft", title?(있을 때만). (:48-54)
 *  - 그룹 wrapper: .filter-group.filter-group--{group}, aria-label?(request/tool 만). (:43-56)
 *
 * 전략(icons/primitives 선례 계승):
 *  - 마크업/셀렉터/aria 계약: renderToStaticMarkup 으로 검증.
 *  - 스토어 연동: active prop = store.feedFilter, onChange 콜백 = setFeedFilter 배선 →
 *    getState().feedFilter 갱신 + aria-pressed 동기화 end-to-end 증명(filter ↔ app-store).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { FilterBar, FILTER_GROUPS } from '../FilterBar';
import { useAppStore } from '../../stores/app-store';

/**
 * 반환 element 트리에서 조건에 맞는 첫 노드를 깊이우선 탐색(DOM 하네스 없이 핸들러 배선 검증).
 * primitives-equivalence.test 의 "props 직접 invoke" 패턴을 합성 컴포넌트로 확장 —
 * 클릭 대상(li/button)의 onClick 을 직접 호출해 click→onChange→store end-to-end 를 증명.
 */
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

// i18n 라벨러 주입(무전역). 식별 가능한 라벨/타이틀 반환.
const labeler = {
  groupAria: (g: string) => `aria:${g}`,
  itemLabel: (k: string) => `label:${k}`,
  itemTitle: (k: string) => `title:${k}`,
};

beforeEach(() => {
  useAppStore.setState({ feedFilter: 'all', detailFilter: 'all' });
});

describe('FilterBar — 그룹/버튼 DOM 계약', () => {
  it('3개 그룹(all/request/tool) wrapper 를 렌더', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="all" labeler={labeler} />);
    expect(html).toContain('filter-group filter-group--all');
    expect(html).toContain('filter-group filter-group--request');
    expect(html).toContain('filter-group filter-group--tool');
  });

  it('FILTER_GROUPS 구조는 원본 키 집합을 보존', () => {
    const keys = FILTER_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(keys).toEqual(['all', 'prompt', 'system', 'tool_call', 'agent', 'skill', 'mcp']);
  });

  it('버튼 클래스 계약: ds-filter-btn type-filter-btn type-filter-{key}', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="all" labeler={labeler} />);
    expect(html).toContain('type-filter-btn type-filter-all');
    expect(html).toContain('type-filter-btn type-filter-tool_call');
    expect(html).toContain('type-filter-btn type-filter-mcp');
  });

  it('data-{dataAttr} 속성으로 필터 키를 식별(셀렉터 계약)', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="feed-filter" active="all" labeler={labeler} />);
    expect(html).toContain('data-feed-filter="all"');
    expect(html).toContain('data-feed-filter="agent"');
  });

  it('active 버튼만 active 클래스 + aria-pressed=true, 나머지는 false', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="agent" labeler={labeler} />);
    // agent 버튼: active + aria-pressed true
    expect(html).toMatch(/type-filter-agent active"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*type-filter-agent active/);
    // all 버튼: active 클래스 없음 + aria-pressed false
    expect(html).toMatch(/aria-pressed="false"/);
    expect(html).not.toContain('type-filter-all active');
  });

  it('request/tool 그룹은 aria-label, all 그룹은 미부여', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="all" labeler={labeler} />);
    expect(html).toContain('aria-label="aria:request"');
    expect(html).toContain('aria-label="aria:tool"');
    // all 그룹 wrapper 에는 aria-label 없음
    expect(html).not.toContain('filter-group--all" aria-label');
  });

  it('title 이 있는 항목만 title 속성(all 은 없음)', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="all" labeler={labeler} />);
    expect(html).toContain('title="title:prompt"');
    expect(html).not.toContain('title="title:all"');
  });
});

describe('FilterBar — 스토어 연동(feedFilter ↔ app-store)', () => {
  it('skill 버튼 클릭(onClick) → onChange→setFeedFilter 로 store.feedFilter 갱신', () => {
    const tree = FilterBar({
      dataAttr: 'filter',
      active: 'all',
      labeler,
      onChange: (f) => useAppStore.getState().setFeedFilter(f),
    });
    // 트리에서 skill 버튼(data-filter="skill") 을 찾아 onClick 직접 invoke.
    const skillBtn = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-filter'] === 'skill');
    expect(skillBtn).not.toBeNull();
    expect(typeof skillBtn!.props.onClick).toBe('function');
    (skillBtn!.props.onClick as () => void)();
    expect(useAppStore.getState().feedFilter).toBe('skill');
  });

  it('store.feedFilter 를 active prop 으로 받으면 해당 버튼이 aria-pressed=true', () => {
    useAppStore.getState().setFeedFilter('mcp');
    const html = renderToStaticMarkup(
      <FilterBar dataAttr="filter" active={useAppStore.getState().feedFilter} labeler={labeler} />
    );
    expect(html).toMatch(/type-filter-mcp active"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*type-filter-mcp active/);
  });

  it('detailFilter 슬라이스도 동일 컴포넌트로 독립 연동 가능(system 버튼 클릭)', () => {
    const tree = FilterBar({
      dataAttr: 'detail-filter',
      active: 'all',
      labeler,
      onChange: (f) => useAppStore.getState().setDetailFilter(f),
    });
    const sysBtn = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-detail-filter'] === 'system');
    expect(sysBtn).not.toBeNull();
    (sysBtn!.props.onClick as () => void)();
    expect(useAppStore.getState().detailFilter).toBe('system');
    expect(useAppStore.getState().feedFilter).toBe('all'); // 비간섭
  });
});
