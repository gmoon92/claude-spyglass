/**
 * types.ts — TUI 전용 타입 + @spyglass/types에서 가져온 공유 타입.
 *
 * srp-redesign ADR-006 (Phase 1B 부분 적용):
 *   `Session` 타입은 @spyglass/types/Session에서 import (server-TUI 단일 정의).
 *   `Request` 타입은 본 PR 범위에서 TUI 자체 정의 유지 — 매핑 어댑터(useSessionTurns 등)가
 *   `null` 친화 패턴이라 RequestRow(`undefined` 친화)와 호환 작업이 추가로 필요.
 *   이 호환 정리는 다음 Phase로 인계 (PR 단위 SRP 준수: 변경 이유 단일화).
 *
 * 다음 Phase (예정):
 *   - useSessionTurns/useSSE 어댑터의 null/undefined 정책 통일
 *   - TUI Request 타입을 NormalizedRequest 기반으로 교체
 */

import type { Session as SharedSession } from '@spyglass/types';

// =============================================================================
// 공유 타입 re-export
// =============================================================================

/** Session summary. @see @spyglass/types/Session */
export type Session = SharedSession & {
  /** TUI 전용 — 활성 세션 카운트 표시용 */
  request_count?: number;
  current_turn?: number;
};

// =============================================================================
// TUI 전용 타입 (본 PR 범위에서 자체 정의 유지)
// =============================================================================

export type EventType = 'pre_tool' | 'tool' | 'prompt' | 'system' | null | undefined;

/** A single request row from /api/sessions/:id/requests or SSE new_request. */
export type Request = {
  id: string;
  session_id: string;
  type?: string;
  request_type?: string;
  tool_name?: string | null;
  tool_detail?: string | null;
  tool_use_id?: string | null;
  /** data-honesty-ui: 부모 Agent 호출의 tool_use_id (sub-agent transcript 자식). */
  parent_tool_use_id?: string | null;
  event_type?: EventType;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  tokens_cache_read?: number;
  tokens_cache_creation?: number;
  duration_ms?: number;
  model?: string | null;
  timestamp: number;
  payload?: string | null;
  turn_id?: string | null;
  status?: 'ok' | 'error' | string | null;
  /** data-honesty-ui: 토큰 메타 신뢰도 ('high'|'low'|'error'). */
  tokens_confidence?: string | null;
  /** Local UI marker — when did this row arrive? */
  arrivedAt?: number;
};

/** Strip stats from /api/stats/strip. */
export type StripStats = {
  total_sessions?: number;
  active_sessions?: number;
  total_requests?: number;
  total_tokens?: number;
  p95_duration_ms?: number;
  error_rate?: number;
  cache_hit_rate?: number;
  context_usage?: number;
};

/** Anomaly row. */
export type Anomaly = {
  id: string;
  level: 'P0' | 'P1' | 'P2';
  kind: 'spike' | 'slow' | 'loop' | string;
  session_id: string;
  turn_id?: string | null;
  tool_name?: string | null;
  detail?: string | null;
  timestamp: number;
};

/** Tool stats row. */
export type ToolStat = {
  tool_name: string;
  category?: string;
  calls: number;
  avg_tokens?: number;
  p95_duration_ms?: number;
  error_rate?: number;
  trend?: number[];
  /** data-honesty-ui: 행 내 신뢰도 비-high 토큰이 1건이라도 있으면 true. */
  has_low_confidence?: boolean;
};

/** Pulse Wave state. */
export type PulseState = 'idle' | 'active' | 'spike';

/** Tab/screen identifier. */
export type ScreenId = 'live' | 'sessions' | 'session-detail' | 'tools' | 'anomalies' | 'ambient';
