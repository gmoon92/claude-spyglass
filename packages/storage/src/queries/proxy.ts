/**
 * Proxy Request CRUD Operations
 *
 * @description proxy_requests 테이블: HTTP 프록시 레이어에서 수집한 API 메트릭
 */

import type { Database } from 'bun:sqlite';
import { encodeText, decodeText } from '../payload-codec';
import { getActiveKey, shouldEncrypt } from '../runtime/encryption';

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
  // R3(ⓝ1, Migration 057): request/response/system preview at-rest 암호화 마커(3컬럼 공유).
  // NULL=평문, 'aes256gcm'=암호문(base64-in-TEXT). 읽기 시 decodeText로 분기 복호.
  preview_algo?: string | null;
  // v66(CAS Phase 3): payload 저장 방식 신호. 'chunks/v1'=proxy_request_chunks로 재조립(CAS),
  // NULL=레거시(payload BLOB 직접 decodeBlob). reconstructProxyPayloadText가 이 값으로 분기.
  payload_manifest_algo?: string | null;
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
  // v66(CAS, 기본): 'chunks/v1'=payload를 proxy_request_chunks로 분해 저장(payload는 NULL),
  // NULL=비-conversation 통짜 저장. inbound가 splitConversation 성공 여부로 결정(옵션 아님).
  payload_manifest_algo?: string | null;
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
    system_hash, system_byte_size, preview_algo,
    payload_manifest_algo
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
    ?, ?, ?,
    ?
  )
