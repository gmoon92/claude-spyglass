/**
 * Request 쓰기 (Create / Update / Delete) — 변경 작업 전용.
 *
 * @description
 *   srp-redesign Phase 1A: storage/queries/request.ts(1165줄)를 변경 이유별로 분해한 결과.
 *   이 파일의 변경 이유: "스키마 컬럼 추가/수정 → INSERT/UPDATE 컬럼 매핑 변경".
 *
 *   같은 모듈로 응집해야 할 동기:
 *   - SQL_CREATE_REQUEST의 컬럼 순서가 createRequest/createRequests 양쪽에서 일관되어야 함
 *   - UpdateRequestParams의 필드와 updateRequest의 매핑이 동기화되어야 함
 *   - delete 함수들도 같은 테이블 행 라이프사이클의 일부
 *
 * 외부 시그니처(`@spyglass/storage` barrel)는 그대로 유지 — 이 파일을 통해 re-export.
 */

import type { Database } from 'bun:sqlite';
import type { RequestType } from '../../schema';
import { encodeText } from '../../payload-codec';
import { getActiveKey, shouldEncrypt } from '../../runtime/encryption';

/**
 * R3: requests.payload 쓰기 인코딩. 옵트인 시 AES-256-GCM(base64-in-TEXT), OFF면 평문(algo NULL).
 * payload가 없으면 value/algo 모두 null. requests.payload는 TEXT 유지(string→BLOB 변경 없음).
 */
export function encodeRequestPayload(payload: string | null | undefined): { value: string | null; algo: string | null } {
  if (payload == null) return { value: null, algo: null };
  const { value, algo } = encodeText(payload, shouldEncrypt() ? getActiveKey() : null);
  return { value, algo: algo ?? null };
}

/**
 * R3(ⓝ1): requests.preview 쓰기 인코딩. payload와 동일 정책이나 별도 preview_algo로 추적한다 —
 * payload와 preview는 독립 인코딩되므로(updateRequest는 payload만 갱신, payload 없는 행에도
 * preview 존재) 한 컬럼 공유 시 silent corruption. preview가 없으면 value/algo 모두 null.
 */
export function encodeRequestPreview(preview: string | null | undefined): { value: string | null; algo: string | null } {
  if (preview == null) return { value: null, algo: null };
  const { value, algo } = encodeText(preview, shouldEncrypt() ? getActiveKey() : null);
  return { value, algo: algo ?? null };
}

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
  // v24: UserPromptSubmit prompt에서 추출한 슬래시 커맨드 이름 (Behavior Definitions 카탈로그 매칭 키)
  slash_command?: string | null;
}

/**
 * 요청 생성 SQL.
 * storage-payload-detach 단계 C(Migration 063): payload·payload_algo 는 requests 에서 DROP 되어
 *   request_payloads off-row 테이블이 단일 소스다. 본 INSERT 는 payload 를 더 이상 requests 에 쓰지
 *   않고(컬럼 부재), 호출부가 upsertRequestPayload 로 request_payloads 에만 기록한다(single-write).
 */
const SQL_CREATE_REQUEST = `
  INSERT INTO requests (
    id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
    tokens_input, tokens_output, tokens_total, duration_ms, source,
    cache_creation_tokens, cache_read_tokens, preview, tool_use_id, event_type,
    tokens_confidence, tokens_source, parent_tool_use_id, api_request_id,
    permission_mode, agent_id, agent_type, tool_interrupted, tool_user_modified,
    slash_command, preview_algo
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * storage-payload-detach 단계 B (Migration 061/062): request_payloads dual-write UPSERT.
 *   payload 를 off-row 테이블에도 기록한다(requests.payload 와 dual — 063 DROP 전까지 양쪽 유지,
 *   롤백 안전). payload_algo 동반 기록 — R3 codec SSoT 보존. payload 가 있는 행만 기록(컬럼 NOT NULL).
 *   이미 인코딩된 값(enc.value/enc.algo)을 그대로 받아 재인코딩하지 않는다(SSoT — 인코딩은 호출부 1회).
 */
const SQL_UPSERT_REQUEST_PAYLOAD = `
  INSERT INTO request_payloads (request_id, payload, payload_algo)
  VALUES (?, ?, ?)
  ON CONFLICT(request_id) DO UPDATE SET
    payload      = excluded.payload,
    payload_algo = excluded.payload_algo
`;

/** request_payloads dual-write — 인코딩된 payload 가 있을 때만 UPSERT. createRequest/Requests/updateRequest 공용. */
export function upsertRequestPayload(db: Database, id: string, encValue: string | null, encAlgo: string | null): void {
  if (encValue == null) return;
  db.query(SQL_UPSERT_REQUEST_PAYLOAD).run(id, encValue, encAlgo);
}

/**
 * 새 요청 생성
 */
export function createRequest(
  db: Database,
  params: CreateRequestParams
): string {
  const enc = encodeRequestPayload(params.payload);
  const encPreview = encodeRequestPreview(params.preview);
  // requests INSERT + request_payloads dual-write 를 한 트랜잭션으로 원자 적용(단계 B).
  const tx = db.transaction(() => {
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
      params.source ?? null,
      params.cache_creation_tokens ?? 0,
      params.cache_read_tokens ?? 0,
      encPreview.value,
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
      params.tool_user_modified ?? null,
      params.slash_command ?? null,
      encPreview.algo
    );
    // payload 는 requests 에서 DROP(063) → request_payloads 에만 기록(single-write).
    upsertRequestPayload(db, params.id, enc.value, enc.algo);
  });
  tx();
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
      const enc = encodeRequestPayload(item.payload);
      const encPreview = encodeRequestPreview(item.preview);
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
        item.source ?? null,
        item.cache_creation_tokens ?? 0,
        item.cache_read_tokens ?? 0,
        encPreview.value,
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
        item.tool_user_modified ?? null,
        item.slash_command ?? null,
        encPreview.algo
      );
      // payload 는 requests 에서 DROP(063) → request_payloads 에만 기록(single-write).
      upsertRequestPayload(db, item.id, enc.value, enc.algo);
    }
  });
  insert(requests);
  return requests.map(r => r.id);
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
  let payloadEnc: { value: string | null; algo: string | null } | null = null;

  if (params.duration_ms !== undefined) {
    fields.push('duration_ms = ?');
    values.push(params.duration_ms);
  }
  if (params.payload !== undefined) {
    // R3: payload 갱신 시 동일 인코딩 정책 적용 + payload_algo 동기 기록.
    // storage-payload-detach 단계 C(063): payload 는 requests 에서 DROP → UPDATE fields 에 넣지 않고
    //   request_payloads UPSERT 로만 기록(아래 tx). 인코딩은 여기 1회(SSoT).
    payloadEnc = encodeRequestPayload(params.payload);
  }

  if (fields.length === 0 && payloadEnc == null) return false;

  // requests UPDATE(duration 등) + request_payloads UPSERT(payload)를 한 트랜잭션으로 원자 적용.
  const tx = db.transaction(() => {
    let changed = false;
    if (fields.length > 0) {
      const sql = `UPDATE requests SET ${fields.join(', ')} WHERE id = ?`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (db as any).run(sql, ...values, id);
      changed = result.changes > 0;
    }
    if (payloadEnc) {
      upsertRequestPayload(db, id, payloadEnc.value, payloadEnc.algo);
      changed = true;
    }
    return changed;
  });
  return tx();
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
