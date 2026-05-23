/**
 * hook → events_v3 dual-write 어댑터 (storage-redesign-v3 Phase 4).
 *
 * 책임:
 *  - NormalizedHookPayload 한 건을 받아 events_v3 + outbox_pending 에 INSERT.
 *  - **legacy 경로의 부수효과**: 본 모듈 실패가 legacy saveRequest / SSE 를 막지 않는다 (R5 격리).
 *
 * 정책:
 *  - event_id = payload.id (handler 가 prefix 별로 unique 생성 — pre-/tool-/prompt-/sys-).
 *  - pre_tool 과 post_tool 은 events_v3 에서 별 row (R1 append-only).
 *  - SPYGLASS_DISABLE_V3_WRITE=1 환경변수로 강제 비활성 (운영 안전망).
 *
 * 향후 (보류):
 *  - legacy saveRequest 호출 자체를 본 모듈로 대체하는 cutover. 사용자 확인 필요.
 *  - outbox drain worker (Phase 5) 가 본 outbox 를 처리.
 *
 * @see .claude/docs/plans/storage-redesign-v3/redesign-plan.md Phase 4
 */

import type { Database } from 'bun:sqlite';
import {
  appendEventV3,
  enqueueOutboxEvent,
  type EventKind,
} from '@spyglass/storage';
import type { NormalizedHookPayload } from './types';

/**
 * NormalizedHookPayload 의 event_type → events_v3.event_kind 매핑.
 *
 * legacy 표기 (느슨)            → v3 표기 (구체적, kind 단일 SSoT)
 *  'pre_tool'                  → 'hook_pre_tool'
 *  'tool'                      → 'hook_post_tool'
 *  'prompt' (request_type)      → 'hook_prompt'
 *  'response'                  → 'hook_response'
 *  그 외                        → 'hook_system'
 */
function resolveEventKind(payload: NormalizedHookPayload): EventKind {
  if (payload.event_type === 'pre_tool') return 'hook_pre_tool';
  if (payload.event_type === 'tool' && payload.request_type === 'tool_call') return 'hook_post_tool';
  if (payload.request_type === 'prompt') return 'hook_prompt';
  if (payload.event_type === 'response') return 'hook_response';
  return 'hook_system';
}

/**
 * NormalizedHookPayload → events_v3 row + outbox enqueue.
 *
 * **모든 예외를 흡수한다** — 본 함수가 throw 하면 legacy 경로가 깨질 수 있어, 항상
 * try-catch 안에서 호출하고 결과만 boolean 으로 반환한다 (R5 격리).
 *
 * @returns 성공이면 true (또는 idempotent 무시), 실패면 false (콘솔 경고).
 */
export function dualWriteToV3(
  db: Database,
  payload: NormalizedHookPayload,
  toolUseId: string | null = null,
  parentToolUseId: string | null = null,
  turnId: string | null = null,
): boolean {
  // 운영 안전망 — 환경변수로 즉시 비활성 가능
  if (process.env.SPYGLASS_DISABLE_V3_WRITE === '1') return true;

  try {
    const eventKind = resolveEventKind(payload);

    // events_v3 append — INSERT OR IGNORE 이라 같은 event_id 재호출 silent skip
    appendEventV3(db, {
      event_id: payload.id,
      session_id: payload.session_id,
      turn_id: turnId,
      timestamp: payload.timestamp,
      event_kind: eventKind,
      tool_use_id: toolUseId,
      parent_tool_use_id: parentToolUseId,
      agent_id: payload.agent_id ?? null,
      agent_type: payload.agent_type ?? null,
      tool_name: payload.tool_name ?? null,
      model: payload.model ?? null,
      payload_json: payload.payload ?? '{}',
      source: payload.source ?? 'hook',
    });

    // outbox enqueue — Phase 5 worker 가 drain
    enqueueOutboxEvent(db, payload.id, Date.now());
    return true;
  } catch (err) {
    // R5 격리: v3 실패가 legacy 응답을 막아서는 안 된다.
    console.warn(
      `[v3-dual-write] failed for event_id=${payload.id}: ${(err as Error)?.message ?? err}`,
    );
    return false;
  }
}
