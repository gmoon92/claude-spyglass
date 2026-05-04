/**
 * Cache Trend 계산기 — 24h × 1h 버킷 hit_rate + 절감 토큰 합.
 *
 * @description
 *   srp-redesign Phase 3: server/metrics.ts(561줄) 분해 결과.
 *   변경 이유: "Cache Trend 알고리즘 변경 (hit_rate 정의·null 처리·집계 단위)".
 *
 *   left-panel-observability-revamp ADR-003 기반.
 *   storage(getCacheTrendBuckets) raw → fillHourSlots → 마지막 valid hit_rate 추출.
 */

import type { Database } from 'bun:sqlite';
import { getCacheTrendBuckets } from '@spyglass/storage';
import { fillHourSlots, type TimeWindow } from '../_shared';

export interface CacheTrendPayload {
  buckets: Array<{ hour_ts: number; hit_rate: number | null; savings_tokens: number }>;
  hit_rate_now: number | null;
  savings_tokens_total: number;
}

export function computeCacheTrend(db: Database, window: TimeWindow): CacheTrendPayload {
  const now = Date.now();
  const toMs   = window.to   ?? now;
  const fromMs = window.from ?? (toMs - 24 * 3_600_000);

  const raw = getCacheTrendBuckets(db, fromMs, toMs);
  const buckets: CacheTrendPayload['buckets'] = fillHourSlots(raw, fromMs, toMs, (hour_ts, r) => ({
    hour_ts,
    hit_rate: r?.hit_rate ?? null,
    savings_tokens: r?.savings_tokens ?? 0,
  }));

  // 마지막 valid hit_rate (= 최신)
  let hit_rate_now: number | null = null;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i].hit_rate !== null) { hit_rate_now = buckets[i].hit_rate; break; }
  }
  const savings_tokens_total = buckets.reduce((s, b) => s + b.savings_tokens, 0);

  return { buckets, hit_rate_now, savings_tokens_total };
}
