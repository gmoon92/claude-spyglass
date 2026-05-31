/**
 * primitives-equivalence.test.tsx — TSX primitives ↔ 원본 JS render* 동치 + 핸들러 prop 검증 (P2-02)
 *
 * 전략(done_criteria 2축):
 *  1) 마크업 동치: 원본 assets/js/design-system/primitives/*.js 의 render* 함수가 반환하는
 *     HTML 문자열과, 신규 src/components/design-system/primitives/*.tsx 컴포넌트를
 *     renderToStaticMarkup 으로 렌더한 결과를 **정규화 후 1:1 비교**한다.
 *     (P2-01 icons-equivalence 패턴 계승 — oracle = 원본 render* 문자열.)
 *  2) 핸들러 prop 동작: primitives 는 상호작용 컴포넌트(close/filter/tab)이므로,
 *     원본 string 버전엔 없던 onClick 등 핸들러 prop 을 받아 <button> 에 전달한다.
 *     DOM 환경(happy-dom/jsdom) 미설치이므로, 컴포넌트가 반환한 React element 의
 *     props.onClick 을 직접 호출하여 핸들러가 버튼에 배선됨을 검증한다(인자/호출 횟수 포함).
 *
 * 의도적 divergence(문서화):
 *  - 원본 escHtml 은 `"` → `&quot;` 까지 escape 하지만, React 의 텍스트 노드는
 *    `< > &` 만 escape 하고 `"` 는 텍스트 컨텐츠로 안전하므로 그대로 둔다.
 *    따라서 라벨에 `"` 가 포함된 경우는 raw 동치 비교 대상에서 제외하고,
 *    `< > &` 위험문자 escape 만 별도 검증한다(시각·보안 동치의 충분조건).
 *  - close-button 원본 default label 은 window.I18n.t('common.close') 전역 의존.
 *    React 컴포넌트는 전역 의존 없이 label 을 명시 prop 으로 받으므로, 동치 비교 시
 *    원본·신규 모두 동일 label 을 명시 전달한다(전역 모킹 불필요).
 *
 * 회귀 가드: 신규 계약(P2-02). 원본 js 무수정·병존. baseline(261) 비회귀.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MouseEvent, MouseEventHandler, ReactElement } from 'react';

// 신규 TSX 컴포넌트(barrel 경유 — barrel export 완전성 동시 검증).
import { CloseButton, FilterButton, Tab } from '../index';

// 원본 JS primitives(병존·무수정) — 동치 비교 기준(oracle).
import { renderCloseBtn } from '../../../../../assets/js/design-system/primitives/close-button.js';
import { renderFilterBtn } from '../../../../../assets/js/design-system/primitives/filter-button.js';
import { renderTab } from '../../../../../assets/js/design-system/primitives/tab.js';

/**
 * HTML 마크업 정규화 — icons-equivalence.normalizeSvg 와 동일 규칙.
 *  1) 자기닫음 → 빈 요소 통일 (primitives 는 button 단일이라 거의 무영향, 일관성 위해 유지).
 *  2) 태그 사이 무의미 공백 제거 · 다중 공백 축약 · `>` 앞 공백 제거.
 * 속성 이름/값/순서는 보존(동치의 핵심).
 */
function normalize(s: string): string {
  return s
    .replace(/<([a-zA-Z]+)([^<>]*?)\/>/g, '<$1$2></$1>')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .replace(/\s+>/g, '>')
    .trim();
}

