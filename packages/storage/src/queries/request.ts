/**
 * Request CRUD Operations
 *
 * @description Request 테이블 생성/조회/수정/삭제 및 집계 쿼리
 */

import type { Database } from 'bun:sqlite';
import type { Request, RequestType } from '../schema';
import { getPricingForModel } from '../pricing';

// =============================================================================
// 생성 (Create)
// =============================================================================

/** 요청 생성 파라미터 */
export interface CreateRequestParams {
  id: string;
  session_id: string;
  timestamp: number;
  type: RequestType;
  tool_name?: string;
  tool_detail?: string;
  turn_id?: string;
  model?: string;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  duration_ms?: number;
  payload?: string;
  source?: string | null;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  preview?: string | null;
  tool_use_id?: string | null;
  event_type?: string | null;
  tokens_confidence?: string;
  tokens_source?: string;
}

/** 요청 생성 SQL */
const SQL_CREATE_REQUEST = `
  INSERT INTO requests (
    id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
    tokens_input, tokens_output, tokens_total, duration_ms, payload, source,
    cache_creation_tokens, cache_read_tokens, preview, tool_use_id, event_type,
    tokens_confidence, tokens_source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * 새 요청 생성
 */
export function createRequest(
  db: Database,
  params: CreateRequestParams
): string {
  db.query(SQL_CREATE_REQUEST).run(
    params.id,
    params.session_id,
    params.timestamp,
    params.type,
    params.tool_name ?? null,
    params.tool_detail ?? null,
    params.turn_id ?? null,
    params.model ?? null,
    params.tokens_input ?? 0,
    params.tokens_output ?? 0,
    params.tokens_total ?? 0,
    params.duration_ms ?? 0,
    params.payload ?? null,
    params.source ?? null,
    params.cache_creation_tokens ?? 0,
    params.cache_read_tokens ?? 0,
    params.preview ?? null,
    params.tool_use_id ?? null,
    params.event_type ?? null,
    params.tokens_confidence ?? 'high',
    params.tokens_source ?? 'transcript'
  );
  return params.id;
}

/**
 * 여러 요청 일괄 생성
 */
export function createRequests(
  db: Database,
  requests: CreateRequestParams[]
): string[] {
  const stmt = db.prepare(SQL_CREATE_REQUEST);
  const insert = db.transaction((items: CreateRequestParams[]) => {
    for (const item of items) {
      stmt.run(
        item.id,
        item.session_id,
        item.timestamp,
        item.type,
        item.tool_name ?? null,
        item.tool_detail ?? null,
        item.turn_id ?? null,
        item.model ?? null,
        item.tokens_input ?? 0,
        item.tokens_output ?? 0,
        item.tokens_total ?? 0,
        item.duration_ms ?? 0,
        item.payload ?? null,
        item.source ?? null,
        item.cache_creation_tokens ?? 0,
        item.cache_read_tokens ?? 0,
        item.preview ?? null,
        item.tool_use_id ?? null,
        item.event_type ?? null,
        item.tokens_confidence ?? 'high',
        item.tokens_source ?? 'transcript'
      );
    }
  });
  insert(requests);
  return requests.map(r => r.id);
}

// =============================================================================
// 조회 (Read)
// =============================================================================

/** 요청 조회 결과 */
export interface RequestQueryResult extends Request {}

/** 요청 필터 옵션 */
export interface RequestFilterOptions {
  session_id?: string;
  type?: RequestType;
  timestamp_after?: number;
  timestamp_before?: number;
  min_tokens?: number;
  max_tokens?: number;
  limit?: number;
  offset?: number;
}

/**
 * 요청 단건 조회 (ID 기준)
 */
export function getRequestById(
  db: Database,
  id: string
): RequestQueryResult | null {
  return db.query('SELECT * FROM requests WHERE id = ?').get(id) as RequestQueryResult | null;
}

/**
 * 모든 요청 조회 (최근순, 날짜 필터 지원)
 */
export function getAllRequests(
  db: Database,
  limit: number = 100,
  fromTs?: number,
  toTs?: number
): RequestQueryResult[] {
  const conditions: string[] = ["(event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent')"];
  const params: (string | number)[] = [];
  if (fromTs) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs)   { conditions.push('timestamp <= ?'); params.push(toTs); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  return db.query(`SELECT * FROM requests ${where} ORDER BY timestamp DESC LIMIT ?`)
    .all(...params, limit) as RequestQueryResult[];
}

/**
 * 세션별 요청 조회
 */
export function getRequestsBySession(
  db: Database,
  sessionId: string,
  limit: number = 100
): RequestQueryResult[] {
  return db.query(
    "SELECT * FROM requests WHERE session_id = ? AND (event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent') ORDER BY timestamp DESC LIMIT ?"
  ).all(sessionId, limit) as RequestQueryResult[];
}

/**
 * 타입별 요청 조회
 */
export function getRequestsByType(
  db: Database,
  type: RequestType,
  limit: number = 100,
  offset: number = 0,
  fromTs?: number,
  toTs?: number
): RequestQueryResult[] {
  const conditions = ["type = ?", "(event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent')"];
  const params: (string | number)[] = [type];
  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }
  params.push(limit, offset);
  return db.query(
    `SELECT * FROM requests WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ).all(...params) as RequestQueryResult[];
}

