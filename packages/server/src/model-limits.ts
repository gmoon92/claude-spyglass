/**
 * 모델별 컨텍스트 윈도우(max_tokens) 매핑 유틸리티
 *
 * @description
 *   서버 측 SSoT — 컨텍스트 사용률 히스토그램(/api/metrics/context-usage) 등
 *   "모델 한도 기반 지표" 계산에 단일 정의를 제공한다.
 *
 *   판단 입력은 모두 DB의 `proxy_requests`에서 자동 추출되는 값들이다:
 *     - `proxy_requests.model`          : 요청 body의 model 문자열 (request-parser.ts)
 *     - `proxy_requests.anthropic_beta` : 요청 헤더 raw (audit-headers.ts)
 *
 *   ⚠ Anthropic API는 context-window 자체를 응답 헤더로 노출하지 않는다.
 *     (proxy_requests.max_tokens 컬럼은 "요청 body의 응답 출력 한도"이지 context window 아님)
 *     따라서 한도는 (model + anthropic-beta) 조합으로 정책 추론해야 한다.
 *
 *   하드코딩 제거 방침:
 *     · 결정 룰의 본질은 "헤더에 어떤 beta 토큰이 있는가" + "모델명에 [1m] suffix가 있는가" 이며,
 *       두 신호 모두 proxy_requests에 raw로 저장된다 → 코드 안에 모델 prefix를 박을 필요가 없다.
 *     · GA 1M 모델군(Anthropic이 beta 헤더 없이도 1M 기본을 부여한 모델)은 운영 정책이라
 *       환경변수 `SPYGLASS_MODELS_1M_GA` 로 운영자가 통제. 빈 env면 헤더 신호만 신뢰.
 *     · 클라이언트(`packages/web/assets/js/context-window.js`)는 동일 규칙의 거울 구현 —
 *       정책 변경 시 두 곳을 함께 갱신. 추후 `packages/shared`로 추출 시 단일화.
 *
 * 결정 우선순위 (높음 → 낮음):
 *   1) 모델명에 `[1m]` suffix 포함        → 1,000,000  (클라이언트 명시 opt-in)
 *   2) anthropic-beta에 `context-1m-2025-08-07` 토큰 포함 → 1,000,000  (헤더 기반 opt-in)
 *   3) GA 1M 모델군 (env로 통제)           → 1,000,000  (beta 무관)
 *   4) 그 외                               → 200,000    (대부분 모델 표준)
 *
 * @see packages/web/assets/js/context-window.js (대칭 클라이언트 구현)
 */

/** 레거시 1M opt-in beta 헤더 토큰 (Anthropic 공식). */
const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

/** 표준 context window 한도 (대부분 모델의 기본값). */
export const DEFAULT_MAX_TOKENS = 200_000;

/** 확장 context window 한도. */
export const EXTENDED_MAX_TOKENS = 1_000_000;

/**
 * GA 1M 모델군을 환경변수로 동적 로딩.
 *
 * - `SPYGLASS_MODELS_1M_GA="claude-opus-4-7,claude-opus-4-6,claude-sonnet-4-6"` 형식
 * - 빈/미설정이면 빈 배열 → 헤더 신호(beta / [1m] suffix)만 신뢰
 * - 운영자가 새 GA 모델이 나오면 코드 수정 없이 env만 갱신
 *
 * 모듈 로드 시점에 한 번 평가 (env는 프로세스 라이프 동안 변하지 않음).
 */
function loadGa1mPatterns(): readonly string[] {
  const raw = process.env.SPYGLASS_MODELS_1M_GA;
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const GA_1M_PATTERNS = loadGa1mPatterns();

/**
 * 모델명 + (옵션) anthropic-beta로 실제 컨텍스트 윈도우(max_tokens)를 산출.
 *
 * @param model — proxy_requests.model 또는 requests.model
 * @param anthropicBeta — proxy_requests.anthropic_beta (콤마 구분 토큰 목록)
 * @returns 토큰 단위 최대 컨텍스트 길이
 */
export function getModelMaxTokens(
  model: string | null | undefined,
  anthropicBeta?: string | null,
): number {
  if (!model) return DEFAULT_MAX_TOKENS;

  // 1) [1m] suffix — 최우선 (모델명 자체에 포함된 명시 opt-in)
  if (/\[1m\]/i.test(model)) return EXTENDED_MAX_TOKENS;

  // 2) 헤더 기반 opt-in — DB에서 자동 추출되는 본질 신호
  if (anthropicBeta && anthropicBeta.includes(CONTEXT_1M_BETA)) return EXTENDED_MAX_TOKENS;

  // 3) GA 1M 정책 (env로 통제 — 미설정이면 이 단계는 사실상 skip)
  if (GA_1M_PATTERNS.length > 0 && GA_1M_PATTERNS.some(p => model.includes(p))) {
    return EXTENDED_MAX_TOKENS;
  }

  return DEFAULT_MAX_TOKENS;
}

/**
 * UI 보조 표시용 — 현재 운영 환경에서 알려진 정적 매핑을 노출.
 *
 * 컬렉션:
 *  - `_default`            : 미식별 모델 폴백
 *  - `_context_1m_beta`    : 1M opt-in beta 토큰 (참고용)
 *  - `_ga_1m`              : SPYGLASS_MODELS_1M_GA env로 등록된 prefix 목록
 *
 * 동적이므로 클라이언트가 이 응답을 받아 자체 미러 로직과 정합성 확인에 사용 가능.
 */
export function getAllModelLimits(): Record<string, unknown> {
  return {
    _default: DEFAULT_MAX_TOKENS,
    _extended: EXTENDED_MAX_TOKENS,
    _context_1m_beta: CONTEXT_1M_BETA,
    _ga_1m: [...GA_1M_PATTERNS],
  };
}
