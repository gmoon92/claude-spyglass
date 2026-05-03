/**
 * Turn 정규화 모델 — server/TUI/web 공통.
 *
 * ADR-006 (log-view-unification): 인터리빙 책임 서버 이관.
 * `NormalizedTurn`은 `prompt/tool_calls/responses` 호환 필드 + 시간순 인터리빙된 `items[]` 동시 보유.
 */

import type { NormalizedRequest } from './request';

/**
 * Turn 응답 안의 단위 항목 (ADR-006).
 * timestamp 오름차순으로 인터리빙된 배열 `items`로 사용.
 */
export interface NormalizedTurnItem {
  kind: 'tool' | 'response';
  request: NormalizedRequest;
}
