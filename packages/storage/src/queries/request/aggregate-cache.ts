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
 */
export function getCacheStats(
  db: Database,
  fromTs?: number,
  toTs?: number
): CacheStats {
  const conditions: string[] = ["type = 'prompt'"];
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

  const totalEffectiveInput = totalTokensInput + totalCacheRead;
  const hitRate = totalEffectiveInput > 0 ? totalCacheRead / totalEffectiveInput : 0;
  const savingsRate = totalEffectiveInput > 0 ? totalCacheRead / totalEffectiveInput : 0;

  return {
    hitRate: Math.round(hitRate * 10_000) / 10_000,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    savingsTokens: totalCacheRead,
    savingsRate: Math.round(savingsRate * 10_000) / 10_000,
  };
}
