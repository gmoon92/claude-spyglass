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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensureDom } from '../../test-support/ensure-dom';
import { DateRangeDropdown, DATE_RANGE_PRESETS } from '../DateRangeDropdown';
import { useAppStore } from '../../stores/app-store';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  // 컴포넌트가 useState(controlled custom)를 쓰므로 plain 함수 호출이 아닌 라이브 렌더로 검증한다.
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

  it('7d 옵션 클릭 → onSelectPreset→setActiveRange 로 store.activeRange 갱신', () => {
    act(() =>
      liveRoot.render(
        <DateRangeDropdown
          activeRange={{ type: 'preset', value: 'all' }}
          labeler={labeler}
          open
          onSelectPreset={(v) => useAppStore.getState().setActiveRange({ type: 'preset', value: v })}
        />,
      ),
    );
    const opt7d = liveContainer.querySelector<HTMLElement>('[data-value="7d"]')!;
    expect(opt7d).not.toBeNull();
    act(() => opt7d.click());
    expect(useAppStore.getState().activeRange).toEqual({ type: 'preset', value: '7d' });
  });

  it('apply 버튼이 listbox footer 에 존재(셀렉터 계약)', () => {
    act(() =>
      liveRoot.render(<DateRangeDropdown activeRange={{ type: 'preset', value: 'all' }} labeler={labeler} open />),
    );
    const applyBtn = liveContainer.querySelector<HTMLButtonElement>('[data-role="custom-apply"]');
    expect(applyBtn).not.toBeNull();
  });

  it('store.activeRange 를 prop 으로 받아 렌더하면 라벨이 store 상태를 반영(셀렉터 연동)', () => {
    useAppStore.getState().setActiveRange({ type: 'preset', value: 'yesterday' });
    const ar = useAppStore.getState().activeRange;
    const html = renderToStaticMarkup(<DateRangeDropdown activeRange={ar} labeler={labeler} />);
    expect(html).toContain('label:yesterday');
    expect(html).toMatch(/data-value="yesterday"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-value="yesterday"/);
  });
});

describe('DateRangeDropdown — controlled custom 입력(DOM 역참조 제거)', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
  });

  it('custom from/to input 에 값을 입력하고 apply 클릭 → onApplyCustom(from<=to ms) 통지', () => {
    let applied: { from: number; to: number } | null = null;
    act(() =>
      root.render(
        <DateRangeDropdown
          activeRange={{ type: 'preset', value: 'all' }}
          labeler={labeler}
          open
          onApplyCustom={(from, to) => {
            applied = { from, to };
          }}
        />,
      ),
    );
    const fromEl = container.querySelector<HTMLInputElement>('[data-role="custom-from"]')!;
    const toEl = container.querySelector<HTMLInputElement>('[data-role="custom-to"]')!;
    const applyBtn = container.querySelector<HTMLButtonElement>('[data-role="custom-apply"]')!;
    expect(fromEl).not.toBeNull();
    // controlled input — React onChange 로 state 갱신(네이티브 setter 후 input 이벤트 dispatch).
    const setVal = (el: HTMLInputElement, v: string): void => {
      const proto = Object.getPrototypeOf(el) as object;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    act(() => {
      setVal(fromEl, '2026-01-01');
      setVal(toEl, '2026-01-31');
    });
    // controlled 반영 확인(DOM value 가 state 를 따라감).
    expect(fromEl.value).toBe('2026-01-01');
    expect(toEl.value).toBe('2026-01-31');
    act(() => applyBtn.click());
    expect(applied).not.toBeNull();
    // 로컬 자정(from) / 종일(to) ms — isoDateToLocalMs 계약(from < to).
    expect(applied!.from).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime());
    expect(applied!.to).toBe(new Date(2026, 0, 31, 23, 59, 59, 999).getTime());
  });

  it('역순(from>to) 입력 시 apply 는 no-op(레거시 순서 가드 동치)', () => {
    let called = false;
    act(() =>
      root.render(
        <DateRangeDropdown
          activeRange={{ type: 'preset', value: 'all' }}
          labeler={labeler}
          open
          onApplyCustom={() => {
            called = true;
          }}
        />,
      ),
    );
    const fromEl = container.querySelector<HTMLInputElement>('[data-role="custom-from"]')!;
    const toEl = container.querySelector<HTMLInputElement>('[data-role="custom-to"]')!;
    const applyBtn = container.querySelector<HTMLButtonElement>('[data-role="custom-apply"]')!;
    const setVal = (el: HTMLInputElement, v: string): void => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, 'value')?.set;
      setter?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    act(() => {
      setVal(fromEl, '2026-02-10');
      setVal(toEl, '2026-02-01');
    });
    act(() => applyBtn.click());
    expect(called).toBe(false);
  });

  it('menuStyle prop 을 .ds-dropdown-menu 의 인라인 style 로 바인딩(선언형 위치 주입)', () => {
    act(() =>
      root.render(
        <DateRangeDropdown
          activeRange={{ type: 'preset', value: 'all' }}
          labeler={labeler}
          open
          menuStyle={{ left: '120px', top: '40px' }}
        />,
      ),
    );
    const menu = container.querySelector<HTMLElement>('.ds-dropdown-menu')!;
    expect(menu).not.toBeNull();
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('40px');
  });
});
