/**
 * Keyboard Handler Hook
 *
 * @description 키보드 단축키 처리 (F1~F4, q, 방향키)
 * @see docs/planning/02-prd.md - 키보드 단축키
 */

import { useEffect, useCallback } from 'react';
import { useInput, Key } from 'ink';
import type { TabId } from '../components/TabBar';

/**
 * 키보드 핸들러 옵션
 */
export interface UseKeyboardOptions {
  /** 현재 활성 탭 */
  activeTab: TabId;
  /** 탭 변경 콜백 */
  onTabChange: (tab: TabId) => void;
  /** 종료 콜백 */
  onQuit: () => void;
  /** 검색 모드 토글 */
  onSearchToggle?: () => void;
  /** 선택 인덱스 */
  selectedIndex?: number;
  /** 최대 인덱스 */
  maxIndex?: number;
  /** 선택 변경 */
  onSelectionChange?: (index: number) => void;
  /** 엔터 키 핸들러 */
  onEnter?: () => void;
}

/**
 * 키보드 핸들러 훅
 */
export function useKeyboard({
  activeTab,
  onTabChange,
  onQuit,
  onSearchToggle,
  selectedIndex = 0,
  maxIndex = 0,
  onSelectionChange,
  onEnter,
}: UseKeyboardOptions): void {
  useInput(
    useCallback(
      (input: string, key: Key) => {
        // F1~F4 탭 전환
        if (key.function) {
          switch (input) {
            case 'F1':
              onTabChange('live');
              return;
            case 'F2':
              onTabChange('history');
              return;
            case 'F3':
              onTabChange('analysis');
              return;
            case 'F4':
              onTabChange('settings');
              return;
          }
        }

        // q 키: 종료
        if (input === 'q' && !key.ctrl && !key.meta) {
          onQuit();
          return;
        }

        // Q 키: 종료
        if (input === 'Q') {
          onQuit();
          return;
        }

        // / 키: 검색
        if (input === '/') {
          onSearchToggle?.();
          return;
        }

        // ESC: 검색 모드 종료 또는 뒤로가기
        if (key.escape) {
          // TODO: 검색 모드 종료
          return;
        }

        // 방향키: 선택 이동
        if (onSelectionChange && maxIndex > 0) {
          if (key.upArrow) {
            const newIndex = Math.max(0, selectedIndex - 1);
            onSelectionChange(newIndex);
            return;
          }

          if (key.downArrow) {
            const newIndex = Math.min(maxIndex, selectedIndex + 1);
            onSelectionChange(newIndex);
            return;
          }
        }

        // Enter: 선택 실행
        if (key.return && onEnter) {
          onEnter();
          return;
        }
      },
      [
        activeTab,
        onTabChange,
        onQuit,
        onSearchToggle,
        selectedIndex,
        maxIndex,
        onSelectionChange,
        onEnter,
      ]
    )
  );
}
