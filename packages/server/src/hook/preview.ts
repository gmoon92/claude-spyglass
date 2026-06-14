/**
 * hook 모듈 — payload preview / tool_use_id 추출
 *
 * 책임:
 *  - prompt 행의 사용자 입력 텍스트를 추출 (requests.preview 컬럼)
 *  - Skill/Agent tool_call 행의 실제 지시문(args/description)을 preview 로 추출
 *  - hook payload JSON에서 tool_use_id 추출 (Pre/Post Upsert 매칭 키)
 *
 * 외부 노출: extractPreview, extractToolUseId
 * 호출자: persist.ts (saveRequest 내부에서)
 * 의존성: types만
 */

import type { NormalizedHookPayload } from './types';

/** preview 저장 상한 — 원본 보존(UI 렌더 시 별도 truncate). prompt 와 동일 정책. */
const PREVIEW_MAX = 2000;

/** 비어있지 않은 문자열만 통과. */
function nonEmptyStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * 행의 표시용 preview 텍스트를 최대 2000자로 추출 (requests.preview 컬럼).
 *
 * - prompt: hook payload 의 raw.prompt (사용자 입력)
 * - tool_call 의 Skill/Agent: tool_input 의 실제 지시문
 *     - Skill: args (없으면 skill 이름)
 *     - Agent: description (없으면 prompt → subagent_type)
 *   TARGET 컬럼이 이미 이름(skill 이름 / subagent_type)을 보여주므로, MESSAGE(preview)에는
 *   실제 지시문을 노출해 중복을 피한다. tool_detail(메타 카탈로그·그래프 flow 의 식별자
 *   `GROUP BY tool_detail`)은 절대 건드리지 않는다 — preview 는 표시 전용 컬럼이라 안전.
 *   preview 는 requests 본체 컬럼이라 모든 피드가 이미 전송 → payload JOIN 없이 표시 가능(DB read 비용 0).
 * - 그 외 타입/도구: null (Bash 등은 tool_detail = 명령어 라 폴백이 이미 의미 있음)
 */
export function extractPreview(payload: NormalizedHookPayload): string | null {
  if (!payload.payload) return null;

  if (payload.request_type === 'prompt') {
    try {
      const raw = JSON.parse(payload.payload) as Record<string, unknown>;
      const text = nonEmptyStr(raw.prompt);
      if (text) return text.slice(0, PREVIEW_MAX);
    } catch {
      // JSON 파싱 실패 시 무시
    }
    return null;
  }

  if (payload.request_type === 'tool_call' &&
      (payload.tool_name === 'Skill' || payload.tool_name === 'Agent')) {
    try {
      const raw = JSON.parse(payload.payload) as { tool_input?: Record<string, unknown> };
      const ti = raw.tool_input ?? {};
      const text = payload.tool_name === 'Skill'
        ? (nonEmptyStr(ti.args) ?? nonEmptyStr(ti.skill))
        : (nonEmptyStr(ti.description) ?? nonEmptyStr(ti.prompt) ?? nonEmptyStr(ti.subagent_type));
      if (text) return text.slice(0, PREVIEW_MAX);
    } catch {
      // JSON 파싱 실패 시 무시
    }
    return null;
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
