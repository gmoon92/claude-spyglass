/**
 * Proxy Request CRUD Operations
 *
 * @description proxy_requests 테이블: HTTP 프록시 레이어에서 수집한 API 메트릭
 */

import type { Database } from 'bun:sqlite';

// =============================================================================
// 타입 정의
// =============================================================================

export interface ProxyRequest {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  status_code: number | null;
  response_time_ms: number | null;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  tokens_per_second: number | null;
  is_stream: number;
  messages_count: number;
  max_tokens: number | null;
  tools_count: number;
  request_preview: string | null;
  stop_reason: string | null;
  response_preview: string | null;
  error_type: string | null;
  error_message: string | null;
  first_token_ms: number | null;
  api_request_id: string | null;
  created_at: number;
  session_id: string | null;
}

export interface CreateProxyRequestParams {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  status_code?: number | null;
  response_time_ms?: number | null;
  model?: string | null;
  tokens_input?: number;
  tokens_output?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  tokens_per_second?: number | null;
  is_stream?: boolean;
  messages_count?: number;
  max_tokens?: number | null;
  tools_count?: number;
  request_preview?: string | null;
  stop_reason?: string | null;
  response_preview?: string | null;
  error_type?: string | null;
  error_message?: string | null;
  first_token_ms?: number | null;
  api_request_id?: string | null;
}

// =============================================================================
// SQL
// =============================================================================

// cost_usd 컬럼은 더 이상 채우지 않음 (항상 NULL)
// 정확한 가격 플랜을 알 수 없으므로 추정치는 신뢰도 낮음 — 기존 컬럼은 schema 호환을 위해 유지
const SQL_CREATE = `
  INSERT INTO proxy_requests (
    id, timestamp, method, path, status_code, response_time_ms,
    model, tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens,
    tokens_per_second, is_stream,
    messages_count, max_tokens, tools_count, request_preview,
    stop_reason, response_preview, error_type, error_message,
    first_token_ms, api_request_id
  ) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?
  )
`;

// proxy 요청은 자체적으로 session_id를 갖지 않으므로 timestamp 기반으로 hook 데이터와 매칭한다.
// 매칭 우선순위: (1) ±5s 이내 prompt 행, (2) ±10s 이내 같은 turn의 tool_call 행 (앞·뒤 모두 허용).
// 단순 "직전 prompt만" 보던 기존 쿼리는 매칭률이 3% 수준이었음.
const SQL_GET_RECENT = `
  SELECT *,
    COALESCE(
      (SELECT session_id FROM requests
       WHERE type = 'prompt'
         AND timestamp BETWEEN proxy_requests.timestamp - 5000 AND proxy_requests.timestamp + 2000
       ORDER BY ABS(timestamp - proxy_requests.timestamp) ASC
       LIMIT 1),
      (SELECT session_id FROM requests
       WHERE type = 'tool_call'
         AND timestamp BETWEEN proxy_requests.timestamp - 10000 AND proxy_requests.timestamp + 5000
       ORDER BY ABS(timestamp - proxy_requests.timestamp) ASC
       LIMIT 1)
    ) AS session_id
  FROM proxy_requests
  ORDER BY timestamp DESC
  LIMIT ?
`;

const SQL_GET_STATS = `
  SELECT
    COUNT(*)                  AS total_requests,
    SUM(tokens_input)         AS total_input_tokens,
    SUM(tokens_output)        AS total_output_tokens,
    AVG(response_time_ms)     AS avg_response_ms,
    AVG(tokens_per_second)    AS avg_tps,
    AVG(first_token_ms)       AS avg_ttft_ms,
    SUM(CASE WHEN is_stream=1 THEN 1 ELSE 0 END) AS stream_count,
    COUNT(DISTINCT model)     AS model_count
  FROM proxy_requests
  WHERE timestamp >= ?
`;

// =============================================================================
// CRUD
// =============================================================================

export function createProxyRequest(db: Database, p: CreateProxyRequestParams): void {
  db.run(SQL_CREATE, [
    p.id, p.timestamp, p.method, p.path,
    p.status_code ?? null, p.response_time_ms ?? null,
    p.model ?? null,
    p.tokens_input ?? 0, p.tokens_output ?? 0,
    p.cache_creation_tokens ?? 0, p.cache_read_tokens ?? 0,
    p.tokens_per_second ?? null,
    p.is_stream ? 1 : 0,
    p.messages_count ?? 0, p.max_tokens ?? null, p.tools_count ?? 0,
    p.request_preview ?? null,
    p.stop_reason ?? null, p.response_preview ?? null,
    p.error_type ?? null, p.error_message ?? null,
    p.first_token_ms ?? null, p.api_request_id ?? null,
  ]);
}

export function getRecentProxyRequests(db: Database, limit = 50): ProxyRequest[] {
  return db.query<ProxyRequest, [number]>(SQL_GET_RECENT).all(limit);
}

export interface ProxyStats {
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  avg_response_ms: number | null;
  avg_tps: number | null;
  avg_ttft_ms: number | null;
  stream_count: number;
  model_count: number;
}

export function getProxyStats(db: Database, sinceMs: number): ProxyStats {
  const row = db.query<ProxyStats, [number]>(SQL_GET_STATS).get(sinceMs);
  return row ?? {
    total_requests: 0, total_input_tokens: 0, total_output_tokens: 0,
    avg_response_ms: null, avg_tps: null,
    avg_ttft_ms: null, stream_count: 0, model_count: 0,
  };
}

const SQL_LATEST_RESPONSE_PREVIEW_BEFORE = `
  SELECT response_preview, model, tokens_input, tokens_output,
         cache_creation_tokens, cache_read_tokens, stop_reason
  FROM proxy_requests
  WHERE timestamp <= ?
    AND timestamp >= ?
    AND response_preview IS NOT NULL
    AND length(response_preview) > 0
  ORDER BY timestamp DESC
  LIMIT 1
`;

export interface LatestProxyResponse {
  response_preview: string;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  stop_reason: string | null;
}

/**
 * Stop 훅의 last_assistant_message가 비어 있을 때 fallback으로 사용.
 * 직전 windowMs(기본 30s) 내 가장 최근 proxy 응답 미리보기를 반환.
 */
export function getLatestProxyResponseBefore(
  db: Database,
  beforeMs: number,
  windowMs = 30_000,
): LatestProxyResponse | null {
  return db
    .query<LatestProxyResponse, [number, number]>(SQL_LATEST_RESPONSE_PREVIEW_BEFORE)
    .get(beforeMs, beforeMs - windowMs) ?? null;
}
