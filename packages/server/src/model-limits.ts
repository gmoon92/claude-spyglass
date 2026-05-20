/**
 * 모델별 컨텍스트 윈도우(max_tokens) 매핑 — 시드 + 요청 페이로드 관측 결합 SSoT
 *
 * @description
 *   spyglass는 proxy 입장이라 "모델의 진짜 한도"를 알 수 없다. CLI가 자체적으로
 *   autocompact를 트리거하므로 한도는 CLI가 결정하며, 동일 모델이라도 CLI 버전·벤더에
 *   따라 다를 수 있다. 따라서 정적 시드(공식 발표값)만 믿으면 부정확해진다.
 *
 *   해법은 **요청 페이로드 기반 동적 보정**: model_limits 시드를 폴백/하한선으로 두고,
 *   proxy_requests에 관측된 그 모델의 최대 컨텍스트가 시드보다 크면 관측치를 채택한다.
 *   `한도 = max(seed, observedMax)`. 관측이 시드를 초과한다는 것은 시드가 잘못됐다는
 *   결정적 증거이며, 관측치는 곧 그 환경 CLI 한도의 최소 보장값이다.
 *
 * 추론 우선순위 (높음 → 낮음):
 *   1) 모델명 `[1m]` suffix          → EXTENDED (1M)   — 클라이언트 명시 opt-in
 *   2) `anthropic-beta` 헤더에 `context-1m-2025-08-07` 토큰 포함 → EXTENDED (1M)
 *   3) max(시드 매칭값, observedMax) — 시드 미매칭 시 시드는 DEFAULT(200K)로 폴백
 *
 * 입력은 모두 DB의 proxy_requests에서 자동 추출되는 값들:
 *   - proxy_requests.model           (request-parser.ts)
 *   - proxy_requests.anthropic_beta  (audit-headers.ts)
 *
 * 캐시:
 *   - 시드(_seedCache): 거의 안 바뀜 가정, 첫 호출 시 1회 로드.
 *   - 관측치(_observedCache): model별 TTL 캐시. 새 요청이 적재되면 갱신 필요 — 짧은 TTL(60s)로
 *     운영 비용을 제한하면서 신선도를 확보. 즉시 반영이 필요하면
 *     `invalidateModelLimitsCache()`를 호출해 둘 다 비운다.
 *
 * @see packages/storage/migrations/026-model-limits-table.sql (시드 정의)
 * @see packages/storage/src/queries/model-limits.ts `getObservedMaxContextForModel`
 */

import type { Database } from 'bun:sqlite';
import {
  getAllModelLimitsFromDb,
  getObservedMaxContextForModel,
  type ModelLimitRow,
} from '@spyglass/storage';

/** 레거시 1M opt-in beta 헤더 토큰 (Anthropic 공식). */
const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

/** 표준 context window 한도 (대부분 모델의 기본 폴백). */
export const DEFAULT_MAX_TOKENS = 200_000;

/** 확장 context window 한도 (헤더/suffix 기반 1M opt-in 결과). */
export const EXTENDED_MAX_TOKENS = 1_000_000;

/** DB 시드 인메모리 캐시 — 첫 호출 시 채워짐. */
let _seedCache: ReadonlyArray<ModelLimitRow> | null = null;

/**
 * model별 관측 최대 컨텍스트 TTL 캐시.
 *  - key: 정확한 model 문자열 (proxy_requests.model 값)
 *  - value: 관측 최대 + 채워진 시각(ms)
 *  - TTL: 60초. 짧게 잡아 신선도 확보, 동시에 같은 model에 쏟아지는 호출은 안전하게 1회 SELECT로 줄임.
 */
const OBSERVED_TTL_MS = 60_000;
const _observedCache: Map<string, { value: number; ts: number }> = new Map();

function ensureSeedCache(db: Database): ReadonlyArray<ModelLimitRow> {
  if (_seedCache === null) {
    _seedCache = getAllModelLimitsFromDb(db);
  }
  return _seedCache;
}

/**
 * model에 대한 관측 최대 컨텍스트 토큰 — TTL 캐시 적용.
 * 캐시 미스/만료 시 1회 SELECT 후 채움. 0건 모델은 0 반환.
 */
function getObservedMaxCached(db: Database, model: string): number {
  const now = Date.now();
  const hit = _observedCache.get(model);
  if (hit && now - hit.ts < OBSERVED_TTL_MS) return hit.value;
  const value = getObservedMaxContextForModel(db, model);
  _observedCache.set(model, { value, ts: now });
  return value;
}

/**
 * 운영자가 SQL로 model_limits 시드를 갱신하거나 관측치 즉시 반영이 필요한 경우 호출.
 * 시드·관측 캐시를 모두 비워 다음 추론에서 fresh 값으로 채워지게 한다.
 */
export function invalidateModelLimitsCache(): void {
  _seedCache = null;
  _observedCache.clear();
}

/**
 * 모델 + (옵션) anthropic-beta로 실제 context window 한도를 산출.
 *
 * @description
 *   1M opt-in 시그널(명시 suffix·beta 헤더)은 즉시 EXTENDED로 단락. 그 외는
 *   `max(seedFromTable, observedMaxFromProxyRequests)`로 결합한다.
 *   "관측치가 시드를 넘으면 시드가 틀린 것"이라는 정책 — CLI 한도가 시드와 다른
 *   경우(예: Moonshot Kimi K2.6 138K 관측 vs 시드 128K)를 자동 보정한다.
 *
 * @param db — DB 인스턴스 (시드/관측치 조회용)
 * @param model — proxy_requests.model (exact match로 관측치 조회)
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

  // 3) 시드 매칭(최장 우선) — 미매칭이면 DEFAULT를 시드로 사용
  const rows = ensureSeedCache(db);
  let seed = DEFAULT_MAX_TOKENS;
  for (const row of rows) {
    if (model.includes(row.pattern)) { seed = row.max_tokens; break; }
  }

  // 4) 요청 페이로드 관측치 — exact model 매칭, TTL 캐시.
  //    시드가 운영 한도보다 작게 잡혀 있어도 실제로 그 모델로 들어온 요청이 시드를 초과하면
  //    그 관측치가 곧 한도의 최소 보장값. max()로 묶어 시드와 관측 양쪽을 모두 만족시킨다.
  const observed = getObservedMaxCached(db, model);

  return Math.max(seed, observed);
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
    seeds: [...ensureSeedCache(db)],
  };
}
