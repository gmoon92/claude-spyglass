/**
 * date-range-dropdown.test.tsx — DateRangeDropdown TSX 계약 + 스토어 연동 검증 (P2-08)
 *
 * 전략(icons/primitives 선례 계승 — DOM 하네스 없음):
 *  1) 마크업/aria/셀렉터 계약: renderToStaticMarkup 결과가 원본 date-range-dropdown.js
 *     의 DOM 계약(combobox/listbox/option, data-value, aria-selected)을 1:1 보존하는지 검증.
 *     원본은 mountDateRangeDropdown(container) 가 container.innerHTML 에 셸을 주입한다(:70 renderShell).
 *  2) 스토어 연동: 컴포넌트는 controlled — activeRange prop 으로 라벨/aria-selected 를 그리고,
 *     onSelectPreset/onApplyCustom 콜백을 받는다. 콜백을 useAppStore.setActiveRange 로 배선했을 때
 *     getState().activeRange 가 갱신됨을 end-to-end 로 증명(date range ↔ app-store 슬라이스).
 *
 * date-range 회귀 0: 원본 .js 무수정·병존. api.js setActiveRange/getActiveRange 계약 불변.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { DateRangeDropdown, DATE_RANGE_PRESETS } from '../DateRangeDropdown';
import { useAppStore } from '../../stores/app-store';

/** 반환 element 트리 깊이우선 탐색(DOM 하네스 없이 핸들러 배선 검증 — primitives invoke 패턴 확장). */
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

// i18n 라벨러 — 컴포넌트는 무전역(라벨러 함수를 prop 으로 주입). 테스트는 식별 가능한 라벨 반환.
const labeler = {
  presetLabel: (v: string) => `label:${v}`,
  presetTitle: (v: string) => `title:${v}`,
  triggerAria: () => 'Select date range',
  customFrom: () => 'From',
  customTo: () => 'To',
  customApply: () => 'Apply',
  customLabel: () => 'Custom range…',
  formatCustom: (from: number, to: number) => `Custom (${from} – ${to})`,
};

beforeEach(() => {
  useAppStore.setState({ activeRange: null });
});

describe('DateRangeDropdown — DOM 계약(셀렉터/aria 보존)', () => {
  it('combobox trigger + listbox 구조를 렌더한다', () => {
    const html = renderToStaticMarkup(
      <DateRangeDropdown activeRange={{ type: 'preset', value: 'all' }} labeler={labeler} />
    );
    expect(html).toContain('class="ds-dropdown"');
    expect(html).toContain('data-component="date-range-dropdown"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('class="ds-dropdown-listbox"');
  });

  it('프리셋 6개(1h/today/yesterday/7d/30d/all)를 role=option data-value 로 렌더', () => {
    const html = renderToStaticMarkup(
      <DateRangeDropdown activeRange={{ type: 'preset', value: 'all' }} labeler={labeler} />
    );
    expect(DATE_RANGE_PRESETS).toEqual(['1h', 'today', 'yesterday', '7d', '30d', 'all']);
    for (const v of DATE_RANGE_PRESETS) {
      expect(html).toContain(`role="option"`);
      expect(html).toContain(`data-value="${v}"`);
    }
  });

  it('활성 preset 항목만 aria-selected="true"', () => {
    const html = renderToStaticMarkup(
      <DateRangeDropdown activeRange={{ type: 'preset', value: '7d' }} labeler={labeler} />
    );
    // 7d 옵션은 selected, 그 외는 false. 옵션 마크업에서 data-value 와 aria-selected 가 같은 li 안.
    expect(html).toMatch(/data-value="7d"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-value="7d"/);
    expect(html).toMatch(/data-value="all"[^>]*aria-selected="false"|aria-selected="false"[^>]*data-value="all"/);
  });

  it('custom range 일 때 트리거 라벨은 formatCustom, 프리셋 항목은 모두 aria-selected=false', () => {
    const html = renderToStaticMarkup(
      <DateRangeDropdown activeRange={{ type: 'custom', from: 1, to: 2 }} labeler={labeler} />
    );
    expect(html).toContain('Custom (1 – 2)');
    expect(html).not.toContain('aria-selected="true"');
  });

  it('custom footer(from/to input + apply 버튼) 렌더', () => {
    const html = renderToStaticMarkup(
      <DateRangeDropdown activeRange={{ type: 'preset', value: 'all' }} labeler={labeler} />
    );
    expect(html).toContain('data-role="custom-from"');
    expect(html).toContain('data-role="custom-to"');
    expect(html).toContain('data-role="custom-apply"');
    expect(html).toContain('type="date"');
  });

  it('트리거 라벨은 활성 preset 의 presetLabel 을 표시', () => {
    const html = renderToStaticMarkup(
      <DateRangeDropdown activeRange={{ type: 'preset', value: 'today' }} labeler={labeler} />
    );
    expect(html).toContain('label:today');
  });
});

describe('DateRangeDropdown — 스토어 연동(activeRange ↔ app-store)', () => {
  it('7d 옵션 클릭(onClick) → onSelectPreset→setActiveRange 로 store.activeRange 갱신', () => {
    const tree = DateRangeDropdown({
      activeRange: { type: 'preset', value: 'all' },
      labeler,
      onSelectPreset: (v) => useAppStore.getState().setActiveRange({ type: 'preset', value: v }),
    });
    // 트리에서 data-value="7d" 인 role=option li 를 찾아 onClick 직접 invoke.
    const opt7d = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-value'] === '7d');
    expect(opt7d).not.toBeNull();
    expect(typeof opt7d!.props.onClick).toBe('function');
    (opt7d!.props.onClick as () => void)();
    expect(useAppStore.getState().activeRange).toEqual({ type: 'preset', value: '7d' });
  });

  it('onApplyCustom 콜백 계약: 호출 시 custom range 가 store 에 반영(apply 버튼 단일 진입점)', () => {
    // custom apply 버튼의 DOM-읽기 로직(인접 input 값 파싱)은 DOM 하네스가 필요하므로
    // 본 테스트는 onApplyCustom 콜백 계약(from,to → setActiveRange custom)만 end-to-end 검증한다.
    // (버튼→input 파싱 결선은 후속 hooks/통합 테스트 범위 — P2-08 은 스토어 연동 계약까지.)
    const onApplyCustom = (from: number, to: number) =>
      useAppStore.getState().setActiveRange({ type: 'custom', from, to });
    const tree = DateRangeDropdown({ activeRange: { type: 'preset', value: 'all' }, labeler, onApplyCustom });
    // apply 버튼이 트리에 존재(셀렉터 계약)하고 onClick 이 배선됨을 확인.
    const applyBtn = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-role'] === 'custom-apply');
    expect(applyBtn).not.toBeNull();
    expect(typeof applyBtn!.props.onClick).toBe('function');
    // 콜백 계약 직접 검증(스토어 반영).
    onApplyCustom(1000, 2000);
    expect(useAppStore.getState().activeRange).toEqual({ type: 'custom', from: 1000, to: 2000 });
  });

  it('store.activeRange 를 prop 으로 받아 렌더하면 라벨이 store 상태를 반영(셀렉터 연동)', () => {
    useAppStore.getState().setActiveRange({ type: 'preset', value: 'yesterday' });
    const ar = useAppStore.getState().activeRange;
    const html = renderToStaticMarkup(<DateRangeDropdown activeRange={ar} labeler={labeler} />);
    expect(html).toContain('label:yesterday');
    expect(html).toMatch(/data-value="yesterday"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-value="yesterday"/);
  });
});
