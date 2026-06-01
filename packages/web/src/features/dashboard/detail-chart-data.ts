/**
 * features/dashboard/detail-chart-data.ts — detail 모드 차트 데이터 파생 (순수)
 *
 * 차트 섹션이 detail 모드(세션 선택)일 때 노출하는 두 차트의 입력을 선택 세션 turns 에서 파생한다.
 *  1) ContextChart(#contextGrowthChart) — 턴별 누적 토큰 라인. turns 의 prompt 필드를 ContextTurn 으로 통과.
 *  2) cache 도넛 — 세션 캐시 분포 2-슬라이스('cache'=read+creation / 'others'=input).
 *       - computeSessionCacheStats(allRequests) 로 read/creation/input 합산(서버 aggregate-cache 와 동일 공식).
 *       - cacheDenom = read + creation + input.
 *       - 슬라이스: cache = cacheRead + cacheCreation(캐시 적중 + 신규 등록 = 캐시 관련 토큰 전체),
 *         others = input(순수 비캐시 입력) = denom - cache.
 *       - _cacheCreation 메타로 도넛 가운데 '캐시 적용 비율'(= (read+creation)/denom) 분자를 전달(분모 = 슬라이스 합).
 *         좌측 cache-panel HIT RATE(= read/denom)와 일관된 방향 — 도넛도 캐시 활용도를 직관적으로 표현.
 *       - tokens<=0 슬라이스는 제거(.filter(d => d.tokens > 0)).
 *
 *     ※ 과거(레거시 flat-view.ts)는 cache=creation 만 세어 read 적중분이 others 로 빠져, HIT RATE 97% 인
 *       세션도 도넛은 <1% 로 보이는 오해가 있었다. cache=read+creation 으로 변경해 두 지표 방향을 정합화한다.
 *
 * 레거시는 flat /api/requests 의 allRequests 를 입력으로 썼다. React BrowseLayout 은 useSessionDetail 의
 *   turns 만 보유하므로, 각 턴의 (prompt + tool_calls + responses) 하위 레코드를 CacheRequestLike 로
 *   평탄화해 동일 분모(tool_call tokens_input 포함)를 재현한다 — computeSessionCacheStats 의
 *   type∈{prompt,tool_call,response} 필터와 1:1.
 *
 * @module features/dashboard/detail-chart-data
 */
import { computeSessionCacheStats, type CacheRequestLike } from './cache-stats';
import type { DonutDatum } from '../../components/chart-data';
import type { ContextTurn } from './context-chart-data';

/** turns 응답 단일 턴(필요 필드만 — 나머지 passthrough). */
export interface SessionTurnLike {
  turn_index?: number;
  prompt?: Record<string, unknown> | null;
  tool_calls?: Array<Record<string, unknown>> | null;
  responses?: Array<Record<string, unknown>> | null;
}

/** 도넛 cache 슬라이스 라벨(레거시 ui.chart.label.cache/others). i18n 키는 호출처 주입. */
export interface CacheDonutLabels {
  cache: string;
  others: string;
}

/**
 * turns → ContextChart 입력(ContextTurn[]). prompt 필드를 그대로 통과 — computeContextChartModel 이
 * prompt.context_tokens/tokens_input/window_max/model 만 읽으므로 추가 변환 불필요.
 */
export function toContextTurns(turns: ReadonlyArray<SessionTurnLike> | null | undefined): ContextTurn[] {
  return (turns || []).map((t) => ({
    turn_index: t.turn_index,
    prompt: (t.prompt ?? null) as ContextTurn['prompt'],
  }));
}

/**
 * turns → 캐시 집계 입력(CacheRequestLike[]). 각 턴의 prompt/tool_calls/responses 하위 레코드를
 * type 부여해 평탄화(레거시 flat allRequests 분모 재현).
 */
export function toCacheRequests(
  turns: ReadonlyArray<SessionTurnLike> | null | undefined,
): CacheRequestLike[] {
  const out: CacheRequestLike[] = [];
  for (const t of turns || []) {
    if (t.prompt) out.push({ ...(t.prompt as CacheRequestLike), type: 'prompt' });
    for (const tc of t.tool_calls || []) out.push({ ...(tc as CacheRequestLike), type: 'tool_call' });
    for (const r of t.responses || []) out.push({ ...(r as CacheRequestLike), type: 'response' });
  }
  return out;
}

/**
 * 선택 세션 turns → cache 도넛 데이터(2-슬라이스).
 *  - cache = read + creation(캐시 적중 + 신규 등록), others = input(비캐시 입력).
 *  - 슬라이스 합 = cacheDenom(read+creation+input), 가운데 % = (read+creation)/denom(_cacheCreation 메타).
 *  - tokens<=0 슬라이스 제거.
 */
export function buildCacheDonut(
  turns: ReadonlyArray<SessionTurnLike> | null | undefined,
  labels: CacheDonutLabels,
): DonutDatum[] {
  const stats = computeSessionCacheStats(toCacheRequests(turns));
  const cacheDenom = stats.cacheReadTokens + stats.cacheCreationTokens + stats.totalInputTokens;
  // '캐시'는 적중(read) + 신규 등록(creation) 합 — 캐시 관련 토큰 전체. 가운데 % 분자도 동일(_cacheCreation).
  const cached = stats.cacheReadTokens + stats.cacheCreationTokens;
  return [
    { id: 'cache', label: labels.cache, tokens: cached, _cacheCreation: cached },
    { id: 'others', label: labels.others, tokens: Math.max(0, cacheDenom - cached) },
  ].filter((d) => (d.tokens ?? 0) > 0);
}
