// app/use-keyboard-shortcuts.ts — 전역 키보드 단축키 훅 (keyboard-shortcuts 복원)
//
// 원본: views/default/keyboard.js#wireKeyboard — 사용자 키 입력 → 액션 디스패치.
//   ESC 우선순위 정책, /·⌘F·?·1-7 단축키 정의는 모두 여기 한 곳에 있다(판단 로직 단일 소유).
//
// 레거시 대비 결선 변경(스토어 controlled 전환):
//   - 필터 트리거: 레거시는 필터바 버튼 DOM .click() — React 에선 FilterBar 가 controlled 라
//     app-store action(setFeedFilter/setDetailFilter)을 직접 호출한다(같은 onChange 경로).
//   - 검색 클리어: SearchBox 도 controlled — setSearchQuery('') (input 이벤트 디스패치 불요).
//   - 검색 포커스: 레거시는 getElementById('feedSearchContainer').querySelector('.feed-search-input')
//     로 DOM 을 직접 잡아 focus() 했다(id 셀렉터 의존). 이를 store action 으로 전환 —
//     requestSearchFocus() 가 searchFocusSignal 을 증가시키면 input 을 소유한 SearchBox(feed)가
//     자기 ref 로 focus/select 한다. detail 뷰는 검색박스가 미결선 슬롯이라 신호를 안 보낸다(레거시 no-op 동치).
//   - 확장 패널(ESC): 레거시 expandRow.remove()/querySelector('[data-expand-for]').click() 는 DOM 우회였다.
//     expand-store.collapseTopExpanded() 로 전환 — 펼친 RequestRow 가 등록한 collapse 콜백을 호출해
//     자기 useState 를 닫는다(펼침 SSoT 는 그대로 RequestRow useState, DOM 클릭 시뮬레이션 제거).
//     닫을 행이 있었는지 boolean 으로 받아 ESC 우선순위 분기를 판단한다.
//
// 스토어 읽기는 핸들러 안 getState() — stale closure 없이 리스너 1회 등록 유지.

import { useEffect } from 'react';
import { useAppStore } from '../stores/app-store';
import { useExpandStore } from '../stores/expand-store';
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

/**
 * 검색 포커스가 가능한 뷰인지 — 레거시 activeSearchInput 의 "표면 존재" 판정 1:1.
 *   레거시는 detail 뷰면 detailSearchContainer(미결선 슬롯)를 조회해 null → no-op, 그 외 feed 검색 input 을
 *   반환했다. detail 검색박스는 결선되지 않았으므로 feed(=non-detail)에서만 포커스 대상이 존재한다.
 */
function hasFocusableSearch(rightView: string): boolean {
  return rightView !== 'detail';
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
      const s = useAppStore.getState();
      // 포커스 대상 검색박스가 존재하는 뷰에서만 신호를 보낸다(detail 미결선 슬롯 → no-op, 레거시 동치).
      if (!hasFocusableSearch(s.rightView)) return;
      s.requestSearchFocus();
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
      // 펼침 행이 있으면 하나 닫고 멈춤(레거시 querySelector('[data-expand-for]').click() 우회 대체).
      //   collapseTopExpanded 가 등록된 collapse 콜백(RequestRow setExpanded(false))을 호출하고
      //   닫을 행이 있었는지 boolean 으로 반환한다(레거시 expandRow 존재 분기 1:1).
      if (useExpandStore.getState().collapseTopExpanded()) return;
      const s = useAppStore.getState();
      // 검색어가 있으면 클리어만 수행 — 레거시는 "검색 input 존재(=feed 뷰) && input.value" 였다.
      //   store 전환: 포커스 가능한 검색박스가 있는 뷰(hasFocusableSearch)에서만 searchQuery 클리어 분기.
      //   detail 뷰는 input 미존재라 이 분기를 건너뛰고 곧장 detail 닫기로 간다(레거시 1:1).
      if (hasFocusableSearch(s.rightView) && s.searchQuery) {
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
