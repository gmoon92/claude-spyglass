/**
 * context-window.js — 컨텍스트 윈도우 표시 유틸 (서버 SSoT 단일화 후 표시 전용).
 *
 * ⚠ 추론 로직은 서버 단일 SSoT로 이전됨:
 *   - 한도 산출: packages/server/src/model-limits.ts `getModelMaxTokens()`
 *   - turns 응답 노출: packages/server/src/routes/sessions.ts `enrichTurnsWithWindowMax()`
 *   - 정책: max(model_limits 시드, proxy_requests 관측 최대) + 1M opt-in 단락
 *
 * 클라이언트는 더 이상 model + anthropic_beta를 보고 자체 추론하지 않는다.
 * `turn.prompt.window_max` (서버가 채워준 값)를 그대로 사용한다.
 *
 * 책임:
 *  - 토큰 한도를 사람이 읽기 좋은 라벨로 포맷 (`formatContextWindowLabel`).
 *  - 서버 응답에 `window_max`가 누락된 비정상 경우의 안전 폴백 상수 (`DEFAULT_CONTEXT_WINDOW`).
 *
 * 호출자:
 *  - context-chart.js: 세션 차트 풋터·hover 사용률 표시.
 *
 * 의존성: 없음 (순수 함수).
 */

/**
 * 서버 응답이 window_max를 누락했을 때만 쓰이는 안전 폴백.
 * 정상 흐름에선 서버가 동적으로 산출한 값을 받으므로 이 상수는 거의 사용되지 않는다.
 */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * 토큰 한도를 사람이 읽기 좋은 라벨로 변환 ("200K" / "1.0M" / "262.1K").
 * 인디케이터·풋터·툴팁의 일관 표기를 위해 한 곳에서 관리.
 */
export function formatContextWindowLabel(size) {
  if (size >= 1_000_000) {
    const m = size / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (size >= 1000) {
    const k = size / 1000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(size);
}