/**
 * 필터링된 요청 조회
 */
export function getRequestsWithFilter(
  db: Database,
  options: RequestFilterOptions = {}
): RequestQueryResult[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.session_id) {
    conditions.push('session_id = ?');
    params.push(options.session_id);
  }
  if (options.type) {
    conditions.push('type = ?');
    params.push(options.type);
  }
  if (options.timestamp_after) {
    conditions.push('timestamp >= ?');
    params.push(options.timestamp_after);
  }
  if (options.timestamp_before) {
    conditions.push('timestamp <= ?');
    params.push(options.timestamp_before);
  }
  if (options.min_tokens) {
    conditions.push('tokens_total >= ?');
    params.push(options.min_tokens);
  }
  if (options.max_tokens) {
    conditions.push('tokens_total <= ?');
    params.push(options.max_tokens);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = options.limit ? `LIMIT ${options.limit}` : 'LIMIT 100';
  const offsetClause = options.offset ? `OFFSET ${options.offset}` : '';

  const sql = `SELECT * FROM requests ${whereClause} ORDER BY timestamp DESC ${limitClause} ${offsetClause}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db.query(sql).all(...params as any[]) as RequestQueryResult[];
}

/**
 * 토큰 사용량 상위 요청 조회
 */
export function getTopTokenRequests(
  db: Database,
  limit: number = 10,
  sessionId?: string
): RequestQueryResult[] {
  let sql = 'SELECT * FROM requests';
  const params: string[] = [];

  if (sessionId) {
    sql += ' WHERE session_id = ?';
    params.push(sessionId);
  }

  sql += ' ORDER BY tokens_total DESC LIMIT ?';

  return db.query(sql).all(...params, limit) as RequestQueryResult[];
}

// =============================================================================
// 수정 (Update)
// =============================================================================

/** 요청 업데이트 파라미터 */
export interface UpdateRequestParams {
  duration_ms?: number;
  payload?: string;
}

/**
 * 요청 업데이트
 */
export function updateRequest(
  db: Database,
  id: string,
  params: UpdateRequestParams
): boolean {
  const fields: string[] = [];
  const values: (number | string | null)[] = [];

  if (params.duration_ms !== undefined) {
    fields.push('duration_ms = ?');
    values.push(params.duration_ms);
  }
  if (params.payload !== undefined) {
    fields.push('payload = ?');
    values.push(params.payload);
  }

  if (fields.length === 0) return false;

  values.push(id);
  const sql = `UPDATE requests SET ${fields.join(', ')} WHERE id = ?`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(sql, ...values);
  return result.changes > 0;
}

// =============================================================================
// 삭제 (Delete)
// =============================================================================

/**
 * 요청 삭제
 */
export function deleteRequest(db: Database, id: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run('DELETE FROM requests WHERE id = ?', id);
  return result.changes > 0;
}

/**
 * 세션별 요청 일괄 삭제
 */
export function deleteRequestsBySession(
  db: Database,
  sessionId: string
): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(
    'DELETE FROM requests WHERE session_id = ?',
    sessionId
  );
  return result.changes;
}

/**
 * 오래된 요청 삭제 (보관 기간 기준)
 */
export function deleteOldRequests(
  db: Database,
  beforeTimestamp: number
): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(
    'DELETE FROM requests WHERE timestamp < ?',
    beforeTimestamp
  );
  return result.changes;
}

// =============================================================================
// 집계 (Aggregate)
// =============================================================================

/** 요청 통계 결과 */
export interface RequestStats {
  total_requests: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens: number;
  avg_tokens_per_request: number;
  avg_duration_ms: number;
}

/**
 * tool_call PostToolUse 레코드 기준 평균 실행시간 (ms)
 *
 * prompt 레코드에는 duration_ms가 기록되지 않으므로 (PreToolUse→PostToolUse 쌍으로
 * tool_call에만 측정값이 있음) tool_call + event_type='tool' 레코드를 대상으로 집계.
 * duration_ms가 0보다 크고 600_000ms(10분) 미만인 레코드만 집계하여 타임스탬프
 * 오기입으로 인한 이상값을 제외한다.
 */
export function getAvgPromptDurationMs(db: Database): number {
  const row = db.query(`
    SELECT AVG(duration_ms) as avg
    FROM requests
    WHERE type = 'tool_call' AND event_type = 'tool'
      AND duration_ms > 0 AND duration_ms < 600000
  `).get() as { avg: number | null };
  return row?.avg ?? 0;
}

/**
 * 전체 요청 통계
 * 토큰 합계는 tokens_confidence='high'인 레코드만 집계
 * 요청 수는 모든 레코드 포함 (성공/실패 분리 필요 시 별도 쿼리 사용)
 */
export function getRequestStats(db: Database, fromTs?: number, toTs?: number): RequestStats {
  const conditions: string[] = ["(event_type IS NULL OR event_type = 'tool')"];
  const params: number[] = [];

  if (fromTs) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  return db.query(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0) as total_tokens_input,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_output ELSE 0 END), 0) as total_tokens_output,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) as total_tokens,
      COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) as avg_tokens_per_request,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM requests
    ${whereClause}
  `).get(...params) as RequestStats;
}

