/**
 * Collector API - /collect 엔드포인트
 *
 * @description 훅에서 전송된 데이터를 수신하여 SQLite에 저장
 */

import type { Database } from 'bun:sqlite';
import {
  createSession,
  getSessionById,
  createRequest,
  SpyglassDatabase,
  getDatabase,
} from '@spyglass/storage';
import { broadcastNewRequest } from './sse';

// =============================================================================
// 타입 정의
// =============================================================================

/**
 * 훅에서 수신되는 데이터 형식
 */
export interface CollectPayload {
  id: string;
  session_id: string;
  project_name: string;
  timestamp: number;
  event_type: string;
  request_type: 'prompt' | 'tool_call' | 'system';
  tool_name?: string;
  tool_detail?: string;
  model?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms?: number;
  payload?: string;
  source: string;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
}

/**
 * 수집 결과
 */
export interface CollectResult {
  success: boolean;
  request_id: string;
  session_id: string;
  saved: boolean;
  error?: string;
}

// =============================================================================
// 세션 관리
// =============================================================================

/** 활성 세션 캐시 (메모리) */
const activeSessions = new Set<string>();

/**
 * 세션 확인 및 생성
 * INSERT OR IGNORE 사용으로 동시 요청/서버 재시작에도 FK 오류 없음
 */
function ensureSession(db: Database, payload: CollectPayload): boolean {
  const { session_id, project_name, timestamp } = payload;

  // 인메모리 캐시 히트: DB에도 실제 존재하는지 검증
  if (activeSessions.has(session_id)) {
    if (getSessionById(db, session_id)) return true;
    activeSessions.delete(session_id); // 스테일 캐시 제거
  }

  try {
    // INSERT OR IGNORE: 이미 존재하면 무시, 없으면 생성 — 항상 세션이 DB에 존재
    createSession(db, {
      id: session_id,
      project_name,
      started_at: timestamp,
      total_tokens: 0,
    });
    activeSessions.add(session_id);
    return true;
  } catch (error) {
    console.error('[Collect] Failed to ensure session:', error);
    return false;
  }
}

/**
 * 세션 토큰 업데이트
 */
function updateSessionTotalTokens(db: Database, payload: CollectPayload): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).run(
    'UPDATE sessions SET total_tokens = total_tokens + ? WHERE id = ?',
    payload.tokens_total,
    payload.session_id
  );
}

// =============================================================================
// 요청 저장
// =============================================================================

/**
 * 세션 내 다음 turn_id 채번
 * - prompt 타입 수신 시 호출
 * - 포맷: "<session_id>-T<순번>" (1부터 시작)
 */
function assignTurnId(db: Database, sessionId: string): string {
  const row = db.query(
    `SELECT COUNT(*) as cnt FROM requests WHERE session_id = ? AND type = 'prompt'`
  ).get(sessionId) as { cnt: number } | null;
  const next = (row?.cnt ?? 0) + 1;
  return `${sessionId}-T${next}`;
}

/**
 * 현재 세션의 마지막 turn_id 조회 (tool_call 저장 시 사용)
 */
function getLastTurnId(db: Database, sessionId: string): string | null {
  const row = db.query(
    `SELECT turn_id FROM requests WHERE session_id = ? AND type = 'prompt' ORDER BY timestamp DESC LIMIT 1`
  ).get(sessionId) as { turn_id: string } | null;
  return row?.turn_id ?? null;
}

/**
 * 요청 데이터 저장
 */
