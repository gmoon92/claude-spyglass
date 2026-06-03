/**
 * fixtures.ts — 특성화 테스트 공통 데이터 팩토리.
 *
 * 소스 변경 없음. Request / Session / API turn 응답을 짧은 over-ride 만으로
 * 생성하기 위한 빌더 모음. 기존 tool-row-alignment.test.ts 의 makeRecord 와
 * 동일한 스타일(현재 동작 고정).
 */

import type { Request, Session, StripStats, ToolStat } from '../../types';

/** 공통 Request(=tool row) 베이스 빌더. */
export function makeRequest(over: Partial<Request> = {}): Request {
  return {
    id: 'r-001',
    session_id: 'sess-abcdef0123',
    timestamp: new Date('2026-05-03T14:32:08').getTime(),
    tool_name: 'Read',
    tool_detail: '/path/to/file.ts',
    duration_ms: 120,
    tokens_total: 1200,
    status: 'ok',
    event_type: 'tool',
    ...over,
  };
}

/** 공통 Session 베이스 빌더. @spyglass/types/Session + TUI 확장 필드. */
export function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 'sess-abcdef0123456789',
    project: 'demo',
    started_at: new Date('2026-05-03T14:00:00').getTime(),
    total_tokens: 12_345,
    request_count: 3,
    current_turn: 2,
    ...over,
  } as Session;
}

/** API /api/sessions/:id/turns 응답의 tool_call 한 건. */
export function makeApiToolCall(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tc-1',
    timestamp: new Date('2026-05-03T14:32:08').getTime(),
    tool_name: 'Read',
    tool_detail: 'main.ts',
    tokens_input: 100,
    tokens_output: 50,
    tokens_total: 150,
    duration_ms: 80,
    event_type: 'tool',
    model: 'claude-x',
    ...over,
  };
}

/** API turn 한 건. */
export function makeApiTurn(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turn_id: 'turn-1',
    turn_index: 0,
    started_at: new Date('2026-05-03T14:32:00').getTime(),
    prompt: null,
    tool_calls: [makeApiToolCall()],
    summary: null,
    ...over,
  };
}

/** API /api/proxy-requests 응답 row 한 건. */
export function makeProxyRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'px-1',
    model: 'claude-sonnet-x',
    stop_reason: 'end_turn',
    response_preview: 'hello',
    first_token_ms: 120,
    tokens_per_second: 40,
    timestamp: new Date('2026-05-03T14:32:00').getTime(),
    session_id: 'sess-1',
    ...over,
  };
}

/** StripStats 베이스. */
export function makeStripStats(over: Partial<StripStats> = {}): StripStats {
  return {
    p95_duration_ms: 100,
    error_rate: 0,
    ...over,
  };
}

/** ToolStat 베이스. */
export function makeToolStat(over: Partial<ToolStat> = {}): ToolStat {
  return {
    tool_name: 'Read',
    calls: 5,
    avg_tokens: 100,
    p95_duration_ms: 80,
    error_rate: 0,
    ...over,
  };
}
