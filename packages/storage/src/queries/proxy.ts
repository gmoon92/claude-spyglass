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
  system_reminder: string | null;
  tool_names: string | null;
  metadata_user_id: string | null;
  client_meta_json: string | null;
  // v21: zstd compressed payload
  payload: Uint8Array | null;
  payload_raw_size: number | null;
  payload_algo: string | null;
  // v22: system_prompts 정규화 dedup 참조 (ADR-001 / ADR-007)
  // hash는 system_prompts.hash로 JOIN, byte_size는 UI 'X KB' 라벨용 hot data.
  // system_reminder(v21)와 직교 — body.system 본문 vs user 메시지 안 reminder.
  system_hash: string | null;
  system_byte_size: number | null;
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
  system_reminder?: string | null;
  tool_names?: string | null;
  metadata_user_id?: string | null;
  client_meta_json?: string | null;
  // v21
  payload?: Uint8Array | null;
  payload_raw_size?: number | null;
  payload_algo?: string | null;
  // v22: system_prompts 참조 (system_hash NULL 허용 — body.system 미존재 또는 backfill 미수행 행 보존)
  system_hash?: string | null;
  system_byte_size?: number | null;
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
    thinking_type, temperature, system_preview, system_reminder,
    tool_names, metadata_user_id, client_meta_json,
    payload, payload_raw_size, payload_algo,
    system_hash, system_byte_size
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
    ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?,
    ?, ?
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
    p.system_reminder ?? null,
    p.tool_names ?? null,
    p.metadata_user_id ?? null,
    p.client_meta_json ?? null,
    p.payload ?? null,
    p.payload_raw_size ?? null,
    p.payload_algo ?? null,
    p.system_hash ?? null,
    p.system_byte_size ?? null,
  ]);
}

/**
 * 단건 proxy_requests 조회 — `/api/proxy-requests/:id/messages` 백엔드.
 *
 * payload(zstd BLOB)을 디코드해 LLM Input 탭(T-09)이 user 메시지 시퀀스를 노출할 수 있게 한다.
 * 디코드/JSON.parse는 호출자(api.ts)가 담당 — 본 함수는 row 자체만 반환.
 *
 * @param id  proxy_requests.id (요청 UUID)
 * @returns ProxyRequest 또는 미존재 시 null
 */
export function getProxyRequestById(db: Database, id: string): ProxyRequest | null {
  return (db.query('SELECT * FROM proxy_requests WHERE id = ?').get(id) as ProxyRequest | null) ?? null;
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
  WHERE session_id = ?
    AND timestamp <= ?
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
 * Stop 훅의 last_assistant_message가 비어 있을 때 fallback으로 사용 (ADR-001).
 *
 * 같은 `sessionId`의 proxy_requests에서 `beforeMs - windowMs ≤ timestamp ≤ beforeMs`
 * 구간에 있는 가장 최근 응답을 반환한다. 다른 세션의 proxy 응답이 잘못 매칭되지 않도록
 * session_id 필터는 필수. 윈도우 기본값 120s는 운영 데이터 평균 응답시간(~60s) ·
 * 최대 ~224s를 고려한 ADR-001 P0 결정값. 그보다 오래 걸린 응답은 누락될 수 있으며,
 * 이는 P1 (api_request_id 기반 정확 매칭)에서 해결 예정.
 *
 * @param sessionId Stop 훅을 발생시킨 세션의 id — proxy_requests 행과 동일 세션만 매칭
 * @param beforeMs   기준 시각 (보통 Stop 훅 timestamp). 이 시각 이전의 proxy 응답만 후보
 * @param windowMs   기준 시각 이전으로 거슬러 올라갈 최대 시간(ms). 기본 120000
 */
export function getLatestProxyResponseBefore(
  db: Database,
  sessionId: string,
  beforeMs: number,
  windowMs = 120_000,
): LatestProxyResponse | null {
  return db
    .query<LatestProxyResponse, [string, number, number]>(SQL_LATEST_RESPONSE_PREVIEW_BEFORE)
    .get(sessionId, beforeMs, beforeMs - windowMs) ?? null;
}

// =============================================================================
// proxy_tool_uses — tool_use_id ↔ api_request_id 매핑 (ADR-001 P1-E, v23)
// =============================================================================

/**
 * proxy SSE에서 추출한 tool_use 블록 한 건의 메타.
 * Anthropic 응답 메시지(api_request_id) 안에 포함된 tool_use 블록의 id와 이름을 보존하여,
 * 이후 hook PostToolUse가 tool_use_id로 정확한 api_request_id를 역조회할 수 있게 한다.
 */
export interface ProxyToolUse {
  tool_use_id: string;
  api_request_id: string;
  tool_name: string | null;
  block_index: number | null;
  created_at?: number;
}

/**
 * proxy SSE 파싱 결과의 tool_use 메타들을 일괄 INSERT.
 *
 * tool_use_id가 PRIMARY KEY이므로 중복 시 INSERT OR IGNORE — 같은 응답이 두 번 처리될 일이
 * 없지만 idempotent 보장. api_request_id가 빈 문자열이면 skip (proxy SSE 파싱 실패 케이스).
 *
 * @returns 실제로 INSERT된 행 수
 */
export function persistProxyToolUses(
  db: Database,
  apiRequestId: string,
  toolUses: Array<{ tool_use_id: string; tool_name: string | null; block_index: number | null }>,
): number {
  if (!apiRequestId || toolUses.length === 0) return 0;
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO proxy_tool_uses (
      tool_use_id, api_request_id, tool_name, block_index
    ) VALUES (?, ?, ?, ?)
  `);
  let inserted = 0;
  for (const t of toolUses) {
    if (!t.tool_use_id) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (stmt as any).run(t.tool_use_id, apiRequestId, t.tool_name, t.block_index);
      if (result.changes > 0) inserted++;
    } catch (e) {
      console.error('[Storage] persistProxyToolUses INSERT failed:', e);
    }
  }
  return inserted;
}

/**
 * tool_use_id로 발행 응답의 api_request_id를 조회 — hook PostToolUse 정확 매칭용.
 *
 * @returns 매핑 행 또는 null (proxy 응답 미수신, 다른 client가 발행 등)
 */
export function getProxyToolUseById(
  db: Database,
  toolUseId: string,
): ProxyToolUse | null {
  return db
    .query<ProxyToolUse, [string]>(
      `SELECT tool_use_id, api_request_id, tool_name, block_index, created_at
       FROM proxy_tool_uses WHERE tool_use_id = ? LIMIT 1`,
    )
    .get(toolUseId) ?? null;
}

/**
 * api_request_id로 proxy 응답을 직접 조회 — Stop hook의 transcript msg_id 매칭용.
 *
 * proxy_requests.api_request_id 인덱스 사용. 일치하는 응답 1건 또는 null.
 */
export function getProxyResponseByApiRequestId(
  db: Database,
  apiRequestId: string,
): LatestProxyResponse | null {
  return db
    .query<LatestProxyResponse, [string]>(
      `SELECT response_preview, model, tokens_input, tokens_output,
              cache_creation_tokens, cache_read_tokens, stop_reason
       FROM proxy_requests WHERE api_request_id = ? LIMIT 1`,
    )
    .get(apiRequestId) ?? null;
}
