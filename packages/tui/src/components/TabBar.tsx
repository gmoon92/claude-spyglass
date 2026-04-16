/**
 * Tab Navigation Component
 *
 * @description F1~F4 탭 네비게이션
 * @see docs/planning/02-prd.md - 탭 구성
 */

/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';

/**
 * 탭 타입
 */
export type TabId = 'live' | 'history' | 'analysis' | 'settings';

/**
 * 탭 정보
 */
export interface Tab {
  id: TabId;
  label: string;
  shortcut: string;
}

/**
 * 탭 목록
 */
export const TABS: Tab[] = [
  { id: 'live', label: 'Live', shortcut: 'F1' },
  { id: 'history', label: 'History', shortcut: 'F2' },
  { id: 'analysis', label: 'Analysis', shortcut: 'F3' },
  { id: 'settings', label: 'Settings', shortcut: 'F4' },
];

/**
 * 탭 바 props
 */
export interface TabBarProps {
  activeTab: TabId;
  onTabChange?: (tab: TabId) => void;
}

/**
 * 탭 바 컴포넌트
 */
export function TabBar({ activeTab, onTabChange }: TabBarProps): JSX.Element {
  return (
    <Box flexDirection="row" borderStyle="single" borderBottom borderColor="gray">
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <Box
            key={tab.id}
            paddingX={2}
          >
            <Text color={isActive ? 'cyan' : 'gray'} bold={isActive}>
              {isActive ? '> ' : '  '}
              <Text color={isActive ? 'yellow' : 'cyan'} bold>
                {tab.shortcut}
              </Text>
              :{tab.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * 탭 컨텐츠 컨테이너
 */
export interface TabContentProps {
  activeTab: TabId;
  children: Record<TabId, React.ReactNode>;
}

/**
 * 활성 탭의 컨텐츠만 렌더링
 */
export function TabContent({ activeTab, children }: TabContentProps): JSX.Element {
  return <>{children[activeTab]}</>;
}
