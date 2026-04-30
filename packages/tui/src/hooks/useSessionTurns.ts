/**
 * useSessionTurns — HTTP fetch 기반 세션 Turn 조회 훅.
 *
 * GET /api/sessions/:id/turns 를 mount/sessionId 변경 시 즉시 호출하고,
 * 10초 폴링으로 갱신한다.
 *
 * 응답 필드 (실제 확인):
 *   turn: { turn_id, turn_index, started_at, prompt, tool_calls, summary }
 *   prompt: { id, timestamp, tokens_input, tokens_output, tokens_total,
 *             duration_ms, model, payload, cache_read_tokens, cache_creation_tokens }
 *   tool_call: { id, type, timestamp, tool_name, tool_detail,
 *                tokens_input, tokens_output, tokens_total,
 *                duration_ms, payload, event_type, model }
 */

import { useEffect, useRef, useState } from 'react';
import type { Turn } from '../components/display/TurnCard';
import type { Request } from '../types';

const POLL_INTERVAL_MS = 10_000;

// API 응답의 raw 타입 — 서버 응답 필드명 그대로 사용
type ApiToolCall = {
  id: string;
  type?: string;
  timestamp: number;
  tool_name?: string | null;
  tool_detail?: string | null;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  duration_ms?: number;
  payload?: string | null;
  event_type?: string | null;
  model?: string | null;
};

type ApiPrompt = {
  id: string;
  timestamp?: number;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  duration_ms?: number;
  model?: string | null;
  payload?: string | null;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  context_tokens?: number;
};

type ApiTurn = {
  turn_id: string;
  turn_index: number;
  started_at: number;
  prompt?: ApiPrompt | null;
  tool_calls?: ApiToolCall[];
  summary?: {
    tool_call_count?: number;
    tokens_input?: number;
    tokens_output?: number;
    total_tokens?: number;
    duration_ms?: number;
  } | null;
};

type ApiResponse = {
  success: boolean;
  data: ApiTurn[];
};

/** ApiToolCall → Request 매핑 */
function mapToolCallToRequest(tc: ApiToolCall, sessionId: string): Request {
  return {
    id: tc.id,
    session_id: sessionId,
    type: tc.type ?? 'tool_call',
    tool_name: tc.tool_name ?? null,
    tool_detail: tc.tool_detail ?? null,
    tool_use_id: tc.id,
    event_type: (tc.event_type as Request['event_type']) ?? undefined,
    tokens_input: tc.tokens_input ?? 0,
    tokens_output: tc.tokens_output ?? 0,
    tokens_total: tc.tokens_total ?? 0,
    duration_ms: tc.duration_ms ?? 0,
    model: tc.model ?? null,
    timestamp: tc.timestamp,
    payload: tc.payload ?? null,
    turn_id: null,
    status: undefined,
  };
}

/** prompt payload JSON에서 "prompt" 텍스트 추출 */
function extractPromptText(prompt: ApiPrompt | null | undefined): string | null {
  if (!prompt?.payload) return null;
  try {
    const parsed = JSON.parse(prompt.payload) as Record<string, unknown>;
    if (typeof parsed.prompt === 'string') return parsed.prompt;
  } catch {
    // 파싱 실패 시 null 반환
  }
  return null;
}

/** ApiTurn → Turn 매핑 */
function mapApiTurnToTurn(at: ApiTurn, sessionId: string): Turn {
  const toolCalls = at.tool_calls ?? [];
  const tools = toolCalls.map((tc) => mapToolCallToRequest(tc, sessionId));

  // state 결정: 마지막 tool_call의 event_type이 pre_tool이면 running,
  // 에러 있으면 error, 나머지는 done
  let state: Turn['state'] = 'done';
  const lastTool = toolCalls[toolCalls.length - 1];
  if (lastTool?.event_type === 'pre_tool') {
    state = 'running';
  } else if (tools.some((t) => t.status === 'error')) {
    state = 'error';
  }

  // endedAt: 마지막 tool_call의 timestamp
  const endedAt = lastTool?.timestamp ?? null;

  // totalTokens: summary.total_tokens 우선, 없으면 tool_call 합산
  const totalTokens =
    at.summary?.total_tokens ??
    tools.reduce((s, t) => s + (t.tokens_total ?? 0), 0);

  const totalInput = at.summary?.tokens_input ??
    tools.reduce((s, t) => s + (t.tokens_input ?? 0), 0);

  const totalOutput = at.summary?.tokens_output ??
    tools.reduce((s, t) => s + (t.tokens_output ?? 0), 0);

  const totalCacheRead = at.prompt?.cache_read_tokens ?? 0;
  const totalCacheCreation = at.prompt?.cache_creation_tokens ?? 0;

  // prompt 텍스트 (첫 줄만)
  const promptText = extractPromptText(at.prompt);
  const prompt = promptText ? promptText.split('\n')[0] : null;

  return {
    id: at.turn_id,
    index: at.turn_index,
    prompt,
    startedAt: at.started_at,
    endedAt,
    endReason: null,
    tools,
    totalTokens,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheCreation,
    state,
  };
}

export type UseSessionTurnsResult = {
  turns: Turn[];
  isLoading: boolean;
  error: string | null;
};

export function useSessionTurns(
  apiUrl: string,
  sessionId: string | null,
): UseSessionTurnsResult {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 현재 sessionId를 ref로 보관해 stale closure 방지
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    if (!sessionId) {
      setTurns([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchTurns() {
      if (cancelled) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/api/sessions/${sessionId}/turns`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!json.success || !Array.isArray(json.data)) {
          setTurns([]);
        } else {
          setTurns(json.data.map((at) => mapApiTurnToTurn(at, sessionId!)));
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchTurns();

    const timer = setInterval(fetchTurns, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiUrl, sessionId]);

  return { turns, isLoading, error };
}
