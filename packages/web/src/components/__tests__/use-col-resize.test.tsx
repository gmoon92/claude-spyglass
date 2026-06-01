/**
 * use-col-resize.test.tsx — useColResize 훅 단위/동치 테스트
 *
 * 원본 동치 기준: assets/js/col-resize.js initColResize + assets/js/resize-utils.js measureMaxWidth.
 *   - thead th 우측에 `.col-resize-handle` 삽입(셀렉터 계약).
 *   - mousedown→mousemove 드래그로 col[i].style.width 조정(최소 32px clamp), 핸들 `.dragging` 토글.
 *   - dblclick Auto-fit: 컬럼 셀 최대 scrollWidth + 16px(최소 32px).
 *   - 신규 계약: storageKey 별 localStorage 'spyglass:col-width:<key>' 영속 + 복원, 언마운트 cleanup.
 *
 * 전략(use-sse.test.ts 선례 — effect 결선은 직접 검증):
 *   SSR 은 useEffect 를 실행하지 않으므로, React 18 createRoot + act 로 jsdom 에 실제 마운트해
 *   effect(핸들 삽입/리스너 부착)를 발화시키고 실제 MouseEvent 를 dispatch 해 동작을 검증한다.
 *   jsdom 은 getBoundingClientRect().width / scrollWidth 를 0 으로 반환하므로 요소별로 스텁한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, useRef, act } from 'react';
import type { RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useColResize, type UseColResizeOptions } from '../use-col-resize';
import { ensureDom } from '../../test-support/ensure-dom';

// 루트 bun test 에는 jsdom 전역이 없으므로(vitest 는 environment:'jsdom') 라이브 DOM 을 보장한다.
//   vitest 에서는 no-op — 두 러너 모두에서 동일한 createRoot 마운트·MouseEvent dispatch 가 동작한다.
ensureDom();

// React 18 act() 환경 플래그(경고 억제 + 동기 flush).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_PREFIX = 'spyglass:col-width:';

/** th/col 3개를 가진 호스트 테이블을 마운트하고 ref 를 노출하는 컴포넌트. */
function makeHost(opts?: UseColResizeOptions) {
  let captured: RefObject<HTMLTableElement> | null = null;
  function Host() {
    const ref = useRef<HTMLTableElement>(null);
    captured = ref;
    useColResize(ref, opts);
    return createElement(
      'table',
      { ref },
      createElement(
        'colgroup',
        null,
        createElement('col'),
        createElement('col'),
        createElement('col'),
      ),
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          createElement('th', null, 'A'),
          createElement('th', null, 'B'),
          createElement('th', null, 'C'),
        ),
      ),
      createElement(
        'tbody',
        null,
        createElement(
          'tr',
          null,
          createElement('td', null, 'a1'),
          createElement('td', null, 'b1'),
          createElement('td', null, 'c1'),
        ),
      ),
    );
  }
  return { Host, getRef: () => captured };
}

/** getBoundingClientRect().width 를 스텁(jsdom 은 0 반환). */
function stubRectWidth(el: Element, width: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 }),
  });
}

/** scrollWidth 를 스텁(jsdom 은 0 반환). */
function stubScrollWidth(el: Element, width: number): void {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: width });
}