/**
 * 세션별 요청 통계
 * 토큰 합계는 tokens_confidence='high'인 레코드만 집계
 */
export function getRequestStatsBySession(
  db: Database,
  sessionId: string
): RequestStats {
  return db.query(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0) as total_tokens_input,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_output ELSE 0 END), 0) as total_tokens_output,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) as total_tokens,
      COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) as avg_tokens_per_request,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM requests
    WHERE session_id = ?
  `).get(sessionId) as RequestStats;
}

/** 타입별 통계 */
export interface TypeStats {
  type: RequestType;
  count: number;
  total_tokens: number;
  avg_tokens: number;
}

/**
 * 요청 타입별 통계
 */
export function getRequestStatsByType(db: Database, fromTs?: number, toTs?: number): TypeStats[] {
  const conditions: string[] = [];
  const params: number[] = [];

  if (fromTs) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.query(`
    SELECT
      type,
      COUNT(*) as count,
      SUM(tokens_total) as total_tokens,
      AVG(tokens_total) as avg_tokens
    FROM requests
    ${whereClause}
    GROUP BY type
    ORDER BY total_tokens DESC
  `).all(...params) as TypeStats[];
}

/**
 * 도구별 통계 (tool_call 타입만, tool_name 단위 집계)
 */
export interface ToolStats {
  tool_name: string;
  call_count: number;
  total_tokens: number;
  avg_tokens: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  error_count: number;
}

export function getToolStats(
  db: Database,
  limit: number = 20,
  fromTs?: number,
  toTs?: number
): ToolStats[] {
  const conditions: string[] = ["type = 'tool_call'", 'tool_name IS NOT NULL', "(event_type IS NULL OR event_type = 'tool')"];
  const params: (number | string)[] = [];

  if (fromTs) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('timestamp <= ?'); params.push(toTs); }

  params.push(limit.toString());

  return db.query(`
    SELECT
      tool_name,
      COUNT(*) as call_count,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) as total_tokens,
      COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) as avg_tokens,
      COALESCE(AVG(duration_ms), 0)  AS avg_duration_ms,
      COALESCE(MAX(duration_ms), 0)  AS max_duration_ms,
      SUM(CASE WHEN tool_detail LIKE '%Error%' OR tool_detail LIKE '%error%' THEN 1 ELSE 0 END) AS error_count
    FROM requests
    WHERE ${conditions.join(' AND ')}
    GROUP BY tool_name
    ORDER BY call_count DESC
    LIMIT ?
  `).all(...params) as ToolStats[];
}

/**
 * 세션 범위 도구별 성능 통계 (Feature F: Tool Performance Summary)
 */
export interface SessionToolStats extends ToolStats {
  pct_of_total_tokens: number;
}

export function getSessionToolStats(
  db: Database,
  sessionId: string
): SessionToolStats[] {
  return db.query(`
    WITH session_total AS (
      SELECT COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 1) AS total
      FROM requests
      WHERE session_id = ?
        AND (event_type IS NULL OR event_type = 'tool')
    )
    SELECT
      tool_name,
      COUNT(*) AS call_count,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) AS total_tokens,
      COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) AS avg_tokens,
      COALESCE(AVG(duration_ms), 0)  AS avg_duration_ms,
      COALESCE(MAX(duration_ms), 0)  AS max_duration_ms,
      SUM(CASE WHEN tool_detail LIKE '%Error%' OR tool_detail LIKE '%error%' THEN 1 ELSE 0 END) AS error_count,
      ROUND(COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) * 100.0 / (SELECT total FROM session_total), 1) AS pct_of_total_tokens
    FROM requests
    WHERE session_id = ?
      AND type = 'tool_call'
      AND tool_name IS NOT NULL
      AND (event_type IS NULL OR event_type = 'tool')
    GROUP BY tool_name
    ORDER BY avg_duration_ms DESC
  `).all(sessionId, sessionId) as SessionToolStats[];
}

/**
 * 시간대별 요청 통계
 */
export interface HourlyStats {
  hour: number;
  request_count: number;
  total_tokens: number;
}

export function getHourlyRequestStats(
  db: Database,
  sessionId?: string
): HourlyStats[] {
  let sql = `
    SELECT
      (timestamp / 3600000 % 24) as hour,
      COUNT(*) as request_count,
      SUM(tokens_total) as total_tokens
    FROM requests
  `;
  const params: string[] = [];

  if (sessionId) {
    sql += ' WHERE session_id = ?';
    params.push(sessionId);
  }

  sql += ' GROUP BY hour ORDER BY hour';

  return db.query(sql).all(...params) as HourlyStats[];
}

// =============================================================================
// Command Center Strip 집계
// =============================================================================


/** Command Center Strip 통계 */
export interface StripStats {
  cost_usd: number;
  cache_savings_usd: number;
  p95_duration_ms: number;
  error_rate: number;
}

/** 오늘 날짜 자정 타임스탬프 */
function getTodayMidnightMs(): number {
  return new Date().setHours(0, 0, 0, 0);
}

/** 오늘 날짜 기준 Command Center Strip 지표 집계 */
export function getTodayStripStats(db: Database): StripStats {
  const todayMs = getTodayMidnightMs();

  // 1. 오늘 prompt 레코드에서 모델별 토큰 집계 (tokens_confidence='high'만)
  const tokenRows = db.query(`
    SELECT model,
           COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0)            AS tokens_input,
           COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_output ELSE 0 END), 0)           AS tokens_output,
           COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_creation_tokens ELSE 0 END), 0)   AS cache_creation_tokens,
           COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_read_tokens ELSE 0 END), 0)       AS cache_read_tokens
    FROM requests
    WHERE type = 'prompt'
      AND timestamp >= ?
    GROUP BY model
  `).all(todayMs) as Array<{
    model: string | null;
    tokens_input: number;
    tokens_output: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  }>;

  let cost_usd = 0;
  let cache_savings_usd = 0;

  for (const row of tokenRows) {
    const p = getPricingForModel(row.model);
    cost_usd +=
      (row.tokens_input * p.input +
        row.tokens_output * p.output +
        row.cache_creation_tokens * p.cache_create +
        row.cache_read_tokens * p.cache_read) /
      1_000_000;
    cache_savings_usd +=
      (row.cache_read_tokens * (p.input - p.cache_read)) / 1_000_000;
  }

  // 2. P95 duration_ms — 오늘 tool_call PostToolUse 레코드
  const durationRows = db.query(`
    SELECT duration_ms
    FROM requests
    WHERE type = 'tool_call'
      AND event_type = 'tool'
      AND duration_ms > 0
      AND timestamp >= ?
    ORDER BY duration_ms ASC
  `).all(todayMs) as Array<{ duration_ms: number }>;

  let p95_duration_ms = 0;
  if (durationRows.length > 0) {
    const idx = Math.ceil(durationRows.length * 0.95) - 1;
    p95_duration_ms = durationRows[Math.min(idx, durationRows.length - 1)].duration_ms;
  }

  // 3. 오류율 — 오늘 tool_call PostToolUse 레코드 중 오류 패턴 포함 비율
  const errorStats = db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE
        WHEN tool_detail LIKE '%[오류]%' OR tool_detail LIKE '%error%'
        THEN 1 ELSE 0
      END) AS errors
    FROM requests
    WHERE type = 'tool_call'
      AND event_type = 'tool'
      AND timestamp >= ?
  `).get(todayMs) as { total: number; errors: number };

  const error_rate =
    errorStats.total > 0 ? errorStats.errors / errorStats.total : 0;

  return {
    cost_usd: Math.round(cost_usd * 1_000_000) / 1_000_000,
    cache_savings_usd: Math.round(cache_savings_usd * 1_000_000) / 1_000_000,
    p95_duration_ms,
    error_rate: Math.round(error_rate * 10_000) / 10_000,
  };
}

