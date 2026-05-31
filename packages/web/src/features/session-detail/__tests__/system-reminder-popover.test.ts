/**
 * system-reminder-popover.test.ts — 팝오버 좌표 계산 + open/close/toggle 상태기계 (P3-07)
 *
 * 원본: assets/js/session-detail/system-reminder-popover.js
 *   (positionPopover:210 / openPopover:143 / closePopover:175 / onDocument*).
 *
 * 전략(§2.3 + hooks-api 패턴): happy-dom 미설치 환경이므로 DOM 변이 부는 최소 stub 으로,
 *   순수 로직은 직접 함수로 분리해 검증한다:
 *   - computePopoverPosition: viewport 기준 좌표 clamp(우/좌 넘침) — 순수 수학, DOM 무관.
 *   - createPopoverController: single-open 불변식·portal 이동/복귀·aria-expanded·focus 복귀.
 *     주입 가능한 최소 DOM 인터페이스로 happy-dom 없이 검증.
 *   훅 자체(useSystemReminderPopover)의 useEffect 부착/cleanup 은 소스 정적 + 컨트롤러 위임으로 보증.
 */
import { describe, it, expect } from 'bun:test';
import {
  computePopoverPosition,
  createPopoverController,
  type PopoverDom,
} from '../system-reminder-popover';

// ── computePopoverPosition (positionPopover:210) ─────────────────────────────────
describe('computePopoverPosition — viewport clamp(positionPopover:210)', () => {
  const GAP = 4;
  const SAFE = 8;

  it('기본: 칩 좌측 정렬 + 아래(top = chipRect.bottom + GAP)', () => {
    const pos = computePopoverPosition({ left: 100, bottom: 50 }, 200, 1000);
    expect(pos.left).toBe(100);
    expect(pos.top).toBe(50 + GAP);
  });

  it('우측 넘침 → left = innerWidth - width - SAFE', () => {
    // left(900) + width(200) = 1100 > 1000 - 8 → 1000 - 200 - 8 = 792
    const pos = computePopoverPosition({ left: 900, bottom: 30 }, 200, 1000);
    expect(pos.left).toBe(1000 - 200 - SAFE);
  });

  it('좌측 넘침(보정 결과 < SAFE) → left = SAFE 로 clamp', () => {
    // viewport 폭(100)보다 팝오버(200)가 넓음 → 우측보정 100-200-8=-108 < 8 → 8 로 clamp
    const pos = computePopoverPosition({ left: 5, bottom: 10 }, 200, 100);
    expect(pos.left).toBe(SAFE);
  });

  it('top 은 하단 넘침 보정 없음(칩 아래 고정)', () => {
    const pos = computePopoverPosition({ left: 0, bottom: 999 }, 50, 1000);
    expect(pos.top).toBe(999 + GAP);
  });
});

// ── createPopoverController (open/close/toggle 상태기계) ──────────────────────────

/** 최소 DOM 노드 stub — id 로 조회되는 팝오버/칩. */
function makeNode(id: string) {
  const attrs: Record<string, string> = {};
  return {
    id,
    hidden: true,
    parentElement: null as unknown,
    style: { top: '', left: '' },
    _focused: 0,
    _attrs: attrs,
    setAttribute(k: string, v: string) {
      attrs[k] = v;
    },
    getAttribute(k: string) {
      return attrs[k] ?? null;
    },
    focus() {
      this._focused += 1;
    },
    getBoundingClientRect() {
      return { left: 10, bottom: 20, width: 100 };
    },
    contains() {
      return false;
    },
  };
}

/** 주입형 PopoverDom — getElementById/body.appendChild/insertBefore stub. */
function makeDom(): { dom: PopoverDom; nodes: Map<string, ReturnType<typeof makeNode>>; bodyChildren: unknown[] } {
  const nodes = new Map<string, ReturnType<typeof makeNode>>();
  const bodyChildren: unknown[] = [];
  const dom: PopoverDom = {
    getElementById: (id: string) => (nodes.get(id) as never) ?? null,
    body: {
      appendChild: (n: unknown) => {
        bodyChildren.push(n);
      },
    },
    viewportWidth: () => 1000,
  };
  return { dom, nodes, bodyChildren };
}