function mouse(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(opts?: UseColResizeOptions) {
  const { Host, getRef } = makeHost(opts);
  root = createRoot(container);
  act(() => root.render(createElement(Host)));
  return getRef;
}

describe('useColResize — 핸들 삽입(셀렉터 계약)', () => {
  it('각 thead th 우측에 .col-resize-handle 을 1개씩 삽입', () => {
    const getRef = mount();
    const table = getRef()!.current!;
    const ths = table.querySelectorAll('thead th');
    expect(ths.length).toBe(3);
    ths.forEach((th) => {
      const handles = th.querySelectorAll(':scope > .col-resize-handle');
      expect(handles.length).toBe(1);
    });
  });
});

describe('useColResize — 드래그 리사이즈(col-resize.js mousedown 1:1)', () => {
  it('드래그로 col[i].style.width 를 startW+delta 로 조정 + 핸들 .dragging 토글', () => {
    const getRef = mount();
    const table = getRef()!.current!;
    const th = table.querySelectorAll('thead th')[1] as HTMLElement;
    const col = table.querySelectorAll('col')[1] as HTMLElement;
    const handle = th.querySelector('.col-resize-handle') as HTMLElement;
    stubRectWidth(th, 100);

    act(() => {
      handle.dispatchEvent(mouse('mousedown', 50)); // startX=50, startW=100
    });
    expect(handle.classList.contains('dragging')).toBe(true);

    act(() => {
      document.dispatchEvent(mouse('mousemove', 80)); // delta +30 → 130
    });
    expect(col.style.width).toBe('130px');

    act(() => {
      document.dispatchEvent(mouse('mouseup', 80));
    });
    expect(handle.classList.contains('dragging')).toBe(false);
  });

  it('최소 너비 32px clamp — 과도한 음수 delta 에도 32px 하한', () => {
    const getRef = mount();
    const table = getRef()!.current!;
    const th = table.querySelectorAll('thead th')[0] as HTMLElement;
    const col = table.querySelectorAll('col')[0] as HTMLElement;
    const handle = th.querySelector('.col-resize-handle') as HTMLElement;
    stubRectWidth(th, 100);

    act(() => handle.dispatchEvent(mouse('mousedown', 200)));
    act(() => document.dispatchEvent(mouse('mousemove', 0))); // delta -200 → 100-200=-100 → clamp 32
    expect(col.style.width).toBe('32px');
    act(() => document.dispatchEvent(mouse('mouseup', 0)));
  });
});

describe('useColResize — dblclick Auto-fit(col-resize.js dblclick 1:1)', () => {
  it('컬럼 셀 최대 scrollWidth + 16px 로 맞춤', () => {
    const getRef = mount();
    const table = getRef()!.current!;
    const th = table.querySelectorAll('thead th')[2] as HTMLElement;
    const col = table.querySelectorAll('col')[2] as HTMLElement;
    const handle = th.querySelector('.col-resize-handle') as HTMLElement;
    const td = table.querySelectorAll('tbody td')[2] as HTMLElement;
    stubScrollWidth(th, 40);
    stubScrollWidth(td, 90); // max = 90 → 90 + 16 = 106

    act(() => handle.dispatchEvent(mouse('dblclick', 0)));
    expect(col.style.width).toBe('106px');
  });

  it('Auto-fit 도 최소 32px clamp(빈 콘텐츠)', () => {
    const getRef = mount();
    const table = getRef()!.current!;
    const th = table.querySelectorAll('thead th')[0] as HTMLElement;
    const col = table.querySelectorAll('col')[0] as HTMLElement;
    const handle = th.querySelector('.col-resize-handle') as HTMLElement;
    const td = table.querySelectorAll('tbody td')[0] as HTMLElement;
    stubScrollWidth(th, 0);
    stubScrollWidth(td, 0); // max 0 + 16 = 16 → clamp 32

    act(() => handle.dispatchEvent(mouse('dblclick', 0)));
    expect(col.style.width).toBe('32px');
  });
});

describe('useColResize — localStorage 영속(신규 계약)', () => {
  it('드래그 종료 시 spyglass:col-width:<key> 에 col index→px 저장', () => {
    const getRef = mount({ storageKey: 'feed' });
    const table = getRef()!.current!;
    const th = table.querySelectorAll('thead th')[1] as HTMLElement;
    const handle = th.querySelector('.col-resize-handle') as HTMLElement;
    stubRectWidth(th, 100);

    act(() => handle.dispatchEvent(mouse('mousedown', 0)));
    act(() => document.dispatchEvent(mouse('mousemove', 50))); // 150
    act(() => document.dispatchEvent(mouse('mouseup', 50)));

    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'feed')!);
    expect(saved['1']).toBe(150);
  });

  it('dblclick Auto-fit 결과도 저장', () => {
    const getRef = mount({ storageKey: 'turn' });
    const table = getRef()!.current!;
    const th = table.querySelectorAll('thead th')[0] as HTMLElement;
    const handle = th.querySelector('.col-resize-handle') as HTMLElement;
    const td = table.querySelectorAll('tbody td')[0] as HTMLElement;
    stubScrollWidth(th, 60);
    stubScrollWidth(td, 60); // 60 + 16 = 76

    act(() => handle.dispatchEvent(mouse('dblclick', 0)));
    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'turn')!);
    expect(saved['0']).toBe(76);
  });

  it('마운트 시 저장값 복원 — col[i].style.width 재적용', () => {
    localStorage.setItem(STORAGE_PREFIX + 'feed', JSON.stringify({ '2': 222 }));
    const getRef = mount({ storageKey: 'feed' });
    const table = getRef()!.current!;
    const col = table.querySelectorAll('col')[2] as HTMLElement;
    expect(col.style.width).toBe('222px');
  });

  it('storageKey 미지정 → 영속 비활성(저장 no-op)', () => {
    const getRef = mount(); // storageKey 없음
    const table = getRef()!.current!;
    const th = table.querySelectorAll('thead th')[0] as HTMLElement;
    const handle = th.querySelector('.col-resize-handle') as HTMLElement;
    stubRectWidth(th, 100);

    act(() => handle.dispatchEvent(mouse('mousedown', 0)));
    act(() => document.dispatchEvent(mouse('mousemove', 30)));
    act(() => document.dispatchEvent(mouse('mouseup', 30)));

    // spyglass:col-width:* 키가 하나도 생기지 않아야 한다.
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_PREFIX));
    expect(keys.length).toBe(0);
  });

  it('깨진 JSON 복원 시 throw 없이 무시(빈 맵 폴백)', () => {
    localStorage.setItem(STORAGE_PREFIX + 'feed', '{not json');
    expect(() => mount({ storageKey: 'feed' })).not.toThrow();
  });
});

describe('useColResize — 언마운트 cleanup', () => {
  it('언마운트 시 삽입한 핸들 제거 + 드래그 리스너 해제', () => {
    const getRef = mount();
    const table = getRef()!.current!;
    const th = table.querySelectorAll('thead th')[0] as HTMLElement;
    const col = table.querySelectorAll('col')[0] as HTMLElement;
    const handle = th.querySelector('.col-resize-handle') as HTMLElement;
    stubRectWidth(th, 100);

    // 드래그 도중(mouseup 전) 언마운트해도 안전해야 한다.
    act(() => handle.dispatchEvent(mouse('mousedown', 0)));
    act(() => root.unmount());

    // 핸들이 DOM 에서 제거됨.
    expect(th.querySelector('.col-resize-handle')).toBeNull();

    // 잔존 document 리스너가 없어야 함 — mousemove 가 더 이상 col 너비를 바꾸지 않는다.
    col.style.width = '11px';
    document.dispatchEvent(mouse('mousemove', 999));
    expect(col.style.width).toBe('11px');

    // afterEach 의 root.unmount() 재호출이 throw 하지 않도록 새 더미 root 로 교체.
    root = createRoot(document.createElement('div'));
  });
});
