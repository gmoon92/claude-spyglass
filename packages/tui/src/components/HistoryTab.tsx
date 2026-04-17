/**
 * History Tab Component
 *
 * @description 과거 세션 목록 조회 및 필터링
 */

/** @jsxImportSource react */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

const API_URL = 'http://localhost:9999';

export interface SessionItem {
  id: string;
  project_name: string;
  started_at: number;
  ended_at?: number;
  total_tokens: number;
  request_count?: number;
}

interface SessionRequest {
  id: string;
  type: string;
  tool_name?: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms: number;
  timestamp: number;
}

export interface HistoryTabProps {
  sessions?: SessionItem[];
  onSessionSelect?: (session: SessionItem) => void;
  isActive?: boolean;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(startedAt: number, endedAt?: number): string {
  const end = endedAt || Date.now();
  const ms = end - startedAt;
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${tokens}`;
}

function typeColor(type: string): string {
  if (type === 'prompt') return 'cyan';
  if (type === 'tool_call') return 'yellow';
  return 'gray';
}

function typeLabel(type: string): string {
  if (type === 'prompt') return 'P';
  if (type === 'tool_call') return 'T';
  if (type === 'system') return 'S';
  return type.slice(0, 1).toUpperCase();
}

export function HistoryTab({
  sessions = [],
  onSessionSelect,
  isActive = false,
}: HistoryTabProps): JSX.Element {
  const { stdout } = useStdout();
  const columns = stdout?.columns || 80;
  const isSplit = columns >= 120;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [detailRequests, setDetailRequests] = useState<SessionRequest[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const filteredSessions = sessions.filter(s =>
    s.project_name.toLowerCase().includes(filter.toLowerCase())
  );

  const fetchDetail = useCallback(async (sessionId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`${API_URL}/api/sessions/${sessionId}/requests`);
      if (res.status === 404) {
        setDetailError('세션 데이터를 찾을 수 없습니다');
        setSelectedSessionId(null);
        setDetailLoading(false);
        return;
      }
      const json = await res.json() as { success: boolean; data?: SessionRequest[] };
      if (json.success && json.data) {
        setDetailRequests(json.data);
      }
    } catch {
      setDetailError('요청 목록 로드 실패');
    }
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setDetailRequests([]);
      setDetailError(null);
      return;
    }
    fetchDetail(selectedSessionId);
  }, [selectedSessionId, fetchDetail]);

  useInput((input, key) => {
    if (!isActive) return;

    if (showDetail && !isSplit) {
      // 상세 뷰 (좁은 터미널): ESC/Backspace로 목록 복귀
      if (key.escape || key.backspace) {
        setShowDetail(false);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(filteredSessions.length - 1, prev + 1));
    } else if (key.return && filteredSessions[selectedIndex]) {
      const session = filteredSessions[selectedIndex];
      setSelectedSessionId(session.id);
      setShowDetail(true);
      onSessionSelect?.(session);
    } else if (key.escape) {
      if (selectedSessionId) {
        setSelectedSessionId(null);
        setShowDetail(false);
      } else {
        setFilter('');
      }
    } else if (key.backspace && selectedSessionId) {
      setSelectedSessionId(null);
      setShowDetail(false);
    } else if (input && !key.ctrl && !key.meta && !key.escape) {
      if (input === '/') setFilter('');
      else if (input.length === 1) setFilter(prev => prev + input);
    }
  });

  const selectedSession = sessions.find(s => s.id === selectedSessionId) ?? null;

  const listView = (
    <Box flexDirection="column">
      {filter && (
        <Box marginBottom={1}>
          <Text color="cyan">Filter: {filter}</Text>
        </Box>
      )}

      <Box height={1}>
        <Box width="25%"><Text bold>Project</Text></Box>
        <Box width="25%"><Text bold>Started</Text></Box>
        <Box width="15%"><Text bold>Duration</Text></Box>
        <Box width="20%" justifyContent="flex-end"><Text bold>Tokens</Text></Box>
        <Box width="15%" justifyContent="flex-end"><Text bold>Status</Text></Box>
      </Box>

      {filteredSessions.length === 0 ? (
        <Box paddingY={2}>
          <Text color="gray">No sessions found.</Text>
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
                <Text color={color} wrap="truncate" bold={bold}>{prefix}{session.project_name}</Text>
              </Box>
              <Box width="25%">
                <Text color={color} bold={bold}>{formatDate(session.started_at)}</Text>
              </Box>
              <Box width="15%">
                <Text color={color} bold={bold}>{formatDuration(session.started_at, session.ended_at)}</Text>
              </Box>
              <Box width="20%" justifyContent="flex-end">
                <Text color={isPinned ? 'cyan' : 'yellow'} bold={bold}>{formatTokens(session.total_tokens)}</Text>
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

      <Box marginTop={1}>
        <Text color="gray">↑↓ Navigate | Enter Select | / Search | ESC Deselect/Clear</Text>
      </Box>
    </Box>
  );

  const detailView = selectedSession ? (
    <Box flexDirection="column" paddingX={isSplit ? 1 : 0}>
      <Text bold color="cyan" wrap="truncate">{selectedSession.project_name}</Text>
      <Text color="gray">{formatDate(selectedSession.started_at)} · {formatDuration(selectedSession.started_at, selectedSession.ended_at)}</Text>

      {detailError && <Box marginTop={1}><Text color="red">{detailError}</Text></Box>}

      {detailLoading ? (
        <Text color="yellow">Loading...</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Box height={1}>
            <Box width="15%"><Text bold color="gray">Type</Text></Box>
            <Box width="35%"><Text bold color="gray">Tool</Text></Box>
            <Box width="30%" justifyContent="flex-end"><Text bold color="gray">Tokens</Text></Box>
            <Box width="20%" justifyContent="flex-end"><Text bold color="gray">Time</Text></Box>
          </Box>
          {detailRequests.slice(0, 15).map(req => (
            <Box key={req.id} height={1}>
              <Box width="15%">
                <Text color={typeColor(req.type)} bold>{typeLabel(req.type)}</Text>
              </Box>
              <Box width="35%">
                <Text wrap="truncate" color="white">{req.tool_name || '—'}</Text>
              </Box>
              <Box width="30%" justifyContent="flex-end">
                <Text color="yellow">{formatTokens(req.tokens_total)}</Text>
              </Box>
              <Box width="20%" justifyContent="flex-end">
                <Text color="gray">{formatTime(req.timestamp)}</Text>
              </Box>
            </Box>
          ))}

          {/* 타입별 소계 */}
          {detailRequests.length > 0 && (() => {
            const counts: Record<string, number> = {};
            detailRequests.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
            return (
              <Box marginTop={1}>
                {Object.entries(counts).map(([t, c]) => (
                  <Box key={t} marginRight={2}>
                    <Text color={typeColor(t)}>{t}: {c}</Text>
                  </Box>
                ))}
              </Box>
            );
          })()}

          {!isSplit && (
            <Box marginTop={1}>
              <Text color="gray">ESC/Backspace → back</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  ) : null;

  // 넓은 터미널: 좌우 분할
  if (isSplit) {
    return (
      <Box flexDirection="row" paddingX={1} paddingY={1}>
        <Box width="40%">{listView}</Box>
        <Box width="60%">{detailView ?? <Text color="gray">세션을 선택하세요</Text>}</Box>
      </Box>
    );
  }

  // 좁은 터미널: 토글 방식
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {(showDetail && selectedSession) ? detailView : listView}
    </Box>
  );
}
