/**
 * context-window.js — 모델 + anthropic-beta 헤더로 실제 context window 한도 추론.
 *
 * ⚠ SSoT 쌍 (mirror of server):
 *   서버: `packages/server/src/model-limits.ts` (getModelMaxTokens / DEFAULT_MAX_TOKENS / EXTENDED_MAX_TOKENS)
 *   — **이 파일의 결정 우선순위·모델 목록·beta 토큰을 변경할 때는 서버 파일도 반드시 함께 갱신해야 한다.**
 *   현재 모노레포에 공유 패키지가 없어 두 곳에 거울 구현을 유지한다. 추후 `packages/shared`로 추출 시 단일화.
 *
 * 책임:
 *  - turn.prompt.model / turn.prompt.anthropic_beta 두 값을 받아 토큰 한도를 반환.
 *  - 기준은 Anthropic 공식 정책(2026-05 시점) + claude-code 클라이언트 로직.
 *
 * 결정 우선순위:
 *  1. 모델명에 `[1m]` suffix → 1,000,000 (클라이언트 명시 opt-in, 최우선)
 *  2. 1M GA 모델군 (Opus 4.7 / 4.6, Sonnet 4.6) → 1,000,000 (beta 무관)
 *  3. anthropic-beta 헤더에 `context-1m-2025-08-07` 포함 → 1,000,000 (레거시 opt-in)
 *  4. 기본값 → 200,000 (대부분 모델의 표준 창)
 *
 * 호출자:
 *  - context-chart.js: 누적 차트 스케일·% 계산
 *  - (추후) anomaly.js: heavy-start 절대 임계값 검사
 *
 * 의존성: 없음 (순수 함수, DOM·state 미접근).
 */

/** Anthropic 공식 GA 1M context 모델군 (2026-05 기준). */
const MODELS_WITH_1M_GA = [
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
];

/** 1M context 활성화 신호로 인정되는 beta 헤더 토큰. */
const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

/** 표준 context window 한도 (대부분 모델의 기본값). */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** 확장 context window 한도. */
export const EXTENDED_CONTEXT_WINDOW = 1_000_000;

/**
 * model + anthropic_beta로 실제 context window 토큰 한도를 추론한다.
 *
 * @param {string|null|undefined} model — proxy_requests.model (예: "claude-opus-4-7")
 * @param {string|null|undefined} anthropicBeta — proxy_requests.anthropic_beta (콤마 구분 토큰 목록)
 * @returns {number} 추론된 토큰 한도 (200000 또는 1000000)
 */
export function deriveContextWindowSize(model, anthropicBeta) {
  if (!model) return DEFAULT_CONTEXT_WINDOW;

  // 1. [1m] suffix — 클라이언트 명시 opt-in, 최우선
  if (/\[1m\]/i.test(model)) return EXTENDED_CONTEXT_WINDOW;

  // 2. 1M GA 모델군 — beta 무관
  if (MODELS_WITH_1M_GA.some(m => model.includes(m))) return EXTENDED_CONTEXT_WINDOW;

  // 3. 레거시 beta 헤더 opt-in
  if (anthropicBeta && anthropicBeta.includes(CONTEXT_1M_BETA)) return EXTENDED_CONTEXT_WINDOW;

  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * 토큰 한도를 사람이 읽기 좋은 라벨로 변환 ("200K" / "1.0M").
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
