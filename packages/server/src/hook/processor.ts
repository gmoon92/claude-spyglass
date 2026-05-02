/**
 * hook 모듈 — 정제된 페이로드 처리기 (DB 저장 + SSE 브로드캐스트)
 *
 * 책임:
 *  - NormalizedHookPayload(핸들러가 정제 완료)를 받아 세션 보장 → 저장 → 토큰 누적 → SSE 브로드캐스트.
 *  - raw 페이로드 정제는 handlers/* (Strategy)가 수행한 뒤 이 함수에 위임.
 *
 * 외부 노출: processHookEvent(db, payload)
 *
 * 데이터 흐름:
 *  http-entry.ts (HTTP 진입)
 *      → dispatcher.ts (이벤트별 라우팅)
 *          → handlers/*.handler.ts (raw → NormalizedHookPayload)
 *              → processHookEvent (이 파일)
 *                  → ensureSession (session.ts)
 *                  → saveRequest (persist.ts) — Upsert 분기
 *                  → updateSessionTotalTokens (session.ts) — 조건부
 *                  → broadcastNewRequest (../sse) — pre_tool 제외
 *
 * SSE 브로드캐스트 정책:
 *  - pre_tool은 미완성 레코드(토큰 0, 응답 없음) → 브로드캐스트 X
 *  - PostToolUse가 Upsert로 완성하거나 별도 INSERT로 완성됨 → 그때 브로드캐스트
 *  - 브로드캐스트의 id는 DB의 실제 id(savedId, pre-xxx) — fetchRequests와 id 일치 보장
 *
 * 의존성:
 *  - @spyglass/storage: getSessionById
 *  - ../sse: broadcastNewRequest
 *  - 동일 모듈 내부: session.ts, persist.ts, types.ts
 */

import type { Database } from 'bun:sqlite';
import { getSessionById } from '@spyglass/storage';
import { broadcastNewRequest } from '../sse';
import type { NormalizedHookPayload, HookProcessResult } from './types';
import { ensureSession, updateSessionTotalTokens } from './session';
import { saveRequest } from './persist';

/**
 * 정제된 hook 페이로드를 DB에 저장하고 SSE를 브로드캐스트.
 *
 * 호출자: handlers/*.handler.ts (Strategy 구현체들), legacy collectHandler.
 *
 * @returns HookProcessResult — success/saved 여부 + request_id + session_id
 */
export function processHookEvent(
  db: Database,
  payload: NormalizedHookPayload,
): HookProcessResult {
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

  // 세션 보장 (INSERT OR IGNORE)
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

  // 요청 저장 (Upsert 분기 포함)
  const { saved, wasUpsert, savedId } = saveRequest(db, payload);

  if (saved) {
    // 세션 토큰 누적 정책:
    //  - Upsert(pre_tool → tool 병합): pre_tool은 tokens_total=0이므로 단순히 post 토큰 누적
    //  - 일반 INSERT 중 pre_tool 외: 정상 누적
    //  - pre_tool 자체 INSERT: 토큰 0이라 누적 스킵
    if (wasUpsert) {
      updateSessionTotalTokens(db, payload);
    } else if (payload.event_type !== 'pre_tool') {
      updateSessionTotalTokens(db, payload);
    }

    // SSE 브로드캐스트 — pre_tool은 제외 (미완성 레코드라 UI 중복 노출 방지)
    if (payload.event_type !== 'pre_tool') {
      const updatedSession = getSessionById(db, payload.session_id);
      broadcastNewRequest({
        // savedId(pre-xxx)가 있으면 그걸 사용 → fetchRequests에서 가져오는 id와 일치
        id: savedId ?? payload.id,
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
  }

  return {
    success: saved,
    request_id: payload.id,
    session_id: payload.session_id,
    saved,
  };
}
