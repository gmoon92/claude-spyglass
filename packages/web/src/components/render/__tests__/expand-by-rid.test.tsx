/**
 * expand-by-rid.test.tsx — chip-jump 정공법(합성 click 제거) end-to-end 가드.
 *
 * 합성 preview.click() 를 expand-store.expandByRid(rid) 로 대체한 전환의 핵심 계약을 실제
 *   RequestRow 마운트로 검증한다(store 단위 테스트는 expand-store.test.ts 가 담당):
 *  1) RequestRow 가 *접힌 동안에도* expander 를 등록한다 → expandByRid(rid) 로 펼쳐진다.
 *  2) idempotent — 이미 펼쳐진 행에 다시 expandByRid 해도 닫히지 않는다(과거 토글의 닫힘 회피).
 *     이 속성은 chip-jump 가 아니라 RequestRow 의 setExpanded(true) 가 보장하므로 실제 마운트로만 확인 가능.
 *  3) 언마운트 시 expander 가 해제된다 → 이후 expandByRid 는 false(stale setState 경고/누수 차단).
 *
 * 검증 방식: feed-row-interactions 선례와 동일(createRoot+act 라이브 마운트, testing-library 미설치).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RequestRow } from '../RequestRow';
import { useExpandStore } from '../../../stores/expand-store';
import { ensureDom } from '../../../test-support/ensure-dom';

ensureDom();

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  globalThis.__setTestT?.((key) => {
    const map: Record<string, string> = {
      'session:rows.empty-message': '메시지 없음',
      'ui:main.expand.copy': '복사',
      'ui:main.expand.copied': '✓복사됨',
    };
    return map[key] ?? key;
  });
});

let container: HTMLTableSectionElement;
let root: Root;

beforeEach(() => {
  // tbody 직계에 행을 마운트해야 expand <tr> 가 형제로 붙는다(원본 DOM 구조와 동일).
  const table = document.createElement('table');
  container = document.createElement('tbody');
  table.appendChild(container);
  document.body.appendChild(table);
  root = createRoot(container);
  // expand-store 레지스트리 초기화 — 케이스 간 expander 누수 차단.
  useExpandStore.setState({ collapsers: new Map(), expanders: new Map() });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

// fixture: prompt 행(본문 payload 보유 → contextPreview 가 _promptCache 채움, PromptExpandRow 렌더 가능).
const promptRow = () => ({
  id: 'req-1',
  type: 'prompt',
  session_id: 'sess-abcdef0123456789',
  project_name: 'my-project',
  timestamp: 0,
  payload: JSON.stringify({ prompt: 'full prompt body line one\nline two with detail' }),
  preview: 'full prompt body line one',
});

describe('chip-jump 정공법 — expandByRid → RequestRow 펼침', () => {
  it('접힌 행이 expander 를 상시 등록 → expandByRid(rid) 로 펼쳐진다', () => {
    act(() => { root.render(<RequestRow r={promptRow()} opts={{ showSession: true }} />); });
    // 마운트 직후엔 접힘(펼침 행 없음).
    expect(container.querySelector('[data-expand-for]')).toBeNull();

    // chip-jump 가 호출하는 경로와 동일하게 store 액션으로 펼친다(합성 click 없음).
    let ok = false;
    act(() => { ok = useExpandStore.getState().expandByRid('req-1'); });
    expect(ok).toBe(true);
    expect(container.querySelector('tr.prompt-expand-row[data-expand-for="req-1"]')).toBeTruthy();
  });

  it('idempotent — 이미 펼쳐진 행에 다시 expandByRid 해도 닫히지 않는다(토글 닫힘 회피)', () => {
    act(() => { root.render(<RequestRow r={promptRow()} opts={{ showSession: true }} />); });
    act(() => { useExpandStore.getState().expandByRid('req-1'); });
    expect(container.querySelector('[data-expand-for]')).toBeTruthy();
    // 핵심 UX: 같은 행을 가리키는 칩을 다시 눌러도 set-true 라 펼침이 유지된다(과거 합성 click 토글은 닫혔음).
    act(() => { useExpandStore.getState().expandByRid('req-1'); });
    expect(container.querySelector('[data-expand-for]')).toBeTruthy();
  });

  it('직접 클릭 토글은 그대로 동작 — expander 등록이 onMsgCellClick 토글을 막지 않는다', () => {
    act(() => { root.render(<RequestRow r={promptRow()} opts={{ showSession: true }} />); });
    const preview = container.querySelector<HTMLElement>('.prompt-preview[data-expand-id="req-1"]')!;
    act(() => { preview.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); // 펼침
    expect(container.querySelector('[data-expand-for]')).toBeTruthy();
    act(() => { preview.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); // 다시 클릭 → 닫힘(토글)
    expect(container.querySelector('[data-expand-for]')).toBeNull();
  });

  it('언마운트 후 expander 해제 — expandByRid 는 false(누수/stale setState 차단)', () => {
    // 이 케이스는 자체 루트로 마운트/언마운트(afterEach 의 공용 root 이중 unmount 회피).
    const table = document.createElement('table');
    const body = document.createElement('tbody');
    table.appendChild(body);
    document.body.appendChild(table);
    const localRoot = createRoot(body);
    act(() => { localRoot.render(<RequestRow r={promptRow()} opts={{ showSession: true }} />); });
    // expandByRid 는 setExpanded(true) state 업데이트를 일으키므로 act 로 감싼다.
    let ok = false;
    act(() => { ok = useExpandStore.getState().expandByRid('req-1'); });
    expect(ok).toBe(true); // 마운트 중엔 등록됨.

    act(() => { localRoot.unmount(); });
    // 언마운트 effect cleanup 이 unregisterExpander 를 호출 → 더 이상 펼칠 대상 없음.
    expect(useExpandStore.getState().expandByRid('req-1')).toBe(false);
    table.remove();
  });
});
