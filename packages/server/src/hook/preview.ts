/**
 * hook 모듈 — payload preview / tool_use_id 추출
 *
 * 책임:
 *  - prompt 행의 사용자 입력 텍스트를 추출 (requests.preview 컬럼)
 *  - hook payload JSON에서 tool_use_id 추출 (Pre/Post Upsert 매칭 키)
 *
 * 외부 노출: extractPreview, extractToolUseId
 * 호출자: persist.ts (saveRequest 내부에서)
 * 의존성: types만
 */

import type { NormalizedHookPayload } from './types';

/**
 * prompt 타입 요청의 사용자 입력 텍스트를 최대 2000자로 추출.
 *
 * - 비-prompt 타입은 null 반환
 * - hook payload JSON의 raw.prompt 필드 사용
 * - 원본 보존을 위해 저장 시 2000자까지 (UI 렌더링 시 별도 truncate)
 */
export function extractPreview(payload: NormalizedHookPayload): string | null {
  if (payload.request_type !== 'prompt') return null;
  if (!payload.payload) return null;
  try {
    const raw = JSON.parse(payload.payload) as Record<string, unknown>;
    const text = typeof raw.prompt === 'string' ? raw.prompt : null;
    if (text) return text.slice(0, 2000);
  } catch {
    // JSON 파싱 실패 시 무시
  }
  return null;
}

/**
 * payload JSON에서 tool_use_id 추출.
 *
 * 용도: Pre/Post Upsert 매칭 — Claude Code가 PreToolUse와 PostToolUse에 동일 tool_use_id를 부여하므로
 *       이 키로 pre_tool 행을 찾아 UPDATE.
 */
export function extractToolUseId(payloadStr?: string): string | null {
  if (!payloadStr) return null;
  try {
    const raw = JSON.parse(payloadStr) as Record<string, unknown>;
    return typeof raw.tool_use_id === 'string' ? raw.tool_use_id : null;
  } catch {
    return null;
  }
}
