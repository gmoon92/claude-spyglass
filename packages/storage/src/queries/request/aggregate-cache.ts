/**
 * Request 캐시 통계 — Cache Intelligence.
 *
 * @description
 *   srp-redesign Phase 10: aggregate.ts(453줄)를 UI 도메인별로 분해.
 *   이 파일의 변경 이유: "캐시 히트율/절감 토큰 지표 정의 변경".
 *
 *   타입: CacheStats
 *   함수: getCacheStats
 *
 *   USD 비용 환산은 정확한 가격 플랜을 알 수 없어 추정치만 가능하므로 제거됨.
 *   토큰 합계는 tokens_confidence='high'인 레코드만 집계.
 */

import type { Database } from 'bun:sqlite';

/** 캐시 히트율·절감 토큰 통계 (USD 환산은 신뢰도 낮아 제거됨) */
export interface CacheStats {
  hitRate: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** 캐시로 절감된 입력 토큰 수 (cache_read_tokens 합산과 동일) */
  savingsTokens: number;
  /** 캐시 히트로 절감된 비율 (0~1) */
  savingsRate: number;
}

/**
 * 캐시 히트율 및 절감 토큰 집계
 * - fromTs / toTs 미지정 시 전체 기간
 * - tokens_confidence='high'인 레코드만 집계
 *
 * 집계 범위 (cache-stats-scope pass):
 *   - 이전: type='prompt' 한정 — 사용자 발화 1건당 API 호출만 합산하여 도구 사이클의
 *     수십~수백 API 호출이 모두 누락. cache_read의 약 95%가 분모에서 빠짐.
 *   - 변경: 모든 LLM API 호출 합산 (prompt + tool_call의 'tool' event + response).
 *     pre_tool(미완성 PreToolUse)은 토큰=0이라 자연 제외이지만 명시적으로 필터.
 *     spyglass의 핵심 목적이 "비용 절감 가시화"이므로 모든 호출의 토큰을 분모로
 *     포함해야 의미 있는 hit rate가 산출된다.
 *
 * 산식 (observability-true pass):
 *   - 분자: cache_read_tokens
 *   - 분모: tokens_input + cache_read_tokens + cache_creation_tokens
 *     (이전엔 cache_creation을 분모에서 빼서 "캐시 등록도 비용"이라는 사실이
 *      누락됐다 — 새 세션 초반 hit rate가 인위적으로 부풀어 보이는 회귀가 있었음.
 *      cache_creation은 첫 write 비용이 발생하는 토큰이라 분모에 포함해야
 *      "전체 토큰 비용 중 캐시 처리 비율"이라는 옵저빌리티 의미가 정확해진다.)
 */
export function getCacheStats(
  db: Database,
  fromTs?: number,
  toTs?: number
): CacheStats {
  const conditions: string[] = [
    "type IN ('prompt','tool_call','response')",
    "(event_type IS NULL OR event_type != 'pre_tool')",
  ];
  const params: number[] = [];

  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const row = db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0)            AS tokens_input,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_creation_tokens ELSE 0 END), 0)   AS cache_creation_tokens,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_read_tokens ELSE 0 END), 0)       AS cache_read_tokens
    FROM requests
    WHERE ${conditions.join(' AND ')}
  `).get(...params) as {
    tokens_input: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  } | null;

  const totalCacheRead     = row?.cache_read_tokens ?? 0;
  const totalCacheCreation = row?.cache_creation_tokens ?? 0;
  const totalTokensInput   = row?.tokens_input ?? 0;

  // observability-true pass: cache_creation도 비용 발생 동작이므로 분모에 포함.
  const totalBillableInput = totalTokensInput + totalCacheRead + totalCacheCreation;
  const hitRate = totalBillableInput > 0 ? totalCacheRead / totalBillableInput : 0;
  const savingsRate = totalBillableInput > 0 ? totalCacheRead / totalBillableInput : 0;

  return {
    hitRate: Math.round(hitRate * 10_000) / 10_000,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    savingsTokens: totalCacheRead,
    savingsRate: Math.round(savingsRate * 10_000) / 10_000,
  };
}