// =============================================================================
// Cache Intelligence 집계
// =============================================================================

/** 캐시 히트율·절약 금액 통계 */
export interface CacheStats {
  hitRate: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costWithCache: number;
  costWithoutCache: number;
  savingsUsd: number;
  savingsRate: number;
}

/**
 * 캐시 히트율 및 절약 비용 집계
 * - fromTs / toTs 미지정 시 전체 기간
 * - tokens_confidence='high'인 레코드만 집계
 */
export function getCacheStats(
  db: Database,
  fromTs?: number,
  toTs?: number
): CacheStats {
  const conditions: string[] = ["type = 'prompt'"];
  const params: number[] = [];

  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const tokenRows = db.query(`
    SELECT model,
           COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0)            AS tokens_input,
           COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_output ELSE 0 END), 0)           AS tokens_output,
           COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_creation_tokens ELSE 0 END), 0)   AS cache_creation_tokens,
           COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_read_tokens ELSE 0 END), 0)       AS cache_read_tokens
    FROM requests
    WHERE ${conditions.join(' AND ')}
    GROUP BY model
  `).all(...params) as Array<{
    model: string | null;
    tokens_input: number;
    tokens_output: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  }>;

  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalTokensInput = 0;
  let costWithCache = 0;
  let costWithoutCache = 0;

  for (const row of tokenRows) {
    const p = getPricingForModel(row.model);

    totalCacheRead += row.cache_read_tokens;
    totalCacheCreation += row.cache_creation_tokens;
    totalTokensInput += row.tokens_input;

    // 실제 비용 (캐시 적용)
    costWithCache +=
      (row.tokens_input * p.input +
        row.tokens_output * p.output +
        row.cache_creation_tokens * p.cache_create +
        row.cache_read_tokens * p.cache_read) /
      1_000_000;

    // 캐시 없었다면: cache_read를 일반 input 단가로 계산
    costWithoutCache +=
      ((row.tokens_input + row.cache_read_tokens) * p.input +
        row.tokens_output * p.output +
        row.cache_creation_tokens * p.cache_create) /
      1_000_000;
  }

  const totalEffectiveInput = totalTokensInput + totalCacheRead;
  const hitRate = totalEffectiveInput > 0 ? totalCacheRead / totalEffectiveInput : 0;
  const savingsUsd = costWithoutCache - costWithCache;
  const savingsRate = costWithoutCache > 0 ? savingsUsd / costWithoutCache : 0;

  return {
    hitRate: Math.round(hitRate * 10_000) / 10_000,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    costWithCache: Math.round(costWithCache * 1_000_000) / 1_000_000,
    costWithoutCache: Math.round(costWithoutCache * 1_000_000) / 1_000_000,
    savingsUsd: Math.round(savingsUsd * 1_000_000) / 1_000_000,
    savingsRate: Math.round(savingsRate * 10_000) / 10_000,
  };
}

