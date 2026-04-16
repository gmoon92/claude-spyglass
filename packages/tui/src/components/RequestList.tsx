/**
 * Recent Request List Component
 *
 * @description 실시간 갱신되는 요청 리스트
 */

/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';

/**
 * 요청 아이템
 */
export interface RequestItem {
  id: string;
  timestamp: number;
  type: 'prompt' | 'tool_call' | 'system';
  tool_name?: string;
  model?: string;
  tokens_total: number;
  description?: string;
}

/**
 * 요청 리스트 props
 */
export interface RequestListProps {
  requests: RequestItem[];
  maxItems?: number;
  selectedIndex?: number;
}

/**
 * 요청 타입에 따른 색상
 */
function getTypeColor(type: string): string {
  switch (type) {
    case 'prompt':
      return 'cyan';
    case 'tool_call':
      return 'yellow';
    case 'system':
      return 'gray';
    default:
      return 'white';
  }
}

/**
 * 타입 레이블
 */
function getTypeLabel(type: string, toolName?: string): string {
  if (type === 'tool_call' && toolName) {
    return `Tool:${toolName}`;
  }
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * 시간 포맷 (HH:MM:SS)
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour12: false });
}

/**
 * 토큰 형식화
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${tokens}`;
}

/**
 * 요청 리스트 컴포넌트
 */
export function RequestList({
  requests,
  maxItems = 10,
  selectedIndex = -1,
}: RequestListProps): JSX.Element {
  const displayRequests = requests.slice(0, maxItems);

  return (
    <Box flexDirection="column">
      {/* 헤더 */}
      <Box height={1} borderStyle="single" borderBottom borderColor="gray">
        <Box width="15%"><Text bold>Time</Text></Box>
        <Box width="25%"><Text bold>Type</Text></Box>
        <Box width="40%"><Text bold>Description</Text></Box>
        <Box width="20%" justifyContent="flex-end"><Text bold>Tokens</Text></Box>
      </Box>

      {/* 요청 목록 */}
      {displayRequests.length === 0 ? (
        <Box paddingY={1}>
          <Text color="gray">No requests yet...</Text>
        </Box>
      ) : (
        displayRequests.map((req, index) => {
          const isSelected = index === selectedIndex;
          const typeColor = getTypeColor(req.type);
          const typeLabel = getTypeLabel(req.type, req.tool_name);

          return (
            <Box
              key={req.id}
              height={1}
            >
              <Box width="15%">
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                  {isSelected ? '> ' : '  '}{formatTime(req.timestamp)}
                </Text>
              </Box>
              <Box width="25%">
                <Text color={typeColor} bold={isSelected}>
                  {typeLabel}
                </Text>
              </Box>
              <Box width="40%">
                <Text
                  wrap="truncate"
                  bold={isSelected}
                >
                  {req.description || '-'}
                </Text>
              </Box>
              <Box width="20%" justifyContent="flex-end">
                <Text color="yellow" bold={isSelected}>
                  {formatTokens(req.tokens_total)}
                </Text>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}
