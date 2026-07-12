/**
 * Request 응답 시간 통계 — 평균/P95 duration.
 *
 * @description
 *   srp-redesign Phase 10: aggregate.ts(453줄)를 UI 도메인별로 분해.
 *   이 파일의 변경 이유: "응답 시간 지표 정의 변경 (평균/percentile/이상값 정책)".
 *
 *   함수: getAvgPromptDurationMs / getP95DurationMs
 *   private 헬퍼: computeP95 (aggregate-strip.ts에서 재사용)
 *
 *   집계 정책 (P95):
 *   - tool_call PostToolUse 레코드 (event_type='tool')
 *   - duration_ms > 0
 */

import type { Database } from 'bun:sqlite';
import { loadArchivedRequestRows } from './read';

/**
 * P95 duration_ms 계산 — duration_ms 오름차순 정렬된 행 배열에서 95번째 백분위 값을 반환.
 *
 * 동일 필터셋(type='tool_call', event_type='tool', duration_ms > 0)을 사용하는
 * `getP95DurationMs`와 `getStripStats`가 이 헬퍼를 재사용한다.
 */
export function computeP95(rows: Array<{ duration_ms: number }>): number {
  if (rows.length === 0) return 0;
  const idx = Math.ceil(rows.length * 0.95) - 1;
  return rows[Math.min(idx, rows.length - 1)].duration_ms;
}

/**
 * tool_call PostToolUse(event_type='tool') + duration_ms>0 archive 원행의 duration_ms 배열.
 * (1-잔여) P95/strip이 Hot durations와 합쳐 정렬하도록 archive 구간을 exact 반영한다.
 * upperMs 지정 시 duration_ms < upperMs(avg의 이상값 컷) 추가 적용.
 */
function archivedToolDurations(
  db: Database,
  fromTs?: number,
  toTs?: number,
  upperMs?: number,
): number[] {
  const out: number[] = [];
  for (const r of loadArchivedRequestRows(db, { fromTs, toTs })) {
    const d = r.duration_ms;
    if (r.type === 'tool_call' && r.event_type === 'tool' && d != null && d > 0 && (upperMs == null || d < upperMs)) {
      out.push(d);
    }
  }
  return out;
}

/**
 * tool_call PostToolUse 레코드 기준 평균 실행시간 (ms)
 *
 * prompt 레코드에는 duration_ms가 기록되지 않으므로 (PreToolUse→PostToolUse 쌍으로
 * tool_call에만 측정값이 있음) tool_call + event_type='tool' 레코드를 대상으로 집계.
 * duration_ms가 0보다 크고 600_000ms(10분) 미만인 레코드만 집계하여 타임스탬프
 * 오기입으로 인한 이상값을 제외한다.
 *
 * @param fromTs 집계 시작 타임스탬프 (옵셔널, 미지정 시 전체 기간)
 * @param toTs   집계 종료 타임스탬프 (옵셔널, 미지정 시 전체 기간)
 */
export function getAvgPromptDurationMs(
  db: Database,
  fromTs?: number,
  toTs?: number
): number {
  const conditions: string[] = [
    "type = 'tool_call'",
    "event_type = 'tool'",
    'duration_ms > 0',
    'duration_ms < 600000',
  ];
  const params: number[] = [];

  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }

  // Hot: AVG 대신 SUM/COUNT로 받아 archive와 가법 합산 후 평균(교차 평균 오류 방지).
  const hot = db.query(`
    SELECT COALESCE(SUM(duration_ms), 0) AS s, COUNT(*) AS c
    FROM requests
    WHERE ${conditions.join(' AND ')}
  `).get(...params) as { s: number; c: number };

  let sum = hot.s;
  let count = hot.c;
  for (const d of archivedToolDurations(db, fromTs, toTs, 600000)) { sum += d; count++; }
  return count > 0 ? sum / count : 0;
}

/**
 * 현재 필터 기간 기준 tool_call P95 duration_ms 계산
 * - fromTs / toTs 미지정 시 전체 기간
 */
export function getP95DurationMs(
  db: Database,
  fromTs?: number,
  toTs?: number
): number {
  const conditions: string[] = [
    "type = 'tool_call'",
    "event_type = 'tool'",
    'duration_ms > 0',
  ];
  const params: number[] = [];

  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const rows = db.query(`
    SELECT duration_ms
    FROM requests
    WHERE ${conditions.join(' AND ')}
  `).all(...params) as Array<{ duration_ms: number }>;

  // Hot + Archive duration을 합쳐 정렬 후 P95(percentile은 비가법 — 전체 표본이 필요).
  const merged = [
    ...rows.map((r) => r.duration_ms),
    ...archivedToolDurations(db, fromTs, toTs),
  ].sort((a, b) => a - b);
  return computeP95(merged.map((duration_ms) => ({ duration_ms })));
}