// =============================================================================
// P95 Duration 계산
// =============================================================================

/**
 * 현재 필터 기간 기준 tool_call P95 duration_ms 계산
 * - fromTs / toTs 미지정 시 전체 기간
 */
export function getP95DurationMs(
  db: Database,
  fromTs?: number,
  toTs?: number
): number {
  const conditions: string[] = [
    "type = 'tool_call'",
    "event_type = 'tool'",
    'duration_ms > 0',
  ];
  const params: number[] = [];

  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const rows = db.query(`
    SELECT duration_ms
    FROM requests
    WHERE ${conditions.join(' AND ')}
    ORDER BY duration_ms ASC
  `).all(...params) as Array<{ duration_ms: number }>;

  if (rows.length === 0) return 0;
  const idx = Math.ceil(rows.length * 0.95) - 1;
  return rows[Math.min(idx, rows.length - 1)].duration_ms;
}

// =============================================================================
// 턴 집계 (Turn View)
// =============================================================================

/** 턴 내 tool_call 항목 */
export interface TurnToolCall {
  id: string;
  type: 'tool_call';
  timestamp: number;
  tool_name: string | null;
  tool_detail: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms: number;
  payload: string | null;
  event_type: string | null;
}

/** 턴 항목 */
export interface TurnItem {
  turn_id: string;
  turn_index: number;
  started_at: number;
  prompt: {
    id: string;
    timestamp: number;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    duration_ms: number;
    model: string | null;
    payload: string | null;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    context_tokens: number;
  } | null;
  tool_calls: TurnToolCall[];
  summary: {
    tool_call_count: number;
    tokens_input: number;
    tokens_output: number;
    total_tokens: number;
    duration_ms: number;
  };
}

