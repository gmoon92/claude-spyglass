/**
 * types.ts — Shared TUI types.
 *
 * Mirrors server response shapes; keep in sync with packages/server/src/api.ts.
 */

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
  event_type?: EventType;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  duration_ms?: number;
  model?: string | null;
  timestamp: number;
  payload?: string | null;
  turn_id?: string | null;
  status?: 'ok' | 'error' | string | null;
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

/** Session summary. */
export type Session = {
  id: string;
  project_name?: string | null;
  started_at: number;
  ended_at?: number | null;
  total_tokens?: number;
  request_count?: number;
  current_turn?: number;
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
};

/** Pulse Wave state. */
export type PulseState = 'idle' | 'active' | 'spike';

/** Tab/screen identifier. */
export type ScreenId = 'live' | 'sessions' | 'session-detail' | 'tools' | 'anomalies' | 'ambient';
