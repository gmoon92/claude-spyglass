/**
 * meta-docs-catalog-colresize.test.tsx — MetaDocsCatalog 컬럼 리사이즈 결선 라이브 검증(갭 3)
 *
 * 원본 동치: assets/js/col-resize.js initColResize(.meta-docs-table) — 각 thead th 우측 .col-resize-handle 삽입.
 *   MetaDocsCatalog 는 tableRef prop 을 노출, 호출처(MetaDocsLayout)가 useColResize 로 부착한다.
 *   본 테스트는 동일 결선(tableRef + useColResize)을 jsdom 마운트해 핸들 개수 > 0 을 입증한다.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement, useRef, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MetaDocsCatalog } from '../MetaDocsCatalog';
import { useColResize } from '../../../components/use-col-resize';
import type { MetaDocRow } from '../meta-docs-sort';
import { ensureDom } from '../../../test-support/ensure-dom';

// 루트 bun test 에는 jsdom 전역이 없으므로 라이브 DOM 을 보장한다(vitest 에서는 no-op).
ensureDom();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // 루트 bun test(jsdom 부재)용 window 보장. i18n 은 vitest.setup 의 기본 t(passthrough)가 담당.
  (globalThis as unknown as { window?: object }).window =
    ((globalThis as unknown as { window?: object }).window as never) ?? ({} as never);
});

const rows: MetaDocRow[] = [
  { id: 1, type: 'agent', name: 'alpha', source_root: '/p', file_path: '/p/a.md', invocations: 3, last_used_at: Date.now(), total_tokens: 100 } as never,
  { id: 2, type: 'skill', name: 'beta', source_root: '/p', file_path: '/p/b.md', invocations: 0, last_used_at: null, total_tokens: 0 } as never,
];

function Host(): ReturnType<typeof createElement> {
  const tableRef = useRef<HTMLTableElement>(null);
  useColResize(tableRef, { storageKey: 'metadocs' });
  return createElement(MetaDocsCatalog, { rows, tableRef });
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

describe('MetaDocsCatalog — col-resize 핸들 부착(갭 3)', () => {
  it('카탈로그 .meta-docs-table thead 각 th 에 .col-resize-handle 이 붙는다(개수 > 0 = 컬럼 수)', () => {
    root = createRoot(container);
    act(() => root.render(createElement(Host)));
    const table = container.querySelector('.meta-docs-table')!;
    const handles = table.querySelectorAll('.col-resize-handle');
    const ths = table.querySelectorAll('thead th');
    expect(ths.length).toBe(6); // 6컬럼(type/name/source/invocations/last_used/total_tokens)
    expect(handles.length).toBeGreaterThan(0);
    expect(handles.length).toBe(ths.length);
  });
});
