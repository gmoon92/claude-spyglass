/**
 * filter-bar.test.tsx — FilterBar TSX 계약 + 스토어 연동 검증 (P2-08)
 *
 * 원본: assets/js/components/filter-bar.js createFilterBar.
 *  - 그룹 3개: all / request(prompt,system) / tool(tool_call,agent,skill,mcp). (filter-bar.js:9-32)
 *  - 버튼 마크업: ds-filter-btn type-filter-btn type-filter-{key}[ active], aria-pressed,
 *    data-{dataAttr}="{key}", data-strength="soft", title?(있을 때만). (:48-54)
 *  - 그룹 wrapper: .filter-group.filter-group--{group}, aria-label?(request/tool 만). (:43-56)
 *
 * 전략:
 *  - 마크업/셀렉터/aria 계약: renderToStaticMarkup 으로 검증(컴포넌트가 react-i18next useTranslation
 *    으로 직접 구독 → vitest.setup 의 기본 passthrough t 가 키 문자열을 그대로 반환).
 *  - 스토어 연동: 컴포넌트가 hook(useTranslation)을 쓰므로 plain 함수 호출이 아닌 라이브 렌더
 *    (createRoot+act)로 click→onChange→store end-to-end 를 검증(filter ↔ app-store).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensureDom } from '../../test-support/ensure-dom';
import { FilterBar, FILTER_GROUPS } from '../FilterBar';
import { useAppStore } from '../../stores/app-store';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  useAppStore.setState({ feedFilter: 'all', detailFilter: 'all' });
});

describe('FilterBar — 그룹/버튼 DOM 계약', () => {
  it('3개 그룹(all/request/tool) wrapper 를 렌더', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="all" />);
    expect(html).toContain('filter-group filter-group--all');
    expect(html).toContain('filter-group filter-group--request');
    expect(html).toContain('filter-group filter-group--tool');
  });

  it('FILTER_GROUPS 구조는 원본 키 집합을 보존', () => {
    const keys = FILTER_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(keys).toEqual(['all', 'prompt', 'system', 'tool_call', 'agent', 'skill', 'mcp']);
  });

  it('버튼 클래스 계약: ds-filter-btn type-filter-btn type-filter-{key}', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="all" />);
    expect(html).toContain('type-filter-btn type-filter-all');
    expect(html).toContain('type-filter-btn type-filter-tool_call');
    expect(html).toContain('type-filter-btn type-filter-mcp');
  });

  it('data-{dataAttr} 속성으로 필터 키를 식별(셀렉터 계약)', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="feed-filter" active="all" />);
    expect(html).toContain('data-feed-filter="all"');
    expect(html).toContain('data-feed-filter="agent"');
  });

  it('active 버튼만 active 클래스 + aria-pressed=true, 나머지는 false', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="agent" />);
    // agent 버튼: active + aria-pressed true
    expect(html).toMatch(/type-filter-agent active"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*type-filter-agent active/);
    // all 버튼: active 클래스 없음 + aria-pressed false
    expect(html).toMatch(/aria-pressed="false"/);
    expect(html).not.toContain('type-filter-all active');
  });

  it('request/tool 그룹은 aria-label, all 그룹은 미부여', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="all" />);
    // 키 'tool_call' 등은 하이픈 세그먼트로 변환 — 그룹 aria 는 request-type/tool-category.
    expect(html).toContain('aria-label="ui:filter-bar.request-type"');
    expect(html).toContain('aria-label="ui:filter-bar.tool-category"');
    // all 그룹 wrapper 에는 aria-label 없음
    expect(html).not.toContain('filter-group--all" aria-label');
  });

  it('title 이 있는 항목만 title 속성(all 은 없음)', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="all" />);
    expect(html).toContain('title="ui:filter-bar.prompt-title"');
    // all 은 hasTitle=false → title 속성 자체가 없음
    expect(html).not.toContain('title="ui:filter-bar.all-title"');
  });

  it('key 의 언더스코어는 하이픈 세그먼트로 i18n 키 해석(tool_call→tool-call)', () => {
    const html = renderToStaticMarkup(<FilterBar dataAttr="filter" active="all" />);
    // 버튼 라벨/타이틀 키가 하이픈으로 정규화되는지(원본 filter-bar.js 매핑 1:1).
    expect(html).toContain('>ui:filter-bar.tool-call<');
    expect(html).toContain('title="ui:filter-bar.tool-call-title"');
  });
});

describe('FilterBar — 스토어 연동(feedFilter ↔ app-store)', () => {
  // 컴포넌트가 useTranslation(hook)을 쓰므로 plain 함수 호출이 아닌 라이브 렌더로 검증한다.
  let liveContainer: HTMLElement;
  let liveRoot: Root;
  beforeEach(() => {
    liveContainer = document.createElement('div');
    document.body.appendChild(liveContainer);
    liveRoot = createRoot(liveContainer);
  });
  afterEach(() => {
    act(() => liveRoot.unmount());
    document.body.innerHTML = '';
  });

  it('skill 버튼 클릭 → onChange→setFeedFilter 로 store.feedFilter 갱신', () => {
    act(() =>
      liveRoot.render(
        <FilterBar
          dataAttr="filter"
          active="all"
          onChange={(f) => useAppStore.getState().setFeedFilter(f)}
        />,
      ),
    );
    const skillBtn = liveContainer.querySelector<HTMLElement>('[data-filter="skill"]')!;
    expect(skillBtn).not.toBeNull();
    act(() => skillBtn.click());
    expect(useAppStore.getState().feedFilter).toBe('skill');
  });

  it('store.feedFilter 를 active prop 으로 받으면 해당 버튼이 aria-pressed=true', () => {
    useAppStore.getState().setFeedFilter('mcp');
    const html = renderToStaticMarkup(
      <FilterBar dataAttr="filter" active={useAppStore.getState().feedFilter} />
    );
    expect(html).toMatch(/type-filter-mcp active"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*type-filter-mcp active/);
  });

  it('detailFilter 슬라이스도 동일 컴포넌트로 독립 연동 가능(system 버튼 클릭)', () => {
    act(() =>
      liveRoot.render(
        <FilterBar
          dataAttr="detail-filter"
          active="all"
          onChange={(f) => useAppStore.getState().setDetailFilter(f)}
        />,
      ),
    );
    const sysBtn = liveContainer.querySelector<HTMLElement>('[data-detail-filter="system"]')!;
    expect(sysBtn).not.toBeNull();
    act(() => sysBtn.click());
    expect(useAppStore.getState().detailFilter).toBe('system');
    expect(useAppStore.getState().feedFilter).toBe('all'); // 비간섭
  });
});
