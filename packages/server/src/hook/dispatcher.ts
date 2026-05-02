/**
 * hook 모듈 — Strategy Registry + Dispatch
 *
 * 책임:
 *  - 모든 HookEventHandler 구현체를 hook_event_name으로 매핑.
 *  - dispatchHookEvent(raw, ctx) 호출 시 적절한 핸들러를 찾아 위임.
 *  - 등록되지 않은 이벤트는 fallback SystemEventHandler가 처리.
 *
 * 자바 비유:
 *   @Component class HookDispatcher {
 *     private final Map<String, HookEventHandler> registry;
 *     public HookProcessResult dispatch(payload, ctx) {
 *       return registry.getOrDefault(payload.eventName, fallback).handle(payload, ctx);
 *     }
 *   }
 *
 * 새 hook event 추가 절차 (OCP):
 *  1. handlers/<new-event>.handler.ts에 클래스 추가
 *  2. 아래 HANDLERS 배열에 인스턴스 1줄 추가
 *  3. 끝 — dispatcher.ts 외 다른 파일은 수정 불필요
 *
 * 외부 노출:
 *  - dispatchHookEvent(raw, ctx) : 라우팅 진입점 (http-entry가 호출)
 *
 * 호출자: http-entry.ts
 * 의존성: event-handler, handlers/*, types
 */

import type { ClaudeHookPayload, HookProcessResult } from './types';
import type { HookEventHandler, HookContext } from './event-handler';
import { PreToolUseHandler } from './handlers/pre-tool-use.handler';
import { PostToolUseHandler } from './handlers/post-tool-use.handler';
import { UserPromptSubmitHandler } from './handlers/user-prompt-submit.handler';
import { SystemEventHandler } from './handlers/system-event.handler';

/**
 * 등록된 모든 핸들러 목록.
 *
 * 새 핸들러를 추가하려면 이 배열에 인스턴스를 1줄 추가하면 됨.
 * SystemEventHandler는 fallback이므로 별도 변수로 분리 (eventType='').
 */
const HANDLERS: HookEventHandler[] = [
  new PreToolUseHandler(),
  new PostToolUseHandler(),
  new UserPromptSubmitHandler(),
];

const REGISTRY: Map<string, HookEventHandler> = new Map(
  HANDLERS.map((h) => [h.eventType, h] as const),
);

const FALLBACK: HookEventHandler = new SystemEventHandler();

/**
 * 이벤트 이름으로 적절한 핸들러를 찾아 위임.
 *
 * 매칭 실패 시 FALLBACK(SystemEventHandler)이 'system' request_type으로 보존.
 */
export function dispatchHookEvent(
  raw: ClaudeHookPayload,
  ctx: HookContext,
): HookProcessResult {
  const handler = REGISTRY.get(raw.hook_event_name) ?? FALLBACK;
  return handler.handle(raw, ctx);
}

/**
 * 디버깅·테스트용 — 현재 등록된 이벤트 타입 목록 반환.
 */
export function listRegisteredEventTypes(): string[] {
  return [...REGISTRY.keys()];
}
