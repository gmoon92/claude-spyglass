/**
 * Observability Metrics — 시계열 버킷·이상치 raw.
 *
 * 변경 이유: 1시간 버킷 정의·연산 정책(예: hit_rate denom·반올림) 변경 시 묶여서 변경됨.
 *  - getBurnRateBuckets           (Burn Rate 1시간 버킷)
 *  - getCacheTrendBuckets         (Cache Trend 1시간 버킷)
 *  - getAnomalyTimeSeriesInputs   (Anomaly raw input)
 */

import type { Database } from 'bun:sqlite';
import { ACTIVE_REQUEST_FILTER_SQL } from '../request';
import { buildTimeWindow } from './_shared';
import type {
  BurnRateBucketRow,
  CacheTrendBucketRow,
  AnomalyInputRow,
} from './types';

/**
 * Burn Rate — 1시간 버킷 토큰 합 + 요청 수
 *
 * - prompt 레코드 기준 (실제 모델 호출 단위)
 * - tokens_confidence='high'만 합산 (Spyglass SSoT 정책)
 * - hour_ts: floor(timestamp / 3_600_000) * 3_600_000 (UTC 1시간 정렬)
 * - 빈 버킷은 SQL 결과에 없으므로 응답 단계에서 0으로 채운다
 */
export function getBurnRateBuckets(
  db: Database,
  fromTs?: number,
  toTs?: number
): BurnRateBucketRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'", "tokens_confidence = 'high'"];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT
      (CAST(timestamp / 3600000 AS INTEGER) * 3600000) AS hour_ts,
      COALESCE(SUM(tokens_total), 0) AS tokens,
      COUNT(*)                       AS requests
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY hour_ts
    ORDER BY hour_ts ASC
  `).all(...params) as BurnRateBucketRow[];
}

/**
 * Cache Trend — 1시간 버킷 hit_rate + 절감 토큰
 *
 * - prompt 레코드 기준, tokens_confidence='high'만
 * - hit_rate = cache_read / (tokens_input + cache_read), denom=0이면 null
 * - 빈 버킷은 응답 단계에서 0으로 채운다
 */
export function getCacheTrendBuckets(
  db: Database,
  fromTs?: number,
  toTs?: number
): CacheTrendBucketRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'", "tokens_confidence = 'high'"];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  // .all()은 unknown[]을 반환하므로 raw row 타입을 명시적으로 cast 후 map
  const rawRows = db.query(`
    SELECT
      (CAST(timestamp / 3600000 AS INTEGER) * 3600000)  AS hour_ts,
      COALESCE(SUM(tokens_input), 0)                    AS total_input,
      COALESCE(SUM(cache_read_tokens), 0)               AS cache_read,
      COALESCE(SUM(cache_creation_tokens), 0)           AS cache_create
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY hour_ts
    ORDER BY hour_ts ASC
  `).all(...params) as Array<{
    hour_ts: number;
    total_input: number;
    cache_read: number;
    cache_create: number;
  }>;

  return rawRows.map((r) => {
    const denom = r.total_input + r.cache_read;
    const hit_rate = denom > 0 ? r.cache_read / denom : null;
    return {
      hour_ts: r.hour_ts,
      hit_rate: hit_rate !== null ? Math.round(hit_rate * 10_000) / 10_000 : null,
      savings_tokens: r.cache_read,
    };
  });
}

/**
 * 8) Anomaly 시계열 — raw 입력
 *
 * - spike/loop/slow 판정은 서버 라우트에서 detectAnomalies() 동등 로직 적용
 *   (anomaly.js와 동일 알고리즘 — 200% 평균 초과, turn 내 동일 tool 3회 연속, P95 초과)
 * - 응답 페이로드를 줄이기 위해 필요한 컬럼만 SELECT
 */
export function getAnomalyTimeSeriesInputs(
  db: Database,
  fromTs?: number,
  toTs?: number
): AnomalyInputRow[] {
  const params: number[] = [];
  const conds = [ACTIVE_REQUEST_FILTER_SQL];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT
      id, session_id, turn_id, type, tool_name, timestamp,
      tokens_input, duration_ms
    FROM requests
    WHERE ${conds.join(' AND ')}
    ORDER BY timestamp ASC
  `).all(...params) as AnomalyInputRow[];
}
