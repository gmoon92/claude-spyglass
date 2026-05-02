/**
 * Request CRUD Operations
 *
 * @description Request 테이블 생성/조회/수정/삭제 및 집계 쿼리
 */

import type { Database } from 'bun:sqlite';
import type { Request, RequestType } from '../schema';

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
  parent_tool_use_id?: string | null;
  // v19: Anthropic API 응답 ID — proxy_requests와 cross-link 키
  api_request_id?: string | null;
  // v20: hook raw 페이로드 감사 메타
  permission_mode?: string | null;
  agent_id?: string | null;
  agent_type?: string | null;
  tool_interrupted?: number | null;
  tool_user_modified?: number | null;
}

/** 요청 생성 SQL */
const SQL_CREATE_REQUEST = `
  INSERT INTO requests (
    id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
    tokens_input, tokens_output, tokens_total, duration_ms, payload, source,
    cache_creation_tokens, cache_read_tokens, preview, tool_use_id, event_type,
    tokens_confidence, tokens_source, parent_tool_use_id, api_request_id,
    permission_mode, agent_id, agent_type, tool_interrupted, tool_user_modified
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    params.tokens_source ?? 'transcript',
    params.parent_tool_use_id ?? null,
    params.api_request_id ?? null,
    params.permission_mode ?? null,
    params.agent_id ?? null,
    params.agent_type ?? null,
    params.tool_interrupted ?? null,
    params.tool_user_modified ?? null
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
        item.tokens_source ?? 'transcript',
        item.parent_tool_use_id ?? null,
        item.api_request_id ?? null,
        item.permission_mode ?? null,
        item.agent_id ?? null,
        item.agent_type ?? null,
        item.tool_interrupted ?? null,
        item.tool_user_modified ?? null
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
 * 부모 Agent tool_use_id에 해당하는 자식 도구 호출 조회 (서브에이전트 transcript에서 수집된 행)
 *
 * UI에서 Agent 행을 펼칠 때 사용. 시간순 오름차순 정렬.
 *
 * @see Migration 017
 */
export function getChildRequestsByParentToolUseId(
  db: Database,
  parentToolUseId: string
): RequestQueryResult[] {
  return db.query(
    `SELECT * FROM requests
     WHERE parent_tool_use_id = ?
     ORDER BY timestamp ASC`
  ).all(parentToolUseId) as RequestQueryResult[];
}

/**
 * 여러 부모 tool_use_id에 대한 자식 호출들을 한번에 조회 (N+1 방지)
 *
 * 반환 형식: { [parentToolUseId]: RequestQueryResult[] }
 */
export function getChildRequestsByParents(
  db: Database,
  parentToolUseIds: string[]
): Record<string, RequestQueryResult[]> {
  if (parentToolUseIds.length === 0) return {};
  const placeholders = parentToolUseIds.map(() => '?').join(',');
  const rows = db.query(
    `SELECT * FROM requests
     WHERE parent_tool_use_id IN (${placeholders})
     ORDER BY timestamp ASC`
  ).all(...parentToolUseIds) as RequestQueryResult[];

  const grouped: Record<string, RequestQueryResult[]> = {};
  for (const row of rows) {
    const key = row.parent_tool_use_id ?? '';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }
  return grouped;
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
 *
 * @param fromTs 집계 시작 타임스탬프 (옵셔널, 미지정 시 전체 기간)
 * @param toTs   집계 종료 타임스탬프 (옵셔널, 미지정 시 전체 기간)
 */
export function getAvgPromptDurationMs(
  db: Database,
  fromTs?: number,
  toTs?: number
): number {
  const conditions: string[] = [
    "type = 'tool_call'",
    "event_type = 'tool'",
    'duration_ms > 0',
    'duration_ms < 600000',
  ];
  const params: number[] = [];

  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const row = db.query(`
    SELECT AVG(duration_ms) as avg
    FROM requests
    WHERE ${conditions.join(' AND ')}
  `).get(...params) as { avg: number | null };
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
 *
 * 데이터 신뢰도 표지 필드 (data-honesty-ui):
 * - confidence_low_count: tokens_confidence='low' 행 수
 * - confidence_error_count: tokens_confidence='error' 행 수
 * - error_count: tool_detail에 'Error' 포함 OR tokens_confidence='error' 행 수 (합산)
 */
export interface ToolStats {
  tool_name: string;
  call_count: number;
  total_tokens: number;
  avg_tokens: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  error_count: number;
  confidence_low_count: number;
  confidence_error_count: number;
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
      COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0)  AS avg_duration_ms,
      COALESCE(MAX(duration_ms), 0)  AS max_duration_ms,
      SUM(CASE WHEN tool_detail LIKE '%Error%' OR tool_detail LIKE '%error%' OR tokens_confidence='error' THEN 1 ELSE 0 END) AS error_count,
      SUM(CASE WHEN tokens_confidence='low'   THEN 1 ELSE 0 END) AS confidence_low_count,
      SUM(CASE WHEN tokens_confidence='error' THEN 1 ELSE 0 END) AS confidence_error_count
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
      COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0)  AS avg_duration_ms,
      COALESCE(MAX(duration_ms), 0)  AS max_duration_ms,
      SUM(CASE WHEN tool_detail LIKE '%Error%' OR tool_detail LIKE '%error%' OR tokens_confidence='error' THEN 1 ELSE 0 END) AS error_count,
      SUM(CASE WHEN tokens_confidence='low'   THEN 1 ELSE 0 END) AS confidence_low_count,
      SUM(CASE WHEN tokens_confidence='error' THEN 1 ELSE 0 END) AS confidence_error_count,
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
  p95_duration_ms: number;
  error_rate: number;
}

/**
 * Command Center Strip 지표 집계 (P95 duration / 오류율)
 *
 * 비용(cost_usd / cache_savings_usd)은 정확한 가격 플랜을 알 수 없는 추정치라 제거됨.
 * 두 쿼리(p95 duration, error rate) 모두 동일한 timestamp 범위 조건을 적용한다.
 *
 * @param fromTs 집계 시작 타임스탬프 (옵셔널)
 * @param toTs   집계 종료 타임스탬프 (옵셔널)
 */
export function getStripStats(
  db: Database,
  fromTs?: number,
  toTs?: number
): StripStats {
  const buildRangeClause = (baseConditions: string[]): { sql: string; params: number[] } => {
    const conditions = [...baseConditions];
    const params: number[] = [];
    if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
    if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }
    return { sql: conditions.join(' AND '), params };
  };

  // 1. P95 duration_ms — 지정 기간 tool_call PostToolUse 레코드
  const durationRange = buildRangeClause([
    "type = 'tool_call'",
    "event_type = 'tool'",
    'duration_ms > 0',
  ]);
  const durationRows = db.query(`
    SELECT duration_ms
    FROM requests
    WHERE ${durationRange.sql}
    ORDER BY duration_ms ASC
  `).all(...durationRange.params) as Array<{ duration_ms: number }>;

  let p95_duration_ms = 0;
  if (durationRows.length > 0) {
    const idx = Math.ceil(durationRows.length * 0.95) - 1;
    p95_duration_ms = durationRows[Math.min(idx, durationRows.length - 1)].duration_ms;
  }

  // 2. 오류율 — 지정 기간 tool_call PostToolUse 레코드 중 오류 패턴 포함 비율
  const errorRange = buildRangeClause([
    "type = 'tool_call'",
    "event_type = 'tool'",
  ]);
  const errorStats = db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE
        WHEN tool_detail LIKE '%[오류]%' OR tool_detail LIKE '%error%'
        THEN 1 ELSE 0
      END) AS errors
    FROM requests
    WHERE ${errorRange.sql}
  `).get(...errorRange.params) as { total: number; errors: number };

  const error_rate =
    errorStats.total > 0 ? errorStats.errors / errorStats.total : 0;

  return {
    p95_duration_ms,
    error_rate: Math.round(error_rate * 10_000) / 10_000,
  };
}

