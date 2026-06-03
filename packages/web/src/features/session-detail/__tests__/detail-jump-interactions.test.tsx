/**
 * detail-jump-interactions.test.tsx — 턴 마커 클릭 + 칩 점프(레거시 동작 복원) 검증.
 *
 *  기능 1) 턴 마커 클릭: 비활성 .turn-line[data-turn] / .ds-turn-marker 클릭 → onMarkerClick(turnId).
 *          원본 main.js:803-804 `.turn-line[data-turn]` → toggleTurn 위임 대응.
 *  기능 2) 칩 점프: turn-spine 칩([data-chip-key]) 클릭 → #turnLogBody 안 매칭 행 flash + 자동 펼침.
 *          원본 main.js#handleChipActivation 대응(행 안 [data-expand-id] 합성 click → RequestRow 펼침).
 *
 * 검증 방식: jsdom 실제 마운트(react-dom/client) + 네이티브 click 디스패치(원본 closest 위임 재현).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TurnSpine } from '../TurnSpine';
import { handleChipActivation, installChipDelegation } from '../chip-jump';

declare const window: { I18n: { t: (k: string, v?: Record<string, unknown>) => string } };

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = { t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}` : key) };
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom 은 scrollIntoView 가 없으므로 no-op 스텁(flashChipTarget 호출 안전).
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
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

const turns: any = [
  { turn_id: 't1', turn_index: 2, prompt: { preview: 'active prompt' }, items: [{ kind: 'tool', request: { id: 'a1', type: 'tool_call', tool_name: 'Read', timestamp: '2026-04-28T10:01:00Z' } }] },
  { turn_id: 't0', turn_index: 1, prompt: { preview: 'older prompt' }, items: [{ kind: 'tool', request: { id: 'a0', type: 'tool_call', tool_name: 'Bash', timestamp: '2026-04-28T09:00:00Z' } }] },
];

describe('기능 1 — 턴 마커 클릭 → onMarkerClick', () => {
  it('비활성 마커(.ds-turn-marker) 클릭 → onMarkerClick(turn_id)', () => {
    let got: string | null = null;
    act(() => {
      root.render(<TurnSpine turns={turns} activeTurnId="t1" onMarkerClick={(id) => { got = id; }} />);
    });
    // t0 = 비활성 turn-line. 그 안의 마커를 클릭.
    const inactive = container.querySelector<HTMLElement>('.turn-line[data-turn="t0"] .ds-turn-marker');
    expect(inactive).toBeTruthy();
    act(() => { inactive!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(got).toBe('t0');
  });

  it('onMarkerClick 미주입이면 마커 클릭 무동작(에러 없음)', () => {
    act(() => { root.render(<TurnSpine turns={turns} activeTurnId="t1" />); });
    const inactive = container.querySelector<HTMLElement>('.turn-line[data-turn="t0"]');
    expect(() => act(() => { inactive!.dispatchEvent(new MouseEvent('click', { bubbles: true })); })).not.toThrow();
  });
});

describe('기능 2 — 칩 점프 → 행 flash + 펼침', () => {
  // #turnLogBody 안에 chip-key 행 + 그 행의 [data-expand-id]. 칩은 별도 컨테이너.
  function mountDom(): {
    chip: HTMLElement;
    row: HTMLTableRowElement;
    expandClicks: { n: number };
    refs: { logBodyRef: { current: HTMLElement | null }; detailRootRef: { current: HTMLElement | null } };
  } {
    const detailView = document.createElement('div');
    detailView.id = 'detailView';
    // log-pane tbody
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    tbody.id = 'turnLogBody';
    const row = document.createElement('tr');
    row.setAttribute('data-chip-key', 'tool:Read');
    row.setAttribute('data-request-id', 'a1');
    const td = document.createElement('td');
    const preview = document.createElement('span');
    preview.className = 'prompt-preview';
    preview.setAttribute('data-expand-id', 'a1');
    const expandClicks = { n: 0 };
    preview.addEventListener('click', () => { expandClicks.n += 1; }); // RequestRow.onMsgCellClick 대역
    td.appendChild(preview);
    row.appendChild(td);
    tbody.appendChild(row);
    table.appendChild(tbody);
    // chip(turn-spine)
    const chip = document.createElement('span');
    chip.className = 'tool-chip';
    chip.setAttribute('data-chip-key', 'tool:Read');
    chip.setAttribute('role', 'button');
    detailView.appendChild(table);
    detailView.appendChild(chip);
    document.body.appendChild(detailView);
    // chip-jump 는 전역 조회 대신 DetailView 가 부착한 ref 스코프(logBodyRef/detailRootRef)에서 탐색한다.
    const refs = {
      logBodyRef: { current: tbody as HTMLElement | null },
      detailRootRef: { current: detailView as HTMLElement | null },
    };
    return { chip, row, expandClicks, refs };
  }

  it('handleChipActivation: 매칭 행 flash + [data-expand-id] 합성 click(펼침 위임)', () => {
    const { chip, row, expandClicks, refs } = mountDom();
    handleChipActivation(chip, refs);
    expect(row.classList.contains('row-highlight-flash')).toBe(true);
    expect(expandClicks.n).toBe(1); // 행 펼침 토글이 1회 트리거됨.
  });

  it('이미 펼쳐진 행(prompt-expand-row 형제 존재)은 재펼침 안 함(토글 닫힘 회피)', () => {
    const { chip, row, expandClicks, refs } = mountDom();
    const expandRow = document.createElement('tr');
    expandRow.className = 'prompt-expand-row';
    row.after(expandRow);
    handleChipActivation(chip, refs);
    expect(row.classList.contains('row-highlight-flash')).toBe(true); // flash 는 여전히.
    expect(expandClicks.n).toBe(0); // 펼침은 토글하지 않음.
  });

  it('installChipDelegation: 칩 click 위임이 handleChipActivation 을 트리거', () => {
    const { chip, expandClicks, refs } = mountDom();
    const root2 = refs.detailRootRef.current as HTMLElement;
    const cleanup = installChipDelegation(root2, refs);
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(expandClicks.n).toBe(1);
    cleanup();
  });

  it('매칭 행이 없으면 silent(에러 없음)', () => {
    const detailView = document.createElement('div');
    detailView.id = 'detailView';
    const chip = document.createElement('span');
    chip.setAttribute('data-chip-key', 'tool:Nonexistent');
    detailView.appendChild(chip);
    document.body.appendChild(detailView);
    const refs = {
      logBodyRef: { current: null },
      detailRootRef: { current: detailView as HTMLElement | null },
    };
    expect(() => handleChipActivation(chip, refs)).not.toThrow();
  });
});
