/**
 * hook 모듈 — sessions 테이블 관리
 *
 * 책임:
 *  - 세션 INSERT OR IGNORE (FK 제약 보장)
 *  - sessions.total_tokens 누적 업데이트
 *  - 인메모리 활성 세션 캐시 (DB SELECT 비용 절감)
 *
 * 외부 노출 안 함 (handler/persist에서만 사용):
 *  - ensureSession(db, payload)            : 세션 존재 보장
 *  - updateSessionTotalTokens(db, payload) : total_tokens 누적
 *
 * 호출자:
 *  - handler.ts (processHookEvent): 매 요청 시 ensureSession 호출
 *  - handler.ts (processHookEvent): saveRequest 성공 후 updateSessionTotalTokens
 *
 * 의존성:
 *  - @spyglass/storage: createSession, getSessionById
 */

import type { Database } from 'bun:sqlite';
import { createSession, getSessionById } from '@spyglass/storage';
import type { NormalizedHookPayload } from './types';

/**
 * 활성 세션 캐시 (메모리).
 * - getSessionById SELECT 비용 절감용
 * - 서버 재시작 시 비워지지만 INSERT OR IGNORE로 안전하게 재구축됨
 */
const activeSessions = new Set<string>();

/**
 * 세션 확인 및 생성 (idempotent).
 *
 * 흐름:
 *  1. 인메모리 캐시 히트 → DB 실제 존재 검증 (스테일 캐시 보호)
 *  2. INSERT OR IGNORE: 이미 있으면 무시, 없으면 생성 → 항상 DB에 세션 존재
 *  3. 성공 시 캐시에 추가
 *
 * @returns true: 세션이 DB에 존재 (생성 또는 기존)
 *          false: 생성 실패 (FK 오류 가능성, 호출 측이 요청 거부)
 */
export function ensureSession(db: Database, payload: NormalizedHookPayload): boolean {
  const { session_id, project_name, timestamp } = payload;

  // 인메모리 캐시 히트: DB에도 실제 존재하는지 검증
  if (activeSessions.has(session_id)) {
    if (getSessionById(db, session_id)) return true;
    activeSessions.delete(session_id); // 스테일 캐시 제거
  }

  try {
    // INSERT OR IGNORE: 동시 요청·서버 재시작에도 FK 오류 없음
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
 * 세션 토큰 누적 업데이트.
 *
 * 호출 시점: saveRequest 성공 + (Upsert merge OR pre_tool 아닌 일반 INSERT)
 *  - pre_tool은 토큰=0이라 카운트 제외 (PostToolUse에서 합쳐짐)
 */
export function updateSessionTotalTokens(db: Database, payload: NormalizedHookPayload): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).run(
    'UPDATE sessions SET total_tokens = total_tokens + ? WHERE id = ?',
    payload.tokens_total,
    payload.session_id,
  );
}
