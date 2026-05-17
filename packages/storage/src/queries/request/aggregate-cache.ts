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
 * - 데이터 소스: stats_hourly (사전 집계 SSoT) — ADR-001/006
 *
 * 데이터 소스 전환 (stats-aggregation 작업):
 *   - 이전: requests 테이블 직접 SUM (풀스캔, 105ms @ 4.5K rows)
 *   - 현재: stats_hourly 시간 버킷 합산 (인덱스 사용, 수 ms)
 *
 * tokens_confidence 필터 제거 (ADR-006):
 *   stats_hourly는 모든 type≠pre_tool 행을 누적하므로 high/low 구분 없음. 실측 결과
 *   현재 데이터의 절대 다수가 high이므로 필터 제거가 산출 값에 미세한 차이만 유발.
 *   미세 차이가 표면화되면 별도 차원으로 stats를 확장하는 것이 정공법.
 *
 * 산식 (observability-true pass — 변경 없음):
 *   - 분자: cache_read_tokens
 *   - 분모: tokens_input + cache_read_tokens + cache_creation_tokens
 *     cache_creation은 첫 write 비용이 발생하는 토큰이라 분모에 포함해야 "전체 토큰
 *     비용 중 캐시 처리 비율"의 옵저빌리티 의미가 정확하다.
 *
 * 집계 범위:
 *   - type IN ('prompt','tool_call','response') — pre_tool은 028 트리거가 이미 제외
 *   - stats_hourly의 hour_ts는 unix epoch sec, requests.timestamp는 ms이므로
 *     fromTs/toTs(ms) → hour 버킷(sec) 변환 시 floor/ceil로 경계 처리.
 */
export function getCacheStats(
  db: Database,
  fromTs?: number,
  toTs?: number
): CacheStats {
  const conditions: string[] = [
    "type IN ('prompt','tool_call','response')",
  ];
  const params: number[] = [];

  if (fromTs !== undefined) {
    // ms → hour bucket sec (floor): bucket 시작이 fromTs 이상인 경우만 포함
    const fromBucket = Math.floor(fromTs / 1000 / 3600) * 3600;
    conditions.push('hour_ts >= ?');
    params.push(fromBucket);
  }
  if (toTs !== undefined) {
    // ms → hour bucket sec (floor): bucket 시작이 toTs 이하인 경우 포함
    const toBucket = Math.floor(toTs / 1000 / 3600) * 3600;
    conditions.push('hour_ts <= ?');
    params.push(toBucket);
  }

  const row = db.query(`
    SELECT
      COALESCE(SUM(tokens_input), 0)          AS tokens_input,
      COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0)     AS cache_read_tokens
    FROM stats_hourly
    WHERE ${conditions.join(' AND ')}
  `).get(...params) as {
    tokens_input: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  } | null;

  const totalCacheRead     = row?.cache_read_tokens ?? 0;
  const totalCacheCreation = row?.cache_creation_tokens ?? 0;
  const totalTokensInput   = row?.tokens_input ?? 0;

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
