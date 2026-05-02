/**
 * hook 모듈 — hook raw 페이로드의 감사(audit) 메타 추출 (v20)
 *
 * 책임:
 *  - 실제 페이로드 분석으로 발견된, DB에 저장 가치 있는 메타 5개를 raw에서 일괄 추출.
 *  - 추출된 메타는 NormalizedHookPayload에 spread되어 saveRequest → requests 테이블 컬럼으로 저장.
 *
 * 추출 필드:
 *  - permission_mode    : raw.permission_mode (bypassPermissions / plan / acceptEdits / dontAsk / default)
 *  - agent_id           : raw.agent_id (서브에이전트 내부 hook 식별)
 *  - agent_type         : raw.agent_type (Explore / general-purpose 등)
 *  - tool_interrupted   : raw.tool_response.interrupted → 0|1 (PostToolUse 전용)
 *  - tool_user_modified : raw.tool_response.userModified → 0|1 (Edit 후 사용자 수정 추적, PostToolUse 전용)
 *
 * 외부 노출: extractHookAuditMeta(raw)
 * 호출자: raw-handler.ts (PreToolUse / PostToolUse / UserPromptSubmit 3곳에서 spread)
 *
 * 의존성: 없음 (순수 함수, types만 의존)
 */

import type { ClaudeHookPayload } from './types';

/**
 * hook raw에서 감사 메타 추출.
 *
 * 모든 필드는 옵셔널이며 부재 시 null 반환 (DB는 컬럼 NULL).
 * tool_response 필드는 PostToolUse에서만 채워지므로 다른 이벤트에선 자동으로 null.
 */
export function extractHookAuditMeta(raw: ClaudeHookPayload): {
  permission_mode: string | null;
  agent_id: string | null;
  agent_type: string | null;
  tool_interrupted: number | null;
  tool_user_modified: number | null;
} {
  const tr = raw.tool_response as { interrupted?: boolean; userModified?: boolean } | undefined;
  return {
    permission_mode: typeof raw.permission_mode === 'string' ? raw.permission_mode : null,
    agent_id: typeof raw.agent_id === 'string' ? raw.agent_id : null,
    agent_type: typeof raw.agent_type === 'string' ? raw.agent_type : null,
    tool_interrupted: typeof tr?.interrupted === 'boolean' ? (tr.interrupted ? 1 : 0) : null,
    tool_user_modified: typeof tr?.userModified === 'boolean' ? (tr.userModified ? 1 : 0) : null,
  };
}
