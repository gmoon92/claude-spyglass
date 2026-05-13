/**
 * 모델별 컨텍스트 윈도우(max_tokens) 매핑 — DB 시드 기반 SSoT (Migration 026)
 *
 * @description
 *   spyglass는 단일 사용자가 아니라 운영 환경 전반에서 쓰이며, Anthropic(Opus/Sonnet/Haiku)
 *   외 Moonshot Kimi 등 비-Anthropic 모델도 프록시한다. 모델별 한도 정책을 코드에 박지 않고
 *   DB 테이블 `model_limits`에 시드로 두어, 신규 모델은 migration 한 줄 또는 운영자 직접
 *   SQL UPDATE 로 진화시킨다.
 *
 * 추론 우선순위 (높음 → 낮음):
 *   1) 모델명 `[1m]` suffix          → EXTENDED (1M)   — 클라이언트 명시 opt-in
 *   2) `anthropic-beta` 헤더에 `context-1m-2025-08-07` 토큰 포함 → EXTENDED (1M)
 *   3) `model_limits` 테이블 prefix 매칭(최장 우선) → 그 행의 max_tokens
 *   4) 위 모두 미매칭                 → DEFAULT (200K) 폴백
 *
 * 입력은 모두 DB의 proxy_requests에서 자동 추출되는 값들:
 *   - proxy_requests.model           (request-parser.ts)
 *   - proxy_requests.anthropic_beta  (audit-headers.ts)
 *
 * 캐시: 시드는 프로세스 라이프 동안 거의 안 바뀐다고 가정하여 첫 호출 시 1회 로드 → 인메모리 보존.
 *       운영자가 SQL로 시드를 갱신하고 즉시 반영을 원하면 `invalidateModelLimitsCache()` 호출.
 *
 * @see packages/storage/migrations/026-model-limits-table.sql (시드 정의)
 * @see packages/web/assets/js/context-window.js (클라이언트 거울 구현 — 추후 API 단일화 가능)
 */

import type { Database } from 'bun:sqlite';
import { getAllModelLimitsFromDb, type ModelLimitRow } from '@spyglass/storage';

/** 레거시 1M opt-in beta 헤더 토큰 (Anthropic 공식). */
const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

/** 표준 context window 한도 (대부분 모델의 기본 폴백). */
export const DEFAULT_MAX_TOKENS = 200_000;

/** 확장 context window 한도 (헤더/suffix 기반 1M opt-in 결과). */
export const EXTENDED_MAX_TOKENS = 1_000_000;

/** DB 시드 인메모리 캐시 — 첫 호출 시 채워짐. */
let _cache: ReadonlyArray<ModelLimitRow> | null = null;

function ensureCache(db: Database): ReadonlyArray<ModelLimitRow> {
  if (_cache === null) {
    _cache = getAllModelLimitsFromDb(db);
  }
  return _cache;
}

/**
 * 운영자가 SQL로 model_limits 시드를 갱신한 직후 호출하면 다음 추론부터 새 값이 반영된다.
 * 일반적인 경우엔 프로세스 재시작이 더 명확하다.
 */
export function invalidateModelLimitsCache(): void {
  _cache = null;
}

/**
 * 모델 + (옵션) anthropic-beta로 실제 context window 한도를 산출.
 *
 * @param db — DB 인스턴스 (시드 조회용)
 * @param model — proxy_requests.model
 * @param anthropicBeta — proxy_requests.anthropic_beta (콤마 구분 토큰 목록)
 * @returns 토큰 단위 context window 한도
 */
export function getModelMaxTokens(
  db: Database,
  model: string | null | undefined,
  anthropicBeta?: string | null,
): number {
  if (!model) return DEFAULT_MAX_TOKENS;

  // 1) [1m] suffix — 클라이언트 명시 opt-in, 최우선
  if (/\[1m\]/i.test(model)) return EXTENDED_MAX_TOKENS;

  // 2) anthropic-beta 헤더 기반 1M opt-in (Anthropic만 의미)
  if (anthropicBeta && anthropicBeta.includes(CONTEXT_1M_BETA)) return EXTENDED_MAX_TOKENS;

  // 3) DB 시드 prefix 매칭 (최장 우선 — ORDER BY length(pattern) DESC)
  const rows = ensureCache(db);
  for (const row of rows) {
    if (model.includes(row.pattern)) return row.max_tokens;
  }

  // 4) 폴백
  return DEFAULT_MAX_TOKENS;
}

/**
 * 클라이언트 UI 보조 표시용 — 현재 운영 환경의 시드 + 핵심 상수 노출.
 * 클라이언트가 자체 mirror 로직과 정합성 확인에 사용 가능.
 */
export function getAllModelLimits(db: Database): {
  default: number;
  extended: number;
  context_1m_beta: string;
  seeds: ModelLimitRow[];
} {
  return {
    default: DEFAULT_MAX_TOKENS,
    extended: EXTENDED_MAX_TOKENS,
    context_1m_beta: CONTEXT_1M_BETA,
    seeds: [...ensureCache(db)],
  };
}