// =============================================================================
// Cache Intelligence 집계
// =============================================================================

/** 캐시 히트율·절감 토큰 통계 (USD 환산은 신뢰도 낮아 제거됨) */
export interface CacheStats {
  hitRate: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** 캐시로 절감된 입력 토큰 수 (cache_read_tokens 합산과 동일) */
  savingsTokens: number;
  /** 캐시 히트로 절감된 비율 (0~1) */
  savingsRate: number;
}

/**
 * 캐시 히트율 및 절감 토큰 집계
 * - fromTs / toTs 미지정 시 전체 기간
 * - tokens_confidence='high'인 레코드만 집계
 *
 * USD 비용 환산은 정확한 가격 플랜을 알 수 없어 추정치만 가능하므로 제거됨.
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

  const row = db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0)            AS tokens_input,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_creation_tokens ELSE 0 END), 0)   AS cache_creation_tokens,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_read_tokens ELSE 0 END), 0)       AS cache_read_tokens
    FROM requests
    WHERE ${conditions.join(' AND ')}
  `).get(...params) as {
    tokens_input: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  } | null;

  const totalCacheRead     = row?.cache_read_tokens ?? 0;
  const totalCacheCreation = row?.cache_creation_tokens ?? 0;
  const totalTokensInput   = row?.tokens_input ?? 0;

  const totalEffectiveInput = totalTokensInput + totalCacheRead;
  const hitRate = totalEffectiveInput > 0 ? totalCacheRead / totalEffectiveInput : 0;
  const savingsRate = totalEffectiveInput > 0 ? totalCacheRead / totalEffectiveInput : 0;

  return {
    hitRate: Math.round(hitRate * 10_000) / 10_000,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    savingsTokens: totalCacheRead,
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
  model: string | null;
  /** data-honesty-ui: 자식 도구 호출 추적 (sub-agent transcript) */
  parent_tool_use_id: string | null;
  /** data-honesty-ui: 'high'|'low'|'error' (UI에서 신뢰도 표지에 사용) */
  tokens_confidence: string | null;
}

