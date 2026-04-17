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
}

/** 요청 생성 SQL */
const SQL_CREATE_REQUEST = `
  INSERT INTO requests (
    id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
    tokens_input, tokens_output, tokens_total, duration_ms, payload, source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * 새 요청 생성
 */
export function createRequest(
  db: Database,
  params: CreateRequestParams
): string {
  const stmt = db.prepare(SQL_CREATE_REQUEST);
  stmt.run(
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
    params.source ?? null
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
        item.source ?? null
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
 * 모든 요청 조회 (최근순)
 */
export function getAllRequests(
  db: Database,
  limit: number = 100,
  offset: number = 0
): RequestQueryResult[] {
  return db.query('SELECT * FROM requests ORDER BY timestamp DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as RequestQueryResult[];
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
    'SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(sessionId, limit) as RequestQueryResult[];
}

/**
 * 타입별 요청 조회
 */
export function getRequestsByType(
  db: Database,
  type: RequestType,
  limit: number = 100,
  offset: number = 0
): RequestQueryResult[] {
  return db.query(
    'SELECT * FROM requests WHERE type = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  ).all(type, limit, offset) as RequestQueryResult[];
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
 * prompt 타입의 평균 응답시간 (ms), duration_ms > 0 레코드만 집계
 */
export function getAvgPromptDurationMs(db: Database): number {
  const row = db.query(`
    SELECT AVG(duration_ms) as avg
    FROM requests
    WHERE type = 'prompt' AND duration_ms > 0
  `).get() as { avg: number | null };
  return row?.avg ?? 0;
}

/**
 * 전체 요청 통계
 */
export function getRequestStats(db: Database): RequestStats {
  return db.query(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(tokens_input), 0) as total_tokens_input,
      COALESCE(SUM(tokens_output), 0) as total_tokens_output,
      COALESCE(SUM(tokens_total), 0) as total_tokens,
      COALESCE(AVG(tokens_total), 0) as avg_tokens_per_request,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM requests
  `).get() as RequestStats;
}

/**
 * 세션별 요청 통계
 */
export function getRequestStatsBySession(
  db: Database,
  sessionId: string
): RequestStats {
  return db.query(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(tokens_input), 0) as total_tokens_input,
      COALESCE(SUM(tokens_output), 0) as total_tokens_output,
      COALESCE(SUM(tokens_total), 0) as total_tokens,
      COALESCE(AVG(tokens_total), 0) as avg_tokens_per_request,
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
export function getRequestStatsByType(db: Database): TypeStats[] {
  return db.query(`
    SELECT
      type,
      COUNT(*) as count,
      SUM(tokens_total) as total_tokens,
      AVG(tokens_total) as avg_tokens
    FROM requests
    GROUP BY type
    ORDER BY total_tokens DESC
  `).all() as TypeStats[];
}

/**
 * 도구별 통계 (tool_call 타입만, tool_detail 포함)
 */
export interface ToolStats {
  tool_name: string;
  tool_detail: string | null;
  call_count: number;
  total_tokens: number;
  avg_tokens: number;
}

export function getToolStats(
  db: Database,
  limit: number = 20
): ToolStats[] {
  return db.query(`
    SELECT
      tool_name,
      tool_detail,
      COUNT(*) as call_count,
      COALESCE(SUM(tokens_total), 0) as total_tokens,
      COALESCE(AVG(tokens_total), 0) as avg_tokens
    FROM requests
    WHERE type = 'tool_call' AND tool_name IS NOT NULL
    GROUP BY tool_name, tool_detail
    ORDER BY call_count DESC
    LIMIT ?
  `).all(limit) as ToolStats[];
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
// 턴 집계 (Turn View)
// =============================================================================

/** 턴 내 tool_call 항목 */
export interface TurnToolCall {
  id: string;
  timestamp: number;
  tool_name: string | null;
  tool_detail: string | null;
  tokens_total: number;
  duration_ms: number;
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
 */
export function getTurnsBySession(
  db: Database,
  sessionId: string
): TurnItem[] {
  const rows = db.query(`
    SELECT id, type, tool_name, tool_detail, turn_id,
           timestamp, tokens_input, tokens_output, tokens_total, duration_ms, model, payload
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL
    ORDER BY timestamp ASC
  `).all(sessionId) as Array<{
    id: string;
    type: string;
    tool_name: string | null;
    tool_detail: string | null;
    turn_id: string;
    timestamp: number;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    duration_ms: number;
    model: string | null;
    payload: string | null;
  }>;

  // turn_id 기준 그룹화
  const turnMap = new Map<string, TurnItem>();
  const turnOrder: string[] = [];

  for (const row of rows) {
    if (!turnMap.has(row.turn_id)) {
      turnMap.set(row.turn_id, {
        turn_id: row.turn_id,
        turn_index: turnOrder.length + 1,
        started_at: row.timestamp,
        prompt: null,
        tool_calls: [],
        summary: { tool_call_count: 0, tokens_input: 0, tokens_output: 0, total_tokens: 0, duration_ms: 0 },
      });
      turnOrder.push(row.turn_id);
    }

    const turn = turnMap.get(row.turn_id)!;

    if (row.type === 'prompt') {
      turn.prompt = {
        id: row.id,
        timestamp: row.timestamp,
        tokens_input: row.tokens_input,
        tokens_output: row.tokens_output,
        tokens_total: row.tokens_total,
        duration_ms: row.duration_ms,
        model: row.model,
        payload: row.payload,
      };
      turn.started_at = Math.min(turn.started_at, row.timestamp);
      turn.summary.tokens_input += row.tokens_input;
      turn.summary.tokens_output += row.tokens_output;
    } else {
      turn.tool_calls.push({
        id: row.id,
        timestamp: row.timestamp,
        tool_name: row.tool_name,
        tool_detail: row.tool_detail,
        tokens_total: row.tokens_total,
        duration_ms: row.duration_ms,
      });
    }

    turn.summary.total_tokens += row.tokens_total;
  }

  // summary 최종 집계
  for (const turn of turnMap.values()) {
    turn.summary.tool_call_count = turn.tool_calls.length;
    if (turn.tool_calls.length > 0) {
      const last = turn.tool_calls[turn.tool_calls.length - 1];
      const first = turn.started_at;
      turn.summary.duration_ms = last.timestamp + last.duration_ms - first;
    }
  }

  return turnOrder.map(id => turnMap.get(id)!).reverse();
}
