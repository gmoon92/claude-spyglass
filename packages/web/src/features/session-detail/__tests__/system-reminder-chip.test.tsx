/**
 * system-reminder-chip.test.tsx — SystemReminderChip 팝오버 상태기계 특성화 (P5 React화)
 *
 * 원본 동작(assets/js/session-detail/system-reminder-popover.js openPopover/closePopover/onDocument*):
 *  - 칩 클릭 → 팝오버 열림(aria-expanded=true, hidden 해제), 재클릭 → 닫힘(toggle).
 *  - 팝오버는 document.body 로 portal(createPortal) — anchor span 밖에 렌더.
 *  - 좌표는 computePopoverPosition(순수 함수) 결과를 inline style 로 바인딩.
 *  - 외부 mousedown → 닫힘 / 내부 클릭 → 유지 / Escape → 닫힘 / 닫기 버튼 → 닫힘.
 *  - 닫힐 때 칩으로 focus 복귀.
 *
 * 검증 방식: jsdom 실제 마운트(react-dom/client) + 네이티브 이벤트 디스패치(capture 위임 재현).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SystemReminderChip } from '../SystemReminderChip';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = { t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}` : key) };
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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

function mount(reminders: string[] | null, turnIndex = 2): void {
  act(() => {
    root.render(<SystemReminderChip turnIndex={turnIndex} reminders={reminders} />);
  });
}

const chipBtn = () => document.getElementById('turn-sysrem-chip-2') as HTMLButtonElement | null;
const popover = () => document.getElementById('turn-sysrem-popover-2') as HTMLElement | null;

describe('SystemReminderChip — 렌더 가드', () => {
  it('reminders 비었으면 null(칩 미렌더)', () => {
    mount([]);
    expect(chipBtn()).toBeNull();
    mount(null);
    expect(chipBtn()).toBeNull();
  });

  it('reminders 가 있으면 칩 + (닫힌) 팝오버 렌더, aria-expanded=false', () => {
    mount(['rem one']);
    expect(chipBtn()).toBeTruthy();
    expect(chipBtn()!.getAttribute('aria-expanded')).toBe('false');
    const pop = popover();
    expect(pop).toBeTruthy();
    expect(pop!.hidden).toBe(true); // 초기엔 닫힘
  });
});

describe('SystemReminderChip — portal(createPortal → body)', () => {
  it('팝오버는 anchor span 밖(body) 으로 portal 된다', () => {
    mount(['rem one']);
    const anchor = container.querySelector('.turn-system-reminder-anchor');
    expect(anchor).toBeTruthy();
    // 팝오버는 anchor 자손이 아니라 body 직계(portal) 여야 한다.
    expect(anchor!.contains(popover())).toBe(false);
    expect(popover()!.parentElement).toBe(document.body);
  });
});

describe('SystemReminderChip — open/close/toggle 상태기계(useState)', () => {
  it('칩 클릭 → 열림(aria-expanded=true, hidden 해제, 좌표 inline style)', () => {
    mount(['rem one']);
    act(() => chipBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(chipBtn()!.getAttribute('aria-expanded')).toBe('true');
    expect(popover()!.hidden).toBe(false);
    // 좌표가 inline style 로 바인딩됨(computePopoverPosition 결과).
    expect(popover()!.style.top).not.toBe('');
    expect(popover()!.style.left).not.toBe('');
  });

  it('칩 재클릭 → 닫힘(toggle)', () => {
    mount(['rem one']);
    act(() => chipBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => chipBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(chipBtn()!.getAttribute('aria-expanded')).toBe('false');
    expect(popover()!.hidden).toBe(true);
  });

  it('닫기 버튼(×) 클릭 → 닫힘', () => {
    mount(['rem one']);
    act(() => chipBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const closeBtn = popover()!.querySelector<HTMLButtonElement>('[data-sysrem-close]');
    act(() => closeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(popover()!.hidden).toBe(true);
  });
});

describe('SystemReminderChip — 전역 닫기 위임(컴포넌트 useEffect)', () => {
  it('외부 mousedown → 닫힘', () => {
    mount(['rem one']);
    act(() => chipBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(popover()!.hidden).toBe(false);
    // body(팝오버/칩 외부)에서 mousedown.
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(popover()!.hidden).toBe(true);
  });

  it('팝오버 내부 mousedown → 유지(닫히지 않음)', () => {
    mount(['rem one']);
    act(() => chipBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const item = popover()!.querySelector('.turn-system-reminder-item') as HTMLElement;
    act(() => item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(popover()!.hidden).toBe(false);
  });

  it('Escape → 닫힘 + 칩 focus 복귀', () => {
    mount(['rem one']);
    act(() => chipBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(popover()!.hidden).toBe(true);
    expect(document.activeElement).toBe(chipBtn());
  });
});
