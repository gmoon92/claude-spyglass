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
import { loadArchivedRequestRows } from '../request/read';
import { statsHourlyUnionSource } from '../../archive/stats-bridge';

/** ms timestamp → UTC 1시간 버킷(ms). Hot SQL의 CAST(timestamp/3600000 AS INTEGER)*3600000 미러. */
function hourBucketMs(ts: number): number {
  return Math.floor(ts / 3_600_000) * 3_600_000;
}
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

  const hot = db.query(`
    SELECT
      (CAST(timestamp / 3600000 AS INTEGER) * 3600000) AS hour_ts,
      COALESCE(SUM(tokens_total), 0) AS tokens,
      COUNT(*)                       AS requests
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY hour_ts
    ORDER BY hour_ts ASC
  `).all(...params) as BurnRateBucketRow[];

  // Archive 구간(동일 필터 prompt+high)을 hour 버킷 단위로 가법 병합.
  const byHour = new Map<number, BurnRateBucketRow>();
  for (const b of hot) byHour.set(b.hour_ts, { ...b });
  for (const r of loadArchivedRequestRows(db, { fromTs, toTs })) {
    if (r.type !== 'prompt' || r.tokens_confidence !== 'high') continue;
    const h = hourBucketMs(r.timestamp);
    const cur = byHour.get(h) ?? { hour_ts: h, tokens: 0, requests: 0 };
    cur.tokens += r.tokens_total;
    cur.requests += 1;
    byHour.set(h, cur);
  }
  return [...byHour.values()].sort((a, b) => a.hour_ts - b.hour_ts);
}

/**
 * Cache Trend — 1시간 버킷 hit_rate + 절감 토큰
 *
 * 데이터 소스: stats_hourly (사전 집계 SSoT) — ADR-001/006.
 * 변경 (stats-aggregation 작업):
 *   - 이전: requests 직접 GROUP BY (풀스캔)
 *   - 현재: stats_hourly에서 type='prompt' 행을 hour_ts 기준으로 합산 (인덱스 사용)
 *   - tokens_confidence='high' 필터 제거 (ADR-006). 실측상 대다수가 high라 미세 차이.
 *
 * API 응답 shape 보존:
 *   - hour_ts는 ms 단위로 유지 (stats_hourly는 sec → ×1000)
 *   - hit_rate 산식 변경 없음: cache_read / (tokens_input + cache_read)
 */
export function getCacheTrendBuckets(
  db: Database,
  fromTs?: number,
  toTs?: number
): CacheTrendBucketRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'"];
  // stats_hourly의 hour_ts는 unix epoch sec, 입력 fromTs/toTs는 ms이므로 변환
  if (fromTs !== undefined) {
    conds.push('hour_ts >= ?');
    params.push(Math.floor(fromTs / 1000 / 3600) * 3600);
  }
  if (toTs !== undefined) {
    conds.push('hour_ts <= ?');
    params.push(Math.floor(toTs / 1000 / 3600) * 3600);
  }

  const rawRows = db.query(`
    SELECT
      hour_ts                                   AS hour_ts_sec,
      COALESCE(SUM(tokens_input), 0)            AS total_input,
      COALESCE(SUM(cache_read_tokens), 0)       AS cache_read,
      COALESCE(SUM(cache_creation_tokens), 0)   AS cache_create
    FROM ${statsHourlyUnionSource()}
    WHERE ${conds.join(' AND ')}
    GROUP BY hour_ts
    ORDER BY hour_ts ASC
  `).all(...params) as Array<{
    hour_ts_sec: number;
    total_input: number;
    cache_read: number;
    cache_create: number;
  }>;

  return rawRows.map((r) => {
    const denom = r.total_input + r.cache_read;
    const hit_rate = denom > 0 ? r.cache_read / denom : null;
    return {
      hour_ts: r.hour_ts_sec * 1000, // sec → ms 변환 (응답 shape 보존)
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

  // 정렬은 (timestamp, id) — 동일 ms 타이 순서를 결정화해 Hot/Archive 병합이 exact(id 2차키).
  const hot = db.query(`
    SELECT
      id, session_id, turn_id, type, tool_name, timestamp,
      tokens_input, duration_ms
    FROM requests
    WHERE ${conds.join(' AND ')}
    ORDER BY timestamp ASC, id ASC
  `).all(...params) as AnomalyInputRow[];

  // Archive 원행(이미 isActiveRequest 통과)을 동일 shape로 매핑해 병합 후 (ts,id) 재정렬.
  const archived: AnomalyInputRow[] = loadArchivedRequestRows(db, { fromTs, toTs }).map((r) => ({
    id: r.id,
    session_id: r.session_id,
    turn_id: r.turn_id ?? null,
    type: r.type,
    tool_name: r.tool_name ?? null,
    timestamp: r.timestamp,
    tokens_input: r.tokens_input,
    duration_ms: r.duration_ms,
  }));
  if (archived.length === 0) return hot;
  return [...hot, ...archived].sort((a, b) =>
    a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
