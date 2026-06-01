/**
 * syslib-colresize.test.tsx — System 프롬프트 라이브러리 표 컬럼 리사이즈 결선 라이브 검증(갭 3)
 *
 * 원본 동치: assets/js/system-prompt-library.js:107 initColResize(.syslib-table).
 *   SessionDetailContainer 의 SysLibPane 는 #sysLibBody 내부 .syslib-table 를 lazy resolve 하는 RefObject 를
 *   useColResize 에 전달한다. 본 테스트는 동일 결선(셀렉터 resolve + useColResize)을 jsdom 마운트해
 *   .col-resize-handle 개수 > 0 을 입증한다(storageKey='syslib').
 */
import './_dom-stub'; // bun test 양립: createRoot 마운트용 전역 DOM 보장(vitest 에선 no-op).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement, useMemo, useRef, act, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SystemPromptLibrary } from '../../dashboard/SystemPromptLibrary';
import { useColResize } from '../../../components/use-col-resize';
import type { SysLibRow } from '../../dashboard/syslib-sort';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  (globalThis as unknown as { window: { I18n: { t: (k: string) => string } } }).window =
    ((globalThis as unknown as { window?: object }).window as never) ?? ({} as never);
  (globalThis as unknown as { window: { I18n: { t: (k: string) => string } } }).window.I18n = { t: (k) => k };
});

const rows: SysLibRow[] = [
  { hash: 'abc123def456abc', byte_size: 1200, segment_count: 3, ref_count: 5, first_seen_at: Date.now(), last_seen_at: Date.now() } as never,
];

/** SessionDetailContainer.SysLibPane 와 동일한 lazy-ref 결선을 재현. */
function Host(): ReturnType<typeof createElement> {
  const bodyRef = useRef<HTMLDivElement>(null);
  const tableRef = useMemo<RefObject<HTMLTableElement>>(
    () => ({
      get current(): HTMLTableElement | null {
        return bodyRef.current?.querySelector<HTMLTableElement>('.syslib-table') ?? null;
      },
    }),
    [],
  );
  return createElement(
    'div',
    { id: 'sysLibBody', className: 'syslib-body', ref: bodyRef },
    createElement(SystemPromptLibrary, { rows, sort: { key: 'last_seen_at', dir: 'desc' }, t: (k: string) => k }),
    createElement(SysLibColResize, { tableRef }),
  );
}
function SysLibColResize({ tableRef }: { tableRef: RefObject<HTMLTableElement> }): null {
  useColResize(tableRef, { storageKey: 'syslib' });
  return null;
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

describe('SystemPromptLibrary — col-resize 핸들 부착(갭 3)', () => {
  it('#sysLibBody 내부 .syslib-table thead 각 th 에 .col-resize-handle 이 붙는다(개수 > 0)', () => {
    root = createRoot(container);
    act(() => root.render(createElement(Host)));
    const table = container.querySelector('.syslib-table')!;
    const handles = table.querySelectorAll('.col-resize-handle');
    const ths = table.querySelectorAll('thead th');
    expect(ths.length).toBe(6); // 6컬럼(hash/size/seg/ref/first/last)
    expect(handles.length).toBeGreaterThan(0);
    expect(handles.length).toBe(ths.length);
  });
});
