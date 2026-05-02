/**
 * hook 모듈 — hook_event_name 분류
 *
 * 책임:
 *  - Claude Code의 hook event 이름을 DB의 requests.type 분류로 매핑.
 *
 * 매핑:
 *  - UserPromptSubmit     → 'prompt'
 *  - PreToolUse|PostToolUse → 'tool_call'
 *  - 그 외(SessionStart/End/Stop/Notification 등) → 'system'
 *
 * 외부 노출: classifyRequestType(hookEventName)
 * 호출자: 현재 외부 직접 호출 없음. 추후 generic 분류가 필요할 때 사용.
 *        (raw-handler.ts는 이벤트별 분기에서 명시적으로 'prompt'/'tool_call'/'system' 지정 중)
 */

/**
 * hook_event_name → request_type 분류.
 * bash의 classify_request_type() 대체.
 */
export function classifyRequestType(
  hookEventName: string,
): 'prompt' | 'tool_call' | 'system' {
  switch (hookEventName) {
    case 'UserPromptSubmit':
      return 'prompt';
    case 'PreToolUse':
    case 'PostToolUse':
      return 'tool_call';
    default:
      return 'system';
  }
}