describe('createPopoverController — single-open 불변식(openPopover:143)', () => {
  it('open → hidden 해제 + aria-expanded=true + 좌표 설정 + focus', () => {
    const { dom, nodes } = makeDom();
    const pop = makeNode('pop1');
    const chip = makeNode('chip1');
    nodes.set('pop1', pop);
    const ctl = createPopoverController(dom);

    ctl.open('pop1', chip as never);
    expect(pop.hidden).toBe(false);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(pop.style.top).not.toBe('');
    expect(pop._focused).toBe(1);
    expect(ctl.openId()).toBe('pop1');
  });

  it('두 번째 open → 기존 먼저 close(한 시점 1개만)', () => {
    const { dom, nodes } = makeDom();
    const a = makeNode('a');
    const b = makeNode('b');
    const chipA = makeNode('ca');
    const chipB = makeNode('cb');
    nodes.set('a', a);
    nodes.set('b', b);
    const ctl = createPopoverController(dom);

    ctl.open('a', chipA as never);
    ctl.open('b', chipB as never);
    expect(a.hidden).toBe(true); // 기존 닫힘
    expect(chipA.getAttribute('aria-expanded')).toBe('false');
    expect(b.hidden).toBe(false);
    expect(ctl.openId()).toBe('b');
  });

  it('toggle: 같은 id 재호출 → 닫힘(onDocumentClick:85)', () => {
    const { dom, nodes } = makeDom();
    const a = makeNode('a');
    const chip = makeNode('c');
    nodes.set('a', a);
    const ctl = createPopoverController(dom);

    ctl.toggle('a', chip as never);
    expect(ctl.openId()).toBe('a');
    ctl.toggle('a', chip as never);
    expect(ctl.openId()).toBeNull();
    expect(a.hidden).toBe(true);
  });

  it('close → focus 칩 복귀 + aria-expanded=false(closePopover:187-191)', () => {
    const { dom, nodes } = makeDom();
    const a = makeNode('a');
    const chip = makeNode('c');
    nodes.set('a', a);
    const ctl = createPopoverController(dom);

    ctl.open('a', chip as never);
    const focusedBefore = chip._focused;
    ctl.close('a');
    expect(chip._focused).toBe(focusedBefore + 1); // 닫힐 때 focus 복귀
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(ctl.openId()).toBeNull();
  });

  it('close(다른 id) → noop(closePopover:176 가드)', () => {
    const { dom, nodes } = makeDom();
    const a = makeNode('a');
    const chip = makeNode('c');
    nodes.set('a', a);
    const ctl = createPopoverController(dom);

    ctl.open('a', chip as never);
    ctl.close('other'); // 현재 open 과 불일치
    expect(ctl.openId()).toBe('a'); // 변화 없음
    expect(a.hidden).toBe(false);
  });

  it('open: 존재하지 않는 popover id → noop', () => {
    const { dom } = makeDom();
    const ctl = createPopoverController(dom);
    ctl.open('missing', makeNode('c') as never);
    expect(ctl.openId()).toBeNull();
  });

  it('isInside: 팝오버/칩 외부면 false → 외부 mousedown 닫기 트리거(onDocumentMousedown:119)', () => {
    const { dom, nodes } = makeDom();
    const a = makeNode('a');
    const chip = makeNode('c');
    a.contains = () => false;
    chip.contains = () => false;
    nodes.set('a', a);
    const ctl = createPopoverController(dom);
    ctl.open('a', chip as never);
    expect(ctl.isInside({} as never)).toBe(false);
  });

  it('isInside: 팝오버 내부면 true → 외부닫기 미발동', () => {
    const { dom, nodes } = makeDom();
    const a = makeNode('a');
    const chip = makeNode('c');
    a.contains = () => true;
    nodes.set('a', a);
    const ctl = createPopoverController(dom);
    ctl.open('a', chip as never);
    expect(ctl.isInside({} as never)).toBe(true);
  });
});
