// app/use-keyboard-shortcuts.ts — 전역 키보드 단축키 훅 (keyboard-shortcuts 복원)
//
// 원본: views/default/keyboard.js#wireKeyboard — 사용자 키 입력 → 액션 디스패치.
//   ESC 우선순위 정책, /·⌘F·?·1-7 단축키 정의는 모두 여기 한 곳에 있다(판단 로직 단일 소유).
//
// 레거시 대비 결선 변경(스토어 controlled 전환):
//   - 필터 트리거: 레거시는 필터바 버튼 DOM .click() — React 에선 FilterBar 가 controlled 라
//     app-store action(setFeedFilter/setDetailFilter)을 직접 호출한다(같은 onChange 경로).
//   - 검색 클리어: SearchBox 도 controlled — setSearchQuery('') (input 이벤트 디스패치 불요).
//   - 검색 포커스: focus 는 DOM 명령이므로 SearchBox 가 렌더한 .feed-search-input 을 컨테이너
//     id 로 조회(레거시 getter 주입과 동치). detail 검색박스는 미결선 슬롯 — 레거시와 동일하게
//     해당 표면 부재 시 no-op.
//   - 확장 패널(ESC): 레거시 expandRow.remove() 는 React 트리를 깨므로, 펼침 행
//     [data-expand-for] 직전 행의 토글([data-expand-id]) click 으로 기존 토글 경로를 재사용한다
//     (RequestRow#onMsgCellClick → setExpanded(false)).
//
// 스토어 읽기는 핸들러 안 getState() — stale closure 없이 리스너 1회 등록 유지.

import { useEffect } from 'react';
import { useAppStore } from '../stores/app-store';
import { FILTER_GROUPS } from '../components/FilterBar';

/**
 * 1–7 키 → 필터 키 매핑 SSoT — FilterBar 그룹 토폴로지(FILTER_GROUPS)를 평탄화.
 * 도움말 모달(KeyboardHelpModal) 필터 표도 이 배열에서 파생해 매핑·표가 항상 일치한다.
 */
export const KEYBOARD_FILTER_KEYS: readonly string[] = FILTER_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);

/** 타이핑 대상 판정(레거시 isTypingTarget 1:1) — input/textarea/contentEditable 에선 문자 단축키 무시. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

/** 활성 검색 input — detail 뷰면 detail 슬롯, 아니면 피드 검색(레거시 activeSearchInput 동치). */
function activeSearchInput(rightView: string): HTMLInputElement | null {
  const containerId = rightView === 'detail' ? 'detailSearchContainer' : 'feedSearchContainer';
  return (
    document
      .getElementById(containerId)
      ?.querySelector<HTMLInputElement>('.feed-search-input') ?? null
  );
}

export interface KeyboardShortcutOpts {
  /** 도움말 모달 열림(controlled — AppShell 소유). */
  helpOpen: boolean;
  /** `?` 키 → 도움말 토글. */
  onToggleHelp: () => void;
  /** ESC(모달 열림 시) → 도움말 닫기. */
  onCloseHelp: () => void;
}

/**
 * 전역 키보드 단축키 wiring — AppShell 에서 1회 마운트.
 *   `?` 도움말 토글 / `/`·⌘F 검색 포커스 / 1-7 필터 / ESC 우선순위 체인.
 */
export function useKeyboardShortcuts({ helpOpen, onToggleHelp, onCloseHelp }: KeyboardShortcutOpts): void {
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;

    function focusActiveSearch(): void {
      const el = activeSearchInput(useAppStore.getState().rightView);
      if (el) {
        el.focus();
        el.select?.();
      }
    }

    // 1-7 → 활성 뷰의 필터 갱신(레거시 triggerFilterByIndex — 버튼 click 대신 controlled action).
    function triggerFilterByIndex(idx: number): void {
      const key = KEYBOARD_FILTER_KEYS[idx];
      if (!key) return;
      const s = useAppStore.getState();
      if (s.rightView === 'detail') s.setDetailFilter(key);
      else s.setFeedFilter(key);
    }

    // ESC 우선순위(레거시 handleEscape 1:1): 모달 → 확장 패널 → 검색 클리어 → detail 닫기.
    function handleEscape(): void {
      if (helpOpen) {
        onCloseHelp();
        return;
      }
      const expandRow = doc!.querySelector('[data-expand-for]');
      if (expandRow) {
        // 기존 토글 경로 재사용 — 펼침 행 직전(소유) 행의 [data-expand-id] click → setExpanded(false).
        expandRow.previousElementSibling
          ?.querySelector<HTMLElement>('[data-expand-id]')
          ?.click();
        return;
      }
      const s = useAppStore.getState();
      const searchInput = activeSearchInput(s.rightView);
      if (searchInput && searchInput.value) {
        s.setSearchQuery('');
        return;
      }
      if (s.rightView === 'detail') s.setRightView('default');
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        handleEscape();
        e.preventDefault();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        focusActiveSearch();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        focusActiveSearch();
        return;
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        onToggleHelp();
        return;
      }
      if (/^[1-7]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        triggerFilterByIndex(parseInt(e.key, 10) - 1);
      }
    };

    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [helpOpen, onToggleHelp, onCloseHelp]);
}
