/**
 * Request 조회 (Read) — SELECT 전용 함수 모음.
 *
 * @description
 *   srp-redesign Phase 1A: storage/queries/request.ts(1165줄)를 변경 이유별로 분해한 결과.
 *   이 파일의 변경 이유: "조회 정책 (필터·정렬·페이지네이션) 변경".
 *
 *   같은 모듈로 응집해야 할 동기:
 *   - ACTIVE_REQUEST_FILTER_SQL이 모든 read 함수에서 일관 적용되어야 함
 *   - getRequestsByType / getRequestsWithFilter / getRequestsBySession은 동일 필터 정책 공유
 *
 * 외부 시그니처(`@spyglass/storage` barrel)는 그대로 유지 — 이 파일을 통해 re-export.
 */

import type { Database } from 'bun:sqlite';
import type { Request, RequestType } from '../../schema';
import { decodeText } from '../../payload-codec';
import { getActiveKey } from '../../runtime/encryption';
import { queryPartitioned, getArchiveDir, loadArchiveRows, FileArchiveStore } from '../../archive';

/**
 * R3: requests.payload를 payload_algo 분기로, preview를 preview_algo 분기로 서버측 복호(평문/암호문 혼재).
 * payload는 클라이언트(web/tui)가 JSON.parse하고 preview는 UI 미리보기로 직렬화되므로, 모든 read
 * 출구에서 평문 string으로 복원해야 한다. payload와 preview는 독립 algo 마커를 가진다(ⓝ1, Migration 057).
 */
type DecodableRequestRow = {
  payload?: string | null;
  payload_algo?: string | null;
  preview?: string | null;
  preview_algo?: string | null;
};
function decodeRequestRow<T extends DecodableRequestRow>(row: T | null): T | null {
  if (row) {
    const key = getActiveKey();
    if (row.payload != null) row.payload = decodeText(row.payload, row.payload_algo, key) ?? row.payload;
    if (row.preview != null) row.preview = decodeText(row.preview, row.preview_algo, key) ?? row.preview;
  }
  return row;
}
/**
 * 모듈 내부 공유 헬퍼 — conversation.ts 등 request 하위 read 모듈이 동일 복호 정책을
 * 재구현하지 않도록 export ("동일 판단 로직은 한 곳에만"). barrel(index.ts)로는 노출하지 않음.
 */
export function decodeRequestRows<T extends DecodableRequestRow>(rows: T[]): T[] {
  const key = getActiveKey();
  for (const row of rows) {
    if (row.payload != null) row.payload = decodeText(row.payload, row.payload_algo, key) ?? row.payload;
    if (row.preview != null) row.preview = decodeText(row.preview, row.preview_algo, key) ?? row.preview;
  }
  return rows;
}

// =============================================================================
// 활성 요청 필터 (SSoT — ADR-003 log-view-unification)
// =============================================================================

/**
 * pre_tool 이벤트는 미완성 레코드(토큰 0, 응답 없음)이므로 사용자에게 노출하지 않는다.
 * 단 tool_name='Agent'는 펼침 트리거 용도로 예외 허용.
 *
 * 조회 정책의 SSoT. aggregate.ts·turn.ts가 이 상수를 import해서 동일 정책을 적용한다.
 * "조회 가시성 정책" 변경 = 이 파일만 수정.
 */
export const ACTIVE_REQUEST_FILTER_SQL =
  "(event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent')";

/**
 * ACTIVE_REQUEST_FILTER_SQL의 JS 미러 — Archive 병합 시 파일에서 로드한 행에 같은 가시성 정책을
 * 적용한다(SQL은 Hot, JS는 Archive). 두 표현을 같은 파일에 나란히 둬 정책 변경을 한 곳에서 관리.
 */
export function isActiveRequest(row: { event_type?: string | null; tool_name?: string | null }): boolean {
  return row.event_type == null || row.event_type !== 'pre_tool' || row.tool_name === 'Agent';
}

/**
 * Archive된 requests 행 로드(range 내 archive_index → 파일). __payload/__payload_algo(off-row body
 * 인라인 마커) 제거 + isActiveRequest 필터 적용 → Hot raw 행과 동일 형태(decode 전). 병합 후
 * decodeRequestRows가 일괄 복호한다.
 */
function loadRequestArchiveRows(
  db: Database,
  indexRows: { archive_file: string; row_id: string }[],
): RequestQueryResult[] {
  const store = new FileArchiveStore(getArchiveDir(db));
  const rows = loadArchiveRows(store, indexRows as never, 'id');
  const out: RequestQueryResult[] = [];
  for (const row of rows) {
    delete (row as Record<string, unknown>).__payload;
    delete (row as Record<string, unknown>).__payload_algo;
    if (isActiveRequest(row as { event_type?: string | null; tool_name?: string | null })) {
      out.push(row as unknown as RequestQueryResult);
    }
  }
  return out;
}

// =============================================================================
// 타입
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