/**
 * 턴 내 assistant 응답.
 * v22 이후 한 turn 안에 여러 건 존재 가능 (도구 호출 사이사이의 중간 텍스트 응답).
 * - source='claude-code-hook'  : Stop 훅의 last_assistant_message (턴 종료 시 1건)
 * - source='transcript-assistant-text' : transcript에서 추출한 중간 응답 (PostToolUse마다 보강)
 */
export interface TurnResponse {
  id: string;
  timestamp: number;
  preview: string | null;
  payload: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  model: string | null;
  /** data-honesty-ui: 응답 메타 신뢰도 ('high'|'low'|'error') */
  tokens_confidence: string | null;
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
    /** data-honesty-ui: prompt 메타 신뢰도 ('high'|'low'|'error') */
    tokens_confidence: string | null;
  } | null;
  /**
   * v22 (system-prompt-exposure) — 이 turn에 흐른 첫 proxy 요청의 system_hash.
   * 같은 turn에 여러 LLM 호출이 있어도 페르소나는 보통 동일하므로 첫 hash로 대표.
   * UI는 이전 turn과 비교해 system 변경 표지(▲)를 그릴 때 사용.
   */
  system_hash: string | null;
  system_byte_size: number | null;
  tool_calls: TurnToolCall[];
  /**
   * 턴 내 모든 assistant 응답 (timestamp 오름차순).
   * 빈 배열이면 tool-only turn. v22 이전엔 단수 `response`였으나 중간 응답 보존을 위해 배열로 확장.
   */
  responses: TurnResponse[];
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
           model, payload, cache_read_tokens, cache_creation_tokens, tokens_confidence
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
    tokens_confidence: string | null;
  }>;

  // 3. 각 턴의 tool_call 행 조회
  const toolRows = db.query(`
    SELECT turn_id, id, timestamp, tool_name, tool_detail,
           tokens_input, tokens_output, tokens_total, duration_ms,
           payload, event_type, model, parent_tool_use_id, tokens_confidence
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
    model: string | null;
    parent_tool_use_id: string | null;
    tokens_confidence: string | null;
  }>;

  // 3-bis. 각 턴의 assistant response 행 조회.
  // v22+: 한 턴에 여러 건 존재 가능 (도구 호출 사이사이 중간 텍스트 응답).
  // 모든 행을 timestamp 오름차순으로 수집해 호출자에게 배열로 반환.
  const responseRows = db.query(`
    SELECT turn_id, id, timestamp, preview, payload,
           tokens_input, tokens_output, tokens_total, model, tokens_confidence
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL AND type = 'response'
    ORDER BY turn_id, timestamp ASC
  `).all(sessionId) as Array<{
    turn_id: string;
    id: string;
    timestamp: number;
    preview: string | null;
    payload: string | null;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    model: string | null;
    tokens_confidence: string | null;
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
  // 같은 turn_id의 응답을 모두 보존 (timestamp 오름차순 push).
  // 단순 set→get 매핑이면 중간 응답이 마지막 1건에 덮어쓰기되어 누락된다.
  const responsesByTurn = new Map<string, typeof responseRows>();
  for (const r of responseRows) {
    const arr = responsesByTurn.get(r.turn_id);
    if (arr) arr.push(r);
    else responsesByTurn.set(r.turn_id, [r]);
  }

  // v22 (system-prompt-exposure): turn별 system_hash + system_byte_size 합류.
  // 같은 turn_id에 여러 proxy 요청이 있을 수 있어 timestamp ASC 첫 hash를 대표로 채택
  // (페르소나는 보통 turn 전체에서 동일). ROW_NUMBER OVER로 PARTITION 1행만 선택.
  const systemRows = db.query(`
    SELECT turn_id, system_hash, system_byte_size FROM (
      SELECT turn_id, system_hash, system_byte_size,
             ROW_NUMBER() OVER (PARTITION BY turn_id ORDER BY timestamp ASC) AS rn
      FROM proxy_requests
      WHERE session_id = ? AND turn_id IS NOT NULL AND system_hash IS NOT NULL
    ) WHERE rn = 1
  `).all(sessionId) as Array<{
    turn_id: string;
    system_hash: string;
    system_byte_size: number | null;
  }>;
  const systemByTurn = new Map(systemRows.map(s => [s.turn_id, s]));

  const turns: TurnItem[] = turnSummaries.map((summary, idx) => {
    const prompt = promptMap.get(summary.turn_id);
    const toolCalls = toolCallsByTurn.get(summary.turn_id) || [];
    const respRows = responsesByTurn.get(summary.turn_id) || [];
    const sysRow = systemByTurn.get(summary.turn_id) ?? null;

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

    // context_tokens: prompt 실제 입력+캐시. 0이면 0 그대로 노출 (왜곡 fallback 제거 — data-honesty-ui)
    const contextTokens = (prompt?.tokens_input || 0) + promptCacheRead + promptCacheCreate;

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
        tokens_confidence: prompt.tokens_confidence,
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
        model: t.model,
        parent_tool_use_id: t.parent_tool_use_id,
        tokens_confidence: t.tokens_confidence,
      })),
      responses: respRows.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        preview: r.preview,
        payload: r.payload,
        tokens_input: r.tokens_input,
        tokens_output: r.tokens_output,
        tokens_total: r.tokens_total,
        model: r.model,
        tokens_confidence: r.tokens_confidence,
      })),
      system_hash: sysRow?.system_hash ?? null,
      system_byte_size: sysRow?.system_byte_size ?? null,
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