function saveRequest(db: Database, payload: CollectPayload): boolean {
  try {
    let turnId: string | undefined;

    if (payload.request_type === 'prompt') {
      turnId = assignTurnId(db, payload.session_id);
    } else {
      turnId = getLastTurnId(db, payload.session_id) ?? undefined;
    }

    createRequest(db, {
      id: payload.id,
      session_id: payload.session_id,
      timestamp: payload.timestamp,
      type: payload.request_type,
      tool_name: payload.tool_name,
      tool_detail: payload.tool_detail,
      turn_id: turnId,
      model: payload.model,
      tokens_input: payload.tokens_input,
      tokens_output: payload.tokens_output,
      tokens_total: payload.tokens_total,
      duration_ms: payload.duration_ms || 0,
      payload: payload.payload,
      source: payload.source || null,
      cache_creation_tokens: payload.cache_creation_tokens ?? 0,
      cache_read_tokens: payload.cache_read_tokens ?? 0,
    });
    return true;
  } catch (error) {
    console.error('[Collect] Failed to save request:', error);
    return false;
  }
}

// =============================================================================
// Collect 핸들러
// =============================================================================

/**
 * /collect 엔드포인트 핸들러
 */
export function handleCollect(
  db: Database,
  payload: CollectPayload
): CollectResult {
  // 필수 필드 검증
  if (!payload.id || !payload.session_id) {
    return {
      success: false,
      request_id: payload.id || 'unknown',
      session_id: payload.session_id || 'unknown',
      saved: false,
      error: 'Missing required fields: id, session_id',
    };
  }

  // 세션 확인/생성
  const sessionOk = ensureSession(db, payload);
  if (!sessionOk) {
    return {
      success: false,
      request_id: payload.id,
      session_id: payload.session_id,
      saved: false,
      error: 'Failed to ensure session',
    };
  }

  // 요청 저장
  const saved = saveRequest(db, payload);

  if (saved) {
    // 세션 토큰 업데이트
    updateSessionTotalTokens(db, payload);

    // 업데이트된 세션 total_tokens 조회 후 SSE 브로드캐스트
    const updatedSession = getSessionById(db, payload.session_id);
    broadcastNewRequest({
      id: payload.id,
      session_id: payload.session_id,
      type: payload.request_type,
      request_type: payload.request_type,
      tool_name: payload.tool_name ?? null,
      tool_detail: payload.tool_detail ?? null,
      tokens_input: payload.tokens_input,
      tokens_output: payload.tokens_output,
      tokens_total: payload.tokens_total,
      duration_ms: payload.duration_ms || 0,
      model: payload.model ?? null,
      timestamp: payload.timestamp,
      payload: payload.payload ?? null,
      session_total_tokens: updatedSession?.total_tokens ?? payload.tokens_total,
    });
  }

  return {
    success: saved,
    request_id: payload.id,
    session_id: payload.session_id,
    saved,
  };
}

// =============================================================================
// HTTP 핸들러
// =============================================================================

/**
 * Bun HTTP 서버용 collect 핸들러
 */
export async function collectHandler(req: Request, db: SpyglassDatabase): Promise<Response> {
  // POST만 허용
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // JSON 파싱
    const payload = (await req.json()) as CollectPayload;

    // 처리
    const result = handleCollect(db.instance, payload);

    // 응답
    const statusCode = result.success ? 200 : 400;
    return new Response(JSON.stringify(result), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[Collect] Error processing request:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Invalid JSON payload',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// =============================================================================
// CLI 테스트
// =============================================================================

/**
 * 직접 실행 테스트
 */
if (import.meta.main) {
  const db = getDatabase();

  // 테스트 데이터
  const testPayload: CollectPayload = {
    id: `test-${Date.now()}`,
    session_id: 'test-session',
    project_name: 'test-project',
    timestamp: Date.now(),
    event_type: 'prompt',
    request_type: 'prompt',
    model: 'claude-sonnet',
    tokens_input: 100,
    tokens_output: 50,
    tokens_total: 150,
    duration_ms: 1000,
    source: 'cli-test',
  };

  console.log('Testing collect handler...');
  const result = handleCollect(db.instance, testPayload);
  console.log('Result:', JSON.stringify(result, null, 2));

  if (result.success) {
    console.log('✓ Collect test passed');
  } else {
    console.error('✗ Collect test failed:', result.error);
    process.exit(1);
  }
}
