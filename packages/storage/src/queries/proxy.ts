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
  // v19: hook ↔ proxy 정확 매칭용 컬럼 (헤더 x-claude-code-session-id 직접 저장)
  session_id: string | null;
  turn_id: string | null;
  // v20: 클라이언트/요청/응답 메타 (감사·분석 활용)
  client_user_agent: string | null;
  client_app: string | null;
  anthropic_beta: string | null;
  anthropic_org_id: string | null;
  anthropic_request_id: string | null;
  thinking_type: string | null;
  temperature: number | null;
  system_preview: string | null;
  tool_names: string | null;
  metadata_user_id: string | null;
  client_meta_json: string | null;
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
  session_id?: string | null;
  turn_id?: string | null;
  client_user_agent?: string | null;
  client_app?: string | null;
  anthropic_beta?: string | null;
  anthropic_org_id?: string | null;
  anthropic_request_id?: string | null;
  thinking_type?: string | null;
  temperature?: number | null;
  system_preview?: string | null;
  tool_names?: string | null;
  metadata_user_id?: string | null;
  client_meta_json?: string | null;
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
    first_token_ms, api_request_id,
    session_id, turn_id,
    client_user_agent, client_app, anthropic_beta,
    anthropic_org_id, anthropic_request_id,
    thinking_type, temperature, system_preview,
    tool_names, metadata_user_id, client_meta_json
  ) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?, ?
  )
`;

// proxy 요청은 자체적으로 session_id를 갖지 않으므로 timestamp 기반으로 hook 데이터와 매칭한다.
// 매칭 우선순위: (1) ±5s 이내 prompt 행, (2) ±10s 이내 같은 turn의 tool_call 행 (앞·뒤 모두 허용).
//
// 과거에는 SELECT 안의 상관 서브쿼리로 한 번에 조인했으나, Bun SQLite가 상관 서브쿼리 안에서
// outer 테이블/alias 컬럼 참조("no such column: proxy_requests.timestamp" / "pr.timestamp")를
// 해석하지 못하는 케이스가 있어, 단순 SELECT + JS 후처리로 분리한다. limit 50 수준이라 N+1 비용 무시 가능.
const SQL_GET_RECENT_BASE = `
  SELECT * FROM proxy_requests
  ORDER BY timestamp DESC
  LIMIT ?
`;

const SQL_FIND_PROMPT_SESSION = `
  SELECT session_id FROM requests
  WHERE type = 'prompt'
    AND timestamp BETWEEN $lo AND $hi
  ORDER BY ABS(timestamp - $pivot) ASC
  LIMIT 1
`;

const SQL_FIND_TOOL_SESSION = `
  SELECT session_id FROM requests
  WHERE type = 'tool_call'
    AND timestamp BETWEEN $lo AND $hi
  ORDER BY ABS(timestamp - $pivot) ASC
  LIMIT 1
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
    p.session_id ?? null, p.turn_id ?? null,
    p.client_user_agent ?? null, p.client_app ?? null, p.anthropic_beta ?? null,
    p.anthropic_org_id ?? null, p.anthropic_request_id ?? null,
    p.thinking_type ?? null,
    p.temperature ?? null,
    p.system_preview ?? null,
    p.tool_names ?? null,
    p.metadata_user_id ?? null,
    p.client_meta_json ?? null,
  ]);
}

export function getRecentProxyRequests(db: Database, limit = 50): ProxyRequest[] {
  const baseRows = db.query<ProxyRequest, [number]>(SQL_GET_RECENT_BASE).all(limit);
  const findPrompt = db.query<{ session_id: string }, { $lo: number; $hi: number; $pivot: number }>(
    SQL_FIND_PROMPT_SESSION,
  );
  const findTool = db.query<{ session_id: string }, { $lo: number; $hi: number; $pivot: number }>(
    SQL_FIND_TOOL_SESSION,
  );

  // v19+: row.session_id가 헤더로 직접 저장되면 그대로 사용. 구 데이터(NULL)는 timestamp 휴리스틱 fallback.
  return baseRows.map((row) => {
    if (row.session_id) return row;
    const ts = row.timestamp;
    const promptHit = findPrompt.get({ $lo: ts - 5000, $hi: ts + 2000, $pivot: ts });
    const toolHit = promptHit
      ? null
      : findTool.get({ $lo: ts - 10000, $hi: ts + 5000, $pivot: ts });
    return {
      ...row,
      session_id: promptHit?.session_id ?? toolHit?.session_id ?? null,
    };
  });
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
