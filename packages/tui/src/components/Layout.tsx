/**
 * Layout Components
 *
 * @description TUI 기본 레이아웃 (Header, Sidebar, Main, Footer)
 * @see docs/planning/02-prd.md - UI/UX 설계
 */

import React from 'react';
import { Box, Text, useStdoutDimensions } from 'ink';

// =============================================================================
// Header
// =============================================================================

/**
 * 헤더 컴포넌트 - 상단 타이틀 및 상태 표시
 */
export interface HeaderProps {
  title?: string;
  status?: 'connected' | 'disconnected';
  sessionCount?: number;
}

export function Header({
  title = 'spyglass',
  status = 'connected',
  sessionCount = 0,
}: HeaderProps): JSX.Element {
  const statusColor = status === 'connected' ? 'green' : 'red';
  const statusText = status === 'connected' ? '🟢' : '🔴';

  return (
    <Box
      height={1}
      paddingX={1}
      borderStyle="single"
      borderBottom
      borderColor="gray"
    >
      <Box width="30%">
        <Text bold color="cyan">
          {title}
        </Text>
      </Box>
      <Box width="40%" justifyContent="center">
        <Text color={statusColor}>
          {statusText} {status.toUpperCase()}
        </Text>
      </Box>
      <Box width="30%" justifyContent="flex-end">
        <Text color="yellow">Sessions: {sessionCount}</Text>
      </Box>
    </Box>
  );
}

// =============================================================================
// Sidebar
// =============================================================================

/**
 * 사이드바 컴포넌트 - 세션 목록 표시
 */
export interface SidebarProps {
  sessions?: Array<{
    id: string;
    project_name: string;
    started_at: number;
    total_tokens: number;
  }>;
  selectedId?: string;
  width?: number;
}

export function Sidebar({
  sessions = [],
  selectedId,
  width = 25,
}: SidebarProps): JSX.Element {
  return (
    <Box width={width} flexDirection="column" borderStyle="single" borderRight borderColor="gray">
      <Box paddingX={1} borderStyle="single" borderBottom borderColor="gray">
        <Text bold>📁 Sessions</Text>
      </Box>
      <Box flexDirection="column">
        {sessions.length === 0 ? (
          <Box paddingX={1}>
            <Text color="gray">No sessions</Text>
          </Box>
        ) : (
          sessions.slice(0, 10).map((session) => (
            <Box
              key={session.id}
              paddingX={1}
              backgroundColor={session.id === selectedId ? 'blue' : undefined}
            >
              <Text
                color={session.id === selectedId ? 'white' : 'gray'}
                wrap="truncate"
              >
                {session.project_name}
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

// =============================================================================
// Main
// =============================================================================

/**
 * 메인 컨텐츠 영역
 */
export interface MainProps {
  children: React.ReactNode;
}

export function Main({ children }: MainProps): JSX.Element {
  const { columns, rows } = useStdoutDimensions();
  const contentHeight = rows - 4; // Header(1) + Footer(1) + Borders(2)

  return (
    <Box flexDirection="column" flexGrow={1} height={contentHeight}>
      {children}
    </Box>
  );
}

// =============================================================================
// Footer
// =============================================================================

/**
 * 푸터 컴포넌트 - 단축키 안내
 */
export interface FooterProps {
  activeTab?: string;
}

export function Footer({ activeTab = 'Live' }: FooterProps): JSX.Element {
  return (
    <Box
      height={1}
      paddingX={1}
      borderStyle="single"
      borderTop
      borderColor="gray"
    >
      <Box width="60%">
        <Text color="gray">
          <Text color="cyan">F1</Text> Live{' '}
          <Text color="cyan">F2</Text> History{' '}
          <Text color="cyan">F3</Text> Analysis{' '}
          <Text color="cyan">F4</Text> Settings{' '}
          <Text color="cyan">q</Text> Quit
        </Text>
      </Box>
      <Box width="40%" justifyContent="flex-end">
        <Text color="yellow">Tab: {activeTab}</Text>
      </Box>
    </Box>
  );
}

// =============================================================================
// Layout Container
// =============================================================================

/**
 * 전체 레이아웃 컨테이너
 */
export interface LayoutProps {
  header?: React.ReactNode;
  sidebar?: React.ReactNode;
  main: React.ReactNode;
  footer?: React.ReactNode;
}

export function Layout({
  header,
  sidebar,
  main,
  footer,
}: LayoutProps): JSX.Element {
  const { rows } = useStdoutDimensions();

  return (
    <Box flexDirection="column" height={rows}>
      {header}
      <Box flexGrow={1}>
        {sidebar}
        {main}
      </Box>
      {footer}
    </Box>
  );
}
