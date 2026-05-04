/**
 * Anomaly 시계열 계산기 — spike / loop / slow 검출 + 시간 버킷 카운트.
 *
 * @description
 *   srp-redesign Phase 3: server/metrics.ts(561줄) 분해 결과.
 *   변경 이유: "Anomaly 검출 알고리즘 변경 (spike 임계·loop streak·P95 정의)".
 *
 *   storage(getAnomalyTimeSeriesInputs) raw rows → 알고리즘 적용 → 시간 버킷 집계.
 *   web 클라이언트의 anomaly.js와 동일 알고리즘(서버 이식).
 *
 * 검출 규칙:
 *   - spike: 세션별 prompt tokens_input 평균의 200% 초과
 *   - loop:  turn_id 내 동일 tool_name 연속 3회 이상
 *   - slow:  tool_call duration_ms가 전체 P95 초과
 */

import type { AnomalyInputRow } from '@spyglass/storage';

export interface AnomalyTimeSeriesRow {
  timestamp: string;
  spike: number;
  loop: number;
  slow: number;
}

export function computeAnomalyTimeSeries(
  rows: AnomalyInputRow[],
  bucket: 'hour' | 'day'
): AnomalyTimeSeriesRow[] {
  // 1. 세션별 prompt 평균 (spike 기준)
  const sessionPromptInputs = new Map<string, number[]>();
  for (const r of rows) {
    if (r.type === 'prompt' && r.tokens_input > 0) {
      const arr = sessionPromptInputs.get(r.session_id) || [];
      arr.push(r.tokens_input);
      sessionPromptInputs.set(r.session_id, arr);
    }
  }
  const sessionAvg = new Map<string, number>();
  for (const [sid, arr] of sessionPromptInputs) {
    if (arr.length >= 2) {
      sessionAvg.set(sid, arr.reduce((s, x) => s + x, 0) / arr.length);
    }
  }

  // 2. 전체 P95 (slow 기준) — type='tool_call' duration_ms > 0
  const durations = rows
    .filter(r => r.type === 'tool_call' && r.duration_ms > 0)
    .map(r => r.duration_ms)
    .sort((a, b) => a - b);
  let p95 = 0;
  if (durations.length > 0) {
    const idx = Math.ceil(durations.length * 0.95) - 1;
    p95 = durations[Math.min(idx, durations.length - 1)];
  }

  // 3. loop: turn_id 그룹 → 연속 3회
  const loopFlagged = new Set<string>();
  const turnGroups = new Map<string, AnomalyInputRow[]>();
  for (const r of rows) {
    if (r.type === 'tool_call' && r.turn_id && r.tool_name) {
      const arr = turnGroups.get(r.turn_id) || [];
      arr.push(r);
      turnGroups.set(r.turn_id, arr);
    }
  }
  for (const [, calls] of turnGroups) {
    let streak = 1;
    for (let i = 1; i < calls.length; i++) {
      if (calls[i].tool_name === calls[i - 1].tool_name) {
        streak++;
        if (streak >= 3) {
          for (let j = i - streak + 1; j <= i; j++) {
            loopFlagged.add(calls[j].id);
          }
        }
      } else {
        streak = 1;
      }
    }
  }

  // 4. 버킷별 카운트
  const bucketSizeMs = bucket === 'day' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const buckets = new Map<number, { spike: number; loop: number; slow: number }>();

  for (const r of rows) {
    const bucketTs = Math.floor(r.timestamp / bucketSizeMs) * bucketSizeMs;
    const cell = buckets.get(bucketTs) || { spike: 0, loop: 0, slow: 0 };

    // spike
    if (r.type === 'prompt' && r.tokens_input > 0) {
      const avg = sessionAvg.get(r.session_id);
      if (avg !== undefined && r.tokens_input > avg * 2) cell.spike++;
    }
    // loop
    if (loopFlagged.has(r.id)) cell.loop++;
    // slow
    if (r.type === 'tool_call' && p95 > 0 && r.duration_ms > p95) cell.slow++;

    buckets.set(bucketTs, cell);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, v]) => ({
      timestamp: new Date(ts).toISOString(),
      spike: v.spike,
      loop: v.loop,
      slow: v.slow,
    }));
}
