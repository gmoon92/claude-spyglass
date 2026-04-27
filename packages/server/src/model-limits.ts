/**
 * 모델별 컨텍스트 윈도우(max_tokens) 매핑 유틸리티
 *
 * @description 컨텍스트 사용률 히스토그램 등 모델 한도 기반 지표 계산용.
 * 서버에서 한 곳에 모아두어 클라이언트가 매핑 로직을 중복 구현하지 않도록 한다.
 *
 * 출처: Anthropic 공식 모델별 context window 발표값.
 * - Claude Opus 4.x: 200K
 * - Claude Sonnet 4.x: 200K
 * - Claude Haiku 4.x: 200K
 * - 기타/미식별 모델: 200K (기본값)
 */

/** 모델명 prefix → max_tokens(컨텍스트 윈도우) 매핑 */
const MODEL_MAX_TOKENS: ReadonlyArray<readonly [prefix: string, maxTokens: number]> = [
  ['claude-opus-4', 200_000],
  ['claude-sonnet-4', 200_000],
  ['claude-haiku-4', 200_000],
  ['claude-3-5-sonnet', 200_000],
  ['claude-3-5-haiku', 200_000],
  ['claude-3-opus', 200_000],
  // moonshot kimi-k2.5 등 비공식 모델은 기본값으로 처리
];

const DEFAULT_MAX_TOKENS = 200_000;

/**
 * 모델명 → 컨텍스트 윈도우(max_tokens) 반환
 * @param model — 모델명 (null/undefined 가능)
 * @returns 토큰 단위 최대 컨텍스트 길이
 */
export function getModelMaxTokens(model: string | null | undefined): number {
  if (!model) return DEFAULT_MAX_TOKENS;
  for (const [prefix, max] of MODEL_MAX_TOKENS) {
    if (model.startsWith(prefix)) return max;
  }
  return DEFAULT_MAX_TOKENS;
}

/**
 * 알려진 모든 모델의 max_tokens 매핑 노출
 * (클라이언트가 자체 계산할 때 활용 가능)
 */
export function getAllModelLimits(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [prefix, max] of MODEL_MAX_TOKENS) {
    out[prefix] = max;
  }
  out['_default'] = DEFAULT_MAX_TOKENS;
  return out;
}
