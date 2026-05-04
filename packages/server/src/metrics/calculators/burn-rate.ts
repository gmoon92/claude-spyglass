/**
 * Burn Rate 계산기 — 24h × 1h 버킷 + 어제 동시각 비교.
 *
 * @description
 *   srp-redesign Phase 3: server/metrics.ts(561줄) 분해 결과.
 *   변경 이유: "Burn Rate 알고리즘·비교 윈도우 정책 변경".
 *
 *   left-panel-observability-revamp ADR-003 기반.
 *   storage 계층(getBurnRateBuckets)이 1h 버킷 raw 데이터를 반환하면,
 *   이 계산기가 (1) 빈 슬롯 채움 (2) 어제 동시각 비교 (3) delta% 계산을 담당.
 */

import type { Database } from 'bun:sqlite';
import { getBurnRateBuckets } from '@spyglass/storage';
import { fillHourSlots, type TimeWindow } from '../_shared';

export interface BurnRatePayload {
  buckets: Array<{ hour_ts: number; tokens: number; requests: number }>;
  current_total: number;
  yesterday_same_window: number;
  delta_pct: number | null;
}

export function computeBurnRate(db: Database, window: TimeWindow): BurnRatePayload {
  const now = Date.now();
  const toMs   = window.to   ?? now;
  const fromMs = window.from ?? (toMs - 24 * 3_600_000);
  const spanMs = toMs - fromMs;

  // 오늘 윈도우 버킷
  const todayRaw = getBurnRateBuckets(db, fromMs, toMs);
  const buckets: BurnRatePayload['buckets'] = fillHourSlots(todayRaw, fromMs, toMs, (hour_ts, r) => ({
    hour_ts,
    tokens: r?.tokens ?? 0,
    requests: r?.requests ?? 0,
  }));

  const current_total = buckets.reduce((s, b) => s + b.tokens, 0);

  // 어제 동시각 윈도우 (정확히 24h 이전)
  const yFrom = fromMs - 24 * 3_600_000;
  const yTo   = toMs   - 24 * 3_600_000;
  // 동일 spanMs 보장 (윈도우가 24h 미만이어도 같은 길이)
  if (yFrom + spanMs !== yTo) {
    // no-op: 안전하게 yFrom..yFrom+spanMs 사용
  }
  const yesterdayRaw = getBurnRateBuckets(db, yFrom, yTo);
  const yesterday_same_window = yesterdayRaw.reduce((s, r) => s + r.tokens, 0);

  let delta_pct: number | null = null;
  if (yesterday_same_window > 0) {
    delta_pct = Math.round(
      ((current_total - yesterday_same_window) / yesterday_same_window) * 1000
    ) / 10;
  } else if (current_total > 0) {
    delta_pct = null; // 어제 0 → 비교 의미 없음
  }

  return { buckets, current_total, yesterday_same_window, delta_pct };
}