// =============================================================================
// 단건 조회
// =============================================================================

/**
 * 요청 단건 조회 (ID 기준)
 */
export function getRequestById(
  db: Database,
  id: string
): RequestQueryResult | null {
  // storage-payload-detach 단계 C(Migration 063): payload 는 request_payloads off-row 테이블에 있다.
  //   단건 상세는 payload 가 필요하므로 LEFT JOIN 으로 회수(p.payload/payload_algo). requests 본체엔
  //   payload 컬럼이 없으므로(DROP) r.* 와 충돌하지 않는다. decodeRequestRow 가 row.payload 를 복호.
  return decodeRequestRow(db.query(
    `SELECT r.*, p.payload, p.payload_algo
       FROM requests r
       LEFT JOIN request_payloads p ON p.request_id = r.id
      WHERE r.id = ?`
  ).get(id) as RequestQueryResult | null);
}

// =============================================================================
// 다건 조회 (활성 필터 적용)
// =============================================================================

/**
 * 모든 요청 조회 (최근순, 날짜 필터 지원)
 */
export function getAllRequests(
  db: Database,
  limit: number = 100,
  fromTs?: number,
  toTs?: number
): RequestQueryResult[] {
  const conditions: string[] = [ACTIVE_REQUEST_FILTER_SQL];
  const params: (string | number)[] = [];
  if (fromTs) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs)   { conditions.push('timestamp <= ?'); params.push(toTs); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  // Hot(raw) + Archive(raw) 병합 후 일괄 decode. archive_index 비면 Hot-only(무변경).
  const merged = queryPartitioned<RequestQueryResult>(db, {
    srcTable: 'requests',
    fromTs: fromTs ?? null,
    boundaryTs: toTs ?? null,
    limit,
    order: 'DESC',
    hotQuery: () =>
      db.query(`SELECT * FROM requests ${where} ORDER BY timestamp DESC LIMIT ?`)
        .all(...params, limit) as RequestQueryResult[],
    loadArchive: (idx) => loadRequestArchiveRows(db, idx),
    tsOf: (r) => r.timestamp,
  });
  return decodeRequestRows(merged);
}

/**
 * 세션별 요청 조회
 */
export function getRequestsBySession(
  db: Database,
  sessionId: string,
  limit: number = 100
): RequestQueryResult[] {
  // 세션 상세 로그는 payload 가 필요(상세 펼침) → request_payloads LEFT JOIN(단계 C, Migration 063).
  return decodeRequestRows(db.query(
    `SELECT r.*, p.payload, p.payload_algo
       FROM requests r
       LEFT JOIN request_payloads p ON p.request_id = r.id
      WHERE r.session_id = ? AND ${ACTIVE_REQUEST_FILTER_SQL}
      ORDER BY r.timestamp DESC LIMIT ?`
  ).all(sessionId, limit) as RequestQueryResult[]);
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
  const conditions = ["type = ?", ACTIVE_REQUEST_FILTER_SQL];
  const params: (string | number)[] = [type];
  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }
  params.push(limit, offset);
  return decodeRequestRows(db.query(
    `SELECT * FROM requests WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ).all(...params) as RequestQueryResult[]);
}

/**
 * 필터링된 요청 조회 (옵션 빌더)
 *
 * 주의: 이 함수는 활성 필터(ACTIVE_REQUEST_FILTER_SQL)를 적용하지 않는다.
 *      옵션 기반 자유 필터링 용도. pre_tool 행도 결과에 포함될 수 있음.
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
  return decodeRequestRows(db.query(sql).all(...params as any[]) as RequestQueryResult[]);
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

  return decodeRequestRows(db.query(sql).all(...params, limit) as RequestQueryResult[]);
}

// =============================================================================
// 부모-자식 도구 호출 조회 (Agent sub-transcript)
// =============================================================================

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
  // Agent sub-transcript 펼침은 payload 가 필요 → request_payloads LEFT JOIN(단계 C).
  return decodeRequestRows(db.query(
    `SELECT r.*, p.payload, p.payload_algo
       FROM requests r
       LEFT JOIN request_payloads p ON p.request_id = r.id
      WHERE r.parent_tool_use_id = ?
      ORDER BY r.timestamp ASC`
  ).all(parentToolUseId) as RequestQueryResult[]);
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
  // 배치 sub-transcript 회수도 payload 필요 → request_payloads LEFT JOIN(단계 C).
  const rows = decodeRequestRows(db.query(
    `SELECT r.*, p.payload, p.payload_algo
       FROM requests r
       LEFT JOIN request_payloads p ON p.request_id = r.id
      WHERE r.parent_tool_use_id IN (${placeholders})
      ORDER BY r.timestamp ASC`
  ).all(...parentToolUseIds) as RequestQueryResult[]);

  const grouped: Record<string, RequestQueryResult[]> = {};
  for (const row of rows) {
    const key = row.parent_tool_use_id ?? '';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }
  return grouped;
}