/**
 * 세션별 턴 목록 조회
 * - turn_id 기준으로 prompt + tool_calls 그룹화
 * - turn_index: 세션 내 순번 (1부터)
 * 개선: SQL에서 turn/prompt/tool_call 분리 조회로 메모리 효율 개선
 */
export function getTurnsBySession(
  db: Database,
  sessionId: string
): TurnItem[] {
  // 1. 턴 단위 집계: 턴당 첫 타임스탐프, 토큰합, tool_call 수
  const turnSummaries = db.query(`
    SELECT turn_id,
           MIN(timestamp) as started_at,
           SUM(CASE WHEN type = 'prompt' THEN tokens_input ELSE 0 END) as prompt_tokens_input,
           SUM(CASE WHEN type = 'prompt' THEN tokens_output ELSE 0 END) as prompt_tokens_output,
           SUM(tokens_total) as total_tokens,
           COUNT(CASE WHEN type = 'tool_call' THEN 1 END) as tool_call_count
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL
      AND (event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent')
    GROUP BY turn_id
    ORDER BY started_at ASC
  `).all(sessionId) as Array<{
    turn_id: string;
    started_at: number;
    prompt_tokens_input: number;
    prompt_tokens_output: number;
    total_tokens: number;
    tool_call_count: number;
  }>;

  // 2. 각 턴의 prompt 행 조회
  const promptRows = db.query(`
    SELECT turn_id, id, timestamp, tokens_input, tokens_output, tokens_total, duration_ms,
           model, payload, cache_read_tokens, cache_creation_tokens
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL AND type = 'prompt'
      AND (event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent')
    ORDER BY timestamp ASC
  `).all(sessionId) as Array<{
    turn_id: string;
    id: string;
    timestamp: number;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    duration_ms: number;
    model: string | null;
    payload: string | null;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  }>;

  // 3. 각 턴의 tool_call 행 조회
  const toolRows = db.query(`
    SELECT turn_id, id, timestamp, tool_name, tool_detail,
           tokens_input, tokens_output, tokens_total, duration_ms,
           payload, event_type
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL AND type = 'tool_call'
      AND (event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent')
    ORDER BY turn_id, timestamp ASC
  `).all(sessionId) as Array<{
    turn_id: string;
    id: string;
    timestamp: number;
    tool_name: string | null;
    tool_detail: string | null;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    duration_ms: number;
    payload: string | null;
    event_type: string | null;
  }>;

  // 4. 데이터 구성
  const promptMap = new Map(promptRows.map(p => [p.turn_id, p]));
  const toolCallsByTurn = new Map<string, typeof toolRows>();
  for (const tool of toolRows) {
    if (!toolCallsByTurn.has(tool.turn_id)) {
      toolCallsByTurn.set(tool.turn_id, []);
    }
    toolCallsByTurn.get(tool.turn_id)!.push(tool);
  }

  const turns: TurnItem[] = turnSummaries.map((summary, idx) => {
    const prompt = promptMap.get(summary.turn_id);
    const toolCalls = toolCallsByTurn.get(summary.turn_id) || [];

    // prompt 캐시 정보 계산
    let promptCacheRead = 0;
    let promptCacheCreate = 0;
    if (prompt) {
      promptCacheRead = prompt.cache_read_tokens || 0;
      promptCacheCreate = prompt.cache_creation_tokens || 0;
    }

    // 턴 duration 계산
    let duration_ms = 0;
    if (toolCalls.length > 0) {
      const first = summary.started_at;
      const last = toolCalls[toolCalls.length - 1];
      duration_ms = last.timestamp + last.duration_ms - first;
    }

    // context_tokens 보완: prompt가 없거나 0이면 tool_call 최대값 사용
    let contextTokens = (prompt?.tokens_input || 0) + promptCacheRead + promptCacheCreate;
    if (contextTokens === 0 && toolCalls.length > 0) {
      contextTokens = Math.max(
        ...toolCalls.map(t => (t.tokens_input || 0) + (t.tokens_output || 0))
      );
    }

    return {
      turn_id: summary.turn_id,
      turn_index: idx + 1,
      started_at: summary.started_at,
      prompt: prompt ? {
        id: prompt.id,
        timestamp: prompt.timestamp,
        tokens_input: prompt.tokens_input,
        tokens_output: prompt.tokens_output,
        tokens_total: prompt.tokens_total,
        duration_ms: prompt.duration_ms,
        model: prompt.model,
        payload: prompt.payload,
        cache_read_tokens: promptCacheRead,
        cache_creation_tokens: promptCacheCreate,
        context_tokens: contextTokens,
      } : null,
      tool_calls: toolCalls.map(t => ({
        id: t.id,
        type: 'tool_call' as const,
        timestamp: t.timestamp,
        tool_name: t.tool_name,
        tool_detail: t.tool_detail,
        tokens_input: t.tokens_input,
        tokens_output: t.tokens_output,
        tokens_total: t.tokens_total,
        duration_ms: t.duration_ms,
        payload: t.payload,
        event_type: t.event_type,
      })),
      summary: {
        tool_call_count: summary.tool_call_count,
        tokens_input: summary.prompt_tokens_input,
        tokens_output: summary.prompt_tokens_output,
        total_tokens: summary.total_tokens,
        duration_ms,
      },
    };
  });

  return turns.reverse();
}
