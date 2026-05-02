/**
 * hook 모듈 — 핸들러 공유 헬퍼
 *
 * 책임:
 *  - 모든 hook 핸들러가 공통으로 쓰는 작은 유틸을 한 곳에 모음.
 *  - 핸들러 클래스에 인라인하면 중복 발생 → 별도 모듈로 추출.
 *
 * 외부 노출 안 함 (handlers/ 내부 전용).
 *
 * 의존성: types
 */

import { randomUUID } from 'node:crypto';

/**
 * 한 hook 요청에 대한 고유 request id 생성.
 *
 * 포맷: `<prefix>-<timestamp>-<8자 uuid>`
 *  - prefix: 'pre' | 'tool' | 'prompt' | 'sys' (이벤트별로 prefix 다름)
 *  - timestamp: 핸들러 진입 시각 ms
 *  - uuid 8자: 같은 ms에 다중 hook 도착 시 충돌 방지
 *
 * 사용처:
 *  - 'pre-...'    → PreToolUseHandler
 *  - 'tool-...'   → PostToolUseHandler
 *  - 'prompt-...' → UserPromptSubmitHandler
 *  - 'sys-...'    → SystemEventHandler (fallback)
 */
export function makeRequestId(prefix: string, now: number): string {
  return `${prefix}-${now}-${randomUUID().slice(0, 8)}`;
}

/**
 * transcript 파싱 결과의 confidence를 Normalized 페이로드용 (confidence, source) 쌍으로 정규화.
 *
 * 규칙: input/output 어느 한쪽이라도 'error'면 전체 'error', 그 외 'high'.
 *  - error → source='unavailable'
 *  - high  → source='transcript'
 *
 * 호출 시점:
 *  - PostToolUseHandler / UserPromptSubmitHandler에서 transcript 파싱 직후
 */
export function deriveTokensConfidence(
  inputConfidence: 'high' | 'error',
  outputConfidence: 'high' | 'error',
): { tokensConfidence: 'high' | 'error'; tokensSource: 'transcript' | 'unavailable' } {
  const tokensConfidence = inputConfidence === 'error' || outputConfidence === 'error'
    ? 'error'
    : 'high';
  return {
    tokensConfidence,
    tokensSource: tokensConfidence === 'error' ? 'unavailable' : 'transcript',
  };
}