`;

// proxy 요청은 자체적으로 session_id를 갖지 않으므로 timestamp 기반으로 hook 데이터와 매칭한다.
// 매칭 우선순위: (1) ±5s 이내 prompt 행, (2) ±10s 이내 같은 turn의 tool_call 행 (앞·뒤 모두 허용).
//
// 과거에는 SELECT 안의 상관 서브쿼리로 한 번에 조인했으나, Bun SQLite가 상관 서브쿼리 안에서
// outer 테이블/alias 컬럼 참조("no such column: proxy_requests.timestamp" / "pr.timestamp")를
// 해석하지 못하는 케이스가 있어, 단순 SELECT + JS 후처리로 분리한다. limit 50 수준이라 N+1 비용 무시 가능.
// perf pass (urgent): SELECT *는 payload(zstd Uint8Array, 수십~수백 KB)도 끌어와
// JSON 직렬화 시 `{"0":byte,"1":byte,...}` 형태로 폭증(실측 행당 16 MB → 50건 응답 126 MB).
// 메트릭 카드/드롭다운/딥링크 경로는 payload·미리보기 BLOB이 필요 없으므로 명시 컬럼만 선택.
// payload 디코드가 필요한 경로는 단건 /api/proxy-requests/:id/messages에서 getProxyRequestById 사용.
const SQL_GET_RECENT_BASE = `
  SELECT
    id, timestamp, method, path, status_code, response_time_ms,
    model, tokens_input, tokens_output,
    cache_creation_tokens, cache_read_tokens,
    tokens_per_second, is_stream,
    messages_count, max_tokens, tools_count,
    stop_reason,
    error_type, error_message,
    first_token_ms, api_request_id,
    session_id, turn_id,
    client_user_agent, client_app, anthropic_beta,
    anthropic_org_id, anthropic_request_id,
    thinking_type, temperature,
    system_hash, system_byte_size,
    payload_raw_size, payload_algo,
    created_at
  FROM proxy_requests
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
  // R3(ⓝ1): request/response/system preview는 동일 키/정책으로 원자 동시 기록되고 개별 UPDATE
  //          경로가 없으므로 단일 preview_algo 마커를 공유한다(payload_algo와 분리 — payload는 BLOB
  //          zstd 계열, preview는 TEXT aes256gcm 계열로 의미가 달라 섞으면 codec 분기 분산).
  //          인코딩 분기는 payload-codec(encodeText)에 SSoT로 위임.
  const key = shouldEncrypt() ? getActiveKey() : null;
  // null preview는 그대로 null 유지(encodeText에 넘기면 "null" 문자열을 암호화하게 됨). 값이 있을 때만 인코딩.
  const encPrev = (v: string | null | undefined): string | null =>
    v == null ? null : encodeText(v, key).value;
  const reqPrevValue = encPrev(p.request_preview);
  const respPrevValue = encPrev(p.response_preview);
  const sysPrevValue = encPrev(p.system_preview);
  // 셋 다 동일 key로 인코딩되므로 algo는 일치(평문이면 NULL, 암호화면 'aes256gcm'). key 유무로 결정.
  const previewAlgo = key ? 'aes256gcm' : null;

  db.run(SQL_CREATE, [
    p.id, p.timestamp, p.method, p.path,
    p.status_code ?? null, p.response_time_ms ?? null,
    p.model ?? null,
    p.tokens_input ?? 0, p.tokens_output ?? 0,
    p.cache_creation_tokens ?? 0, p.cache_read_tokens ?? 0,
    p.tokens_per_second ?? null,
    p.is_stream ? 1 : 0,
    p.messages_count ?? 0, p.max_tokens ?? null, p.tools_count ?? 0,
    reqPrevValue,
    p.stop_reason ?? null, respPrevValue,
    p.error_type ?? null, p.error_message ?? null,
    p.first_token_ms ?? null, p.api_request_id ?? null,
    p.session_id ?? null, p.turn_id ?? null,
    p.client_user_agent ?? null, p.client_app ?? null, p.anthropic_beta ?? null,
    p.anthropic_org_id ?? null, p.anthropic_request_id ?? null,
    p.thinking_type ?? null,
    p.temperature ?? null,
    sysPrevValue,
    p.system_reminder ?? null,
    p.tool_names ?? null,
    p.metadata_user_id ?? null,
    p.client_meta_json ?? null,
    p.payload ?? null,
    p.payload_raw_size ?? null,
    p.payload_algo ?? null,
    p.system_hash ?? null,
    p.system_byte_size ?? null,
    previewAlgo,
    p.payload_manifest_algo ?? null,
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
  const row = (db.query('SELECT * FROM proxy_requests WHERE id = ?').get(id) as ProxyRequest | null) ?? null;
  // R3(ⓝ1): preview_algo 분기로 3 preview 컬럼 서버측 복호(평문/암호문 혼재 대응).
  // 현 /messages 라우트는 previews를 직렬화하지 않지만, ProxyRequest 표면을 평문으로 통일해
  // 향후 소비처의 silent corruption을 차단한다(decodeText SSoT).
  return decodeProxyPreviews(row);
}

/**
 * R3(ⓝ1): proxy_requests 행의 request/response/system preview를 preview_algo 분기로 복호한다.
 * 평문/암호문 혼재를 decodeText가 처리(평문 passthrough, 'aes256gcm'만 복호). 모든 preview는
 * 동일 preview_algo 마커를 공유한다(createProxyRequest가 동일 key로 원자 기록).
 */
function decodeProxyPreviews<T extends {
  request_preview?: string | null;
  response_preview?: string | null;
  system_preview?: string | null;
  preview_algo?: string | null;
}>(row: T | null): T | null {
  if (!row) return row;
  const key = getActiveKey();
  const algo = row.preview_algo;
  if (row.request_preview != null) row.request_preview = decodeText(row.request_preview, algo, key);
  if (row.response_preview != null) row.response_preview = decodeText(row.response_preview, algo, key);
  if (row.system_preview != null) row.system_preview = decodeText(row.system_preview, algo, key);
  return row;
}

/**
 * 세션 내 proxy 요청 1건의 슬림 메타 — 드롭다운/딥링크 매칭용.
 *
 * payload BLOB(수십~수백 KB)을 제외한 hot 컬럼만 노출 — 전체 행 SELECT *로 끌어오면
 * 한 세션 100+건일 때 MB 단위 네트워크 비용 발생하여 LLM Input 탭 진입이 체감 가능하게 지연.
 * `getProxyRequestById`(단건 + payload 디코드 포함)와 역할 분리.
 */
export interface ProxyRequestSummary {
  id: string;
  timestamp: number;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  system_hash: string | null;
  system_byte_size: number | null;
  stop_reason: string | null;
  api_request_id: string | null;
}

const SQL_GET_BY_SESSION_SLIM = `
  SELECT id, timestamp, model,
         tokens_input, tokens_output,
         cache_creation_tokens, cache_read_tokens,
         system_hash, system_byte_size,
         stop_reason, api_request_id
  FROM proxy_requests
  WHERE session_id = ?
  ORDER BY timestamp ASC
  LIMIT ?
`;

/**
 * 세션 단위 proxy_requests 시간 오름차순 슬림 조회 (perf pass).
 *
 * LLM Input 탭의 proxy 요청 선택기(드롭다운) + 턴뷰 → LLM Input 딥링크 매칭에만 사용.
 * payload·preview·response_preview·tool_names 등 무거운 텍스트/BLOB 컬럼 제외.
 *
 * @param sessionId 필터 대상 세션 id
 * @param limit     최대 행 수 (기본 500 — 한 세션에 보통 수십~수백 건이라 충분)
 */
export function getProxyRequestsBySession(
  db: Database,
  sessionId: string,
  limit = 500,
): ProxyRequestSummary[] {
  return db.query(SQL_GET_BY_SESSION_SLIM).all(sessionId, limit) as ProxyRequestSummary[];
}

/**
 * system_hash로 참조 proxy_requests 슬림 조회 (ref-drilldown pass).
 *
 * "이 시스템 프롬프트가 어디서 재사용됐는가" 드릴다운 — System 섹션의 ref_count 칩 클릭 시 호출.
 * 가장 최근부터 보여주는 게 디버깅 흐름에 자연스러움(DESC 정렬).
 * session_id를 포함시켜 클라이언트가 "현재 세션 내 참조"와 "타 세션 참조"를 구분 표시.
 *
 * @param hash  system_prompts.hash (SHA-256 hex string)
 * @param limit 최대 행 수 (기본 100 — ref_count가 수천일 수도 있어 UX 한정. 향후 페이지네이션 가능)
 */
const SQL_GET_BY_SYSTEM_HASH = `
  SELECT id, timestamp, model,
         tokens_input, tokens_output,
         cache_creation_tokens, cache_read_tokens,
         system_hash, system_byte_size,
         stop_reason, api_request_id,
         session_id
  FROM proxy_requests
  WHERE system_hash = ?
  ORDER BY timestamp DESC
  LIMIT ?
`;

export interface ProxyRequestSystemRef extends ProxyRequestSummary {
  session_id: string | null;
}

export function getProxyRequestsBySystemHash(
  db: Database,
  hash: string,
  limit = 100,
): ProxyRequestSystemRef[] {
  return db.query(SQL_GET_BY_SYSTEM_HASH).all(hash, limit) as ProxyRequestSystemRef[];
}

/**
 * 한 system_prompt(hash)의 재사용 비용 집계 — ref 칩의 캐시 효율 신호 SSoT.
 *
 * "이 프롬프트가 N회 재사용됐다"는 숫자 단독은 노이즈. 진짜 인사이트는 **캐시가 먹혔는가**다.
 * 대부분의 프롬프트는 cache_read 로 97~99% 재활용되지만, 일부는 캐시가 깨져 매 요청마다
 * 입력 토큰을 통째로 다시 과금한다(=비용 누수). cache_hit_pct 가 그 신호.
 *
 * cache_hit_pct = cache_read / (cache_read + cache_creation + fresh_input) · 100
 *   - 분모는 "프롬프트 입력 측"에 청구된 총 토큰. output 은 캐시 대상이 아니라 제외.
 *   - 행이 없으면(미참조 hash) reqs=0, pct=null.
 *
 * @param hash system_prompts.hash (SHA-256 hex)
 */
export interface ProxySystemUsageStats {
  reqs: number;
  total_input_tokens: number;     // SUM(tokens_input) — 캐시 미적용 시 매번 새로 과금된 입력
  total_cache_read: number;       // SUM(cache_read_tokens)
  total_cache_create: number;     // SUM(cache_creation_tokens)
  cache_hit_pct: number | null;   // 0~100, 입력 측 토큰 기준. reqs=0이면 null
  distinct_sessions: number;
  distinct_models: number;
  first_seen_at: number | null;
  last_seen_at: number | null;
}

const SQL_SYSTEM_USAGE_STATS = `
  SELECT
    COUNT(*)                              AS reqs,
    COALESCE(SUM(tokens_input), 0)        AS total_input_tokens,
    COALESCE(SUM(cache_read_tokens), 0)   AS total_cache_read,
    COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_create,
    COUNT(DISTINCT session_id)            AS distinct_sessions,
    COUNT(DISTINCT model)                 AS distinct_models,
    MIN(timestamp)                        AS first_seen_at,
    MAX(timestamp)                        AS last_seen_at
  FROM proxy_requests
  WHERE system_hash = ?
`;

export function getSystemPromptUsageStats(db: Database, hash: string): ProxySystemUsageStats {
  const row = db.query(SQL_SYSTEM_USAGE_STATS).get(hash) as {
    reqs: number;
    total_input_tokens: number;
    total_cache_read: number;
    total_cache_create: number;
    distinct_sessions: number;
    distinct_models: number;
    first_seen_at: number | null;
    last_seen_at: number | null;
  };
  const inputSide = row.total_cache_read + row.total_cache_create + row.total_input_tokens;
  const cache_hit_pct =
    row.reqs > 0 && inputSide > 0
      ? Math.round((1000 * row.total_cache_read) / inputSide) / 10 // 소수 1자리
      : row.reqs > 0
        ? 0
        : null;
  return { ...row, cache_hit_pct };
}

export function getRecentProxyRequests(db: Database, limit = 50): ProxyRequest[] {
  const baseRows = db.query<ProxyRequest, [number]>(SQL_GET_RECENT_BASE).all(limit);

  // perf pass P1-B: v19+ 데이터만 있는 환경(헤더로 session_id 직접 저장)은 휴리스틱 N+1이 필요 없음.
  // 한 번 sweep으로 NULL session_id가 없으면 바로 반환 — 최대 limit×2(=100) SELECT 제거.
  // 구 데이터가 한 건이라도 섞여 있으면 기존 휴리스틱으로 폴백.
  if (baseRows.every((r) => r.session_id !== null)) {
    return baseRows;
  }

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

// R3(ⓝ1): preview_algo를 함께 가져와 response_preview를 서버측 복호한다(평문/암호문 혼재).
// 주의: length(response_preview) > 0 필터는 저장값(평문 또는 base64 암호문) 기준으로 동작 —
// 암호문도 길이>0이므로 비어있지 않은 응답을 정상 선별한다.
const SQL_LATEST_RESPONSE_PREVIEW_BEFORE = `
  SELECT response_preview, preview_algo, model, tokens_input, tokens_output,
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
  /** R3(ⓝ1): response_preview 복호 분기용 마커(내부 — 복호 후 호출자에 노출 불필요). */
  preview_algo?: string | null;
}

/**
 * R3(ⓝ1): LatestProxyResponse의 response_preview를 preview_algo 분기로 평문 복원한다.
 * events.ts가 이 값을 response 본문(message)으로 재사용하므로 반드시 평문이어야 한다.
 */
function decodeLatestResponse(row: LatestProxyResponse | null): LatestProxyResponse | null {
  if (!row) return row;
  if (row.response_preview != null) {
    row.response_preview = decodeText(row.response_preview, row.preview_algo, getActiveKey()) ?? row.response_preview;
  }
  return row;
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
  return decodeLatestResponse(
    db
      .query<LatestProxyResponse, [string, number, number]>(SQL_LATEST_RESPONSE_PREVIEW_BEFORE)
      .get(sessionId, beforeMs, beforeMs - windowMs) ?? null,
  );
}

// =============================================================================
// 세션 컨텍스트 추정 — orphan(turn_id NULL) 행 보강용
// =============================================================================

/**
 * 세션의 "최대 컨텍스트" proxy 행을 반환.
 *
 * 사용처: prompt 행이 0건인 세션(서버 재시작 직후 진행 중 세션 등)에서
 * implicit turn의 prompt context를 합성할 때 입력 토큰 + 캐시 합이 가장 큰 행을 사용.
 *
 * @returns 후보 없으면 null
 */
export function getMaxContextProxyForSession(
  db: Database,
  sessionId: string,
): {
  timestamp: number;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  /** context-window-derivation: orphan turn fallback에서도 클라이언트가 한도 추론 가능하도록 함께 노출. */
  anthropic_beta: string | null;
} | null {
  const row = db.query<{
    timestamp: number;
    model: string | null;
    tokens_input: number;
    tokens_output: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    anthropic_beta: string | null;
  }, [string]>(
    `SELECT timestamp, model, tokens_input, tokens_output,
            cache_read_tokens, cache_creation_tokens, anthropic_beta
       FROM proxy_requests
      WHERE session_id = ?
      ORDER BY (COALESCE(tokens_input,0)
              + COALESCE(cache_read_tokens,0)
              + COALESCE(cache_creation_tokens,0)) DESC,
               timestamp DESC
      LIMIT 1`,
  ).get(sessionId);
  return row ?? null;
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
  // R3(ⓝ1): preview_algo 동반 조회 후 response_preview 서버측 복호(평문/암호문 혼재).
  return decodeLatestResponse(
    db
      .query<LatestProxyResponse, [string]>(
        `SELECT response_preview, preview_algo, model, tokens_input, tokens_output,
                cache_creation_tokens, cache_read_tokens, stop_reason
         FROM proxy_requests WHERE api_request_id = ? LIMIT 1`,
      )
      .get(apiRequestId) ?? null,
  );
}

/**
 * proxy commit 시 같은 tool_use_id를 가진 hook 행(requests)에 api_request_id를 backfill —
 * ADR-001 P1-E race-fix.
 *
 * 배경: hook PostToolUse가 proxy commit과 동일 시각에 도착하면 hook의 resolveApiRequestId
 * 시점엔 proxy_tool_uses 행이 아직 commit 전이라 NULL을 받게 된다. 한 번 NULL로 INSERT된
 * 행은 후속 backfill 메커니즘이 없어 영구 NULL이 됐다.
 *
 * 이 함수는 proxy 트랜잭션의 마지막 단계에서 호출되어, 같은 tool_use_id의 hook 행이 이미
 * INSERT되어 있고 api_request_id가 NULL이면 정확한 값으로 채운다. COALESCE로 기존 값
 * (이미 매칭 성공한 행)은 보존.
 *
 * @returns 실제로 갱신된 행 수 (보통 0 또는 1)
 */
export function backfillRequestApiRequestIdByToolUse(
  db: Database,
  toolUseId: string,
  apiRequestId: string,
): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(
    `UPDATE requests
     SET api_request_id = COALESCE(api_request_id, ?)
     WHERE tool_use_id = ? AND api_request_id IS NULL`,
    apiRequestId,
    toolUseId,
  );
  return (result?.changes as number) ?? 0;
}

// =============================================================================
// anomaly-bloated-sys (Migration 033/034) — system context 메타 조회
// =============================================================================

/**
 * 세션의 최대 system_byte_size + 모델 + beta + project_name 조회 (anomaly-bloated-sys).
 *
 * 사용처:
 *   - T-05 routes/requests.ts: 첫 prompt 행에 bloated_sys 필드를 채우기 전,
 *     해당 세션의 system 본문 크기(최댓값)를 추정한다. 같은 세션 내 다수 proxy 행 중
 *     `system_byte_size`가 가장 큰 행을 채택 — 보통 system 본문은 세션 내 동일이지만
 *     중간에 늘어났다면 critical을 더 정확히 잡기 위해 max 사용.
 *
 *   - T-08 CLI 백필 진단: 누락 행 식별.
 *
 * @returns 후보 없으면 null
 */
export function getSessionSystemContextMeta(
  db: Database,
  sessionId: string,
): {
  system_byte_size: number;
  model: string | null;
  anthropic_beta: string | null;
  project_name: string | null;
} | null {
  const row = db.query<{
    system_byte_size: number;
    model: string | null;
    anthropic_beta: string | null;
    project_name: string | null;
  }, [string]>(
    `SELECT p.system_byte_size  AS system_byte_size,
            p.model             AS model,
            p.anthropic_beta    AS anthropic_beta,
            s.project_name      AS project_name
       FROM proxy_requests p
       LEFT JOIN sessions s ON s.id = p.session_id
      WHERE p.session_id = ?
        AND p.system_byte_size IS NOT NULL
      ORDER BY p.system_byte_size DESC, p.timestamp DESC
      LIMIT 1`,
  ).get(sessionId);
  return row ?? null;
}
