/**
 * Collector API - /collect 엔드포인트
 *
 * @description 훅에서 전송된 데이터를 수신하여 SQLite에 저장
 */

import type { Database } from 'bun:sqlite';
import {
  createSession,
  getSessionById,
  updateSessionTokens,
  createRequest,
  SpyglassDatabase,
  getDatabase,
} from '@spyglass/storage';

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
  model?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms?: number;
  payload?: string;
  source: string;
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
 */
function ensureSession(db: Database, payload: CollectPayload): boolean {
  const { session_id, project_name, timestamp } = payload;

  // 이미 활성 세션인지 확인
  if (activeSessions.has(session_id)) {
    return true;
  }

  // DB에서 세션 확인
  const existing = getSessionById(db, session_id);
  if (existing) {
    activeSessions.add(session_id);
    return true;
  }

  // 새 세션 생성
  try {
    createSession(db, {
      id: session_id,
      project_name,
      started_at: timestamp,
      total_tokens: 0,
    });
    activeSessions.add(session_id);
    return true;
  } catch (error) {
    console.error('[Collect] Failed to create session:', error);
    return false;
  }
}

/**
 * 세션 토큰 업데이트
 */
function updateSessionTotalTokens(db: Database, payload: CollectPayload): void {
  const { session_id, tokens_total } = payload;

  // 현재 세션 정보 조회
  const session = getSessionById(db, session_id);
  if (!session) return;

  // 토큰 누적
  const newTotal = (session.total_tokens || 0) + tokens_total;
  updateSessionTokens(db, session_id, newTotal);
}

// =============================================================================
// 요청 저장
// =============================================================================

/**
 * 요청 데이터 저장
 */
function saveRequest(db: Database, payload: CollectPayload): boolean {
  try {
    createRequest(db, {
      id: payload.id,
      session_id: payload.session_id,
      timestamp: payload.timestamp,
      type: payload.request_type,
      tool_name: payload.tool_name,
      model: payload.model,
      tokens_input: payload.tokens_input,
      tokens_output: payload.tokens_output,
      tokens_total: payload.tokens_total,
      duration_ms: payload.duration_ms || 0,
      payload: payload.payload,
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
