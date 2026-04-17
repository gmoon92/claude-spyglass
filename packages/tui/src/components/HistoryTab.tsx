/**
 * History Tab Component
 *
 * @description 과거 세션 목록 조회 및 필터링
 */

/** @jsxImportSource react */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * 세션 아이템
 */
export interface SessionItem {
  id: string;
  project_name: string;
  started_at: number;
  ended_at?: number;
  total_tokens: number;
  request_count?: number;
}

/**
 * History Tab props
 */
export interface HistoryTabProps {
  sessions?: SessionItem[];
  onSessionSelect?: (session: SessionItem) => void;
  isActive?: boolean;
}

/**
 * 시간 포맷
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/**
 * 경과 시간 포맷
 */
function formatDuration(startedAt: number, endedAt?: number): string {
  const end = endedAt || Date.now();
  const duration = end - startedAt;
  const minutes = Math.floor(duration / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

/**
 * 토큰 형식화
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${tokens}`;
}

/**
 * History Tab 컴포넌트
 */
export function HistoryTab({
  sessions = [],
  onSessionSelect,
  isActive = false,
}: HistoryTabProps): JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // 필터링된 세션
  const filteredSessions = sessions.filter(s =>
    s.project_name.toLowerCase().includes(filter.toLowerCase())
  );

  // 키보드 핸들링 — isActive 가드로 비활성 탭 이벤트 차단
  useInput((input, key) => {
    if (!isActive) return;
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(filteredSessions.length - 1, prev + 1));
    } else if (key.return && filteredSessions[selectedIndex]) {
      const session = filteredSessions[selectedIndex];
      setSelectedSessionId(session.id);
      onSessionSelect?.(session);
    } else if (key.escape) {
      if (selectedSessionId) {
        setSelectedSessionId(null);
      } else {
        setFilter('');
      }
    } else if (input && !key.ctrl && !key.meta && !key.escape) {
      if (input === '/') {
        setFilter('');
      } else if (input.length === 1) {
        setFilter(prev => prev + input);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* 필터 표시 */}
      {filter && (
        <Box marginBottom={1}>
          <Text color="cyan">Filter: {filter}</Text>
        </Box>
      )}

      {/* 헤더 */}
      <Box height={1} borderStyle="single" borderBottom borderColor="gray">
        <Box width="25%"><Text bold>Project</Text></Box>
        <Box width="25%"><Text bold>Started</Text></Box>
        <Box width="15%"><Text bold>Duration</Text></Box>
        <Box width="20%" justifyContent="flex-end"><Text bold>Tokens</Text></Box>
        <Box width="15%" justifyContent="flex-end"><Text bold>Status</Text></Box>
      </Box>

      {/* 세션 목록 */}
      {filteredSessions.length === 0 ? (
        <Box paddingY={2}>
          <Text color="gray">No sessions found. Press / to search.</Text>
        </Box>
      ) : (
        filteredSessions.map((session, index) => {
          const isCursor = index === selectedIndex;
          const isPinned = session.id === selectedSessionId;
          const isRunning = !session.ended_at;
          const color = isPinned ? 'cyan' : isCursor ? 'white' : 'gray';
          const bold = isPinned || isCursor;
          const prefix = isPinned ? '● ' : isCursor ? '> ' : '  ';

          return (
            <Box key={session.id} height={1}>
              <Box width="25%">
                <Text color={color} wrap="truncate" bold={bold}>
                  {prefix}{session.project_name}
                </Text>
              </Box>
              <Box width="25%">
                <Text color={color} bold={bold}>
                  {formatDate(session.started_at)}
                </Text>
              </Box>
              <Box width="15%">
                <Text color={color} bold={bold}>
                  {formatDuration(session.started_at, session.ended_at)}
                </Text>
              </Box>
              <Box width="20%" justifyContent="flex-end">
                <Text color={isPinned ? 'cyan' : 'yellow'} bold={bold}>
                  {formatTokens(session.total_tokens)}
                </Text>
              </Box>
              <Box width="15%" justifyContent="flex-end">
                <Text color={isPinned ? 'cyan' : isRunning ? 'green' : 'gray'} bold={bold}>
                  {isRunning ? '● Active' : '○ Ended'}
                </Text>
              </Box>
            </Box>
          );
        })
      )}

      {/* 도움말 */}
      <Box marginTop={1}>
        <Text color="gray">↑↓ Navigate | Enter Select | / Search | ESC Deselect/Clear</Text>
      </Box>
    </Box>
  );
}
