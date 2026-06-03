/**
 * keyboard-shortcuts.test.tsx — 전역 키보드 단축키 + 도움말 모달 복원 회귀 가드
 *
 * 원본: views/default/keyboard.js#wireKeyboard + main.js#renderKbdHelpModal.
 *   React 마이그레이션에서 누락(AppShell onHelp no-op)됐던 표면의 복원 검증.
 *
 * 전략:
 *  - 모달 마크업: renderToStaticMarkup(무 DOM) — 레거시 #kbdHelpBackdrop 셀렉터 계약 + 필터 7행
 *    (KEYBOARD_FILTER_KEYS SSoT 파생) 단정.
 *  - 단축키 훅: createRoot + act 라이브 마운트(update-badge-i18n 선례) 후 document 에 실 keydown
 *    디스패치 — controlled action(setFeedFilter/setSearchQuery/setRightView) 결과를 app-store 로 단정.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyboardHelpModal } from '../KeyboardHelpModal';
import { useKeyboardShortcuts, KEYBOARD_FILTER_KEYS } from '../use-keyboard-shortcuts';
import { useAppStore } from '../../stores/app-store';
import { ensureDom } from '../../test-support/ensure-dom';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = (key: string) => key;

describe('KeyboardHelpModal — 레거시 renderKbdHelpModal 마크업 동치', () => {
  it('open=true 면 #kbdHelpBackdrop(dialog) + 섹션 3종 + 필터 7행을 렌더한다', () => {
    const html = renderToStaticMarkup(<KeyboardHelpModal open onClose={() => {}} t={t} />);
    expect(html).toContain('id="kbdHelpBackdrop"');
    expect(html).toContain('kbd-help-backdrop visible');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('id="kbdHelpClose"');
    expect(html).toContain('ui.main.kbd-help.section.nav');
    expect(html).toContain('ui.main.kbd-help.section.filter');
    expect(html).toContain('ui.main.kbd-help.section.help');
    // 필터 행은 단축키 매핑 SSoT(7키)에서 파생 — 1~7 키 캡 모두 노출.
    expect(KEYBOARD_FILTER_KEYS).toHaveLength(7);
    for (let i = 1; i <= 7; i++) expect(html).toContain(`<span class="kbd-key">${i}</span>`);
  });

  it('open=false 면 아무것도 렌더하지 않는다(레거시 .visible 제거 동치)', () => {
    const html = renderToStaticMarkup(<KeyboardHelpModal open={false} onClose={() => {}} t={t} />);
    expect(html).toBe('');
  });

  it('KEYBOARD_FILTER_KEYS 순서는 레거시 1-7 매핑(filter-bar 토폴로지)과 일치한다', () => {
    expect([...KEYBOARD_FILTER_KEYS]).toEqual([
      'all', 'prompt', 'system', 'tool_call', 'agent', 'skill', 'mcp',
    ]);
  });
});

/** 훅 단독 마운트 하네스 — AppShell 결선(helpOpen 로컬 상태 + 토글/닫기 콜백)의 최소 동치. */
function Harness({
  helpOpen,
  onToggleHelp,
  onCloseHelp,
}: {
  helpOpen: boolean;
  onToggleHelp: () => void;
  onCloseHelp: () => void;
}): null {
  useKeyboardShortcuts({ helpOpen, onToggleHelp, onCloseHelp });
  return null;
}

function pressKey(init: KeyboardEventInit & { key: string }): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

describe('useKeyboardShortcuts — 레거시 wireKeyboard 동작 동치', () => {
  let container: HTMLDivElement;
  let root: Root;
  const calls: string[] = [];

  function mount(helpOpen = false): void {
    act(() => {
      root.render(
        <Harness
          helpOpen={helpOpen}
          onToggleHelp={() => calls.push('toggle')}
          onCloseHelp={() => calls.push('close')}
        />,
      );
    });
  }

  beforeEach(() => {
    calls.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // app-store 기본값 복원 — 케이스 간 누출 차단.
    useAppStore.setState({ rightView: 'default', feedFilter: 'all', detailFilter: 'all', searchQuery: '' });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelector('#feedSearchContainer')?.remove();
  });

  it('`?` 키 → 도움말 토글(footer 버튼과 동일 경로)', () => {
    mount();
    pressKey({ key: '?', shiftKey: true });
    expect(calls).toEqual(['toggle']);
  });

  it('1-7 키 → feedFilter 갱신(default 뷰) — 매핑 SSoT 순서', () => {
    mount();
    pressKey({ key: '4' });
    expect(useAppStore.getState().feedFilter).toBe('tool_call');
    pressKey({ key: '7' });
    expect(useAppStore.getState().feedFilter).toBe('mcp');
  });

  it('detail 뷰의 1-7 키는 detailFilter 를 갱신한다(feedFilter 불변)', () => {
    mount();
    useAppStore.setState({ rightView: 'detail' });
    pressKey({ key: '2' });
    expect(useAppStore.getState().detailFilter).toBe('prompt');
    expect(useAppStore.getState().feedFilter).toBe('all');
  });

  it('타이핑 중(input target)에는 /·?·1-7 단축키를 무시한다(레거시 isTypingTarget)', () => {
    mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
    });
    expect(useAppStore.getState().feedFilter).toBe('all');
    expect(calls).toEqual([]);
    input.remove();
  });

  it('`/` 키 → 피드 검색 input 포커스(#feedSearchContainer .feed-search-input)', () => {
    mount();
    const wrap = document.createElement('div');
    wrap.id = 'feedSearchContainer';
    const input = document.createElement('input');
    input.className = 'feed-search-input';
    wrap.appendChild(input);
    document.body.appendChild(wrap);
    pressKey({ key: '/' });
    expect(document.activeElement).toBe(input);
  });

  it('ESC 우선순위 1 — 도움말 모달 열림 시 닫기만 수행(detail 유지)', () => {
    mount(true);
    useAppStore.setState({ rightView: 'detail' });
    pressKey({ key: 'Escape' });
    expect(calls).toEqual(['close']);
    expect(useAppStore.getState().rightView).toBe('detail');
  });

  it('ESC 우선순위 3 — 검색어 있으면 클리어만 수행(detail 유지)', () => {
    mount();
    useAppStore.setState({ searchQuery: 'abc' });
    const wrap = document.createElement('div');
    wrap.id = 'feedSearchContainer';
    const input = document.createElement('input');
    input.className = 'feed-search-input';
    input.value = 'abc';
    wrap.appendChild(input);
    document.body.appendChild(wrap);
    pressKey({ key: 'Escape' });
    expect(useAppStore.getState().searchQuery).toBe('');
    expect(useAppStore.getState().rightView).toBe('default');
  });

  it('ESC 우선순위 4 — detail 뷰면 default 로 복귀(레거시 onCloseDetail)', () => {
    mount();
    useAppStore.setState({ rightView: 'detail' });
    pressKey({ key: 'Escape' });
    expect(useAppStore.getState().rightView).toBe('default');
  });
});
