/**
 * hook 모듈 — System 이벤트 핸들러 (fallback Strategy 구현체)
 *
 * 책임:
 *  - dispatcher가 등록된 핸들러를 못 찾을 때 사용되는 기본 핸들러.
 *  - hook_event_name을 그대로 event_type으로 받아 'system' request_type으로 저장.
 *
 * 실제 호출 케이스:
 *  - 현재 spyglass에서는 SessionStart/End/Stop 등이 /events 엔드포인트로 가므로
 *    /collect 진입점에서 이 fallback이 발동될 일은 거의 없음.
 *  - 미래에 신규 hook event가 추가됐을 때 안전장치 (요청을 200으로 흡수, 알 수 없는 이벤트도 보존).
 *
 * 호출자: dispatcher.ts (등록되지 않은 event_type 라우팅)
 * 의존성: types, processor
 */

import type { ClaudeHookPayload, HookProcessResult, NormalizedHookPayload } from '../types';
import type { HookEventHandler, HookContext } from '../event-handler';
import { processHookEvent } from '../processor';
import { makeRequestId } from './_shared';

export class SystemEventHandler implements HookEventHandler {
  // 빈 문자열: dispatcher가 매칭 키가 아닌 fallback 표식으로 사용
  readonly eventType = '';

  handle(raw: ClaudeHookPayload, ctx: HookContext): HookProcessResult {
    const { db, now, projectName } = ctx;

    const payload: NormalizedHookPayload = {
      id: makeRequestId('sys', now),
      session_id: raw.session_id,
      project_name: projectName,
      timestamp: now,
      event_type: raw.hook_event_name.toLowerCase(),
      request_type: 'system',
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      payload: JSON.stringify(raw),
      source: 'claude-code-hook',
    };

    return processHookEvent(db, payload);
  }
}