function tsx(el: ReactElement): string {
  return normalize(renderToStaticMarkup(el));
}
function js(s: string): string {
  return normalize(s);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. 마크업 동치
// ──────────────────────────────────────────────────────────────────────────
describe('CloseButton — 원본 renderCloseBtn 마크업 동치', () => {
  it('default(size md, 명시 label)', () => {
    expect(tsx(<CloseButton size="md" label="닫기" />)).toBe(
      js(renderCloseBtn({ size: 'md', label: '닫기' }))
    );
  });
  it('size sm + label + dataAttrs', () => {
    expect(
      tsx(<CloseButton size="sm" label="Clear search" dataAttrs={{ action: 'clear' }} />)
    ).toBe(js(renderCloseBtn({ size: 'sm', label: 'Clear search', dataAttrs: { action: 'clear' } })));
  });
  it('size lg', () => {
    expect(tsx(<CloseButton size="lg" label="Close" />)).toBe(
      js(renderCloseBtn({ size: 'lg', label: 'Close' }))
    );
  });
  it('잘못된 size → md 폴백(원본 동일)', () => {
    // @ts-expect-error 적대적 입력: 허용되지 않은 size 값
    expect(tsx(<CloseButton size="xl" label="X" />)).toBe(
      // @ts-expect-error oracle 도 동일 적대적 입력
      js(renderCloseBtn({ size: 'xl', label: 'X' }))
    );
  });
  it('label 의 " 는 aria-label 속성에서 &quot; escape(원본·React 속성 동일)', () => {
    expect(tsx(<CloseButton size="md" label={'a"b'} />)).toBe(
      js(renderCloseBtn({ size: 'md', label: 'a"b' }))
    );
  });
});

describe('FilterButton — 원본 renderFilterBtn 마크업 동치', () => {
  it('soft active + value', () => {
    expect(tsx(<FilterButton label="전체" active strength="soft" value="all" />)).toBe(
      js(renderFilterBtn({ label: '전체', active: true, strength: 'soft', value: 'all' }))
    );
  });
  it('strong inactive(value 미지정)', () => {
    expect(tsx(<FilterButton label="Skill" active={false} strength="strong" />)).toBe(
      js(renderFilterBtn({ label: 'Skill', active: false, strength: 'strong' }))
    );
  });
  it('default(strength soft, active false)', () => {
    expect(tsx(<FilterButton label="날짜" />)).toBe(js(renderFilterBtn({ label: '날짜' })));
  });
  it('잘못된 strength → soft 폴백(원본 동일)', () => {
    // @ts-expect-error 적대적 입력
    expect(tsx(<FilterButton label="X" strength="bold" />)).toBe(
      // @ts-expect-error oracle 동일 입력
      js(renderFilterBtn({ label: 'X', strength: 'bold' }))
    );
  });
  it('label 위험문자(< > &) escape 동치', () => {
    expect(tsx(<FilterButton label={'<b>&amp'} value="v" />)).toBe(
      js(renderFilterBtn({ label: '<b>&amp', value: 'v' }))
    );
  });
});

describe('Tab — 원본 renderTab 마크업 동치', () => {
  it('selected + value', () => {
    expect(tsx(<Tab label="Sessions" selected value="sessions" />)).toBe(
      js(renderTab({ label: 'Sessions', selected: true, value: 'sessions' }))
    );
  });
  it('default(selected false, value 미지정)', () => {
    expect(tsx(<Tab label="Overview" />)).toBe(js(renderTab({ label: 'Overview' })));
  });
  it('label 위험문자(< > &) escape 동치', () => {
    expect(tsx(<Tab label={'<i>&x'} value="t" />)).toBe(
      js(renderTab({ label: '<i>&x', value: 't' }))
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. 핸들러 prop 동작 검증 (TDD 핵심 — 원본 string 버전엔 없는 신규 계약)
//    DOM 미설치 → 컴포넌트가 반환한 element 의 props.onClick 을 직접 invoke.
//    핸들러 타입은 컴포넌트 계약(MouseEventHandler)과 동일하게 유지하고,
//    호출 시 합성 이벤트 자리에 식별 가능한 sentinel(아래 evt)을 주입해 인자/호출횟수를 검증한다.
// ──────────────────────────────────────────────────────────────────────────

/** 합성 MouseEvent 자리표(식별용 sentinel). 실제 필드는 검증에 쓰지 않는다. */
const evt = { _sentinel: 'click' } as unknown as MouseEvent<HTMLButtonElement>;

describe('CloseButton — onClick 핸들러 prop 배선', () => {
  it('onClick 이 반환 <button> props 로 전달되고 호출된다', () => {
    let calls = 0;
    let lastArg: unknown;
    const handler: MouseEventHandler<HTMLButtonElement> = (e) => {
      calls += 1;
      lastArg = e;
    };
    const el = CloseButton({ size: 'md', label: 'X', onClick: handler });
    expect(el.type).toBe('button');
    expect(typeof el.props.onClick).toBe('function');
    expect(el.props.onClick).toBe(handler);
    el.props.onClick(evt);
    expect(calls).toBe(1);
    expect(lastArg).toBe(evt);
  });
  it('onClick 미지정 시 props.onClick 은 undefined(렌더 안전)', () => {
    const el = CloseButton({ size: 'md', label: 'X' });
    expect(el.props.onClick).toBeUndefined();
  });
});

describe('FilterButton — onClick 핸들러 prop 배선', () => {
  it('onClick 이 전달·호출된다', () => {
    let calls = 0;
    const handler: MouseEventHandler<HTMLButtonElement> = () => {
      calls += 1;
    };
    const el = FilterButton({ label: 'all', active: true, onClick: handler });
    expect(el.type).toBe('button');
    expect(el.props.onClick).toBe(handler);
    el.props.onClick(evt);
    el.props.onClick(evt);
    expect(calls).toBe(2);
  });
});

describe('Tab — onClick 핸들러 prop 배선', () => {
  it('onClick 이 전달·호출된다', () => {
    let received: unknown;
    const handler: MouseEventHandler<HTMLButtonElement> = (e) => {
      received = e;
    };
    const el = Tab({ label: 'Sessions', value: 'sessions', onClick: handler });
    expect(el.type).toBe('button');
    expect(el.props.onClick).toBe(handler);
    el.props.onClick(evt);
    expect(received).toBe(evt);
  });
});
