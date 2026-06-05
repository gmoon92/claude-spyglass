/**
 * use-floating-menu-position.test.tsx — useFloatingMenuPosition 선언형 전환 검증
 *
 * 배경: 과거 훅은 `menu.style.left/top = ...` 로 DOM 을 직접 변형했다. 본 리팩토링은 위치 계산
 *   결과를 CSSProperties state 로 반환하고 소비처가 JSX style 로 주입한다(명령형 mutation 제거).
 *
 * 검증:
 *  1) open=false → 빈 style({}) 반환(menu.style 직접 변형 없음).
 *  2) open=true → 트리거 rect 기준 left/top px 를 반환(align='end' 우측 정렬, gap 아래 배치).
 *  3) 소스 정적 가드: `menu.style.left/top =` 직접 대입 결선이 사라졌다(회귀 고정).
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { act, useRef, type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensureDom } from '../../test-support/ensure-dom';
import { useFloatingMenuPosition, type FloatingMenuOptions } from '../use-floating-menu-position';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// viewport 를 고정해 clamp(좌우 8px) 산술을 결정론적으로 만든다(jsdom 기본 1024x768 이지만 명시 고정).
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024, writable: true });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768, writable: true });
});

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

/** 캡처된 style 을 외부로 노출하는 하네스 — 훅 반환값을 메뉴 element 의 style 로 바인딩. */
function Harness({
  open,
  opts,
  triggerRect,
  menuSize,
  onStyle,
}: {
  open: boolean;
  opts?: FloatingMenuOptions;
  triggerRect: { left: number; right: number; top: number; bottom: number };
  menuSize: { w: number; h: number };
  onStyle: (s: CSSProperties) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // jsdom 은 layout 을 계산하지 않으므로 getBoundingClientRect/offsetWidth 를 callback ref 로 스텁한다.
  //   콜백 ref 는 element 마운트 시점(useLayoutEffect 의 place() 이전)에 호출되어 스텁이 먼저 적용된다.
  const attachTrigger = (el: HTMLButtonElement | null): void => {
    triggerRef.current = el;
    if (el) {
      el.getBoundingClientRect = () =>
        ({
          left: triggerRect.left,
          right: triggerRect.right,
          top: triggerRect.top,
          bottom: triggerRect.bottom,
          width: triggerRect.right - triggerRect.left,
          height: triggerRect.bottom - triggerRect.top,
          x: triggerRect.left,
          y: triggerRect.top,
          toJSON: () => ({}),
        }) as DOMRect;
    }
  };
  const attachMenu = (el: HTMLDivElement | null): void => {
    menuRef.current = el;
    if (el) {
      Object.defineProperty(el, 'offsetWidth', { configurable: true, value: menuSize.w });
      Object.defineProperty(el, 'offsetHeight', { configurable: true, value: menuSize.h });
    }
  };
  const style = useFloatingMenuPosition(open, triggerRef, menuRef, opts);
  onStyle(style);
  return (
    <div>
      <button ref={attachTrigger} type="button">
        trigger
      </button>
      <div ref={attachMenu} style={style}>
        menu
      </div>
    </div>
  );
}

describe('useFloatingMenuPosition — 선언형 style 반환', () => {
  it('open=false 면 빈 style({}) 반환(직접 DOM 변형 없음)', () => {
    let last: CSSProperties = { left: 'x' };
    act(() =>
      root.render(
        <Harness
          open={false}
          triggerRect={{ left: 10, right: 60, top: 100, bottom: 120 }}
          menuSize={{ w: 200, h: 80 }}
          onStyle={(s) => {
            last = s;
          }}
        />,
      ),
    );
    expect(last).toEqual({});
  });

  it("open=true align='end' → 메뉴 우측을 트리거 우측에 맞추고 트리거 아래(gap)에 배치", () => {
    let last: CSSProperties = {};
    act(() =>
      root.render(
        <Harness
          open
          opts={{ gap: 4, align: 'end' }}
          // 트리거 우측=300, 아래=120. 메뉴 폭 200 → left=300-200=100, top=120+4=124.
          triggerRect={{ left: 250, right: 300, top: 100, bottom: 120 }}
          menuSize={{ w: 200, h: 80 }}
          onStyle={(s) => {
            last = s;
          }}
        />,
      ),
    );
    expect(last.left).toBe('100px');
    expect(last.top).toBe('124px');
  });

  it("align='start' → 메뉴 좌측을 트리거 좌측에 맞춘다", () => {
    let last: CSSProperties = {};
    act(() =>
      root.render(
        <Harness
          open
          opts={{ align: 'start', gap: 4 }}
          triggerRect={{ left: 250, right: 300, top: 100, bottom: 120 }}
          menuSize={{ w: 200, h: 80 }}
          onStyle={(s) => {
            last = s;
          }}
        />,
      ),
    );
    expect(last.left).toBe('250px');
    expect(last.top).toBe('124px');
  });

  it('소스 정적 가드: menu.style 직접 대입 결선이 없다(명령형 제거)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../use-floating-menu-position.ts'), 'utf8');
    expect(src).not.toMatch(/menu\.style\.(left|top)\s*=/);
    expect(src).toContain('useState');
  });
});
