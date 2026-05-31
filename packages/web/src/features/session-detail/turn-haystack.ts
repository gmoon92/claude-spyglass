/**
 * features/session-detail/turn-haystack.ts — 턴 검색 haystack 빌더 (P3-06)
 *
 * 원본: assets/js/session-detail/turn-views.js#buildTurnHaystack (turn-views.js:492, module-private).
 *  - turn 의 T번호 + prompt 본문/모델 + 도구명/detail/모델 + 응답 본문/모델 + 신규 reminder 를
 *    소문자로 normalize 후 ' ' join, 16KB 절단.
 *
 * SSoT 재사용(재구현 금지, §3.3):
 *  - prompt/응답 본문 추출 → render/extract.js#{extractPromptText, extractAssistantText}.
 *    P3-05 GAP-1 의 extract.js SSoT 재연결과 같은 모듈을 import(복제 금지).
 *
 * React 이식 형태: 원본은 module-private 함수라 직접 oracle 이 없으므로 1:1 포팅 + 특성화로 고정한다.
 *  DOM dataset 부착(attachHaystackToTurnLines)·가시성 토글(applyTurnCardSearch)은 store 파생
 *  visibility 로 대체될 imperative 경로(§3.2-5)이므로 본 lib 는 순수 haystack 계산만 소유한다.
 *
 * @module features/session-detail/turn-haystack
 */
import { extractPromptText, extractAssistantText } from '../../../assets/js/render/extract.js';

interface PromptLike {
  preview?: string;
  payload?: unknown;
  model?: string;
}
interface ToolCallLike {
  tool_name?: string;
  tool_detail?: string;
  model?: string;
}
interface ResponseLike {
  payload?: unknown;
  preview?: string;
  model?: string;
}
export interface HaystackTurn {
  turn_index: number;
  prompt?: PromptLike | null;
  tool_calls?: ToolCallLike[] | null;
  responses?: ResponseLike[] | null;
  system_reminder?: string | null;
}

/** haystack 16KB 상한 — 원본 turn-views.js:517. */
export const HAYSTACK_MAX = 16000;

/**
 * 턴 검색 haystack 을 만든다. 원본 buildTurnHaystack(turn-views.js:492) 1:1.
 *
 * @param turn          TurnItem
 * @param newReminders  computeNewRemindersByTurn 으로 얻은 신규 reminder 본문 배열
 */
export function buildTurnHaystack(turn: HaystackTurn, newReminders?: string[]): string {
  const parts: string[] = [];
  parts.push(`T${turn.turn_index}`);

  if (turn.prompt?.preview) parts.push(turn.prompt.preview);
  if (turn.prompt) {
    const promptBody = extractPromptText({
      payload: turn.prompt.payload,
      preview: turn.prompt.preview,
      type: 'prompt',
    });
    if (promptBody && promptBody !== turn.prompt.preview) parts.push(promptBody);
    if (turn.prompt.model) parts.push(turn.prompt.model);
  }

  for (const tc of turn.tool_calls ?? []) {
    if (tc.tool_name) parts.push(tc.tool_name);
    if (tc.tool_detail) parts.push(tc.tool_detail);
    if (tc.model) parts.push(tc.model);
  }

  for (const rsp of turn.responses ?? []) {
    const body = extractAssistantText({ payload: rsp.payload, preview: rsp.preview, type: 'response' });
    if (body) parts.push(body);
    else if (rsp.preview) parts.push(rsp.preview);
    if (rsp.model) parts.push(rsp.model);
  }

  if (Array.isArray(newReminders) && newReminders.length) {
    parts.push(...newReminders);
  } else if (turn.system_reminder) {
    parts.push(turn.system_reminder);
  }

  return parts.join(' ').toLowerCase().slice(0, HAYSTACK_MAX);
}
