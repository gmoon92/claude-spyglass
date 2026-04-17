/**
 * Live Tab Component
 *
 * @description 실시간 토큰 카운터 및 세션 모니터링
 * @see docs/planning/02-prd.md - 실시간 토큰 카운터
 */

/** @jsxImportSource react */
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { DashboardData } from '../hooks/useStats';
import { useSSE } from '../hooks/useSSE';
import { ProgressBar } from './ProgressBar';
import { SessionTimer } from './SessionTimer';

interface RecentRequest {
  id: string;
  type: string;
  tool_name?: string | null;
  tokens_total: number;
  timestamp: number;
}

export interface LiveTabProps {
  data: DashboardData | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Live Tab 컴포넌트
 */
const API_URL = 'http://localhost:9999';
const MAX_RECENT = 20;

function formatType(type: string): string {
  if (type === 'prompt') return 'P';
  if (type === 'tool_call') return 'T';
  if (type === 'system') return 'S';
  return type.slice(0, 1).toUpperCase();
}

function typeColor(type: string): string {
  if (type === 'prompt') return 'cyan';
  if (type === 'tool_call') return 'yellow';
  return 'gray';
}

export function LiveTab({ data, isLoading, error }: LiveTabProps): JSX.Element {
  const { stdout } = useStdout();
  const columns = stdout?.columns || 80;
  const { status: sseStatus, messages, lastMessage } = useSSE({ autoReconnect: true });
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([]);
  const prevStatusRef = useRef<string>(sseStatus);

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/requests?limit=${MAX_RECENT}`);
      const json = await res.json() as { success: boolean; data?: RecentRequest[] };
      if (json.success && json.data) {
        setRecentRequests(json.data.slice(0, MAX_RECENT));
      }
    } catch {
      // 조용히 실패
    }
  }, []);

  // SSE new_request 이벤트 수신 시 re-fetch
  const newReqCount = messages.filter(m => m.type === 'new_request').length;
  useEffect(() => {
    if (newReqCount > 0) fetchRecent();
  }, [newReqCount, fetchRecent]);

  // 재연결 감지 시 re-fetch
  useEffect(() => {
    if (prevStatusRef.current !== 'connected' && sseStatus === 'connected') {
      fetchRecent();
    }
    prevStatusRef.current = sseStatus;
  }, [sseStatus, fetchRecent]);

  // 초기 로드
  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  // SSE 상태 표시
  const statusColor = sseStatus === 'connected' ? 'green' : sseStatus === 'connecting' ? 'yellow' : 'red';
  const statusText = sseStatus === 'connected' ? '● LIVE' : sseStatus === 'connecting' ? '⟳ Connecting' : '○ Disconnected';

  // 시간 포맷팅
  const currentTime = useMemo(() => {
    return new Date().toLocaleTimeString();
  }, [lastMessage?.timestamp]);

  // 토큰 형식화 (1000 -> 1K)
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${tokens}`;
  };

  if (isLoading && !data) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Loading...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error: {error}</Text>
        <Text color="gray">Make sure spyglass server is running on port 9999</Text>
        <Text color="gray">API: http://localhost:9999/api/dashboard</Text>
      </Box>
    );
  }

  const summary = data?.summary;
  const tokens = summary?.totalTokens || 0;
  const maxTokens = 100000; // 예상 최대 토큰
  const progress = Math.min((tokens / maxTokens) * 100, 100);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* 헤더 상태 */}
      <Box marginBottom={1}>
        <Text color={statusColor} bold>{statusText}</Text>
        <Text color="gray"> | Last update: {currentTime}</Text>
      </Box>

      {/* 메인 카운터 */}
      <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Text color="gray">Total Tokens: </Text>
          <Text bold color="cyan">{formatTokens(tokens)}</Text>
        </Box>

        {/* 프로그레스 바 */}
        <Box marginY={1}>
          <ProgressBar progress={progress} width={Math.min(40, columns - 30)} />
        </Box>

        <Box>
          <Text color="gray">{formatTokens(tokens)} / {formatTokens(maxTokens)}</Text>
          <Text color="gray"> ({progress.toFixed(1)}%)</Text>
        </Box>
      </Box>

      {/* 세션 정보 */}
      <Box flexDirection="row" marginY={1}>
        <Box width="50%">
          <Text color="gray">Active Sessions: </Text>
          <Text bold color="yellow">{summary?.activeSessions || 0}</Text>
        </Box>
        <Box width="50%">
          <Text color="gray">Session Time: </Text>
          {data?.active?.[0]
            ? <SessionTimer startedAt={data.active[0].started_at} endedAt={data.active[0].ended_at ?? undefined} />
            : <Text bold>--:--:--</Text>
          }
        </Box>
      </Box>

      {/* 요약 통계 */}
      <Box flexDirection="row" marginY={1}>
        <Box width="33%">
          <Text color="gray">Total Sessions</Text>
          <Text bold>{summary?.totalSessions || 0}</Text>
        </Box>
        <Box width="33%">
          <Text color="gray">Total Requests</Text>
          <Text bold>{summary?.totalRequests || 0}</Text>
        </Box>
        <Box width="33%">
          <Text color="gray">Avg Tokens/Req</Text>
          <Text bold>{Math.round(data?.requests?.avg_tokens_per_request || 0)}</Text>
        </Box>
      </Box>

      {/* 실시간 요청 목록 */}
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray" underline>Recent Requests ({recentRequests.length})</Text>
        {recentRequests.length === 0 ? (
          <Text color="gray">No requests yet...</Text>
        ) : (
          recentRequests.slice(0, 8).map(req => (
            <Box key={req.id} height={1}>
              <Box width="4%">
                <Text color={typeColor(req.type)} bold>{formatType(req.type)}</Text>
              </Box>
              <Box width="50%">
                <Text color="white" wrap="truncate">{req.tool_name || '—'}</Text>
              </Box>
              <Box width="26%" justifyContent="flex-end">
                <Text color="yellow">{req.tokens_total.toLocaleString()}</Text>
              </Box>
              <Box width="20%" justifyContent="flex-end">
                <Text color="gray">{new Date(req.timestamp).toLocaleTimeString()}</Text>
              </Box>
            </Box>
          ))
        )}
      </Box>

    </Box>
  );
}
